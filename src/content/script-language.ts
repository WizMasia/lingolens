export type ScriptLanguage = "ar" | "ja" | "ko";

export const inferScriptLanguage = (text: string): ScriptLanguage | undefined => {
  if (/\p{Script=Hangul}/u.test(text)) return "ko";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  if (/\p{Script=Arabic}/u.test(text)) return "ar";
  return undefined;
};
