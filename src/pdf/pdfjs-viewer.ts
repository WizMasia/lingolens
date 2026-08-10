import {
  AnnotationEditorType,
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { wirePdfControls } from "./controls";
import type { PdfParagraphTarget } from "./paragraph-interaction";
import { groupPdfParagraphs, type PdfTextFragment } from "./paragraphs";
import type { PdfBytes } from "./source";
import { pdfStructureBlocks } from "./structure-tree";
import { pdfTextFragments } from "./text-items";

export type PdfViewerCallbacks = Readonly<{
  onParagraphs(
    pageNumber: number,
    layer: HTMLElement,
    targets: readonly PdfParagraphTarget[],
  ): void;
  onEmptyPage(pageNumber: number): void;
  onStatus(message: string): void;
  onGeometryChange(): void;
}>;

export type PdfViewerSession = Readonly<{
  document: PDFDocumentProxy;
  destroy(): Promise<void>;
}>;

export async function createPdfViewerSession(
  document: Document,
  source: PdfBytes,
  callbacks: PdfViewerCallbacks,
): Promise<PdfViewerSession> {
  GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
  const container = required(document, "viewerContainer", HTMLDivElement);
  const viewerElement = required(document, "viewer", HTMLDivElement);
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const findController = new PDFFindController({ eventBus, linkService });
  const viewer = new PDFViewer({
    container,
    viewer: viewerElement,
    eventBus,
    linkService,
    findController,
    annotationMode: AnnotationMode.ENABLE,
    annotationEditorMode: AnnotationEditorType.DISABLE,
    imageResourcesPath: chrome.runtime.getURL("styles/images/"),
    enablePrintAutoRotate: true,
  });
  linkService.setViewer(viewer);
  const loadingTask = getDocument({
    data: source.bytes.slice(),
    cMapUrl: chrome.runtime.getURL("pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL("pdfjs/standard_fonts/"),
    wasmUrl: chrome.runtime.getURL("pdfjs/wasm/"),
    iccUrl: chrome.runtime.getURL("pdfjs/iccs/"),
  });
  const pdf = await loadingTask.promise;
  linkService.setDocument(pdf);
  findController.setDocument(pdf);
  viewer.setDocument(pdf);

  const removers = wirePdfControls(document, source, pdf, viewer, eventBus, callbacks.onStatus);
  const processedLayers = new WeakSet<HTMLElement>();
  const textLayerRendered = (event: unknown): void => {
    const pageNumber = numberProperty(event, "pageNumber");
    if (pageNumber === undefined) return;
    const layer = document.querySelector<HTMLElement>(
      `.page[data-page-number="${pageNumber}"] .textLayer`,
    );
    if (layer === null || processedLayers.has(layer)) return;
    processedLayers.add(layer);
    void paragraphTargets(pdf, pageNumber, layer).then((targets) => {
      if (targets === undefined) {
        callbacks.onStatus(`${pageNumber}페이지의 텍스트 문단을 구성하지 못했습니다.`);
      } else if (targets.length === 0) callbacks.onEmptyPage(pageNumber);
      else callbacks.onParagraphs(pageNumber, layer, targets);
    });
  };
  const geometryChanged = (): void => callbacks.onGeometryChange();
  eventBus.on("textlayerrendered", textLayerRendered);
  eventBus.on("scalechanging", geometryChanged);
  eventBus.on("rotationchanging", geometryChanged);
  removers.push(() => eventBus.off("textlayerrendered", textLayerRendered));
  removers.push(() => eventBus.off("scalechanging", geometryChanged));
  removers.push(() => eventBus.off("rotationchanging", geometryChanged));

  return {
    document: pdf,
    async destroy() {
      for (const remove of removers) remove();
      await loadingTask.destroy();
    },
  };
}

const paragraphTargets = async (
  pdf: PDFDocumentProxy,
  pageNumber: number,
  layer: HTMLElement,
): Promise<readonly PdfParagraphTarget[] | undefined> => {
  const page = await pdf.getPage(pageNumber);
  const [content, structure] = await Promise.all([
    page.getTextContent({ includeMarkedContent: true }),
    page.getStructTree().catch(() => undefined),
  ]);
  const fragments: PdfTextFragment[] = pdfTextFragments(content.items);
  const spans = [...layer.querySelectorAll<HTMLElement>("span:not(.markedContent)")].filter(
    (span) => span.textContent?.length !== 0,
  );
  if (
    spans.length !== fragments.length ||
    spans.some((span, index) => span.textContent !== fragments[index]?.text)
  ) {
    return undefined;
  }
  return groupPdfParagraphs(pageNumber, fragments, pdfStructureBlocks(structure)).map(
    (paragraph) => ({
      id: paragraph.id,
      text: paragraph.text,
      pageNumber,
      spans: paragraph.fragmentIndexes.map((index) => {
        const span = spans[index];
        if (span === undefined) throw new RangeError(`Missing PDF text span at index ${index}`);
        return span;
      }),
      bodySpans: paragraph.bodyFragmentIndexes.map((index) => {
        const span = spans[index];
        if (span === undefined) throw new RangeError(`Missing PDF text span at index ${index}`);
        return span;
      }),
    }),
  );
};

const numberProperty = (value: unknown, key: string): number | undefined => {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const property = value[key as keyof typeof value];
  return typeof property === "number" ? property : undefined;
};

const required = <ElementType extends Element>(
  document: Document,
  id: string,
  type: { new (): ElementType },
): ElementType => {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new TypeError(`Missing PDF viewer element: ${id}`);
  return element;
};
