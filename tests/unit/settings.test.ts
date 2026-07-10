import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  matchesMenuTrigger,
  matchesTrigger,
  parseSettings,
  resolveBrowserTarget,
} from "../../src/shared/settings";

describe("settings", () => {
  it("falls back from an unusable browser language to Korean", () => {
    expect(resolveBrowserTarget("und")).toBe("ko");
  });

  it("normalizes a regional browser language to its base", () => {
    expect(resolveBrowserTarget("pt-BR")).toBe("pt");
  });

  it("defaults to automatic source, browser target, hover, and Control", () => {
    expect(parseSettings(undefined, "ko-KR")).toEqual({
      displayMode: "hover",
      source: { kind: "auto" },
      target: { kind: "browser", resolvedLanguage: "ko" },
      trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
    });
  });

  it("preserves an explicitly saved inline display mode", () => {
    expect(parseSettings({ displayMode: "inline" }, "ko-KR").displayMode).toBe("inline");
  });

  it("falls back to hover for an invalid saved display mode", () => {
    expect(parseSettings({ displayMode: "invalid" }, "ko-KR").displayMode).toBe("hover");
  });

  it("rejects Escape as a saved translation trigger", () => {
    expect(
      parseSettings(
        { trigger: { key: "Escape", ctrl: false, alt: false, meta: false, shift: false } },
        "ko-KR",
      ).trigger,
    ).toEqual({ key: "Control", ctrl: false, alt: false, meta: false, shift: false });
  });

  it("rejects a differently cased saved Escape trigger", () => {
    expect(
      parseSettings(
        { trigger: { key: "escape", ctrl: false, alt: false, meta: false, shift: false } },
        "ko-KR",
      ).trigger,
    ).toEqual({ key: "Control", ctrl: false, alt: false, meta: false, shift: false });
  });

  it("rejects saved primary triggers that reserve Alt for the element menu", () => {
    expect(
      parseSettings(
        { trigger: { key: "Control", ctrl: false, alt: true, meta: false, shift: false } },
        "ko-KR",
      ).trigger,
    ).toEqual({ key: "Control", ctrl: false, alt: false, meta: false, shift: false });

    expect(
      parseSettings(
        { trigger: { key: "T", ctrl: true, alt: true, meta: false, shift: false } },
        "ko-KR",
      ).trigger,
    ).toEqual({ key: "Control", ctrl: false, alt: false, meta: false, shift: false });
  });

  it("rejects bare Alt as a saved primary translation trigger", () => {
    expect(
      parseSettings(
        { trigger: { key: "aLt", ctrl: false, alt: false, meta: false, shift: false } },
        "ko-KR",
      ).trigger,
    ).toEqual({ key: "Control", ctrl: false, alt: false, meta: false, shift: false });
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

  it("classifies Alt plus Control as an element-menu trigger instead of a primary trigger", () => {
    const window = new Window();
    const originalKeyboardEvent = Object.getOwnPropertyDescriptor(globalThis, "KeyboardEvent");
    Object.defineProperty(globalThis, "KeyboardEvent", {
      configurable: true,
      value: window.KeyboardEvent,
    });
    const trigger = parseSettings(undefined, "ko").trigger;
    const event = new KeyboardEvent("keydown", {
      key: "Control",
      ctrlKey: true,
      altKey: true,
    });

    expect(matchesTrigger(event, trigger)).toBe(false);
    expect(matchesMenuTrigger(event, trigger)).toBe(true);

    if (originalKeyboardEvent === undefined) {
      Reflect.deleteProperty(globalThis, "KeyboardEvent");
    } else {
      Object.defineProperty(globalThis, "KeyboardEvent", originalKeyboardEvent);
    }
  });
});
