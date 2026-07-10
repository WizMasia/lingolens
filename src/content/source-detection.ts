import { normalizeLanguage } from "../shared/languages";
import type { AiAdapter, TranslationRequest } from "./ai-engine";
import { inferScriptLanguage } from "./script-language";

export type DetectionProvenance =
  | "lang"
  | "language-detector"
  | "context-detector"
  | "chrome-i18n"
  | "script"
  | "user";

export type SourceDetection =
  | Readonly<{ kind: "detected"; language: string; provenance: DetectionProvenance }>
  | Readonly<{ kind: "needs-confirmation" }>;

export type SourceDetectionRequest = Pick<TranslationRequest, "text" | "source">;

export type SourceDetector = (request: SourceDetectionRequest) => Promise<SourceDetection>;

const PRIMARY_CONFIDENCE = 0.6;
const SECONDARY_PERCENTAGE = 80;

type PrimaryEvidence = Readonly<{
  accepted?: string;
  candidates: ReadonlySet<string>;
}>;

const primaryEvidence = (detections: Awaited<ReturnType<AiAdapter["detect"]>>): PrimaryEvidence => {
  const candidates = new Set(
    detections.flatMap(({ detectedLanguage }) => {
      const language = normalizeLanguage(detectedLanguage ?? "");
      return language === undefined ? [] : [language];
    }),
  );
  const best = detections[0];
  const accepted = normalizeLanguage(best?.detectedLanguage ?? "");
  return {
    candidates,
    ...(accepted !== undefined && (best?.confidence ?? 0) >= PRIMARY_CONFIDENCE
      ? { accepted }
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

    const candidates = new Set<string>();
    const primary = primaryEvidence((await attempt(() => adapter.detect(request.text))) ?? []);
    for (const candidate of primary.candidates) candidates.add(candidate);
    if (primary.accepted !== undefined) return detected(primary.accepted, "language-detector");

    const context = request.source.context?.trim();
    if (context !== undefined && context.length > 0 && context !== request.text.trim()) {
      const contextual = primaryEvidence(
        (await attempt(() => adapter.detect(`${request.text} ${context}`))) ?? [],
      );
      for (const candidate of contextual.candidates) candidates.add(candidate);
      if (contextual.accepted !== undefined)
        return detected(contextual.accepted, "context-detector");
    }

    const secondary = await attempt(() => adapter.detectWithChrome(request.text));
    const bestSecondary = secondary?.languages[0];
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
    return script === undefined ? { kind: "needs-confirmation" } : detected(script, "script");
  };
