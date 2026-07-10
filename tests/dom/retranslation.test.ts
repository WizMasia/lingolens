import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  TranslationEngine,
  TranslationRequest,
  TranslationResult,
} from "../../src/content/ai-engine";
import { TranslationError } from "../../src/content/ai-engine";
import {
  createTranslationController,
  type ElementLanguageChoice,
} from "../../src/content/controller";
import {
  createElementMenu,
  type ElementMenu,
  type ElementMenuResult,
} from "../../src/content/element-menu";
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

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

const LANGUAGES: readonly ElementLanguageChoice[] = [
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
];

const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init): ShadowRoot {
  const root = attachShadow.call(this, init);
  if (this instanceof HTMLElement) shadowRoots.set(this, root);
  return root;
};

const inlineText = (): string => {
  const host = document.querySelector<HTMLElement>('[data-local-translator-ui="inline"]');
  return host === null ? "" : (shadowRoots.get(host)?.textContent ?? "");
};

const sourceFixture = (): HTMLElement => {
  const source = document.createElement("p");
  source.textContent = "Hello";
  document.body.append(source);
  return source;
};

const result = (text: string, targetLanguage: string): TranslationResult => ({
  kind: "translated",
  text,
  sourceLanguage: "en",
  targetLanguage,
});

describe("per-element retranslation", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("replaces the prior result without changing global settings", async () => {
    // Given
    const source = sourceFixture();
    const requests: TranslationRequest[] = [];
    const engine: TranslationEngine = {
      async translate(request) {
        requests.push(request);
        return requests.length === 1 ? result("안녕하세요", "ko") : result("こんにちは", "ja");
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    let settings = SETTINGS;
    const controller = createTranslationController({ document, engine, settings });

    // When
    await controller.translateTarget(source);
    await controller.retranslate(source, { source: "en", target: "ja" });
    settings = controller.settings;

    // Then
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(1);
    expect(inlineText()).toContain("こんにちは");
    expect(settings.target).toEqual({ kind: "browser", resolvedLanguage: "ko" });
    expect(requests[1]?.source).toEqual({ kind: "fixed", language: "en" });
  });

  it("focuses the first select and Escape cancels while restoring focus", async () => {
    // Given
    const source = sourceFixture();
    source.tabIndex = 0;
    source.focus();
    const menu = createElementMenu(document, LANGUAGES);

    // When
    const pending = menu.open(source, { source: "auto", target: "ko" });
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="element-menu"]');
    if (host === null) throw new Error("fixture menu missing");
    const shadow = shadowRoots.get(host);
    const sourceSelect = shadow?.querySelector<HTMLSelectElement>('select[name="source"]');
    expect(shadow?.activeElement).toBe(sourceSelect);
    sourceSelect?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // Then
    await expect(pending).resolves.toEqual({ kind: "cancel" });
    expect(document.activeElement).toBe(source);
    expect(sourceSelect).not.toBeUndefined();
  });

  it("cancels on a key-shaped Escape event", async () => {
    // Given
    const source = sourceFixture();
    source.tabIndex = 0;
    source.focus();
    const menu = createElementMenu(document, LANGUAGES);
    const pending = menu.open(source, { source: "auto", target: "ko" });
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="element-menu"]');
    if (host === null) throw new Error("fixture menu missing");
    const sourceSelect = shadowRoots
      .get(host)
      ?.querySelector<HTMLSelectElement>('select[name="source"]');
    if (sourceSelect === null || sourceSelect === undefined) {
      throw new Error("fixture source select missing");
    }
    const escapeEvent = new Event("keydown", { bubbles: true });
    Object.defineProperty(escapeEvent, "key", { value: "Escape" });

    // When
    sourceSelect.dispatchEvent(escapeEvent);
    const remainingHost = document.querySelector('[data-local-translator-ui="element-menu"]');
    menu.destroy();

    // Then
    await expect(pending).resolves.toEqual({ kind: "cancel" });
    expect(remainingHost).toBeNull();
    expect(document.activeElement).toBe(source);
  });

  it("renders the menu in a fixed body overlay without inserting beside the source", async () => {
    // Given
    const container = document.createElement("section");
    const source = document.createElement("p");
    source.textContent = "Hello";
    container.append(source);
    document.body.append(container);
    const menu = createElementMenu(document, LANGUAGES);

    // When
    const pending = menu.open(source, { source: "auto", target: "ko" });
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="element-menu"]');

    // Then
    expect(document.body.lastElementChild).toBe(host);
    expect(host?.style.position).toBe("fixed");
    expect(source.nextElementSibling).toBeNull();

    menu.destroy();
    await expect(pending).resolves.toEqual({ kind: "cancel" });
  });

  it("shows the detected source language after a successful translation", async () => {
    // Given
    const source = sourceFixture();
    const engine: TranslationEngine = {
      async translate() {
        return result("안녕하세요", "ko");
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({
      document,
      engine,
      languages: LANGUAGES,
      settings: SETTINGS,
    });
    await controller.translateTarget(source);

    // When
    const pending = controller.openElementMenu(source);
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="element-menu"]');
    const menuText = host === null ? "" : (shadowRoots.get(host)?.textContent ?? "");

    // Then
    expect(menuText).toContain("Detected source: English");

    controller.destroy();
    await pending;
  });

  it("shows an unknown detected source before the element has a successful translation", async () => {
    // Given
    const source = sourceFixture();
    const engine: TranslationEngine = {
      async translate() {
        return result("안녕하세요", "ko");
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({
      document,
      engine,
      languages: LANGUAGES,
      settings: SETTINGS,
    });

    // When
    const pending = controller.openElementMenu(source);
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="element-menu"]');
    const menuText = host === null ? "" : (shadowRoots.get(host)?.textContent ?? "");

    // Then
    expect(menuText).toContain("Detected source: Unknown");

    controller.destroy();
    await pending;
  });

  it("cancels when a pointer interaction occurs outside the menu overlay", async () => {
    // Given
    const source = sourceFixture();
    const menu = createElementMenu(document, LANGUAGES);
    const pending = menu.open(source, { source: "auto", target: "ko" });

    // When
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));

    // Then
    await expect(pending).resolves.toEqual({ kind: "cancel" });
    expect(document.querySelector('[data-local-translator-ui="element-menu"]')).toBeNull();
  });

  it("returns an explicit language pair from native selects", async () => {
    // Given
    const source = sourceFixture();
    const menu = createElementMenu(document, LANGUAGES);
    const pending = menu.open(source, { source: "auto", target: "ko" });
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="element-menu"]');
    if (host === null) throw new Error("fixture menu missing");
    const shadow = shadowRoots.get(host);
    const sourceSelect = shadow?.querySelector<HTMLSelectElement>('select[name="source"]');
    const targetSelect = shadow?.querySelector<HTMLSelectElement>('select[name="target"]');
    const submit = shadow?.querySelector<HTMLButtonElement>('button[data-action="translate"]');
    if (
      sourceSelect === null ||
      sourceSelect === undefined ||
      targetSelect === null ||
      targetSelect === undefined ||
      submit === null ||
      submit === undefined
    ) {
      throw new Error("fixture controls missing");
    }
    sourceSelect.value = "en";
    targetSelect.value = "ja";

    // When
    submit.click();

    // Then
    await expect(pending).resolves.toEqual({ kind: "translate", source: "en", target: "ja" });
  });

  it("excludes Auto from targets and deduplicates the source Auto option", async () => {
    // Given
    const source = sourceFixture();
    const menu = createElementMenu(document, [
      { value: "auto", label: "Duplicate Auto" },
      { value: "en", label: "English" },
      { value: "en", label: "English duplicate" },
      { value: "ko", label: "Korean" },
    ]);
    const pending = menu.open(source, { source: "auto", target: "ko" });
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="element-menu"]');
    if (host === null) throw new Error("fixture menu missing");
    const shadow = shadowRoots.get(host);
    const sourceOptions = shadow?.querySelector<HTMLSelectElement>('select[name="source"]');
    const targetOptions = shadow?.querySelector<HTMLSelectElement>('select[name="target"]');

    // When
    menu.destroy();

    // Then
    await expect(pending).resolves.toEqual({ kind: "cancel" });
    expect([...(sourceOptions?.options ?? [])].map(({ value }) => value)).toEqual([
      "auto",
      "en",
      "ko",
    ]);
    expect([...(targetOptions?.options ?? [])].map(({ value }) => value)).toEqual(["en", "ko"]);
  });

  it("keeps the last successful text and announces a typed failure", async () => {
    // Given
    const source = sourceFixture();
    let attempt = 0;
    const engine: TranslationEngine = {
      async translate() {
        attempt += 1;
        if (attempt === 1) return result("안녕하세요", "ko");
        throw new TranslationError("pair-unavailable", "internal detail");
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translateTarget(source);

    // When
    await controller.retranslate(source, { source: "en", target: "ja" });

    // Then
    expect(inlineText()).toContain("안녕하세요");
    expect(inlineText()).not.toContain("internal detail");
    expect(inlineText()).toContain("선택한 언어 쌍은 사용할 수 없습니다.");
    const announcer = document.querySelector<HTMLElement>('[data-local-translator-ui="announcer"]');
    expect(announcer === null ? "" : shadowRoots.get(announcer)?.textContent).toContain(
      "선택한 언어 쌍은 사용할 수 없습니다.",
    );
  });

  it("announces unknown source locally while preserving the last success", async () => {
    // Given
    const source = sourceFixture();
    let attempt = 0;
    const engine: TranslationEngine = {
      async translate() {
        attempt += 1;
        return attempt === 1 ? result("안녕하세요", "ko") : { kind: "unknown-source" };
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const announcements: string[] = [];
    const notices: string[] = [];
    const menu: ElementMenu = {
      async open(): Promise<ElementMenuResult> {
        return { kind: "cancel" };
      },
      announce(message) {
        announcements.push(message);
      },
      destroy() {},
    };
    const controller = createTranslationController({
      document,
      engine,
      menu,
      notice: (message) => notices.push(message),
      settings: SETTINGS,
    });
    await controller.translateTarget(source);

    // When
    await controller.retranslate(source, { source: "auto", target: "ja" });

    // Then
    expect(inlineText()).toContain("안녕하세요");
    expect(announcements).toEqual(["원문 언어를 확인할 수 없습니다."]);
    expect(notices).toEqual([]);
  });

  it("restores the element and clears its language override", async () => {
    // Given
    const source = sourceFixture();
    const engine: TranslationEngine = {
      async translate() {
        return result("안녕하세요", "ko");
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translateTarget(source);
    await controller.retranslate(source, { source: "en", target: "ja" });

    // When
    controller.restoreElement(source);

    // Then
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(0);
    expect(controller.store.getOrCreate(source).languageOverride).toBeNull();
  });
});
