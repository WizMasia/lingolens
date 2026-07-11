import { LANGUAGE_CHOICES } from "../shared/languages";
import { parseMessage } from "../shared/protocol";
import {
  isModifierTrigger,
  matchesTrigger,
  parseSettings,
  type Settings,
  type TriggerBinding,
} from "../shared/settings";
import { createTranslationEngine } from "./ai-engine";
import { createChromiumAiAdapter } from "./chromium-ai-adapter";
import { createTranslationController, type TranslationController } from "./controller";
import { nearestTarget } from "./targets";

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

export const eventElement = (event: Pick<Event, "composedPath" | "target">): Element | null => {
  const composedTarget = event.composedPath().find((target) => target instanceof Element);
  if (composedTarget instanceof Element) return composedTarget;
  return event.target instanceof Element ? event.target : null;
};

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
  let settings = dependencies.controller.settings;
  let currentTarget: HTMLElement | null = null;
  let pendingAction: ShortcutAction | null = null;
  const installsPageHandlers = dependencies.isTopFrame?.() ?? true;

  const isTrustedEvent = (event: Event): boolean =>
    dependencies.isTrustedEvent?.(event) ?? event.isTrusted;
  const executeAction = (action: ShortcutAction, event: KeyboardEvent): void => {
    if (action === "translation") {
      void dependencies.controller.translateTarget();
      return;
    }
    const target = currentTarget ?? nearestTarget(eventElement(event));
    if (target !== undefined) void dependencies.controller.openElementMenu(target);
  };

  const onPointer = (event: PointerEvent): void => {
    if (!isTrustedEvent(event)) return;
    currentTarget = nearestTarget(eventElement(event)) ?? null;
    dependencies.controller.setHovered(currentTarget);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!isTrustedEvent(event) || event.repeat) return;
    if (isEditable(event.composedPath()[0])) {
      pendingAction = null;
      return;
    }
    const action = matchedAction(event, settings);
    if (action === null) {
      pendingAction = null;
      return;
    }
    event.preventDefault();
    if (isModifierTrigger(actionBinding(action, settings))) {
      pendingAction = action;
      return;
    }
    pendingAction = null;
    executeAction(action, event);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (!isTrustedEvent(event)) return;
    const action = pendingAction;
    pendingAction = null;
    if (action === null || isEditable(event.composedPath()[0])) return;
    if (!matchesTrigger(event, actionBinding(action, settings))) return;
    event.preventDefault();
    executeAction(action, event);
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
          pendingAction = null;
          settings = next;
          dependencies.controller.applySettings(next);
        });
      case "tab-state":
      case "detect-nano-source":
      case "offscreen-nano-detect":
        return undefined;
      default:
        return assertNever(message);
    }
  };

  if (installsPageHandlers) {
    document.addEventListener("pointerover", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
    void dependencies.loadSettings().then((loaded) => {
      settings = loaded;
      dependencies.controller.applySettings(loaded);
    });
  }
  return {
    handleMessage,
    destroy() {
      if (installsPageHandlers) {
        document.removeEventListener("pointerover", onPointer, true);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("keyup", onKeyUp, true);
      }
      dependencies.controller.destroy();
    },
  };
};

type ShortcutAction = "translation" | "menu";

const matchedAction = (event: KeyboardEvent, settings: Settings): ShortcutAction | null => {
  if (matchesTrigger(event, settings.menuTrigger)) return "menu";
  if (matchesTrigger(event, settings.trigger)) return "translation";
  return null;
};

const actionBinding = (action: ShortcutAction, settings: Settings): TriggerBinding =>
  action === "menu" ? settings.menuTrigger : settings.trigger;

const hasLiveChatCommands = (
  controller: TranslationController,
): controller is TranslationController & LiveChatCommands =>
  "startLiveChat" in controller &&
  typeof controller.startLiveChat === "function" &&
  "stopLiveChat" in controller &&
  typeof controller.stopLiveChat === "function";

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
