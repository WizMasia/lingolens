export type LiveChatLanguageMemory = Readonly<{
  get(authorId: string): string | undefined;
  set(authorId: string, language: string): void;
  clear(authorId: string): void;
  destroy(): void;
}>;

export const createLiveChatLanguageMemory = (): LiveChatLanguageMemory => {
  const languages = new Map<string, string>();
  return {
    get: (authorId) => languages.get(authorId),
    set: (authorId, language) => {
      languages.set(authorId, language);
    },
    clear: (authorId) => {
      languages.delete(authorId);
    },
    destroy: () => {
      languages.clear();
    },
  };
};
