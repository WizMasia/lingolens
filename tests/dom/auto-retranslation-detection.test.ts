import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import type { TranslationEngine } from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
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
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

describe("automatic retranslation detection", () => {
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
