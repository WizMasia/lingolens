import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type { TranslationEngine, TranslationResult } from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  DOMRect: { configurable: true, value: testWindow.DOMRect },
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  MutationObserver: { configurable: true, value: testWindow.MutationObserver },
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
});

const shadowRoots = new WeakMap<Element, ShadowRoot>();
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init): ShadowRoot {
  const shadow = attachShadow.call(this, init);
  shadowRoots.set(this, shadow);
  return shadow;
};

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

const translated = (): TranslationResult => ({
  kind: "translated",
  text: "안녕하세요",
  sourceLanguage: "en",
  targetLanguage: "ko",
  provenance: "language-detector",
});

const engine: TranslationEngine = {
  async detectSource() {
    return { kind: "detected", language: "en", provenance: "language-detector" };
  },
  async translate() {
    return translated();
  },
  async availability() {
    return "available";
  },
  destroy() {},
};

const flushMutations = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("stale page content", () => {
  beforeEach(() => document.body.replaceChildren());

  it("marks a translation stale and labels the existing result when page text changes", async () => {
    // Given
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translateTarget(source);

    // When
    source.firstChild?.replaceWith(document.createTextNode("Updated source"));
    await flushMutations();

    // Then
    expect(controller.store.getOrCreate(source).phase).toBe("stale");
    const block = document.querySelector<HTMLElement>('[data-local-translator-ui="inline"]');
    expect(block === null ? "" : shadowRoots.get(block)?.textContent).toContain(
      "원문이 변경되었습니다",
    );
  });

  it("marks only the nearest translated source stale when a nested source changes", async () => {
    // Given
    const outer = document.createElement("section");
    outer.append("Outer ");
    const inner = document.createElement("p");
    inner.textContent = "Inner";
    outer.append(inner);
    document.body.append(outer);
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translateTarget(outer);
    await controller.translateTarget(inner);

    // When
    inner.firstChild?.replaceWith(document.createTextNode("Updated inner source"));
    await flushMutations();

    // Then
    expect(controller.store.getOrCreate(inner).phase).toBe("stale");
    expect(controller.store.getOrCreate(outer).phase).toBe("translated");
  });

  it("ignores extension-owned UI changes", async () => {
    // Given
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    // When
    await controller.translateTarget(source);
    await flushMutations();

    // Then
    expect(controller.store.getOrCreate(source).phase).toBe("translated");
  });

  it("removes disconnected records from the active set", async () => {
    // Given
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translateTarget(source);

    // When
    source.remove();
    await flushMutations();

    // Then
    expect(controller.store.active).toHaveLength(0);
  });

  it("observes active records inside an open shadow root", async () => {
    // Given
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const source = document.createElement("p");
    source.textContent = "Hello";
    shadow.append(source);
    document.body.append(host);
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translateTarget(source);

    // When
    source.textContent = "Shadow update";
    await flushMutations();

    // Then
    expect(controller.store.getOrCreate(source).phase).toBe("stale");
  });

  it("observes a shadow-root record added after observation begins", async () => {
    // Given
    const initial = document.createElement("p");
    initial.textContent = "Initial";
    document.body.append(initial);
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translateTarget(initial);

    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const source = document.createElement("p");
    source.textContent = "Hello";
    shadow.append(source);
    document.body.append(host);
    await controller.translateTarget(source);

    // When
    source.textContent = "Shadow update";
    await flushMutations();

    // Then
    expect(controller.store.getOrCreate(source).phase).toBe("stale");
  });

  it("restores an active hover replacement before checking the source fingerprint", async () => {
    // Given
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const controller = createTranslationController({
      document,
      engine,
      settings: { ...SETTINGS, displayMode: "hover" },
    });
    await controller.translateTarget(source);
    source.dispatchEvent(new Event("pointerenter"));
    await flushMutations();

    // When
    await flushMutations();

    // Then
    expect(source.textContent).toBe("안녕하세요");
    expect(controller.store.getOrCreate(source).phase).toBe("translated");
  });

  it("keeps hover translation available after an unchanged source mutation", async () => {
    // Given
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const controller = createTranslationController({
      document,
      engine,
      settings: { ...SETTINGS, displayMode: "hover" },
    });
    await controller.translateTarget(source);
    source.dispatchEvent(new Event("pointerenter"));
    source.append(document.createElement("span"));
    await flushMutations();

    // When
    source.dispatchEvent(new Event("pointerleave"));
    source.dispatchEvent(new Event("pointerenter"));

    // Then
    expect(source.textContent).toBe("안녕하세요");
    expect(controller.store.getOrCreate(source).phase).toBe("translated");
  });

  it("preserves a page-owned hover change and does not observe its own restoration", async () => {
    // Given
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const controller = createTranslationController({
      document,
      engine,
      settings: { ...SETTINGS, displayMode: "hover" },
    });
    await controller.translateTarget(source);
    source.dispatchEvent(new Event("pointerenter"));
    await flushMutations();

    // When
    const activeText = source.firstChild;
    if (!(activeText instanceof Text)) throw new Error("fixture text missing");
    activeText.data = "Page update";
    await flushMutations();
    await flushMutations();

    // Then
    expect(source.textContent).toBe("Page update");
    expect(controller.store.getOrCreate(source).phase).toBe("stale");
  });

  it("uses changed source text on the next explicit page run", async () => {
    // Given
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const requests: string[] = [];
    const recordingEngine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        requests.push(request.text);
        return translated();
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({
      document,
      engine: recordingEngine,
      settings: SETTINGS,
    });
    await controller.translatePage();
    source.textContent = "Updated source";
    await flushMutations();

    // When
    await controller.translatePage();

    // Then
    expect(requests).toEqual(["Hello", "Updated source"]);
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(1);
  });

  it("restorePage restores active hover text synchronously", async () => {
    // Given
    const source = document.createElement("p");
    source.textContent = "Hello";
    document.body.append(source);
    const controller = createTranslationController({
      document,
      engine,
      settings: { ...SETTINGS, displayMode: "hover" },
    });
    await controller.translateTarget(source);
    source.dispatchEvent(new Event("pointerenter"));

    // When
    controller.restorePage();

    // Then
    expect(source.textContent).toBe("Hello");
    expect(controller.store.active).toHaveLength(0);
  });
});
