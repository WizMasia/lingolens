import { LANGUAGE_CHOICES } from "../shared/languages";
import { parseMessage, type RuntimeMessage, type TabState } from "../shared/protocol";
import type { Settings } from "../shared/settings";

const UNSUPPORTED = "지원되지 않는 페이지입니다. 일반 웹페이지에서 다시 시도해 주세요.";

export type PopupDependencies = {
  getState(): Promise<TabState>;
  getSettings(): Promise<Settings>;
  sendToActiveTab(message: RuntimeMessage): Promise<void>;
  openOptions(): void;
};

export type PopupApp = Readonly<{ ready: Promise<void> }>;

export const createPopupApp = (document: Document, dependencies: PopupDependencies): PopupApp => {
  const status = required(document, "status", HTMLParagraphElement);
  const progress = required(document, "progress", HTMLProgressElement);
  const counts = required(document, "counts", HTMLParagraphElement);
  const activeMode = required(document, "active-mode", HTMLParagraphElement);
  const activeTarget = required(document, "active-target", HTMLParagraphElement);
  const error = required(document, "error", HTMLParagraphElement);
  const translate = required(document, "translate-page", HTMLButtonElement);
  const restore = required(document, "restore-page", HTMLButtonElement);
  const options = required(document, "open-options", HTMLButtonElement);

  const render = (state: TabState): void => {
    status.textContent = phaseLabel(state.phase);
    progress.max = Math.max(state.total, 1);
    progress.value = Math.min(state.completed, progress.max);
    counts.textContent =
      state.total === 0
        ? "번역할 페이지를 준비해 주세요."
        : `${state.completed}/${state.total} 완료 · 건너뜀 ${state.skipped} · 실패 ${state.failed}`;
    error.textContent = state.message ?? "";
    translate.disabled = state.phase === "translating" || state.phase === "downloading";
  };

  const run = async (message: RuntimeMessage): Promise<void> => {
    error.textContent = "";
    try {
      await dependencies.sendToActiveTab(message);
      render(await dependencies.getState());
    } catch {
      error.textContent = UNSUPPORTED;
    }
  };

  translate.addEventListener("click", () => void run({ type: "translate-page" }));
  restore.addEventListener("click", () => void run({ type: "restore-page" }));
  options.addEventListener("click", dependencies.openOptions);

  const renderSettings = (settings: Settings): void => {
    activeMode.textContent = `표시: ${settings.displayMode === "inline" ? "원문 아래" : "호버 시 교체"}`;
    const target =
      settings.target.kind === "fixed"
        ? settings.target.language
        : settings.target.resolvedLanguage;
    activeTarget.textContent = `도착 언어: ${languageLabel(target)}`;
  };
  return {
    ready: Promise.all([
      dependencies.getState().then(render),
      dependencies.getSettings().then(renderSettings),
    ]).then(() => undefined),
  };
};

const languageLabel = (value: string): string =>
  LANGUAGE_CHOICES.find((language) => language.value === value)?.label ?? value;

const phaseLabel = (phase: TabState["phase"]): string => {
  switch (phase) {
    case "idle":
      return "준비됨";
    case "downloading":
      return "로컬 모델 준비 중";
    case "translating":
      return "페이지 번역 중";
    case "complete":
      return "번역 완료";
    case "error":
      return "번역을 완료하지 못했습니다";
    default:
      return assertNever(phase);
  }
};

const required = <ElementType extends Element>(
  document: Document,
  id: string,
  elementType: { new (): ElementType },
): ElementType => {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new TypeError(`Missing popup element: ${id}`);
  return element;
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled phase: ${String(value)}`);
};

if (typeof chrome !== "undefined") {
  const dependencies: PopupDependencies = {
    async getState() {
      const value: unknown = await chrome.runtime.sendMessage({ type: "get-tab-state" });
      const message = parseMessage({ type: "tab-state", state: value });
      return message?.type === "tab-state"
        ? message.state
        : { phase: "idle", completed: 0, total: 0, skipped: 0, failed: 0 };
    },
    async getSettings() {
      const stored = await chrome.storage.sync.get("settings");
      const { parseSettings } = await import("../shared/settings");
      return parseSettings(stored["settings"], chrome.i18n.getUILanguage());
    },
    async sendToActiveTab(message) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error("Active tab unavailable");
      await chrome.tabs.sendMessage(tab.id, message);
    },
    openOptions() {
      void chrome.runtime.openOptionsPage();
    },
  };
  createPopupApp(document, dependencies);
}
