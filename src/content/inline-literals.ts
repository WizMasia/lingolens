import { collectSourceTextNodes, isSafeInlineLiteral } from "./targets";

const LITERAL_SELECTOR = "code, kbd, samp, var";

export type InlineLiteralPlan = Readonly<{
  fragments: readonly string[];
  compose(translated: readonly string[]): string | undefined;
  viewValues(translated: readonly string[]): ReadonlyMap<Text, string> | undefined;
}>;

export const createInlineLiteralPlan = (source: HTMLElement): InlineLiteralPlan | undefined => {
  const slots = collectSourceTextNodes(source);
  if (slots.length < 2 && source.querySelector(LITERAL_SELECTOR) === null) return undefined;
  const slotIndex = new Map<Text, number>(slots.map((node, index) => [node, index]));
  const literals = new Set(
    [...source.querySelectorAll(LITERAL_SELECTOR)].filter(
      (element) =>
        isSafeInlineLiteral(element) && element.parentElement?.closest(LITERAL_SELECTOR) === null,
    ),
  );
  return {
    fragments: slots.map((node) => node.data),
    compose(translated) {
      if (translated.length !== slots.length) return undefined;
      const parts: string[] = [];
      const emitted = new Set<Element>();
      const walker = source.ownerDocument.createTreeWalker(source, 4);
      let node = walker.nextNode();
      while (node !== null) {
        const literal =
          node.parentElement === null ? undefined : enclosingLiteral(node.parentElement, literals);
        if (literal !== undefined) {
          if (!emitted.has(literal)) parts.push(visibleLiteralText(literal));
          emitted.add(literal);
        } else if (node instanceof Text) {
          const index = slotIndex.get(node);
          if (index !== undefined) parts.push(translated[index] ?? "");
        }
        node = walker.nextNode();
      }
      return parts.join("");
    },
    viewValues(translated) {
      if (translated.length !== slots.length) return undefined;
      return new Map(slots.map((node, index) => [node, translated[index] ?? ""]));
    },
  };
};

const enclosingLiteral = (
  element: Element,
  literals: ReadonlySet<Element>,
): Element | undefined => {
  let current: Element | null = element;
  while (current !== null) {
    if (literals.has(current)) return current;
    current = current.parentElement;
  }
  return undefined;
};

const visibleLiteralText = (literal: Element): string => {
  const parts: string[] = [];
  const walker = literal.ownerDocument.createTreeWalker(literal, 4);
  let node = walker.nextNode();
  while (node !== null) {
    if (
      node instanceof Text &&
      node.parentElement !== null &&
      isSafeInlineLiteral(node.parentElement)
    ) {
      parts.push(node.data);
    }
    node = walker.nextNode();
  }
  return parts.join("");
};
