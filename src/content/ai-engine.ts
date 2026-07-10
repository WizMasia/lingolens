import { normalizeLanguage } from "../shared/languages";
import type { SourcePreference } from "../shared/settings";
import type {
  DetectionProvenance,
  SourceDetection,
  SourceDetectionRequest,
} from "./source-detection";
import { createSourceDetector } from "./source-detection";
import { createTranslatorCache } from "./translator-cache";

export type {
  DetectionProvenance,
  SourceDetection,
  SourceDetectionRequest,
} from "./source-detection";

export type AiAvailability = "unavailable" | "downloadable" | "downloading" | "available";

export type AiDetection = Readonly<{
  detectedLanguage?: string;
  confidence?: number;
}>;

export type AiSecondaryDetection = Readonly<{
  reliable: boolean;
  languages: readonly Readonly<{ language: string; percentage: number }>[];
}>;

export type AiTranslator = Readonly<{
  translate(text: string): Promise<string>;
  destroy(): void;
}>;

export type AiAdapter = Readonly<{
  detect(text: string): Promise<readonly AiDetection[]>;
  detectWithChrome(text: string): Promise<AiSecondaryDetection | undefined>;
  availability(source: string, target: string): Promise<AiAvailability>;
  createTranslator(source: string, target: string): Promise<AiTranslator>;
  destroy(): void;
}>;

type AutomaticSource = Extract<SourcePreference, { readonly kind: "auto" }> &
  Readonly<{ languageHint?: string; context?: string }>;

export type TranslationRequest = Readonly<{
  text: string;
  source: AutomaticSource | Extract<SourcePreference, { readonly kind: "fixed" }>;
  target: string;
}>;

export type TranslationResult =
  | Readonly<{
      kind: "translated";
      text: string;
      sourceLanguage: string;
      targetLanguage: string;
      provenance: DetectionProvenance;
    }>
  | Readonly<{
      kind: "skipped";
      sourceLanguage: string;
      provenance: DetectionProvenance;
    }>
  | Readonly<{ kind: "unknown-source" }>;

export type TranslationErrorCode = "api-unavailable" | "pair-unavailable" | "translation-failed";

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  override readonly cause: unknown;

  constructor(code: TranslationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "TranslationError";
    this.code = code;
    this.cause = cause;
  }
}

export type TranslationEngine = Readonly<{
  detectSource(request: SourceDetectionRequest): Promise<SourceDetection>;
  translate(request: TranslationRequest): Promise<TranslationResult>;
  availability(source: string, target: string): Promise<AiAvailability>;
  destroy(): void;
}>;

const RESULT_CACHE_LIMIT = 500;

export const createTranslationEngine = (adapter: AiAdapter): TranslationEngine => {
  const translators = createTranslatorCache(
    (source, target) => createPairTranslator(adapter, source, target),
    translationFailed,
  );
  const results = new Map<string, TranslationResult>();
  const resultsInFlight = new Map<string, Promise<TranslationResult>>();
  const requestsInFlight = new Map<string, Promise<TranslationResult>>();
  let active = true;
  const sourceDetector = createSourceDetector(adapter);

  const detectSource = async (request: SourceDetectionRequest): Promise<SourceDetection> => {
    assertActive(active);
    const detection = await sourceDetector(request);
    assertActive(active);
    return detection;
  };

  const availability = async (source: string, target: string): Promise<AiAvailability> => {
    assertActive(active);
    const pair = normalizePair(source, target);
    if (pair === undefined) return "unavailable";
    try {
      const status = await adapter.availability(pair.source, pair.target);
      assertActive(active);
      return status;
    } catch (error: unknown) {
      if (error instanceof TranslationError) throw error;
      throw translationFailed(
        `Availability check failed for ${pair.source} to ${pair.target}`,
        error,
      );
    }
  };

  const performTranslation = async (request: TranslationRequest): Promise<TranslationResult> => {
    assertActive(active);
    const target = normalizeLanguage(request.target);
    if (target === undefined) throw pairUnavailable(request.target);
    const sourceDetection = await detectSource(request);
    assertActive(active);
    if (sourceDetection.kind === "needs-confirmation") return { kind: "unknown-source" };
    const { language: source, provenance } = sourceDetection;
    if (source === target) return { kind: "skipped", sourceLanguage: source, provenance };

    const cacheKey = `${source}\0${target}\0${provenance}\0${request.text}`;
    const cached = results.get(cacheKey);
    if (cached !== undefined) return cached;
    const pending = resultsInFlight.get(cacheKey);
    if (pending !== undefined) return pending;

    const work = translators.translate(request.text, source, target).then(
      (text): TranslationResult => ({
        kind: "translated",
        text,
        sourceLanguage: source,
        targetLanguage: target,
        provenance,
      }),
    );
    resultsInFlight.set(cacheKey, work);
    try {
      const result = await work;
      assertActive(active);
      storeBounded(results, cacheKey, result);
      return result;
    } finally {
      resultsInFlight.delete(cacheKey);
    }
  };

  const translate = async (request: TranslationRequest): Promise<TranslationResult> => {
    assertActive(active);
    const key = requestKey(request);
    const pending = requestsInFlight.get(key);
    if (pending !== undefined) return pending;
    const work = performTranslation(request);
    requestsInFlight.set(key, work);
    try {
      return await work;
    } finally {
      requestsInFlight.delete(key);
    }
  };

  return {
    detectSource,
    translate,
    availability,
    destroy() {
      if (!active) return;
      active = false;
      results.clear();
      resultsInFlight.clear();
      requestsInFlight.clear();
      translators.clear();
      adapter.destroy();
    },
  };
};

const requestKey = (request: TranslationRequest): string => {
  const source =
    request.source.kind === "fixed"
      ? ["fixed", request.source.language]
      : ["auto", request.source.languageHint ?? "", request.source.context ?? ""];
  return JSON.stringify([source, request.target, request.text]);
};

const createPairTranslator = async (
  adapter: AiAdapter,
  source: string,
  target: string,
): Promise<AiTranslator> => {
  const status = await adapter.availability(source, target);
  if (status === "unavailable") throw pairUnavailable(`${source} to ${target}`);
  return adapter.createTranslator(source, target);
};

const normalizePair = (
  source: string,
  target: string,
): Readonly<{ source: string; target: string }> | undefined => {
  const normalizedSource = normalizeLanguage(source);
  const normalizedTarget = normalizeLanguage(target);
  return normalizedSource === undefined || normalizedTarget === undefined
    ? undefined
    : { source: normalizedSource, target: normalizedTarget };
};

const storeBounded = (
  cache: Map<string, TranslationResult>,
  key: string,
  value: TranslationResult,
): void => {
  if (cache.size >= RESULT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
};

const pairUnavailable = (pair: string): TranslationError =>
  new TranslationError("pair-unavailable", `Translation pair unavailable: ${pair}`);

const translationFailed = (message: string, cause: unknown): TranslationError =>
  cause instanceof TranslationError
    ? cause
    : new TranslationError("translation-failed", message, cause);

const assertActive = (active: boolean): void => {
  if (!active) throw new TranslationError("api-unavailable", "Translation engine is destroyed");
};
