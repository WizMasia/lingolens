import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";

import { createHoverView } from "../../src/content/hover-view";
import { createInlineView } from "../../src/content/inline-view";
import { createRecordStore, InvalidRecordTransitionError } from "../../src/content/records";

const testWindow = new Window();
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: testWindow.document,
});
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
});
Object.defineProperty(testWindow.HTMLElement.prototype, "getClientRects", {
  configurable: true,
  value: () => [new testWindow.DOMRect(0, 0, 100, 20)],
});
Object.defineProperty(testWindow, "getComputedStyle", {
  configurable: true,
  value: () => ({ display: "block", opacity: "1", visibility: "visible" }),
});
const shadowRoots = new WeakMap<Element, ShadowRoot>();
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init): ShadowRoot {
  const shadow = attachShadow.call(this, init);
  shadowRoots.set(this, shadow);
  return shadow;
};

const sourceFixture = (markup = "Hello <em>careful</em> world"): HTMLElement => {
  document.body.innerHTML = `<p id="source">${markup}</p>`;
  const source = document.querySelector<HTMLElement>("#source");
  if (source === null) throw new Error("fixture source missing");
  return source;
};

describe("element records", () => {
  it("snapshots each descendant text node when a record is created", () => {
    // Given
    const source = sourceFixture();

    // When
    const record = createRecordStore().getOrCreate(source);

    // Then
    expect(record.snapshot.map(({ value }) => value)).toEqual(["Hello ", "careful", " world"]);
  });

  it("retains the last successful translation when a later attempt fails", () => {
    // Given
    const record = createRecordStore().getOrCreate(sourceFixture());
    record.complete("안녕하세요", "en", "ko");

    // When
    record.fail("모델을 사용할 수 없습니다.");

    // Then
    expect(record.phase).toBe("error");
    expect(record.error).toBe("모델을 사용할 수 없습니다.");
    expect(record.lastSuccess).toEqual({
      text: "안녕하세요",
      sourceLanguage: "en",
      targetLanguage: "ko",
    });
  });

  it("rejects invalid phase transitions", () => {
    // Given
    const record = createRecordStore().getOrCreate(sourceFixture());

    // When
    const transition = () => record.transition("translating");

    // Then
    expect(transition).toThrow(InvalidRecordTransitionError);
  });

  it("tracks translated records as active and marks them stale", () => {
    // Given
    const store = createRecordStore();
    const record = store.getOrCreate(sourceFixture());
    record.complete("Bonjour", "en", "fr");

    // When
    store.markStale(record);

    // Then
    expect(record.phase).toBe("stale");
    expect([...store.active]).toEqual([record]);
  });

  it("returns one record per source and removes it from the active set", () => {
    // Given
    const store = createRecordStore();
    const source = sourceFixture();
    const record = store.getOrCreate(source);
    record.complete("Bonjour", "en", "fr");

    // When
    store.remove(source);

    // Then
    expect([...store.active]).toHaveLength(0);
    expect(store.getOrCreate(source)).not.toBe(record);
  });

  it("marks an active retranslation stale", () => {
    // Given
    const store = createRecordStore();
    const record = store.getOrCreate(sourceFixture());
    record.complete("Bonjour", "en", "fr");
    record.transition("queued");

    // When
    store.markStale(record);

    // Then
    expect(record.phase).toBe("stale");
  });

  it("captures the latest source fingerprint and language override", () => {
    // Given
    const source = sourceFixture("Original");
    const record = createRecordStore().getOrCreate(source);
    source.textContent = "Updated";

    // When
    record.setLanguageOverride({ source: "en", target: "ja" });
    record.complete("更新", "en", "ja", "Updated");

    // Then
    expect(record.sourceFingerprint).toBe("Updated");
    expect(record.languageOverride).toEqual({ source: "en", target: "ja" });
  });

  it("does not fingerprint an active view replacement", () => {
    // Given
    const record = createRecordStore().getOrCreate(sourceFixture("Hello"));
    record.complete("Bonjour", "en", "fr");
    const node = record.snapshot[0]?.node;
    if (node === undefined) throw new Error("fixture text missing");
    node.data = "Bonjour";

    // When
    record.complete("Salut", "en", "fr");

    // Then
    expect(record.sourceFingerprint).toBe("Hello");
  });

  it("consumes each view-owned mutation marker once", () => {
    // Given
    const record = createRecordStore().getOrCreate(sourceFixture());
    const node = record.snapshot[0]?.node ?? document.createTextNode("");
    record.noteViewMutation(node, "Bonjour");
    node.data = "Bonjour";

    // When
    const first = record.isViewMutation(node);
    const second = record.isViewMutation(node);

    // Then
    expect([first, second]).toEqual([true, false]);
  });

  it("does not refresh a multi-node snapshot from an active identity translation", () => {
    const record = createRecordStore().getOrCreate(sourceFixture("Hello <em>world</em>"));
    record.complete("Hello world", "en", "en");
    createHoverView().render(record);
    record.source.dispatchEvent(new Event("pointerenter"));

    record.complete("Salut", "en", "fr");

    expect(record.currentSnapshot.map(({ value }) => value)).toEqual(["Hello ", "world"]);
  });

  it.each([
    "stale",
    "remove",
    "clear",
    "destroy",
  ] as const)("restores an injected tabindex during %s cleanup", (cleanup) => {
    const store = createRecordStore();
    const source = sourceFixture("Hello");
    const record = store.getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    const view = createHoverView();
    view.render(record);
    expect(source.getAttribute("tabindex")).toBe("0");

    switch (cleanup) {
      case "stale":
        store.markStale(record);
        break;
      case "remove":
        store.remove(source);
        break;
      case "clear":
        store.clear();
        break;
      case "destroy":
        view.destroy();
        break;
    }

    expect(source.hasAttribute("tabindex")).toBe(false);
  });

  it("restores attributes captured when hover activates", () => {
    const source = sourceFixture("Hello");
    source.lang = "en";
    const record = createRecordStore().getOrCreate(source);
    record.complete("مرحبا", "en", "ar");
    createHoverView().render(record);
    source.lang = "de";
    source.dir = "auto";

    source.dispatchEvent(new Event("pointerenter"));
    source.dispatchEvent(new Event("pointerleave"));

    expect([source.lang, source.dir]).toEqual(["de", "auto"]);
  });

  it("preserves a page-owned tabindex change during cleanup", () => {
    const source = sourceFixture("Hello");
    const record = createRecordStore().getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    const view = createHoverView();
    view.render(record);
    source.setAttribute("tabindex", "5");

    view.destroy();

    expect(source.getAttribute("tabindex")).toBe("5");
  });

  it("removes inline stale UI and disconnects its action callback", () => {
    const store = createRecordStore();
    const record = store.getOrCreate(sourceFixture("Hello"));
    record.complete("Bonjour", "en", "fr");
    const onAction = vi.fn();
    createInlineView(document, { onAction }).render(record);
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="inline"]');
    if (host === null) throw new Error("fixture inline host missing");
    const button = shadowRoots.get(host)?.querySelector<HTMLButtonElement>("button");
    if (button === null || button === undefined) throw new Error("fixture action missing");

    store.markStale(record);
    button.click();

    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("uses canonical typography, border, and target-size tokens", () => {
    const record = createRecordStore().getOrCreate(sourceFixture("Hello"));
    record.complete("Bonjour", "en", "fr");
    createInlineView(document).render(record);
    const host = document.querySelector<HTMLElement>('[data-local-translator-ui="inline"]');
    if (host === null) throw new Error("fixture inline host missing");

    const styles = shadowRoots.get(host)?.querySelector("style")?.textContent ?? "";

    expect(styles).toContain("var(--lt-font-size-body");
    expect(styles).toContain("var(--lt-line-height-reading");
    expect(styles).toContain("var(--lt-border");
    expect(styles).toContain("min-inline-size: var(--lt-target-min");
    expect(styles).toContain("min-block-size: var(--lt-target-min");
  });

  it.each([
    "render",
    "setError",
  ] as const)("does not recreate stale inline UI through %s", (method) => {
    const store = createRecordStore();
    const record = store.getOrCreate(sourceFixture("Hello"));
    record.complete("Bonjour", "en", "fr");
    const onAction = vi.fn();
    const view = createInlineView(document, { onAction });
    view.render(record);
    store.markStale(record);

    switch (method) {
      case "render":
        view.render(record);
        break;
      case "setError":
        view.setError(record, "Translation unavailable");
        break;
    }

    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});
