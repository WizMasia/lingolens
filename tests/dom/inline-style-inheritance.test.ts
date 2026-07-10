import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import { createInlineView } from "../../src/content/inline-view";
import { createRecordStore } from "../../src/content/records";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: testWindow.Element },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  ShadowRoot: { configurable: true, value: testWindow.ShadowRoot },
  document: { configurable: true, value: testWindow.document },
});

const shadowRoots = new WeakMap<Element, ShadowRoot>();
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init): ShadowRoot {
  const shadow = attachShadow.call(this, init);
  shadowRoots.set(this, shadow);
  return shadow;
};

const inlineParts = (): Readonly<{
  host: HTMLElement;
  surface: HTMLElement;
  translation: HTMLElement;
}> => {
  const host = document.querySelector<HTMLElement>('[data-local-translator-ui="inline"]');
  if (host === null) throw new Error("fixture inline host missing");
  const shadow = shadowRoots.get(host);
  if (shadow === undefined) throw new Error("fixture inline shadow missing");
  const surface = shadow.querySelector<HTMLElement>(".surface");
  const translation = shadow.querySelector<HTMLElement>(".translation");
  if (surface === null || translation === null) throw new Error("fixture inline parts missing");
  return { host, surface, translation };
};

describe("inline host-style inheritance", () => {
  it("copies safe source typography and layout without copying the page surface", () => {
    const source = document.createElement("p");
    source.textContent = "Hello world";
    source.style.fontFamily = "Georgia";
    source.style.fontSize = "22px";
    source.style.fontWeight = "700";
    source.style.fontStyle = "italic";
    source.style.lineHeight = "1.8";
    source.style.letterSpacing = "0.12em";
    source.style.wordSpacing = "0.2em";
    source.style.color = "rgb(255, 255, 255)";
    source.style.textAlign = "center";
    source.style.textTransform = "uppercase";
    source.style.textIndent = "2em";
    source.style.writingMode = "vertical-rl";
    source.style.width = "480px";
    source.style.marginTop = "16px";
    source.style.marginBottom = "20px";
    source.style.backgroundColor = "rgb(5, 6, 7)";
    document.documentElement.style.setProperty("--lt-color-paper", "rgb(17, 17, 17)", "important");
    document.documentElement.style.setProperty("--lt-color-ink", "rgb(255, 255, 255)", "important");
    document.documentElement.style.setProperty("--lt-font-control", "fantasy", "important");
    document.documentElement.style.setProperty("--lt-space-2", "0px", "important");
    document.documentElement.style.setProperty("--lt-target-min", "0px", "important");
    document.body.replaceChildren(source);
    const sourceStyle = source.ownerDocument.defaultView?.getComputedStyle(source);
    if (sourceStyle === undefined) throw new Error("fixture source style unavailable");
    const record = createRecordStore().getOrCreate(source);
    record.complete("번역된 문장", "en", "ko");

    createInlineView(document).render(record);

    const { host, surface, translation } = inlineParts();
    expect(translation.style.fontFamily).toBe(sourceStyle.fontFamily);
    expect(translation.style.fontSize).toBe(sourceStyle.fontSize);
    expect(translation.style.fontWeight).toBe(sourceStyle.fontWeight);
    expect(translation.style.fontStyle).toBe(sourceStyle.fontStyle);
    expect(translation.style.lineHeight).toBe(sourceStyle.lineHeight);
    expect(translation.style.letterSpacing).toBe(sourceStyle.letterSpacing);
    expect(translation.style.wordSpacing).toBe(sourceStyle.wordSpacing);
    expect(translation.style.color).toBe("");
    expect(translation.style.textAlign).toBe(sourceStyle.textAlign);
    expect(translation.style.textTransform).toBe(sourceStyle.textTransform);
    expect(translation.style.textIndent).toBe(sourceStyle.textIndent);
    expect(translation.style.writingMode).toBe(sourceStyle.writingMode);
    expect(host.style.width).toBe(sourceStyle.width);
    expect(host.style.marginBlockStart).toBe(sourceStyle.marginBlockStart || sourceStyle.marginTop);
    expect(host.style.marginBlockEnd).toBe(sourceStyle.marginBlockEnd || sourceStyle.marginBottom);
    expect(host.style.getPropertyValue("--lt-color-paper")).toBe("#f7f4ec");
    expect(host.style.getPropertyValue("--lt-color-ink")).toBe("#17201b");
    expect(host.style.getPropertyValue("--lt-font-control")).toBe(
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
    expect(host.style.getPropertyValue("--lt-space-2")).toBe("8px");
    expect(host.style.getPropertyValue("--lt-target-min")).toBe("44px");
    expect(surface.style.backgroundColor).toBe("");
  });
});
