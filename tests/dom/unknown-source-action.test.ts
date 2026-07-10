import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import type { TranslationEngine } from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import type { ElementMenu, ElementMenuResult } from "../../src/content/element-menu";
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

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

describe("unknown source action", () => {
  it("offers language selection after the first automatic detection fails", async () => {
    const source = document.createElement("p");
    source.textContent = "Brief";
    document.body.append(source);
    let opened = 0;
    const menu: ElementMenu = {
      async open(): Promise<ElementMenuResult> {
        opened += 1;
        return { kind: "cancel" };
      },
      announce() {},
      destroy() {},
    };
    const engine: TranslationEngine = {
      async translate() {
        return { kind: "unknown-source" };
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const roots = new WeakMap<HTMLElement, ShadowRoot>();
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init): ShadowRoot {
      const root = attachShadow.call(this, init);
      if (this instanceof HTMLElement) roots.set(this, root);
      return root;
    };
    const controller = createTranslationController({ document, engine, menu, settings: SETTINGS });

    await controller.translateTarget(source);
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="inline-error"]');
    const text = host === null ? "" : (roots.get(host)?.textContent ?? "");
    roots
      .get(host ?? document.body)
      ?.querySelector<HTMLButtonElement>("button")
      ?.click();
    await Promise.resolve();

    expect(text).toContain("원문 언어를 확인할 수 없습니다.");
    expect(opened).toBe(1);
  });

  it("retries a hover-mode error with the primary trigger and opens language selection explicitly", async () => {
    const source = document.createElement("p");
    source.textContent = "Brief";
    document.body.append(source);
    let opened = 0;
    const menu: ElementMenu = {
      async open(): Promise<ElementMenuResult> {
        opened += 1;
        return { kind: "cancel" };
      },
      announce() {},
      destroy() {},
    };
    let attempts = 0;
    const engine: TranslationEngine = {
      async translate() {
        attempts += 1;
        return { kind: "unknown-source" };
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({
      document,
      engine,
      menu,
      settings: { ...SETTINGS, displayMode: "hover" },
    });

    await controller.translateTarget(source);
    await controller.translateTarget(source);
    await controller.openElementMenu(source);

    expect(attempts).toBe(2);
    expect(opened).toBe(1);
    expect(document.querySelector('[data-local-translator-ui="hover"]')).toBeNull();
  });
});
