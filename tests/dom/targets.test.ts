import { Window as HappyWindow } from "happy-dom";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  collectSourceText,
  discoverTargets,
  isEligibleElement,
  nearestTarget,
  targetFromSelection,
} from "../../src/content/targets";

const elementDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Element");
const htmlElementDescriptor = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
const nodeFilterDescriptor = Object.getOwnPropertyDescriptor(globalThis, "NodeFilter");
const shadowRootDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ShadowRoot");

type DomConstructors = {
  readonly DOMRect: typeof DOMRect;
  readonly Element: typeof Element;
  readonly HTMLElement: typeof HTMLElement;
  readonly NodeFilter: typeof NodeFilter;
  readonly ShadowRoot: typeof ShadowRoot;
};

function isWindowFixture(value: unknown): value is Window & DomConstructors {
  return (
    typeof value === "object" &&
    value !== null &&
    "document" in value &&
    "DOMRect" in value &&
    "Element" in value &&
    "HTMLElement" in value &&
    "NodeFilter" in value &&
    "ShadowRoot" in value
  );
}

const windowFixture: unknown = new HappyWindow();
if (!isWindowFixture(windowFixture)) {
  throw new Error("happy-dom window fixture is incomplete");
}
const window = windowFixture;
const document = window.document;

Object.defineProperties(globalThis, {
  Element: { configurable: true, value: window.Element },
  HTMLElement: { configurable: true, value: window.HTMLElement },
  NodeFilter: { configurable: true, value: window.NodeFilter },
  ShadowRoot: { configurable: true, value: window.ShadowRoot },
});

class FixtureRectList implements DOMRectList {
  readonly [index: number]: DOMRect;
  readonly 0: DOMRect;
  readonly length = 1;

  constructor(width: number, height: number) {
    this[0] = new window.DOMRect(0, 0, width, height);
  }

  item(index: number): DOMRect | null {
    return index === 0 ? this[0] : null;
  }

  [Symbol.iterator](): ArrayIterator<DOMRect> {
    return [this[0]][Symbol.iterator]();
  }
}

const visibleRects = new FixtureRectList(100, 20);
window.HTMLElement.prototype.getClientRects = () => visibleRects;

function elementById(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`fixture element #${id} missing`);
  }
  return element;
}

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }
  Object.defineProperty(globalThis, name, descriptor);
}

afterAll(() => {
  restoreGlobal("Element", elementDescriptor);
  restoreGlobal("HTMLElement", htmlElementDescriptor);
  restoreGlobal("NodeFilter", nodeFilterDescriptor);
  restoreGlobal("ShadowRoot", shadowRootDescriptor);
  window.close();
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("target discovery", () => {
  it("keeps meaningful leaves when unsafe and editable elements are present", () => {
    // Given
    document.body.innerHTML = `
      <main><p id="paragraph">Hello world from a paragraph.</p><div><span id="leaf">Nested leaf text</span></div></main>
      <script>window.secret = true</script><style>.secret { color: red }</style>
      <noscript>Fallback secret</noscript><template>Template secret</template>
      <code>const secret = 1</code><pre>Preformatted secret</pre>
      <textarea>Draft</textarea><input value="Do not translate"><select><option>Choice</option></select>
      <button>Action</button><div contenteditable="true">Draft</div>
      <div contenteditable="true"><p id="locked" contenteditable="false">Published sentence.</p></div>
      <div data-local-translator-ui>Own UI</div>
    `;
    // When
    const targets = discoverTargets(document);

    // Then
    expect(targets.map((element) => element.textContent?.trim())).toEqual([
      "Hello world from a paragraph.",
      "Nested leaf text",
      "Published sentence.",
    ]);
  });

  it("returns the closest eligible element containing a selection anchor", () => {
    // Given
    document.body.innerHTML = `<article><p id="target">Selected sentence here.</p></article>`;
    const target = elementById("target");
    const text = target.firstChild;
    if (text === null) {
      throw new Error("fixture text missing");
    }
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    // When
    const selectedTarget = targetFromSelection(selection);

    // Then
    expect(selectedTarget?.id).toBe("target");
  });

  it("excludes hidden, punctuation-only, numeric-only, and disconnected elements", () => {
    // Given
    document.body.innerHTML = `
      <p id="visible">Readable sentence.</p><p id="hidden-attribute" hidden>Hidden sentence.</p>
      <p id="aria-hidden" aria-hidden="true">Aria hidden sentence.</p>
      <p id="punctuation">... !!!</p><p id="numeric">123 456.78</p>
    `;
    const visible = elementById("visible");
    const hiddenAttribute = elementById("hidden-attribute");
    const ariaHidden = elementById("aria-hidden");
    const punctuation = elementById("punctuation");
    const numeric = elementById("numeric");
    const disconnected = document.createElement("p");
    disconnected.textContent = "Detached sentence.";

    // When
    const eligibility = [
      isEligibleElement(visible),
      isEligibleElement(hiddenAttribute),
      isEligibleElement(ariaHidden),
      isEligibleElement(punctuation),
      isEligibleElement(numeric),
      isEligibleElement(disconnected),
    ];

    // Then
    expect(eligibility).toEqual([true, false, false, false, false, false]);
  });

  it("excludes zero-area elements and their light or shadow descendants", () => {
    // Given
    document.body.innerHTML = `<div id="blocked"><p id="child">Blocked sentence.</p></div><div id="host"></div>`;
    const blocked = elementById("blocked");
    const child = elementById("child");
    const host = elementById("host");
    blocked.getClientRects = () => new FixtureRectList(0, 0);
    host.getClientRects = () => new FixtureRectList(0, 0);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<p id="shadow-child">Shadow blocked sentence.</p>`;

    // When
    const result = [
      isEligibleElement(blocked),
      isEligibleElement(child),
      discoverTargets(document).map((element) => element.id),
    ];

    // Then
    expect(result).toEqual([false, false, []]);
  });

  it("returns the deepest meaningful target instead of its eligible ancestors", () => {
    // Given
    document.body.innerHTML = `
      <article id="article"><section id="section"><p id="deepest">Deep meaningful sentence.</p></section></article>
    `;

    // When
    const targets = discoverTargets(document);

    // Then
    expect(targets.map((element) => element.id)).toEqual(["deepest"]);
  });

  it("keeps a container when a descendant does not represent its direct text", () => {
    // Given
    document.body.innerHTML = `<p id="parent">Parent sentence. <span id="child">Child sentence.</span></p>`;
    const parent = elementById("parent");

    // When
    const targets = discoverTargets(document);

    // Then
    expect(targets).toEqual([parent]);
    expect(collectSourceText(parent)).toBe("Parent sentence. Child sentence.");
  });

  it("keeps safe text while pruning hidden, code, and SVG metadata descendants", () => {
    // Given
    document.body.innerHTML = `
      <p id="target">Visible sentence.<span hidden>Hidden note.</span><code>secret()</code>
        <svg><title>Icon title</title><desc>Icon description</desc></svg><span id="zero">Zero-sized note.</span>
      </p>
    `;
    const target = elementById("target");
    elementById("zero").getClientRects = () => new FixtureRectList(0, 0);

    // When
    const targets = discoverTargets(document);

    // Then
    expect(targets).toEqual([target]);
    expect(collectSourceText(target)).toBe("Visible sentence.");
  });

  it("excludes elements concealed by computed styles", () => {
    // Given
    document.body.innerHTML = `
      <p id="visibility" style="visibility: hidden">Hidden sentence.</p>
      <p id="opacity" style="opacity: 0">Transparent sentence.</p>
      <p id="content-visibility" style="content-visibility: hidden">Concealed sentence.</p>
      <div style="visibility: hidden"><p id="override" style="visibility: visible">Visible override.</p></div>
    `;
    const visibility = elementById("visibility");
    const opacity = elementById("opacity");
    const contentVisibility = elementById("content-visibility");
    const override = elementById("override");

    // When
    const eligibility = [
      isEligibleElement(visibility),
      isEligibleElement(opacity),
      isEligibleElement(contentVisibility),
      isEligibleElement(override),
    ];

    // Then
    expect(eligibility).toEqual([false, false, false, true]);
  });

  it("rejects a collapsed selection", () => {
    // Given
    document.body.innerHTML = `<p id="target">Selected sentence here.</p>`;
    const target = elementById("target");
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    // When
    const selectedTarget = targetFromSelection(selection);

    // Then
    expect(selectedTarget).toBeUndefined();
  });

  it("discovers meaningful targets inside open shadow roots", () => {
    // Given
    const host = document.createElement("div");
    document.body.append(host);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<section><p id="shadow-target">Shadow root sentence.</p></section>`;
    const target = shadowRoot.getElementById("shadow-target");
    if (!(target instanceof HTMLElement)) {
      throw new Error("shadow fixture target missing");
    }

    // When
    const targets = discoverTargets(document);

    // Then
    expect(targets).toEqual([target]);
  });

  it("normalizes descendant text without mutating the DOM", () => {
    // Given
    document.body.innerHTML = `<p id="target">  Hello <strong id="nested"> nested\n text </strong> world. </p>`;
    const target = elementById("target");
    const originalHtml = target.innerHTML;

    // When
    const sourceText = collectSourceText(target);

    // Then
    expect(sourceText).toBe("Hello nested text world.");
    expect(target.innerHTML).toBe(originalHtml);
  });

  it("finds the nearest eligible ancestor", () => {
    // Given
    document.body.innerHTML = `<p id="target">Readable sentence here.<em id="child">emphasized text</em><code id="code">secret()</code></p>`;
    const target = elementById("target");
    const child = elementById("child");
    const code = elementById("code");

    // When
    const nearest = [nearestTarget(child), nearestTarget(code)];

    // Then
    expect(nearest).toEqual([target, undefined]);
  });

  it("does not select a multi-paragraph container from its outer surface", () => {
    // Given
    document.body.innerHTML = `
      <section id="outer"><p id="first">First paragraph.</p><p id="second">Second paragraph.</p></section>
    `;
    const outer = elementById("outer");
    const first = elementById("first");

    // When
    const nearest = [nearestTarget(outer), nearestTarget(first)];

    // Then
    expect(nearest).toEqual([undefined, first]);
  });

  it("does not select a reading block that contains multiple paragraphs", () => {
    // Given
    document.body.innerHTML = `
      <blockquote id="outer"><p id="first">First paragraph.</p><p id="second">Second paragraph.</p></blockquote>
    `;
    const outer = elementById("outer");

    // When
    const nearest = nearestTarget(outer);

    // Then
    expect(nearest).toBeUndefined();
  });

  it("keeps keyboard literals out of source text and target selection", () => {
    // Given
    document.body.innerHTML = `<p id="target">Press <kbd id="key">Ctrl+C</kbd> now.</p>`;
    const target = elementById("target");
    const key = elementById("key");

    // When
    const result = [collectSourceText(target), nearestTarget(key)];

    // Then
    expect(result).toEqual(["Press now.", undefined]);
  });

  it("discovers individual paragraphs instead of a container with its own label", () => {
    // Given
    document.body.innerHTML = `
      <section id="outer">Section label.<p id="first">First paragraph.</p><p id="second">Second paragraph.</p></section>
    `;

    // When
    const targets = discoverTargets(document);

    // Then
    expect(targets.map((target) => target.id)).toEqual(["first", "second"]);
  });
});
