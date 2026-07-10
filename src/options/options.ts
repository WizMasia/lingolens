import { LANGUAGE_CHOICES } from "../shared/languages";
import { parseSettings, type Settings, type TriggerBinding } from "../shared/settings";

const STORAGE_KEY = "settings";

export type OptionsDependencies = Readonly<{
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
  uiLanguage: string;
}>;

export type OptionsApp = Readonly<{ ready: Promise<void> }>;

export const createOptionsApp = (
  document: Document,
  dependencies: OptionsDependencies,
): OptionsApp => {
  const form = required(document, "settings-form", HTMLFormElement);
  const source = required(document, "source-language", HTMLSelectElement);
  const target = required(document, "target-language", HTMLSelectElement);
  const capture = required(document, "trigger-capture", HTMLButtonElement);
  const triggerValue = required(document, "trigger-value", HTMLOutputElement);
  const warning = required(document, "trigger-warning", HTMLParagraphElement);
  const status = required(document, "save-status", HTMLParagraphElement);
  let trigger: TriggerBinding = defaultTrigger();
  let capturing = false;

  populateLanguages(document, source, true);
  populateLanguages(document, target, true);

  capture.addEventListener("click", () => {
    capturing = true;
    warning.textContent = "원하는 키 또는 키 조합을 누르세요.";
    capture.focus();
  });
  capture.addEventListener("keydown", (event) => {
    if (!capturing) return;
    event.preventDefault();
    const next = triggerFromEvent(event);
    if (next === undefined) {
      warning.textContent = "문자 키는 Ctrl, Alt, Shift 또는 Meta와 조합해 주세요.";
      return;
    }
    trigger = next;
    capturing = false;
    warning.textContent = conflictWarning(next);
    triggerValue.textContent = triggerLabel(next);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void dependencies
      .save(readSettings(form, source, target, trigger, dependencies.uiLanguage))
      .then(
        () => {
          status.textContent = "설정을 저장했습니다.";
        },
        () => {
          status.textContent = "설정을 저장하지 못했습니다.";
        },
      );
  });

  const ready = dependencies.load().then((settings) => {
    trigger = settings.trigger;
    for (const mode of form.querySelectorAll<HTMLInputElement>('input[name="display-mode"]')) {
      mode.checked = mode.value === settings.displayMode;
    }
    source.value = settings.source.kind === "auto" ? "auto" : settings.source.language;
    target.value = settings.target.kind === "browser" ? "browser" : settings.target.language;
    triggerValue.textContent = triggerLabel(trigger);
  });
  return { ready };
};

const readSettings = (
  form: HTMLFormElement,
  source: HTMLSelectElement,
  target: HTMLSelectElement,
  trigger: TriggerBinding,
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
      trigger,
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

const triggerFromEvent = (event: KeyboardEvent): TriggerBinding | undefined => {
  if (["Escape", "Tab", "Enter"].includes(event.key)) return undefined;
  const modifierOnly = ["Control", "Alt", "Meta", "Shift"].includes(event.key);
  if (
    !modifierOnly &&
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    return undefined;
  }
  return {
    key: event.key,
    ctrl: event.key === "Control" ? false : event.ctrlKey,
    alt: event.key === "Alt" ? false : event.altKey,
    meta: event.key === "Meta" ? false : event.metaKey,
    shift: event.key === "Shift" ? false : event.shiftKey,
  };
};

const triggerLabel = (trigger: TriggerBinding): string => {
  const parts = [
    trigger.ctrl ? "Ctrl" : "",
    trigger.alt ? "Alt" : "",
    trigger.shift ? "Shift" : "",
    trigger.meta ? "Meta" : "",
    modifierLabel(trigger.key),
  ].filter((part) => part.length > 0);
  return [...new Set(parts)].join(" + ");
};

const modifierLabel = (key: string): string => {
  switch (key) {
    case "Control":
      return "Ctrl";
    case " ":
      return "Space";
    default:
      return key.length === 1 ? key.toLocaleUpperCase() : key;
  }
};

const conflictWarning = (trigger: TriggerBinding): string =>
  trigger.ctrl && trigger.key.toLocaleLowerCase() === "l"
    ? "Chrome 주소창 단축키와 충돌할 수 있습니다."
    : "";

const defaultTrigger = (): TriggerBinding => ({
  key: "Control",
  ctrl: false,
  alt: false,
  meta: false,
  shift: false,
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
    uiLanguage,
  });
}
