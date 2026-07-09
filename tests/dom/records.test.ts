import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import { createRecordStore, InvalidRecordTransitionError } from "../../src/content/records";

const testWindow = new Window();
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: testWindow.document,
});

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
});
