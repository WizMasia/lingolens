import type { Settings } from "../shared/settings";
import type { ElementLanguageChoice } from "./element-menu";

export const targetLanguage = (settings: Settings): string =>
  settings.target.kind === "fixed" ? settings.target.language : settings.target.resolvedLanguage;

export const settingsLanguages = (settings: Settings): readonly ElementLanguageChoice[] => {
  const values = new Set<string>([targetLanguage(settings)]);
  if (settings.source.kind === "fixed") values.add(settings.source.language);
  return [...values].map((value) => ({ value, label: value }));
};
