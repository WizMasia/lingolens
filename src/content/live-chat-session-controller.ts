import type { Settings } from "../shared/settings";
import { createLiveChatLanguageRecovery } from "./live-chat-language-recovery";
import type { ElementRecord, RecordStore } from "./records";
import { createYouTubeLiveChatSession } from "./youtube-live-chat";

type LanguageChoice = Readonly<{
  source: "auto" | string;
  target: string;
}>;

export type LiveChatSessionController = Readonly<{
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
  has(record: ElementRecord): boolean;
  remember(source: HTMLElement, choice: LanguageChoice): void;
  restore(source: HTMLElement): void;
}>;

export type LiveChatSessionControllerOptions = Readonly<{
  document: Document;
  store: RecordStore;
  settings(): Settings;
  translate(
    source: HTMLElement,
    preference: Settings["source"],
    signal: AbortSignal,
  ): Promise<void>;
  syncRecords(): void;
}>;

export const createLiveChatSessionController = (
  options: LiveChatSessionControllerOptions,
): LiveChatSessionController => {
  const records = new WeakSet<ElementRecord>();
  const session = createYouTubeLiveChatSession({
    document: options.document,
    async translate(source, signal) {
      records.add(options.store.getOrCreate(source));
      try {
        await options.translate(
          source,
          languages.preference(source, options.settings().source),
          signal,
        );
      } finally {
        options.syncRecords();
      }
    },
  });
  const languages = createLiveChatLanguageRecovery(session, options.store);
  const stop = (): void => {
    session.stop();
    languages.destroy();
  };

  return {
    start: session.start,
    stop,
    destroy() {
      session.destroy();
      languages.destroy();
    },
    has: (record) => records.has(record),
    remember: languages.remember,
    restore: languages.restore,
  };
};
