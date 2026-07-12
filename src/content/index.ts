import { LANGUAGE_CHOICES } from "../shared/languages";
import { parseMessage } from "../shared/protocol";
import { parseSettings, type Settings } from "../shared/settings";
import { createTranslationEngine } from "./ai-engine";
import { createChromiumAiAdapter } from "./chromium-ai-adapter";
import { createContentShortcutHandlers } from "./content-shortcuts";
import { createTranslationController, type TranslationController } from "./controller";

export { eventElement } from "./content-shortcuts";

export type ContentDependencies = Readonly<{
  controller: TranslationController;
  loadSettings(): Promise<Settings>;
  isTrustedEvent?(event: Event): boolean;
  isTopFrame?(): boolean;
}>;

export type ContentApp = Readonly<{
  handleMessage(value: unknown): Promise<unknown> | unknown;
  destroy(): void;
}>;

export type ContentPort = Readonly<{
  onMessage: Readonly<{ addListener(listener: (value: unknown) => void): void }>;
  onDisconnect: Readonly<{ addListener(listener: () => void): void }>;
  disconnect(): void;
}>;

export type ContentPortRuntime = Readonly<{
  connect(options: Readonly<{ name: string }>): ContentPort;
}>;

export type ContentPortConnection = Readonly<{ destroy(): void }>;

type LiveChatCommands = Readonly<{
  startLiveChat(): Promise<void>;
  stopLiveChat(): void;
}>;

export const productionLanguages = () => LANGUAGE_CHOICES;

export const connectContentPort = (
  runtime: ContentPortRuntime,
  app: ContentApp,
): ContentPortConnection => {
  let destroyed = false;
  let currentPort: ContentPort | undefined;
  const connect = (): void => {
    const port = runtime.connect({ name: "lingolens-frame" });
    currentPort = port;
    port.onMessage.addListener((value) => {
      void app.handleMessage(value);
    });
    port.onDisconnect.addListener(() => {
      if (!destroyed) connect();
    });
  };
  connect();
  return {
    destroy() {
      destroyed = true;
      currentPort?.disconnect();
    },
  };
};

export const createContentApp = (
  document: Document,
  dependencies: ContentDependencies,
): ContentApp => {
  const shortcuts = createContentShortcutHandlers({
    document,
    controller: dependencies.controller,
    settings: dependencies.controller.settings,
    isTopFrame: dependencies.isTopFrame?.() ?? true,
    ...(dependencies.isTrustedEvent === undefined
      ? {}
      : { isTrustedEvent: dependencies.isTrustedEvent }),
  });
  const handleMessage = (value: unknown): Promise<unknown> | unknown => {
    const message = parseMessage(value);
    if (message === undefined) return undefined;
    switch (message.type) {
      case "translate-page":
        return dependencies.controller.translatePage();
      case "restore-page":
        dependencies.controller.restorePage();
        return undefined;
      case "start-live-chat":
        return hasLiveChatCommands(dependencies.controller)
          ? dependencies.controller.startLiveChat()
          : undefined;
      case "stop-live-chat":
        dependencies.controller.restorePage();
        return undefined;
      case "get-tab-state":
        return dependencies.controller.getState();
      case "settings-changed":
        return dependencies.loadSettings().then((next) => {
          shortcuts.applySettings(next);
          dependencies.controller.applySettings(next);
        });
      case "tab-state":
      case "nano-session-authorized":
      case "detect-nano-source":
      case "offscreen-nano-detect":
        return undefined;
      default:
        return assertNever(message);
    }
  };

  void dependencies.loadSettings().then((loaded) => {
    shortcuts.applySettings(loaded);
    dependencies.controller.applySettings(loaded);
  });
  return {
    handleMessage,
    destroy() {
      shortcuts.destroy();
      dependencies.controller.destroy();
    },
  };
};

const hasLiveChatCommands = (
  controller: TranslationController,
): controller is TranslationController & LiveChatCommands =>
  "startLiveChat" in controller &&
  typeof controller.startLiveChat === "function" &&
  "stopLiveChat" in controller &&
  typeof controller.stopLiveChat === "function";

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled message: ${String(value)}`);
};

if (typeof chrome !== "undefined") {
  const loadSettings = async (): Promise<Settings> => {
    const stored = await chrome.storage.sync.get("settings");
    return parseSettings(stored["settings"], chrome.i18n.getUILanguage());
  };
  void loadSettings().then((settings) => {
    const adapter = createChromiumAiAdapter(
      (event) => {
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
      },
      {
        detectWithNano(text, context) {
          return chrome.runtime.sendMessage({ type: "detect-nano-source", text, context });
        },
        isNanoEnabled: () => controller.settings.liveChatNanoEnabled,
      },
    );
    const controller = createTranslationController({
      document,
      engine: createTranslationEngine(adapter),
      languages: productionLanguages(),
      settings,
      onState(state) {
        void chrome.runtime.sendMessage({ type: "tab-state", state });
      },
    });
    const app = createContentApp(document, {
      controller,
      loadSettings,
      isTopFrame: () => window.top === window,
    });
    chrome.runtime.onMessage.addListener((value: unknown) => app.handleMessage(value));
    const connection = connectContentPort(
      {
        connect(options) {
          return chrome.runtime.connect(options);
        },
      },
      app,
    );
    window.addEventListener(
      "pagehide",
      () => {
        connection.destroy();
        app.destroy();
      },
      { once: true },
    );
  });
}
