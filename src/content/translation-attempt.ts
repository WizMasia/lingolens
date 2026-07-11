import { normalizeLanguage } from "../shared/languages";
import type { SourcePreference } from "../shared/settings";
import {
  type DetectionProvenance,
  type SourceDetectionRequest,
  type TranslationEngine,
  TranslationError,
  type TranslationRequest,
  type TranslationResult,
} from "./ai-engine";
import type { ElementRecord, RecordStore, TranslationView } from "./records";
import { collectSourceText } from "./targets";

export type TranslationAttempt = Readonly<{
  source: HTMLElement;
  preference: SourcePreference;
  target: string;
  signal?: AbortSignal;
}>;

export type TranslationRuntime = Readonly<{
  engine: TranslationEngine;
  store: RecordStore;
  view(): TranslationView;
  announce(message: string): void;
}>;

type ResultCommit = Readonly<{
  record: ElementRecord;
  result: TranslationResult;
  fingerprint: string;
  runtime: TranslationRuntime;
}>;

const UNKNOWN_SOURCE_NOTICE = "원문 언어를 확인할 수 없습니다.";

export const executeTranslation = async (
  attempt: TranslationAttempt,
  runtime: TranslationRuntime,
): Promise<boolean> => {
  const record = runtime.store.getOrCreate(attempt.source);
  record.restoreView("inspect");
  if ((attempt.source.textContent ?? "") !== record.sourceFingerprint) record.refreshSource();
  const priorSuccess = record.lastSuccess;
  const fingerprint = attempt.source.textContent ?? "";
  const attemptVersion = record.beginAttempt();
  record.transition("translating");
  try {
    const result = await runtime.engine.translate(translationRequest(attempt, recordText(record)));
    if (!runtime.store.has(record) || !record.isCurrentAttempt(attemptVersion)) return false;
    if (attempt.signal?.aborted === true) {
      restoreCancelledAttempt(record, priorSuccess, fingerprint, runtime.store);
      return false;
    }
    if (!attempt.source.isConnected || (attempt.source.textContent ?? "") !== fingerprint) {
      runtime.store.markStale(record);
      return false;
    }
    return commitResult({ record, result, fingerprint, runtime });
  } catch (error: unknown) {
    if (!runtime.store.has(record) || !record.isCurrentAttempt(attemptVersion)) return false;
    if (attempt.signal?.aborted === true) {
      restoreCancelledAttempt(record, priorSuccess, fingerprint, runtime.store);
      return false;
    }
    if (!(error instanceof TranslationError)) throw error;
    const message = errorMessage(error);
    record.fail(message);
    runtime.view().setError(record, message);
    runtime.announce(message);
    return false;
  }
};

const restoreCancelledAttempt = (
  record: ElementRecord,
  priorSuccess: ElementRecord["lastSuccess"],
  fingerprint: string,
  store: RecordStore,
): void => {
  if (priorSuccess === null) {
    store.remove(record.source);
    return;
  }
  record.complete(
    priorSuccess.text,
    priorSuccess.sourceLanguage,
    priorSuccess.targetLanguage,
    fingerprint,
    priorSuccess.provenance,
  );
};

const translationRequest = (attempt: TranslationAttempt, text: string): TranslationRequest => {
  if (attempt.preference.kind === "fixed") {
    return { text, source: attempt.preference, target: attempt.target };
  }
  return { ...sourceDetectionRequest(attempt.source, text), target: attempt.target };
};

export const sourceDetectionRequest = (
  source: HTMLElement,
  text: string,
): SourceDetectionRequest => {
  const languageHint = nearestLanguage(source);
  const context = nearbyContext(source, text);
  return {
    text,
    source: {
      kind: "auto",
      ...(languageHint === undefined ? {} : { languageHint }),
      ...(context.length === 0 ? {} : { context }),
    },
  };
};

const commitResult = (commit: ResultCommit): boolean => {
  const { record, result, fingerprint, runtime } = commit;
  switch (result.kind) {
    case "translated":
      record.setDetection(detectionState(result.sourceLanguage, result.provenance));
      record.complete(
        result.text,
        result.sourceLanguage,
        result.targetLanguage,
        fingerprint,
        result.provenance,
      );
      runtime.view().render(record);
      return true;
    case "skipped":
      record.setDetection(detectionState(result.sourceLanguage, result.provenance));
      runtime.store.remove(record.source);
      return false;
    case "unknown-source":
      record.setDetection({ kind: "needs-confirmation" });
      record.fail(UNKNOWN_SOURCE_NOTICE);
      runtime.view().setError(record, UNKNOWN_SOURCE_NOTICE);
      runtime.announce(UNKNOWN_SOURCE_NOTICE);
      return false;
    default:
      return assertNever(result);
  }
};

const detectionState = (
  language: string,
  provenance: DetectionProvenance,
): ElementRecord["detection"] =>
  provenance === "user"
    ? { kind: "user-selected", language }
    : { kind: "detected", language, provenance };

const recordText = (record: ElementRecord): string =>
  record.currentSnapshot
    .map(({ value }) => value.replace(/\s+/gu, " ").trim())
    .filter((value) => value.length > 0)
    .join(" ");

const nearestLanguage = (source: HTMLElement): string | undefined => {
  const language = source.closest("[lang]")?.getAttribute("lang")?.trim();
  return language === undefined || language.length === 0 ? undefined : normalizeLanguage(language);
};

const nearbyContext = (source: HTMLElement, sourceText: string): string => {
  const candidates = [
    source.previousElementSibling,
    source.nextElementSibling,
    source.parentElement,
  ]
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .map((element) => collectSourceText(element).replace(sourceText, "").trim());
  return [...new Set(candidates)]
    .map((value) => value.replace(/\s+/gu, " ").trim())
    .filter((value) => value.length > 0 && value !== sourceText)
    .join(" ")
    .slice(0, 160);
};

const errorMessage = (error: TranslationError): string => {
  switch (error.code) {
    case "api-unavailable":
      return "이 브라우저에서는 온디바이스 번역을 사용할 수 없습니다.";
    case "pair-unavailable":
      return "선택한 언어 쌍은 사용할 수 없습니다.";
    case "translation-failed":
      return "번역에 실패했습니다. 다시 시도해 주세요.";
    default:
      return assertNever(error.code);
  }
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled variant: ${String(value)}`);
};
