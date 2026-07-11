import type { Settings } from "../shared/settings";
import { createLiveChatLanguageRecovery } from "./live-chat-language-recovery";
import type { ElementRecord, RecordStore } from "./records";
import { createYouTubeLiveChatSession, type LiveChatSourcePreference } from "./youtube-live-chat";

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
    preference: LiveChatSourcePreference,
    signal: AbortSignal,
  ): Promise<void>;
  syncRecords(): void;
}>;

export const createLiveChatSessionController = (
  options: LiveChatSessionControllerOptions,
): LiveChatSessionController => {
  const records = new WeakSet<ElementRecord>();
  const detections = new Map<string, LiveChatSourcePreference["knownDetection"]>();
  let languages: ReturnType<typeof createLiveChatLanguageRecovery>;
  const session = createYouTubeLiveChatSession({
    document: options.document,
    capturePreference(source) {
      return languages.preference(source, options.settings().source);
    },
    async translate(source, signal, message) {
      const record = options.store.getOrCreate(source);
      records.add(record);
      const knownDetection = detections.get(message.text);
      const preference =
        knownDetection === undefined || message.preference.kind === "fixed"
          ? message.preference
          : { ...message.preference, knownDetection };
      try {
        await options.translate(source, preference, signal);
        if (record.detection.kind === "detected" && record.detection.provenance !== "user") {
          detections.set(message.text, {
            kind: "detected",
            language: record.detection.language,
            provenance: record.detection.provenance,
          });
        }
      } finally {
        options.syncRecords();
      }
    },
  });
  languages = createLiveChatLanguageRecovery(session, options.store);
  const stop = (): void => {
    session.stop();
    languages.destroy();
    detections.clear();
  };

  return {
    start: session.start,
    stop,
    destroy() {
      session.destroy();
      languages.destroy();
      detections.clear();
    },
    has: (record) => records.has(record) || session.isMessage(record.source),
    remember: languages.remember,
    restore: languages.restore,
  };
};
