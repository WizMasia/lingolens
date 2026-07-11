import { createFrameRegistry, type FrameEndpoint } from "./frame-registry";
import { parseMessage, type RuntimeMessage, type TabState } from "./shared/protocol";

const IDLE_STATE: TabState = {
  phase: "idle",
  completed: 0,
  total: 0,
  skipped: 0,
  failed: 0,
};

export type BackgroundDependencies = Readonly<{
  activeTabId(): Promise<number | undefined>;
  sendToTop(tabId: number, message: RuntimeMessage): Promise<void>;
  sendToLiveChat(tabId: number, message: RuntimeMessage): void;
  hasTopLiveChat?(tabId: number): boolean;
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
  const hasTopLiveChat = dependencies.hasTopLiveChat ?? (() => false);
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
        case "translate-page": {
          const tabId = await dependencies.activeTabId();
          if (tabId === undefined) return undefined;
          if (!hasTopLiveChat(tabId)) {
            await dependencies.sendToTop(tabId, message);
          }
          dependencies.sendToLiveChat(tabId, { type: "start-live-chat" });
          return undefined;
        }
        case "restore-page": {
          const tabId = await dependencies.activeTabId();
          if (tabId === undefined) return undefined;
          if (!hasTopLiveChat(tabId)) {
            await dependencies.sendToTop(tabId, message);
          }
          dependencies.sendToLiveChat(tabId, { type: "stop-live-chat" });
          return undefined;
        }
        case "start-live-chat":
        case "stop-live-chat":
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
  const frames = createFrameRegistry();
  const coordinator = createBackgroundCoordinator({
    async activeTabId() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id;
    },
    async sendToTop(tabId, message) {
      await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    },
    sendToLiveChat(tabId, message) {
      frames.sendToLiveChat(tabId, message);
    },
    hasTopLiveChat(tabId) {
      return frames.hasTopLiveChat(tabId);
    },
    broadcastSettings() {
      void chrome.tabs.query({}).then((tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue;
          void chrome.tabs
            .sendMessage(tab.id, { type: "settings-changed" }, { frameId: 0 })
            .catch(() => undefined);
        }
      });
      frames.broadcast({ type: "settings-changed" });
    },
    async requestTabState(tabId) {
      const response: unknown = await chrome.tabs.sendMessage(
        tabId,
        { type: "get-tab-state" },
        { frameId: 0 },
      );
      const message = parseMessage({ type: "tab-state", state: response });
      return message?.type === "tab-state" ? message.state : IDLE_STATE;
    },
  });
  chrome.runtime.onMessage.addListener((value: unknown, sender) =>
    coordinator.receive(value, sender.tab?.id),
  );
  chrome.runtime.onConnect.addListener((port) => {
    const sender = port.sender;
    if (
      port.name !== "lingolens-frame" ||
      typeof sender?.tab?.id !== "number" ||
      typeof sender.frameId !== "number"
    ) {
      return;
    }
    const endpoint: FrameEndpoint = {
      tabId: sender.tab.id,
      frameId: sender.frameId,
      url: sender.url ?? "",
      post(message) {
        port.postMessage(message);
      },
    };
    frames.add(endpoint);
    port.onDisconnect.addListener(() => frames.remove(endpoint));
  });
  chrome.tabs.onRemoved.addListener((tabId) => coordinator.removeTab(tabId));
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") coordinator.settingsChanged();
  });
}
