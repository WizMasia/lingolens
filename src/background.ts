import { createBackgroundCoordinator } from "./background/coordinator";
import { createNanoOffscreenBridge } from "./background/nano-offscreen-bridge";
import { createFrameRegistry, type FrameEndpoint, isYouTubeLiveChatUrl } from "./frame-registry";
import { createLiveChatStateStore } from "./live-chat-state";
import { parseMessage, type TabState } from "./shared/protocol";
import { parseSettings } from "./shared/settings";

export {
  type ActiveTab,
  type BackgroundCoordinator,
  type BackgroundDependencies,
  createBackgroundCoordinator,
  type LiveChatStateStore,
} from "./background/coordinator";

const IDLE_STATE: TabState = {
  phase: "idle",
  completed: 0,
  total: 0,
  skipped: 0,
  failed: 0,
};

if (typeof chrome !== "undefined") {
  const frames = createFrameRegistry();
  const nanoBridge = createNanoOffscreenBridge(chrome.offscreen, {
    sendMessage(message) {
      return chrome.runtime.sendMessage(message);
    },
    async hasOffscreenDocument() {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL("nano-offscreen.html")],
      });
      return contexts.length > 0;
    },
  });
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
    nanoBridge,
    hasTopLiveChat(tabId) {
      return frames.hasTopLiveChat(tabId);
    },
    isLiveChatSender(tabId, frameId) {
      return frames.hasLiveChatEndpoint(tabId, frameId);
    },
    isNanoAuthorizationSender(url) {
      return url === chrome.runtime.getURL("options.html");
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
    async getSettings() {
      const stored = await chrome.storage.sync.get("settings");
      return parseSettings(stored["settings"], chrome.i18n.getUILanguage());
    },
    async openPdfViewer(sourceUrl) {
      const viewerUrl = new URL(chrome.runtime.getURL("pdf-viewer.html"));
      if (sourceUrl !== undefined) viewerUrl.searchParams.set("url", sourceUrl);
      await chrome.tabs.create({ url: viewerUrl.href });
    },
  });
  chrome.runtime.onMessage.addListener((value: unknown, sender) =>
    coordinator.receive(value, sender.tab?.id, sender.frameId, sender.url),
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
  chrome.runtime.onSuspend.addListener(() => void nanoBridge.close());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") coordinator.navigationStarted(tabId);
  });
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") coordinator.settingsChanged();
  });
}
