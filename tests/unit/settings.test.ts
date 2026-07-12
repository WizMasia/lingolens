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

  it("defaults Nano assistance to disabled with automatic source, browser target, hover, and Control", () => {
    expect(parseSettings(undefined, "ko-KR")).toEqual({
      displayMode: "hover",
      source: { kind: "auto" },
      target: { kind: "browser", resolvedLanguage: "ko" },
      liveChatNanoEnabled: false,
      trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
      menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
    });
  });

  it("enables Nano assistance only for a literal true setting", () => {
    // Given
    const enabled = { liveChatNanoEnabled: true };

    // When
    const parsedEnabled = parseSettings(enabled, "ko-KR");
    const parsedString = parseSettings({ liveChatNanoEnabled: "true" }, "ko-KR");

    // Then
    expect(parsedEnabled.liveChatNanoEnabled).toBe(true);
    expect(parsedString.liveChatNanoEnabled).toBe(false);
  });

  it("preserves a legacy translation trigger and supplies the menu default", () => {
    expect(
      parseSettings(
        { trigger: { key: "T", ctrl: true, alt: false, meta: false, shift: false } },
        "ko-KR",
      ),
    ).toMatchObject({
      trigger: { key: "T", ctrl: true, alt: false, meta: false, shift: false },
      menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
    });
  });

  it("preserves a legacy Alt-containing translation trigger", () => {
    const trigger = { key: "T", ctrl: true, alt: true, meta: false, shift: false };
    expect(parseSettings({ trigger }, "ko-KR").trigger).toEqual(trigger);
  });

  it("repairs an identical menu trigger without changing the translation trigger", () => {
    const binding = { key: "Control", ctrl: false, alt: false, meta: false, shift: true };

    expect(parseSettings({ trigger: binding, menuTrigger: binding }, "ko-KR")).toMatchObject({
      trigger: binding,
      menuTrigger: { key: "L", ctrl: true, alt: false, meta: false, shift: true },
    });

    expect(
      parseSettings(
        {
          trigger: binding,
          menuTrigger: { key: "Shift", ctrl: true, alt: false, meta: false, shift: false },
        },
        "ko-KR",
      ).menuTrigger,
    ).toEqual({ key: "L", ctrl: true, alt: false, meta: false, shift: true });
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
    expect(
      matchesTrigger(
        new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, repeat: true }),
        parseSettings(undefined, "ko").trigger,
      ),
    ).toBe(false);

    if (originalKeyboardEvent === undefined) {
      Reflect.deleteProperty(globalThis, "KeyboardEvent");
    } else {
      Object.defineProperty(globalThis, "KeyboardEvent", originalKeyboardEvent);
    }
  });

  it("matches a modifier-only chord regardless of which modifier is pressed last", () => {
    const window = new Window();
    const originalKeyboardEvent = Object.getOwnPropertyDescriptor(globalThis, "KeyboardEvent");
    Object.defineProperty(globalThis, "KeyboardEvent", {
      configurable: true,
      value: window.KeyboardEvent,
    });
    const trigger = parseSettings(undefined, "ko").menuTrigger;

    expect(
      matchesTrigger(
        new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, shiftKey: true }),
        trigger,
      ),
    ).toBe(true);
    expect(
      matchesTrigger(
        new KeyboardEvent("keydown", { key: "Shift", ctrlKey: true, shiftKey: true }),
        trigger,
      ),
    ).toBe(true);

    if (originalKeyboardEvent === undefined) {
      Reflect.deleteProperty(globalThis, "KeyboardEvent");
    } else {
      Object.defineProperty(globalThis, "KeyboardEvent", originalKeyboardEvent);
    }
  });
});
