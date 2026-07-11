import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceDetection, TranslationEngine } from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import type {
  ElementMenu,
  ElementMenuResult,
  ElementMenuSelection,
} from "../../src/content/element-menu";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: testWindow.Element },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  Node: { configurable: true, value: testWindow.Node },
  Text: { configurable: true, value: testWindow.Text },
  document: { configurable: true, value: testWindow.document },
});
Object.defineProperty(testWindow.HTMLElement.prototype, "getClientRects", {
  configurable: true,
  value: () => [new testWindow.DOMRect(0, 0, 100, 20)],
});
Object.defineProperty(testWindow, "getComputedStyle", {
  configurable: true,
  value: () => ({ display: "block", opacity: "1", visibility: "visible" }),
});

const settings: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

const deferredDetection = (): Readonly<{
  promise: Promise<SourceDetection>;
  resolve(value: SourceDetection): void;
}> => {
  let resolvePromise: ((value: SourceDetection) => void) | undefined;
  const promise = new Promise<SourceDetection>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) throw new TypeError("Detection resolver unavailable");
      resolvePromise(value);
    },
  };
};

describe("element menu source inspection", () => {
  beforeEach(() => document.body.replaceChildren());

  it("detects an untouched source before opening its menu without translating or rendering", async () => {
    const source = document.createElement("p");
    source.lang = "fr";
    source.textContent = "Bonjour";
    document.body.append(source);
    const detectSource = vi.fn().mockResolvedValue({
      kind: "detected",
      language: "fr",
      provenance: "lang",
    });
    const translate = vi.fn();
    let openedSelection: ElementMenuSelection | undefined;
    const menu: ElementMenu = {
      async open(_anchor, selection): Promise<ElementMenuResult> {
        openedSelection = selection;
        return { kind: "cancel" };
      },
      announce() {},
      destroy() {},
    };
    const engine: TranslationEngine = {
      detectSource,
      translate,
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, menu, settings });

    await controller.openElementMenu(source);

    expect(detectSource).toHaveBeenCalledWith({
      text: "Bonjour",
      source: { kind: "auto", languageHint: "fr" },
    });
    expect(openedSelection?.detection).toEqual({
      kind: "detected",
      language: "fr",
      provenance: "lang",
    });
    expect(translate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
  });

  it("does not commit asynchronous inspection after the source changes", async () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const detection = deferredDetection();
    let openedSelection: ElementMenuSelection | undefined;
    const menu: ElementMenu = {
      async open(_anchor, selection): Promise<ElementMenuResult> {
        openedSelection = selection;
        return { kind: "cancel" };
      },
      announce() {},
      destroy() {},
    };
    const engine: TranslationEngine = {
      detectSource: vi.fn().mockReturnValue(detection.promise),
      translate: vi.fn(),
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, menu, settings });

    const pending = controller.openElementMenu(source);
    source.textContent = "Changed";
    detection.resolve({ kind: "detected", language: "en", provenance: "language-detector" });
    await pending;

    expect(openedSelection?.detection).toEqual({ kind: "not-detected" });
    expect(controller.store.getOrCreate(source).detection).toEqual({ kind: "not-detected" });
  });

  it("refreshes source text changed before menu inspection", async () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const detectSource = vi.fn().mockResolvedValue({
      kind: "detected",
      language: "fr",
      provenance: "language-detector",
    });
    const menu: ElementMenu = {
      async open(): Promise<ElementMenuResult> {
        return { kind: "cancel" };
      },
      announce() {},
      destroy() {},
    };
    const engine: TranslationEngine = {
      detectSource,
      translate: vi.fn(),
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, menu, settings });
    const record = controller.store.getOrCreate(source);
    source.textContent = " Bonjour ";

    await controller.openElementMenu(source);

    expect(detectSource).toHaveBeenCalledWith({
      text: "Bonjour",
      source: { kind: "auto" },
    });
    expect(record.detection).toEqual({
      kind: "detected",
      language: "fr",
      provenance: "language-detector",
    });
  });

  it("coalesces concurrent inspection for an unchanged source", async () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const detection = deferredDetection();
    const detectSource = vi.fn().mockReturnValue(detection.promise);
    const menu: ElementMenu = {
      async open(): Promise<ElementMenuResult> {
        return { kind: "cancel" };
      },
      announce() {},
      destroy() {},
    };
    const engine: TranslationEngine = {
      detectSource,
      translate: vi.fn(),
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, menu, settings });

    const first = controller.openElementMenu(source);
    const second = controller.openElementMenu(source);
    detection.resolve({ kind: "detected", language: "en", provenance: "language-detector" });
    await Promise.all([first, second]);

    expect(detectSource).toHaveBeenCalledTimes(1);
  });

  it("uses the same normalized eligible source text as translation", async () => {
    const source = document.createElement("p");
    source.append("  Hello\n ", document.createElement("code"), " world  ");
    const code = source.querySelector("code");
    if (code === null) throw new TypeError("Code fixture unavailable");
    code.textContent = "excluded";
    document.body.append(source);
    const detectSource = vi.fn().mockResolvedValue({ kind: "needs-confirmation" });
    const menu: ElementMenu = {
      async open(): Promise<ElementMenuResult> {
        return { kind: "cancel" };
      },
      announce() {},
      destroy() {},
    };
    const engine: TranslationEngine = {
      detectSource,
      translate: vi.fn(),
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, menu, settings });

    await controller.openElementMenu(source);

    expect(detectSource).toHaveBeenCalledWith({
      text: "Hello world",
      source: { kind: "auto" },
    });
  });
});
