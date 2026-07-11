import { describe, expect, it } from "vitest";
import { parseMessage } from "../../src/shared/protocol";

describe("runtime message protocol", () => {
  it("parses a translate-page command", () => {
    expect(parseMessage({ type: "translate-page" })).toEqual({ type: "translate-page" });
  });

  it("parses a start-live-chat command", () => {
    expect(parseMessage({ type: "start-live-chat" })).toEqual({ type: "start-live-chat" });
  });

  it("parses a stop-live-chat command", () => {
    expect(parseMessage({ type: "stop-live-chat" })).toEqual({ type: "stop-live-chat" });
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
