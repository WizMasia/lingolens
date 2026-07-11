import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationEngine } from "../../src/content/ai-engine";
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

const settings: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

describe("element menu restoration", () => {
  beforeEach(() => document.body.replaceChildren());

  it("retains automatic provenance after restoring an element", () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const engine: TranslationEngine = {
      detectSource: vi.fn(),
      translate: vi.fn(),
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings });
    const record = controller.store.getOrCreate(source);
    record.setDetection({
      kind: "detected",
      language: "en",
      provenance: "language-detector",
    });

    controller.restoreElement(source);
    const restoredRecord = controller.store.getOrCreate(source);

    expect(restoredRecord).toBe(record);
    expect(restoredRecord.detection).toEqual({
      kind: "detected",
      language: "en",
      provenance: "language-detector",
    });
  });

  it("invalidates retained evidence when restored source changes before menu open", async () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const detectSource = vi.fn().mockResolvedValue({
      kind: "detected",
      language: "fr",
      provenance: "chrome-i18n",
    });
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
      translate: vi.fn(),
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, menu, settings });
    const record = controller.store.getOrCreate(source);
    record.setDetection({
      kind: "detected",
      language: "en",
      provenance: "language-detector",
    });
    controller.restoreElement(source);
    source.textContent = " Bonjour ";

    await controller.openElementMenu(source);

    expect(detectSource).toHaveBeenCalledWith({ text: "Bonjour", source: { kind: "auto" } });
    expect(openedSelection?.detection).toEqual({
      kind: "detected",
      language: "fr",
      provenance: "chrome-i18n",
    });
  });
});
