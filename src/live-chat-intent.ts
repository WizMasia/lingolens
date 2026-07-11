export type LiveChatIntentTracker = Readonly<{
  start(tabId: number): number;
  disable(tabId: number): number;
  generation(tabId: number): number;
  intent(tabId: number): boolean | undefined;
  forgetIfCurrent(tabId: number, generation: number): void;
}>;

export const createLiveChatIntentTracker = (): LiveChatIntentTracker => {
  const generations = new Map<number, number>();
  const intents = new Map<number, boolean>();
  const generation = (tabId: number): number => generations.get(tabId) ?? 0;
  const set = (tabId: number, intent: boolean): number => {
    const nextGeneration = generation(tabId) + 1;
    generations.set(tabId, nextGeneration);
    intents.set(tabId, intent);
    return nextGeneration;
  };
  return {
    start(tabId) {
      return set(tabId, true);
    },
    disable(tabId) {
      return set(tabId, false);
    },
    generation,
    intent(tabId) {
      return intents.get(tabId);
    },
    forgetIfCurrent(tabId, expectedGeneration) {
      if (generation(tabId) !== expectedGeneration || intents.get(tabId) !== false) return;
      intents.delete(tabId);
    },
  };
};
