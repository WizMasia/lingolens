# Document Title Translation Design

## Goal

Extend full-page translation to the document title shown in the browser tab while preserving the existing rules for visible, non-editable page text.

The change does not add translation for form controls, editable fields, code blocks, image alternative text, or accessibility attributes.

## Current Behavior

The page scanner translates visible meaningful text elements, including `h1` through `h6`, `caption`, `figcaption`, and `summary`. It deliberately excludes hidden and unsafe content. Because the document `<title>` has no visible layout rectangle and lives outside the body, it is not part of the current element worklist.

Element records and translation views are coupled to rendered body elements. Treating `<title>` as a normal inline or hover target would mix browser-tab state with page rendering and weaken restoration guarantees.

## Design

### Title lifecycle

Add a small document-title translation unit owned by the page translation controller. It stores:

- the latest page-owned source title;
- the translated title written by LingoLens;
- whether LingoLens currently owns the title value;
- the current attempt identity so cancelled or superseded work cannot commit.

The unit translates only a non-empty title containing meaningful Unicode letters. It calls the existing translation engine with the active global source and target preferences. A successful result replaces `document.title`. A skipped result leaves the source title unchanged.

### Page job integration

Full-page translation builds one stable worklist containing the eligible body elements plus one document-title target when eligible. Targets use a discriminated type so title handling remains separate from element rendering.

Title success, skip, and failure contribute to the existing page progress totals. A title failure does not stop body elements from completing.

Targeted selection or hover translation remains element-only. The title is translated only by the full-page action.

### Restoration and page-owned changes

`Restore page` restores the saved source title only while the current title still equals the translation written by LingoLens. This prevents restoration from overwriting a newer title written by the site.

Before a new full-page run, the title unit inspects the current value:

- if it still equals the LingoLens translation, reuse the saved source title;
- if the site changed it, treat the new value as the next source title and relinquish the old translation;
- if no title exists or it is not meaningful, omit the title target.

Cancellation, controller destruction, and restoration invalidate pending title attempts. A late result therefore cannot overwrite the current page title.

### Display modes

The browser-tab title always uses direct replacement because inline and hover presentation do not exist in the browser tab. Body content continues to honor the configured inline or hover display mode.

## Error Handling

- Translation API, language-pair, and unknown-source failures map to a failed page-job target.
- Title failures create no page-level inline UI. The existing page-job failure count remains the user-facing signal.
- A title that changes while translation is pending is treated as stale; its result is discarded.
- Title restoration never overwrites a page-owned value that differs from the last LingoLens translation.

## Testing

Automated tests will verify:

1. a meaningful document title is included in full-page translation and page totals;
2. headings and existing visible text targets continue to translate normally;
3. `Restore page` restores the original title;
4. a same-language or empty title is skipped without mutation;
5. title failure allows body translations to finish and is reflected in failure counts;
6. a page-owned title change is preserved during restore and becomes the source on the next run;
7. cancelled or superseded title work cannot commit a late result;
8. targeted element translation does not translate the document title.

Relevant checks are the focused DOM tests, the full test suite, TypeScript type checking, Biome checks, and the production build.

## Out of Scope

- `alt`, `title`, and `aria-label` attribute translation;
- buttons, options, placeholders, inputs, textareas, and editable content;
- code, preformatted text, SVG metadata, image, canvas, PDF, subtitle, audio, or video translation;
- automatic retranslation on every subsequent document-title mutation.
