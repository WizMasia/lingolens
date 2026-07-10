import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import { createHoverView } from "../../src/content/hover-view";
import { createRecordStore } from "../../src/content/records";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  Node: { configurable: true, value: testWindow.Node },
  Text: { configurable: true, value: testWindow.Text },
  document: { configurable: true, value: testWindow.document },
});
Object.defineProperty(testWindow.HTMLElement.prototype, "getClientRects", {
  configurable: true,
  value: () => [new testWindow.DOMRect(0, 0, 100, 20)],
});
Object.defineProperty(testWindow, "getComputedStyle", {
  configurable: true,
  value: () => ({ display: "block", opacity: "1", visibility: "visible" }),
});

describe("hover retranslation view", () => {
  it("uses changed source text as the baseline after retranslation", () => {
    const source = document.createElement("p");
    source.textContent = "Old source";
    document.body.append(source);
    const store = createRecordStore();
    const record = store.getOrCreate(source);
    record.complete("Ancienne", "en", "fr");
    const view = createHoverView();
    view.render(record);
    source.textContent = "Updated source";
    store.markStale(record);
    record.transition("queued");
    record.transition("translating");
    record.complete("Nouvelle", "en", "fr", "Updated source");
    view.render(record);

    source.dispatchEvent(new Event("pointerenter"));
    expect(source.textContent).toBe("Nouvelle");
    source.dispatchEvent(new Event("pointerleave"));

    expect(source.textContent).toBe("Updated source");
    expect(record.snapshot.map(({ value }) => value)).toEqual(["Old source"]);
  });
});
