import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown) => void>();
  const pdf = {
    getPage: vi.fn(async () => ({
      getTextContent: async () => ({
        items: [
          { type: "beginMarkedContentProps", id: "paragraph-1" },
          {
            str: "Tagged",
            dir: "ltr",
            transform: [1, 0, 0, 1, 0, 20],
            width: 30,
            height: 10,
            fontName: "test",
            hasEOL: false,
          },
          {
            str: "text",
            dir: "ltr",
            transform: [1, 0, 0, 1, 32, 20],
            width: 20,
            height: 10,
            fontName: "test",
            hasEOL: false,
          },
          { type: "endMarkedContent", id: "" },
        ],
        styles: {},
        lang: null,
      }),
      getStructTree: async () => ({
        role: "Root",
        children: [
          {
            role: "P",
            children: [{ type: "content", id: "paragraph-1" }],
          },
        ],
      }),
    })),
  };
  return {
    emit(event: string, value: unknown): void {
      listeners.get(event)?.(value);
    },
    listeners,
    pdf,
  };
});

vi.mock("pdfjs-dist", () => ({
  AnnotationEditorType: { DISABLE: 0 },
  AnnotationMode: { ENABLE: 1 },
  GlobalWorkerOptions: {},
  getDocument: () => ({ destroy: async () => undefined, promise: harness.pdf }),
}));

vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    on(event: string, listener: (value: unknown) => void): void {
      harness.listeners.set(event, listener);
    }

    off(event: string): void {
      harness.listeners.delete(event);
    }
  },
  PDFFindController: class {
    setDocument(): void {}
  },
  PDFLinkService: class {
    setDocument(): void {}
    setViewer(): void {}
  },
  PDFViewer: class {
    setDocument(): void {}
  },
}));

vi.mock("../../src/pdf/controls", () => ({ wirePdfControls: () => [] }));

import { createPdfViewerSession } from "../../src/pdf/pdfjs-viewer";

describe("PDF.js viewer text-layer mapping", () => {
  beforeEach(() => {
    harness.listeners.clear();
    document.body.innerHTML = `
      <div id="viewerContainer"></div>
      <div id="viewer"></div>
      <div class="page" data-page-number="1">
        <div class="textLayer">
          <span class="markedContent">
            <span role="presentation">Tagged</span><span aria-owns="annotation-1">text</span>
          </span>
        </div>
      </div>
    `;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { runtime: { getURL: (path: string): string => path } },
    });
  });

  it("maps role-less accessible text spans inside marked-content wrappers", async () => {
    const callbacks = {
      onEmptyPage: vi.fn(),
      onGeometryChange: vi.fn(),
      onParagraphs: vi.fn(),
      onStatus: vi.fn(),
    };
    const layer = document.querySelector<HTMLElement>(".textLayer");
    if (layer === null) throw new TypeError("Missing text layer");

    await createPdfViewerSession(
      document,
      { bytes: new Uint8Array(), name: "tagged.pdf" },
      callbacks,
    );
    harness.emit("textlayerrendered", { pageNumber: 1 });

    await vi.waitFor(() => expect(callbacks.onParagraphs).toHaveBeenCalledOnce());

    const spans = layer.querySelectorAll<HTMLElement>("span:not(.markedContent)");
    expect(callbacks.onParagraphs).toHaveBeenCalledWith(
      1,
      layer,
      expect.arrayContaining([
        expect.objectContaining({
          bodySpans: [...spans],
          spans: [...spans],
          text: "Tagged text",
        }),
      ]),
    );
    expect(callbacks.onStatus).not.toHaveBeenCalled();
  });
});
