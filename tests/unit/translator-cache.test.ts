import { describe, expect, it, vi } from "vitest";
import {
  type AiAdapter,
  type AiTranslator,
  createTranslationEngine,
} from "../../src/content/ai-engine";

const adapterWith = (createTranslator: AiAdapter["createTranslator"]): AiAdapter => ({
  detect: vi.fn(),
  detectWithChrome: vi.fn().mockResolvedValue(undefined),
  availability: vi.fn().mockResolvedValue("available"),
  createTranslator,
  destroy: vi.fn(),
});

describe("translator cache", () => {
  it("does not deduplicate distinct requests containing delimiters", async () => {
    // Given
    const translate = vi.fn<AiTranslator["translate"]>().mockImplementation(async (text) => text);
    const adapter: AiAdapter = {
      detect: vi.fn().mockResolvedValue([{ detectedLanguage: "en", confidence: 0.99 }]),
      detectWithChrome: vi.fn().mockResolvedValue(undefined),
      availability: vi.fn().mockResolvedValue("available"),
      createTranslator: vi.fn().mockResolvedValue({ translate, destroy: vi.fn() }),
      destroy: vi.fn(),
    };
    const engine = createTranslationEngine(adapter);

    // When
    const results = await Promise.all([
      engine.translate({ text: "d", source: { kind: "auto", context: "a\0de" }, target: "fr" }),
      engine.translate({ text: "fr\0d", source: { kind: "auto", context: "a" }, target: "de" }),
    ]);

    // Then
    expect(results).toMatchObject([{ text: "d" }, { text: "fr\0d" }]);
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it("defers destruction while an evicted translator is active", async () => {
    // Given
    let finish: (text: string) => void = () => undefined;
    const active = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const destroyFirst = vi.fn();
    const createTranslator = vi.fn<AiAdapter["createTranslator"]>().mockImplementation(
      async (_source, target): Promise<AiTranslator> => ({
        translate: target === "af" ? () => active : vi.fn().mockResolvedValue(target),
        destroy: target === "af" ? destroyFirst : vi.fn(),
      }),
    );
    const engine = createTranslationEngine(adapterWith(createTranslator));
    const first = engine.translate({
      text: "first",
      source: { kind: "fixed", language: "en" },
      target: "af",
    });
    await Promise.resolve();
    const targets = [
      "ar",
      "bg",
      "bn",
      "ca",
      "cs",
      "da",
      "de",
      "el",
      "es",
      "et",
      "fa",
      "fi",
      "fr",
      "gu",
      "he",
      "hi",
      "hr",
      "hu",
      "id",
      "it",
      "ja",
      "kn",
      "ko",
      "lt",
      "lv",
      "ml",
      "mr",
      "nl",
      "no",
      "pl",
      "pt",
      "ro",
    ];
    for (const target of targets) {
      await engine.translate({ text: target, source: { kind: "fixed", language: "en" }, target });
    }

    // When
    const beforeCompletion = destroyFirst.mock.calls.length;
    finish("done");
    const result = await first;

    // Then
    expect(beforeCompletion).toBe(0);
    expect(result).toMatchObject({ kind: "translated", text: "done" });
    expect(destroyFirst).toHaveBeenCalledTimes(1);
  });
});
