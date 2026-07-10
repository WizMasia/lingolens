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
      broadcastSettings: broadcast,
    });
    coordinator.receive({ type: "tab-state", state: complete }, 7);
    await expect(coordinator.receive({ type: "get-tab-state" })).resolves.toEqual(complete);
  });

  it("returns idle for an unknown tab and forgets removed tabs", async () => {
    let activeTab = 8;
    const coordinator = createBackgroundCoordinator({
      activeTabId: async () => activeTab,
      broadcastSettings: vi.fn(),
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
      broadcastSettings: broadcast,
    });
    coordinator.settingsChanged();
    expect(broadcast).toHaveBeenCalledOnce();
  });
});
