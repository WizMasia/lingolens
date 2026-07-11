import { describe, expect, it, vi } from "vitest";
import { createBackgroundCoordinator } from "../../src/background";
import type { TabState } from "../../src/shared/protocol";

const complete: TabState = {
  phase: "complete",
  completed: 3,
  total: 4,
  skipped: 1,
  failed: 0,
};

describe("background coordinator", () => {
  it("stores tab state and returns it for the active tab", async () => {
    const broadcast = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTabId: async () => 7,
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      broadcastSettings: broadcast,
      requestTabState: vi.fn(),
    });
    coordinator.receive({ type: "tab-state", state: complete }, 7);
    await expect(coordinator.receive({ type: "get-tab-state" })).resolves.toEqual(complete);
  });

  it("returns idle for an unknown tab and forgets removed tabs", async () => {
    let activeTab = 8;
    const coordinator = createBackgroundCoordinator({
      activeTabId: async () => activeTab,
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      broadcastSettings: vi.fn(),
      requestTabState: vi.fn().mockRejectedValue(new Error("content unavailable")),
    });
    coordinator.receive({ type: "tab-state", state: complete }, 8);
    coordinator.removeTab(8);
    expect(await coordinator.receive({ type: "get-tab-state" })).toMatchObject({ phase: "idle" });
    activeTab = 9;
    expect(await coordinator.receive({ type: "get-tab-state" })).toMatchObject({ phase: "idle" });
  });

  it("broadcasts settings changes", () => {
    const broadcast = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTabId: async () => undefined,
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      broadcastSettings: broadcast,
      requestTabState: vi.fn(),
    });
    coordinator.settingsChanged();
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("recovers live state from the active content script after a worker restart", async () => {
    const requestTabState = vi.fn().mockResolvedValue(complete);
    const coordinator = createBackgroundCoordinator({
      activeTabId: async () => 7,
      sendToTop: vi.fn(),
      sendToLiveChat: vi.fn(),
      broadcastSettings: vi.fn(),
      requestTabState,
    });

    await expect(coordinator.receive({ type: "get-tab-state" })).resolves.toEqual(complete);
    expect(requestTabState).toHaveBeenCalledWith(7);
  });

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

  it("restores the top page and stops registered live chat", async () => {
    const sendToTop = vi.fn().mockResolvedValue(undefined);
    const sendToLiveChat = vi.fn();
    const coordinator = createBackgroundCoordinator({
      activeTabId: async () => 7,
      sendToTop,
      sendToLiveChat,
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
    const coordinator = createBackgroundCoordinator({
      activeTabId: async () => 7,
      sendToTop,
      sendToLiveChat,
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
});
