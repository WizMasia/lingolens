import type { Settings } from "../shared/settings";
import type { TranslationEngine } from "./ai-engine";
import {
  createElementMenu,
  type ElementLanguageChoice,
  type ElementMenu,
  type ElementMenuSelection,
} from "./element-menu";
import { createHoverView } from "./hover-view";
import { createInlineView } from "./inline-view";
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
    const result = await menu.open(record.source, menuSelection(record, settings));
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
      : createHoverView(actions);
  view = createView();
  const menu =
    dependencies.menu ??
    createElementMenu(dependencies.document, dependencies.languages ?? settingsLanguages(settings));
  const runtime: TranslationRuntime = {
    engine: dependencies.engine,
    store,
    view: () => view,
    notice,
    announce: (message) => menu.announce(message),
  };

  const perform = async (attempt: TranslationAttempt): Promise<boolean> => {
    return executeTranslation(attempt, runtime);
  };

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
  };

  const restoreElement = (source: HTMLElement): void => {
    const record = store.getOrCreate(source);
    record.setLanguageOverride(null);
    store.remove(source);
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
        await openMenu(record);
        return;
      }
      await perform({
        source: target,
        preference: settings.source,
        target: targetLanguage(settings),
      });
    },
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
      menu.destroy();
      view.destroy();
      store.clear();
      dependencies.engine.destroy();
      hovered = null;
    },
  };
};

const targetLanguage = (settings: Settings): string =>
  settings.target.kind === "fixed" ? settings.target.language : settings.target.resolvedLanguage;

const menuSelection = (record: ElementRecord, settings: Settings): ElementMenuSelection => ({
  source:
    record.languageOverride?.source ??
    (settings.source.kind === "fixed" ? settings.source.language : "auto"),
  target:
    record.languageOverride?.target ??
    record.lastSuccess?.targetLanguage ??
    targetLanguage(settings),
});

const settingsLanguages = (settings: Settings): readonly ElementLanguageChoice[] => {
  const values = new Set<string>([targetLanguage(settings)]);
  if (settings.source.kind === "fixed") values.add(settings.source.language);
  return [...values].map((value) => ({ value, label: value }));
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled variant: ${String(value)}`);
};
