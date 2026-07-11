# YouTube Live Chat Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Translate existing and incoming YouTube Live Chat messages when page translation starts, while preserving the chat layout and stopping cleanly on restore.

**Architecture:** Keep live handling in a YouTube-specific content-side session. The session observes only YouTube's message list, serially queues one element/text revision at a time, and renders through a dedicated hover view. Every matching content frame registers a runtime port; the service worker forwards live commands only to registered YouTube live-chat frames, without a webNavigation permission or a permanent generic document observer.

**Tech Stack:** TypeScript 5.9, Chrome MV3 runtime ports, MutationObserver, Chrome on-device Language Detector/Translator APIs, Vitest, Happy DOM, Bun, esbuild.

## Global Constraints

- MVP support is YouTube Live Chat only. Do not claim Twitch, Discord, or general real-time-chat support.
- Starting page translation translates current eligible messages and future messages; restore stops observation, aborts queued work, and restores views.
- Live Chat always uses hover rendering even when global settings select inline mode.
- Exclude composer fields, buttons, payment/member UI, hidden elements, extension UI, and non-chat frames.
- Normal top-level page translation remains unchanged on non-YouTube pages.
- Add neither webNavigation nor a network, telemetry, remote-code, or cloud-translation fallback.
- Frame commands are scoped by tab ID and a registered youtube.com/live_chat URL.

---

### Task 1: Extend the typed runtime protocol and frame routing

**Files:**
- Modify: src/shared/protocol.ts
- Create: src/frame-registry.ts
- Modify: src/background.ts
- Modify: src/content/index.ts
- Modify: src/popup/popup.ts
- Modify: src/manifest.json
- Modify: tests/unit/protocol.test.ts
- Modify: tests/unit/background.test.ts
- Create: tests/unit/frame-registry.test.ts
- Modify: tests/dom/content-entry.test.ts

**Interfaces:**
- Produces: RuntimeMessage variants start-live-chat and stop-live-chat, FrameRegistry, and a persistent runtime port from every matching content frame.
- Consumes: the existing translate-page, restore-page, settings-changed, get-tab-state, and tab-state messages.

- [ ] **Step 1: Write failing protocol and command-routing tests**

Add these protocol cases:

~~~ts
expect(parseMessage({ type: "start-live-chat" })).toEqual({ type: "start-live-chat" });
expect(parseMessage({ type: "stop-live-chat" })).toEqual({ type: "stop-live-chat" });
~~~

Change the background test dependency fixture to include sendToTop and sendToLiveChat. Add:

~~~ts
it("starts the top page and registered live chat", async () => {
  const sendToTop = vi.fn().mockResolvedValue(undefined);
  const sendToLiveChat = vi.fn();
  const coordinator = createBackgroundCoordinator({
    activeTabId: async () => 7,
    sendToTop,
    sendToLiveChat,
    broadcastSettings: vi.fn(),
    requestTabState: vi.fn(),
  });

  await coordinator.receive({ type: "translate-page" });

  expect(sendToTop).toHaveBeenCalledWith(7, { type: "translate-page" });
  expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "start-live-chat" });
});
~~~

Mirror the test for restore-page and stop-live-chat. Add a content-entry test that start-live-chat calls controller.startLiveChat() and stop-live-chat calls controller.stopLiveChat().

Create tests/unit/frame-registry.test.ts and assert that an endpoint is targeted only when its tab ID matches and its URL is https://www.youtube.com/live_chat?..., while a same-tab watch-page frame, an evil-youtube.com frame, and a different-tab live-chat frame receive no command. Also assert that hasTopLiveChat is false for a matching child frame and true only for frameId 0.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: bun test tests/unit/protocol.test.ts tests/unit/background.test.ts tests/dom/content-entry.test.ts

Expected: FAIL because protocol variants, dependencies, and controller methods do not exist.

- [ ] **Step 3: Implement the protocol and pure frame registry**

Add start-live-chat and stop-live-chat to RuntimeMessage and parseMessage. Create src/frame-registry.ts with this exact contract:

~~~ts
import type { RuntimeMessage } from "./shared/protocol";

export type FrameEndpoint = Readonly<{
  tabId: number;
  frameId: number;
  url: string;
  post(message: RuntimeMessage): void;
}>;

export type FrameRegistry = Readonly<{
  add(endpoint: FrameEndpoint): void;
  remove(endpoint: FrameEndpoint): void;
  sendToLiveChat(tabId: number, message: RuntimeMessage): void;
  broadcast(message: RuntimeMessage): void;
  hasTopLiveChat(tabId: number): boolean;
}>;

export const isYouTubeLiveChatUrl = (url: string): boolean => {
  const parsed = new URL(url);
  return (parsed.hostname === "youtube.com" || parsed.hostname.endsWith(".youtube.com")) &&
    parsed.pathname === "/live_chat";
};
~~~

Use Map<number, Set<FrameEndpoint>>. Invalid URLs are never live chat. sendToLiveChat posts only to matching URLs. hasTopLiveChat also requires frameId === 0. broadcast sends settings-changed only to registered endpoints.

- [ ] **Step 4: Route actions through the service worker and register all frames**

Change BackgroundDependencies to:

~~~ts
sendToTop(tabId: number, message: RuntimeMessage): Promise<void>;
sendToLiveChat(tabId: number, message: RuntimeMessage): void;
~~~

On translate-page: obtain the active tab, send translate-page to the top document unless hasTopLiveChat(tabId) is true, then send start-live-chat to registered live frames. On restore-page do the corresponding restore-page and stop-live-chat operations. Keep get-tab-state behavior unchanged. On settings changes, retain the top-level tab broadcast and call registry.broadcast({ type: "settings-changed" }).

In production background, register only ports named lingolens-frame that have numeric sender.tab.id and sender.frameId. Store a post wrapper around port.postMessage and remove the endpoint on port disconnect.

In popup.ts, send page actions with chrome.runtime.sendMessage(message), leaving getState through the service worker. In content/index.ts, connect after createContentApp, send incoming port messages to app.handleMessage, and disconnect on pagehide. Set all_frames: true in the manifest content-script object.

- [ ] **Step 5: Validate and commit the routing layer**

Run:

~~~bash
bun test tests/unit/protocol.test.ts tests/unit/background.test.ts tests/dom/content-entry.test.ts
bunx tsc --noEmit
~~~

Expected: PASS with no TypeScript diagnostics.

~~~bash
git add src/shared/protocol.ts src/frame-registry.ts src/background.ts src/content/index.ts src/popup/popup.ts src/manifest.json tests/unit/protocol.test.ts tests/unit/background.test.ts tests/unit/frame-registry.test.ts tests/dom/content-entry.test.ts
git commit -m "feat: route live chat commands to frames"
~~~

---

### Task 2: Implement the YouTube-only observer and bounded message queue

**Files:**
- Create: src/content/youtube-live-chat.ts
- Create: tests/dom/youtube-live-chat.test.ts

**Interfaces:**
- Produces: createYouTubeLiveChatSession(), isYouTubeLiveChatDocument(), start(), stop(), and destroy().
- Consumes: collectSourceText and a callback that translates one HTMLElement with an AbortSignal.

- [ ] **Step 1: Write failing session tests**

Create a Happy DOM fixture at https://www.youtube.com/live_chat?v=fixture with yt-live-chat-item-list-renderer > #items and yt-live-chat-text-message-renderer > #message. Cover these exact behaviors:

~~~ts
it("translates initial and appended text messages exactly once", async () => {
  // Initial message: First. Append Second after start.
  // Expect translate calls for ["First", "Second"].
});

it("requeues a recycled message element only after its source text changes", async () => {
  // Translate First, replace its #message text with Replacement, reinsert it.
  // Expect ["First", "Replacement"].
});

it("skips composer and payment/member UI", async () => {
  // Add contenteditable, textarea, paid-message, and membership renderers.
  // Expect no requests for their text.
});

it("disconnects and prevents queued later work after stop", async () => {
  // Hold First with a deferred promise, append Second, call stop, resolve First.
  // Expect Second never reaches translate().
});
~~~

Use two Promise.resolve() awaits to flush MutationObserver callbacks and a deferred promise for the final test.

- [ ] **Step 2: Run the test and confirm failure**

Run: bun test tests/dom/youtube-live-chat.test.ts

Expected: FAIL because the session module does not exist.

- [ ] **Step 3: Implement a narrow session with no polling**

Create src/content/youtube-live-chat.ts:

~~~ts
export type YouTubeLiveChatSession = Readonly<{
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
}>;

export type YouTubeLiveChatDependencies = Readonly<{
  document: Document;
  translate(source: HTMLElement, signal: AbortSignal): Promise<void>;
}>;

export const isYouTubeLiveChatDocument = (
  location: Pick<Location, "hostname" | "pathname">,
): boolean =>
  (location.hostname === "youtube.com" || location.hostname.endsWith(".youtube.com")) &&
  location.pathname === "/live_chat";
~~~

Use only:

~~~ts
const ITEM_LIST_SELECTOR = "yt-live-chat-item-list-renderer #items";
const MESSAGE_SELECTOR = "yt-live-chat-text-message-renderer #message";
~~~

On start, do nothing for a non-live-chat document. If the item list is absent, observe document.documentElement with childList/subtree only until the list appears, then disconnect that bootstrap observer. Observe only the resolved list for later child additions. Enqueue current and added matching message elements. Use WeakMap<HTMLElement, string> to remember the last queued nonempty collectSourceText value; enqueue the same element again only after that value changes. Process one FIFO entry at a time. Before translating an entry, skip it when disconnected or when its current text differs from the queued value. stop disconnects observers, aborts the current AbortController, clears the queue, and increments a generation counter so late promise completions cannot start another entry. Add no timeout or retry loop.

- [ ] **Step 4: Run the focused session test**

Run: bun test tests/dom/youtube-live-chat.test.ts

Expected: PASS. The test must prove that ordinary document additions outside #items are not observed after startup.

- [ ] **Step 5: Commit the session**

~~~bash
git add src/content/youtube-live-chat.ts tests/dom/youtube-live-chat.test.ts
git commit -m "feat: observe incoming YouTube chat messages"
~~~

---

### Task 3: Integrate forced hover rendering and restoration

**Files:**
- Modify: src/content/controller.ts
- Modify: tests/dom/page-jobs.test.ts
- Modify: tests/dom/content-entry.test.ts

**Interfaces:**
- Produces: TranslationController.startLiveChat(): Promise<void> and stopLiveChat(): void.
- Consumes: YouTubeLiveChatSession, a dedicated createHoverView instance, executeTranslation, and the existing record store/stale observer.

- [ ] **Step 1: Write failing controller integration tests**

In tests/dom/page-jobs.test.ts, set displayMode to inline but make the document location a YouTube live-chat URL. Add an initial #message and call controller.startLiveChat(). Assert the engine receives that source text and document.querySelector('[data-local-translator-ui="inline"]') is null. Dispatch pointerenter and pointerleave on the message: translated text must appear only while entered, then the exact original must return. Append a new #message and assert it translates. Call controller.restorePage(), append a third message, flush mutations, and assert the third never translates.

- [ ] **Step 2: Run integration tests and confirm failure**

Run: bun test tests/dom/page-jobs.test.ts tests/dom/content-entry.test.ts

Expected: FAIL because the controller has no live-chat lifecycle and restore does not stop it.

- [ ] **Step 3: Add translation-view selection per attempt**

In controller.ts create one liveChatView = createHoverView() beside the configured view. Change perform to accept an optional view:

~~~ts
const perform = async (
  attempt: TranslationAttempt,
  translationView: TranslationView = view,
): Promise<boolean> =>
  executeTranslation(attempt, { ...runtime, view: () => translationView });
~~~

Create the YouTube session with a callback that passes the current settings source/target and session AbortSignal into perform with liveChatView. Call page.syncRecords() after each callback so stale-record observation covers live records. Add startLiveChat and stopLiveChat to TranslationController and implement them as session delegates. Make restorePage call stopLiveChat before page.restorePage. Make destroy stop/destroy the session and destroy liveChatView before clearing the store and engine. Do not recreate liveChatView in applySettings: live chat stays hover-only regardless of settings.

- [ ] **Step 4: Run regressions and commit**

Run:

~~~bash
bun test tests/dom/page-jobs.test.ts tests/dom/content-entry.test.ts tests/dom/youtube-live-chat.test.ts
bun test
bunx tsc --noEmit
~~~

Expected: all PASS; ordinary page inline mode continues to create inline cards while live-chat mode never does.

~~~bash
git add src/content/controller.ts tests/dom/page-jobs.test.ts tests/dom/content-entry.test.ts
git commit -m "feat: translate YouTube live chat on hover"
~~~

---

### Task 4: Build and manually verify an actual public YouTube Live Chat after branding merge

**Files:**
- Modify: README.md
- Modify: README.ko.md
- Modify: docs/public-release-checklist.md

**Interfaces:**
- Produces: an observed, accurate support statement rather than an unverified compatibility claim.
- Consumes: the branding branch's README.md, README.ko.md, and docs/public-release-checklist.md after it is merged; built dist; the reloaded unpacked extension; and a public YouTube live stream with chat enabled.

- [ ] **Step 1: Merge the branding branch, then build and reload the unpacked extension**

This is a root integration step, not work for the isolated live-chat implementation branch. Complete it only after the branding branch has been reviewed and merged, so README and checklist changes have one owner.

Run:

~~~bash
bun run build
git diff --check
~~~

Reload dist in chrome://extensions. Open a public YouTube watch page with enabled live chat and confirm the live chat document URL is /live_chat.

- [ ] **Step 2: Exercise all user-visible flows in Chrome**

Verify:
1. LingoLens 페이지 전체 번역 translates current chat without inline cards or row movement.
2. At least two subsequent messages are translated once each.
3. Hover replaces a translated message temporarily and restores its exact original on leave.
4. Composer, send button, member/payment UI remain unchanged.
5. 원문 복원 restores views, stops observation, and later messages remain original.
6. Console contains no LingoLens-caused errors/warnings; record the Chrome model/language-pair availability observed.

- [ ] **Step 3: Update documentation only with observed behavior**

State in both READMEs that YouTube Live Chat is MVP-only, new messages are translated after page translation starts, live chat forces hover display to protect layout, and model/pair availability varies by Chrome device. Mark the release checklist checkbox only after the previous step succeeds.

- [ ] **Step 4: Run final gates and commit observed support copy**

Run:

~~~bash
bun test
bunx tsc --noEmit
bunx biome check src tests scripts vitest.config.ts
bun run build
git diff --check
~~~

Expected: all PASS.

~~~bash
git add README.md README.ko.md docs/public-release-checklist.md
git commit -m "docs: verify YouTube live chat support"
~~~
