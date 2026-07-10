import { describe, expect, it, vi } from "vitest";
import {
  type AiAdapter,
  type AiDetection,
  createTranslationEngine,
} from "../../src/content/ai-engine";

const adapterWithDetection = (detect: AiAdapter["detect"]): AiAdapter => ({
  detect,
  detectWithChrome: vi.fn().mockResolvedValue(undefined),
  availability: vi.fn().mockResolvedValue("available"),
  createTranslator: vi.fn(),
  destroy: vi.fn(),
});

describe("translation engine detection lifecycle", () => {
  it("rejects source detection after destruction", async () => {
    const engine = createTranslationEngine(adapterWithDetection(vi.fn()));
    engine.destroy();

    const result = engine.detectSource({ text: "Hello", source: { kind: "auto" } });

    await expect(result).rejects.toMatchObject({ code: "api-unavailable" });
  });

  it("rejects in-flight source detection destroyed before completion", async () => {
    let finish: (detections: readonly AiDetection[]) => void = () => undefined;
    const pending = new Promise<readonly AiDetection[]>((resolve) => {
      finish = resolve;
    });
    const engine = createTranslationEngine(adapterWithDetection(() => pending));
    const result = engine.detectSource({ text: "Hello", source: { kind: "auto" } });
    await Promise.resolve();

    engine.destroy();
    finish([{ detectedLanguage: "en", confidence: 0.9 }]);

    await expect(result).rejects.toMatchObject({ code: "api-unavailable" });
  });
});
