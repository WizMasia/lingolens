import type { Settings } from "../shared/settings";
import { type TranslationEngine, TranslationError, type TranslationResult } from "./ai-engine";
import { targetLanguage } from "./controller-settings";
import type { PageJobOutcome } from "./jobs";

const MEANINGFUL_TEXT = /[\p{L}\p{M}]/u;

export type DocumentTitleAttempt = Readonly<{
  source: string;
  observedTitle: string;
  version: number;
}>;

export type DocumentTitleTranslation = Readonly<{
  prepare(): DocumentTitleAttempt | undefined;
  translate(attempt: DocumentTitleAttempt, signal: AbortSignal): Promise<PageJobOutcome>;
  restore(): void;
}>;

type Dependencies = Readonly<{
  document: Document;
  engine: TranslationEngine;
  settings(): Settings;
}>;

export const createDocumentTitleTranslation = (
  dependencies: Dependencies,
): DocumentTitleTranslation => {
  let sourceTitle: string | null = null;
  let translatedTitle: string | null = null;
  let version = 0;

  const release = (): void => {
    sourceTitle = null;
    translatedTitle = null;
  };

  const prepare = (): DocumentTitleAttempt | undefined => {
    version += 1;
    const observedTitle = dependencies.document.title;
    const ownedSource =
      sourceTitle !== null && translatedTitle !== null && observedTitle === translatedTitle
        ? sourceTitle
        : undefined;
    const source = ownedSource ?? observedTitle;
    if (ownedSource === undefined) release();
    return MEANINGFUL_TEXT.test(source) ? { source, observedTitle, version } : undefined;
  };

  const isCurrent = (attempt: DocumentTitleAttempt, signal: AbortSignal): boolean =>
    !signal.aborted &&
    attempt.version === version &&
    dependencies.document.title === attempt.observedTitle;

  const commit = (attempt: DocumentTitleAttempt, result: TranslationResult): PageJobOutcome => {
    switch (result.kind) {
      case "translated":
        dependencies.document.title = result.text;
        sourceTitle = attempt.source;
        translatedTitle = dependencies.document.title;
        return "translated";
      case "skipped":
        dependencies.document.title = attempt.source;
        release();
        return "skipped";
      case "unknown-source":
        return "failed";
      default:
        return assertNever(result);
    }
  };

  return {
    prepare,
    async translate(attempt, signal) {
      try {
        const settings = dependencies.settings();
        const result = await dependencies.engine.translate({
          text: attempt.source,
          source: settings.source,
          target: targetLanguage(settings),
        });
        if (!isCurrent(attempt, signal)) {
          if (
            attempt.version === version &&
            dependencies.document.title !== attempt.observedTitle
          ) {
            release();
          }
          return signal.aborted || attempt.version !== version ? "skipped" : "failed";
        }
        return commit(attempt, result);
      } catch (error: unknown) {
        if (!(error instanceof TranslationError)) throw error;
        if (signal.aborted || attempt.version !== version) return "skipped";
        if (dependencies.document.title !== attempt.observedTitle) release();
        return "failed";
      }
    },
    restore() {
      version += 1;
      if (
        sourceTitle !== null &&
        translatedTitle !== null &&
        dependencies.document.title === translatedTitle
      ) {
        dependencies.document.title = sourceTitle;
      }
      release();
    },
  };
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled variant: ${String(value)}`);
};
