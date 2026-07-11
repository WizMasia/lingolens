import { createFrameRegistry, type FrameEndpoint, isYouTubeLiveChatUrl } from "./frame-registry";
import { createLiveChatIntentTracker } from "./live-chat-intent";
import { createLiveChatStateStore, type LiveChatStateStore } from "./live-chat-state";
import { parseMessage, type RuntimeMessage, type TabState } from "./shared/protocol";

export type { LiveChatStateStore } from "./live-chat-state";

const IDLE_STATE: TabState = {
  phase: "idle",
  completed: 0,
  total: 0,
  skipped: 0,
  failed: 0,
};

export type BackgroundDependencies = Readonly<{
  activeTab(): Promise<ActiveTab | undefined>;
  sendToTop(tabId: number, message: RuntimeMessage): Promise<void>;
  sendToLiveChat(tabId: number, message: RuntimeMessage): void;
  liveChatState: LiveChatStateStore;
  hasTopLiveChat?(tabId: number): boolean;
  broadcastSettings(): void;
  requestTabState(tabId: number): Promise<TabState>;
}>;

export type ActiveTab = Readonly<{
  id: number;
  url: string | undefined;
}>;

type PageActionMessage = Extract<RuntimeMessage, { type: "translate-page" | "restore-page" }>;

export type BackgroundCoordinator = Readonly<{
  receive(
    value: unknown,
    senderTabId?: number,
    senderFrameId?: number,
  ): Promise<TabState | undefined>;
  liveChatEndpointRegistered(tabId: number): Promise<void>;
  navigationStarted(tabId: number): void;
  removeTab(tabId: number): void;
  settingsChanged(): void;
}>;

export const createBackgroundCoordinator = (
  dependencies: BackgroundDependencies,
): BackgroundCoordinator => {
  const states = new Map<number, TabState>();
  const liveChatIntent = createLiveChatIntentTracker();
  let pageActionQueue: Promise<void> = Promise.resolve();
  let pageLifecycleEpoch = 0;
  const hasTopLiveChat = dependencies.hasTopLiveChat ?? (() => false);
  const isTopLiveChat = (tab: ActiveTab): boolean =>
    hasTopLiveChat(tab.id) || isYouTubeLiveChatUrl(tab.url ?? "");
  const queuePageAction = (action: () => Promise<void>): Promise<void> => {
    const queued = pageActionQueue.then(action, action);
    pageActionQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };
  const startPageAction = async (tab: ActiveTab, message: PageActionMessage): Promise<void> => {
    const generation = liveChatIntent.start(tab.id);
    await dependencies.liveChatState.setEnabled(tab.id, true);
    if (generation !== liveChatIntent.generation(tab.id)) return;
    dependencies.sendToLiveChat(tab.id, { type: "start-live-chat" });
    if (!isTopLiveChat(tab)) {
      try {
        await dependencies.sendToTop(tab.id, message);
      } catch (error: unknown) {
        liveChatIntent.disable(tab.id);
        await dependencies.liveChatState.setEnabled(tab.id, false);
        dependencies.sendToLiveChat(tab.id, { type: "stop-live-chat" });
        throw error;
      }
    }
  };
  const restorePageAction = async (tab: ActiveTab, message: PageActionMessage): Promise<void> => {
    liveChatIntent.disable(tab.id);
    await dependencies.liveChatState.setEnabled(tab.id, false);
    if (!isTopLiveChat(tab)) await dependencies.sendToTop(tab.id, message);
    dependencies.sendToLiveChat(tab.id, { type: "stop-live-chat" });
  };
  const clearLiveChatIntent = (tabId: number, forget: boolean): void => {
    pageLifecycleEpoch += 1;
    states.delete(tabId);
    const generation = liveChatIntent.disable(tabId);
    void queuePageAction(async () => {
      await dependencies.liveChatState.setEnabled(tabId, false);
      if (forget && generation === liveChatIntent.generation(tabId)) {
        liveChatIntent.forgetIfCurrent(tabId, generation);
      }
    });
  };
  return {
    async receive(value, senderTabId, senderFrameId) {
      const message = parseMessage(value);
      if (message === undefined) return undefined;
      switch (message.type) {
        case "tab-state":
          if (senderTabId !== undefined && senderFrameId === 0) {
            states.set(senderTabId, message.state);
          }
          return undefined;
        case "get-tab-state": {
          const tab = await dependencies.activeTab();
          if (tab === undefined) return IDLE_STATE;
          const cached = states.get(tab.id);
          if (cached !== undefined) return cached;
          try {
            const state = await dependencies.requestTabState(tab.id);
            states.set(tab.id, state);
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
          const lifecycleEpoch = pageLifecycleEpoch;
          const tab = dependencies.activeTab();
          await queuePageAction(async () => {
            if (lifecycleEpoch !== pageLifecycleEpoch) return;
            const descriptor = await tab;
            if (descriptor === undefined || lifecycleEpoch !== pageLifecycleEpoch) return;
            await startPageAction(descriptor, message);
          });
          return undefined;
        }
        case "restore-page": {
          const lifecycleEpoch = pageLifecycleEpoch;
          const tab = dependencies.activeTab();
          await queuePageAction(async () => {
            if (lifecycleEpoch !== pageLifecycleEpoch) return;
            const descriptor = await tab;
            if (descriptor === undefined || lifecycleEpoch !== pageLifecycleEpoch) return;
            await restorePageAction(descriptor, message);
          });
          return undefined;
        }
        case "start-live-chat":
        case "stop-live-chat":
          return undefined;
        default:
          return assertNever(message);
      }
    },
    async liveChatEndpointRegistered(tabId) {
      const generation = liveChatIntent.generation(tabId);
      const intent = liveChatIntent.intent(tabId);
      if (intent === false) return;
      if (
        (intent ?? (await dependencies.liveChatState.isEnabled(tabId))) &&
        generation === liveChatIntent.generation(tabId)
      ) {
        dependencies.sendToLiveChat(tabId, { type: "start-live-chat" });
      }
    },
    navigationStarted(tabId) {
      clearLiveChatIntent(tabId, false);
    },
    removeTab(tabId) {
      clearLiveChatIntent(tabId, true);
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
    async activeTab() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (typeof tab?.id !== "number") return undefined;
      return { id: tab.id, url: tab.url };
    },
    async sendToTop(tabId, message) {
      await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    },
    sendToLiveChat(tabId, message) {
      frames.sendToLiveChat(tabId, message);
    },
    liveChatState: createLiveChatStateStore(),
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
    coordinator.receive(value, sender.tab?.id, sender.frameId),
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
    if (isYouTubeLiveChatUrl(endpoint.url)) {
      void coordinator.liveChatEndpointRegistered(endpoint.tabId);
    }
    port.onDisconnect.addListener(() => frames.remove(endpoint));
  });
  chrome.tabs.onRemoved.addListener((tabId) => coordinator.removeTab(tabId));
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") coordinator.navigationStarted(tabId);
  });
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") coordinator.settingsChanged();
  });
}
