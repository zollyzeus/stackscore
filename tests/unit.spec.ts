/**
 * Library-level tests that need no running server.
 * Exercises lib/token.ts, lib/credential.ts, lib/scoring.ts and lib/sandbox.ts directly.
 */
import { test, expect } from "@playwright/test";
import { signToken, verifyToken } from "../lib/token";
import { canonicalise, signCredential, verifyCredential } from "../lib/credential";
import { computeScoreCard, type AxisScores, type AxisId } from "../lib/scoring";
import { runJavaScript } from "../lib/sandbox";
import rubric from "../data/rubric.json";
import { isJudgedScore } from "../lib/firestore";

const SECRET = "test-secret-at-least-32-characters-long!!";

// ─────────────────────────────────────────────────────────────────────────────
// lib/token.ts
// ─────────────────────────────────────────────────────────────────────────────
test.describe("token sign/verify", () => {
  test("round-trips a payload", async () => {
    const t = await signToken(SECRET, { email: "a@b.com", name: "Alice" });
    const p = await verifyToken<{ email: string; name: string }>(SECRET, t);
    expect(p?.email).toBe("a@b.com");
    expect(p?.name).toBe("Alice");
    expect(typeof p?.iat).toBe("number");
  });

  // A9 regression: atob() yields latin1, so UTF-8 names were mojibake ("José" -> "JosÃ©").
  test("A9 — preserves non-ASCII names", async () => {
    for (const name of ["José Müller", "Åsa Ødegård", "张伟", "Ravi Śarmā", "Łukasz 🎉"]) {
      const t = await signToken(SECRET, { email: "x@y.com", name });
      const p = await verifyToken<{ name: string }>(SECRET, t);
      expect(p?.name, `round-trip failed for ${name}`).toBe(name);
    }
  });

  test("rejects a wrong secret", async () => {
    const t = await signToken(SECRET, { email: "a@b.com" });
    expect(await verifyToken(SECRET + "x", t)).toBeNull();
  });

  test("rejects a tampered payload", async () => {
    const t = await signToken(SECRET, { email: "user@b.com" });
    const [, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ email: "admin@b.com", iat: Date.now() })).toString("base64url");
    expect(await verifyToken(SECRET, `${forged}.${sig}`)).toBeNull();
  });

  test("rejects malformed shapes", async () => {
    for (const bad of ["", ".", "a", "a.b.c", "onlyonepart", "x.".padEnd(70, "0")]) {
      expect(await verifyToken(SECRET, bad), `accepted "${bad}"`).toBeNull();
    }
  });

  test("rejects a non-hex or wrong-length signature", async () => {
    const t = await signToken(SECRET, { email: "a@b.com" });
    const [b64] = t.split(".");
    expect(await verifyToken(SECRET, `${b64}.zzzz`)).toBeNull();
    expect(await verifyToken(SECRET, `${b64}.${"0".repeat(64)}`)).toBeNull();
    expect(await verifyToken(SECRET, `${b64}.${"ab".repeat(16)}`)).toBeNull(); // 32 hex chars
  });

  // A4 regression: iat was written but never checked.
  test("A4 — rejects a token older than maxAge", async () => {
    const t = await signToken(SECRET, { email: "a@b.com" });
    expect(await verifyToken(SECRET, t, 1000), "fresh token within window").not.toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(await verifyToken(SECRET, t, 10), "token older than a 10ms window").toBeNull();
  });

  test("A4 — rejects an implausibly future iat", async () => {
    const body = Buffer.from(JSON.stringify({ email: "a@b.com", iat: Date.now() + 3_600_000 })).toString("base64url");
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifyToken(SECRET, `${body}.${hex}`)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lib/credential.ts  (F4)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("credential signing", () => {
  // lib/credential.ts resolves its key from the environment on every call, so these tests
  // used to fail outright when neither CREDENTIAL_SECRET nor PANELIST_SECRET was exported --
  // they passed only when the runner's shell happened to carry a production secret. That is
  // the wrong dependency for a unit test of the signing algebra: the properties under test
  // (tamper detection, key-order independence) hold for ANY key, so the test supplies its
  // own. It also means these four no longer silently depend on how the suite was invoked.
  const PREV = process.env.CREDENTIAL_SECRET;
  test.beforeAll(() => {
    process.env.CREDENTIAL_SECRET = "unit-test-credential-secret-not-a-real-key";
  });
  test.afterAll(() => {
    if (PREV === undefined) delete process.env.CREDENTIAL_SECRET;
    else process.env.CREDENTIAL_SECRET = PREV;
  });

  const claims = {
    slug: "abc123",
    stackScore: 72,
    levelScores: { design: 75, code: 68 },
    role: "Mid",
    evaluatedAt: "2026-11-11T00:00:00.000Z",
    issuer: "StackScore · AI-judged Engineering Assessment",
  };

  test("canonicalisation is key-order independent", () => {
    const a = canonicalise({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalise({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  test("a signature verifies against its own claims", async () => {
    const sig = await signCredential(claims);
    expect(await verifyCredential(claims, sig)).toBe(true);
  });

  test("a tampered score invalidates the signature", async () => {
    const sig = await signCredential(claims);
    expect(await verifyCredential({ ...claims, stackScore: 95 }, sig)).toBe(false);
  });

  test("a tampered slug invalidates the signature", async () => {
    const sig = await signCredential(claims);
    expect(await verifyCredential({ ...claims, slug: "someone-elses" }, sig)).toBe(false);
  });

  test("reordering claim keys does NOT invalidate the signature", async () => {
    const sig = await signCredential(claims);
    const reordered = {
      issuer: claims.issuer, role: claims.role, evaluatedAt: claims.evaluatedAt,
      levelScores: claims.levelScores, stackScore: claims.stackScore, slug: claims.slug,
    };
    expect(await verifyCredential(reordered, sig)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lib/scoring.ts
// ─────────────────────────────────────────────────────────────────────────────
test.describe("scoring", () => {
  const axisIds = rubric.levels.flatMap((l) => l.axes.map((a) => a.id as AxisId));

  function allAxes(v: number): AxisScores {
    return Object.fromEntries(axisIds.map((id) => [id, v])) as AxisScores;
  }

  test("rubric weights sum to 1", () => {
    const total = rubric.levels.flatMap((l) => l.axes).reduce((s, a) => s + a.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  test("the rubric ships 11 axes (D1-D5, K1-K6)", () => {
    expect(axisIds.sort()).toEqual(
      ["D1", "D2", "D3", "D4", "D5", "K1", "K2", "K3", "K4", "K5", "K6"].sort()
    );
  });

  test("all-100 scores 100; all-0 scores 0", () => {
    expect(computeScoreCard(allAxes(100)).stackScore).toBe(100);
    expect(computeScoreCard(allAxes(0)).stackScore).toBe(0);
  });

  test("level rollups are computed per level", () => {
    const card = computeScoreCard(allAxes(80));
    expect(card.levelScores.design).toBe(80);
    expect(card.levelScores.code).toBe(80);
    expect(card.stackScore).toBe(80);
  });

  test("out-of-range axis scores are clamped", () => {
    const card = computeScoreCard(allAxes(1000));
    expect(card.stackScore).toBeLessThanOrEqual(100);
    const low = computeScoreCard(allAxes(-50));
    expect(low.stackScore).toBeGreaterThanOrEqual(0);
  });

  test("design is weighted more heavily than code (55/45)", () => {
    const designStrong = { ...allAxes(0) } as AxisScores;
    for (const id of axisIds.filter((i) => i.startsWith("D"))) designStrong[id] = 100;
    const codeStrong = { ...allAxes(0) } as AxisScores;
    for (const id of axisIds.filter((i) => i.startsWith("K"))) codeStrong[id] = 100;
    expect(computeScoreCard(designStrong).stackScore)
      .toBeGreaterThan(computeScoreCard(codeStrong).stackScore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lib/sandbox.ts  (B1, direct — no server needed)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("sandbox (direct)", () => {
  test("B1 — host realm is unreachable", () => {
    const attacks = [
      `console.log(console.log.constructor("return process.env")())`,
      `console.log(this.constructor.constructor("return process.env")())`,
      `console.log(({}).constructor.constructor("return process.env")())`,
      `console.log([].constructor.constructor("return process.env")())`,
      `console.log((function(){}).constructor("return process.env")())`,
    ];
    for (const code of attacks) {
      const r = runJavaScript(code);
      const out = r.logs.join(" ");
      expect(out, `leaked for: ${code}`).not.toContain("ANTHROPIC");
      expect(out).not.toContain("PANELIST_SECRET");
      expect(out).not.toContain("sk-ant-");
      // Should have failed with a ReferenceError instead.
      expect(r.error ?? "").toMatch(/process is not defined|not a function|undefined/i);
    }
  });

  test("process, require and module are not in scope", () => {
    for (const ident of ["process", "require", "module", "global", "Buffer", "__dirname"]) {
      const r = runJavaScript(`console.log(typeof ${ident})`);
      expect(r.logs[0], `${ident} should be undefined in the sandbox`).toBe("undefined");
    }
  });

  test("no host-bridging globals are exposed", () => {
    // Standard JS intrinsics (Array, JSON, Function, ...) are expected and necessary —
    // what must be absent is anything that bridges to the host realm.
    const r = runJavaScript(`console.log(Object.getOwnPropertyNames(globalThis).sort().join(","))`);
    const names = (r.logs[0] ?? "").split(",");
    const forbidden = [
      "process", "require", "module", "exports", "global", "Buffer",
      "__dirname", "__filename", "setImmediate", "fetch", "XMLHttpRequest",
    ];
    for (const f of forbidden) {
      expect(names, `${f} must not be reachable from the sandbox`).not.toContain(f);
    }
    // The injected console collector is present.
    expect(names).toContain("console");
    expect(names).toContain("__logs");
  });

  test("the context's Function constructor cannot reach the host realm", () => {
    // Function exists inside the context, but it is the CONTEXT's Function — evaluating
    // host-realm identifiers through it must fail rather than return host objects.
    const r = runJavaScript(`
      try {
        const f = Function("return typeof process");
        console.log("result:" + f());
      } catch (e) {
        console.log("threw:" + e.constructor.name);
      }
    `);
    expect(r.logs.join(" ")).toMatch(/result:undefined|threw:/);
    expect(r.logs.join(" ")).not.toContain("result:object");
  });

  // Each payload handles its own rejection INSIDE the sandbox. lib/sandbox.ts installs a
  // process-level guard so a dangling rejection cannot kill the server (verified
  // separately in tests/sandbox.spec.ts, which asserts the server still serves
  // /api/health afterwards). Playwright registers its own unhandledRejection listener,
  // which would report a contained rejection and fail whichever test runs next, so these
  // payloads keep their rejections local.
  test("dynamic import is denied, not fatal", () => {
    for (const code of [
      `import("fs").then(() => console.log("GOT")).catch(() => console.log("blocked"))`,
      `(async () => { try { await import("node:fs"); console.log("GOT"); } catch { console.log("blocked"); } })()`,
      `try { eval("imp" + "ort('fs')").catch(() => console.log("blocked")) } catch { console.log("blocked") }`,
      `try { new Function("return import('fs')")().catch(() => console.log("blocked")) } catch { console.log("blocked") }`,
    ]) {
      const r = runJavaScript(code);
      expect(r.logs.join(" "), `import leaked for: ${code}`).not.toContain("GOT");
    }
  });

  test("an infinite loop times out", () => {
    // 1s rather than 300ms: under parallel-suite CPU contention a very short budget makes
    // this assertion about the host scheduler rather than about the sandbox watchdog.
    const r = runJavaScript(`while(true){}`, 1_000);
    expect(r.timedOut).toBe(true);
    expect(r.error).toMatch(/timed out/i);
  });

  test("oversized code is refused", () => {
    const r = runJavaScript("x".repeat(200_000));
    expect(r.error).toMatch(/too large/i);
  });

  test("log flooding is capped", () => {
    const r = runJavaScript(`for(let i=0;i<10000;i++) console.log("line"+i)`);
    expect(r.logs.length).toBeLessThanOrEqual(200);
  });

  test("a long single line is truncated", () => {
    const r = runJavaScript(`console.log("y".repeat(50000))`);
    expect(r.logs[0].length).toBeLessThanOrEqual(2000);
  });

  test("legitimate code runs correctly", () => {
    const r = runJavaScript(`
      const reserve = (stock, qty) => (qty <= stock ? stock - qty : null);
      console.log(reserve(10, 4));
      console.log(reserve(2, 5));
      console.log(JSON.stringify([1,2,3].map(n => n * 2)));
    `);
    expect(r.error).toBeNull();
    expect(r.logs).toEqual(["6", "null", "[2,4,6]"]);
  });

  test("a thrown error is reported, not swallowed", () => {
    const r = runJavaScript(`console.log("before"); throw new Error("boom");`);
    expect(r.error).toContain("boom");
    expect(r.logs).toContain("before"); // partial output preserved
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lib/firestore.ts — judge-fallback quarantine (AUDIT_TODO D11)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("judge fallback quarantine", () => {
  // The defect this guards against is not a crash: a fallback card carries real-looking
  // numbers that no judge produced, and before D11 nothing distinguished it. Letting one
  // into a mean or a percentile reads a scoring outage as a cohort of weak candidates.

  test("a score with no flag is treated as judged", () => {
    expect(isJudgedScore({})).toBe(true);
  });

  test("an explicitly non-fallback score is judged", () => {
    expect(isJudgedScore({ judgeFallback: false })).toBe(true);
  });

  test("a fallback score is excluded", () => {
    expect(isJudgedScore({ judgeFallback: true })).toBe(false);
  });

  test("only a real boolean true excludes — a truthy string does not silently pass", () => {
    // Firestore returns whatever was written. A stray "true" must not be read as a flag,
    // because the failure mode is silent: it would quietly drop a genuine score from every
    // statistic. Exclusion requires the exact boolean this codebase writes.
    expect(isJudgedScore({ judgeFallback: "true" })).toBe(true);
    expect(isJudgedScore({ judgeFallback: 1 })).toBe(true);
  });

  test("filtering a mixed cohort removes only the fallbacks", () => {
    const cohort = [
      { stackScore: 80 }, { stackScore: 20, judgeFallback: true },
      { stackScore: 60, judgeFallback: false }, { stackScore: 20, judgeFallback: true },
    ];
    const judged = cohort.filter(isJudgedScore);
    expect(judged.map((s) => s.stackScore)).toEqual([80, 60]);
    // The point of the filter, stated as the number a panelist would otherwise read:
    const avgAll = cohort.reduce((a, s) => a + s.stackScore, 0) / cohort.length;
    const avgJudged = judged.reduce((a, s) => a + s.stackScore, 0) / judged.length;
    expect(Math.round(avgAll)).toBe(45);
    expect(Math.round(avgJudged)).toBe(70);
  });
});
