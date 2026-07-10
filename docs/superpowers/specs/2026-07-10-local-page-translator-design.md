# Local Page Translator MVP Design

## 1. Goal

Build a desktop Chrome extension that translates web-page text on the user's device. The MVP uses Chrome's stable Language Detector and Translator APIs, sends no page content to a remote service, and supports both full-page and targeted translation.

The extension must:

- detect source languages automatically per element, including mixed-language pages;
- default the target language to Chrome's UI language and fall back to Korean when that value is unusable;
- let the user override source and target languages globally;
- translate the whole page or the selected/hovered element;
- support inline and hover-replacement display modes;
- use `Ctrl` as the default element-translation trigger while allowing a user-defined trigger;
- let the user retranslate an individual translated element with an explicitly selected language pair;
- preserve and restore the original page content.

## 2. Technical Decision and Constraints

### 2.1 Translation engine

The MVP uses Chrome's built-in `LanguageDetector` and `Translator` APIs. These APIs run locally and use browser-managed expert models. They satisfy the offline and device-compute goals after any required models have been downloaded.

Gemini Nano's Prompt API is not part of the MVP. It is not the most reliable path for Korean translation, has narrower language support, and introduces generative-model behavior where a dedicated translation model is preferable. The translation engine boundary will remain small enough to support another provider later without exposing provider choices in the MVP UI.

### 2.2 Platform constraints

- Minimum supported browser: Chrome 138 on desktop.
- Built-in translation is unavailable on Chrome mobile.
- Language detection and language-pair models may require a first-use download. Downloads require a user activation and an unmetered connection; later translation can run offline.
- The APIs are unavailable in service workers, so translation runs in a content-script document context. The background service worker only coordinates commands, settings, and tab messages.
- Chrome's Commands API cannot bind a modifier-only shortcut such as `Ctrl`. Element translation therefore uses key events captured by the content script. The popup's full-page command remains available when a site consumes the chosen key.
- Browser-internal pages, the Chrome Web Store, PDF viewer internals, and other pages where content scripts cannot run are unsupported. The popup explains this without modifying the page.

## 3. User Experience

### 3.1 Popup

The toolbar popup is the primary control surface and contains:

- current readiness state: ready, downloading model, translating, complete, or error;
- `Translate page` and `Restore page` actions;
- a translated/total element progress indicator;
- the active display mode and target language as concise status, with a link to options.

Starting a full-page translation counts as the user activation required to download a missing model. Closing the popup does not cancel translation; progress continues on the page and is restored when the popup reopens.

### 3.2 Options

The options page stores:

- display mode: `inline` or `hover replacement`;
- source language: `automatic per element` or one fixed language;
- target language: browser default or one fixed language;
- trigger: `Ctrl` by default, or a captured key/modifier combination.

Invalid or reserved trigger input is rejected before saving. The page shows a short conflict warning for common browser shortcuts, but the user may still choose a valid combination that a site could intercept.

### 3.3 Targeted translation

The content script continuously tracks the nearest meaningful text element under the pointer. When the configured trigger is pressed:

1. If a non-collapsed text selection exists, use the nearest meaningful element containing the selection anchor.
2. Otherwise, use the currently hovered meaningful text element.
3. If neither exists, show a brief non-blocking page notice.

The extension translates the entire chosen element, not an arbitrary substring. This keeps inline insertion and restoration deterministic and avoids splitting page-owned text nodes.

### 3.4 Display modes

In inline mode, a translation block is inserted immediately after its source element. It is visually distinct but inherits surrounding width and reading direction. Repeating translation updates the same block rather than inserting another one.

In hover-replacement mode, the source element remains unchanged until its translation is ready and the pointer is over it. While hovered, its visible text nodes are temporarily replaced with translated text; when the pointer leaves, the exact original text nodes are restored. Full-page translation prepares translations in the background, after which each element swaps on hover.

The extension never writes translated HTML. All results are inserted as text to prevent script or markup injection.

### 3.5 Per-element retranslation

Each translated element uses the configured trigger as a toggle and Alt plus that trigger for retranslation:

- inline mode places the action in the translation block;
- hover mode inserts no action surface or sibling element;
- existing focusable sources can temporarily show the translation on focus;
- pressing the configured trigger on an already translated source restores the original;
- pressing Alt plus the configured trigger opens the language control.

The control provides source language (`Auto detect` or explicit) and target language selectors. Confirming `Translate again` affects only that element and does not alter global options. The new result replaces the existing result atomically. If model download or translation fails, the existing result is retained for inline mode and a persistent extension announcement reports the error; hover mode restores the original source text without adding page UI.

Restoring one element removes its translation and per-element language override. Restoring the page removes all extension-generated UI, translations, overrides, and temporary text swaps.

## 4. Architecture

### 4.1 Components

`content script`

- discovers meaningful page text elements;
- tracks selection, hover, and trigger key events;
- detects languages and performs translation;
- owns original-text snapshots, translation records, rendering, restoration, and in-page notices;
- reports progress and readiness through runtime messages.

`background service worker`

- relays popup and options messages to the active tab;
- maintains lightweight per-tab progress so the popup can reconnect;
- reacts to stored setting changes and informs open tabs;
- never calls a built-in AI API.

`popup`

- initiates and restores full-page translation;
- displays current tab state and progress;
- links to options.

`options page`

- validates and saves typed settings in `chrome.storage.sync`;
- derives the default target from `chrome.i18n.getUILanguage()` and falls back to `ko` if no usable base language is present;
- captures a trigger without relying on the Commands API.

### 4.2 Translation engine

The engine exposes operations for availability, per-text language detection, and translation by language pair. It maintains:

- one reusable language detector per document;
- a bounded cache of Translator instances keyed by normalized source and target language;
- a bounded text-result cache keyed by original text, source language, and target language;
- in-flight promise deduplication so repeated requests for the same language pair or text share work.

Translator instances and the detector are destroyed when the content script unloads. Translation work uses a small concurrency limit to keep the page responsive and avoid simultaneous model pressure.

### 4.3 Element records

Records are keyed by actual DOM elements and contain:

- an immutable original-text snapshot;
- the source text fingerprint used for the latest translation;
- detected or explicitly selected source language;
- target language;
- latest successful translation;
- state: queued, detecting, downloading, translating, translated, stale, or error;
- optional per-element language override;
- references to extension-owned inline UI when that display mode is selected.

Page DOM identifiers are not written onto host elements. A `WeakMap` owns live records, while a separate iterable set contains only active translated records for restoration and progress.

## 5. Text Discovery and Multilingual Pages

The scanner walks visible, connected elements in the main document and open shadow roots when accessible. It excludes:

- `script`, `style`, `noscript`, `template`, SVG metadata, and extension-owned UI;
- form controls and editable content to avoid changing user input;
- elements hidden by layout or accessibility attributes;
- empty, punctuation-only, or purely numeric text;
- descendants already represented by a more specific meaningful text container.

Code and preformatted blocks are skipped by default because translating source code is usually destructive to meaning.

For automatic mode, language is detected per element. Detection follows this order:

1. Use an explicit, valid element or ancestor `lang` attribute when present.
2. Detect from the element's text when it is long enough for reliable classification.
3. For short text, detect using a bounded combination of the element and nearby textual context, while translating only the element's own text.
4. If confidence remains below the chosen threshold, mark the source unknown and ask for a source language through the element action rather than guessing.

Elements detected as already matching the target language are skipped. A fixed global source language bypasses detection for all elements unless an element has its own override.

## 6. Full-page Processing

Full-page translation proceeds as a cancellable job:

1. Capture a stable worklist of eligible elements.
2. Detect or resolve each source language.
3. Group work by language pair to maximize Translator reuse.
4. Translate with bounded concurrency and report progress after each element.
5. Render each successful result according to the selected display mode.

One element failure does not abort the page. The final state reports translated, skipped, and failed counts. Starting another full-page job cancels the previous job before creating a new worklist. Dynamic content added afterward is not translated automatically in the MVP; the user can translate it individually or run full-page translation again.

## 7. Dynamic Content and Staleness

A lightweight `MutationObserver` watches only elements with active translation records. If page code changes a source element after translation:

- any active hover replacement is restored first;
- the translation is marked stale;
- inline mode labels the existing result as outdated;
- hover mode stops swapping in the outdated result;
- the element action offers retranslation from the new source text.

Removed elements are discarded from the active record set and their Translator caches remain reusable for other elements.

## 8. Error Handling

Errors are mapped to user-facing states without exposing raw exceptions:

- API unavailable or unsupported page;
- model downloadable or downloading;
- unsupported language pair;
- low-confidence or unknown source language;
- translation failed;
- page changed before rendering;
- job cancelled by a newer request or restoration.

Original content is always the source of truth. A failed first translation adds no replacement. A failed retranslation preserves the latest successful translation. Restoration is synchronous and does not depend on AI API availability.

## 9. Accessibility and Page Compatibility

- Extension UI uses a Shadow DOM boundary to prevent host-page CSS from breaking controls and to avoid leaking extension styles.
- Controls are keyboard reachable, have visible focus states, and expose accessible names.
- Progress and errors use a polite live region; blocking failures use an assertive announcement only when an action cannot continue.
- Inline translations use the target language in `lang` and the appropriate `dir` value.
- Hover replacement is also activated on keyboard focus so it is not pointer-only.
- Original layout-affecting attributes and event listeners are not replaced or cloned.
- Content Security Policy rules are respected; the extension ships no remote code.

## 10. Privacy and Permissions

The extension requests only the permissions required for MVP operation:

- `storage` for settings;
- content-script host access to ordinary HTTP and HTTPS pages so the configured trigger works before the toolbar is clicked;
- no network-service host permissions and no remote-code permission.

Page text is processed by Chrome-managed local models and is never transmitted by the extension. The popup and options page state this plainly. Analytics and telemetry are excluded from the MVP.

The approved MVP requests all-site HTTP/HTTPS content-script access so `Ctrl` translation works immediately on ordinary pages. Chrome's installation permission warning will clearly reflect that access. Browser-internal and other protected schemes remain outside the requested match patterns.

## 11. Verification Strategy

Automated tests cover pure behavior and DOM integration boundaries:

- settings parsing, language normalization, browser-language fallback, and trigger validation;
- eligible-element filtering and nearest-target selection;
- language resolution precedence and low-confidence handling;
- translation cache and in-flight deduplication;
- inline insertion, update-without-duplication, hover swap, restoration, and stale-state handling;
- per-element override and failed-retranslation preservation;
- full-page progress, partial failure, cancellation, and repeated execution.

Built-in AI globals are replaced by typed fakes in automated tests. Tests assert API decisions and rendered behavior, not model-generated wording.

Manual acceptance testing uses an unpacked extension in a compatible Chrome desktop build with:

- an English article translated to Korean in both modes;
- a mixed English/Japanese page with per-element automatic detection;
- selected and hovered element translation via `Ctrl`;
- a changed custom trigger;
- a full-page translation followed by complete restoration;
- per-element source/target override and successful retranslation;
- failed/unsupported pair retranslation that preserves the prior result;
- dynamic source text that becomes stale;
- first-use model download, offline reuse, and an unsupported Chrome page;
- keyboard-only operation and basic screen-reader announcements.

## 12. Out of Scope for MVP

- cloud translation providers or user API keys;
- Gemini Nano Prompt API fallback;
- automatic translation of newly inserted infinite-scroll content;
- translation inside cross-origin iframes;
- image, canvas, PDF, subtitle, audio, or video translation;
- editable-field translation;
- shared translation memory across different websites;
- mobile Chrome and non-Chromium browsers.
