import { normalizeLanguage } from "./languages";

export type DisplayMode = "inline" | "hover";
export type SourcePreference =
  | { readonly kind: "auto" }
  | { readonly kind: "fixed"; readonly language: string };
export type TargetPreference =
  | { readonly kind: "browser"; readonly resolvedLanguage: string }
  | { readonly kind: "fixed"; readonly language: string };
export type TriggerBinding = Readonly<{
  key: string;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  shift: boolean;
}>;
export type Settings = Readonly<{
  displayMode: DisplayMode;
  source: SourcePreference;
  target: TargetPreference;
  liveChatNanoEnabled: boolean;
  pdfTranslationEnabled: boolean;
  trigger: TriggerBinding;
  menuTrigger: TriggerBinding;
}>;

const DEFAULT_TRIGGER: TriggerBinding = {
  key: "Control",
  ctrl: false,
  alt: false,
  meta: false,
  shift: false,
};

const DEFAULT_MENU_TRIGGER: TriggerBinding = {
  key: "Control",
  ctrl: false,
  alt: false,
  meta: false,
  shift: true,
};

const COLLISION_MENU_TRIGGER: TriggerBinding = {
  key: "L",
  ctrl: true,
  alt: false,
  meta: false,
  shift: true,
};

const RESERVED_TRIGGER_KEYS = new Set(["escape", "tab", "enter"]);

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDisplayMode(value: unknown): DisplayMode {
  return value === "inline" ? "inline" : "hover";
}

function parseSource(value: unknown): SourcePreference {
  if (!isRecord(value) || !("kind" in value)) {
    return { kind: "auto" };
  }

  if (value.kind === "auto") {
    return { kind: "auto" };
  }

  if (value.kind === "fixed" && "language" in value && typeof value.language === "string") {
    const language = normalizeLanguage(value.language);
    if (language !== undefined) {
      return { kind: "fixed", language };
    }
  }

  return { kind: "auto" };
}

function parseTarget(value: unknown, uiLanguage: string): TargetPreference {
  if (isRecord(value) && "kind" in value && value.kind === "fixed" && "language" in value) {
    const language =
      typeof value.language === "string" ? normalizeLanguage(value.language) : undefined;
    if (language !== undefined) {
      return { kind: "fixed", language };
    }
  }

  return { kind: "browser", resolvedLanguage: resolveBrowserTarget(uiLanguage) };
}

function parseTrigger(value: unknown, fallback: TriggerBinding): TriggerBinding {
  if (!isRecord(value)) {
    return fallback;
  }

  const key =
    "key" in value && typeof value.key === "string" && value.key.length > 0
      ? value.key
      : fallback.key;

  if (RESERVED_TRIGGER_KEYS.has(normalizedKey(key))) return fallback;

  return {
    key,
    ctrl: "ctrl" in value && typeof value.ctrl === "boolean" ? value.ctrl : fallback.ctrl,
    alt: "alt" in value && typeof value.alt === "boolean" ? value.alt : fallback.alt,
    meta: "meta" in value && typeof value.meta === "boolean" ? value.meta : fallback.meta,
    shift: "shift" in value && typeof value.shift === "boolean" ? value.shift : fallback.shift,
  };
}

export function resolveBrowserTarget(uiLanguage: string): string {
  return normalizeLanguage(uiLanguage) ?? "ko";
}

export function parseSettings(value: unknown, uiLanguage: string): Settings {
  if (!isRecord(value)) {
    return {
      displayMode: "hover",
      source: { kind: "auto" },
      target: { kind: "browser", resolvedLanguage: resolveBrowserTarget(uiLanguage) },
      liveChatNanoEnabled: false,
      pdfTranslationEnabled: true,
      trigger: DEFAULT_TRIGGER,
      menuTrigger: DEFAULT_MENU_TRIGGER,
    };
  }

  const trigger =
    "trigger" in value ? parseTrigger(value.trigger, DEFAULT_TRIGGER) : DEFAULT_TRIGGER;
  const parsedMenuTrigger =
    "menuTrigger" in value
      ? parseTrigger(value.menuTrigger, DEFAULT_MENU_TRIGGER)
      : DEFAULT_MENU_TRIGGER;
  const menuTrigger = sameTrigger(trigger, parsedMenuTrigger)
    ? sameTrigger(trigger, DEFAULT_MENU_TRIGGER)
      ? COLLISION_MENU_TRIGGER
      : DEFAULT_MENU_TRIGGER
    : parsedMenuTrigger;

  return {
    displayMode: "displayMode" in value ? parseDisplayMode(value.displayMode) : "hover",
    source: "source" in value ? parseSource(value.source) : { kind: "auto" },
    target:
      "target" in value
        ? parseTarget(value.target, uiLanguage)
        : { kind: "browser", resolvedLanguage: resolveBrowserTarget(uiLanguage) },
    liveChatNanoEnabled: "liveChatNanoEnabled" in value && value.liveChatNanoEnabled === true,
    pdfTranslationEnabled:
      !("pdfTranslationEnabled" in value) || value.pdfTranslationEnabled !== false,
    trigger,
    menuTrigger,
  };
}

function normalizedKey(key: string): string {
  return key.toLocaleLowerCase("en-US");
}

export function matchesTrigger(event: KeyboardEvent, trigger: TriggerBinding): boolean {
  if (event.repeat) {
    return false;
  }

  const key = normalizedKey(event.key);
  const triggerKey = normalizedKey(trigger.key);

  if (isModifierKey(triggerKey)) {
    if (!isModifierKey(key)) return false;
    return (
      (event.ctrlKey || key === "control") === (trigger.ctrl || triggerKey === "control") &&
      (event.altKey || key === "alt") === (trigger.alt || triggerKey === "alt") &&
      (event.metaKey || key === "meta") === (trigger.meta || triggerKey === "meta") &&
      (event.shiftKey || key === "shift") === (trigger.shift || triggerKey === "shift")
    );
  }

  return (
    key === triggerKey &&
    (key === "control" ? false : event.ctrlKey) === trigger.ctrl &&
    (key === "alt" ? false : event.altKey) === trigger.alt &&
    (key === "meta" ? false : event.metaKey) === trigger.meta &&
    (key === "shift" ? false : event.shiftKey) === trigger.shift
  );
}

export const sameTrigger = (left: TriggerBinding, right: TriggerBinding): boolean =>
  isModifierTrigger(left) && isModifierTrigger(right)
    ? modifierFlags(left) === modifierFlags(right)
    : normalizedKey(left.key) === normalizedKey(right.key) &&
      left.ctrl === right.ctrl &&
      left.alt === right.alt &&
      left.meta === right.meta &&
      left.shift === right.shift;

export const isModifierTrigger = (trigger: TriggerBinding): boolean =>
  isModifierKey(normalizedKey(trigger.key));

const isModifierKey = (key: string): boolean =>
  key === "control" || key === "alt" || key === "meta" || key === "shift";

const modifierFlags = (trigger: TriggerBinding): string => {
  const key = normalizedKey(trigger.key);
  return [
    trigger.ctrl || key === "control" ? "control" : "",
    trigger.alt || key === "alt" ? "alt" : "",
    trigger.meta || key === "meta" ? "meta" : "",
    trigger.shift || key === "shift" ? "shift" : "",
  ].join("|");
};
