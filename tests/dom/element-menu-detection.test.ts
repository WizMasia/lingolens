import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { createElementMenu, type ElementMenuDetection } from "../../src/content/element-menu";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: testWindow.Element },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  document: { configurable: true, value: testWindow.document },
});

const roots = new WeakMap<HTMLElement, ShadowRoot>();
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init): ShadowRoot {
  const root = attachShadow.call(this, init);
  if (this instanceof HTMLElement) roots.set(this, root);
  return root;
};

const languages = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "ko", label: "Korean" },
] as const;

const expectedLabels: readonly Readonly<{
  detection: ElementMenuDetection;
  label: string;
}>[] = [
  { detection: { kind: "not-detected" }, label: "Not detected yet" },
  {
    detection: { kind: "detected", language: "fr", provenance: "lang" },
    label: "French (HTML lang)",
  },
  {
    detection: { kind: "detected", language: "fr", provenance: "language-detector" },
    label: "French (Chrome AI)",
  },
  {
    detection: { kind: "detected", language: "fr", provenance: "context-detector" },
    label: "French (Chrome AI with context)",
  },
  {
    detection: { kind: "detected", language: "fr", provenance: "chrome-i18n" },
    label: "French (Chrome fallback)",
  },
  {
    detection: { kind: "detected", language: "fr", provenance: "script" },
    label: "French (Script inference)",
  },
  { detection: { kind: "user-selected", language: "en" }, label: "English (User selected)" },
  { detection: { kind: "needs-confirmation" }, label: "Needs confirmation" },
];

describe("element menu detection copy", () => {
  beforeEach(() => document.body.replaceChildren());

  for (const { detection, label } of expectedLabels) {
    it(`renders ${label}`, async () => {
      const source = document.createElement("p");
      source.textContent = "Bonjour";
      document.body.append(source);
      const menu = createElementMenu(document, languages);

      const pending = menu.open(source, { source: "auto", target: "ko", detection });
      const host = document.querySelector<HTMLElement>('[data-local-translator-ui="element-menu"]');
      expect(host === null ? "" : roots.get(host)?.textContent).toContain(
        `Detected source: ${label}`,
      );

      menu.destroy();
      await pending;
    });
  }
});
