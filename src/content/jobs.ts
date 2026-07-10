export type PageJobOutcome = "translated" | "skipped" | "failed";

export type PageJobSummary = Readonly<{
  translated: number;
  skipped: number;
  failed: number;
  total: number;
}>;

type PageJobCounts = {
  translated: number;
  skipped: number;
  failed: number;
};

export const runPageJob = async <Target>(
  targets: readonly Target[],
  worker: (target: Target) => Promise<PageJobOutcome>,
  onProgress: (summary: PageJobSummary) => void,
  signal: AbortSignal,
  concurrency = 3,
): Promise<PageJobSummary> => {
  let nextIndex = 0;
  const counts: PageJobCounts = { translated: 0, skipped: 0, failed: 0 };
  const workerCount = Math.max(1, Math.floor(concurrency));

  const runWorker = async (): Promise<void> => {
    while (!signal.aborted && nextIndex < targets.length) {
      const target = targets[nextIndex];
      if (target === undefined || signal.aborted) return;
      nextIndex += 1;
      const outcome = await worker(target).then(
        (result) => result,
        () => "failed" as const,
      );
      counts[outcome] += 1;
      onProgress(summary(counts, targets.length));
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return summary(counts, targets.length);
};

const summary = (counts: PageJobCounts, total: number): PageJobSummary => ({
  translated: counts.translated,
  skipped: counts.skipped,
  failed: counts.failed,
  total,
});
