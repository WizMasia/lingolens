import { describe, expect, it, vi } from "vitest";
import {
  createNanoOffscreenMessageHandler,
  parseNanoOffscreenResponse,
} from "../../src/offscreen/nano-offscreen";

describe("Nano offscreen response parser", () => {
  it("returns a detected decision for a valid constrained response", () => {
    // Given
    const response = '{"language":"es","confidence":0.9}';

    // When
    const decision = parseNanoOffscreenResponse(response);

    // Then
    expect(decision).toEqual({ kind: "detected", language: "es", confidence: 0.9 });
  });

  it("accepts Nano detection messages only from the background worker", async () => {
    // Given
    const detect = vi.fn().mockResolvedValue({ kind: "unavailable" });
    const handler = createNanoOffscreenMessageHandler({
      detect,
      isBackgroundSender: (sender) => sender.url === "chrome-extension://fixture/background.js",
    });

    // When
    const rejected = handler(
      { type: "offscreen-nano-detect", text: "hola", context: "context" },
      { url: "chrome-extension://fixture/options.html" },
    );
    const accepted = handler(
      { type: "offscreen-nano-detect", text: "hola", context: "context" },
      { url: "chrome-extension://fixture/background.js" },
    );

    // Then
    expect(rejected).toBeUndefined();
    await expect(accepted).resolves.toEqual({ kind: "unavailable" });
    expect(detect).toHaveBeenCalledOnce();
  });
});
