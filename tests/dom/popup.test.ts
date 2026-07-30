import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPopupApp, type PopupDependencies } from "../../src/popup/popup";
import type { RuntimeMessage, TabState } from "../../src/shared/protocol";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: testWindow.Element },
  HTMLButtonElement: { configurable: true, value: testWindow.HTMLButtonElement },
  HTMLParagraphElement: { configurable: true, value: testWindow.HTMLParagraphElement },
  HTMLProgressElement: { configurable: true, value: testWindow.HTMLProgressElement },
  document: { configurable: true, value: testWindow.document },
});

const state = (overrides: Partial<TabState> = {}): TabState => ({
  phase: "idle",
  completed: 0,
  total: 0,
  skipped: 0,
  failed: 0,
  ...overrides,
});

const fixture = (): PopupDependencies & { sent: RuntimeMessage[] } => {
  const sent: RuntimeMessage[] = [];
  return {
    sent,
    getState: async () => state(),
    getSettings: async () =>
      ({
        displayMode: "hover",
        source: { kind: "auto" },
        target: { kind: "fixed", language: "ja" },
        liveChatNanoEnabled: false,
        pdfTranslationEnabled: true,
        trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
        menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
      }) satisfies Settings,
    sendToActiveTab: async (message) => {
      sent.push(message);
    },
    openOptions: vi.fn(),
  };
};

describe("popup", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main><p id="status"></p><progress id="progress"></progress>
      <p id="counts"></p><p id="active-mode"></p><p id="active-target"></p><p id="error"></p>
      <button id="translate-page"></button><button id="restore-page"></button>
      <button id="open-current-pdf"></button><button id="open-local-pdf"></button>
      <p id="pdf-helper"></p>
      <button id="open-options"></button></main>`;
  });

  it("sends translate and restore commands", async () => {
    const dependencies = fixture();
    const app = createPopupApp(document, dependencies);
    await app.ready;
    document.querySelector<HTMLButtonElement>("#translate-page")?.click();
    document.querySelector<HTMLButtonElement>("#restore-page")?.click();
    await Promise.resolve();
    expect(dependencies.sent).toEqual([{ type: "translate-page" }, { type: "restore-page" }]);
  });

  it("renders progress without dividing by zero", async () => {
    const dependencies = fixture();
    dependencies.getState = async () => state({ phase: "translating", completed: 0, total: 0 });
    const app = createPopupApp(document, dependencies);
    await app.ready;
    const progress = document.querySelector<HTMLProgressElement>("#progress");
    expect(progress?.max).toBe(1);
    expect(progress?.value).toBe(0);
  });

  it("shows an unsupported-page explanation when tab messaging fails", async () => {
    const dependencies = fixture();
    dependencies.sendToActiveTab = async () => {
      throw new Error("no receiver");
    };
    const app = createPopupApp(document, dependencies);
    await app.ready;
    document.querySelector<HTMLButtonElement>("#translate-page")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#error")?.textContent).toContain("지원되지 않는 페이지");
  });

  it("shows the active display mode and target language", async () => {
    const dependencies = fixture();
    const app = createPopupApp(document, dependencies);
    await app.ready;
    expect(document.querySelector("#active-mode")?.textContent).toContain("호버");
    expect(document.querySelector("#active-target")?.textContent).toContain("일본어");
  });

  it("opens current and local PDFs through the background coordinator", async () => {
    const dependencies = fixture();
    const app = createPopupApp(document, dependencies);
    await app.ready;
    document.querySelector<HTMLButtonElement>("#open-current-pdf")?.click();
    document.querySelector<HTMLButtonElement>("#open-local-pdf")?.click();
    await Promise.resolve();
    expect(dependencies.sent).toContainEqual({
      type: "open-pdf-viewer",
      source: "current-tab",
    });
    expect(dependencies.sent).toContainEqual({ type: "open-pdf-viewer", source: "local" });
  });

  it("disables PDF actions and explains the option when PDF translation is off", async () => {
    const dependencies = fixture();
    const enabled = await dependencies.getSettings();
    dependencies.getSettings = async () => ({ ...enabled, pdfTranslationEnabled: false });
    const app = createPopupApp(document, dependencies);
    await app.ready;
    expect(document.querySelector<HTMLButtonElement>("#open-current-pdf")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#open-local-pdf")?.disabled).toBe(true);
    expect(document.querySelector("#pdf-helper")?.textContent).toContain("꺼져 있습니다");
  });
});
