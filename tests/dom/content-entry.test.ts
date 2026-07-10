import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationController } from "../../src/content/controller";
import { createContentApp, eventElement, productionLanguages } from "../../src/content/index";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  DOMRect: { configurable: true, value: testWindow.DOMRect },
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  HTMLInputElement: { configurable: true, value: testWindow.HTMLInputElement },
  KeyboardEvent: { configurable: true, value: testWindow.KeyboardEvent },
  Node: { configurable: true, value: testWindow.Node },
  NodeFilter: { configurable: true, value: testWindow.NodeFilter },
  PointerEvent: { configurable: true, value: testWindow.PointerEvent },
  document: { configurable: true, value: testWindow.document },
});

Object.defineProperty(testWindow.HTMLElement.prototype, "getClientRects", {
  configurable: true,
  value: () => [new testWindow.DOMRect(0, 0, 100, 20)],
});
Object.defineProperty(testWindow, "getComputedStyle", {
  configurable: true,
  value: () => ({ display: "block", opacity: "", visibility: "visible" }),
});
Object.defineProperty(globalThis, "getComputedStyle", {
  configurable: true,
  value: testWindow.getComputedStyle.bind(testWindow),
});

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
};

const controllerFixture = (): TranslationController => ({
  settings: SETTINGS,
  store: {
    active: new Set(),
    getOrCreate: vi.fn(),
    has: vi.fn(),
    markStale: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
  setHovered: vi.fn(),
  translateTarget: vi.fn().mockResolvedValue(undefined),
  translatePage: vi.fn().mockResolvedValue(undefined),
  restorePage: vi.fn(),
  getState: vi
    .fn()
    .mockReturnValue({ phase: "idle", completed: 0, total: 0, skipped: 0, failed: 0 }),
  retranslate: vi.fn().mockResolvedValue(undefined),
  openElementMenu: vi.fn().mockResolvedValue(undefined),
  restoreElement: vi.fn(),
  applySettings: vi.fn(),
  destroy: vi.fn(),
});

describe("content entry", () => {
  beforeEach(() => document.body.replaceChildren());

  it("tracks a hovered target and translates it with Control", async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Meaningful text to translate";
    document.body.append(paragraph);
    const controller = controllerFixture();
    createContentApp(document, { controller, loadSettings: async () => SETTINGS });
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    await Promise.resolve();
    expect(controller.translateTarget).toHaveBeenCalledOnce();
  });

  it("opens an element menu for a hovered target with Alt plus Control without translating", async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Meaningful text to translate";
    document.body.append(paragraph);
    const controller = controllerFixture();
    createContentApp(document, { controller, loadSettings: async () => SETTINGS });
    paragraph.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(controller.setHovered).toHaveBeenCalledWith(paragraph);
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Control",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      }),
    );
    await Promise.resolve();

    expect(controller.openElementMenu).toHaveBeenCalledWith(paragraph);
    expect(controller.translateTarget).not.toHaveBeenCalled();
  });

  it("tracks the composed shadow target instead of the retargeted host", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const paragraph = document.createElement("p");
    paragraph.textContent = "Shadow text to translate";
    shadow.append(paragraph);
    document.body.append(host);
    expect(
      eventElement({
        target: host,
        composedPath: () => [paragraph, shadow, host, document],
      }),
    ).toBe(paragraph);
  });

  it("ignores configured keys originating from editable fields", async () => {
    const input = document.createElement("input");
    document.body.append(input);
    const controller = controllerFixture();
    createContentApp(document, { controller, loadSettings: async () => SETTINGS });
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    await Promise.resolve();
    expect(controller.translateTarget).not.toHaveBeenCalled();
  });

  it("routes runtime commands and reapplies stored settings", async () => {
    const controller = controllerFixture();
    const hoverSettings: Settings = { ...SETTINGS, displayMode: "hover" };
    const app = createContentApp(document, {
      controller,
      loadSettings: async () => hoverSettings,
    });
    await app.handleMessage({ type: "translate-page" });
    app.handleMessage({ type: "restore-page" });
    await app.handleMessage({ type: "settings-changed" });
    expect(controller.translatePage).toHaveBeenCalledOnce();
    expect(controller.restorePage).toHaveBeenCalledOnce();
    expect(controller.applySettings).toHaveBeenCalledWith(hoverSettings);
  });

  it("provides the production controller with the full language catalog", () => {
    const languages = productionLanguages();
    expect(languages.length).toBeGreaterThan(10);
    expect(languages).toContainEqual({ value: "ja", label: "일본어" });
  });
});
