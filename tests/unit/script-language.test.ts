import { describe, expect, it } from "vitest";
import { inferScriptLanguage } from "../../src/content/script-language";

describe("script language inference", () => {
  it.each([
    ["안녕하세요", "ko"],
    ["これはテストです", "ja"],
    ["مرحبا بالعالم", "ar"],
  ])("infers an unambiguous script from %s", (text, expected) => {
    expect(inferScriptLanguage(text)).toBe(expected);
  });

  it.each(["Hello", "Привет", "中文", "1234"])("does not guess from %s", (text) => {
    expect(inferScriptLanguage(text)).toBeUndefined();
  });
});
