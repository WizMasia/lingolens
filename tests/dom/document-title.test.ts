import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type TranslationEngine,
  TranslationError,
  type TranslationResult,
} from "../../src/content/ai-engine";
import { createDocumentTitleTranslation } from "../../src/content/document-title";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: testWindow.document,
});

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  liveChatNanoEnabled: false,
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

const translated = (text: string): TranslationResult => ({
  kind: "translated",
  text,
  sourceLanguage: "en",
  targetLanguage: "ko",
  provenance: "language-detector",
});

const fakeEngine = (translate: TranslationEngine["translate"]): TranslationEngine => ({
  async detectSource() {
    return { kind: "detected", language: "en", provenance: "language-detector" };
  },
  translate,
  async availability() {
    return "available";
  },
  destroy() {},
});

const requiredAttempt = (
  title: ReturnType<typeof createDocumentTitleTranslation>,
): NonNullable<ReturnType<typeof title.prepare>> => {
  const attempt = title.prepare();
  if (attempt === undefined) throw new TypeError("expected a document-title attempt");
  return attempt;
};

afterEach(() => {
  document.title = "";
});

describe("document title translation", () => {
  it("translates and restores a meaningful title", async () => {
    document.title = "Original article";
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(vi.fn().mockResolvedValue(translated("번역된 글"))),
      settings: () => SETTINGS,
    });

    await expect(
      title.translate(requiredAttempt(title), new AbortController().signal),
    ).resolves.toBe("translated");
    expect(document.title).toBe("번역된 글");
    title.restore();
    expect(document.title).toBe("Original article");
  });

  it("preserves a site-owned change and captures it on the next run", async () => {
    document.title = "Original article";
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(vi.fn().mockResolvedValue(translated("번역된 글"))),
      settings: () => SETTINGS,
    });
    await title.translate(requiredAttempt(title), new AbortController().signal);

    document.title = "Updated by site";
    title.restore();

    expect(document.title).toBe("Updated by site");
    expect(requiredAttempt(title).source).toBe("Updated by site");
  });

  it("preserves newer ownership when a superseded result arrives", async () => {
    // Given: attempt A remains pending while attempt B translates a newer site title.
    document.title = "First article";
    let resolveFirst: ((result: TranslationResult) => void) | undefined;
    const firstPending = new Promise<TranslationResult>((resolve) => {
      resolveFirst = resolve;
    });
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine((request) =>
        request.text === "First article" ? firstPending : Promise.resolve(translated("두 번째 글")),
      ),
      settings: () => SETTINGS,
    });
    const firstResult = title.translate(requiredAttempt(title), new AbortController().signal);
    document.title = "Second article";
    await title.translate(requiredAttempt(title), new AbortController().signal);

    // When: the superseded attempt resolves after B owns the translated title.
    resolveFirst?.(translated("첫 번째 글"));
    await firstResult;
    title.restore();

    // Then: restoring uses B's source rather than losing B's ownership.
    expect(document.title).toBe("Second article");
  });

  it("discards a late result after cancellation", async () => {
    document.title = "Original article";
    let resolveResult: ((result: TranslationResult) => void) | undefined;
    const pending = new Promise<TranslationResult>((resolve) => {
      resolveResult = resolve;
    });
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(() => pending),
      settings: () => SETTINGS,
    });
    const abort = new AbortController();
    const result = title.translate(requiredAttempt(title), abort.signal);

    abort.abort();
    title.restore();
    resolveResult?.(translated("늦은 결과"));

    await expect(result).resolves.toBe("skipped");
    expect(document.title).toBe("Original article");
  });

  it("leaves a same-language title unchanged", async () => {
    document.title = "한국어 제목";
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(
        vi.fn().mockResolvedValue({
          kind: "skipped",
          sourceLanguage: "ko",
          provenance: "language-detector",
        }),
      ),
      settings: () => SETTINGS,
    });

    await expect(
      title.translate(requiredAttempt(title), new AbortController().signal),
    ).resolves.toBe("skipped");
    expect(document.title).toBe("한국어 제목");
  });

  it("omits empty and non-linguistic titles", () => {
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(vi.fn()),
      settings: () => SETTINGS,
    });
    document.title = "123 ...";
    expect(title.prepare()).toBeUndefined();
  });

  it("reports a translation failure", async () => {
    document.title = "Original article";
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(
        vi.fn().mockRejectedValue(new TranslationError("translation-failed", "failed")),
      ),
      settings: () => SETTINGS,
    });

    await expect(
      title.translate(requiredAttempt(title), new AbortController().signal),
    ).resolves.toBe("failed");
  });

  it("rethrows an unexpected failure", async () => {
    document.title = "Original article";
    const unexpected = new TypeError("unexpected");
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(vi.fn().mockRejectedValue(unexpected)),
      settings: () => SETTINGS,
    });

    await expect(
      title.translate(requiredAttempt(title), new AbortController().signal),
    ).rejects.toBe(unexpected);
  });

  it("rethrows an unexpected failure after cancellation", async () => {
    document.title = "Original article";
    const unexpected = new TypeError("unexpected");
    let rejectResult: ((reason: unknown) => void) | undefined;
    const pending = new Promise<TranslationResult>((_resolve, reject) => {
      rejectResult = reject;
    });
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(() => pending),
      settings: () => SETTINGS,
    });
    const abort = new AbortController();
    const result = title.translate(requiredAttempt(title), abort.signal);

    abort.abort();
    title.restore();
    rejectResult?.(unexpected);

    await expect(result).rejects.toBe(unexpected);
  });
});
