import { describe, expect, it } from "vitest";
import { parseNanoOffscreenResponse } from "../../src/offscreen/nano-offscreen";

describe("Nano offscreen response parser", () => {
  it("returns a detected decision for a valid constrained response", () => {
    // Given
    const response = '{"language":"es","confidence":0.9}';

    // When
    const decision = parseNanoOffscreenResponse(response);

    // Then
    expect(decision).toEqual({ kind: "detected", language: "es", confidence: 0.9 });
  });
});
