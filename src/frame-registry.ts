import type { RuntimeMessage } from "./shared/protocol";

export type FrameEndpoint = Readonly<{
  tabId: number;
  frameId: number;
  url: string;
  post(message: RuntimeMessage): void;
}>;

export type FrameRegistry = Readonly<{
  add(endpoint: FrameEndpoint): void;
  remove(endpoint: FrameEndpoint): void;
  sendToLiveChat(tabId: number, message: RuntimeMessage): void;
  broadcast(message: RuntimeMessage): void;
  hasTopLiveChat(tabId: number): boolean;
}>;

export const isYouTubeLiveChatUrl = (url: string): boolean => {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return (
    (parsed.hostname === "youtube.com" || parsed.hostname.endsWith(".youtube.com")) &&
    parsed.pathname === "/live_chat"
  );
};

export const createFrameRegistry = (): FrameRegistry => {
  const endpoints = new Map<number, Set<FrameEndpoint>>();
  return {
    add(endpoint) {
      const tabEndpoints = endpoints.get(endpoint.tabId) ?? new Set<FrameEndpoint>();
      tabEndpoints.add(endpoint);
      endpoints.set(endpoint.tabId, tabEndpoints);
    },
    remove(endpoint) {
      const tabEndpoints = endpoints.get(endpoint.tabId);
      if (tabEndpoints === undefined) return;
      tabEndpoints.delete(endpoint);
      if (tabEndpoints.size === 0) endpoints.delete(endpoint.tabId);
    },
    sendToLiveChat(tabId, message) {
      for (const endpoint of endpoints.get(tabId) ?? []) {
        if (isYouTubeLiveChatUrl(endpoint.url)) endpoint.post(message);
      }
    },
    broadcast(message) {
      if (message.type !== "settings-changed") return;
      for (const tabEndpoints of endpoints.values()) {
        for (const endpoint of tabEndpoints) endpoint.post(message);
      }
    },
    hasTopLiveChat(tabId) {
      return [...(endpoints.get(tabId) ?? [])].some(
        (endpoint) => endpoint.frameId === 0 && isYouTubeLiveChatUrl(endpoint.url),
      );
    },
  };
};
