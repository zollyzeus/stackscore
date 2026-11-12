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
import { estimateCostUsd } from "../lib/judge";
import { isAuthoritativeStatus, JUDGE_STATUS_BADGE } from "../lib/reviewQueue";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { calibrationFingerprint, fingerprintOf } from "../lib/calibrationMonitor";
import { buildJudgeInput, extractStages, STAGE_FIELDS, NO_CODE_PLACEHOLDER } from "../lib/submissionInput";

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

// ─────────────────────────────────────────────────────────────────────────────
// lib/judge.ts — token accounting (AUDIT_TODO B4)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("judge cost accounting", () => {
  const z = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  test("prices each token class at its own rate", () => {
    // 1M of each class, priced 4 / 20 / 5 / 0.2 USD per million.
    const usd = estimateCostUsd("claude-opus-5-5", {
      inputTokens: 1_000_000, outputTokens: 1_000_000,
      cacheCreationTokens: 1_000_000, cacheReadTokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(4 + 20 + 5 + 0.2, 6);
  });

  test("output dominates a realistic judge call", () => {
    // Roughly one real call: cached 3.9k system prefix, ~4k submission, ~5k output.
    const usd = estimateCostUsd("claude-opus-5-5", {
      ...z, inputTokens: 4_000, outputTokens: 5_000, cacheReadTokens: 3_900,
    });
    const outputShare = (5_000 * 20) / 1_000_000 / usd;
    expect(outputShare).toBeGreaterThan(0.8);
  });

  test("a cache that is always written and never read costs MORE than no cache", () => {
    // The measurement B4 exists to settle. Writing the prefix every call bills at 1.25x
    // base and collects no discount, so the 'optimisation' is a 25% surcharge on that
    // portion. If production shows creation >> reads, the cache_control should come off.
    const alwaysWrites = estimateCostUsd("claude-opus-5-5", { ...z, cacheCreationTokens: 3_900 });
    const noCache = estimateCostUsd("claude-opus-5-5", { ...z, inputTokens: 3_900 });
    const alwaysReads = estimateCostUsd("claude-opus-5-5", { ...z, cacheReadTokens: 3_900 });
    expect(alwaysWrites).toBeGreaterThan(noCache);
    expect(alwaysReads).toBeLessThan(noCache);
  });

  test("an unknown model records zero rather than inventing a price", () => {
    expect(estimateCostUsd("some-future-model", { ...z, outputTokens: 5_000 })).toBe(0);
  });

  test("per-call cost keeps enough precision to compare calls", () => {
    // Rounding to cents would floor a single call's cost to 0.00 and destroy the signal.
    const usd = estimateCostUsd("claude-opus-5-5", { ...z, cacheReadTokens: 3_900 });
    expect(usd).toBeGreaterThan(0);
    expect(usd).toBeLessThan(0.01);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lib/reviewQueue.ts — score provenance (AUDIT_TODO A3)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("judge status provenance", () => {
  test("only judged and reviewed scores are authoritative", () => {
    expect(isAuthoritativeStatus("judged")).toBe(true);
    expect(isAuthoritativeStatus("reviewed")).toBe(true);
    expect(isAuthoritativeStatus("partial")).toBe(false);
    expect(isAuthoritativeStatus("pending_review")).toBe(false);
  });

  test("a record written before statuses existed is treated as authoritative", () => {
    // Back-compat matters here: every score in Firestore predates this field, and
    // excluding them all would empty the benchmarks page rather than fail loudly.
    expect(isAuthoritativeStatus(undefined)).toBe(true);
  });

  test("a provisional score carries a badge; a normal one does not", () => {
    expect(JUDGE_STATUS_BADGE.judged).toBeNull();
    expect(JUDGE_STATUS_BADGE.partial?.label).toMatch(/subject to change/i);
    expect(JUDGE_STATUS_BADGE.pending_review?.label).toMatch(/human verification/i);
    expect(JUDGE_STATUS_BADGE.reviewed?.label).toMatch(/human reviewed/i);
  });

  test("every status is either authoritative or badged — none is silently neither", () => {
    // The failure this guards: adding a status and forgetting to decide whether it counts
    // in statistics, which is exactly how a provisional score rejoins a cohort mean.
    for (const [status, badge] of Object.entries(JUDGE_STATUS_BADGE)) {
      const authoritative = isAuthoritativeStatus(status);
      if (!authoritative) expect(badge, `${status} must warn the reader`).not.toBeNull();
    }
  });
});

test.describe("judge fallback quarantine — status aware", () => {
  test("a partial score is excluded from statistics", () => {
    expect(isJudgedScore({ judgeStatus: "partial" })).toBe(false);
  });

  test("a held score is excluded from statistics", () => {
    expect(isJudgedScore({ judgeStatus: "pending_review" })).toBe(false);
  });

  test("a human-reviewed score rejoins the statistics", () => {
    // The whole point of the review pipeline: a reviewed card is authoritative again, and
    // must not stay quarantined just because the judge originally failed on it.
    expect(isJudgedScore({ judgeStatus: "reviewed" })).toBe(true);
  });

  test("either signal alone is enough to exclude", () => {
    expect(isJudgedScore({ judgeFallback: true, judgeStatus: "judged" })).toBe(false);
    expect(isJudgedScore({ judgeFallback: false, judgeStatus: "partial" })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — calibration monitor and the scoring hold
// ─────────────────────────────────────────────────────────────────────────────
test.describe("scoring hold defaults", () => {
  test("the automatic hold is OFF by default", () => {
    // The most consequential default in the system: an automation that can stop the
    // product scoring must not be on because nobody looked at it. Changing this should
    // require changing this test and explaining why.
    expect(DEFAULT_SETTINGS.scoringHoldEnabled).toBe(false);
  });
});

test.describe("calibration fingerprint", () => {
  test("is stable across calls", () => {
    expect(calibrationFingerprint()).toBe(calibrationFingerprint());
  });

  test("is short enough to read in a log line", () => {
    // It gets printed in alerts and shown in the admin console; a 64-char hash there is
    // noise nobody compares.
    expect(calibrationFingerprint()).toHaveLength(16);
  });

  test("changes when the rubric changes", () => {
    // The whole point. D10 established that editing an anchor IS editing the judge, so a
    // fingerprint over the model alone would keep calling stale evidence current.
    const base = { scale: { note: "a" }, levels: [] };
    const edited = { scale: { note: "a (edited)" }, levels: [] };
    expect(fingerprintOf(edited, "m", "high")).not.toBe(fingerprintOf(base, "m", "high"));
  });

  test("changes when the model or effort changes", () => {
    const r = { scale: { note: "a" }, levels: [] };
    expect(fingerprintOf(r, "model-b", "high")).not.toBe(fingerprintOf(r, "model-a", "high"));
    expect(fingerprintOf(r, "model-a", "medium")).not.toBe(fingerprintOf(r, "model-a", "high"));
  });

  test("is identical for identical inputs", () => {
    const r = { scale: { note: "a" }, levels: [{ id: "d" }] };
    expect(fingerprintOf(r, "m", "high")).toBe(fingerprintOf(r, "m", "high"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lib/submissionInput.ts — one definition of "what was submitted"
// ─────────────────────────────────────────────────────────────────────────────
test.describe("submission extraction", () => {
  // A transcript shaped exactly as the stage APIs write it.
  const transcript = {
    clarify: [{ text: "Q: scale?\nA: 2000 rps" }],
    propose: [{ text: "Token bucket in Redis" }],
    build: [{ code: "export function checkLimit() {}" }],
    adapt: [{ text: "Add a global bucket" }, { code: "const g = ..." }],
    debug: [{ code: "ts is never written back" }],
  } as Record<string, unknown>;

  test("code comes from the `build` stage, not `implement`", () => {
    // The bug this pins: three separate files read stage "implement", which does not
    // exist. Nothing failed loudly -- the judge scores an empty submission perfectly
    // happily and simply reports that no code was submitted.
    expect(STAGE_FIELDS.code.stage).toBe("build");
    expect(extractStages(transcript).code).toContain("checkLimit");
  });

  test("every stage is extracted, none silently empty", () => {
    const s = extractStages(transcript);
    for (const [k, v] of Object.entries(s)) {
      expect(v.trim(), `${k} must not be empty for a complete transcript`).not.toBe("");
    }
  });

  test("revised code after the twist is included, not dropped", () => {
    // A candidate who re-implements after the twist has shown adaptability the prose alone
    // does not. Two of the three bad copies dropped this entirely.
    const s = extractStages(transcript);
    expect(s.twist).toContain("Add a global bucket");
    expect(s.twist).toContain("Revised code after twist");
    expect(s.twist).toContain("const g =");
  });

  test("absent code becomes the placeholder, not an empty string", () => {
    // The judge prompt says code is optional and to score K axes on evident intent, so it
    // has to be TOLD the code is missing rather than handed nothing.
    const input = buildJudgeInput("brief", { ...transcript, build: [] });
    expect(input.code).toBe(NO_CODE_PLACEHOLDER);
  });

  test("present code is passed through untouched", () => {
    expect(buildJudgeInput("brief", transcript).code).toContain("checkLimit");
  });

  test("the judge input carries the brief and every stage", () => {
    const i = buildJudgeInput("the brief text", transcript);
    expect(i.brief).toBe("the brief text");
    expect(i.clarifyingTranscript).toContain("2000 rps");
    expect(i.designProposal).toContain("Token bucket");
    expect(i.debugResponse).toContain("written back");
  });

  test("an empty transcript yields empty stages rather than throwing", () => {
    const i = buildJudgeInput("b", {});
    expect(i.clarifyingTranscript).toBe("");
    expect(i.code).toBe(NO_CODE_PLACEHOLDER);
  });
});
