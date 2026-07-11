import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { ElementRecord } from "../../src/content/records";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  Node: { configurable: true, value: testWindow.Node },
  NodeFilter: { configurable: true, value: testWindow.NodeFilter },
  Text: { configurable: true, value: testWindow.Text },
  document: { configurable: true, value: testWindow.document },
});

const sourceFixture = (text = "Hello"): HTMLElement => {
  const source = document.createElement("p");
  source.textContent = text;
  return source;
};

describe("element record detection state", () => {
  beforeEach(() => document.body.replaceChildren());

  it("starts uninspected and stores automatic detection evidence", () => {
    const record = new ElementRecord(sourceFixture(), () => undefined);

    expect(record.detection).toEqual({ kind: "not-detected" });

    record.setDetection({ kind: "detected", language: "en", provenance: "chrome-i18n" });

    expect(record.detection).toEqual({
      kind: "detected",
      language: "en",
      provenance: "chrome-i18n",
    });
  });

  it("clears stale automatic evidence when source text changes", () => {
    const source = sourceFixture();
    const record = new ElementRecord(source, () => undefined);
    record.setDetection({
      kind: "detected",
      language: "en",
      provenance: "language-detector",
    });

    source.textContent = "Bonjour";
    record.refreshSource();

    expect(record.detection).toEqual({ kind: "not-detected" });
  });

  it("clears unresolved evidence when source text changes", () => {
    const source = sourceFixture();
    const record = new ElementRecord(source, () => undefined);
    record.setDetection({ kind: "needs-confirmation" });

    source.textContent = "Longer source text";
    record.refreshSource();

    expect(record.detection).toEqual({ kind: "not-detected" });
  });

  it("reports a fixed override as user-selected and clears it with automatic mode", () => {
    const record = new ElementRecord(sourceFixture(), () => undefined);

    record.setLanguageOverride({ source: "en", target: "ja" });
    expect(record.detection).toEqual({ kind: "user-selected", language: "en" });

    record.setLanguageOverride({ source: "auto", target: "ja" });
    expect(record.detection).toEqual({ kind: "not-detected" });
  });

  it("clears user-selected evidence when the override is removed", () => {
    const record = new ElementRecord(sourceFixture(), () => undefined);
    record.setLanguageOverride({ source: "en", target: "ja" });

    record.setLanguageOverride(null);

    expect(record.detection).toEqual({ kind: "not-detected" });
  });
});
