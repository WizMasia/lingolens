import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";
import type { TranslationResult } from "../../src/content/ai-engine";
import { createPdfOverlay } from "../../src/pdf/overlay";
import type { PdfParagraphTarget } from "../../src/pdf/paragraph-interaction";

const testWindow = new Window({ width: 800, height: 600 });
Object.defineProperties(globalThis, {
  document: { configurable: true, value: testWindow.document },
  window: { configurable: true, value: testWindow },
});

const translated: TranslationResult = {
  kind: "translated",
  text: "번역된 문단 (1)",
  sourceLanguage: "en",
  targetLanguage: "ko",
  provenance: "lang",
};

describe("PDF translation overlay", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("uses the source width and body font size without a source minimum height", () => {
    const body = document.createElement("span");
    body.textContent = "Term";
    body.style.fontSize = "12px";
    const annotation = document.createElement("span");
    annotation.textContent = "1";
    annotation.style.fontSize = "6px";
    Object.defineProperty(body, "getClientRects", {
      value: () => [{ left: 100, top: 80, right: 280, bottom: 100 }],
    });
    Object.defineProperty(annotation, "getClientRects", {
      value: () => [{ left: 270, top: 76, right: 280, bottom: 84 }],
    });
    document.body.append(body, annotation);
    const target: PdfParagraphTarget = {
      id: "one",
      text: "Term (1)",
      pageNumber: 1,
      spans: [body, annotation],
      bodySpans: [body],
    };

    createPdfOverlay(document).showResult(target, translated);

    const overlay = document.querySelector<HTMLElement>(".lt-pdf-translation-overlay");
    expect(overlay?.style.inlineSize).toBe("180px");
    expect(overlay?.style.minBlockSize).toBe("");
    expect(overlay?.style.fontSize).toBe("12px");
    expect(overlay?.textContent).toBe("번역된 문단 (1)");
    expect(overlay?.lang).toBe("ko");
    expect(overlay?.dir).toBe("ltr");
  });
});
