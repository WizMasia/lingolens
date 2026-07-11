import type { TabState } from "../shared/protocol";
import type { Settings } from "../shared/settings";
import type { TranslationEngine } from "./ai-engine";
import { createElementMenu, type ElementLanguageChoice, type ElementMenu } from "./element-menu";
import { inspectMenuSelection } from "./element-menu-selection";
import { createHoverView } from "./hover-view";
import { createInlineView } from "./inline-view";
import type { PageJobOutcome } from "./jobs";
import { createPageController } from "./page-controller";
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

type PoliteAnnouncer = Readonly<{
  announce(message: string): void;
  destroy(): void;
}>;

const NO_TARGET_NOTICE = "텍스트 요소를 선택하거나 가리켜 주세요.";

export const createTranslationController = (
  dependencies: TranslationControllerDependencies,
): TranslationController => {
  const store = dependencies.store ?? createRecordStore();
  const notice = dependencies.notice ?? (() => undefined);
  let settings = dependencies.settings;
  let hovered: HTMLElement | null = null;
  let view: TranslationView;
  const openMenu = async (record: ElementRecord): Promise<void> => {
    const inspection = inspectMenuSelection({
      engine: dependencies.engine,
      record,
      settings,
      store,
    });
    const selection = inspection instanceof Promise ? await inspection : inspection;
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
  const actions = { onAction: (record: ElementRecord): void => void openMenu(record) };
  const createView = (): TranslationView =>
    settings.displayMode === "inline"
      ? createInlineView(dependencies.document, actions)
      : createHoverView();
  view = createView();
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

  const perform = async (attempt: TranslationAttempt): Promise<boolean> => {
    return executeTranslation(attempt, runtime);
  };

  const page = createPageController({
    document: dependencies.document,
    store,
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
      view.markStale(record);
    },
    onState: dependencies.onState ?? (() => undefined),
  });

  const retranslate = async (
    source: HTMLElement,
    choice: ElementLanguageOverride,
  ): Promise<void> => {
    const record = store.getOrCreate(source);
    const succeeded = await perform({
      source,
      preference:
        choice.source === "auto" ? { kind: "auto" } : { kind: "fixed", language: choice.source },
      target: choice.target,
    });
    if (succeeded) record.setLanguageOverride(choice);
    page.syncRecords();
  };

  const restoreElement = (source: HTMLElement): void => {
    const record = store.getOrCreate(source);
    record.setLanguageOverride(null);
    store.remove(source);
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
    restorePage: page.restorePage,
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
      for (const record of store.active) view.render(record);
    },
    destroy() {
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

const createPoliteAnnouncer = (document: Document): PoliteAnnouncer => {
  const host = document.createElement("div");
  host.setAttribute("data-local-translator-ui", "announcer");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { block-size: 1px; clip-path: inset(50%); inline-size: 1px;
      overflow: hidden; position: fixed; white-space: nowrap; }
  `;
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  shadow.append(style, status);
  document.body.append(host);
  return {
    announce(message) {
      status.textContent = message;
    },
    destroy() {
      host.remove();
    },
  };
};

const targetLanguage = (settings: Settings): string =>
  settings.target.kind === "fixed" ? settings.target.language : settings.target.resolvedLanguage;

const settingsLanguages = (settings: Settings): readonly ElementLanguageChoice[] => {
  const values = new Set<string>([targetLanguage(settings)]);
  if (settings.source.kind === "fixed") values.add(settings.source.language);
  return [...values].map((value) => ({ value, label: value }));
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled variant: ${String(value)}`);
};
