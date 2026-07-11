import { LANGUAGE_CHOICES, normalizeLanguage } from "../shared/languages";
import type { AiAdapter, TranslationRequest } from "./ai-engine";
import { inferScriptLanguage } from "./script-language";

export type DetectionProvenance =
  | "lang"
  | "language-detector"
  | "context-detector"
  | "chrome-i18n"
  | "script"
  | "gemini-nano"
  | "user";

export type SourceDetection =
  | Readonly<{ kind: "detected"; language: string; provenance: DetectionProvenance }>
  | Readonly<{ kind: "needs-confirmation" }>;

export type AutomaticDetectionEvidence = Readonly<{
  kind: "detected";
  language: string;
  provenance: Exclude<DetectionProvenance, "user">;
}>;

export type SourceDetectionRequest = Pick<TranslationRequest, "text" | "source"> &
  Readonly<{ target?: string }>;

export type SourceDetector = (request: SourceDetectionRequest) => Promise<SourceDetection>;

const PRIMARY_CONFIDENCE = 0.6;
const SECONDARY_PERCENTAGE = 80;
const NANO_SUPPORTED_LANGUAGES = new Set(LANGUAGE_CHOICES.map(({ value }) => value));

type PrimaryEvidence = Readonly<{
  accepted?: string;
  candidates: ReadonlySet<string>;
}>;

const primaryEvidence = (detections: Awaited<ReturnType<AiAdapter["detect"]>>): PrimaryEvidence => {
  const normalized = detections.flatMap(({ detectedLanguage, confidence }) => {
    const language = normalizeLanguage(detectedLanguage ?? "");
    return language === undefined ? [] : [{ language, confidence }];
  });
  const candidates = new Set(normalized.map(({ language }) => language));
  const best = normalized[0];
  return {
    candidates,
    ...(best !== undefined && (best.confidence ?? 0) >= PRIMARY_CONFIDENCE
      ? { accepted: best.language }
      : {}),
  };
};

const attempt = async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
  const [result] = await Promise.allSettled([Promise.resolve().then(operation)]);
  return result?.status === "fulfilled" ? result.value : undefined;
};

const detected = (language: string, provenance: DetectionProvenance): SourceDetection => ({
  kind: "detected",
  language,
  provenance,
});

export const createSourceDetector =
  (adapter: AiAdapter): SourceDetector =>
  async (request) => {
    if (request.source.kind === "fixed") {
      const language = normalizeLanguage(request.source.language);
      return language === undefined ? { kind: "needs-confirmation" } : detected(language, "user");
    }

    const hint = normalizeLanguage(request.source.languageHint ?? "");
    if (hint !== undefined) return detected(hint, "lang");

    const known = request.source.knownDetection;
    const knownLanguage = normalizeLanguage(known?.language ?? "");
    if (known !== undefined && knownLanguage !== undefined) {
      return detected(knownLanguage, known.provenance);
    }

    const candidates = new Set<string>();
    const primary = primaryEvidence((await attempt(() => adapter.detect(request.text))) ?? []);
    for (const candidate of primary.candidates) candidates.add(candidate);
    if (primary.accepted !== undefined) return detected(primary.accepted, "language-detector");

    const context = request.source.context?.trim();
    const detectionText =
      context !== undefined && context.length > 0 && context !== request.text.trim()
        ? `${request.text} ${context}`
        : request.text;
    if (detectionText !== request.text) {
      const contextual = primaryEvidence(
        (await attempt(() => adapter.detect(detectionText))) ?? [],
      );
      for (const candidate of contextual.candidates) candidates.add(candidate);
      if (contextual.accepted !== undefined)
        return detected(contextual.accepted, "context-detector");
    }

    const secondary = await attempt(() => adapter.detectWithChrome(detectionText));
    const bestSecondary = secondary?.languages.find(
      ({ language }) => normalizeLanguage(language) !== undefined,
    );
    const secondaryLanguage = normalizeLanguage(bestSecondary?.language ?? "");
    if (
      secondaryLanguage !== undefined &&
      (secondary?.reliable === true ||
        ((bestSecondary?.percentage ?? 0) >= SECONDARY_PERCENTAGE &&
          candidates.has(secondaryLanguage)))
    ) {
      return detected(secondaryLanguage, "chrome-i18n");
    }

    const script = inferScriptLanguage(request.text);
    if (script !== undefined) return detected(script, "script");

    const detectWithNano = adapter.detectWithNano;
    if (detectWithNano === undefined || request.source.nanoAllowed !== true)
      return { kind: "needs-confirmation" };
    const nano = await attempt(() => detectWithNano(request.text, detectionText));
    if (nano?.kind === "detected") {
      const language = normalizeLanguage(nano.language);
      if (
        language !== undefined &&
        NANO_SUPPORTED_LANGUAGES.has(language) &&
        nano.confidence >= 0.8 &&
        (await hasAvailableNanoPair(adapter, language, request.target))
      ) {
        return detected(language, "gemini-nano");
      }
    }

    return { kind: "needs-confirmation" };
  };

const hasAvailableNanoPair = async (
  adapter: AiAdapter,
  source: string,
  target: string | undefined,
): Promise<boolean> => {
  const normalizedTarget = normalizeLanguage(target ?? "");
  if (normalizedTarget === undefined) return false;
  return (await attempt(() => adapter.availability(source, normalizedTarget))) !== "unavailable";
};
