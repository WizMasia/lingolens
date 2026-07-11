import { describe, expect, it, vi } from "vitest";

import { type ActiveTab, createBackgroundCoordinator } from "../../src/background";

const deferred = <T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> => {
  let resolvePromise: (value: T) => void = () => {
    throw new Error("Deferred promise resolver was not initialized");
  };
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise(value) };
};

const createLiveChatState = () => {
  const enabled = new Set<number>();
  return {
    async isEnabled(tabId: number): Promise<boolean> {
      return enabled.has(tabId);
    },
    async setEnabled(tabId: number, value: boolean): Promise<void> {
      if (value) enabled.add(tabId);
      else enabled.delete(tabId);
    },
  };
};

describe("background live replay races", () => {
  it("does not replay a stale start after restoration races its enabled read", async () => {
    // Given
    const enabled = deferred<boolean>();
    const sendToLiveChat = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat,
      liveChatState: {
        isEnabled: () => enabled.promise,
        setEnabled: async () => undefined,
      },
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });
    const replay = coordinator.liveChatEndpointRegistered(7);

    // When
    await coordinator.receive({ type: "restore-page" });
    enabled.resolve(true);
    await replay;

    // Then
    expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "stop-live-chat" });
    expect(sendToLiveChat).not.toHaveBeenCalledWith(7, { type: "start-live-chat" });
  });

  it("routes using one active tab descriptor when selection changes", async () => {
    // Given
    const activeTab = vi
      .fn()
      .mockResolvedValueOnce({ id: 7, url: "https://www.youtube.com/live_chat?v=fixture" })
      .mockResolvedValueOnce({ id: 8, url: "https://www.youtube.com/watch?v=fixture" });
    const sendToTop = vi.fn().mockResolvedValue(undefined);
    const sendToLiveChat = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTab,
      sendToTop,
      sendToLiveChat,
      liveChatState: createLiveChatState(),
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    await coordinator.receive({ type: "translate-page" });

    // Then
    expect(activeTab).toHaveBeenCalledOnce();
    expect(sendToTop).not.toHaveBeenCalled();
    expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "start-live-chat" });
  });

  it("keeps restore last when start persistence races restoration", async () => {
    // Given
    const startWrite = deferred<void>();
    const startWriteStarted = deferred<void>();
    let enabled = false;
    const messages: string[] = [];
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn().mockResolvedValue(undefined),
      sendToLiveChat(_tabId, message) {
        messages.push(message.type);
      },
      liveChatState: {
        async isEnabled() {
          return enabled;
        },
        async setEnabled(_tabId, value) {
          if (value) {
            startWriteStarted.resolve();
            await startWrite.promise;
          }
          enabled = value;
        },
      },
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    const start = coordinator.receive({ type: "translate-page" });
    await startWriteStarted.promise;
    const restore = coordinator.receive({ type: "restore-page" });
    startWrite.resolve();
    await Promise.all([start, restore]);

    // Then
    expect(messages).toEqual(["start-live-chat", "stop-live-chat"]);
    expect(enabled).toBe(false);
  });

  it("continues with restoration after a queued start fails", async () => {
    // Given
    const sendToLiveChat = vi.fn();
    let writes = 0;
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn().mockResolvedValue(undefined),
      sendToLiveChat,
      liveChatState: {
        async isEnabled() {
          return false;
        },
        async setEnabled(_tabId, enabled) {
          writes += 1;
          if (enabled && writes === 1) throw new Error("start persistence failed");
        },
      },
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    const start = coordinator.receive({ type: "translate-page" });
    const restore = coordinator.receive({ type: "restore-page" });

    // Then
    await expect(start).rejects.toThrow("start persistence failed");
    await expect(restore).resolves.toBeUndefined();
    expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "stop-live-chat" });
  });

  it("rolls back live intent when generic start dispatch fails", async () => {
    // Given
    const liveChatState = createLiveChatState();
    const sendToLiveChat = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn().mockRejectedValue(new Error("top frame unavailable")),
      sendToLiveChat,
      liveChatState,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    await expect(coordinator.receive({ type: "translate-page" })).rejects.toThrow(
      "top frame unavailable",
    );
    await coordinator.liveChatEndpointRegistered(7);

    // Then
    expect(await liveChatState.isEnabled(7)).toBe(false);
    expect(sendToLiveChat).toHaveBeenNthCalledWith(1, 7, { type: "start-live-chat" });
    expect(sendToLiveChat).toHaveBeenNthCalledWith(2, 7, { type: "stop-live-chat" });
  });

  it("captures the restore tab before its queued action executes", async () => {
    // Given
    const startWrite = deferred<void>();
    const startWriteStarted = deferred<void>();
    let tabId = 7;
    const writes: (readonly [number, boolean])[] = [];
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: tabId, url: undefined }),
      sendToTop: vi.fn().mockResolvedValue(undefined),
      sendToLiveChat: vi.fn(),
      liveChatState: {
        async isEnabled() {
          return false;
        },
        async setEnabled(nextTabId, enabled) {
          writes.push([nextTabId, enabled]);
          if (enabled) {
            startWriteStarted.resolve();
            await startWrite.promise;
          }
        },
      },
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    const start = coordinator.receive({ type: "translate-page" });
    await startWriteStarted.promise;
    const restore = coordinator.receive({ type: "restore-page" });
    tabId = 8;
    startWrite.resolve();
    await Promise.all([start, restore]);

    // Then
    expect(writes).toEqual([
      [7, true],
      [7, false],
    ]);
  });

  it("preserves start receipt order when its active tab lookup is delayed", async () => {
    // Given
    const startTab = deferred<ActiveTab | undefined>();
    let activeTabCalls = 0;
    let enabled = false;
    const messages: string[] = [];
    const coordinator = createBackgroundCoordinator({
      activeTab() {
        activeTabCalls += 1;
        return activeTabCalls === 1 ? startTab.promise : Promise.resolve({ id: 7, url: undefined });
      },
      sendToTop: vi.fn().mockResolvedValue(undefined),
      sendToLiveChat(_tabId, message) {
        messages.push(message.type);
      },
      liveChatState: {
        async isEnabled() {
          return enabled;
        },
        async setEnabled(_tabId, value) {
          enabled = value;
        },
      },
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    const start = coordinator.receive({ type: "translate-page" });
    const restore = coordinator.receive({ type: "restore-page" });
    startTab.resolve({ id: 7, url: undefined });
    await Promise.all([start, restore]);

    // Then
    expect(messages).toEqual(["start-live-chat", "stop-live-chat"]);
    expect(enabled).toBe(false);
  });

  it("clears live intent when its tab closes during a queued start", async () => {
    // Given
    const startWrite = deferred<void>();
    const startWriteStarted = deferred<void>();
    let enabled = false;
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn().mockResolvedValue(undefined),
      sendToLiveChat: vi.fn(),
      liveChatState: {
        async isEnabled() {
          return enabled;
        },
        async setEnabled(_tabId, value) {
          if (value) {
            startWriteStarted.resolve();
            await startWrite.promise;
          }
          enabled = value;
        },
      },
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    const start = coordinator.receive({ type: "translate-page" });
    await startWriteStarted.promise;
    coordinator.removeTab(7);
    startWrite.resolve();
    await start;

    // Then
    expect(enabled).toBe(false);
  });

  it("starts live chat before a slow top-page translation completes", async () => {
    // Given
    const topTranslation = deferred<void>();
    const topTranslationStarted = deferred<void>();
    const sendToLiveChat = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(() => {
        topTranslationStarted.resolve();
        return topTranslation.promise;
      }),
      sendToLiveChat,
      liveChatState: createLiveChatState(),
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    const start = coordinator.receive({ type: "translate-page" });
    await topTranslationStarted.promise;

    // Then
    expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "start-live-chat" });
    topTranslation.resolve();
    await start;
  });

  it("clears live intent when a tab starts navigating during a queued start", async () => {
    // Given
    const startWrite = deferred<void>();
    const startWriteStarted = deferred<void>();
    let enabled = false;
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn().mockResolvedValue(undefined),
      sendToLiveChat: vi.fn(),
      liveChatState: {
        async isEnabled() {
          return enabled;
        },
        async setEnabled(_tabId, value) {
          if (value) {
            startWriteStarted.resolve();
            await startWrite.promise;
          }
          enabled = value;
        },
      },
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    const start = coordinator.receive({ type: "translate-page" });
    await startWriteStarted.promise;
    coordinator.navigationStarted(7);
    startWrite.resolve();
    await start;

    // Then
    expect(enabled).toBe(false);
  });
});
