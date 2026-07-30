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
  HTMLInputElement: { configurable: true, value: testWindow.HTMLInputElement },
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
  liveChatNanoEnabled: false,
  pdfTranslationEnabled: true,
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

describe("options", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form id="settings-form">
        <input type="radio" name="display-mode" value="inline"><input type="radio" name="display-mode" value="hover">
        <select id="source-language"></select><select id="target-language"></select>
        <button type="button" id="trigger-capture"></button><output id="trigger-value"></output>
        <p id="trigger-warning"></p>
        <button type="button" id="menu-trigger-capture"></button><output id="menu-trigger-value"></output>
        <p id="menu-trigger-warning"></p><button type="submit">Save</button><p id="save-status"></p>
        <section>
          <input type="checkbox" id="pdf-translation-enabled">
          <input type="checkbox" id="live-chat-nano">
          <button type="button" id="prepare-live-chat-nano"></button>
          <p id="nano-status"></p>
        </section>
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

  it("keeps Nano assistance disabled by default and saves an explicit opt-in", async () => {
    // Given
    const save = vi.fn<(settings: Settings) => Promise<void>>().mockResolvedValue();
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save,
      uiLanguage: "ko",
    });
    await app.ready;

    // When
    document.querySelector<HTMLInputElement>("#live-chat-nano")?.click();
    document
      .querySelector<HTMLFormElement>("#settings-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    // Then
    expect(save).toHaveBeenCalledWith({ ...DEFAULTS, liveChatNanoEnabled: true });
  });

  it("loads and saves the PDF translation toggle", async () => {
    const save = vi.fn<(settings: Settings) => Promise<void>>().mockResolvedValue();
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save,
      uiLanguage: "ko",
    });
    await app.ready;

    const toggle = document.querySelector<HTMLInputElement>("#pdf-translation-enabled");
    expect(toggle?.checked).toBe(true);
    toggle?.click();
    document
      .querySelector<HTMLFormElement>("#settings-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(save).toHaveBeenCalledWith({ ...DEFAULTS, pdfTranslationEnabled: false });
  });

  it("reports unavailable Nano preparation without changing the setting", async () => {
    // Given
    const prepareNano = vi.fn().mockResolvedValue("unavailable");
    const authorizeNano = vi.fn().mockResolvedValue(undefined);
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save: async () => undefined,
      uiLanguage: "ko",
      prepareNano,
      authorizeNano,
    });
    await app.ready;

    // When
    document.querySelector<HTMLButtonElement>("#prepare-live-chat-nano")?.click();
    await Promise.resolve();

    // Then
    expect(prepareNano).toHaveBeenCalledOnce();
    expect(authorizeNano).not.toHaveBeenCalled();
    expect(document.querySelector("#nano-status")?.textContent).toContain("사용할 수 없습니다");
  });

  it("authorizes this extension session only after an explicit successful preparation", async () => {
    const authorizeNano = vi.fn().mockResolvedValue(undefined);
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save: async () => undefined,
      uiLanguage: "ko",
      prepareNano: async () => "ready",
      authorizeNano,
    });
    await app.ready;

    document.querySelector<HTMLButtonElement>("#prepare-live-chat-nano")?.click();
    await Promise.resolve();

    expect(authorizeNano).toHaveBeenCalledOnce();
  });

  it("prepares Nano only after a button click and reports progress", async () => {
    // Given
    let completePreparation = (): void => undefined;
    const prepareNano = vi
      .fn<(onProgress: (loaded: number) => void) => Promise<"ready" | "unavailable">>()
      .mockImplementation(
        (onProgress) =>
          new Promise((resolve) => {
            onProgress(0.556);
            completePreparation = () => resolve("ready");
          }),
      );
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save: async () => undefined,
      uiLanguage: "ko",
      prepareNano,
    });
    await app.ready;
    expect(prepareNano).not.toHaveBeenCalled();

    // When
    document.querySelector<HTMLButtonElement>("#prepare-live-chat-nano")?.click();
    await Promise.resolve();

    // Then
    expect(prepareNano).toHaveBeenCalledOnce();
    expect(document.querySelector("#nano-status")?.textContent).toBe("로컬 모델 준비 중: 56%");
    completePreparation();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("#nano-status")?.textContent).toBe("준비됨");
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

  it("captures and saves the translation and menu shortcuts independently", async () => {
    const save = vi.fn<(settings: Settings) => Promise<void>>().mockResolvedValue();
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save,
      uiLanguage: "ko",
    });
    await app.ready;
    const translationCapture = document.querySelector<HTMLButtonElement>("#trigger-capture");
    translationCapture?.click();
    translationCapture?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "T", ctrlKey: true, bubbles: true }),
    );
    const menuCapture = document.querySelector<HTMLButtonElement>("#menu-trigger-capture");
    menuCapture?.click();
    menuCapture?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "M",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    document
      .querySelector<HTMLFormElement>("#settings-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(document.querySelector("#trigger-value")?.textContent).toBe("Ctrl + T");
    expect(document.querySelector("#menu-trigger-value")?.textContent).toBe("Ctrl + Shift + M");
    expect(save).toHaveBeenCalledWith({
      ...DEFAULTS,
      trigger: { key: "T", ctrl: true, alt: false, meta: false, shift: false },
      menuTrigger: { key: "M", ctrl: true, alt: false, meta: false, shift: true },
    });
  });

  it("rejects a menu shortcut that is identical to the translation shortcut", async () => {
    const save = vi.fn<(settings: Settings) => Promise<void>>().mockResolvedValue();
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save,
      uiLanguage: "ko",
    });
    await app.ready;
    const menuCapture = document.querySelector<HTMLButtonElement>("#menu-trigger-capture");
    menuCapture?.click();
    menuCapture?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }),
    );
    menuCapture?.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true }));

    expect(document.querySelector("#menu-trigger-warning")?.textContent).toContain(
      "같을 수 없습니다",
    );
    expect(document.querySelector("#menu-trigger-value")?.textContent).toBe("Ctrl + Shift");
  });

  it("cancels capture with Escape or Tab without trapping keyboard focus", async () => {
    const app = createOptionsApp(document, {
      load: async () => DEFAULTS,
      save: async () => undefined,
      uiLanguage: "ko",
    });
    await app.ready;
    const capture = document.querySelector<HTMLButtonElement>("#menu-trigger-capture");
    capture?.click();
    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    capture?.dispatchEvent(escapeEvent);
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(document.querySelector("#menu-trigger-warning")?.textContent).toContain("취소");

    capture?.click();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    capture?.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(document.querySelector("#menu-trigger-warning")?.textContent).toContain("취소");
  });
});
