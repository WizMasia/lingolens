import { describe, expect, it, vi } from "vitest";

import { createBackgroundCoordinator } from "../../src/background";

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
});
