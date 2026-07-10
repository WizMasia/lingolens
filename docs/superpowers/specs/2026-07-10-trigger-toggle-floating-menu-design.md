# Trigger Toggle and Floating Element Menu Design

## Goal

Make the configured trigger key toggle translation on the current element without adding page-flow UI, while reserving a separate shortcut for per-element language selection.

## Interaction

- The configured trigger (default `Ctrl`) translates an untranslated target.
- The same trigger on a target with a successful translation restores that target immediately. It must not open a language menu.
- `Alt` plus the configured trigger opens per-element language selection for an existing translation or an error record. This supports explicit source/target selection after an automatic-detection failure.
- `Alt` is reserved for this menu action, so a saved primary trigger containing Alt falls back to the default Control trigger.
- The existing inline-card language action opens the same language selection UI.

## Floating Menu

`ElementMenu` renders as one extension-owned Shadow DOM host appended to the document body and positioned with `position: fixed` beside the source's viewport rectangle. The host does not appear next to the source in DOM order, does not consume document layout space, and is removed when the action completes, Escape is pressed, or the extension is destroyed.

The menu focuses its source-language selector when opened and shows the detected/used source language from the element's latest successful translation. If no successful detection exists, it shows `Unknown`. Escape and clicking outside dismiss it without changing the translation. `Translate again` replaces only that element's result; `Restore original` removes only that element's translation.

## Implementation Boundaries

- `src/content/index.ts` classifies the primary trigger versus its Alt-modified variant.
- `src/content/controller.ts` restores successful translations on primary-trigger repeat and retains language-menu handling for explicit menu requests and error records.
- `src/content/element-menu.ts` owns fixed positioning, outside-dismissal, focus restoration, and Shadow DOM isolation.
- Existing inline and hover rendering remain unchanged except that no language menu is inserted beside an element.

## Verification

- Content-entry tests distinguish primary trigger toggle from Alt-modified language-menu activation.
- Controller tests prove a repeated primary trigger restores the record without opening a menu.
- Menu tests prove the host is body-level, fixed-positioned, closes on outside click/Escape, and leaves no page-flow sibling.
- Chrome acceptance confirms Ctrl translates/restores, Alt+Ctrl opens a floating menu, and the source has no inserted sibling menu.
