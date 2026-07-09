import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TranslationEngine,
  TranslationRequest,
  TranslationResult,
} from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import { createRecordStore } from "../../src/content/records";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  DOMRect: { configurable: true, value: testWindow.DOMRect },
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  KeyboardEvent: { configurable: true, value: testWindow.KeyboardEvent },
  Node: { configurable: true, value: testWindow.Node },
  NodeFilter: { configurable: true, value: testWindow.NodeFilter },
  ShadowRoot: { configurable: true, value: testWindow.ShadowRoot },
  Text: { configurable: true, value: testWindow.Text },
  document: { configurable: true, value: testWindow.document },
  window: { configurable: true, value: testWindow },
});

Object.defineProperty(testWindow.HTMLElement.prototype, "getClientRects", {
  configurable: true,
  value: () => [new testWindow.DOMRect(0, 0, 100, 20)],
  writable: true,
});

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
};

const translated = (text: string): TranslationResult => ({
  kind: "translated",
  text,
  sourceLanguage: "en",
  targetLanguage: "ko",
});

const sourceFixture = (text: string, lang?: string): HTMLElement => {
  const source = document.createElement("p");
  source.textContent = text;
  if (lang !== undefined) source.lang = lang;
  document.body.append(source);
  return source;
};

const engineFixture = (
  result: TranslationResult = translated("안녕하세요"),
): Readonly<{
  engine: TranslationEngine;
  requests: readonly TranslationRequest[];
}> => {
  const requests: TranslationRequest[] = [];
  return {
    requests,
    engine: {
      async translate(request) {
        requests.push(request);
        return result;
      },
      async availability() {
        return "available";
      },
      destroy() {},
    },
  };
};

describe("targeted translation", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it("translates the selected element instead of the hovered element", async () => {
    // Given
    const selected = sourceFixture("Selected");
    const hovered = sourceFixture("Hovered");
    const range = document.createRange();
    const selectedText = selected.firstChild;
    if (!(selectedText instanceof Text)) throw new Error("fixture text missing");
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    if (selection === null) throw new Error("fixture selection missing");
    selection.addRange(range);
    const { engine, requests } = engineFixture();
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    controller.setHovered(hovered);

    // When
    await controller.translateTarget();

    // Then
    expect(requests.map(({ text }) => text)).toEqual(["Selected"]);
  });

  it("translates the hovered element when the selection is collapsed", async () => {
    // Given
    const hovered = sourceFixture("Hovered");
    const { engine, requests } = engineFixture();
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    controller.setHovered(hovered);

    // When
    await controller.translateTarget();

    // Then
    expect(requests.map(({ text }) => text)).toEqual(["Hovered"]);
  });

  it("emits a Korean notice when no target is available", async () => {
    // Given
    const notice = vi.fn();
    const { engine } = engineFixture();
    const controller = createTranslationController({
      document,
      engine,
      settings: SETTINGS,
      notice,
    });

    // When
    await controller.translateTarget();

    // Then
    expect(notice).toHaveBeenCalledWith("텍스트 요소를 선택하거나 가리켜 주세요.");
  });

  it("renders no translation when source and target languages match", async () => {
    // Given
    const source = sourceFixture("안녕하세요");
    const { engine } = engineFixture({ kind: "skipped", sourceLanguage: "ko" });
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    // When
    await controller.translateTarget(source);

    // Then
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(0);
  });

  it("renders successful text only through the configured inline view", async () => {
    // Given
    const source = sourceFixture("Hello");
    const { engine } = engineFixture(translated("<img src=x onerror=alert(1)>"));
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    // When
    await controller.translateTarget(source);

    // Then
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="inline"]');
    expect(host).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("canonicalizes the ancestor language hint and bounds nearby context", async () => {
    // Given
    const parent = document.createElement("section");
    parent.lang = "en-US";
    const sibling = document.createElement("p");
    sibling.textContent = "Context ".repeat(30);
    const source = document.createElement("p");
    source.textContent = "Save";
    parent.append(sibling, source);
    document.body.append(parent);
    const { engine, requests } = engineFixture();
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    // When
    await controller.translateTarget(source);

    // Then
    expect(requests[0]?.source).toEqual({
      kind: "auto",
      languageHint: "en",
      context: expect.any(String),
    });
    const request = requests[0];
    expect(
      request?.source.kind === "auto" ? request.source.context?.length : undefined,
    ).toBeLessThanOrEqual(160);
  });

  it("omits a malformed ancestor language hint", async () => {
    // Given
    const parent = document.createElement("section");
    parent.setAttribute("lang", "not_a_language!");
    const source = document.createElement("p");
    source.textContent = "Save";
    parent.append(source);
    document.body.append(parent);
    const { engine, requests } = engineFixture();
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    // When
    await controller.translateTarget(source);

    // Then
    expect(requests[0]?.source).toEqual({ kind: "auto" });
  });

  it("does not render when the source fingerprint changes while translating", async () => {
    // Given
    const source = sourceFixture("Hello");
    let resolveTranslation: ((result: TranslationResult) => void) | undefined;
    const engine: TranslationEngine = {
      translate: () =>
        new Promise((resolve) => {
          resolveTranslation = resolve;
        }),
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const store = createRecordStore();
    const controller = createTranslationController({ document, engine, settings: SETTINGS, store });

    // When
    const pending = controller.translateTarget(source);
    source.textContent = "Changed";
    resolveTranslation?.(translated("안녕하세요"));
    await pending;

    // Then
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(0);
    expect(store.getOrCreate(source).phase).toBe("stale");
  });
});
