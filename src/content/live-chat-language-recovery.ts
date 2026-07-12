import type { Settings } from "../shared/settings";
import { createLiveChatLanguageMemory } from "./live-chat-language-memory";
import type { RecordStore } from "./records";
import type { LiveChatSourcePreference, YouTubeLiveChatSession } from "./youtube-live-chat";

type LanguageChoice = Readonly<{
  source: "auto" | string;
  target: string;
}>;

export type LiveChatLanguageRecovery = Readonly<{
  preference(source: HTMLElement, fallback: Settings["source"]): LiveChatSourcePreference;
  remember(source: HTMLElement, choice: LanguageChoice): void;
  restore(source: HTMLElement): void;
  destroy(): void;
}>;

export const createLiveChatLanguageRecovery = (
  session: YouTubeLiveChatSession,
  store: RecordStore,
): LiveChatLanguageRecovery => {
  const languages = createLiveChatLanguageMemory();
  const authorId = (source: HTMLElement): string | undefined => session.authorId(source);

  return {
    preference(source, fallback) {
      const override = store.getOrCreate(source).languageOverride;
      if (override !== null) {
        return override.source === "auto"
          ? { kind: "auto", nanoAllowed: true }
          : { kind: "fixed", language: override.source };
      }
      const language = authorId(source);
      const remembered = language === undefined ? undefined : languages.get(language);
      if (remembered !== undefined) return { kind: "fixed", language: remembered };
      return fallback.kind === "auto" ? { kind: "auto", nanoAllowed: true } : fallback;
    },
    remember(source, choice) {
      const language = authorId(source);
      if (language === undefined) return;
      if (choice.source === "auto") {
        languages.clear(language);
        return;
      }
      languages.set(language, choice.source);
    },
    restore(source) {
      const language = authorId(source);
      if (language !== undefined) languages.clear(language);
    },
    destroy: languages.destroy,
  };
};
