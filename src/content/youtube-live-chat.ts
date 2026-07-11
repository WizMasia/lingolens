import { collectSourceText } from "./targets";

const ITEM_LIST_SELECTOR = "yt-live-chat-item-list-renderer #items";
const MESSAGE_SELECTOR = "yt-live-chat-text-message-renderer #message";
const MAX_QUEUED_MESSAGES = 100;

export type YouTubeLiveChatSession = Readonly<{
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
  authorId(source: HTMLElement): string | undefined;
  isMessage(source: HTMLElement): boolean;
}>;

export type LiveChatMessage = Readonly<{ source: HTMLElement; authorId?: string }>;

export type YouTubeLiveChatDependencies = Readonly<{
  document: Document;
  translate(source: HTMLElement, signal: AbortSignal): Promise<void>;
}>;

type QueuedMessage = LiveChatMessage &
  Readonly<{
    text: string;
    fresh: boolean;
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

  const enqueue = (sources: readonly HTMLElement[], fresh: boolean): void => {
    const entries = sources.flatMap((source): QueuedMessage[] => {
      const text = collectSourceText(source);
      if (!active || text.length === 0 || queuedText.get(source) === text) return [];
      queuedText.set(source, text);
      const authorId = authorIdFor(source);
      return [{ source, text, fresh, ...(authorId === undefined ? {} : { authorId }) }];
    });
    if (entries.length === 0) return;
    queue = fresh ? [...entries, ...queue] : [...queue, ...entries];
    trimQueue();
    processQueue();
  };

  const messagesIn = (root: HTMLElement): readonly HTMLElement[] => [
    ...(root.matches(MESSAGE_SELECTOR) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR),
  ];

  const trimQueue = (): void => {
    while (queue.length > MAX_QUEUED_MESSAGES) {
      let historyIndex = -1;
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index]?.fresh === false) {
          historyIndex = index;
          break;
        }
      }
      queue.splice(historyIndex === -1 ? -1 : historyIndex, 1);
    }
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
      const messages = records.flatMap(({ addedNodes }) =>
        [...addedNodes].flatMap((node) => (node instanceof HTMLElement ? messagesIn(node) : [])),
      );
      enqueue(messages, true);
    });
    itemListObserver.observe(list, { childList: true, subtree: true });
    enqueue([...list.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)], false);
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

  const isMessage = (source: HTMLElement): boolean => source.matches(MESSAGE_SELECTOR);
  const authorIdFor = (source: HTMLElement): string | undefined => {
    if (!isMessage(source)) return undefined;
    const author = source
      .closest("yt-live-chat-text-message-renderer")
      ?.querySelector<HTMLAnchorElement>("#author-name[href]")
      ?.getAttribute("href")
      ?.trim();
    return author === undefined || author.length === 0 ? undefined : author;
  };

  return { start, stop, destroy: stop, authorId: authorIdFor, isMessage };
};
