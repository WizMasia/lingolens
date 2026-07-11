export type LiveChatStateStore = Readonly<{
  isEnabled(tabId: number): Promise<boolean>;
  setEnabled(tabId: number, enabled: boolean): Promise<void>;
}>;

export const createLiveChatStateStore = (): LiveChatStateStore => {
  const key = (tabId: number): string => `live-chat:${tabId}`;
  return {
    async isEnabled(tabId) {
      const stored: Record<string, unknown> = await chrome.storage.session.get(key(tabId));
      return stored[key(tabId)] === true;
    },
    async setEnabled(tabId, enabled) {
      if (enabled) {
        await chrome.storage.session.set({ [key(tabId)]: true });
        return;
      }
      await chrome.storage.session.remove(key(tabId));
    },
  };
};
