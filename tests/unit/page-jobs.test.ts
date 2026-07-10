import { describe, expect, it } from "vitest";
import { TranslationError } from "../../src/content/ai-engine";
import { type PageJobOutcome, runPageJob } from "../../src/content/jobs";

const deferred = <T>(): Readonly<{ promise: Promise<T>; resolve(value: T): void }> => {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise?.(value) };
};

describe("bounded page jobs", () => {
  it("never runs more than three workers concurrently", async () => {
    const gates = Array.from({ length: 5 }, () => deferred<PageJobOutcome>());
    let active = 0;
    let peak = 0;
    const job = runPageJob(
      gates,
      async (gate) => {
        active += 1;
        peak = Math.max(peak, active);
        const outcome = await gate.promise;
        active -= 1;
        return outcome;
      },
      () => undefined,
      new AbortController().signal,
    );
    await Promise.resolve();
    for (const gate of gates) gate.resolve("translated");
    await job;
    expect(peak).toBe(3);
  });

  it("caps an explicit concurrency request above three", async () => {
    const gates = Array.from({ length: 5 }, () => deferred<PageJobOutcome>());
    let active = 0;
    let peak = 0;
    const job = runPageJob(
      gates,
      async (gate) => {
        active += 1;
        peak = Math.max(peak, active);
        const outcome = await gate.promise;
        active -= 1;
        return outcome;
      },
      () => undefined,
      new AbortController().signal,
      4,
    );
    await Promise.resolve();
    for (const gate of gates) gate.resolve("translated");
    await job;
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("counts every terminal outcome and reports progress after each element", async () => {
    const progress: number[] = [];
    const outcomes = ["translated", "skipped", "failed", "translated"] as const;
    const summary = await runPageJob(
      outcomes,
      async (outcome) => outcome,
      (current) => {
        progress.push(current.translated + current.skipped + current.failed);
      },
      new AbortController().signal,
    );
    expect(summary).toEqual({ translated: 2, skipped: 1, failed: 1, total: 4 });
    expect(progress).toHaveLength(4);
    expect(progress.at(-1)).toBe(4);
  });

  it("counts a rejected element as failed without aborting peers", async () => {
    const visited: number[] = [];
    const summary = await runPageJob(
      [1, 2, 3],
      async (value) => {
        visited.push(value);
        if (value === 2) throw new TranslationError("translation-failed", "fixture");
        return "translated";
      },
      () => undefined,
      new AbortController().signal,
    );
    expect(summary).toEqual({ translated: 2, skipped: 0, failed: 1, total: 3 });
    expect(visited).toHaveLength(3);
  });

  it("does not claim queued elements after cancellation", async () => {
    const firstWave = deferred<PageJobOutcome>();
    const controller = new AbortController();
    const started: number[] = [];
    const pending = runPageJob(
      [0, 1, 2, 3, 4],
      async (value) => {
        started.push(value);
        return firstWave.promise;
      },
      () => undefined,
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    firstWave.resolve("translated");
    await pending;
    expect(started).toEqual([0, 1, 2]);
  });
});
