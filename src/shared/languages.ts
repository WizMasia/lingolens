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
