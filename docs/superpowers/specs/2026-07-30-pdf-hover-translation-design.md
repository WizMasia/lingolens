# PDF Hover Translation Design

## 1. Goal

Add text-based PDF reading to LingoLens without attempting to inject into Chrome's built-in PDF viewer. A user opens the current remote PDF or a local PDF in an extension-owned viewer, keeps the essential reading controls they expect, and sees an on-device translation while hovering or focusing a paragraph.

The first release supports PDFs that already contain extractable text. It does not perform OCR.

## 2. Scope

### Included

- Open the current remote PDF in a LingoLens viewer tab.
- Open a local PDF through a file picker without requesting broad `file://` access.
- Render PDFs with a bundled, reduced PDF.js Generic Viewer.
- Preserve continuous scrolling, page navigation, zoom, fit-to-width, fit-to-page, search, text selection, rotation, download, and print.
- Group PDF text-layer content into paragraph-sized translation targets.
- Translate a paragraph on hover or keyboard focus with the existing Chrome-managed, on-device translation engine.
- Display the translation in a read-only overlay anchored to the source paragraph.
- Close the overlay immediately when pointer or keyboard focus leaves the paragraph.
- Reuse cached results when the same paragraph is visited again.
- Recalculate overlay geometry after zoom or rotation without retranslating.
- Show clear model, language-pair, loading, and failure states.
- Let the user enable or disable PDF hover translation in Options.

### Explicitly excluded

- OCR for scanned or image-only PDFs.
- Translation of text contained inside ordinary web-page images.
- Full-document PDF translation.
- Replacing text inside the PDF canvas.
- PDF editing, annotations, form filling, signatures, attachment execution, or document scripting.
- Thumbnail and outline sidebars in the first version.
- Per-paragraph language overrides or pinned translations.

OCR is a later shared project for both scanned PDFs and web-page images. This design does not introduce a speculative OCR interface; it keeps PDF text extraction behind a narrow boundary that a future OCR source can feed when that work begins.

## 3. Platform Decision

Chrome's built-in PDF viewer belongs to another extension origin. LingoLens cannot inject a content script into that viewer or observe its internal text-layer DOM. The PDF feature therefore runs in a top-level LingoLens extension page.

PDF.js handles PDF parsing, canvas rendering, text selection, search, navigation, zoom, rotation, print, and download. LingoLens adds only:

- source acquisition;
- paragraph grouping;
- paragraph interaction state;
- on-device translation;
- the translation overlay;
- LingoLens-specific status and scope copy.

The PDF.js worker performs parsing and rendering only. Chrome's Language Detector and Translator APIs run in the top-level viewer window because they are not available in Web Workers.

## 4. Entry and Source Loading

The popup adds two secondary actions:

- **Open current PDF in LingoLens**
- **Open PDF from this computer**

Both actions remain visible for discoverability. When PDF hover translation is disabled, they are disabled and their helper text points to the PDF setting in Options.

For a remote source, the background coordinator reads the active tab URL and opens the extension viewer with that URL as its source. The viewer accepts only `http:` and `https:` URLs, fetches under the existing host permissions, and verifies that the response can be parsed as a PDF. A filename suffix or response `Content-Type` is useful evidence but is not trusted as the sole validation.

Authenticated or anti-hotlink PDFs may reject an extension-origin fetch. The viewer reports that limitation and offers the local-file action; the first version does not add cookie inspection or request interception.

For a local source, a native file input accepts a PDF and passes its bytes directly to PDF.js. LingoLens does not request `file:///*` host access.

The original PDF bytes remain available to the viewer's download and print paths for the lifetime of the tab. They are not stored in `chrome.storage` and are discarded when the viewer closes.

## 5. Viewer Composition and Weight

The build includes PDF.js only in the PDF viewer entry and worker. Ordinary page content scripts, the popup, options, and background runtime do not import PDF.js.

The viewer includes only the approved controls:

- previous and next page;
- current page and total page count;
- zoom in and out;
- fit width and fit page;
- search;
- rotate;
- download;
- print.

Unused Generic Viewer features and assets are omitted. Required character maps and standard-font data remain available so text extraction does not silently fail for supported non-Latin documents.

The implementation records production bundle sizes before and after the feature. Acceptance requires:

- no PDF.js code in the ordinary page content bundle;
- PDF assets loaded only after the PDF viewer opens;
- PDF.js lazy page rendering preserved;
- no eager translation or paragraph extraction for every unrendered page;
- the package-size delta reported with the implementation handoff.

There is no invented size ceiling before measuring the real reduced build. If the measured package delta is disproportionate, the implementation stops at the measured evidence and revisits the selected Generic Viewer components instead of creating a custom PDF renderer.

## 6. Paragraph Model

Each rendered page produces immutable paragraph records:

- page index;
- paragraph index within the page;
- normalized source text;
- the text-layer spans belonging to the paragraph;
- one or more client rectangles;
- stable text identity used by the translation cache.

Paragraph boundaries follow this precedence:

1. Use the PDF structure tree and marked-content relationships when the PDF is tagged well enough to identify paragraph-like blocks.
2. Otherwise group text items geometrically by baseline, font scale, horizontal continuity, line gap, indentation, and column.

The fallback does not claim semantic reconstruction. It must keep separate columns separate and avoid joining text across a large vertical gap. Headers, footers, captions, and list items may become short independent targets.

Paragraph records are created when a page's text layer is ready. Records for pages that PDF.js releases may be discarded; successful translation results remain in the existing bounded text-result cache.

## 7. Translation Flow

The PDF viewer creates the existing Chromium AI adapter and translation engine in its top-level window. It reuses global source and target settings, language detection, language-pair availability checks, translator reuse, bounded result caching, in-flight request deduplication, and Korean error copy.

Options stores a `pdfTranslationEnabled` boolean with the existing synchronized settings. It defaults to `true` because PDF processing is already user-initiated and never starts merely by visiting a PDF URL.

When the setting changes:

- the existing storage-change broadcast reaches open PDF viewer tabs;
- disabling removes paragraph hover and focus behavior, closes the active overlay, cancels pending activation, and destroys the viewer's translation engine;
- the PDF remains open with its approved PDF.js reading controls;
- enabling creates a fresh translation engine and restores paragraph interaction without reloading the PDF;
- the popup updates both PDF actions immediately.

The PDF feature receives plain paragraph text directly. It does not force PDF paragraphs through the existing `HTMLElement` translation controller or element record store because those units own host-page DOM restoration and stale-content behavior that PDF canvas pages do not share.

One small PDF paragraph controller owns:

- the current hovered or keyboard-focused paragraph;
- a 200 ms hover activation timer;
- the active translation request identity;
- the active overlay;
- geometry refresh after viewer scale or rotation events.

Leaving a paragraph cancels an unstarted activation and closes the overlay. A translation already in flight may finish and enter the result cache, but it cannot reopen an overlay after the user has left.

## 8. Interaction and Overlay

PDF.js text-layer spans remain the pointer surface. LingoLens listens to pointer transitions and maps each span to its paragraph. It does not place a pointer-blocking rectangle over the text, so text selection, links, and search highlights retain their PDF.js behavior.

Moving between spans in the same paragraph keeps the overlay open. Moving to another paragraph or outside the paragraph closes it immediately.

The overlay:

- uses the existing LingoLens paper, ink, border, typography, direction, and reduced-motion tokens;
- is anchored to the union of the paragraph's visible rectangles;
- covers the source region when possible and expands downward when the translation is longer;
- remains inside the viewport;
- has `pointer-events: none`;
- displays a compact loading state before the first result;
- displays translated plain text only;
- sets the translated language and direction;
- never changes the PDF text layer or canvas.

For keyboard access, each page owns non-pointer-blocking focus proxies with roving `tabindex`. `Tab` enters the page's paragraph translation layer once, Up and Down move between paragraphs, focus opens the same overlay as hover, and `Escape` closes the overlay and returns to PDF navigation.

## 9. User Copy and OCR Boundary

The viewer shows this persistent compact notice:

> 텍스트 PDF만 번역할 수 있습니다. 현재 버전은 스캔 문서와 이미지 PDF의 OCR을 지원하지 않습니다.

Options includes a checkbox labeled:

> PDF 호버 번역 사용

Its helper copy states that PDF files open in a separate LingoLens viewer and that the current version does not support OCR. When the setting is disabled in an open viewer, the translation notice is replaced by:

> PDF 호버 번역이 설정에서 꺼져 있습니다.

When a rendered page has no extractable text, the viewer shows:

> 번역할 수 있는 텍스트를 찾지 못했습니다. 이미지로 구성된 PDF일 수 있으며, 현재 버전에서는 OCR을 지원하지 않습니다.

The empty-text state does not call the language detector or translator. The viewer does not scan every unrendered page only to classify the whole document. A document with some text remains usable; image-only pages show no paragraph targets and later text pages remain translatable.

## 10. Security and Privacy

- PDF.js document scripting is disabled.
- PDF attachments and embedded actions are not executed.
- Parsed PDF text is sent only to Chrome-managed local Language Detector and Translator APIs.
- LingoLens does not upload PDF bytes or extracted text.
- Overlay content is assigned as text, never interpreted as HTML.
- Remote sources are restricted to URLs already covered by declared HTTP/HTTPS host permissions.
- Local source bytes stay in memory for the viewer tab and are not persisted.
- Viewer teardown destroys the translation engine and releases document, worker, object-URL, listener, and overlay resources.

## 11. Error Handling

- Invalid or non-PDF source: explain that the current tab could not be opened as a PDF and offer local file selection.
- Remote fetch rejected: explain that protected PDFs may need to be downloaded and opened locally.
- PDF hover translation disabled: keep the PDF readable, do not create an AI adapter, and link to Options.
- Password-protected PDF: report that password-protected documents are not supported in the first version and do not request or store a password.
- Corrupt PDF: report a document-open failure without starting translation.
- No extractable text on a rendered page: show the OCR-specific empty state without scanning every unopened page.
- API unavailable: reuse the existing on-device translation unavailable message.
- Model downloading: keep the source readable and show progress in the viewer status.
- Unknown source language: ask the user to set a fixed global source language in Options.
- Unsupported pair or translation failure: retain the source PDF and show the existing typed error in the overlay/status region.
- Zoom, rotation, page disposal, tab close, or source replacement invalidates active overlay ownership so late work cannot render into stale geometry.

## 12. Verification

### Automated

- Source validation accepts remote HTTP/HTTPS and local PDF bytes while rejecting other schemes and non-PDF data.
- Settings parsing defaults PDF hover translation to enabled and preserves explicit disablement.
- Popup PDF actions and open viewer behavior update when the PDF setting changes.
- Disabling destroys translation resources and closes the overlay without unloading the PDF.
- Re-enabling restores paragraph interaction with a fresh engine without reloading the PDF.
- Tagged paragraph grouping honors structure boundaries.
- Geometric grouping keeps columns separate, joins wrapped lines, and separates large vertical gaps.
- Paragraph identity remains stable across zoom and rotation.
- Hover waits 200 ms, movement within one paragraph keeps the overlay, and leaving closes it.
- A late translation cannot reopen a closed or superseded overlay.
- Repeated paragraph visits reuse the translation result.
- Empty-text rendered pages produce the OCR-specific state without an AI call.
- Viewer events update geometry without retranslating.
- Keyboard roving focus opens, moves, and closes the overlay.
- Translated output is rendered as text and respects language direction.

### Production build

- TypeScript and Biome checks pass.
- The full existing test suite passes.
- The production extension build passes.
- Built artifacts prove PDF.js is isolated to the PDF viewer and worker entries.
- Before/after package and entry sizes are recorded.

### Manual Chrome acceptance

- Open a remote text PDF from the Chrome PDF tab.
- Open a local text PDF through the file picker.
- Verify continuous scrolling, page navigation, zoom, fit modes, search, selection, rotation, download, and print.
- Hover paragraphs on a single-column and multi-column document.
- Move between spans inside one paragraph and then leave it.
- Revisit a translated paragraph and observe the cached result.
- Navigate with keyboard focus and close with `Escape`.
- Zoom and rotate while translations are cached.
- Verify Korean, English, Japanese, and Arabic direction/selection behavior on available language pairs.
- Open a scanned PDF and verify the explicit OCR-not-supported state.
- Open a mixed text-and-image PDF and verify text pages remain translatable while image-only pages expose no false targets.
- Close the viewer and confirm no worker, model, overlay, or object URL remains active.

## 13. Release Boundary

This feature is ready only after the automated gates, production-size evidence, and installed-Chrome manual acceptance pass. Passing unit tests alone does not establish PDF viewer compatibility.

The later OCR project must cover both web-page images and scanned/image-only PDF pages. It is not a follow-up hidden inside this implementation.
