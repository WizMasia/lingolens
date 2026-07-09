import type { ElementRecord, TextSnapshot, TranslationView } from "./records";

export type HoverView = TranslationView;

export type HoverViewActions = Readonly<{
  onAction(record: ElementRecord): void;
}>;

type HoverEntry = {
  readonly record: ElementRecord;
  readonly actionHost: HTMLElement;
  readonly meta: HTMLElement;
  readonly status: HTMLElement;
  readonly originalLang: string | null;
  readonly originalDir: string | null;
  readonly enter: EventListener;
  readonly leave: EventListener;
  readonly focus: EventListener;
  readonly blur: EventListener;
  readonly actionLeave: EventListener;
  readonly actionBlur: EventListener;
  readonly unregisterRestorer: () => void;
  pointerActive: boolean;
  focusActive: boolean;
  suppressFocus: boolean;
  translated: boolean;
  appliedLang: string | null;
  appliedDir: string | null;
};

const HOVER_STYLES = `
  :host { display: inline-block; margin-inline-start: var(--lt-space-2, 8px); }
  :host([hidden]) { display: none; }
  .surface { align-items: center; background: var(--lt-color-paper, #f7f4ec);
    border: 1px solid var(--lt-color-border, rgb(23 32 27 / 12%));
    border-radius: var(--lt-radius, 10px); color: var(--lt-color-ink, #17201b);
    display: flex; gap: var(--lt-space-2, 8px); padding-inline: var(--lt-space-2, 8px); }
  .meta, .status, button { font: 0.75rem/1.4 var(--lt-font-control, system-ui, sans-serif); }
  .status { color: var(--lt-color-danger, #a33a32); }
  button { background: transparent; border: 0; color: var(--lt-color-moss, #2f6d4f);
    cursor: pointer; min-block-size: 44px; padding: 0; }
  button:focus-visible { box-shadow: var(--lt-focus-ring, 0 0 0 2px #2f6d4f); outline: 0; }
`;

export const createHoverView = (
  actions: HoverViewActions = { onAction: () => undefined },
): HoverView => {
  const entries = new Map<ElementRecord, HoverEntry>();

  const restore = (record: ElementRecord): void => {
    const entry = entries.get(record);
    if (entry === undefined) return;
    restoreText(entry);
    removeListeners(entry);
    entry.unregisterRestorer();
    entry.actionHost.remove();
    entries.delete(record);
  };

  const render = (record: ElementRecord): void => {
    restore(record);
    if (record.lastSuccess === null || record.phase === "stale") return;
    const entry = createEntry(record, actions, () => restore(record));
    entries.set(record, entry);
    addListeners(entry);
    record.source.after(entry.actionHost);
  };

  return {
    render,
    setError(record, message) {
      if (!entries.has(record)) render(record);
      const entry = entries.get(record);
      if (entry !== undefined) entry.status.textContent = message;
    },
    restore,
    destroy() {
      for (const record of [...entries.keys()]) restore(record);
    },
  };
};

const createEntry = (
  record: ElementRecord,
  actions: HoverViewActions,
  deactivate: () => void,
): HoverEntry => {
  const { host, meta, status, button } = createActionSurface(record.source.ownerDocument);
  let entry: HoverEntry;
  entry = {
    record,
    actionHost: host,
    meta,
    status,
    originalLang: record.source.getAttribute("lang"),
    originalDir: record.source.getAttribute("dir"),
    enter: () => {
      entry.pointerActive = true;
      activate(entry);
    },
    leave: (event) => {
      entry.pointerActive = false;
      if (!movesInto(entry.actionHost, event)) settle(entry);
    },
    focus: () => {
      if (entry.suppressFocus) {
        entry.suppressFocus = false;
        return;
      }
      entry.focusActive = true;
      activate(entry);
    },
    blur: (event) => {
      entry.focusActive = false;
      if (!movesInto(entry.actionHost, event)) settle(entry);
    },
    actionLeave: () => {
      settle(entry);
    },
    actionBlur: () => {
      settle(entry);
    },
    unregisterRestorer: record.registerRestorer(deactivate),
    pointerActive: false,
    focusActive: false,
    suppressFocus: false,
    translated: false,
    appliedLang: null,
    appliedDir: null,
  };
  button.addEventListener("click", () => actions.onAction(record));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    entry.pointerActive = false;
    entry.focusActive = false;
    entry.suppressFocus = true;
    settle(entry);
    record.source.focus();
  });
  return entry;
};

const createActionSurface = (
  document: Document,
): Readonly<{
  host: HTMLElement;
  meta: HTMLElement;
  status: HTMLElement;
  button: HTMLButtonElement;
}> => {
  const host = document.createElement("span");
  host.hidden = true;
  host.setAttribute("data-local-translator-ui", "hover");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = HOVER_STYLES;
  const surface = document.createElement("span");
  surface.className = "surface";
  const meta = document.createElement("span");
  meta.className = "meta";
  const status = document.createElement("span");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Change language";
  surface.append(meta, status, button);
  shadow.append(style, surface);
  return { host, meta, status, button };
};

const addListeners = (entry: HoverEntry): void => {
  const source = entry.record.source;
  source.addEventListener("pointerenter", entry.enter);
  source.addEventListener("pointerleave", entry.leave);
  source.addEventListener("focus", entry.focus);
  source.addEventListener("blur", entry.blur);
  entry.actionHost.addEventListener("pointerleave", entry.actionLeave);
  entry.actionHost.addEventListener("focusout", entry.actionBlur);
};

const removeListeners = (entry: HoverEntry): void => {
  const source = entry.record.source;
  source.removeEventListener("pointerenter", entry.enter);
  source.removeEventListener("pointerleave", entry.leave);
  source.removeEventListener("focus", entry.focus);
  source.removeEventListener("blur", entry.blur);
  entry.actionHost.removeEventListener("pointerleave", entry.actionLeave);
  entry.actionHost.removeEventListener("focusout", entry.actionBlur);
};

const activate = (entry: HoverEntry): void => {
  const success = entry.record.lastSuccess;
  const target = firstNonEmpty(entry.record.currentSnapshot);
  if (success === null || target === null || entry.record.phase === "stale") return;
  if (
    !entry.translated &&
    entry.record.currentSnapshot.some(({ node, value }) => node.data !== value)
  )
    return;
  if (!entry.translated) {
    for (const snapshot of entry.record.currentSnapshot) {
      setViewText(entry.record, snapshot, snapshot === target ? success.text : "");
    }
    entry.appliedLang = success.targetLanguage;
    entry.appliedDir = languageDirection(success.targetLanguage);
    entry.record.source.lang = entry.appliedLang;
    entry.record.source.dir = entry.appliedDir;
    entry.translated = true;
  }
  entry.meta.textContent = `${success.sourceLanguage} → ${success.targetLanguage}`;
  entry.actionHost.hidden = false;
};

const settle = (entry: HoverEntry): void => {
  if (entry.pointerActive || entry.focusActive) return;
  restoreText(entry);
  entry.actionHost.hidden = true;
};

const restoreText = (entry: HoverEntry): void => {
  if (!entry.translated) return;
  for (const snapshot of entry.record.currentSnapshot) {
    if (entry.record.isCurrentViewValue(snapshot.node)) {
      setViewText(entry.record, snapshot, snapshot.value);
    }
  }
  restoreOwnedAttribute(entry.record.source, "lang", entry.appliedLang, entry.originalLang);
  restoreOwnedAttribute(entry.record.source, "dir", entry.appliedDir, entry.originalDir);
  entry.translated = false;
  entry.appliedLang = null;
  entry.appliedDir = null;
};

const setViewText = (record: ElementRecord, snapshot: TextSnapshot, value: string): void => {
  record.noteViewMutation(snapshot.node, value);
  snapshot.node.data = value;
};

const firstNonEmpty = (snapshots: readonly TextSnapshot[]): TextSnapshot | null =>
  snapshots.find(({ value }) => value.trim().length > 0) ?? null;

const movesInto = (host: HTMLElement, event: Event): boolean => {
  if (!("relatedTarget" in event)) return false;
  const related = event.relatedTarget;
  return related instanceof Node && (related === host || host.contains(related));
};

const restoreOwnedAttribute = (
  source: HTMLElement,
  name: string,
  applied: string | null,
  original: string | null,
): void => {
  if (source.getAttribute(name) !== applied) return;
  if (original === null) source.removeAttribute(name);
  else source.setAttribute(name, original);
};

const languageDirection = (language: string): "ltr" | "rtl" => {
  const primary = language.toLowerCase().split("-")[0] ?? "";
  return /^(?:ar|arc|ckb|dv|fa|he|nqo|ps|sd|syr|ug|ur|yi)$/u.test(primary) ? "rtl" : "ltr";
};
