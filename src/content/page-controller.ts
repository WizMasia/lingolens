import type { TabState } from "../shared/protocol";
import type { DocumentTitleAttempt, DocumentTitleTranslation } from "./document-title";
import { type PageJobOutcome, type PageJobSummary, runPageJob } from "./jobs";
import type { ElementRecord, RecordStore } from "./records";
import { createActiveRecordObserver } from "./stale-records";
import { discoverTargets } from "./targets";

export type PageController = Readonly<{
  translatePage(): Promise<void>;
  restorePage(): void;
  getState(): TabState;
  syncRecords(): void;
  destroy(): void;
}>;

export type PageControllerDependencies = Readonly<{
  document: Document;
  store: RecordStore;
  title: DocumentTitleTranslation;
  translate(source: HTMLElement, signal: AbortSignal): Promise<PageJobOutcome>;
  onStale(record: ElementRecord): void;
  onState(state: TabState): void;
}>;

type PageTarget =
  | Readonly<{ kind: "element"; source: HTMLElement }>
  | Readonly<{ kind: "title"; attempt: DocumentTitleAttempt }>;

const IDLE_STATE: TabState = {
  phase: "idle",
  completed: 0,
  total: 0,
  skipped: 0,
  failed: 0,
};

const pageTargets = (dependencies: PageControllerDependencies): readonly PageTarget[] => {
  const elements: readonly PageTarget[] = discoverTargets(dependencies.document).map((source) => ({
    kind: "element",
    source,
  }));
  const title = dependencies.title.prepare();
  return title === undefined ? elements : [{ kind: "title", attempt: title }, ...elements];
};

const translateTarget = (
  target: PageTarget,
  dependencies: PageControllerDependencies,
  signal: AbortSignal,
): Promise<PageJobOutcome> => {
  switch (target.kind) {
    case "element":
      return dependencies.translate(target.source, signal);
    case "title":
      return dependencies.title.translate(target.attempt, signal);
    default:
      return assertNever(target);
  }
};

export const createPageController = (dependencies: PageControllerDependencies): PageController => {
  const records = createActiveRecordObserver(
    dependencies.document,
    dependencies.store,
    dependencies.onStale,
  );
  let activeJob: AbortController | null = null;
  let activeRun: Promise<void> = Promise.resolve();
  let state = IDLE_STATE;

  const publish = (next: TabState): void => {
    state = next;
    dependencies.onState(next);
  };

  const reset = (notify: boolean, preserveDetection: boolean): void => {
    activeJob?.abort();
    dependencies.title.restore();
    activeJob = null;
    records.disconnect();
    if (preserveDetection) dependencies.store.restoreAllTranslations();
    else dependencies.store.clear();
    if (notify) publish(IDLE_STATE);
  };

  const restorePage = (): void => reset(true, true);

  const run = async (job: AbortController): Promise<void> => {
    if (job.signal.aborted) return;
    const targets = pageTargets(dependencies);
    publish(translatingState(emptySummary(targets.length)));
    const result = await runPageJob(
      targets,
      (target) => translateTarget(target, dependencies, job.signal),
      (progress) => {
        if (activeJob === job) publish(translatingState(progress));
        records.sync();
      },
      job.signal,
    );
    records.sync();
    if (activeJob !== job) return;
    activeJob = null;
    publish(finalState(result));
  };

  return {
    translatePage() {
      activeJob?.abort();
      const job = new AbortController();
      activeJob = job;
      activeRun = activeRun.then(() => run(job));
      return activeRun;
    },
    restorePage,
    getState() {
      return state;
    },
    syncRecords() {
      records.sync();
    },
    destroy() {
      reset(false, false);
    },
  };
};

const emptySummary = (total: number): PageJobSummary => ({
  translated: 0,
  skipped: 0,
  failed: 0,
  total,
});

const translatingState = (summary: PageJobSummary): TabState => ({
  phase: "translating",
  completed: summary.translated + summary.skipped + summary.failed,
  total: summary.total,
  skipped: summary.skipped,
  failed: summary.failed,
});

const finalState = (summary: PageJobSummary): TabState => ({
  phase: summary.translated === 0 && summary.failed > 0 ? "error" : "complete",
  completed: summary.translated + summary.skipped + summary.failed,
  total: summary.total,
  skipped: summary.skipped,
  failed: summary.failed,
});

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled variant: ${String(value)}`);
};
