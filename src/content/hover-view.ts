import type { ElementRecord, RecordLifecycle, TextSnapshot, TranslationView } from "./records";

type HoverEntry = {
  readonly record: ElementRecord;
  originalLang: string | null;
  originalDir: string | null;
  readonly enter: EventListener;
  readonly leave: EventListener;
  readonly focus: EventListener;
  readonly blur: EventListener;
  readonly keydown: EventListener;
  readonly unregisterRestorer: () => void;
  pointerActive: boolean;
  focusActive: boolean;
  translated: boolean;
  appliedLang: string | null;
  appliedDir: string | null;
};

export const createHoverView = (): TranslationView => {
  const entries = new Map<ElementRecord, HoverEntry>();

  const restore = (record: ElementRecord): void => {
    const entry = entries.get(record);
    if (entry === undefined) return;
    restoreText(entry);
    removeListeners(entry);
    entry.unregisterRestorer();
    entries.delete(record);
  };

  const render = (record: ElementRecord): void => {
    restore(record);
    if (record.lastSuccess === null || record.phase === "stale") return;
    mount(record);
  };

  const mount = (record: ElementRecord): HoverEntry => {
    const entry = createEntry(record, (reason) =>
      reason === "inspect" ? restoreText(entry) : restore(record),
    );
    entries.set(record, entry);
    addListeners(entry);
    if (record.source.matches(":hover")) {
      entry.pointerActive = true;
    }
    if (isFocused(record.source)) {
      entry.focusActive = true;
    }
    if (entry.pointerActive || entry.focusActive) activate(entry);
    return entry;
  };

  return {
    render,
    markStale() {},
    setError(record) {
      restore(record);
    },
    restore,
    destroy() {
      for (const record of [...entries.keys()]) restore(record);
    },
  };
};

const createEntry = (
  record: ElementRecord,
  onLifecycle: (reason: RecordLifecycle) => void,
): HoverEntry => {
  let entry: HoverEntry;
  entry = {
    record,
    originalLang: record.source.getAttribute("lang"),
    originalDir: record.source.getAttribute("dir"),
    enter: () => {
      entry.pointerActive = true;
      activate(entry);
    },
    leave: () => {
      entry.pointerActive = false;
      settle(entry);
    },
    focus: () => {
      entry.focusActive = true;
      activate(entry);
    },
    blur: () => {
      entry.focusActive = false;
      settle(entry);
    },
    keydown: (event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== "Escape") return;
      entry.pointerActive = false;
      entry.focusActive = false;
      settle(entry);
    },
    unregisterRestorer: record.registerRestorer(onLifecycle),
    pointerActive: false,
    focusActive: false,
    translated: false,
    appliedLang: null,
    appliedDir: null,
  };
  return entry;
};

const addListeners = (entry: HoverEntry): void => {
  const source = entry.record.source;
  source.addEventListener("pointerenter", entry.enter);
  source.addEventListener("pointerleave", entry.leave);
  source.addEventListener("focus", entry.focus);
  source.addEventListener("blur", entry.blur);
  source.addEventListener("keydown", entry.keydown);
};

const removeListeners = (entry: HoverEntry): void => {
  const source = entry.record.source;
  source.removeEventListener("pointerenter", entry.enter);
  source.removeEventListener("pointerleave", entry.leave);
  source.removeEventListener("focus", entry.focus);
  source.removeEventListener("blur", entry.blur);
  source.removeEventListener("keydown", entry.keydown);
};

const activate = (entry: HoverEntry): void => {
  const success = entry.record.lastSuccess;
  const target = firstNonEmpty(entry.record.currentSnapshot);
  if (success === null || target === null || entry.record.phase === "stale") return;
  const hasPageChange = entry.record.currentSnapshot.some(({ node, value }) => node.data !== value);
  if (!entry.translated && hasPageChange) return;
  if (entry.translated) return;
  entry.originalLang = entry.record.source.getAttribute("lang");
  entry.originalDir = entry.record.source.getAttribute("dir");
  entry.record.beginViewOwnership();
  for (const snapshot of entry.record.currentSnapshot) {
    setViewText(entry.record, snapshot, snapshot === target ? success.text : "");
  }
  entry.appliedLang = success.targetLanguage;
  entry.appliedDir = languageDirection(success.targetLanguage);
  entry.record.source.lang = entry.appliedLang;
  entry.record.source.dir = entry.appliedDir;
  entry.translated = true;
};

const settle = (entry: HoverEntry): void => {
  if (entry.pointerActive || entry.focusActive) return;
  restoreText(entry);
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
  entry.record.endViewOwnership();
  entry.appliedLang = null;
  entry.appliedDir = null;
};

const setViewText = (record: ElementRecord, snapshot: TextSnapshot, value: string): void => {
  record.noteViewMutation(snapshot.node, value);
  snapshot.node.data = value;
};

const firstNonEmpty = (snapshots: readonly TextSnapshot[]): TextSnapshot | null =>
  snapshots.find(({ value }) => value.trim().length > 0) ?? null;

const isFocused = (source: HTMLElement): boolean => {
  const root = source.getRootNode();
  return ("activeElement" in root && root.activeElement === source) || source.matches(":focus");
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
