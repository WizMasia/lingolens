import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";

import { createHoverView } from "../../src/content/hover-view";
import { createInlineView } from "../../src/content/inline-view";
import { createRecordStore } from "../../src/content/records";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  CustomEvent: { configurable: true, value: testWindow.CustomEvent },
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  KeyboardEvent: { configurable: true, value: testWindow.KeyboardEvent },
  Node: { configurable: true, value: testWindow.Node },
  document: { configurable: true, value: testWindow.document },
});
const event = (type: string): Event => new Event(type);
const shadowRoots = new WeakMap<Element, ShadowRoot>();
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init): ShadowRoot {
  const shadow = attachShadow.call(this, init);
  shadowRoots.set(this, shadow);
  return shadow;
};

const ownedShadow = (kind: "hover" | "inline"): ShadowRoot => {
  const host = document.querySelector<HTMLElement>(`[data-local-translator-ui="${kind}"]`);
  if (host === null) throw new Error("fixture UI host missing");
  const shadow = shadowRoots.get(host);
  if (shadow === undefined) throw new Error("fixture shadow missing");
  return shadow;
};

const sourceFixture = (markup = "Hello <em>careful</em> world"): HTMLElement => {
  document.body.innerHTML = `<p id="source" tabindex="0">${markup}</p>`;
  const source = document.querySelector<HTMLElement>("#source");
  if (source === null) throw new Error("fixture source missing");
  return source;
};

describe("inline view", () => {
  it("updates one inline block instead of duplicating it", () => {
    // Given
    const source = sourceFixture("Hello world");
    const record = createRecordStore().getOrCreate(source);
    record.complete("안녕하세요", "en", "ko");
    const view = createInlineView(document);
    view.render(record);

    // When
    record.complete("Bonjour", "en", "fr");
    view.render(record);

    // Then
    expect(document.querySelectorAll("[data-local-translator-ui]")).toHaveLength(1);
    expect(ownedShadow("inline").textContent).toContain("Bonjour");
  });

  it("sets translation language and direction", () => {
    // Given
    const record = createRecordStore().getOrCreate(sourceFixture());
    record.complete("مرحبا", "en", "ar");
    const view = createInlineView(document);

    // When
    view.render(record);

    // Then
    const host = document.querySelector<HTMLElement>("[data-local-translator-ui]");
    expect(host?.lang).toBe("ar");
    expect(host?.dir).toBe("rtl");
    expect(ownedShadow("inline").textContent).toContain("en → ar");
    expect(ownedShadow("inline").querySelector("style")?.textContent).toContain(
      "var(--lt-color-paper",
    );
  });

  it("keeps the last success visible when rendering an error", () => {
    // Given
    const record = createRecordStore().getOrCreate(sourceFixture());
    record.complete("Bonjour", "en", "fr");
    const view = createInlineView(document);
    view.render(record);
    record.fail("Translation unavailable");

    // When
    view.setError(record, "Translation unavailable");

    // Then
    expect(ownedShadow("inline").textContent).toContain("Bonjour");
    expect(ownedShadow("inline").textContent).toContain("Translation unavailable");
  });

  it("passes action activation through a callback", () => {
    // Given
    const source = sourceFixture();
    const record = createRecordStore().getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    const onAction = vi.fn();
    const view = createInlineView(document, { onAction });
    view.render(record);

    // When
    source.nextElementSibling?.dispatchEvent(event("local-translator-action"));
    expect(onAction).not.toHaveBeenCalled();
    ownedShadow("inline").querySelector<HTMLButtonElement>("button")?.click();

    // Then
    expect(onAction).toHaveBeenCalledWith(record);
  });

  it("treats translated markup as text", () => {
    // Given
    const record = createRecordStore().getOrCreate(sourceFixture());
    record.complete('<img onerror="globalThis.pwned=true">', "en", "fr");
    const view = createInlineView(document);

    // When
    view.render(record);

    // Then
    expect(document.querySelector("img")).toBeNull();
    expect(ownedShadow("inline").textContent).toContain("<img onerror=");
    expect(document.querySelector<HTMLElement>("[data-local-translator-ui]")?.textContent).toBe("");
  });

  it("removes an inline host when the store removes its record", () => {
    // Given
    const store = createRecordStore();
    const source = sourceFixture();
    const record = store.getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    createInlineView(document).render(record);

    // When
    store.remove(source);

    // Then
    expect(document.querySelector("[data-local-translator-ui]")).toBeNull();
  });

  it("removes inline hosts when the store is cleared", () => {
    // Given
    const store = createRecordStore();
    const record = store.getOrCreate(sourceFixture());
    record.complete("Bonjour", "en", "fr");
    createInlineView(document).render(record);

    // When
    store.clear();

    // Then
    expect(document.querySelector("[data-local-translator-ui]")).toBeNull();
  });
});

describe("hover view", () => {
  it("restores exact text nodes after hover replacement", () => {
    // Given
    const source = sourceFixture();
    const original = source.innerHTML;
    const record = createRecordStore().getOrCreate(source);
    record.complete("안녕하세요", "en", "ko");
    const view = createHoverView();
    view.render(record);

    // When
    source.dispatchEvent(event("pointerenter"));
    expect(source.textContent).toBe("안녕하세요");
    source.dispatchEvent(event("pointerleave"));

    // Then
    expect(source.innerHTML).toBe(original);
  });

  it("activates and restores from keyboard focus", () => {
    // Given
    const source = sourceFixture();
    const record = createRecordStore().getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    const view = createHoverView();
    view.render(record);

    // When
    source.dispatchEvent(event("focus"));
    expect(source.textContent).toBe("Bonjour");
    source.dispatchEvent(event("blur"));

    // Then
    expect(source.textContent).toBe("Hello careful world");
  });

  it("restores an active replacement immediately during destroy", () => {
    // Given
    const source = sourceFixture();
    const original = source.innerHTML;
    const record = createRecordStore().getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    const view = createHoverView();
    view.render(record);
    source.dispatchEvent(event("pointerenter"));

    // When
    view.destroy();

    // Then
    expect(source.innerHTML).toBe(original);
  });

  it("restores before the store marks a record stale", () => {
    // Given
    const store = createRecordStore();
    const source = sourceFixture();
    const record = store.getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    const view = createHoverView();
    view.render(record);
    source.dispatchEvent(event("pointerenter"));

    // When
    store.markStale(record);

    // Then
    expect(source.textContent).toBe("Hello careful world");
  });

  it("marks hover text swaps as view-owned mutations", () => {
    // Given
    const source = sourceFixture();
    const record = createRecordStore().getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    createHoverView().render(record);

    // When
    source.dispatchEvent(event("pointerenter"));

    // Then
    expect(record.isViewMutation(record.snapshot[0]?.node ?? document.createTextNode(""))).toBe(
      true,
    );
  });

  it("preserves page-owned text changes made during an active replacement", () => {
    // Given
    const source = sourceFixture("Old state");
    const record = createRecordStore().getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    createHoverView().render(record);
    source.dispatchEvent(event("pointerenter"));
    const node = record.snapshot[0]?.node;
    if (node === undefined) throw new Error("fixture text missing");

    // When
    node.data = "Updated by page";
    source.lang = "de";
    source.dispatchEvent(event("pointerleave"));

    // Then
    expect(source.textContent).toBe("Updated by page");
    expect(source.lang).toBe("de");
  });

  it("keeps active success visible on error and announces it", () => {
    // Given
    const source = sourceFixture("Hello");
    const record = createRecordStore().getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    const view = createHoverView();
    view.render(record);
    source.dispatchEvent(event("pointerenter"));
    record.fail("Translation unavailable");

    // When
    view.setError(record, "Translation unavailable");

    // Then
    expect(source.textContent).toBe("Bonjour");
    expect(ownedShadow("hover").textContent).toContain("Translation unavailable");
  });

  it("invokes hover actions only from its closed-shadow button", () => {
    // Given
    const source = sourceFixture("Hello");
    const record = createRecordStore().getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    const onAction = vi.fn();
    createHoverView({ onAction }).render(record);
    source.dispatchEvent(event("pointerenter"));
    expect(ownedShadow("hover").querySelector("style")?.textContent).toContain(":host([hidden])");

    // When
    source.dispatchEvent(event("local-translator-action"));
    expect(onAction).not.toHaveBeenCalled();
    ownedShadow("hover").querySelector<HTMLButtonElement>("button")?.click();

    // Then
    expect(onAction).toHaveBeenCalledWith(record);
  });

  it("dismisses an active hover action with Escape", () => {
    // Given
    const source = sourceFixture("Hello");
    const record = createRecordStore().getOrCreate(source);
    record.complete("Bonjour", "en", "fr");
    createHoverView().render(record);
    source.dispatchEvent(event("pointerenter"));
    const button = ownedShadow("hover").querySelector<HTMLButtonElement>("button");
    if (button === null) throw new Error("fixture action missing");

    // When
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    // Then
    expect(source.textContent).toBe("Hello");
    expect(document.querySelector<HTMLElement>('[data-local-translator-ui="hover"]')?.hidden).toBe(
      true,
    );
  });

  it("uses changed source text as the baseline after retranslation", () => {
    // Given
    const store = createRecordStore();
    const source = sourceFixture("Old source");
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

    // When
    source.dispatchEvent(event("pointerenter"));
    expect(source.textContent).toBe("Nouvelle");
    source.dispatchEvent(event("pointerleave"));

    // Then
    expect(source.textContent).toBe("Updated source");
    expect(record.snapshot.map(({ value }) => value)).toEqual(["Old source"]);
  });
});
