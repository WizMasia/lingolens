import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  TranslationEngine,
  TranslationRequest,
  TranslationResult,
} from "../../src/content/ai-engine";
import { TranslationError } from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  DOMRect: { configurable: true, value: testWindow.DOMRect },
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
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

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

const translated = (text: string): TranslationResult => ({
  kind: "translated",
  text,
  sourceLanguage: "en",
  targetLanguage: "ko",
  provenance: "language-detector",
});

const deferred = <T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> => {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
};

const addSources = (...texts: readonly string[]): readonly HTMLElement[] =>
  texts.map((text) => {
    const source = document.createElement("p");
    source.textContent = text;
    document.body.append(source);
    return source;
  });

const flushMutations = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const appendLiveChatMessage = (items: HTMLElement, text: string): HTMLElement => {
  const renderer = document.createElement("yt-live-chat-text-message-renderer");
  const message = document.createElement("span");
  message.id = "message";
  message.textContent = text;
  renderer.append(message);
  items.append(renderer);
  return message;
};

const createLiveChat = (): HTMLElement => {
  const listRenderer = document.createElement("yt-live-chat-item-list-renderer");
  const items = document.createElement("div");
  items.id = "items";
  listRenderer.append(items);
  document.body.append(listRenderer);
  return items;
};

describe("full-page controller", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    testWindow.location.href = "https://example.test/";
  });

  it("renders live chat translations on hover and stops them on restoration", async () => {
    // Given
    testWindow.location.href = "https://www.youtube.com/live_chat?v=fixture";
    const items = createLiveChat();
    const first = appendLiveChatMessage(items, "First");
    const requests: string[] = [];
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        requests.push(request.text);
        return translated(`번역:${request.text}`);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    // When
    await controller.startLiveChat();
    await flushMutations();

    // Then
    expect(requests).toEqual(["First"]);
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    controller.applySettings({ ...SETTINGS, displayMode: "hover" });
    controller.applySettings(SETTINGS);
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    first.dispatchEvent(new Event("pointerenter"));
    expect(first.textContent).toBe("번역:First");
    first.dispatchEvent(new Event("pointerleave"));
    expect(first.textContent).toBe("First");
    first.textContent = "Updated";
    await flushMutations();
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    expect(first.textContent).toBe("Updated");
    first.dispatchEvent(new Event("pointerenter"));
    expect(first.textContent).toBe("Updated");

    // When
    appendLiveChatMessage(items, "Second");
    await flushMutations();

    // Then
    expect(requests).toEqual(["First", "Second"]);

    // When
    controller.restorePage();
    appendLiveChatMessage(items, "Third");
    await flushMutations();

    // Then
    expect(requests).toEqual(["First", "Second"]);
  });

  it("reports partial failure while allowing successful peers to finish", async () => {
    // Given
    addSources("First", "Broken", "Third");
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        if (request.text === "Broken") {
          throw new TranslationError("translation-failed", "fixture");
        }
        return translated(`번역:${request.text}`);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    // When
    await controller.translatePage();

    // Then
    expect(controller.getState()).toEqual({
      phase: "complete",
      completed: 3,
      total: 3,
      skipped: 0,
      failed: 1,
    });
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(2);
  });

  it("cancels a prior run before its queued elements start", async () => {
    // Given
    addSources("One", "Two", "Three", "Four");
    const gate = deferred<TranslationResult>();
    const requests: TranslationRequest[] = [];
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      translate(request) {
        requests.push(request);
        return requests.length <= 3 ? gate.promise : Promise.resolve(translated(request.text));
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    const first = controller.translatePage();
    await Promise.resolve();

    // When
    const second = controller.translatePage();
    gate.resolve(translated("old"));
    await Promise.all([first, second]);

    // Then
    expect(requests.map(({ text }) => text)).toEqual([
      "One",
      "Two",
      "Three",
      "One",
      "Two",
      "Three",
      "Four",
    ]);
    expect(controller.getState().phase).toBe("complete");
  });

  it("restores synchronously and prevents an active translation from rendering later", async () => {
    // Given
    addSources("One");
    const gate = deferred<TranslationResult>();
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      translate: () => gate.promise,
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    const pending = controller.translatePage();
    await Promise.resolve();

    // When
    controller.restorePage();

    // Then
    expect(controller.getState().phase).toBe("idle");
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    gate.resolve(translated("late"));
    await pending;
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
  });

  it("retains automatic detection evidence across full-page restoration", async () => {
    const [source] = addSources("One");
    if (source === undefined) throw new TypeError("Fixture source unavailable");
    const requests: TranslationRequest[] = [];
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        requests.push(request);
        return translated(request.text);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translatePage();

    controller.restorePage();
    await controller.translatePage();

    expect(requests[1]?.source).toMatchObject({
      kind: "auto",
      knownDetection: {
        kind: "detected",
        language: "en",
        provenance: "language-detector",
      },
    });
  });

  it("does not publish tab state while the content app is shutting down", () => {
    const states: string[] = [];
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate() {
        return translated("unused");
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({
      document,
      engine,
      settings: SETTINGS,
      onState(state) {
        states.push(state.phase);
      },
    });

    controller.destroy();

    expect(states).toEqual([]);
    expect(controller.getState().phase).toBe("idle");
  });

  it("does not resurrect a pending retranslation after page restoration", async () => {
    // Given
    const [source] = addSources("One");
    if (source === undefined) throw new Error("fixture source missing");
    const gate = deferred<TranslationResult>();
    let calls = 0;
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      translate(request) {
        calls += 1;
        return calls === 1 ? Promise.resolve(translated(request.text)) : gate.promise;
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translateTarget(source);
    const pending = controller.retranslate(source, { source: "auto", target: "ko" });
    await Promise.resolve();

    // When
    controller.restorePage();
    gate.resolve(translated("late"));
    await pending;

    // Then
    expect(controller.store.active).toHaveLength(0);
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    source.textContent = "Updated after restore";
    await Promise.resolve();
    expect(controller.store.active).toHaveLength(0);
  });

  it("updates existing blocks without duplication and captures new content on only the next run", async () => {
    // Given
    addSources("First");
    let pass = 0;
    const requests: string[] = [];
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        requests.push(request.text);
        return translated(`${pass}:${request.text}`);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translatePage();
    const added = addSources("Added")[0];
    if (added === undefined) throw new Error("fixture source missing");

    // When
    pass = 1;
    await controller.translatePage();

    // Then
    expect(requests).toEqual(["First", "First", "Added"]);
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(2);
  });
});
