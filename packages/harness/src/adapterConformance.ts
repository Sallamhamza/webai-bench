import type { CellAdapter, CellSample } from "./runner";

// Adapter conformance suite (E2-S4). The contract every real per-runtime adapter (WebLLM,
// Transformers.js, wllama — E2-S1/S2/S3) must satisfy, made executable and checked against fake
// adapters *before* any of those SDKs are touched — per the plan: the conformance suite is the
// contract, not an afterthought bolted on once three libraries have already forced three
// different interpretations of it.
//
// Each check is a plain async function that resolves on success and throws a descriptive Error
// on failure — not a describe()/it() block itself, so a real adapter's own test file can wrap
// each one in its own `it(...)` for individual pass/fail reporting:
//
//   it("meta shape", () => checkAdapterMeta(() => createWebLLMAdapter(...)));
//   it("init/dispose lifecycle", () => checkInitAndDispose(() => createWebLLMAdapter(...)));
//   ...
//
// This file is tested directly against controllable fakes in adapterConformance.test.ts —
// including deliberately-broken fakes, to prove each check actually has teeth and isn't just a
// happy-path no-op.

export function checkAdapterMeta(createAdapter: () => CellAdapter): void {
  const { meta } = createAdapter();
  if (typeof meta.runtime !== "string" || meta.runtime.length === 0) {
    throw new Error("adapter.meta.runtime must be a non-empty string");
  }
  if (typeof meta.runtimeVersion !== "string" || meta.runtimeVersion.length === 0) {
    throw new Error("adapter.meta.runtimeVersion must be a non-empty string");
  }
  if (typeof meta.supportsWorker !== "boolean") {
    throw new Error("adapter.meta.supportsWorker must be a boolean");
  }
}

export async function checkInitAndDispose(createAdapter: () => CellAdapter): Promise<void> {
  const adapter = createAdapter();
  await adapter.init();
  await adapter.dispose();
}

function checkCellSampleShape(sample: CellSample, repIndex: number): void {
  const label = repIndex === 0 ? "warmup" : `measured rep ${repIndex}`;

  if (sample.ttftMs !== null && !(typeof sample.ttftMs === "number" && sample.ttftMs >= 0)) {
    throw new Error(
      `${label}: ttftMs must be null or a non-negative number, got ${String(sample.ttftMs)}`,
    );
  }
  if (
    sample.decodeTps !== null &&
    !(typeof sample.decodeTps === "number" && sample.decodeTps >= 0)
  ) {
    throw new Error(
      `${label}: decodeTps must be null or a non-negative number, got ${String(sample.decodeTps)}`,
    );
  }
  if (
    sample.tokensGenerated !== null &&
    !(Number.isInteger(sample.tokensGenerated) && sample.tokensGenerated >= 0)
  ) {
    throw new Error(
      `${label}: tokensGenerated must be null or a non-negative integer, got ${String(sample.tokensGenerated)}`,
    );
  }
  if (
    sample.runtimeReportedTps !== null &&
    !(typeof sample.runtimeReportedTps === "number" && sample.runtimeReportedTps >= 0)
  ) {
    throw new Error(
      `${label}: runtimeReportedTps must be null or a non-negative number, got ${String(sample.runtimeReportedTps)}`,
    );
  }
}

/** Exercises runOnce() the way the runner actually does: repeatedly, without re-init between
 * calls (1 warmup + N measured reps, per 04 §4 steps 5-6) — and checks each returned sample's
 * shape is plausible. */
export async function checkRunOnceLifecycle(
  createAdapter: () => CellAdapter,
  reps = 4,
): Promise<void> {
  const adapter = createAdapter();
  await adapter.init();
  try {
    for (let i = 0; i < reps; i++) {
      const sample = await adapter.runOnce();
      checkCellSampleShape(sample, i);
    }
  } finally {
    await adapter.dispose();
  }
}

const DEFAULT_MID_RUN_DISPOSE_TIMEOUT_MS = 2000;

/**
 * Verifies that calling dispose() while a runOnce() is in flight causes that call to settle
 * promptly rather than hang forever — this is what the Stop button (06-security-privacy.md
 * §6.4) ultimately depends on. Doesn't require the in-flight call to specifically reject (an
 * adapter that lets a near-finished generation complete gracefully before tearing down is fine
 * too); it only requires that neither promise is left dangling past the timeout.
 */
export async function checkMidRunDisposeAborts(
  createAdapter: () => CellAdapter,
  timeoutMs = DEFAULT_MID_RUN_DISPOSE_TIMEOUT_MS,
): Promise<void> {
  const adapter = createAdapter();
  await adapter.init();

  const runSettled = adapter.runOnce().then(
    () => undefined,
    () => undefined, // rejecting is an acceptable outcome of an abort — we only care it settles
  );
  const disposeSettled = adapter.dispose().then(
    () => undefined,
    () => undefined,
  );

  const timedOut = Symbol("timed-out");
  const timeout = new Promise<typeof timedOut>((resolve) => {
    setTimeout(() => resolve(timedOut), timeoutMs);
  });

  const outcome = await Promise.race([Promise.all([runSettled, disposeSettled]), timeout]);

  if (outcome === timedOut) {
    throw new Error(
      `runOnce() and/or dispose() did not both settle within ${timeoutMs}ms of a concurrent ` +
        "dispose() call — an in-flight measurement must be aborted/settled promptly, not left hanging",
    );
  }
}

/**
 * Verifies that a failing init() rejects with a real Error carrying a non-empty message, not a
 * swallowed failure or a non-Error throw (a bare string, undefined, etc.) that would be
 * unusable further up the stack. Takes a *separate* factory whose init() is expected to reject
 * — not every adapter has an easy "make me fail" knob available in a test harness, so callers
 * that can't construct one should simply not call this check rather than force one.
 */
export async function checkErrorSurfacing(createFailingAdapter: () => CellAdapter): Promise<void> {
  const adapter = createFailingAdapter();
  let didReject = false;

  try {
    await adapter.init();
  } catch (err) {
    didReject = true;
    if (!(err instanceof Error)) {
      throw new Error(`init() rejected with a non-Error value: ${String(err)}`);
    }
    if (err.message.length === 0) {
      throw new Error("init() rejected with an Error that has an empty message");
    }
  }

  if (!didReject) {
    throw new Error("expected createFailingAdapter's init() to reject, but it resolved");
  }
}
