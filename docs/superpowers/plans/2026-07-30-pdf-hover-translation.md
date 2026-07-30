# PDF Hover Translation Implementation Plan

> Execute this plan inline with test-first changes. Keep PDF.js out of the content, popup, options, and background bundles.

**Goal:** Add an option-controlled, text-PDF-only LingoLens viewer with essential PDF controls and paragraph hover/focus translation. OCR remains explicitly unsupported.

**Architecture:** The popup asks the background service worker to open an extension-owned viewer for the current HTTP(S) URL or an empty local-file flow. The viewer uses PDF.js components for rendering and text layers, while small LingoLens modules group text items, manage hover/focus state, and call the existing Chromium AI engine. Settings remain in `chrome.storage.sync`; an open viewer watches storage changes directly so disabling translation tears down only AI interaction, not the PDF document.

**Dependencies:** TypeScript, esbuild, Vitest/Happy DOM, Chrome MV3 APIs, `pdfjs-dist@6.2.108`.

## Global constraints

- The default for `pdfTranslationEnabled` is `true`; only a literal stored `false` disables it.
- Accept remote sources only over `http:` or `https:` and local sources only from a PDF file input.
- Verify `%PDF-` within the first 1,024 bytes before parsing.
- Do not create PDF scripting, annotation editing, form filling, OCR, or a full-document translation pass.
- Extract paragraph records only after a PDF.js text layer renders.
- Keep the translation overlay `pointer-events: none` so selection, links, and search remain usable.
- Preserve the existing 200 ms hover delay, bounded translation cache, and typed Korean error messages by reusing the existing engine.
- Do not scan unopened pages merely to determine whether the whole document is image-only.

## Task 1: Add the synchronized PDF translation setting

**Files:** `src/shared/settings.ts`, `src/options/options.ts`, `src/options/options.html`, `tests/unit/settings.test.ts`, `tests/dom/options.test.ts`

1. Add failing assertions that defaults include `pdfTranslationEnabled: true`, a literal `false` survives parsing, and the Options checkbox loads and saves both states.
2. Add `pdfTranslationEnabled: boolean` to `Settings`.
3. Parse it with:

```ts
pdfTranslationEnabled:
  !("pdfTranslationEnabled" in value) || value.pdfTranslationEnabled !== false,
```

4. Add `#pdf-translation-enabled` to the Options form with the approved OCR helper copy.
5. Run `bunx vitest run tests/unit/settings.test.ts tests/dom/options.test.ts`.
6. Commit as `Add PDF translation setting`.

## Task 2: Route PDF viewer actions through popup and background

**Files:** `src/shared/protocol.ts`, `src/popup/popup.ts`, `src/popup/popup.html`, `src/styles/popup.css`, `src/background/coordinator.ts`, `src/background.ts`, `tests/unit/protocol.test.ts`, `tests/dom/popup.test.ts`, `tests/unit/background.test.ts`

1. Add failing protocol tests for:

```ts
{ type: "open-pdf-viewer", source: "current-tab" }
{ type: "open-pdf-viewer", source: "local" }
```

and reject other source values.
2. Add both popup buttons. When the setting is off, disable both and show `PDF 호버 번역이 설정에서 꺼져 있습니다.`
3. Add `openPdfViewer(sourceUrl?: string): Promise<void>` and `getSettings(): Promise<Settings>` to background dependencies.
4. For `current-tab`, accept only an active `http:` or `https:` URL. For `local`, open without a source URL. Ignore a forged open message when the setting is disabled.
5. Build the extension URL with `new URL(chrome.runtime.getURL("pdf-viewer.html"))` and `searchParams.set("url", sourceUrl)`.
6. Run the three targeted suites and commit as `Route PDF viewer actions`.

## Task 3: Add PDF source validation and the isolated viewer build

**Files:** `package.json`, `bun.lock`, `scripts/build.ts`, `src/pdf/source.ts`, `src/pdf/viewer.html`, `src/pdf/viewer.ts`, `src/styles/pdf.css`, `tests/unit/pdf-source.test.ts`

1. Record the current `dist` total and entry sizes after `bun run build`.
2. Add failing tests for HTTP(S) query parsing, rejection of non-web schemes, local file loading, remote fetch failure, and PDF header validation.
3. Implement:

```ts
export type PdfBytes = Readonly<{
  name: string;
  bytes: Uint8Array;
  sourceUrl?: string;
}>;

export function remotePdfUrl(search: string): URL | undefined;
export function hasPdfHeader(bytes: Uint8Array): boolean;
export function loadRemotePdf(url: URL, request?: typeof fetch): Promise<PdfBytes>;
export function loadLocalPdf(file: File): Promise<PdfBytes>;
```

4. Install exact `pdfjs-dist@6.2.108`.
5. Add only `pdf-viewer.ts` as an esbuild entry. Copy `pdf.worker.min.mjs`, `pdf_viewer.css`, `cmaps`, `standard_fonts`, `wasm`, and `iccs` into viewer-only distribution paths.
6. Add an accessible viewer shell with toolbar, status, persistent OCR notice, file input, `#viewerContainer`, and print container.
7. Run `bunx vitest run tests/unit/pdf-source.test.ts`, `bun run check`, and `bun run build`.
8. Commit as `Add isolated PDF viewer shell`.

## Task 4: Wire the essential PDF.js reading controls

**Files:** `src/pdf/pdfjs-viewer.ts`, `src/pdf/print.ts`, `src/pdf/viewer.ts`, `tests/unit/pdf-print.test.ts`, `tests/dom/pdf-viewer.test.ts`

1. Add a failing print test using a narrow fake document: pages render sequentially to the print container, `window.print()` runs after rendering, and `afterprint` clears canvases.
2. Initialize `GlobalWorkerOptions.workerSrc` with `chrome.runtime.getURL("pdf.worker.min.mjs")`.
3. Construct `EventBus`, `PDFLinkService`, `PDFFindController`, and `PDFViewer`; omit `PDFScriptingManager` and disable annotation editing.
4. Load bytes with `getDocument` and viewer-local `cMapUrl`, `standardFontDataUrl`, `wasmUrl`, and `iccUrl`; call `linkService.setDocument()` and `viewer.setDocument()`.
5. Wire previous/next page, page number, zoom in/out, `page-width`, `page-fit`, search, clockwise rotation, download from `getData()`, and explicit print rendering at 150 DPI.
6. Reflect `pagesinit`, `pagechanging`, `scalechanging`, `rotationchanging`, and `updatefindmatchescount` in the toolbar/status.
7. Run targeted tests and `bun run build`.
8. Commit as `Add PDF reading controls`.

## Task 5: Group rendered text into stable paragraph targets

**Files:** `src/pdf/paragraphs.ts`, `src/pdf/pdfjs-viewer.ts`, `tests/unit/pdf-paragraphs.test.ts`

1. Add focused failing cases for tagged blocks, wrapped lines, large vertical gaps, two columns, list items, and identity stability across scale/rotation.
2. Define immutable input and output records:

```ts
export type PdfTextFragment = Readonly<{
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  markedContentId?: string;
}>;

export type PdfParagraph = Readonly<{
  id: string;
  pageNumber: number;
  text: string;
  fragmentIndexes: readonly number[];
}>;
```

3. Prefer structure-tree paragraph-like marked-content groups. Otherwise form lines by baseline and font height, partition large horizontal gaps into columns, then join adjacent lines only when vertical gap and indentation remain paragraph-like.
4. Build the stable identity from page number plus normalized text and fragment order, never from client rectangles.
5. On `textlayerrendered`, align string text items with descendant text-layer spans. If alignment is inconsistent, skip targets for that page instead of attaching translation to incorrect text.
6. Run `bunx vitest run tests/unit/pdf-paragraphs.test.ts`.
7. Commit as `Group PDF text paragraphs`.

## Task 6: Add hover, keyboard, and overlay translation

**Files:** `src/pdf/paragraph-interaction.ts`, `src/pdf/overlay.ts`, `src/styles/pdf.css`, `tests/dom/pdf-interaction.test.ts`

1. Add failing fake-timer tests for the 200 ms delay, movement inside one paragraph, immediate leave close, late-result suppression, cached revisit, keyboard Up/Down, and Escape.
2. Map text spans to paragraph records with a `WeakMap<Element, PdfParagraphTarget>`.
3. On pointer entry, start one 200 ms timer. On same-paragraph movement, retain it. On leave or replacement, invalidate the request generation and close the overlay.
4. Add one non-pointer-blocking focus proxy per paragraph. Use a single roving `tabindex`, Up/Down navigation, and Escape back to the viewer.
5. Render loading, success, and typed failure states with `textContent`; set `lang` and `dir`; clamp the union rectangle to the viewport; set `pointer-events: none`.
6. Refresh geometry on scale/rotation events without issuing another translation request.
7. Run `bunx vitest run tests/dom/pdf-interaction.test.ts`.
8. Commit as `Translate PDF paragraphs on hover`.

## Task 7: Integrate live settings and OCR states

**Files:** `src/pdf/viewer.ts`, `src/pdf/pdfjs-viewer.ts`, `src/pdf/paragraph-interaction.ts`, `tests/dom/pdf-viewer.test.ts`

1. Add failing tests that disabled startup never creates the AI engine, disabling destroys it and closes the overlay without destroying the PDF session, and re-enabling creates a fresh engine without refetching/reloading the PDF.
2. Read `Settings` from synchronized storage and subscribe to `chrome.storage.onChanged` in the extension viewer page.
3. Create the existing Chromium AI adapter and translation engine only while `pdfTranslationEnabled` is true.
4. Feed paragraph text into the existing engine with global source and target settings. Do not use the host-page `HTMLElement` controller.
5. When a rendered page has zero text targets, show the approved OCR-specific state and make no AI call. Clear that page state when a later rendered page contains text.
6. On source replacement or tab teardown, destroy the PDF document/worker, engine, interaction, overlays, listeners, and object URLs.
7. Run both PDF DOM suites.
8. Commit as `Integrate PDF translation lifecycle`.

## Task 8: Document, measure, and verify the installed extension

**Files:** `README.md`, `README.ko.md`, `DESIGN.md`, `THIRD_PARTY_NOTICES.md`

1. Document text-PDF support, separate viewer behavior, the Options toggle, and explicit OCR exclusion in both READMEs.
2. Add the PDF viewer surface and paragraph overlay states to `DESIGN.md`.
3. Add the PDF.js Apache-2.0 notice.
4. Run `bun run test`, `bun run check`, and `bun run build`.
5. Compare the new `dist` sizes to the baseline and verify PDF.js strings/assets appear only in `pdf-viewer.js`, the PDF worker, and PDF asset directories.
6. Load `dist` as an unpacked extension in Chrome and manually verify remote/local text PDFs, core controls, selection/search, hover/focus translation, live toggle off/on, scanned-PDF OCR copy, mixed pages, download, and print.
7. Run the frontend visual QA skill against popup, Options, and viewer at desktop and narrow viewport widths; fix blocking findings and repeat the affected checks.
8. Commit as `Document and verify PDF translation`.
