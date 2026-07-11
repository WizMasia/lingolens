import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TranslationController } from "../../src/content/controller";
import {
  type ContentApp,
  type ContentPort,
  connectContentPort,
  createContentApp,
} from "../../src/content/index";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  DOMRect: { configurable: true, value: testWindow.DOMRect },
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  Node: { configurable: true, value: testWindow.Node },
  PointerEvent: { configurable: true, value: testWindow.PointerEvent },
  document: { configurable: true, value: testWindow.document },
});

Object.defineProperty(testWindow.HTMLElement.prototype, "getClientRects", {
  configurable: true,
  value: () => [new testWindow.DOMRect(0, 0, 100, 20)],
});

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

const controllerFixture = (): TranslationController => ({
  settings: SETTINGS,
  store: {
    active: new Set(),
    getOrCreate: vi.fn(),
    has: vi.fn(),
    markStale: vi.fn(),
    restoreTranslation: vi.fn(),
    restoreAllTranslations: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
  setHovered: vi.fn(),
  translateTarget: vi.fn().mockResolvedValue(undefined),
  translatePage: vi.fn().mockResolvedValue(undefined),
  restorePage: vi.fn(),
  startLiveChat: vi.fn().mockResolvedValue(undefined),
  stopLiveChat: vi.fn(),
  getState: vi
    .fn()
    .mockReturnValue({ phase: "idle", completed: 0, total: 0, skipped: 0, failed: 0 }),
  retranslate: vi.fn().mockResolvedValue(undefined),
  openElementMenu: vi.fn().mockResolvedValue(undefined),
  restoreElement: vi.fn(),
  applySettings: vi.fn(),
  destroy: vi.fn(),
});

type TestPortHarness = Readonly<{
  port: ContentPort;
  receive(value: unknown): void;
  disconnect(): void;
}>;

const createTestPort = (): TestPortHarness => {
  const messageListeners: ((value: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  const disconnect = (): void => {
    for (const listener of disconnectListeners) listener();
  };
  return {
    port: {
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener);
        },
      },
      onDisconnect: {
        addListener(listener) {
          disconnectListeners.push(listener);
        },
      },
      disconnect,
    },
    receive(value) {
      for (const listener of messageListeners) listener(value);
    },
    disconnect,
  };
};

const apps: ContentApp[] = [];

describe("content port", () => {
  beforeEach(() => {
    for (const app of apps.splice(0)) app.destroy();
    document.body.replaceChildren();
  });

  it("reconnects after disconnect without duplicating app handlers", async () => {
    // Given
    const paragraph = document.createElement("p");
    paragraph.textContent = "Meaningful text to translate";
    document.body.append(paragraph);
    const controller = controllerFixture();
    const app = createContentApp(document, {
      controller,
      loadSettings: async () => SETTINGS,
      isTrustedEvent: () => true,
    });
    apps.push(app);
    const first = createTestPort();
    const second = createTestPort();
    const ports = [first.port, second.port];
    let connectCalls = 0;

    // When
    const connection = connectContentPort(
      {
        connect() {
          const port = ports.shift();
          if (port === undefined) throw new Error("No test port available");
          connectCalls += 1;
          return port;
        },
      },
      app,
    );
    first.disconnect();
    second.receive({ type: "start-live-chat" });
    paragraph.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

    // Then
    expect(connectCalls).toBe(2);
    expect(controller.startLiveChat).toHaveBeenCalledOnce();
    expect(controller.setHovered).toHaveBeenCalledOnce();
    connection.destroy();
  });
});
