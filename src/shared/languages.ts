export function normalizeLanguage(tag: string): string | undefined {
  try {
    const [canonicalTag] = Intl.getCanonicalLocales(tag);
    const [base] = canonicalTag?.split("-") ?? [];

    if (base === undefined || base.toLowerCase() === "und") {
      return undefined;
    }

    return base.toLowerCase();
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      return undefined;
    }

    throw error;
  }
}

export type LanguageChoice = Readonly<{ value: string; label: string }>;

export const LANGUAGE_CHOICES: readonly LanguageChoice[] = [
  { value: "ar", label: "아랍어" },
  { value: "de", label: "독일어" },
  { value: "en", label: "영어" },
  { value: "es", label: "스페인어" },
  { value: "fr", label: "프랑스어" },
  { value: "hi", label: "힌디어" },
  { value: "id", label: "인도네시아어" },
  { value: "it", label: "이탈리아어" },
  { value: "ja", label: "일본어" },
  { value: "ko", label: "한국어" },
  { value: "nl", label: "네덜란드어" },
  { value: "pl", label: "폴란드어" },
  { value: "pt", label: "포르투갈어" },
  { value: "ru", label: "러시아어" },
  { value: "th", label: "태국어" },
  { value: "tr", label: "튀르키예어" },
  { value: "vi", label: "베트남어" },
  { value: "zh", label: "중국어" },
];
