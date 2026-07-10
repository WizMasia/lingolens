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
  trigger: TriggerBinding;
}>;

const DEFAULT_TRIGGER: TriggerBinding = {
  key: "Control",
  ctrl: false,
  alt: false,
  meta: false,
  shift: false,
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

function parseTrigger(value: unknown): TriggerBinding {
  if (!isRecord(value)) {
    return DEFAULT_TRIGGER;
  }

  const key =
    "key" in value && typeof value.key === "string" && value.key.length > 0
      ? value.key
      : DEFAULT_TRIGGER.key;

  if (RESERVED_TRIGGER_KEYS.has(normalizedKey(key))) return DEFAULT_TRIGGER;

  return {
    key,
    ctrl: "ctrl" in value && typeof value.ctrl === "boolean" ? value.ctrl : DEFAULT_TRIGGER.ctrl,
    alt: "alt" in value && typeof value.alt === "boolean" ? value.alt : DEFAULT_TRIGGER.alt,
    meta: "meta" in value && typeof value.meta === "boolean" ? value.meta : DEFAULT_TRIGGER.meta,
    shift:
      "shift" in value && typeof value.shift === "boolean" ? value.shift : DEFAULT_TRIGGER.shift,
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
      trigger: DEFAULT_TRIGGER,
    };
  }

  return {
    displayMode: "displayMode" in value ? parseDisplayMode(value.displayMode) : "hover",
    source: "source" in value ? parseSource(value.source) : { kind: "auto" },
    target:
      "target" in value
        ? parseTarget(value.target, uiLanguage)
        : { kind: "browser", resolvedLanguage: resolveBrowserTarget(uiLanguage) },
    trigger: "trigger" in value ? parseTrigger(value.trigger) : DEFAULT_TRIGGER,
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

  return (
    key === triggerKey &&
    (key === "control" ? false : event.ctrlKey) === trigger.ctrl &&
    (key === "alt" ? false : event.altKey) === trigger.alt &&
    (key === "meta" ? false : event.metaKey) === trigger.meta &&
    (key === "shift" ? false : event.shiftKey) === trigger.shift
  );
}

export function matchesMenuTrigger(event: KeyboardEvent, trigger: TriggerBinding): boolean {
  if (event.repeat || !event.altKey) {
    return false;
  }

  const key = normalizedKey(event.key);
  const triggerKey = normalizedKey(trigger.key);

  return (
    key === triggerKey &&
    (key === "control" ? false : event.ctrlKey) === trigger.ctrl &&
    (key === "meta" ? false : event.metaKey) === trigger.meta &&
    (key === "shift" ? false : event.shiftKey) === trigger.shift
  );
}
