import { collectSourceText } from "./targets";

const ITEM_LIST_SELECTOR = "yt-live-chat-item-list-renderer #items";
const MESSAGE_SELECTOR = "yt-live-chat-text-message-renderer #message";

export type YouTubeLiveChatSession = Readonly<{
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
}>;

export type YouTubeLiveChatDependencies = Readonly<{
  document: Document;
  translate(source: HTMLElement, signal: AbortSignal): Promise<void>;
}>;

type QueuedMessage = Readonly<{
  source: HTMLElement;
  text: string;
}>;

export const isYouTubeLiveChatDocument = (
  location: Pick<Location, "hostname" | "pathname">,
): boolean =>
  (location.hostname === "youtube.com" || location.hostname.endsWith(".youtube.com")) &&
  location.pathname === "/live_chat";

export const createYouTubeLiveChatSession = (
  dependencies: YouTubeLiveChatDependencies,
): YouTubeLiveChatSession => {
  const queuedText = new WeakMap<HTMLElement, string>();
  let bootstrapObserver: MutationObserver | undefined;
  let itemListObserver: MutationObserver | undefined;
  let activeAbortController: AbortController | undefined;
  let queue: QueuedMessage[] = [];
  let active = false;
  let processing = false;
  let generation = 0;

  const itemList = (): HTMLElement | null =>
    dependencies.document.querySelector<HTMLElement>(ITEM_LIST_SELECTOR);

  const enqueue = (source: HTMLElement): void => {
    const text = collectSourceText(source);
    if (!active || text.length === 0 || queuedText.get(source) === text) return;
    queuedText.set(source, text);
    queue.push({ source, text });
    processQueue();
  };

  const enqueueMessages = (root: HTMLElement): void => {
    if (root.matches(MESSAGE_SELECTOR)) enqueue(root);
    for (const message of root.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)) enqueue(message);
  };

  const processQueue = (): void => {
    if (!active || processing) return;

    let entry = queue.shift();
    while (
      entry !== undefined &&
      (!entry.source.isConnected || collectSourceText(entry.source) !== entry.text)
    ) {
      entry = queue.shift();
    }
    if (entry === undefined) return;

    processing = true;
    const entryGeneration = generation;
    const controller = new AbortController();
    activeAbortController = controller;
    const complete = (): void => {
      if (activeAbortController === controller) activeAbortController = undefined;
      processing = false;
      if (!active) return;
      if (generation !== entryGeneration) {
        processQueue();
        return;
      }
      processQueue();
    };
    void dependencies.translate(entry.source, controller.signal).then(complete, complete);
  };

  const observeItemList = (list: HTMLElement): void => {
    const MutationObserverConstructor = dependencies.document.defaultView?.MutationObserver;
    if (MutationObserverConstructor === undefined) return;
    itemListObserver = new MutationObserverConstructor((records) => {
      if (!active) return;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) enqueueMessages(node);
        }
      }
    });
    itemListObserver.observe(list, { childList: true, subtree: true });
    for (const message of list.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)) enqueue(message);
  };

  const start = async (): Promise<void> => {
    if (active || !isYouTubeLiveChatDocument(dependencies.document.location)) return;
    active = true;
    const list = itemList();
    if (list !== null) {
      observeItemList(list);
      return;
    }

    const root = dependencies.document.documentElement;
    const MutationObserverConstructor = dependencies.document.defaultView?.MutationObserver;
    if (root === null || MutationObserverConstructor === undefined) return;
    bootstrapObserver = new MutationObserverConstructor(() => {
      if (!active) return;
      const resolvedList = itemList();
      if (resolvedList === null) return;
      bootstrapObserver?.disconnect();
      bootstrapObserver = undefined;
      observeItemList(resolvedList);
    });
    bootstrapObserver.observe(root, { childList: true, subtree: true });
  };

  const stop = (): void => {
    active = false;
    generation += 1;
    bootstrapObserver?.disconnect();
    bootstrapObserver = undefined;
    itemListObserver?.disconnect();
    itemListObserver = undefined;
    queue = [];
    activeAbortController?.abort();
  };

  return { start, stop, destroy: stop };
};
