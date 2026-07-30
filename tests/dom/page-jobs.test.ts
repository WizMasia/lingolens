import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  TranslationEngine,
  TranslationRequest,
  TranslationResult,
} from "../../src/content/ai-engine";
import { TranslationError } from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import { createLiveChatSessionController } from "../../src/content/live-chat-session-controller";
import { createRecordStore } from "../../src/content/records";
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
  liveChatNanoEnabled: false,
  pdfTranslationEnabled: true,
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

const appendLiveChatMessage = (items: HTMLElement, text: string, author?: string): HTMLElement => {
  const renderer = document.createElement("yt-live-chat-text-message-renderer");
  if (author !== undefined) {
    const authorName = document.createElement("a");
    authorName.id = "author-name";
    authorName.href = author;
    renderer.append(authorName);
  }
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

  it("restores a hovered live-chat message when the frame restores", async () => {
    // Given
    testWindow.location.href = "https://www.youtube.com/live_chat?v=fixture";
    const items = createLiveChat();
    const message = appendLiveChatMessage(items, "First");
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        return translated(`번역:${request.text}`);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.startLiveChat();
    await flushMutations();
    message.dispatchEvent(new Event("pointerenter"));
    expect(message.textContent).toBe("번역:First");

    // When
    controller.restorePage();

    // Then
    expect(message.textContent).toBe("First");
    message.dispatchEvent(new Event("pointerleave"));
    message.dispatchEvent(new Event("pointerenter"));
    expect(message.textContent).toBe("First");
  });

  it("reuses a fixed source only for later messages from the selected author", async () => {
    // Given
    testWindow.location.href = "https://www.youtube.com/live_chat?v=fixture";
    const items = createLiveChat();
    const authorOneChoice = appendLiveChatMessage(items, "namaste", "/channel/one");
    const requests: TranslationRequest[] = [];
    const laterRequests = deferred<void>();
    let trackLaterRequests = false;
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        requests.push(request);
        if (trackLaterRequests && requests.length === 2) laterRequests.resolve();
        return translated(request.text);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.startLiveChat();
    await flushMutations();
    await controller.retranslate(authorOneChoice, { source: "hi", target: "ko" });
    requests.length = 0;
    trackLaterRequests = true;

    // When
    appendLiveChatMessage(items, "namaste", "/channel/one");
    appendLiveChatMessage(items, "namaste", "/channel/two");
    await laterRequests.promise;

    // Then
    expect(requests).toContainEqual(
      expect.objectContaining({ source: { kind: "fixed", language: "hi" } }),
    );
    expect(requests.map(({ source }) => source.kind)).toContain("auto");
  });

  it("does not apply an author choice to a message already queued", async () => {
    // Given
    testWindow.location.href = "https://www.youtube.com/live_chat?v=fixture";
    const items = createLiveChat();
    const first = appendLiveChatMessage(items, "first", "/channel/one");
    const queued = appendLiveChatMessage(items, "queued", "/channel/one");
    const firstResult = deferred<TranslationResult>();
    const requests: TranslationRequest[] = [];
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      translate(request) {
        requests.push(request);
        return request.text === "first"
          ? firstResult.promise
          : Promise.resolve(translated(request.text));
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.startLiveChat();
    await flushMutations();
    expect(requests).toHaveLength(1);

    // When
    await controller.retranslate(queued, { source: "hi", target: "ko" });
    firstResult.resolve(translated("first"));
    await flushMutations();
    await flushMutations();
    await flushMutations();

    // Then
    const queuedRequest = requests.find((request, index) => index > 1 && request.text === "queued");
    expect(queuedRequest?.source).toMatchObject({ kind: "auto" });
    expect(first.textContent).toBe("first");
  });

  it("caches an automatic live-chat decision by unchanged message text", async () => {
    // Given
    testWindow.location.href = "https://www.youtube.com/live_chat?v=fixture";
    const items = createLiveChat();
    appendLiveChatMessage(items, "same text", "/channel/one");
    appendLiveChatMessage(items, "same text", "/channel/two");
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

    // When
    await controller.startLiveChat();
    await flushMutations();
    await flushMutations();
    await flushMutations();

    // Then
    expect(requests).toHaveLength(2);
    expect(requests[1]?.source).toMatchObject({
      kind: "auto",
      knownDetection: { kind: "detected", language: "en", provenance: "language-detector" },
    });
  });

  it("propagates Nano authorization from live-chat recovery through the queued translation", async () => {
    // Given
    testWindow.location.href = "https://www.youtube.com/live_chat?v=fixture";
    const items = createLiveChat();
    appendLiveChatMessage(items, "romanized message");
    const requests: TranslationRequest[] = [];
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "es", provenance: "gemini-nano" };
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

    // When
    await controller.startLiveChat();
    await flushMutations();

    // Then
    expect(requests[0]?.source).toMatchObject({ kind: "auto", nanoAllowed: true });
  });

  it.each(["stop", "destroy"])("clears cached live-chat detection on %s", async (method) => {
    // Given
    testWindow.location.href = "https://www.youtube.com/live_chat?v=fixture";
    const items = createLiveChat();
    appendLiveChatMessage(items, "same message");
    const store = createRecordStore();
    const preferences: TranslationRequest["source"][] = [];
    const session = createLiveChatSessionController({
      document,
      store,
      settings: () => SETTINGS,
      async translate(source, preference) {
        preferences.push(preference);
        store.getOrCreate(source).setDetection({
          kind: "detected",
          language: "en",
          provenance: "language-detector",
        });
      },
      syncRecords() {},
    });
    await session.start();
    await flushMutations();
    if (method === "stop") session.stop();
    else session.destroy();
    await session.start();

    // When
    appendLiveChatMessage(items, "same message");
    await flushMutations();

    // Then
    expect(preferences[1]).toMatchObject({ kind: "auto" });
    expect(preferences[1]).not.toMatchObject({ knownDetection: expect.anything() });
  });

  it("keeps immediate live-chat retranslation hover-only when page mode is inline", async () => {
    // Given
    testWindow.location.href = "https://www.youtube.com/live_chat?v=fixture";
    const items = createLiveChat();
    const message = appendLiveChatMessage(items, "namaste", "/channel/one");
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        return translated(`번역:${request.text}`);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    // When
    await controller.retranslate(message, { source: "hi", target: "ko" });

    // Then
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
  });

  it("clears a remembered source when restoring a selected live-chat element", async () => {
    // Given
    testWindow.location.href = "https://www.youtube.com/live_chat?v=fixture";
    const items = createLiveChat();
    const selected = appendLiveChatMessage(items, "namaste", "/channel/one");
    const requests: TranslationRequest[] = [];
    const nextRequest = deferred<void>();
    let awaitNextRequest = false;
    const engine: TranslationEngine = {
      async detectSource() {
        return { kind: "detected", language: "en", provenance: "language-detector" };
      },
      async translate(request) {
        requests.push(request);
        if (awaitNextRequest) nextRequest.resolve();
        return translated(request.text);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.startLiveChat();
    await flushMutations();
    await controller.retranslate(selected, { source: "hi", target: "ko" });
    controller.restoreElement(selected);
    requests.length = 0;
    awaitNextRequest = true;

    // When
    appendLiveChatMessage(items, "namaste", "/channel/one");
    await nextRequest.promise;

    // Then
    expect(requests[0]?.source).toMatchObject({ kind: "auto" });
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
