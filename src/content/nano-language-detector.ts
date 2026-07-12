import { LANGUAGE_CHOICES, normalizeLanguage } from "../shared/languages";

export type NanoLanguageDecision =
  | Readonly<{ kind: "detected"; language: string; confidence: number }>
  | Readonly<{ kind: "unavailable" }>;

export type NanoLanguageDetector = Readonly<{
  detect(text: string, context: string): Promise<NanoLanguageDecision>;
}>;

export type NanoLanguageResponseSource = (text: string, context: string) => Promise<string>;

export type NanoPreparation = Readonly<{
  prepare(onProgress: (loaded: number) => void): Promise<"ready" | "unavailable">;
}>;

type NanoAvailability = "unavailable" | "downloadable" | "downloading" | "available";

type NanoPreparationMonitor = Readonly<{
  addEventListener(type: "downloadprogress", listener: (event: ProgressEvent) => void): void;
}>;

type NanoPreparationCreateOptions = Readonly<{
  monitor?(monitor: NanoPreparationMonitor): void;
}>;

type NanoPreparationModel = Readonly<{ destroy(): void }>;

export type NanoPreparationApi = Readonly<{
  availability(): Promise<NanoAvailability>;
  create(options: NanoPreparationCreateOptions): Promise<NanoPreparationModel>;
}>;

const MINIMUM_CONFIDENCE = 0.8;
const SUPPORTED_LANGUAGES = new Set(LANGUAGE_CHOICES.map(({ value }) => value));

const unavailable = (): NanoLanguageDecision => ({ kind: "unavailable" });

export const createNanoLanguageDetector = (
  request: NanoLanguageResponseSource,
): NanoLanguageDetector => ({
  async detect(text, context) {
    return parseNanoLanguageDecision(await request(text, context));
  },
});

export const createNanoPreparation = (
  api: NanoPreparationApi | undefined = nativeNanoPreparationApi(),
): NanoPreparation => ({
  async prepare(onProgress) {
    if (api === undefined) return "unavailable";
    try {
      if ((await api.availability()) === "unavailable") return "unavailable";
      const model = await api.create({
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            if (event.total <= 0) return;
            onProgress(Math.min(1, Math.max(0, event.loaded / event.total)));
          });
        },
      });
      model.destroy();
      return "ready";
    } catch {
      return "unavailable";
    }
  },
});

const nativeNanoPreparationApi = (): NanoPreparationApi | undefined => {
  if (!("LanguageModel" in globalThis)) return undefined;
  return {
    availability: () => LanguageModel.availability(),
    create: (options) => LanguageModel.create(options),
  };
};

const parseNanoLanguageDecision = (response: string): NanoLanguageDecision => {
  try {
    const value: unknown = JSON.parse(response);
    if (!isNanoResponse(value)) return unavailable();

    const language = normalizeLanguage(value.language);
    if (
      language === undefined ||
      !SUPPORTED_LANGUAGES.has(language) ||
      !Number.isFinite(value.confidence) ||
      value.confidence < MINIMUM_CONFIDENCE ||
      value.confidence > 1
    ) {
      return unavailable();
    }

    return { kind: "detected", language, confidence: value.confidence };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return unavailable();
    throw error;
  }
};

const isNanoResponse = (
  value: unknown,
): value is Readonly<{ language: string; confidence: number }> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 2 &&
  "language" in value &&
  "confidence" in value &&
  typeof value.language === "string" &&
  typeof value.confidence === "number";
