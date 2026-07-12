import { describe, expect, it, vi } from "vitest";
import { createLiveChatLanguageMemory } from "../../src/content/live-chat-language-memory";
import {
  createNanoLanguageDetector,
  createNanoPreparation,
  type NanoLanguageResponseSource,
  type NanoPreparationApi,
} from "../../src/content/nano-language-detector";

const fakeNano = (reply: string): NanoLanguageResponseSource => vi.fn().mockResolvedValue(reply);

describe("Nano language detector", () => {
  it("accepts only a normalized, sufficiently confident constrained decision", async () => {
    // Given
    const detector = createNanoLanguageDetector(fakeNano('{"language":"es-ES","confidence":0.8}'));

    // When
    const decision = detector.detect("hola", "buenos días");

    // Then
    await expect(decision).resolves.toEqual({ kind: "detected", language: "es", confidence: 0.8 });
  });

  it.each([
    '{"language":"und","confidence":0.9}',
    '{"language":"sv","confidence":0.9}',
    '{"language":"es","confidence":0.79}',
    '{"language":"es","confidence":1.01}',
    "not json",
  ])("rejects unsafe Nano output %s", async (reply) => {
    // Given
    const detector = createNanoLanguageDetector(fakeNano(reply));

    // When
    const decision = detector.detect("hola", "");

    // Then
    await expect(decision).resolves.toEqual({ kind: "unavailable" });
  });
});

describe("Nano preparation", () => {
  it("creates and releases a downloadable local model only when explicitly prepared", async () => {
    // Given
    const destroy = vi.fn();
    const create = vi.fn<NanoPreparationApi["create"]>().mockResolvedValue({ destroy });
    const preparation = createNanoPreparation({
      availability: async () => "downloadable",
      create,
    });

    // When
    const result = await preparation.prepare(vi.fn());

    // Then
    expect(result).toBe("ready");
    expect(create).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("does not create a model when Nano is unavailable", async () => {
    // Given
    const create = vi.fn<NanoPreparationApi["create"]>();
    const preparation = createNanoPreparation({
      availability: async () => "unavailable",
      create,
    });

    // When
    const result = await preparation.prepare(vi.fn());

    // Then
    expect(result).toBe("unavailable");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("live-chat language memory", () => {
  it("keeps a selected source isolated to one author and clears it", () => {
    // Given
    const memory = createLiveChatLanguageMemory();
    memory.set("/channel/one", "hi");
    expect(memory.get("/channel/one")).toBe("hi");

    // When
    memory.clear("/channel/one");

    // Then
    expect(memory.get("/channel/two")).toBeUndefined();
    expect(memory.get("/channel/one")).toBeUndefined();
  });

  it("removes all selected sources when destroyed", () => {
    // Given
    const memory = createLiveChatLanguageMemory();
    memory.set("/channel/one", "hi");
    memory.set("/channel/two", "ur");

    // When
    memory.destroy();

    // Then
    expect(memory.get("/channel/one")).toBeUndefined();
    expect(memory.get("/channel/two")).toBeUndefined();
  });
});
