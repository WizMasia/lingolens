import { afterEach, describe, expect, it, vi } from "vitest";
import { TranslationError } from "../../src/content/ai-engine";
import { createChromiumAiAdapter } from "../../src/content/chromium-ai-adapter";

const detectorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "LanguageDetector");
const translatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Translator");
const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "chrome");

const restoreGlobal = (
  name: "LanguageDetector" | "Translator" | "chrome",
  descriptor?: PropertyDescriptor,
) => {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }
  Object.defineProperty(globalThis, name, descriptor);
};

afterEach(() => {
  restoreGlobal("LanguageDetector", detectorDescriptor);
  restoreGlobal("Translator", translatorDescriptor);
  restoreGlobal("chrome", chromeDescriptor);
});

describe("Chromium AI adapter", () => {
  it("maps Chrome i18n language evidence", async () => {
    const detectLanguage: (text: string) => Promise<{
      readonly isReliable: boolean;
      readonly languages: readonly Readonly<{ language: string; percentage: number }>[];
    }> = vi.fn().mockResolvedValue({
      isReliable: true,
      languages: [
        { language: "fr", percentage: 91 },
        { language: "en", percentage: 9 },
      ],
    });
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { i18n: { detectLanguage } },
    });

    const adapter = createChromiumAiAdapter();

    await expect(adapter.detectWithChrome("Bonjour tout le monde")).resolves.toEqual({
      reliable: true,
      languages: [
        { language: "fr", percentage: 91 },
        { language: "en", percentage: 9 },
      ],
    });
  });

  it("returns no secondary evidence when Chrome i18n fails", async () => {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        i18n: { detectLanguage: vi.fn().mockRejectedValue(new Error("CLD failed")) },
      },
    });

    await expect(
      createChromiumAiAdapter().detectWithChrome("Brief"),
    ).resolves.toBeUndefined();
  });

  it("returns no secondary evidence for non-Error Chrome i18n failures", async () => {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { i18n: { detectLanguage: vi.fn().mockRejectedValue("CLD failed") } },
    });

    await expect(
      createChromiumAiAdapter().detectWithChrome("Brief"),
    ).resolves.toBeUndefined();
  });

  it("returns no secondary evidence when Chrome i18n throws synchronously", async () => {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        i18n: {
          detectLanguage: vi.fn().mockImplementation(() => {
            throw new Error("sync CLD failure");
          }),
        },
      },
    });

    await expect(
      createChromiumAiAdapter().detectWithChrome("Brief"),
    ).resolves.toBeUndefined();
  });

  it("reports API absence without reading missing globals", async () => {
    // Given
    Reflect.deleteProperty(globalThis, "LanguageDetector");
    Reflect.deleteProperty(globalThis, "Translator");
    const adapter = createChromiumAiAdapter();

    // When
    const result = adapter.detect("Hello");

    // Then
    await expect(result).rejects.toEqual(
      new TranslationError("api-unavailable", "Chromium Language Detector API is unavailable"),
    );
  });

  it("forwards model download progress and destroys native models once", async () => {
    // Given
    const progress = vi.fn();
    let detectorDestroyed = 0;
    let translatorDestroyed = 0;
    class FakeMonitor extends EventTarget {
      ondownloadprogress: ((event: ProgressEvent) => void) | null = null;
    }
    class FakeLanguageDetector {
      static async availability(): Promise<Availability> {
        return "downloadable";
      }
      static async create(options?: LanguageDetectorCreateOptions): Promise<FakeLanguageDetector> {
        const monitor = new FakeMonitor();
        options?.monitor?.(monitor);
        monitor.dispatchEvent(new Event("downloadprogress"));
        return new FakeLanguageDetector();
      }
      async detect(): Promise<LanguageDetectionResult[]> {
        return [{ detectedLanguage: "en", confidence: 0.99 }];
      }
      destroy(): void {
        detectorDestroyed += 1;
      }
    }
    class FakeTranslator {
      static async availability(): Promise<Availability> {
        return "downloadable";
      }
      static async create(options: TranslatorCreateOptions): Promise<FakeTranslator> {
        const monitor = new FakeMonitor();
        options.monitor?.(monitor);
        monitor.dispatchEvent(new Event("downloadprogress"));
        return new FakeTranslator();
      }
      async translate(text: string): Promise<string> {
        return `${text}-ko`;
      }
      destroy(): void {
        translatorDestroyed += 1;
      }
    }
    Object.defineProperty(globalThis, "LanguageDetector", {
      configurable: true,
      value: FakeLanguageDetector,
    });
    Object.defineProperty(globalThis, "Translator", {
      configurable: true,
      value: FakeTranslator,
    });
    const adapter = createChromiumAiAdapter(progress);

    // When
    await adapter.detect("Hello");
    const translator = await adapter.createTranslator("en", "ko");
    const translated = await translator.translate("Hello");
    adapter.destroy();
    adapter.destroy();

    // Then
    expect(translated).toBe("Hello-ko");
    expect(progress).toHaveBeenCalledTimes(2);
    expect(detectorDestroyed).toBe(1);
    expect(translatorDestroyed).toBe(1);
  });
});
