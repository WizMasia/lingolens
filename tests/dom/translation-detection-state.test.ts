import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { type TranslationEngine, TranslationError } from "../../src/content/ai-engine";
import { createRecordStore, type TranslationView } from "../../src/content/records";
import { executeTranslation } from "../../src/content/translation-attempt";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  Node: { configurable: true, value: testWindow.Node },
  NodeFilter: { configurable: true, value: testWindow.NodeFilter },
  Text: { configurable: true, value: testWindow.Text },
  document: { configurable: true, value: testWindow.document },
});

const view: TranslationView = {
  render() {},
  markStale() {},
  setError() {},
  restore() {},
  destroy() {},
};

describe("translation detection state", () => {
  it("restores successful provenance when a later attempt is cancelled", async () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const store = createRecordStore();
    const record = store.getOrCreate(source);
    record.complete("Bonjour", "en", "fr", "Hello", "chrome-i18n");
    record.setDetection({ kind: "detected", language: "en", provenance: "chrome-i18n" });
    const abort = new AbortController();
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate() {
        abort.abort();
        return {
          kind: "translated",
          text: "Salut",
          sourceLanguage: "en",
          targetLanguage: "fr",
          provenance: "language-detector",
        };
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };

    await executeTranslation(
      { source, preference: { kind: "auto" }, target: "fr", signal: abort.signal },
      { engine, store, view: () => view, announce() {} },
    );

    expect(record.lastSuccess?.provenance).toBe("chrome-i18n");
    expect(record.detection).toEqual({
      kind: "detected",
      language: "en",
      provenance: "chrome-i18n",
    });
  });

  it("preserves successful detection evidence when retranslation fails", async () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const store = createRecordStore();
    const record = store.getOrCreate(source);
    record.complete("Bonjour", "en", "fr", "Hello", "chrome-i18n");
    record.setDetection({ kind: "detected", language: "en", provenance: "chrome-i18n" });
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate() {
        throw new TranslationError("translation-failed", "fixture");
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };

    await executeTranslation(
      { source, preference: { kind: "auto" }, target: "ja" },
      { engine, store, view: () => view, announce() {} },
    );

    expect(record.detection).toEqual({
      kind: "detected",
      language: "en",
      provenance: "chrome-i18n",
    });
  });
});
