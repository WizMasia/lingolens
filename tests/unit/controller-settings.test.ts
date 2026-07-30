import { describe, expect, it } from "vitest";
import { settingsLanguages, targetLanguage } from "../../src/content/controller-settings";
import type { Settings } from "../../src/shared/settings";

const settings = (source: Settings["source"], target: Settings["target"]): Settings => ({
  displayMode: "inline",
  source,
  target,
  liveChatNanoEnabled: false,
  pdfTranslationEnabled: true,
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
});

describe("controller settings", () => {
  it("resolves fixed and browser target languages", () => {
    expect(targetLanguage(settings({ kind: "auto" }, { kind: "fixed", language: "ja" }))).toBe(
      "ja",
    );
    expect(
      targetLanguage(settings({ kind: "auto" }, { kind: "browser", resolvedLanguage: "ko" })),
    ).toBe("ko");
  });

  it("builds deduplicated menu choices from configured languages", () => {
    expect(
      settingsLanguages(
        settings({ kind: "fixed", language: "en" }, { kind: "fixed", language: "en" }),
      ),
    ).toEqual([{ value: "en", label: "en" }]);
  });
});
