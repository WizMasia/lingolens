import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { printPdf } from "./print";
import type { PdfBytes } from "./source";

export function wirePdfControls(
  document: Document,
  source: PdfBytes,
  pdf: PDFDocumentProxy,
  viewer: PDFViewer,
  eventBus: EventBus,
  onStatus: (message: string) => void,
): (() => void)[] {
  const previous = required(document, "previous-page", HTMLButtonElement);
  const next = required(document, "next-page", HTMLButtonElement);
  const pageNumber = required(document, "page-number", HTMLInputElement);
  const pageCount = required(document, "page-count", HTMLSpanElement);
  const zoomOut = required(document, "zoom-out", HTMLButtonElement);
  const zoomIn = required(document, "zoom-in", HTMLButtonElement);
  const zoomValue = required(document, "zoom-value", HTMLOutputElement);
  const fitWidth = required(document, "fit-width", HTMLButtonElement);
  const fitPage = required(document, "fit-page", HTMLButtonElement);
  const search = required(document, "pdf-search", HTMLFormElement);
  const searchQuery = required(document, "search-query", HTMLInputElement);
  const searchCount = required(document, "search-count", HTMLOutputElement);
  const rotate = required(document, "rotate", HTMLButtonElement);
  const download = required(document, "download", HTMLButtonElement);
  const print = required(document, "print", HTMLButtonElement);
  const printContainer = required(document, "print-container", HTMLDivElement);
  const removers: (() => void)[] = [];
  pageCount.textContent = String(pdf.numPages);
  pageNumber.max = String(pdf.numPages);

  const listen = <EventType extends Event>(
    element: Element,
    type: string,
    listener: (event: EventType) => void,
  ): void => {
    const handler: EventListener = (event) => listener(event as EventType);
    element.addEventListener(type, handler);
    removers.push(() => element.removeEventListener(type, handler));
  };
  listen(previous, "click", () => {
    viewer.currentPageNumber = Math.max(1, viewer.currentPageNumber - 1);
  });
  listen(next, "click", () => {
    viewer.currentPageNumber = Math.min(pdf.numPages, viewer.currentPageNumber + 1);
  });
  listen(pageNumber, "change", () => {
    viewer.currentPageNumber = clamp(Number(pageNumber.value), 1, pdf.numPages);
  });
  listen(zoomOut, "click", () => {
    viewer.currentScale = clamp(viewer.currentScale / 1.1, 0.25, 5);
  });
  listen(zoomIn, "click", () => {
    viewer.currentScale = clamp(viewer.currentScale * 1.1, 0.25, 5);
  });
  listen(fitWidth, "click", () => {
    viewer.currentScaleValue = "page-width";
  });
  listen(fitPage, "click", () => {
    viewer.currentScaleValue = "page-fit";
  });
  listen(search, "submit", (event) => {
    event.preventDefault();
    eventBus.dispatch("find", {
      source: window,
      type: "",
      query: searchQuery.value,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: false,
    });
  });
  listen(rotate, "click", () => {
    viewer.pagesRotation = (viewer.pagesRotation + 90) % 360;
  });
  listen(download, "click", () => {
    void pdf.getData().then((bytes) => downloadBytes(document, bytes, source.name));
  });
  listen(print, "click", () => {
    onStatus("인쇄용 페이지를 준비하는 중입니다…");
    void printPdf(pdf, printContainer).then(
      () => onStatus(`${source.name} · ${pdf.numPages}페이지`),
      () => onStatus("인쇄용 페이지를 준비하지 못했습니다."),
    );
  });

  const pagesInit = (): void => {
    viewer.currentScaleValue = "page-width";
    onStatus(`${source.name} · ${pdf.numPages}페이지`);
  };
  const pageChanging = (event: unknown): void => {
    const value = numberProperty(event, "pageNumber");
    if (value !== undefined) pageNumber.value = String(value);
  };
  const scaleChanging = (event: unknown): void => {
    const value = numberProperty(event, "scale");
    if (value !== undefined) zoomValue.textContent = `${Math.round(value * 100)}%`;
  };
  const matchesCount = (event: unknown): void => {
    const matches = objectProperty(event, "matchesCount");
    const current = numberProperty(matches, "current") ?? 0;
    const total = numberProperty(matches, "total") ?? 0;
    searchCount.textContent = total === 0 ? "결과 없음" : `${current}/${total}`;
  };
  eventBus.on("pagesinit", pagesInit);
  eventBus.on("pagechanging", pageChanging);
  eventBus.on("scalechanging", scaleChanging);
  eventBus.on("updatefindmatchescount", matchesCount);
  removers.push(() => eventBus.off("pagesinit", pagesInit));
  removers.push(() => eventBus.off("pagechanging", pageChanging));
  removers.push(() => eventBus.off("scalechanging", scaleChanging));
  removers.push(() => eventBus.off("updatefindmatchescount", matchesCount));
  return removers;
}

const objectProperty = (value: unknown, key: string): object | undefined => {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const property = value[key as keyof typeof value];
  return typeof property === "object" && property !== null ? property : undefined;
};

const numberProperty = (value: unknown, key: string): number | undefined => {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const property = value[key as keyof typeof value];
  return typeof property === "number" ? property : undefined;
};

const downloadBytes = (document: Document, bytes: Uint8Array, name: string): void => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(Number.isFinite(value) ? value : minimum, minimum), maximum);

const required = <ElementType extends Element>(
  document: Document,
  id: string,
  type: { new (): ElementType },
): ElementType => {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new TypeError(`Missing PDF viewer element: ${id}`);
  return element;
};
