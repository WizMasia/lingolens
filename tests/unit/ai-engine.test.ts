import { describe, expect, it, vi } from "vitest";
import {
  type AiAdapter,
  type AiAvailability,
  type AiTranslator,
  createTranslationEngine,
  TranslationError,
  type TranslationRequest,
} from "../../src/content/ai-engine";

type AdapterOptions = Readonly<{
  detectedLanguage?: string;
  confidence?: number;
  translate?: AiTranslator["translate"];
  availability?: AiAvailability;
  createTranslator?: AiAdapter["createTranslator"];
}>;

const makeAdapter = (options: AdapterOptions = {}): AiAdapter => ({
  detect: vi.fn().mockResolvedValue([
    {
      detectedLanguage: options.detectedLanguage ?? "en",
      confidence: options.confidence ?? 0.99,
    },
  ]),
  detectWithChrome: vi.fn().mockResolvedValue(undefined),
  availability: vi.fn().mockResolvedValue(options.availability ?? "available"),
  createTranslator:
    options.createTranslator ??
    vi.fn().mockResolvedValue({
      translate: options.translate ?? vi.fn().mockResolvedValue("translated"),
      destroy: vi.fn(),
    }),
  destroy: vi.fn(),
});

describe("translation engine", () => {
  it("skips target-language text when automatic detection matches", async () => {
    // Given
    const adapter = makeAdapter({ detectedLanguage: "ko" });
    const engine = createTranslationEngine(adapter);

    // When
    const result = engine.translate({ text: "안녕하세요", source: { kind: "auto" }, target: "ko" });

    // Then
    await expect(result).resolves.toEqual({
      kind: "skipped",
      sourceLanguage: "ko",
      provenance: "language-detector",
    });
  });

  it("deduplicates translator creation and identical in-flight text", async () => {
    // Given
    const translate = vi.fn().mockResolvedValue("안녕하세요");
    const adapter = makeAdapter({ translate });
    const engine = createTranslationEngine(adapter);
    const request: TranslationRequest = {
      text: "Hello",
      source: { kind: "auto" },
      target: "ko",
    };

    // When
    await Promise.all([engine.translate(request), engine.translate(request)]);

    // Then
    expect(adapter.createTranslator).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(adapter.detect).toHaveBeenCalledTimes(1);
  });

  it("keeps Nano-authorized and ordinary automatic requests separate in flight", async () => {
    // Given
    const adapter: AiAdapter = {
      ...makeAdapter({ confidence: 0 }),
      detectWithNano: vi
        .fn<NonNullable<AiAdapter["detectWithNano"]>>()
        .mockResolvedValue({ kind: "detected", language: "es", confidence: 0.9 }),
    };
    const engine = createTranslationEngine(adapter);

    // When
    const [ordinary, nanoAuthorized] = await Promise.all([
      engine.translate({ text: "romanized", source: { kind: "auto" }, target: "ko" }),
      engine.translate({
        text: "romanized",
        source: { kind: "auto", nanoAllowed: true },
        target: "ko",
      }),
    ]);

    // Then
    expect(ordinary).toEqual({ kind: "unknown-source" });
    expect(nanoAuthorized).toMatchObject({ kind: "translated", provenance: "gemini-nano" });
  });

  it("fails closed when Nano detection cannot verify an available translation pair", async () => {
    // Given
    const adapter: AiAdapter = {
      ...makeAdapter({ confidence: 0 }),
      detectWithNano: vi
        .fn<NonNullable<AiAdapter["detectWithNano"]>>()
        .mockResolvedValue({ kind: "detected", language: "es", confidence: 0.9 }),
      availability: vi.fn().mockRejectedValue(new Error("pair status unavailable")),
    };
    const engine = createTranslationEngine(adapter);

    // When
    const result = engine.translate({
      text: "romanized",
      source: { kind: "auto", nanoAllowed: true },
      target: "ko",
    });

    // Then
    await expect(result).resolves.toEqual({ kind: "unknown-source" });
  });

  it("uses a valid per-element hint before detection", async () => {
    // Given
    const adapter = makeAdapter({ detectedLanguage: "de" });
    const engine = createTranslationEngine(adapter);

    // When
    const result = await engine.translate({
      text: "Bonjour",
      source: { kind: "auto", languageHint: "fr-FR" },
      target: "ko-KR",
    });

    // Then
    expect(result).toEqual({
      kind: "translated",
      text: "translated",
      sourceLanguage: "fr",
      targetLanguage: "ko",
      provenance: "lang",
    });
    expect(adapter.detect).not.toHaveBeenCalled();
  });

  it("reuses known automatic evidence without invoking detection", async () => {
    const adapter = makeAdapter({ detectedLanguage: "de" });
    const engine = createTranslationEngine(adapter);

    const result = await engine.translate({
      text: "Hello",
      source: {
        kind: "auto",
        knownDetection: {
          kind: "detected",
          language: "en",
          provenance: "chrome-i18n",
        },
      },
      target: "ko",
    });

    expect(result).toMatchObject({ sourceLanguage: "en", provenance: "chrome-i18n" });
    expect(adapter.detect).not.toHaveBeenCalled();
  });

  it("keeps a valid language hint ahead of known automatic evidence", async () => {
    const adapter = makeAdapter();
    const engine = createTranslationEngine(adapter);

    const result = await engine.translate({
      text: "Bonjour",
      source: {
        kind: "auto",
        languageHint: "fr",
        knownDetection: {
          kind: "detected",
          language: "en",
          provenance: "language-detector",
        },
      },
      target: "ko",
    });

    expect(result).toMatchObject({ sourceLanguage: "fr", provenance: "lang" });
  });

  it("returns unknown source when detector confidence is below threshold", async () => {
    // Given
    const adapter = makeAdapter({ confidence: 0.59 });
    const engine = createTranslationEngine(adapter);

    // When
    const result = engine.translate({ text: "Hello", source: { kind: "auto" }, target: "ko" });

    // Then
    await expect(result).resolves.toEqual({ kind: "unknown-source" });
    expect(adapter.createTranslator).not.toHaveBeenCalled();
  });

  it("rejects an unsupported language pair with a typed error", async () => {
    // Given
    const adapter = makeAdapter({ availability: "unavailable" });
    const engine = createTranslationEngine(adapter);

    // When
    const result = engine.translate({
      text: "Hello",
      source: { kind: "fixed", language: "en" },
      target: "ko",
    });

    // Then
    await expect(result).rejects.toMatchObject({
      name: "TranslationError",
      code: "pair-unavailable",
    });
  });

  it("caches only successful translation results", async () => {
    // Given
    const translate = vi
      .fn<AiTranslator["translate"]>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("안녕하세요");
    const adapter = makeAdapter({ translate });
    const engine = createTranslationEngine(adapter);
    const request: TranslationRequest = {
      text: "Hello",
      source: { kind: "fixed", language: "en" },
      target: "ko",
    };

    // When
    await expect(engine.translate(request)).rejects.toMatchObject({ code: "translation-failed" });
    const result = await engine.translate(request);
    const cached = await engine.translate(request);

    // Then
    expect(result).toEqual(cached);
    expect(translate).toHaveBeenCalledTimes(2);
    expect(adapter.createTranslator).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest result after five hundred cache entries", async () => {
    // Given
    const translate = vi.fn<AiTranslator["translate"]>().mockImplementation(async (text) => text);
    const adapter = makeAdapter({ translate });
    const engine = createTranslationEngine(adapter);
    const request = (text: string): TranslationRequest => ({
      text,
      source: { kind: "fixed", language: "en" },
      target: "ko",
    });

    // When
    for (let index = 0; index <= 500; index += 1) await engine.translate(request(`${index}`));
    await engine.translate(request("0"));

    // Then
    expect(translate).toHaveBeenCalledTimes(502);
  });

  it("retries translator creation after a rejected model download", async () => {
    // Given
    let attempts = 0;
    const createTranslator = vi.fn<AiAdapter["createTranslator"]>().mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("download rejected");
      return { translate: vi.fn().mockResolvedValue("안녕하세요"), destroy: vi.fn() };
    });
    const adapter = makeAdapter({ createTranslator });
    const engine = createTranslationEngine(adapter);
    const request: TranslationRequest = {
      text: "Hello",
      source: { kind: "fixed", language: "en" },
      target: "ko",
    };

    // When
    await expect(engine.translate(request)).rejects.toBeInstanceOf(TranslationError);
    await engine.translate(request);

    // Then
    expect(adapter.createTranslator).toHaveBeenCalledTimes(2);
  });

  it("destroys its adapter once and rejects later work", async () => {
    // Given
    const adapter = makeAdapter();
    const engine = createTranslationEngine(adapter);

    // When
    engine.destroy();
    engine.destroy();
    const result = engine.translate({ text: "Hello", source: { kind: "auto" }, target: "ko" });

    // Then
    expect(adapter.destroy).toHaveBeenCalledTimes(1);
    await expect(result).rejects.toMatchObject({ code: "api-unavailable" });
  });

  it("converts availability rejection into a typed error", async () => {
    // Given
    const adapter = makeAdapter();
    const failingAdapter: AiAdapter = {
      ...adapter,
      availability: vi.fn().mockRejectedValue(new Error("native failure")),
    };
    const engine = createTranslationEngine(failingAdapter);

    // When
    const result = engine.availability("en", "ko");

    // Then
    await expect(result).rejects.toMatchObject({ code: "translation-failed" });
  });

  it("bounds cached translators and destroys the oldest model", async () => {
    // Given
    const destroyed: string[] = [];
    const createTranslator = vi
      .fn<AiAdapter["createTranslator"]>()
      .mockImplementation(async (_source, target) => ({
        translate: vi.fn().mockResolvedValue(target),
        destroy: () => destroyed.push(target),
      }));
    const engine = createTranslationEngine(makeAdapter({ createTranslator }));
    const targets = [
      "af",
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

    // When
    for (const target of targets) {
      await engine.translate({ text: target, source: { kind: "fixed", language: "en" }, target });
    }

    // Then
    expect(createTranslator).toHaveBeenCalledTimes(33);
    expect(destroyed).toEqual(["af"]);
  });

  it("rejects an in-flight result when destroyed before translation completes", async () => {
    // Given
    let resolveTranslation: ((text: string) => void) | undefined;
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const translate = vi.fn<AiTranslator["translate"]>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTranslation = resolve;
          markStarted();
        }),
    );
    const engine = createTranslationEngine(makeAdapter({ translate }));
    const result = engine.translate({
      text: "Hello",
      source: { kind: "fixed", language: "en" },
      target: "ko",
    });
    await started;

    // When
    engine.destroy();
    if (resolveTranslation === undefined) throw new Error("translation did not start");
    resolveTranslation("안녕하세요");

    // Then
    await expect(result).rejects.toMatchObject({ code: "api-unavailable" });
  });
});
