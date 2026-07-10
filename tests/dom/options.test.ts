import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOptionsApp } from "../../src/options/options";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLButtonElement: { configurable: true, value: testWindow.HTMLButtonElement },
  HTMLFormElement: { configurable: true, value: testWindow.HTMLFormElement },
  HTMLOutputElement: { configurable: true, value: testWindow.HTMLOutputElement },
  HTMLParagraphElement: { configurable: true, value: testWindow.HTMLParagraphElement },
  HTMLSelectElement: { configurable: true, value: testWindow.HTMLSelectElement },
  KeyboardEvent: { configurable: true, value: testWindow.KeyboardEvent },
  document: { configurable: true, value: testWindow.document },
});

const DEFAULTS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
};

describe("options", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form id="settings-form">
        <input type="radio" name="display-mode" value="inline"><input type="radio" name="display-mode" value="hover">
        <select id="source-language"></select><select id="target-language"></select>
        <button type="button" id="trigger-capture"></button><output id="trigger-value"></output>
        <p id="trigger-warning"></p><button type="submit">Save</button><p id="save-status"></p>
      </form>`;
  });

  it("loads defaults and saves parsed settings", async () => {
    const save = vi.fn<(settings: Settings) => Promise<void>>().mockResolvedValue();
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save,
      uiLanguage: "ko-KR",
    });
    await app.ready;
    const form = document.querySelector<HTMLFormElement>("#settings-form");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(save).toHaveBeenCalledWith(DEFAULTS);
  });

  it("captures modifier-only Control and rejects a bare printable key", async () => {
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save: async () => undefined,
      uiLanguage: "ko",
    });
    await app.ready;
    const capture = document.querySelector<HTMLButtonElement>("#trigger-capture");
    capture?.click();
    capture?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    expect(document.querySelector("#trigger-value")?.textContent).toBe("Ctrl");
    capture?.click();
    capture?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(document.querySelector("#trigger-warning")?.textContent).toContain("조합");
  });
});
