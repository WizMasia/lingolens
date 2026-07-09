import { normalizeLanguage } from "../shared/languages";
import type { SourcePreference } from "../shared/settings";
import { createTranslatorCache } from "./translator-cache";

export type AiAvailability = "unavailable" | "downloadable" | "downloading" | "available";

export type AiDetection = Readonly<{
  detectedLanguage?: string;
  confidence?: number;
}>;

export type AiTranslator = Readonly<{
  translate(text: string): Promise<string>;
  destroy(): void;
}>;

export type AiAdapter = Readonly<{
  detect(text: string): Promise<readonly AiDetection[]>;
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
    }>
  | Readonly<{ kind: "skipped"; sourceLanguage: string }>
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
  translate(request: TranslationRequest): Promise<TranslationResult>;
  availability(source: string, target: string): Promise<AiAvailability>;
  destroy(): void;
}>;

const CONFIDENCE_THRESHOLD = 0.6;
const SHORT_TEXT_LETTERS = 20;
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
    const source = await resolveSource(adapter, request);
    assertActive(active);
    if (source === undefined) return { kind: "unknown-source" };
    if (source === target) return { kind: "skipped", sourceLanguage: source };

    const cacheKey = `${source}\0${target}\0${request.text}`;
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

const resolveSource = async (
  adapter: AiAdapter,
  request: TranslationRequest,
): Promise<string | undefined> => {
  if (request.source.kind === "fixed") return normalizeLanguage(request.source.language);
  if (request.source.languageHint !== undefined) {
    const hint = normalizeLanguage(request.source.languageHint);
    if (hint !== undefined) return hint;
  }
  const input = detectionInput(request);
  const [best] = await adapter.detect(input);
  if (
    best === undefined ||
    best.confidence === undefined ||
    best.confidence < CONFIDENCE_THRESHOLD ||
    best.detectedLanguage === undefined
  ) {
    return undefined;
  }
  return normalizeLanguage(best.detectedLanguage);
};

const detectionInput = (request: TranslationRequest): string => {
  if (request.source.kind === "fixed") return request.text;
  const letterCount = request.text.trim().match(/\p{L}/gu)?.length ?? 0;
  const context = request.source.context?.trim();
  return letterCount < SHORT_TEXT_LETTERS && context !== undefined && context.length > 0
    ? context
    : request.text;
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
