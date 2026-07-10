import type { ElementRecord, RecordLifecycle, TranslationView } from "./records";

export type InlineView = TranslationView;

export type InlineViewActions = Readonly<{
  onAction(record: ElementRecord): void;
}>;

type InlineEntry = Readonly<{
  host: HTMLElement;
  translation: HTMLElement;
  meta: HTMLElement;
  status: HTMLElement;
  button: HTMLButtonElement;
  onAction: EventListener;
  unregisterRestorer: () => void;
}>;

const UI_ATTRIBUTE = "data-local-translator-ui";
const STALE_NOTICE = "원문이 변경되었습니다. 다시 번역해 주세요.";

const INLINE_STYLES = `
  :host {
    display: block;
    margin-block: var(--lt-space-2, 8px);
  }
  .surface { background: var(--lt-color-paper, #f7f4ec);
    border: var(--lt-border, 1px solid rgb(23 32 27 / 12%));
    border-radius: var(--lt-radius, 10px); color: var(--lt-color-ink, #17201b);
    padding: var(--lt-space-3, 12px); }
  .translation { font: var(--lt-font-size-body, 0.875rem)/var(--lt-line-height-reading, 1.6)
    var(--lt-font-translation, ui-serif, Georgia, serif);
    white-space: pre-wrap; }
  .meta, .status, button { font: var(--lt-font-size-caption, 0.75rem)/
    var(--lt-line-height-control, 1.4) var(--lt-font-control, system-ui, sans-serif); }
  .meta { margin-block-start: var(--lt-space-2, 8px); }
  .status { color: var(--lt-color-danger, #a33a32); }
  button { background: transparent; border: 0; color: var(--lt-color-moss, #2f6d4f); cursor: pointer;
    min-block-size: var(--lt-target-min, 44px); min-inline-size: var(--lt-target-min, 44px); padding: 0; }
  button:focus-visible { box-shadow: var(--lt-focus-ring, 0 0 0 2px #2f6d4f); outline: 0; }
`;

export const createInlineView = (
  document: Document,
  actions: InlineViewActions = { onAction: () => undefined },
): InlineView => {
  const entries = new Map<ElementRecord, InlineEntry>();

  const restore = (record: ElementRecord): void => {
    const entry = entries.get(record);
    if (entry === undefined) return;
    entry.button.removeEventListener("click", entry.onAction);
    entry.unregisterRestorer();
    entry.host.remove();
    entries.delete(record);
  };

  const render = (record: ElementRecord): void => {
    if (record.phase === "stale") {
      restore(record);
      return;
    }
    const success = record.lastSuccess;
    if (success === null) return;
    let entry = entries.get(record);
    if (entry === undefined) {
      const onLifecycle = (reason: RecordLifecycle): void => {
        switch (reason) {
          case "inspect":
            return;
          case "stale":
          case "remove":
          case "clear":
            restore(record);
            return;
          default:
            assertNever(reason);
        }
      };
      entry = createEntry(document, record, actions, onLifecycle);
    }
    if (!entries.has(record)) {
      entries.set(record, entry);
      record.source.after(entry.host);
    }
    entry.translation.textContent = success.text;
    entry.meta.textContent = `${success.sourceLanguage} → ${success.targetLanguage}`;
    entry.status.textContent = "";
    entry.host.lang = success.targetLanguage;
    entry.host.dir = languageDirection(success.targetLanguage);
    entry.translation.lang = success.targetLanguage;
    entry.translation.dir = languageDirection(success.targetLanguage);
  };

  return {
    render,
    markStale(record) {
      const success = record.lastSuccess;
      if (success === null) return;
      let entry = entries.get(record);
      if (entry === undefined) {
        const onLifecycle = (reason: RecordLifecycle): void => {
          if (reason !== "inspect") restore(record);
        };
        entry = createEntry(document, record, actions, onLifecycle);
        entries.set(record, entry);
        record.source.after(entry.host);
      }
      entry.translation.textContent = success.text;
      entry.meta.textContent = `${success.sourceLanguage} → ${success.targetLanguage}`;
      entry.status.textContent = STALE_NOTICE;
    },
    setError(record, message) {
      if (record.phase === "stale") {
        restore(record);
        return;
      }
      render(record);
      let entry = entries.get(record);
      if (entry === undefined) {
        entry = createEntry(document, record, actions, (reason) => {
          if (reason !== "inspect") restore(record);
        });
        entry.host.setAttribute(UI_ATTRIBUTE, "inline-error");
        entries.set(record, entry);
        record.source.after(entry.host);
      }
      entry.status.textContent = message;
    },
    restore,
    destroy() {
      for (const record of [...entries.keys()]) restore(record);
    },
  };
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled lifecycle: ${String(value)}`);
};

const createEntry = (
  document: Document,
  record: ElementRecord,
  actions: InlineViewActions,
  onLifecycle: (reason: RecordLifecycle) => void,
): InlineEntry => {
  const host = document.createElement("div");
  host.setAttribute(UI_ATTRIBUTE, "inline");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = INLINE_STYLES;
  const surface = document.createElement("section");
  surface.className = "surface";
  const translation = document.createElement("div");
  translation.className = "translation";
  const meta = document.createElement("div");
  meta.className = "meta";
  const status = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Change language";
  const onAction: EventListener = () => actions.onAction(record);
  button.addEventListener("click", onAction);
  surface.append(translation, meta, status, button);
  shadow.append(style, surface);
  const unregisterRestorer = record.registerRestorer(onLifecycle);
  return { host, translation, meta, status, button, onAction, unregisterRestorer };
};

const languageDirection = (language: string): "ltr" | "rtl" => {
  const primary = language.toLowerCase().split("-")[0] ?? "";
  return /^(?:ar|arc|ckb|dv|fa|he|nqo|ps|sd|syr|ug|ur|yi)$/u.test(primary) ? "rtl" : "ltr";
};
