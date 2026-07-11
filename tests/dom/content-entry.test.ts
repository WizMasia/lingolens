import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationController } from "../../src/content/controller";
import {
  type ContentApp,
  createContentApp,
  eventElement,
  productionLanguages,
} from "../../src/content/index";
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
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

const controllerFixture = (settings: Settings = SETTINGS): TranslationController => ({
  settings,
  store: {
    active: new Set(),
    getOrCreate: vi.fn(),
    has: vi.fn(),
    markStale: vi.fn(),
    restoreTranslation: vi.fn(),
    restoreAllTranslations: vi.fn(),
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

const apps: ContentApp[] = [];

const createTestContentApp = (
  controller: TranslationController,
  settings: Settings = SETTINGS,
): ContentApp => {
  const app = createContentApp(document, {
    controller,
    loadSettings: async () => settings,
    isTrustedEvent: () => true,
  });
  apps.push(app);
  return app;
};

describe("content entry", () => {
  beforeEach(() => {
    for (const app of apps.splice(0)) app.destroy();
    document.body.replaceChildren();
  });

  it("tracks a hovered target and translates it with Control", async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Meaningful text to translate";
    document.body.append(paragraph);
    const controller = controllerFixture();
    createTestContentApp(controller);
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    expect(controller.translateTarget).not.toHaveBeenCalled();
    paragraph.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));
    await Promise.resolve();
    expect(controller.translateTarget).toHaveBeenCalledOnce();
  });

  it("opens an element menu with Control then Shift without translating", async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Meaningful text to translate";
    document.body.append(paragraph);
    const controller = controllerFixture();
    createTestContentApp(controller);
    paragraph.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(controller.setHovered).toHaveBeenCalledWith(paragraph);
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Control",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Shift",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    paragraph.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Shift", ctrlKey: true, bubbles: true }),
    );
    await Promise.resolve();

    expect(controller.openElementMenu).toHaveBeenCalledWith(paragraph);
    expect(controller.translateTarget).not.toHaveBeenCalled();
  });

  it("opens an element menu with Shift then Control without translating", async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Meaningful text to translate";
    document.body.append(paragraph);
    const controller = controllerFixture();
    createTestContentApp(controller);
    paragraph.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Shift", shiftKey: true, bubbles: true }),
    );
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Control",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    paragraph.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Control", shiftKey: true, bubbles: true }),
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
    createTestContentApp(controller);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    await Promise.resolve();
    expect(controller.translateTarget).not.toHaveBeenCalled();
  });

  it("routes runtime commands and reapplies stored settings", async () => {
    const controller = controllerFixture();
    const hoverSettings: Settings = { ...SETTINGS, displayMode: "hover" };
    const app = createTestContentApp(controller, hoverSettings);
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

  it("arbitrates swapped modifier prefixes without dispatching both actions", async () => {
    const swapped: Settings = {
      ...SETTINGS,
      trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
      menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
    };
    const paragraph = document.createElement("p");
    paragraph.textContent = "Meaningful text to translate";
    document.body.append(paragraph);
    const controller = controllerFixture(swapped);
    createTestContentApp(controller, swapped);
    paragraph.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    expect(controller.openElementMenu).not.toHaveBeenCalled();
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Shift",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    paragraph.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Shift", ctrlKey: true, bubbles: true }),
    );
    await Promise.resolve();

    expect(controller.translateTarget).toHaveBeenCalledOnce();
    expect(controller.openElementMenu).not.toHaveBeenCalled();
  });

  it("ignores untrusted page-generated shortcut events", async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Meaningful text to translate";
    document.body.append(paragraph);
    const controller = controllerFixture();
    const app = createContentApp(document, { controller, loadSettings: async () => SETTINGS });
    apps.push(app);
    paragraph.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    paragraph.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));
    await Promise.resolve();

    expect(controller.translateTarget).not.toHaveBeenCalled();
    expect(controller.openElementMenu).not.toHaveBeenCalled();
  });

  it("does not let an untrusted keyup cancel a pending trusted shortcut", async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Meaningful text to translate";
    document.body.append(paragraph);
    const controller = controllerFixture();
    const untrustedKeyUp = new KeyboardEvent("keyup", { key: "Control", bubbles: true });
    const app = createContentApp(document, {
      controller,
      loadSettings: async () => SETTINGS,
      isTrustedEvent: (event) => event !== untrustedKeyUp,
    });
    apps.push(app);
    paragraph.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    paragraph.dispatchEvent(untrustedKeyUp);
    paragraph.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));
    await Promise.resolve();

    expect(controller.translateTarget).toHaveBeenCalledOnce();
  });
});
