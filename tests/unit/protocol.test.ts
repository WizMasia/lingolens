import { describe, expect, it } from "vitest";
import { parseMessage } from "../../src/shared/protocol";

describe("runtime message protocol", () => {
  it("parses a translate-page command", () => {
    expect(parseMessage({ type: "translate-page" })).toEqual({ type: "translate-page" });
  });

  it("parses PDF viewer commands and rejects unknown sources", () => {
    expect(parseMessage({ type: "open-pdf-viewer", source: "current-tab" })).toEqual({
      type: "open-pdf-viewer",
      source: "current-tab",
    });
    expect(parseMessage({ type: "open-pdf-viewer", source: "local" })).toEqual({
      type: "open-pdf-viewer",
      source: "local",
    });
    expect(parseMessage({ type: "open-pdf-viewer", source: "file-url" })).toBeUndefined();
  });

  it("parses a start-live-chat command", () => {
    expect(parseMessage({ type: "start-live-chat" })).toEqual({ type: "start-live-chat" });
  });

  it("parses a stop-live-chat command", () => {
    expect(parseMessage({ type: "stop-live-chat" })).toEqual({ type: "stop-live-chat" });
  });

  it("parses an explicit Nano session authorization", () => {
    expect(parseMessage({ type: "nano-session-authorized" })).toEqual({
      type: "nano-session-authorized",
    });
  });

  it("parses a Nano source detection request", () => {
    expect(
      parseMessage({ type: "detect-nano-source", text: "hola", context: "buenos días" }),
    ).toEqual({
      type: "detect-nano-source",
      text: "hola",
      context: "buenos días",
    });
  });

  it("rejects a malformed Nano source detection request", () => {
    expect(parseMessage({ type: "detect-nano-source", text: 3, context: "x" })).toBeUndefined();
  });

  it("rejects an oversized Nano source request before it reaches the worker bridge", () => {
    expect(
      parseMessage({ type: "detect-nano-source", text: "x".repeat(1_001), context: "context" }),
    ).toBeUndefined();
  });

  it("rejects an oversized offscreen Nano detection request", () => {
    expect(
      parseMessage({ type: "offscreen-nano-detect", text: "x".repeat(1_001), context: "context" }),
    ).toBeUndefined();
  });

  it("parses an offscreen Nano detection request", () => {
    expect(
      parseMessage({ type: "offscreen-nano-detect", text: "hola", context: "context" }),
    ).toEqual({
      type: "offscreen-nano-detect",
      text: "hola",
      context: "context",
    });
  });

  it("rejects a tab state with a malformed count", () => {
    expect(
      parseMessage({
        type: "tab-state",
        state: {
          phase: "translating",
          completed: "one",
          total: 4,
          skipped: 0,
          failed: 0,
        },
      }),
    ).toBeUndefined();
  });

  it("rejects an unknown message tag", () => {
    expect(parseMessage({ type: "unexpected" })).toBeUndefined();
  });
});
