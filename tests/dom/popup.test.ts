import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPopupApp, type PopupDependencies } from "../../src/popup/popup";
import type { RuntimeMessage, TabState } from "../../src/shared/protocol";

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
      <p id="counts"></p><p id="error"></p>
      <button id="translate-page"></button><button id="restore-page"></button>
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
});
