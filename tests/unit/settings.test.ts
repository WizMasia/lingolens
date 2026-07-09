import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { matchesTrigger, parseSettings, resolveBrowserTarget } from "../../src/shared/settings";

describe("settings", () => {
  it("falls back from an unusable browser language to Korean", () => {
    expect(resolveBrowserTarget("und")).toBe("ko");
  });

  it("normalizes a regional browser language to its base", () => {
    expect(resolveBrowserTarget("pt-BR")).toBe("pt");
  });

  it("defaults to automatic source, browser target, inline, and Control", () => {
    expect(parseSettings(undefined, "ko-KR")).toEqual({
      displayMode: "inline",
      source: { kind: "auto" },
      target: { kind: "browser", resolvedLanguage: "ko" },
      trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
    });
  });

  it("matches modifier-only Control without firing on repeats", () => {
    const window = new Window();
    const originalKeyboardEvent = Object.getOwnPropertyDescriptor(globalThis, "KeyboardEvent");
    Object.defineProperty(globalThis, "KeyboardEvent", {
      configurable: true,
      value: window.KeyboardEvent,
    });
    const event = new KeyboardEvent("keydown", {
      key: "Control",
      ctrlKey: true,
      repeat: false,
    });

    expect(matchesTrigger(event, parseSettings(undefined, "ko").trigger)).toBe(true);

    if (originalKeyboardEvent === undefined) {
      Reflect.deleteProperty(globalThis, "KeyboardEvent");
    } else {
      Object.defineProperty(globalThis, "KeyboardEvent", originalKeyboardEvent);
    }
  });
});
