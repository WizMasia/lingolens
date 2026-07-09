export type ElementLanguageChoice = Readonly<{
  value: string;
  label: string;
}>;

export type ElementMenuResult =
  | Readonly<{ kind: "translate"; source: "auto" | string; target: string }>
  | Readonly<{ kind: "restore" }>
  | Readonly<{ kind: "cancel" }>;

export type ElementMenuSelection = Readonly<{
  source: "auto" | string;
  target: string;
}>;

export type ElementMenu = Readonly<{
  open(anchor: HTMLElement, selection: ElementMenuSelection): Promise<ElementMenuResult>;
  announce(message: string): void;
  destroy(): void;
}>;

type MenuControls = Readonly<{
  surface: HTMLElement;
  source: HTMLSelectElement;
  target: HTMLSelectElement;
  translate: HTMLButtonElement;
  restore: HTMLButtonElement;
  status: HTMLElement;
}>;

type OpenMenu = Readonly<{
  host: HTMLElement;
  finish(result: ElementMenuResult): void;
}>;

const MENU_STYLES = `
  :host { display: block; margin-block: var(--lt-space-2, 8px); }
  .surface { background: var(--lt-color-paper, #f7f4ec); border: var(--lt-border,
    1px solid rgb(23 32 27 / 12%)); border-radius: var(--lt-radius, 10px);
    color: var(--lt-color-ink, #17201b); display: grid; gap: var(--lt-space-2, 8px);
    padding: var(--lt-space-3, 12px); }
  label, select, button, .status { font: var(--lt-font-size-body, 0.875rem)/
    var(--lt-line-height-control, 1.4) var(--lt-font-control, system-ui, sans-serif); }
  label { display: grid; gap: var(--lt-space-1, 4px); }
  select, button { min-block-size: var(--lt-target-min, 44px); }
  select { background: white; border: var(--lt-border, 1px solid rgb(23 32 27 / 12%));
    border-radius: var(--lt-radius, 10px); color: inherit; padding-inline: var(--lt-space-2, 8px); }
  .actions { display: flex; flex-wrap: wrap; gap: var(--lt-space-2, 8px); }
  button { background: transparent; border: 0; color: var(--lt-color-moss, #2f6d4f);
    cursor: pointer; min-inline-size: var(--lt-target-min, 44px); padding-inline: var(--lt-space-2, 8px); }
  button[data-action="restore"] { color: var(--lt-color-danger, #a33a32); }
  select:focus-visible, button:focus-visible { box-shadow: var(--lt-focus-ring,
    0 0 0 2px #2f6d4f); outline: 0; }
  .status { color: var(--lt-color-danger, #a33a32); min-block-size: 1.4em; }
`;

export const createElementMenu = (
  document: Document,
  languages: readonly ElementLanguageChoice[],
): ElementMenu => {
  let current: OpenMenu | null = null;
  let currentStatus: HTMLElement | null = null;

  const closeCurrent = (result: ElementMenuResult): void => {
    current?.finish(result);
  };

  return {
    open(anchor, selection) {
      closeCurrent({ kind: "cancel" });
      return new Promise((resolve) => {
        const host = document.createElement("div");
        host.setAttribute("data-local-translator-ui", "element-menu");
        const shadow = host.attachShadow({ mode: "closed" });
        const controls = createControls(document, languages, selection);
        const style = document.createElement("style");
        style.textContent = MENU_STYLES;
        const finish = (result: ElementMenuResult): void => {
          if (current?.host !== host) return;
          host.remove();
          current = null;
          currentStatus = null;
          resolve(result);
        };
        current = { host, finish };
        currentStatus = controls.status;
        wireControls(shadow, controls, finish, anchor);
        shadow.append(style, controls.surface);
        anchor.after(host);
        controls.source.focus();
      });
    },
    announce(message) {
      if (currentStatus !== null) currentStatus.textContent = message;
    },
    destroy() {
      closeCurrent({ kind: "cancel" });
    },
  };
};

const createControls = (
  document: Document,
  languages: readonly ElementLanguageChoice[],
  selection: ElementMenuSelection,
): MenuControls => {
  const surface = document.createElement("section");
  surface.className = "surface";
  surface.setAttribute("aria-label", "Element translation languages");
  const source = document.createElement("select");
  source.name = "source";
  appendOption(source, "auto", "Auto detect");
  appendLanguages(source, languages);
  source.value = selection.source;
  const target = document.createElement("select");
  target.name = "target";
  appendLanguages(target, languages);
  target.value = selection.target;
  const sourceLabel = labeled(document, "Source language", source);
  const targetLabel = labeled(document, "Target language", target);
  const actions = document.createElement("div");
  actions.className = "actions";
  const translate = actionButton(document, "translate", "Translate again");
  const restore = actionButton(document, "restore", "Restore original");
  actions.append(translate, restore);
  const status = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  surface.append(sourceLabel, targetLabel, actions, status);
  return { surface, source, target, translate, restore, status };
};

const wireControls = (
  shadow: ShadowRoot,
  controls: MenuControls,
  finish: (result: ElementMenuResult) => void,
  anchor: HTMLElement,
): void => {
  controls.translate.addEventListener("click", () => {
    finish({ kind: "translate", source: controls.source.value, target: controls.target.value });
  });
  controls.restore.addEventListener("click", () => finish({ kind: "restore" }));
  shadow.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    finish({ kind: "cancel" });
    anchor.focus();
  });
};

const appendLanguages = (
  select: HTMLSelectElement,
  languages: readonly ElementLanguageChoice[],
): void => {
  const values = new Set(Array.from(select.options, ({ value }) => value));
  for (const language of languages) {
    if (language.value === "auto" || values.has(language.value)) continue;
    appendOption(select, language.value, language.label);
    values.add(language.value);
  }
};

const appendOption = (select: HTMLSelectElement, value: string, label: string): void => {
  const option = select.ownerDocument.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
};

const labeled = (document: Document, text: string, select: HTMLSelectElement): HTMLLabelElement => {
  const label = document.createElement("label");
  label.append(text, select);
  return label;
};

const actionButton = (
  document: Document,
  action: "translate" | "restore",
  text: string,
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-action", action);
  button.textContent = text;
  return button;
};
