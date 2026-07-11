import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import {
  type AiAdapter,
  createTranslationEngine,
  type TranslationEngine,
} from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import type { ElementMenu, ElementMenuResult } from "../../src/content/element-menu";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: testWindow.Element },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  Node: { configurable: true, value: testWindow.Node },
  NodeFilter: { configurable: true, value: testWindow.NodeFilter },
  ShadowRoot: { configurable: true, value: testWindow.ShadowRoot },
  Text: { configurable: true, value: testWindow.Text },
  document: { configurable: true, value: testWindow.document },
});
Object.defineProperty(testWindow.HTMLElement.prototype, "getClientRects", {
  configurable: true,
  value: () => [new testWindow.DOMRect(0, 0, 100, 20)],
});

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  liveChatNanoEnabled: false,
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

describe("automatic retranslation detection", () => {
  it("reuses inspection evidence for translation and after element restoration", async () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const detect = vi.fn().mockResolvedValue([{ detectedLanguage: "en", confidence: 0.9 }]);
    const adapter: AiAdapter = {
      detect,
      detectWithChrome: vi.fn().mockResolvedValue(undefined),
      availability: vi.fn().mockResolvedValue("available"),
      createTranslator: vi.fn().mockResolvedValue({
        translate: vi.fn().mockResolvedValue("Bonjour"),
        destroy() {},
      }),
      destroy() {},
    };
    const engine = createTranslationEngine(adapter);
    const menu: ElementMenu = {
      async open(): Promise<ElementMenuResult> {
        return { kind: "cancel" };
      },
      announce() {},
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, menu, settings: SETTINGS });

    await controller.openElementMenu(source);
    await controller.retranslate(source, { source: "auto", target: "fr" });
    controller.restoreElement(source);
    await controller.retranslate(source, { source: "auto", target: "fr" });

    expect(detect).toHaveBeenCalledTimes(1);
    expect(controller.store.getOrCreate(source).detection).toEqual({
      kind: "detected",
      language: "en",
      provenance: "language-detector",
    });
  });

  it("invalidates automatic evidence when source text changes", async () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const requests: string[] = [];
    const engine: TranslationEngine = {
      async detectSource(request) {
        requests.push(request.text);
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        requests.push(request.text);
        return { kind: "skipped", sourceLanguage: "en", provenance: "language-detector" };
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const menu: ElementMenu = {
      async open(): Promise<ElementMenuResult> {
        return { kind: "cancel" };
      },
      announce() {},
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, menu, settings: SETTINGS });
    await controller.openElementMenu(source);
    source.textContent = "Changed";

    await controller.retranslate(source, { source: "auto", target: "fr" });

    expect(requests).toEqual(["Hello", "Changed"]);
  });
  it("retains committed provenance after a successful automatic retranslation", async () => {
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "chrome-i18n" };
      },
      async translate(request) {
        return {
          kind: "translated",
          text: "Bonjour",
          sourceLanguage: "en",
          targetLanguage: request.target,
          provenance: "chrome-i18n",
        };
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    await controller.retranslate(source, { source: "auto", target: "fr" });

    expect(controller.store.getOrCreate(source).detection).toEqual({
      kind: "detected",
      language: "en",
      provenance: "chrome-i18n",
    });
  });
});
