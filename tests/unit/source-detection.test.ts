import { describe, expect, it, vi } from "vitest";
import type { AiAdapter, AiDetection, AiSecondaryDetection } from "../../src/content/ai-engine";
import { createSourceDetector } from "../../src/content/source-detection";

type AdapterOptions = Readonly<{
  detect?: AiAdapter["detect"];
  detections?: readonly (readonly AiDetection[])[];
  chromeDetection?: AiSecondaryDetection;
}>;

const makeAdapter = (options: AdapterOptions = {}): AiAdapter => ({
  detect:
    options.detect ??
    vi
      .fn()
      .mockResolvedValueOnce(options.detections?.[0] ?? [])
      .mockResolvedValueOnce(options.detections?.[1] ?? []),
  detectWithChrome: vi.fn().mockResolvedValue(options.chromeDetection),
  availability: vi.fn().mockResolvedValue("available"),
  createTranslator: vi.fn(),
  destroy: vi.fn(),
});

describe("source detection", () => {
  it("retries uncertain element text with context", async () => {
    const detect = vi
      .fn<AiAdapter["detect"]>()
      .mockResolvedValueOnce([{ detectedLanguage: "en", confidence: 0.4 }])
      .mockResolvedValueOnce([{ detectedLanguage: "fr", confidence: 0.91 }]);
    const detector = createSourceDetector(makeAdapter({ detect }));

    await expect(
      detector({ text: "Bref", source: { kind: "auto", context: "Une phrase française" } }),
    ).resolves.toEqual({ kind: "detected", language: "fr", provenance: "context-detector" });
    expect(detect).toHaveBeenNthCalledWith(1, "Bref");
    expect(detect).toHaveBeenNthCalledWith(2, "Bref Une phrase française");
  });

  it("accepts reliable CLD evidence after detector uncertainty", async () => {
    const detector = createSourceDetector(
      makeAdapter({
        detections: [[{ detectedLanguage: "fr", confidence: 0.41 }]],
        chromeDetection: { reliable: true, languages: [{ language: "fr", percentage: 74 }] },
      }),
    );

    await expect(detector({ text: "Bref", source: { kind: "auto" } })).resolves.toEqual({
      kind: "detected",
      language: "fr",
      provenance: "chrome-i18n",
    });
  });

  it("requires agreement for unreliable CLD evidence", async () => {
    const detector = createSourceDetector(
      makeAdapter({
        detections: [[{ detectedLanguage: "fr", confidence: 0.4 }]],
        chromeDetection: { reliable: false, languages: [{ language: "en", percentage: 95 }] },
      }),
    );

    await expect(detector({ text: "Nom", source: { kind: "auto" } })).resolves.toEqual({
      kind: "needs-confirmation",
    });
  });

  it.each([
    [80, "detected"],
    [79, "needs-confirmation"],
  ] as const)("applies the unreliable CLD threshold at %i", async (percentage, kind) => {
    const detector = createSourceDetector(
      makeAdapter({
        detections: [[{ detectedLanguage: "fr", confidence: 0.4 }]],
        chromeDetection: { reliable: false, languages: [{ language: "fr", percentage }] },
      }),
    );

    await expect(detector({ text: "Nom", source: { kind: "auto" } })).resolves.toMatchObject({
      kind,
    });
  });

  it.each(["und", "not_a_language"])("rejects malformed CLD language %s", async (language) => {
    const detector = createSourceDetector(
      makeAdapter({
        chromeDetection: { reliable: true, languages: [{ language, percentage: 100 }] },
      }),
    );

    await expect(detector({ text: "1234", source: { kind: "auto" } })).resolves.toEqual({
      kind: "needs-confirmation",
    });
  });

  it("continues after primary detector rejection", async () => {
    const detect = vi.fn<AiAdapter["detect"]>().mockRejectedValue(new Error("detector failed"));
    const detector = createSourceDetector(
      makeAdapter({
        detect,
        chromeDetection: { reliable: true, languages: [{ language: "ar", percentage: 20 }] },
      }),
    );

    await expect(detector({ text: "1234", source: { kind: "auto" } })).resolves.toEqual({
      kind: "detected",
      language: "ar",
      provenance: "chrome-i18n",
    });
  });

  it("continues after secondary detector rejection", async () => {
    const adapter = makeAdapter({ detections: [[{ detectedLanguage: "en", confidence: 0.1 }]] });
    const detector = createSourceDetector({
      ...adapter,
      detectWithChrome: vi.fn().mockRejectedValue(new Error("CLD failed")),
    });

    await expect(detector({ text: "안녕하세요", source: { kind: "auto" } })).resolves.toEqual({
      kind: "detected",
      language: "ko",
      provenance: "script",
    });
  });

  it("uses a valid language hint with lang provenance", async () => {
    const adapter = makeAdapter();
    const detector = createSourceDetector(adapter);

    await expect(
      detector({ text: "Bonjour", source: { kind: "auto", languageHint: "fr-FR" } }),
    ).resolves.toEqual({ kind: "detected", language: "fr", provenance: "lang" });
    expect(adapter.detect).not.toHaveBeenCalled();
  });

  it("uses a fixed source with user provenance", async () => {
    const detector = createSourceDetector(makeAdapter());

    await expect(
      detector({ text: "Hello", source: { kind: "fixed", language: "en-US" } }),
    ).resolves.toEqual({
      kind: "detected",
      language: "en",
      provenance: "user",
    });
  });
});
