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
  requestTabState(tabId: number): Promise<TabState>;
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
          if (tabId === undefined) return IDLE_STATE;
          const cached = states.get(tabId);
          if (cached !== undefined) return cached;
          try {
            const state = await dependencies.requestTabState(tabId);
            states.set(tabId, state);
            return state;
          } catch (error: unknown) {
            if (error instanceof Error) return IDLE_STATE;
            throw error;
          }
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
    async requestTabState(tabId) {
      const response: unknown = await chrome.tabs.sendMessage(tabId, { type: "get-tab-state" });
      const message = parseMessage({ type: "tab-state", state: response });
      return message?.type === "tab-state" ? message.state : IDLE_STATE;
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
