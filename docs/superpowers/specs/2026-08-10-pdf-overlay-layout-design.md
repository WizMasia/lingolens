# PDF Translation Overlay Layout Design

## Goal

Make the PDF translation overlay follow the source paragraph's width and representative font size while preserving whole-paragraph translation quality. Superscripts and footnote markers become parenthetical text after their anchor word, while standalone footnote text remains independently translatable.

GitHub tracking issue: [#1](https://github.com/WizMasia/lingolens/issues/1)

## Current Behavior

- `groupPdfParagraphs` flattens every fragment in a paragraph into one space-normalized string.
- The translator receives that whole string, including small raised or lowered fragments.
- The overlay forces a width between 240px and 640px and a minimum height based on the source paragraph.
- The overlay uses a fixed `1rem` font size regardless of the PDF text layer.

## Decisions

### Translation input

Translate each detected paragraph once as a complete string after inline annotations have been normalized. Do not translate line by line and do not insert source visual line breaks into the request. The browser lays the translated text out naturally inside the source paragraph width.

Compute the representative height as the character-weighted median of all non-whitespace fragment heights. Treat a fragment as an inline annotation only when both conditions hold:

1. Its height is at most 75% of the representative height.
2. Its baseline differs by at least 20% of the representative height from the nearest preceding or following body-sized fragment in reading order.

This keeps ordinary small footnote paragraphs translatable: when every fragment in a footnote uses the same small size, that size is the paragraph's representative body size. If classification would leave no body text, treat every fragment as body text.

For untagged PDF content, associate an annotation candidate with an adjacent body-sized fragment before geometric line and paragraph grouping. The candidate must be no more than 75% of the adjacent fragment's height, have a baseline offset of at least 20% of that height, and be separated horizontally by no more than 1.5 times that height. Choose the closest qualifying preceding or following fragment in reading order. The annotation then inherits its anchor fragment's line and paragraph membership; a candidate with no qualifying anchor remains ordinary standalone text.

### Annotation normalization

Append each inline annotation to its anchor fragment as plain parenthetical text before constructing the paragraph translation request. For example, `word` followed by superscript `1` becomes `word (1)`, and `term` followed by superscript `note` becomes `term (note)`. Multiple annotations attached to one anchor become separate parenthetical groups in source reading order.

Send the normalized parenthetical content through the translator with the rest of the paragraph. The translation result renders as ordinary inline text, so no absolute annotation layer or post-translation word alignment is required.

### Overlay geometry

Use the union of all source paragraph client rectangles as the source bounds.

- Set overlay inline size to the source width.
- Clamp only to the available viewport width and the existing 8px viewport margin.
- Remove the artificial 240px minimum and 640px maximum.
- Remove the source-height-derived minimum block size.
- Let translated content determine block size, retaining the existing viewport-height safety cap for exceptionally long translations.
- Keep the current top-or-bottom source alignment and recompute it after content, zoom, rotation, and viewer geometry changes.

### Typography

Use the character-weighted median computed `font-size` of body spans as the overlay translation font size. Inline annotation spans do not influence this representative size. If no finite positive body font size is available, retain the design-system `1rem` fallback.

Keep the existing translation font family, reading line height, target-language `lang`, and RTL direction. This change matches source scale, not the PDF's font family, weight, color, or decorative styling.

## Data Flow

1. PDF.js text items become fragments with text and geometry.
2. Untagged annotation candidates attach to adjacent body fragments before geometric line and paragraph grouping.
3. Paragraph grouping appends each inline annotation to its anchor as parenthetical text.
4. `PdfParagraphTarget` carries normalized paragraph text, all source spans, body spans, and page identity.
5. The translation engine receives the normalized complete paragraph once.
6. The overlay measures current rendered spans, applies source width and representative body font size, and renders the translated text.
7. Existing geometry refresh events remeasure the active overlay after zoom, rotation, or viewer changes.

## Accessibility

- Preserve `aria-live="polite"`, translated language, and direction metadata.
- Announce the translated parenthetical text once as part of the translated paragraph.
- Do not add focusable controls or change PDF text-layer reading order.
- Keep the existing keyboard focus proxies and Escape dismissal behavior.

## Testing

- Paragraph unit test: a small raised marker becomes parenthetical text after its anchor word.
- Paragraph unit test: an untagged raised marker inherits its adjacent body paragraph instead of becoming a standalone paragraph.
- Paragraph unit test: a uniformly small footnote paragraph remains translatable body text.
- Overlay DOM test: source width is used without the old 240px/640px bounds, source minimum height is absent, and body font size follows PDF text.
- Translation-flow test: parenthetical annotation text is sent once with the complete paragraph.
- Regression checks: RTL metadata, loading/error states, geometry refresh, full test suite, static checks, and production build.
- Manual PDF QA: verify a normal paragraph, a narrow column, a heading, a superscript marker, and a separate footnote at multiple zoom levels.

## Out of Scope

- Line-by-line translation or exact source line-break preservation.
- Exact visual preservation of superscript or subscript positioning in the translated overlay.
- Source font-family, weight, color, or decoration cloning.
- OCR for scanned or image-only PDFs.
- Changes to ordinary web-page translation surfaces.
