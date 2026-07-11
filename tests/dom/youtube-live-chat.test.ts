import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { collectSourceText } from "../../src/content/targets";
import { createYouTubeLiveChatSession } from "../../src/content/youtube-live-chat";

const testWindow = new Window({ url: "https://www.youtube.com/live_chat?v=fixture" });
Object.defineProperties(globalThis, {
  DOMRect: { configurable: true, value: testWindow.DOMRect },
  Element: { configurable: true, value: testWindow.Element },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  MutationObserver: { configurable: true, value: testWindow.MutationObserver },
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
  value: () => ({ display: "block", opacity: "", visibility: "visible" }),
});

const flushMutations = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const messageRenderer = (text: string): HTMLElement => {
  const renderer = document.createElement("yt-live-chat-text-message-renderer");
  const message = document.createElement("span");
  message.id = "message";
  message.textContent = text;
  renderer.append(message);
  return renderer;
};

const chatFixture = (): HTMLElement => {
  const listRenderer = document.createElement("yt-live-chat-item-list-renderer");
  const items = document.createElement("div");
  items.id = "items";
  listRenderer.append(items);
  document.body.append(listRenderer);
  return items;
};

const deferred = <T>(): Readonly<{ promise: Promise<T>; resolve(value: T): void }> => {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred promise resolver was not initialized");
  };
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve: (value) => resolve(value) };
};

describe("YouTube live chat", () => {
  beforeEach(() => document.body.replaceChildren());

  it("translates initial and appended text messages exactly once", async () => {
    const items = chatFixture();
    items.append(messageRenderer("First"));
    const translated: string[] = [];
    const session = createYouTubeLiveChatSession({
      document,
      async translate(source) {
        translated.push(collectSourceText(source));
      },
    });

    await session.start();
    await flushMutations();
    items.append(messageRenderer("Second"));
    await flushMutations();
    document.body.append(messageRenderer("Outside the item list"));
    await flushMutations();

    expect(translated).toEqual(["First", "Second"]);
  });

  it("requeues a recycled message element only after its source text changes", async () => {
    const items = chatFixture();
    const renderer = messageRenderer("First");
    items.append(renderer);
    const translated: string[] = [];
    const session = createYouTubeLiveChatSession({
      document,
      async translate(source) {
        translated.push(collectSourceText(source));
      },
    });

    await session.start();
    await flushMutations();
    const message = renderer.querySelector<HTMLElement>("#message");
    if (message === null) throw new Error("Fixture message is missing");
    message.textContent = "Replacement";
    renderer.remove();
    items.append(renderer);
    await flushMutations();

    expect(translated).toEqual(["First", "Replacement"]);
  });

  it("skips composer and payment/member UI", async () => {
    const items = chatFixture();
    const composer = document.createElement("div");
    composer.setAttribute("contenteditable", "true");
    composer.textContent = "Composer";
    const textarea = document.createElement("textarea");
    textarea.value = "Textarea";
    const paid = document.createElement("yt-live-chat-paid-message-renderer");
    paid.innerHTML = '<span id="message">Paid</span>';
    const membership = document.createElement("yt-live-chat-membership-item-renderer");
    membership.innerHTML = '<span id="message">Membership</span>';
    items.append(composer, textarea, paid, membership);
    const translated: string[] = [];
    const session = createYouTubeLiveChatSession({
      document,
      async translate(source) {
        translated.push(collectSourceText(source));
      },
    });

    await session.start();
    await flushMutations();

    expect(translated).toEqual([]);
  });

  it("disconnects and prevents queued later work after stop", async () => {
    const items = chatFixture();
    items.append(messageRenderer("First"));
    const translated: string[] = [];
    const first = deferred<void>();
    const session = createYouTubeLiveChatSession({
      document,
      translate(source, signal) {
        translated.push(collectSourceText(source));
        expect(signal.aborted).toBe(false);
        return first.promise;
      },
    });

    await session.start();
    await flushMutations();
    items.append(messageRenderer("Second"));
    await flushMutations();
    session.stop();
    first.resolve();
    await flushMutations();

    expect(translated).toEqual(["First"]);
  });

  it("resumes queued work after an in-flight stopped generation completes", async () => {
    const items = chatFixture();
    items.append(messageRenderer("First"));
    const translated: string[] = [];
    const first = deferred<void>();
    const session = createYouTubeLiveChatSession({
      document,
      translate(source) {
        const text = collectSourceText(source);
        translated.push(text);
        return text === "First" ? first.promise : Promise.resolve();
      },
    });

    await session.start();
    await flushMutations();
    session.stop();
    await session.start();
    items.append(messageRenderer("Second"));
    await flushMutations();
    first.resolve();
    await flushMutations();

    expect(translated).toEqual(["First", "Second"]);
  });
});
