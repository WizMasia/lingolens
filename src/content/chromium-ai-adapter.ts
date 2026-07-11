import { type AiAdapter, type AiTranslator, TranslationError } from "./ai-engine";

export type DownloadProgressListener = (event: ProgressEvent) => void;

const noProgress = (): void => undefined;

export const createChromiumAiAdapter = (
  onDownloadProgress: DownloadProgressListener = noProgress,
): AiAdapter => {
  const models = new Set<DestroyableModel>();
  let detectorPromise: Promise<LanguageDetector> | undefined;
  let active = true;

  const track = <Model extends DestroyableModel>(model: Model): Model => {
    if (!active) {
      model.destroy();
      throw apiUnavailable("Chromium AI adapter is destroyed");
    }
    models.add(model);
    return model;
  };

  const getDetector = async (): Promise<LanguageDetector> => {
    assertActive(active);
    const api = languageDetectorApi();
    if (api === undefined) {
      throw apiUnavailable("Chromium Language Detector API is unavailable");
    }
    if (detectorPromise === undefined) {
      detectorPromise = createDetector(api, onDownloadProgress).then(track);
    }
    try {
      return await detectorPromise;
    } catch (error: unknown) {
      detectorPromise = undefined;
      if (error instanceof TranslationError) throw error;
      throw translationFailed("Language detector model failed to load", error);
    }
  };

  return {
    async detect(text) {
      const detector = await getDetector();
      try {
        return await detector.detect(text);
      } catch (error: unknown) {
        if (error instanceof TranslationError) throw error;
        throw translationFailed("Language detection failed", error);
      }
    },
    async detectWithChrome(text) {
      assertActive(active);
      const detectLanguage = globalThis.chrome?.i18n?.detectLanguage;
      if (detectLanguage === undefined) return undefined;
      try {
        const result = await Promise.resolve().then(() => detectLanguage(text));
        assertActive(active);
        return {
          reliable: result.isReliable,
          languages: result.languages.map(({ language, percentage }) => ({
            language,
            percentage,
          })),
        };
      } catch (error: unknown) {
        if (error instanceof TranslationError) throw error;
        assertActive(active);
        return undefined;
      }
    },
    async availability(source, target) {
      assertActive(active);
      const api = translatorApi();
      if (api === undefined) throw apiUnavailable("Chromium Translator API is unavailable");
      try {
        return await api.availability({ sourceLanguage: source, targetLanguage: target });
      } catch (error: unknown) {
        if (error instanceof TranslationError) throw error;
        throw translationFailed(`Availability check failed for ${source} to ${target}`, error);
      }
    },
    async createTranslator(source, target) {
      assertActive(active);
      const api = translatorApi();
      if (api === undefined) throw apiUnavailable("Chromium Translator API is unavailable");
      try {
        const model = await api.create({
          sourceLanguage: source,
          targetLanguage: target,
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", onDownloadProgress);
          },
        });
        return nativeTranslator(track(model), () => retire(model));
      } catch (error: unknown) {
        if (error instanceof TranslationError) throw error;
        throw translationFailed(
          `Translator model failed to load for ${source} to ${target}`,
          error,
        );
      }
    },
    destroy() {
      if (!active) return;
      active = false;
      for (const model of models) model.destroy();
      models.clear();
      detectorPromise = undefined;
    },
  };

  function retire(model: DestroyableModel): void {
    if (!models.delete(model)) return;
    model.destroy();
  }
};

const createDetector = async (
  api: typeof LanguageDetector,
  onDownloadProgress: DownloadProgressListener,
): Promise<LanguageDetector> => {
  const status = await api.availability();
  if (status === "unavailable") {
    throw apiUnavailable("Chromium Language Detector API is unavailable");
  }
  return api.create({
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", onDownloadProgress);
    },
  });
};

const nativeTranslator = (model: Translator, destroy: () => void): AiTranslator => ({
  translate(text) {
    return model.translate(text);
  },
  destroy,
});

const languageDetectorApi = (): typeof LanguageDetector | undefined => {
  if (!("LanguageDetector" in globalThis)) return undefined;
  return LanguageDetector;
};

const translatorApi = (): typeof Translator | undefined => {
  if (!("Translator" in globalThis)) return undefined;
  return Translator;
};

const assertActive = (active: boolean): void => {
  if (!active) throw apiUnavailable("Chromium AI adapter is destroyed");
};

const apiUnavailable = (message: string): TranslationError =>
  new TranslationError("api-unavailable", message);

const translationFailed = (message: string, cause: unknown): TranslationError =>
  new TranslationError("translation-failed", message, cause);
