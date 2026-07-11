import type { NanoLanguageDecision } from "../content/nano-language-detector";
import { isYouTubeLiveChatUrl } from "../frame-registry";
import { createLiveChatIntentTracker } from "../live-chat-intent";
import type { LiveChatStateStore } from "../live-chat-state";
import { parseMessage, type RuntimeMessage, type TabState } from "../shared/protocol";
import type { NanoOffscreenBridge } from "./nano-offscreen-bridge";

export type { LiveChatStateStore };

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
  nanoBridge?: NanoOffscreenBridge;
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
  ): Promise<TabState | NanoLanguageDecision | undefined>;
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
  const tabLifecycleEvents = new Map<number, number>();
  let lifecycleEvent = 0;
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
    lifecycleEvent += 1;
    tabLifecycleEvents.set(tabId, lifecycleEvent);
    states.delete(tabId);
    const generation = liveChatIntent.disable(tabId);
    void queuePageAction(async () => {
      await dependencies.liveChatState.setEnabled(tabId, false);
      if (forget) liveChatIntent.forgetIfCurrent(tabId, generation);
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
        case "detect-nano-source":
          return (
            (await dependencies.nanoBridge?.detect({
              text: message.text,
              context: message.context,
            })) ?? { kind: "unavailable" }
          );
        case "translate-page": {
          const actionEvent = lifecycleEvent;
          const tab = dependencies.activeTab();
          await queuePageAction(async () => {
            const descriptor = await tab;
            if (
              descriptor === undefined ||
              (tabLifecycleEvents.get(descriptor.id) ?? 0) > actionEvent
            ) {
              return;
            }
            await startPageAction(descriptor, message);
          });
          return undefined;
        }
        case "restore-page": {
          const actionEvent = lifecycleEvent;
          const tab = dependencies.activeTab();
          await queuePageAction(async () => {
            const descriptor = await tab;
            if (
              descriptor === undefined ||
              (tabLifecycleEvents.get(descriptor.id) ?? 0) > actionEvent
            ) {
              return;
            }
            await restorePageAction(descriptor, message);
          });
          return undefined;
        }
        case "start-live-chat":
        case "stop-live-chat":
        case "offscreen-nano-detect":
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
      void dependencies.nanoBridge?.close();
    },
    settingsChanged() {
      dependencies.broadcastSettings();
    },
  };
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled message: ${String(value)}`);
};
