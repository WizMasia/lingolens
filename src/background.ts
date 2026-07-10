import { parseMessage, type TabState } from "./shared/protocol";

const IDLE_STATE: TabState = {
  phase: "idle",
  completed: 0,
  total: 0,
  skipped: 0,
  failed: 0,
};

export type BackgroundDependencies = Readonly<{
  activeTabId(): Promise<number | undefined>;
  broadcastSettings(): void;
}>;

export type BackgroundCoordinator = Readonly<{
  receive(value: unknown, senderTabId?: number): Promise<TabState | undefined>;
  removeTab(tabId: number): void;
  settingsChanged(): void;
}>;

export const createBackgroundCoordinator = (
  dependencies: BackgroundDependencies,
): BackgroundCoordinator => {
  const states = new Map<number, TabState>();
  return {
    async receive(value, senderTabId) {
      const message = parseMessage(value);
      if (message === undefined) return undefined;
      switch (message.type) {
        case "tab-state":
          if (senderTabId !== undefined) states.set(senderTabId, message.state);
          return undefined;
        case "get-tab-state": {
          const tabId = await dependencies.activeTabId();
          return tabId === undefined ? IDLE_STATE : (states.get(tabId) ?? IDLE_STATE);
        }
        case "settings-changed":
          dependencies.broadcastSettings();
          return undefined;
        case "translate-page":
        case "restore-page":
          return undefined;
        default:
          return assertNever(message);
      }
    },
    removeTab(tabId) {
      states.delete(tabId);
    },
    settingsChanged() {
      dependencies.broadcastSettings();
    },
  };
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled message: ${String(value)}`);
};

if (typeof chrome !== "undefined") {
  const coordinator = createBackgroundCoordinator({
    async activeTabId() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id;
    },
    broadcastSettings() {
      void chrome.tabs.query({}).then((tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue;
          void chrome.tabs.sendMessage(tab.id, { type: "settings-changed" }).catch(() => undefined);
        }
      });
    },
  });
  chrome.runtime.onMessage.addListener((value: unknown, sender) =>
    coordinator.receive(value, sender.tab?.id),
  );
  chrome.tabs.onRemoved.addListener((tabId) => coordinator.removeTab(tabId));
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") coordinator.settingsChanged();
  });
}
