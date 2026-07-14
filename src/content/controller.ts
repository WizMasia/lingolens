import type { TabState } from "../shared/protocol";
import type { Settings } from "../shared/settings";
import type { TranslationEngine } from "./ai-engine";
import { TranslationError } from "./ai-engine";
import { settingsLanguages, targetLanguage } from "./controller-settings";
import { createDocumentTitleTranslation } from "./document-title";
import { createElementMenu, type ElementLanguageChoice, type ElementMenu } from "./element-menu";
import { inspectMenuSelection } from "./element-menu-selection";
import { createHoverView } from "./hover-view";
import { createInlineView } from "./inline-view";
import type { PageJobOutcome } from "./jobs";
import { createLiveChatSessionController } from "./live-chat-session-controller";
import { createPageController } from "./page-controller";
import { createPoliteAnnouncer } from "./polite-announcer";
import {
  createRecordStore,
  type ElementRecord,
  type RecordStore,
  type TranslationView,
} from "./records";
import { targetFromSelection } from "./targets";
import {
  executeTranslation,
  type TranslationAttempt,
  type TranslationRuntime,
} from "./translation-attempt";

export type { ElementLanguageChoice } from "./element-menu";

export type ElementLanguageOverride = Readonly<{
  source: "auto" | string;
  target: string;
}>;

export type TranslationController = Readonly<{
  settings: Settings;
  store: RecordStore;
  setHovered(source: HTMLElement | null): void;
  translateTarget(source?: HTMLElement): Promise<void>;
  translatePage(): Promise<void>;
  restorePage(): void;
  startLiveChat(): Promise<void>;
  stopLiveChat(): void;
  getState(): TabState;
  retranslate(source: HTMLElement, choice: ElementLanguageOverride): Promise<void>;
  openElementMenu(source: HTMLElement): Promise<void>;
  restoreElement(source: HTMLElement): void;
  applySettings(settings: Settings): void;
  destroy(): void;
}>;

export type TranslationControllerDependencies = Readonly<{
  document: Document;
  engine: TranslationEngine;
  settings: Settings;
  store?: RecordStore;
  menu?: ElementMenu;
  languages?: readonly ElementLanguageChoice[];
  notice?: (message: string) => void;
  onState?: (state: TabState) => void;
}>;

const NO_TARGET_NOTICE = "텍스트 요소를 선택하거나 가리켜 주세요.";

export const createTranslationController = (
  dependencies: TranslationControllerDependencies,
): TranslationController => {
  const store = dependencies.store ?? createRecordStore();
  const notice = dependencies.notice ?? (() => undefined);
  let settings = dependencies.settings;
  let hovered: HTMLElement | null = null;
  let active = true;
  let view: TranslationView;
  const openMenu = async (record: ElementRecord): Promise<void> => {
    const inspection = inspectMenuSelection({
      engine: dependencies.engine,
      record,
      settings,
      store,
    });
    const selection = inspection instanceof Promise ? await inspection : inspection;
    if (!active) return;
    const result = await menu.open(record.source, selection);
    switch (result.kind) {
      case "translate":
        await retranslate(record.source, result);
        return;
      case "restore":
        restoreElement(record.source);
        return;
      case "cancel":
        return;
      default:
        return assertNever(result);
    }
  };
  const actions = {
    onAction(record: ElementRecord): void {
      void openMenu(record).catch((error: unknown) => {
        if (!active && error instanceof TranslationError && error.code === "api-unavailable")
          return;
        throw error;
      });
    },
  };
  const createView = (): TranslationView =>
    settings.displayMode === "inline"
      ? createInlineView(dependencies.document, actions)
      : createHoverView();
  view = createView();
  const liveChatView = createHoverView();
  const menu =
    dependencies.menu ??
    createElementMenu(dependencies.document, dependencies.languages ?? settingsLanguages(settings));
  const announcer = createPoliteAnnouncer(dependencies.document);
  const runtime: TranslationRuntime = {
    engine: dependencies.engine,
    store,
    view: () => view,
    announce: (message) => {
      menu.announce(message);
      announcer.announce(message);
    },
  };

  const perform = async (
    attempt: TranslationAttempt,
    translationView: TranslationView = view,
  ): Promise<boolean> => executeTranslation(attempt, { ...runtime, view: () => translationView });

  const title = createDocumentTitleTranslation({
    document: dependencies.document,
    engine: dependencies.engine,
    settings: () => settings,
  });

  const page = createPageController({
    document: dependencies.document,
    store,
    title,
    async translate(source, signal): Promise<PageJobOutcome> {
      const record = store.getOrCreate(source);
      const succeeded = await perform({
        source,
        preference: settings.source,
        target: targetLanguage(settings),
        signal,
      });
      if (signal.aborted) return "skipped";
      if (succeeded) return "translated";
      return record.phase === "error" || record.phase === "stale" ? "failed" : "skipped";
    },
    onStale(record) {
      (liveChat.has(record) ? liveChatView : view).markStale(record);
    },
    onState: dependencies.onState ?? (() => undefined),
  });
  const liveChat = createLiveChatSessionController({
    document: dependencies.document,
    store,
    settings: () => settings,
    async translate(source, preference, signal) {
      await perform({ source, preference, target: targetLanguage(settings), signal }, liveChatView);
    },
    syncRecords: page.syncRecords,
  });

  const retranslate = async (
    source: HTMLElement,
    choice: ElementLanguageOverride,
  ): Promise<void> => {
    const record = store.getOrCreate(source);
    record.setLanguageOverride(choice);
    liveChat.remember(source, choice);
    await perform(
      {
        source,
        preference:
          choice.source === "auto" ? { kind: "auto" } : { kind: "fixed", language: choice.source },
        target: choice.target,
      },
      liveChat.has(record) ? liveChatView : view,
    );
    page.syncRecords();
  };

  const restoreElement = (source: HTMLElement): void => {
    const record = store.getOrCreate(source);
    record.setLanguageOverride(null);
    liveChat.restore(source);
    store.restoreTranslation(source);
    page.syncRecords();
  };

  return {
    get settings() {
      return settings;
    },
    store,
    setHovered(source) {
      hovered = source;
    },
    async translateTarget(source) {
      const target =
        source ?? targetFromSelection(dependencies.document.getSelection()) ?? hovered ?? undefined;
      if (target === undefined) {
        notice(NO_TARGET_NOTICE);
        return;
      }
      const record = store.getOrCreate(target);
      if (record.lastSuccess !== null) {
        restoreElement(target);
        return;
      }
      await perform({
        source: target,
        preference: settings.source,
        target: targetLanguage(settings),
      });
      page.syncRecords();
    },
    translatePage: page.translatePage,
    restorePage() {
      liveChat.stop();
      page.restorePage();
    },
    startLiveChat: liveChat.start,
    stopLiveChat: liveChat.stop,
    getState: page.getState,
    retranslate,
    openElementMenu(source) {
      return openMenu(store.getOrCreate(source));
    },
    restoreElement,
    applySettings(nextSettings) {
      const displayChanged = nextSettings.displayMode !== settings.displayMode;
      settings = nextSettings;
      if (!displayChanged) return;
      view.destroy();
      view = createView();
      for (const record of store.active) {
        if (!liveChat.has(record)) view.render(record);
      }
    },
    destroy() {
      if (!active) return;
      active = false;
      liveChat.destroy();
      liveChatView.destroy();
      page.destroy();
      menu.destroy();
      announcer.destroy();
      view.destroy();
      store.clear();
      dependencies.engine.destroy();
      hovered = null;
    },
  };
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled variant: ${String(value)}`);
};
