const HARD_UNSAFE_SELECTOR =
  'script,style,noscript,template,code,pre,textarea,input,select,option,button,svg title,svg desc,svg metadata,[aria-hidden="true"],[hidden],[data-local-translator-ui]';

type RootContext = Readonly<{
  hardUnsafe: boolean;
  editable: boolean;
  concealed: boolean;
}>;

type ScanState = RootContext & {
  readonly element: Element;
  readonly parent: ScanState | undefined;
  readonly children: ScanState[];
  readonly candidate: HTMLElement | undefined;
  readonly ownMeaningfulText: boolean;
  hasMeaningfulText: boolean;
  represented: boolean;
  selected: boolean;
};

function composedParent(element: Element): Element | null {
  if (element.parentElement !== null) {
    return element.parentElement;
  }

  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function hasHardUnsafeContext(element: Element): boolean {
  let current: Element | null = element;
  while (current !== null) {
    if (current.matches(HARD_UNSAFE_SELECTOR)) {
      return true;
    }
    current = composedParent(current);
  }
  return false;
}

function isEditableContext(element: Element): boolean {
  let current: Element | null = element;
  while (current !== null) {
    const value = current.getAttribute("contenteditable");
    if (value !== null) {
      return value.toLowerCase() !== "false";
    }
    current = composedParent(current);
  }
  return false;
}

function computedStyle(element: Element): CSSStyleDeclaration | undefined {
  return element.ownerDocument.defaultView?.getComputedStyle(element);
}

function hasIrreversibleHiddenOwnStyle(element: Element): boolean {
  const style = computedStyle(element);
  if (style === undefined) {
    return false;
  }
  const transparent = style.opacity.length > 0 && Number(style.opacity) === 0;
  return style.display === "none" || style.contentVisibility === "hidden" || transparent;
}

function hasIrreversibleHiddenContext(element: Element): boolean {
  let current: Element | null = element;
  while (current !== null) {
    if (hasIrreversibleHiddenOwnStyle(current)) {
      return true;
    }
    current = composedParent(current);
  }
  return false;
}

function hasHiddenStyleContext(element: Element): boolean {
  const visibility = computedStyle(element)?.visibility;
  return (
    visibility === "hidden" || visibility === "collapse" || hasIrreversibleHiddenContext(element)
  );
}

function hasUnsafeContext(element: Element): boolean {
  return hasHardUnsafeContext(element) || isEditableContext(element);
}

function hasVisibleRect(element: Element): boolean {
  return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
}

const MEANINGFUL_TEXT = /[\p{L}\p{M}]/u;

function directTextIsMeaningful(element: Element): boolean {
  const parts: string[] = [];
  for (const child of element.childNodes) {
    if (child.nodeType === 3 && child.textContent !== null) {
      parts.push(child.textContent);
    }
  }
  return MEANINGFUL_TEXT.test(parts.join(" "));
}

export function collectSourceText(element: HTMLElement): string {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node = walker.nextNode();

  while (node !== null) {
    const parent = node.parentElement;
    const normalized = node.textContent?.replace(/\s+/gu, " ").trim();
    if (
      parent !== null &&
      !hasUnsafeContext(parent) &&
      !hasHiddenStyleContext(parent) &&
      hasVisibleRect(parent) &&
      normalized !== undefined &&
      normalized.length > 0
    ) {
      parts.push(normalized);
    }
    node = walker.nextNode();
  }

  return parts.join(" ");
}

export function isEligibleElement(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    !hasUnsafeContext(element) &&
    !hasHiddenStyleContext(element) &&
    hasVisibleRect(element) &&
    MEANINGFUL_TEXT.test(collectSourceText(element))
  );
}

function scanRoot(root: Document | ShadowRoot, context: RootContext): HTMLElement[] {
  const ownerDocument = "createTreeWalker" in root ? root : root.ownerDocument;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const states: ScanState[] = [];
  const statesByElement = new WeakMap<Element, ScanState>();
  let node = walker.nextNode();

  while (node !== null) {
    if (node instanceof Element) {
      const parent =
        node.parentElement === null ? undefined : statesByElement.get(node.parentElement);
      const hardUnsafe =
        (parent?.hardUnsafe ?? context.hardUnsafe) || node.matches(HARD_UNSAFE_SELECTOR);
      const editableValue = node.getAttribute("contenteditable");
      const editable =
        editableValue === null
          ? (parent?.editable ?? context.editable)
          : editableValue.toLowerCase() !== "false";
      const concealed =
        (parent?.concealed ?? context.concealed) || hasIrreversibleHiddenOwnStyle(node);
      const visibility = computedStyle(node)?.visibility;
      const styleHidden = concealed || visibility === "hidden" || visibility === "collapse";
      const candidate =
        node instanceof HTMLElement &&
        node.isConnected &&
        !hardUnsafe &&
        !editable &&
        !styleHidden &&
        hasVisibleRect(node)
          ? node
          : undefined;
      const state: ScanState = {
        element: node,
        parent,
        children: [],
        candidate,
        hardUnsafe,
        editable,
        concealed,
        ownMeaningfulText:
          !hardUnsafe &&
          !editable &&
          !styleHidden &&
          hasVisibleRect(node) &&
          directTextIsMeaningful(node),
        hasMeaningfulText: false,
        represented: false,
        selected: false,
      };
      parent?.children.push(state);
      states.push(state);
      statesByElement.set(node, state);
    }
    node = walker.nextNode();
  }

  for (let index = states.length - 1; index >= 0; index -= 1) {
    const state = states[index];
    if (state === undefined) {
      continue;
    }
    const meaningfulChildren = state.children.filter((child) => child.hasMeaningfulText);
    state.hasMeaningfulText = state.ownMeaningfulText || meaningfulChildren.length > 0;
    const descendantsRepresentText =
      !state.ownMeaningfulText &&
      meaningfulChildren.length > 0 &&
      meaningfulChildren.every((child) => child.represented);
    state.selected =
      state.candidate !== undefined && state.hasMeaningfulText && !descendantsRepresentText;
    state.represented = state.selected || descendantsRepresentText;
  }

  const targets: HTMLElement[] = [];
  const suppressed = new WeakSet<Element>();
  for (const state of states) {
    const ancestorSelected = state.parent !== undefined && suppressed.has(state.parent.element);
    if (ancestorSelected || state.selected) {
      suppressed.add(state.element);
    }
    if (state.selected && !ancestorSelected && state.candidate !== undefined) {
      targets.push(state.candidate);
    }
    if (state.element.shadowRoot !== null) {
      targets.push(
        ...scanRoot(state.element.shadowRoot, {
          hardUnsafe: state.hardUnsafe,
          editable: state.editable,
          concealed: state.concealed,
        }),
      );
    }
  }
  return targets;
}

export function discoverTargets(root: Document | ShadowRoot): readonly HTMLElement[] {
  const context =
    root instanceof ShadowRoot
      ? {
          hardUnsafe: hasHardUnsafeContext(root.host),
          editable: isEditableContext(root.host),
          concealed: hasIrreversibleHiddenContext(root.host),
        }
      : { hardUnsafe: false, editable: false, concealed: false };
  return scanRoot(root, context);
}

export function nearestTarget(element: Element | null): HTMLElement | undefined {
  if (
    element !== null &&
    (hasUnsafeContext(element) || hasHiddenStyleContext(element) || !hasVisibleRect(element))
  ) {
    return undefined;
  }
  let current = element;
  while (current !== null) {
    if (isEligibleElement(current)) {
      return current;
    }
    current = composedParent(current);
  }
  return undefined;
}

export function targetFromSelection(selection: Selection | null): HTMLElement | undefined {
  if (selection === null || selection.isCollapsed || selection.anchorNode === null) {
    return undefined;
  }

  const anchor = selection.anchorNode;
  return nearestTarget(anchor instanceof Element ? anchor : anchor.parentElement);
}
