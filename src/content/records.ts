import type { DetectionProvenance } from "./source-detection";
import { collectSourceTextNodes } from "./targets";

export const RECORD_PHASES = [
  "idle",
  "queued",
  "detecting",
  "downloading",
  "translating",
  "translated",
  "stale",
  "error",
] as const;

export type RecordPhase = (typeof RECORD_PHASES)[number];

export type TextSnapshot = Readonly<{
  node: Text;
  value: string;
}>;

export type TranslationSuccess = Readonly<{
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  provenance: DetectionProvenance;
}>;

export type ElementDetectionState =
  | Readonly<{ kind: "not-detected" }>
  | Readonly<{ kind: "detected"; language: string; provenance: DetectionProvenance }>
  | Readonly<{ kind: "user-selected"; language: string }>
  | Readonly<{ kind: "needs-confirmation" }>;

export type ElementLanguageOverride = Readonly<{
  source: "auto" | string;
  target: string;
}>;

export type RecordLifecycle = "inspect" | "stale" | "remove" | "clear";

export type TranslationView = Readonly<{
  render(record: ElementRecord): void;
  markStale(record: ElementRecord): void;
  setError(record: ElementRecord, message: string): void;
  restore(record: ElementRecord): void;
  destroy(): void;
}>;

type RestoreCallback = (reason: RecordLifecycle) => void;
type PhaseCallback = (record: ElementRecord) => void;

const TRANSITIONS: Readonly<Record<RecordPhase, readonly RecordPhase[]>> = {
  idle: ["queued", "translated"],
  queued: ["detecting", "downloading", "translating", "stale", "error"],
  detecting: ["downloading", "translating", "stale", "error"],
  downloading: ["translating", "stale", "error"],
  translating: ["translated", "stale", "error"],
  translated: ["queued", "translated", "stale", "error"],
  stale: ["queued", "translated", "error"],
  error: ["queued", "translated", "stale"],
};

export class InvalidRecordTransitionError extends Error {
  readonly from: RecordPhase;
  readonly to: RecordPhase;

  constructor(from: RecordPhase, to: RecordPhase) {
    super(`Invalid element record transition: ${from} -> ${to}`);
    this.name = "InvalidRecordTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class ElementRecord {
  readonly source: HTMLElement;
  readonly snapshot: readonly TextSnapshot[];
  #currentSnapshot: readonly TextSnapshot[];
  #phase: RecordPhase = "idle";
  #lastSuccess: TranslationSuccess | null = null;
  #error: string | null = null;
  #sourceFingerprint: string;
  #languageOverride: ElementLanguageOverride | null = null;
  #detection: ElementDetectionState = { kind: "not-detected" };
  #viewValues = new Map<Text, string>();
  #viewMutationCounts = new Map<Text, number>();
  #activeViewCount = 0;
  #attemptVersion = 0;
  #restorers = new Set<RestoreCallback>();
  readonly #onPhaseChange: PhaseCallback;

  constructor(source: HTMLElement, onPhaseChange: PhaseCallback) {
    this.source = source;
    this.snapshot = snapshotText(source);
    this.#currentSnapshot = this.snapshot;
    this.#sourceFingerprint = source.textContent ?? "";
    this.#onPhaseChange = onPhaseChange;
  }

  get phase(): RecordPhase {
    return this.#phase;
  }

  get currentSnapshot(): readonly TextSnapshot[] {
    return this.#currentSnapshot;
  }

  get lastSuccess(): TranslationSuccess | null {
    return this.#lastSuccess;
  }

  get error(): string | null {
    return this.#error;
  }

  get sourceFingerprint(): string {
    return this.#sourceFingerprint;
  }

  get languageOverride(): ElementLanguageOverride | null {
    return this.#languageOverride;
  }

  get detection(): ElementDetectionState {
    return this.#detection;
  }

  beginAttempt(): number {
    this.#attemptVersion += 1;
    this.#phase = "queued";
    this.#error = null;
    this.#onPhaseChange(this);
    return this.#attemptVersion;
  }

  isCurrentAttempt(version: number): boolean {
    return version === this.#attemptVersion;
  }

  transition(next: RecordPhase): void {
    this.#assertTransition(next);
    this.#phase = next;
    if (next !== "error") this.#error = null;
    this.#onPhaseChange(this);
  }

  complete(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    sourceFingerprint = this.#sourceFingerprint,
    provenance: DetectionProvenance = "language-detector",
  ): void {
    this.#assertTransition("translated");
    this.#phase = "translated";
    this.#lastSuccess = { text, sourceLanguage, targetLanguage, provenance };
    if (this.#activeViewCount === 0 && (this.source.textContent ?? "") === sourceFingerprint) {
      this.#currentSnapshot = snapshotText(this.source);
    }
    this.#sourceFingerprint = sourceFingerprint;
    this.#error = null;
    this.#onPhaseChange(this);
  }

  fail(message: string): void {
    if (this.#phase === "idle") this.#phase = "queued";
    this.#assertTransition("error");
    this.#phase = "error";
    this.#error = message;
    this.#onPhaseChange(this);
  }

  setLanguageOverride(override: ElementLanguageOverride | null): void {
    this.#languageOverride = override;
    if (override !== null && override.source !== "auto") {
      this.#detection = { kind: "user-selected", language: override.source };
    } else if (this.#detection.kind === "user-selected") {
      this.#detection = { kind: "not-detected" };
    }
  }

  setDetection(detection: ElementDetectionState): void {
    this.#detection = detection;
  }

  refreshSource(): void {
    this.#currentSnapshot = snapshotText(this.source);
    this.#sourceFingerprint = this.source.textContent ?? "";
    if (this.#detection.kind !== "user-selected") this.#detection = { kind: "not-detected" };
  }

  registerRestorer(callback: RestoreCallback): () => void {
    this.#restorers.add(callback);
    return () => this.#restorers.delete(callback);
  }

  restoreView(reason: RecordLifecycle): void {
    for (const restore of this.#restorers) restore(reason);
  }

  noteViewMutation(node: Text, value: string): void {
    this.#viewValues.set(node, value);
    this.#viewMutationCounts.set(node, (this.#viewMutationCounts.get(node) ?? 0) + 1);
  }

  beginViewOwnership(): void {
    this.#activeViewCount += 1;
  }

  endViewOwnership(): void {
    if (this.#activeViewCount > 0) this.#activeViewCount -= 1;
  }

  isViewMutation(node: Text): boolean {
    const count = this.#viewMutationCounts.get(node) ?? 0;
    if (count === 0) return false;
    if (count === 1) this.#viewMutationCounts.delete(node);
    else this.#viewMutationCounts.set(node, count - 1);
    return true;
  }

  isCurrentViewValue(node: Text): boolean {
    return this.#viewValues.get(node) === node.data;
  }

  #assertTransition(next: RecordPhase): void {
    if (!TRANSITIONS[this.#phase].includes(next)) {
      throw new InvalidRecordTransitionError(this.#phase, next);
    }
  }
}

export type RecordStore = Readonly<{
  getOrCreate(source: HTMLElement): ElementRecord;
  has(record: ElementRecord): boolean;
  active: ReadonlySet<ElementRecord>;
  markStale(record: ElementRecord): void;
  remove(source: HTMLElement): void;
  clear(): void;
}>;

export const createRecordStore = (): RecordStore => {
  let records = new WeakMap<HTMLElement, ElementRecord>();
  const active = new Set<ElementRecord>();
  const onPhaseChange = (record: ElementRecord): void => {
    if (record.lastSuccess !== null || record.phase === "translated") active.add(record);
  };

  return {
    active,
    getOrCreate(source) {
      const existing = records.get(source);
      if (existing !== undefined) return existing;
      const record = new ElementRecord(source, onPhaseChange);
      records.set(source, record);
      return record;
    },
    has(record) {
      return records.get(record.source) === record;
    },
    markStale(record) {
      record.restoreView("stale");
      if (record.phase !== "stale") record.transition("stale");
    },
    remove(source) {
      const record = records.get(source);
      if (record === undefined) return;
      record.restoreView("remove");
      active.delete(record);
      records.delete(source);
    },
    clear() {
      for (const record of active) record.restoreView("clear");
      active.clear();
      records = new WeakMap<HTMLElement, ElementRecord>();
    },
  };
};

const snapshotText = (source: HTMLElement): readonly TextSnapshot[] => {
  return collectSourceTextNodes(source).map((node) => ({ node, value: node.data }));
};
