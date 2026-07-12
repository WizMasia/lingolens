import { createNanoPreparation, type NanoPreparation } from "../content/nano-language-detector";
import { LANGUAGE_CHOICES } from "../shared/languages";
import {
  isModifierTrigger,
  parseSettings,
  type Settings,
  sameTrigger,
  type TriggerBinding,
} from "../shared/settings";
import { installNanoPreparationAction } from "./nano-preparation-action";
import {
  conflictWarning,
  defaultShortcuts,
  modifierBinding,
  type ShortcutBindings,
  type ShortcutKind,
  triggerFromEvent,
  triggerLabel,
} from "./shortcut-capture";

const STORAGE_KEY = "settings";

export type OptionsDependencies = Readonly<{
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
  uiLanguage: string;
  prepareNano?: NanoPreparation["prepare"];
  authorizeNano?(): Promise<void>;
}>;

export type OptionsApp = Readonly<{ ready: Promise<void> }>;

type TriggerControls = Readonly<{
  capture: HTMLButtonElement;
  value: HTMLOutputElement;
  warning: HTMLParagraphElement;
}>;

export const createOptionsApp = (
  document: Document,
  dependencies: OptionsDependencies,
): OptionsApp => {
  const form = required(document, "settings-form", HTMLFormElement);
  const source = required(document, "source-language", HTMLSelectElement);
  const target = required(document, "target-language", HTMLSelectElement);
  const liveChatNano = required(document, "live-chat-nano", HTMLInputElement);
  const controls: Record<ShortcutKind, TriggerControls> = {
    translation: triggerControls(document, "trigger"),
    menu: triggerControls(document, "menu-trigger"),
  };
  const status = required(document, "save-status", HTMLParagraphElement);
  let triggers = defaultShortcuts();
  let capturing: ShortcutKind | null = null;
  let modifierCandidate: TriggerBinding | null = null;

  populateLanguages(document, source, true);
  populateLanguages(document, target, true);

  for (const kind of ["translation", "menu"] as const) {
    const control = controls[kind];
    control.capture.addEventListener("click", () => {
      capturing = kind;
      modifierCandidate = null;
      control.warning.textContent = "원하는 키 또는 키 조합을 누르세요.";
      control.capture.focus();
    });
    control.capture.addEventListener("keydown", (event) => {
      if (capturing !== kind) return;
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        control.value.textContent = triggerLabel(triggers[kind]);
        control.warning.textContent = "단축키 변경을 취소했습니다.";
        capturing = null;
        modifierCandidate = null;
        return;
      }
      event.preventDefault();
      const next = triggerFromEvent(event);
      if (next === undefined) {
        control.warning.textContent = "문자 키는 Ctrl, Alt, Shift 또는 Meta와 조합해 주세요.";
        return;
      }
      if (isModifierTrigger(next)) {
        modifierCandidate = modifierBinding(event);
        control.value.textContent = triggerLabel(modifierCandidate);
        return;
      }
      finishCapture({
        kind,
        next,
        current: triggers,
        controls,
        finish: (updated) => {
          triggers = updated;
          capturing = null;
          modifierCandidate = null;
        },
        reject: () => {
          capturing = null;
          modifierCandidate = null;
        },
      });
    });
    control.capture.addEventListener("keyup", (event) => {
      if (capturing !== kind || modifierCandidate === null) return;
      event.preventDefault();
      finishCapture({
        kind,
        next: modifierCandidate,
        current: triggers,
        controls,
        finish: (updated) => {
          triggers = updated;
          capturing = null;
          modifierCandidate = null;
        },
        reject: () => {
          capturing = null;
          modifierCandidate = null;
        },
      });
    });
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void dependencies
      .save(readSettings(form, source, target, liveChatNano, triggers, dependencies.uiLanguage))
      .then(
        () => {
          status.textContent = "설정을 저장했습니다.";
        },
        () => {
          status.textContent = "설정을 저장하지 못했습니다.";
        },
      );
  });
  installNanoPreparationAction({
    document,
    prepare: dependencies.prepareNano ?? createNanoPreparation().prepare,
    authorize: dependencies.authorizeNano ?? (() => Promise.resolve()),
  });

  const ready = dependencies.load().then((settings) => {
    triggers = { translation: settings.trigger, menu: settings.menuTrigger };
    for (const mode of form.querySelectorAll<HTMLInputElement>('input[name="display-mode"]')) {
      mode.checked = mode.value === settings.displayMode;
    }
    source.value = settings.source.kind === "auto" ? "auto" : settings.source.language;
    target.value = settings.target.kind === "browser" ? "browser" : settings.target.language;
    liveChatNano.checked = settings.liveChatNanoEnabled;
    controls.translation.value.textContent = triggerLabel(triggers.translation);
    controls.menu.value.textContent = triggerLabel(triggers.menu);
  });
  return { ready };
};

const readSettings = (
  form: HTMLFormElement,
  source: HTMLSelectElement,
  target: HTMLSelectElement,
  liveChatNano: HTMLInputElement,
  triggers: ShortcutBindings,
  uiLanguage: string,
): Settings => {
  const selectedMode = form.querySelector<HTMLInputElement>('input[name="display-mode"]:checked');
  const displayMode = selectedMode?.value === "hover" ? "hover" : "inline";
  return parseSettings(
    {
      displayMode,
      source:
        source.value === "auto" ? { kind: "auto" } : { kind: "fixed", language: source.value },
      target:
        target.value === "browser"
          ? { kind: "browser" }
          : { kind: "fixed", language: target.value },
      liveChatNanoEnabled: liveChatNano.checked,
      trigger: triggers.translation,
      menuTrigger: triggers.menu,
    },
    uiLanguage,
  );
};

const populateLanguages = (
  document: Document,
  select: HTMLSelectElement,
  special: boolean,
): void => {
  if (special && select.id === "source-language")
    select.append(createOption(document, "자동 감지", "auto"));
  if (special && select.id === "target-language")
    select.append(createOption(document, "브라우저 기본 언어", "browser"));
  for (const language of LANGUAGE_CHOICES)
    select.append(createOption(document, language.label, language.value));
};

const createOption = (document: Document, label: string, value: string): HTMLOptionElement => {
  const option = document.createElement("option");
  option.textContent = label;
  option.value = value;
  return option;
};

type FinishCaptureOptions = Readonly<{
  kind: ShortcutKind;
  next: TriggerBinding;
  current: ShortcutBindings;
  controls: Record<ShortcutKind, TriggerControls>;
  finish(updated: ShortcutBindings): void;
  reject(): void;
}>;

const finishCapture = ({
  kind,
  next,
  current,
  controls,
  finish,
  reject,
}: FinishCaptureOptions): void => {
  const other = kind === "translation" ? current.menu : current.translation;
  if (sameTrigger(next, other)) {
    controls[kind].warning.textContent = "두 단축키는 같을 수 없습니다.";
    controls[kind].value.textContent = triggerLabel(current[kind]);
    reject();
    return;
  }
  const updated = { ...current, [kind]: next };
  const label = triggerLabel(next);
  controls[kind].warning.textContent = conflictWarning(next) || `${label}로 설정했습니다.`;
  controls[kind].value.textContent = label;
  finish(updated);
};

const triggerControls = (document: Document, prefix: string): TriggerControls => ({
  capture: required(document, `${prefix}-capture`, HTMLButtonElement),
  value: required(document, `${prefix}-value`, HTMLOutputElement),
  warning: required(document, `${prefix}-warning`, HTMLParagraphElement),
});

const required = <ElementType extends Element>(
  document: Document,
  id: string,
  elementType: { new (): ElementType },
): ElementType => {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new TypeError(`Missing options element: ${id}`);
  return element;
};

if (typeof chrome !== "undefined") {
  const uiLanguage = chrome.i18n.getUILanguage();
  createOptionsApp(document, {
    async load() {
      const stored = await chrome.storage.sync.get(STORAGE_KEY);
      return parseSettings(stored[STORAGE_KEY], uiLanguage);
    },
    async save(settings) {
      await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
    },
    async authorizeNano() {
      await chrome.runtime.sendMessage({ type: "nano-session-authorized" });
    },
    uiLanguage,
  });
}
