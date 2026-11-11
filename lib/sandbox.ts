import vm from "node:vm";

export interface SandboxResult {
  logs: string[];
  error: string | null;
  timedOut: boolean;
}

const MAX_CODE_BYTES = 100_000;
const MAX_LOG_LINES = 200;
const MAX_LOG_LINE_CHARS = 2_000;

/**
 * Dynamic `import()` inside a vm context with no importModuleDynamically callback throws
 * ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING *asynchronously*, outside any try/catch here —
 * which takes the whole Node process down. On Cloud Run that means `import("fs")` from a
 * candidate's code restarts the container: a one-line denial of service.
 *
 * Supplying a callback that throws turns it into an ordinary, catchable rejection inside
 * the sandbox instead.
 */
const denyDynamicImport = () => {
  throw new Error("Dynamic import is disabled in this sandbox");
};

const RUN_OPTIONS = { importModuleDynamically: denyDynamicImport } as unknown as vm.RunningCodeOptions;

/**
 * The import rejection is raised ASYNCHRONOUSLY, after runInContext has already returned,
 * so it cannot be caught by the try/catch around the call. Node's default behaviour for an
 * unhandled rejection is to terminate the process — which would let any candidate restart
 * the Cloud Run container with one line of code.
 *
 * This listener swallows *only* the sandbox's own dynamic-import rejections and re-raises
 * nothing else, so genuine unhandled rejections elsewhere in the app keep their normal
 * (fatal, visible) behaviour.
 *
 * Note `..._MISSING_FLAG` is what Node raises when `importModuleDynamically` is supplied
 * without `--experimental-vm-modules`, which is how Next.js runs by default.
 */
const SANDBOX_IMPORT_ERROR_CODES = new Set([
  "ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING",
  "ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG",
]);

declare global {
  // eslint-disable-next-line no-var
  var __ssSandboxGuardInstalled: boolean | undefined;
}

if (!globalThis.__ssSandboxGuardInstalled) {
  globalThis.__ssSandboxGuardInstalled = true;
  process.on("unhandledRejection", (reason) => {
    const code = (reason as { code?: string } | null)?.code;
    const message = (reason as { message?: string } | null)?.message ?? "";
    // Match by code where Node supplies one, and by message otherwise: the
    // "A dynamic import callback was invoked without --experimental-vm-modules"
    // TypeError carries NO error code, so a code-only check lets it through — and an
    // unhandled rejection takes the process down.
    const isSandboxImport =
      (code && SANDBOX_IMPORT_ERROR_CODES.has(code)) ||
      /dynamic import/i.test(message) ||
      /experimental-vm-modules/i.test(message);
    if (isSandboxImport) {
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          message: "[sandbox] blocked dynamic import attempt from candidate code",
          code: code ?? null,
        })
      );
      return; // contained — do not let it take the process down
    }
    // Anything else keeps Node's default semantics.
    throw reason;
  });
}

/**
 * MVP sandbox: in-process Node vm with a timeout and a captured console.
 *
 * SECURITY — why nothing from the host realm is passed into the context:
 * handing a host object (e.g. a `console` literal defined out here) into the context
 * leaks the host realm through its prototype chain, because
 * `hostObject.anyMethod.constructor` is the *host* `Function`. That gives
 * `console.log.constructor("return process.env")()` — full access to process.env, which
 * on Cloud Run means every API key and signing secret, plus the GCP metadata server.
 *
 * So the log collector is constructed INSIDE the context by evaluating a factory there,
 * and results are copied out as primitives only.
 *
 * This is still NOT the isolation story for production (PRD.md NFR4 calls for a
 * Cloud Run Job / gVisor-isolated runner) — a determined escape may still be possible
 * via other channels, and the only durable fix is to run untrusted code in a process
 * that holds no secrets. Tracked in AUDIT_TODO.md B1 step 3.
 */
export function runJavaScript(code: string, timeoutMs = 2000): SandboxResult {
  if (typeof code !== "string") {
    return { logs: [], error: "No code supplied", timedOut: false };
  }
  if (code.length > MAX_CODE_BYTES) {
    return { logs: [], error: `Code too large (max ${MAX_CODE_BYTES} bytes)`, timedOut: false };
  }

  // An empty context: no host objects, no require, no process, no globals from here.
  const context = vm.createContext(Object.create(null));

  try {
    // Build the console entirely inside the context so no host function is reachable.
    vm.runInContext(
      `
      globalThis.__logs = [];
      globalThis.console = {
        log:   (...a) => { globalThis.__logs.push(a.map(String).join(" ")); },
        info:  (...a) => { globalThis.__logs.push(a.map(String).join(" ")); },
        warn:  (...a) => { globalThis.__logs.push(a.map(String).join(" ")); },
        error: (...a) => { globalThis.__logs.push(a.map(String).join(" ")); },
      };
      `,
      context,
      { ...RUN_OPTIONS, timeout: 1000 }
    );

    vm.runInContext(code, context, { ...RUN_OPTIONS, timeout: timeoutMs });

    return { logs: readLogs(context, timeoutMs), error: null, timedOut: false };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const timedOut = raw.includes("Script execution timed out");
    // Normalise the dynamic-import failures into one candidate-facing message rather than
    // leaking Node's internal flag names into the assessment UI.
    const message = /dynamic import|experimental-vm-modules/i.test(raw)
      ? "Dynamic import is disabled in this sandbox"
      : raw;
    // Surface whatever was logged before the throw, best-effort.
    let logs: string[] = [];
    try {
      logs = readLogs(context, 500);
    } catch {
      /* context may be unusable after a timeout */
    }
    return { logs, error: message, timedOut };
  }
}

/**
 * Copies the log lines out of the context as plain primitives.
 * JSON round-tripping guarantees nothing but strings crosses the boundary — a candidate
 * cannot hand back an object whose getters or prototype run host-side.
 */
function readLogs(context: vm.Context, timeoutMs: number): string[] {
  const raw = vm.runInContext(
    "JSON.stringify((globalThis.__logs || []).map(String))",
    context,
    { ...RUN_OPTIONS, timeout: timeoutMs }
  );
  if (typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .slice(0, MAX_LOG_LINES)
    .map((l) => String(l).slice(0, MAX_LOG_LINE_CHARS));
}
