import {
  isModifierTrigger,
  matchesTrigger,
  type Settings,
  type TriggerBinding,
} from "../shared/settings";
import type { TranslationController } from "./controller";
import { nearestTarget } from "./targets";

type ShortcutAction = "translation" | "menu";

export type ContentShortcutHandlers = Readonly<{
  applySettings(settings: Settings): void;
  destroy(): void;
}>;

export type ContentShortcutOptions = Readonly<{
  document: Document;
  controller: TranslationController;
  settings: Settings;
  isTopFrame: boolean;
  isTrustedEvent?(event: Event): boolean;
}>;

export const eventElement = (event: Pick<Event, "composedPath" | "target">): Element | null => {
  const composedTarget = event.composedPath().find((target) => target instanceof Element);
  if (composedTarget instanceof Element) return composedTarget;
  return event.target instanceof Element ? event.target : null;
};

export const createContentShortcutHandlers = (
  options: ContentShortcutOptions,
): ContentShortcutHandlers => {
  let settings = options.settings;
  let currentTarget: HTMLElement | null = null;
  let pendingAction: ShortcutAction | null = null;
  const isTrustedEvent = (event: Event): boolean =>
    options.isTrustedEvent?.(event) ?? event.isTrusted;
  const executeAction = (action: ShortcutAction, event: KeyboardEvent): void => {
    if (action === "translation" && !options.isTopFrame) return;
    if (action === "translation") {
      void options.controller.translateTarget();
      return;
    }
    const target = currentTarget ?? nearestTarget(eventElement(event));
    if (target !== undefined) void options.controller.openElementMenu(target);
  };
  const onPointer = (event: PointerEvent): void => {
    if (!isTrustedEvent(event)) return;
    currentTarget = nearestTarget(eventElement(event)) ?? null;
    options.controller.setHovered(currentTarget);
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
      if (!options.isTopFrame && action === "menu") {
        executeAction(action, event);
        return;
      }
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

  options.document.addEventListener("pointerover", onPointer, true);
  options.document.addEventListener("keydown", onKey, true);
  options.document.addEventListener("keyup", onKeyUp, true);
  return {
    applySettings(next) {
      pendingAction = null;
      settings = next;
    },
    destroy() {
      options.document.removeEventListener("pointerover", onPointer, true);
      options.document.removeEventListener("keydown", onKey, true);
      options.document.removeEventListener("keyup", onKeyUp, true);
    },
  };
};

const matchedAction = (event: KeyboardEvent, settings: Settings): ShortcutAction | null => {
  if (matchesTrigger(event, settings.menuTrigger)) return "menu";
  if (matchesTrigger(event, settings.trigger)) return "translation";
  return null;
};

const actionBinding = (action: ShortcutAction, settings: Settings): TriggerBinding =>
  action === "menu" ? settings.menuTrigger : settings.trigger;

const isEditable = (value: EventTarget | undefined): boolean =>
  value instanceof Element &&
  (value.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])") ||
    value.closest("[contenteditable]:not([contenteditable='false'])") !== null);
