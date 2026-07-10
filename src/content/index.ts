import { parseMessage } from "../shared/protocol";
import { matchesTrigger, parseSettings, type Settings } from "../shared/settings";
import { createTranslationEngine } from "./ai-engine";
import { createChromiumAiAdapter } from "./chromium-ai-adapter";
import { createTranslationController, type TranslationController } from "./controller";
import { nearestTarget } from "./targets";

export type ContentDependencies = Readonly<{
  controller: TranslationController;
  loadSettings(): Promise<Settings>;
}>;

export type ContentApp = Readonly<{
  handleMessage(value: unknown): Promise<unknown> | unknown;
  destroy(): void;
}>;

export const createContentApp = (
  document: Document,
  dependencies: ContentDependencies,
): ContentApp => {
  let settings = dependencies.controller.settings;

  const onPointer = (event: PointerEvent): void => {
    const target = event.target;
    dependencies.controller.setHovered(
      target instanceof Element ? (nearestTarget(target) ?? null) : null,
    );
  };
  const onKey = (event: KeyboardEvent): void => {
    if (isEditable(event.composedPath()[0])) return;
    if (!matchesTrigger(event, settings.trigger)) return;
    event.preventDefault();
    void dependencies.controller.translateTarget();
  };
  const handleMessage = (value: unknown): Promise<unknown> | unknown => {
    const message = parseMessage(value);
    if (message === undefined) return undefined;
    switch (message.type) {
      case "translate-page":
        return dependencies.controller.translatePage();
      case "restore-page":
        dependencies.controller.restorePage();
        return undefined;
      case "get-tab-state":
        return dependencies.controller.getState();
      case "settings-changed":
        return dependencies.loadSettings().then((next) => {
          settings = next;
          dependencies.controller.applySettings(next);
        });
      case "tab-state":
        return undefined;
      default:
        return assertNever(message);
    }
  };

  document.addEventListener("pointerover", onPointer, true);
  document.addEventListener("keydown", onKey, true);
  void dependencies.loadSettings().then((loaded) => {
    settings = loaded;
    dependencies.controller.applySettings(loaded);
  });
  return {
    handleMessage,
    destroy() {
      document.removeEventListener("pointerover", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      dependencies.controller.destroy();
    },
  };
};

const isEditable = (value: EventTarget | undefined): boolean =>
  value instanceof Element &&
  (value.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])") ||
    value.closest("[contenteditable]:not([contenteditable='false'])") !== null);

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled message: ${String(value)}`);
};

if (typeof chrome !== "undefined") {
  const loadSettings = async (): Promise<Settings> => {
    const stored = await chrome.storage.sync.get("settings");
    return parseSettings(stored["settings"], chrome.i18n.getUILanguage());
  };
  void loadSettings().then((settings) => {
    const adapter = createChromiumAiAdapter((event) => {
      void chrome.runtime.sendMessage({
        type: "tab-state",
        state: {
          phase: "downloading",
          completed: Math.round(event.loaded * 100),
          total: 100,
          skipped: 0,
          failed: 0,
        },
      });
    });
    const controller = createTranslationController({
      document,
      engine: createTranslationEngine(adapter),
      settings,
      onState(state) {
        void chrome.runtime.sendMessage({ type: "tab-state", state });
      },
    });
    const app = createContentApp(document, { controller, loadSettings });
    chrome.runtime.onMessage.addListener((value: unknown) => app.handleMessage(value));
    window.addEventListener("pagehide", () => app.destroy(), { once: true });
  });
}
