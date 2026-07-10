import type { TriggerBinding } from "../shared/settings";

export type ShortcutKind = "translation" | "menu";
export type ShortcutBindings = Record<ShortcutKind, TriggerBinding>;

export const defaultShortcuts = (): ShortcutBindings => ({
  translation: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menu: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
});

export const triggerFromEvent = (event: KeyboardEvent): TriggerBinding | undefined => {
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

export const modifierBinding = (event: KeyboardEvent): TriggerBinding => {
  const ctrl = event.ctrlKey || event.key === "Control";
  const alt = event.altKey || event.key === "Alt";
  const meta = event.metaKey || event.key === "Meta";
  const shift = event.shiftKey || event.key === "Shift";
  const key = ctrl ? "Control" : alt ? "Alt" : meta ? "Meta" : "Shift";
  return {
    key,
    ctrl: key === "Control" ? false : ctrl,
    alt: key === "Alt" ? false : alt,
    meta: key === "Meta" ? false : meta,
    shift: key === "Shift" ? false : shift,
  };
};

export const triggerLabel = (trigger: TriggerBinding): string => {
  const keyLabel = modifierLabel(trigger.key);
  const modifierKey = ["Ctrl", "Alt", "Shift", "Meta"].includes(keyLabel);
  return [
    trigger.ctrl || keyLabel === "Ctrl" ? "Ctrl" : "",
    trigger.alt || keyLabel === "Alt" ? "Alt" : "",
    trigger.shift || keyLabel === "Shift" ? "Shift" : "",
    trigger.meta || keyLabel === "Meta" ? "Meta" : "",
    modifierKey ? "" : keyLabel,
  ]
    .filter((part) => part.length > 0)
    .join(" + ");
};

export const conflictWarning = (trigger: TriggerBinding): string =>
  trigger.ctrl && trigger.key.toLocaleLowerCase() === "l"
    ? "Chrome 주소창 단축키와 충돌할 수 있습니다."
    : "";

const modifierLabel = (key: string): string => {
  switch (key) {
    case "Control":
      return "Ctrl";
    case "Alt":
    case "Meta":
    case "Shift":
      return key;
    case " ":
      return "Space";
    default:
      return key.length === 1 ? key.toLocaleUpperCase() : key;
  }
};
