import type { AiTranslator } from "./ai-engine";

type TranslatorState = {
  model: AiTranslator | undefined;
  retired: boolean;
  users: number;
  destroyed: boolean;
};

type TranslatorEntry = Readonly<{
  promise: Promise<AiTranslator>;
  state: TranslatorState;
}>;

type CreateTranslator = (source: string, target: string) => Promise<AiTranslator>;
type FailureFactory = (message: string, cause: unknown) => Error;

export type TranslatorCache = Readonly<{
  translate(text: string, source: string, target: string): Promise<string>;
  clear(): void;
}>;

const CACHE_LIMIT = 32;

export const createTranslatorCache = (
  createTranslator: CreateTranslator,
  failure: FailureFactory,
): TranslatorCache => {
  const entries = new Map<string, TranslatorEntry>();
  return {
    async translate(text, source, target) {
      const key = `${source}\0${target}`;
      let entry = entries.get(key);
      if (entry === undefined) {
        evictOldest(entries);
        const state: TranslatorState = {
          model: undefined,
          retired: false,
          users: 0,
          destroyed: false,
        };
        const promise = createTranslator(source, target).then((model) => {
          state.model = model;
          destroyRetired(state);
          return model;
        });
        entry = { promise, state };
        entries.set(key, entry);
      }
      entry.state.users += 1;
      try {
        let translator: AiTranslator;
        try {
          translator = await entry.promise;
        } catch (error: unknown) {
          if (entries.get(key) === entry) entries.delete(key);
          if (!(error instanceof Error)) {
            throw failure(`Translator model failed to load for ${source} to ${target}`, error);
          }
          throw failure(`Translator model failed to load for ${source} to ${target}`, error);
        }
        try {
          return await translator.translate(text);
        } catch (error: unknown) {
          if (!(error instanceof Error)) {
            throw failure(`Translation failed for ${source} to ${target}`, error);
          }
          throw failure(`Translation failed for ${source} to ${target}`, error);
        }
      } finally {
        entry.state.users -= 1;
        destroyRetired(entry.state);
      }
    },
    clear() {
      entries.clear();
    },
  };
};

const evictOldest = (entries: Map<string, TranslatorEntry>): void => {
  if (entries.size < CACHE_LIMIT) return;
  const oldest = entries.entries().next().value;
  if (oldest === undefined) return;
  const [key, entry] = oldest;
  entries.delete(key);
  entry.state.retired = true;
  destroyRetired(entry.state);
};

const destroyRetired = (state: TranslatorState): void => {
  if (!state.retired || state.users > 0 || state.destroyed || state.model === undefined) return;
  state.destroyed = true;
  state.model.destroy();
};
