import { describe, expect, it, vi } from "vitest";
import { createBackgroundCoordinator } from "../../src/background";
import type { NanoOffscreenBridge } from "../../src/background/nano-offscreen-bridge";
import type { NanoLanguageDecision } from "../../src/content/nano-language-detector";
import type { TabState } from "../../src/shared/protocol";

const complete: TabState = {
  phase: "complete",
  completed: 3,
  total: 4,
  skipped: 1,
  failed: 0,
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

const createNanoBridge = (): NanoOffscreenBridge => ({
  detect: vi.fn(
    async (): Promise<NanoLanguageDecision> => ({
      kind: "detected",
      language: "es",
      confidence: 0.9,
    }),
  ),
  close: vi.fn(async () => undefined),
});

describe("background coordinator", () => {
  it("stores tab state and returns it for the active tab", async () => {
    const broadcast = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      broadcastSettings: broadcast,
      requestTabState: vi.fn(),
    });
    coordinator.receive({ type: "tab-state", state: complete }, 7, 0);
    await expect(coordinator.receive({ type: "get-tab-state" })).resolves.toEqual(complete);
  });

  it("returns idle for an unknown tab and forgets removed tabs", async () => {
    let activeTabId = 8;
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: activeTabId, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn().mockRejectedValue(new Error("content unavailable")),
    });
    coordinator.receive({ type: "tab-state", state: complete }, 8, 0);
    coordinator.removeTab(8);
    expect(await coordinator.receive({ type: "get-tab-state" })).toMatchObject({ phase: "idle" });
    activeTabId = 9;
    expect(await coordinator.receive({ type: "get-tab-state" })).toMatchObject({ phase: "idle" });
  });

  it("broadcasts settings changes", () => {
    const broadcast = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      broadcastSettings: broadcast,
      requestTabState: vi.fn(),
    });
    coordinator.settingsChanged();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("forwards a Nano source request only after explicit session preparation", async () => {
    // Given
    const nanoBridge = createNanoBridge();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      nanoBridge,
      isLiveChatSender: () => true,
      isNanoAuthorizationSender: () => true,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    const beforePreparation = coordinator.receive({
      type: "detect-nano-source",
      text: "hola",
      context: "context",
    });
    await expect(beforePreparation).resolves.toEqual({ kind: "unavailable" });
    expect(nanoBridge.detect).not.toHaveBeenCalled();

    await coordinator.receive({ type: "translate-page" });
    await coordinator.receive(
      { type: "nano-session-authorized" },
      undefined,
      undefined,
      "chrome-extension://fixture/options.html",
    );
    const result = coordinator.receive(
      {
        type: "detect-nano-source",
        text: "hola",
        context: "context",
      },
      7,
      2,
    );

    // Then
    await expect(result).resolves.toEqual({ kind: "detected", language: "es", confidence: 0.9 });
    expect(nanoBridge.detect).toHaveBeenCalledWith({ text: "hola", context: "context" });
  });

  it("rejects Nano detection from a non-live-chat sender after authorization", async () => {
    // Given
    const nanoBridge = createNanoBridge();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      nanoBridge,
      isLiveChatSender: () => false,
      isNanoAuthorizationSender: () => true,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });
    await coordinator.receive(
      { type: "nano-session-authorized" },
      undefined,
      undefined,
      "chrome-extension://fixture/options.html",
    );

    // When
    const result = coordinator.receive(
      { type: "detect-nano-source", text: "hola", context: "context" },
      7,
      2,
    );

    // Then
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    expect(nanoBridge.detect).not.toHaveBeenCalled();
  });

  it("accepts Nano session authorization only from the extension options page", async () => {
    // Given
    const nanoBridge = createNanoBridge();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      nanoBridge,
      isLiveChatSender: () => true,
      isNanoAuthorizationSender: () => true,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    await coordinator.receive({ type: "nano-session-authorized" }, 7, 0);
    const result = coordinator.receive(
      { type: "detect-nano-source", text: "hola", context: "context" },
      7,
      2,
    );

    // Then
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    expect(nanoBridge.detect).not.toHaveBeenCalled();
  });

  it("stops the live chat and closes Nano when top-frame restoration rejects", async () => {
    // Given
    const nanoBridge = createNanoBridge();
    const sendToLiveChat = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn().mockRejectedValue(new Error("top frame unavailable")),
      sendToLiveChat,
      liveChatState: createLiveChatState(),
      nanoBridge,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    const restored = coordinator.receive({ type: "restore-page" });

    // Then
    await expect(restored).rejects.toThrow("top frame unavailable");
    expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "stop-live-chat" });
    expect(nanoBridge.close).toHaveBeenCalledOnce();
  });

  it("invalidates live Nano capability immediately when its tab starts navigating", async () => {
    // Given
    const nanoBridge = createNanoBridge();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn().mockResolvedValue(undefined),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      nanoBridge,
      isLiveChatSender: () => true,
      isNanoAuthorizationSender: () => true,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });
    await coordinator.receive({ type: "translate-page" });
    await coordinator.receive(
      { type: "nano-session-authorized" },
      undefined,
      undefined,
      "chrome-extension://fixture/options.html",
    );

    // When
    coordinator.navigationStarted(7);
    const result = coordinator.receive(
      { type: "detect-nano-source", text: "hola", context: "context" },
      7,
      2,
    );

    // Then
    await expect(result).resolves.toEqual({ kind: "unavailable" });
    expect(nanoBridge.detect).not.toHaveBeenCalled();
  });

  it("closes the Nano offscreen bridge when a tab is removed", async () => {
    // Given
    const nanoBridge = createNanoBridge();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => undefined,
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      nanoBridge,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    coordinator.removeTab(7);
    await Promise.resolve();

    // Then
    expect(nanoBridge.close).toHaveBeenCalledOnce();
  });

  it("closes the Nano offscreen bridge on restoration and navigation", async () => {
    const nanoBridge = createNanoBridge();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn().mockResolvedValue(undefined),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      nanoBridge,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    await coordinator.receive({ type: "restore-page" });
    coordinator.navigationStarted(7);
    await Promise.resolve();

    expect(nanoBridge.close).toHaveBeenCalledTimes(2);
  });

  it("recovers live state from the active content script after a worker restart", async () => {
    const requestTabState = vi.fn().mockResolvedValue(complete);
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      broadcastSettings: vi.fn(),
      requestTabState,
    });

    await expect(coordinator.receive({ type: "get-tab-state" })).resolves.toEqual(complete);
    expect(requestTabState).toHaveBeenCalledWith(7);
  });

  it("does not let a child frame overwrite top-frame tab state", async () => {
    const childState: TabState = { ...complete, phase: "translating", completed: 1 };
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState: createLiveChatState(),
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    await coordinator.receive({ type: "tab-state", state: complete }, 7, 0);
    await coordinator.receive({ type: "tab-state", state: childState }, 7, 2);

    await expect(coordinator.receive({ type: "get-tab-state" })).resolves.toEqual(complete);
  });

  it("starts the top page and registered live chat", async () => {
    const sendToTop = vi.fn().mockResolvedValue(undefined);
    const sendToLiveChat = vi.fn();
    const liveChatState = createLiveChatState();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop,
      sendToLiveChat,
      liveChatState,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    await coordinator.receive({ type: "translate-page" });

    expect(sendToTop).toHaveBeenCalledWith(7, { type: "translate-page" });
    expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "start-live-chat" });
  });

  it("restores the top page and stops registered live chat", async () => {
    const sendToTop = vi.fn().mockResolvedValue(undefined);
    const sendToLiveChat = vi.fn();
    const liveChatState = createLiveChatState();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop,
      sendToLiveChat,
      liveChatState,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    await coordinator.receive({ type: "restore-page" });

    expect(sendToTop).toHaveBeenCalledWith(7, { type: "restore-page" });
    expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "stop-live-chat" });
  });

  it("uses only registered live chat commands for a top-level live chat", async () => {
    const sendToTop = vi.fn().mockResolvedValue(undefined);
    const sendToLiveChat = vi.fn();
    const liveChatState = createLiveChatState();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop,
      sendToLiveChat,
      liveChatState,
      hasTopLiveChat: () => true,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    await coordinator.receive({ type: "translate-page" });
    await coordinator.receive({ type: "restore-page" });

    expect(sendToTop).not.toHaveBeenCalled();
    expect(sendToLiveChat).toHaveBeenNthCalledWith(1, 7, { type: "start-live-chat" });
    expect(sendToLiveChat).toHaveBeenNthCalledWith(2, 7, { type: "stop-live-chat" });
  });

  it("replays a persisted live start when a valid endpoint registers after restart", async () => {
    // Given
    const liveChatState = createLiveChatState();
    const first = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });
    await first.receive({ type: "translate-page" });
    const sendToLiveChat = vi.fn();
    const restarted = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat,
      liveChatState,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    await restarted.liveChatEndpointRegistered(7);

    // Then
    expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "start-live-chat" });
  });

  it("does not replay a live start after restoration clears persisted intent", async () => {
    // Given
    const liveChatState = createLiveChatState();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      liveChatState,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });
    await coordinator.receive({ type: "translate-page" });
    await coordinator.receive({ type: "restore-page" });
    const sendToLiveChat = vi.fn();
    const restarted = createBackgroundCoordinator({
      activeTab: async () => ({ id: 7, url: undefined }),
      sendToTop: vi.fn(),
      sendToLiveChat,
      liveChatState,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    await restarted.liveChatEndpointRegistered(7);

    // Then
    expect(sendToLiveChat).not.toHaveBeenCalled();
  });

  it("persists live intent without sending a page command before endpoint registration", async () => {
    // Given
    const liveChatState = createLiveChatState();
    const sendToTop = vi.fn().mockResolvedValue(undefined);
    const sendToLiveChat = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTab: async () => ({
        id: 7,
        url: "https://www.youtube.com/live_chat?v=fixture",
      }),
      sendToTop,
      sendToLiveChat,
      liveChatState,
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn(),
    });

    // When
    await coordinator.receive({ type: "translate-page" });
    await coordinator.liveChatEndpointRegistered(7);

    // Then
    expect(sendToTop).not.toHaveBeenCalled();
    expect(await liveChatState.isEnabled(7)).toBe(true);
    expect(sendToLiveChat).toHaveBeenCalledWith(7, { type: "start-live-chat" });
  });
});
