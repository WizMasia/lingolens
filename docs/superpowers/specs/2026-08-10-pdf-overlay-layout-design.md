# PDF Translation Overlay Layout Design

## Goal

Make the PDF translation overlay follow the source paragraph's width and representative font size while preserving whole-paragraph translation quality. Superscripts and footnote markers remain untranslated visual annotations, while footnote text remains independently translatable.

GitHub tracking issue: [#1](https://github.com/WizMasia/lingolens/issues/1)

## Current Behavior

- `groupPdfParagraphs` flattens every fragment in a paragraph into one space-normalized string.
- The translator receives that whole string, including small raised or lowered fragments.
- The overlay forces a width between 240px and 640px and a minimum height based on the source paragraph.
- The overlay uses a fixed `1rem` font size regardless of the PDF text layer.

## Decisions

### Translation input

Translate the body of a detected paragraph once as a complete string. Do not translate line by line and do not insert source visual line breaks into the request. The browser lays the translated text out naturally inside the source paragraph width.

Compute the representative height as the character-weighted median of all non-whitespace fragment heights. Exclude a fragment from the translation request only when both conditions hold:

1. Its height is at most 75% of the representative height.
2. Its baseline differs by at least 20% of the representative height from the nearest preceding or following body-sized fragment in reading order.

This keeps ordinary small footnote paragraphs translatable: when every fragment in a footnote uses the same small size, that size is the paragraph's representative body size. If classification would leave no body text, treat every fragment as body text.

### Annotation preservation

Carry untranslated superscript and footnote-marker text, font size, and paragraph-relative position into the paragraph target. Render those markers as absolutely positioned annotation spans over the translated overlay. Annotation spans are visual only and do not become part of the translation request.

The marker keeps its original source-relative position. Because translated word order can differ from source word order, the marker is not guaranteed to remain attached to the corresponding translated word. This is accepted for the first iteration; semantic marker reattachment would require language-aware alignment outside this scope.

### Overlay geometry

Use the union of the paragraph body and annotation client rectangles as the source bounds.

- Set overlay inline size to the source width.
- Clamp only to the available viewport width and the existing 8px viewport margin.
- Remove the artificial 240px minimum and 640px maximum.
- Remove the source-height-derived minimum block size.
- Let translated content determine block size, retaining the existing viewport-height safety cap for exceptionally long translations.
- Keep the current top-or-bottom source alignment and recompute it after content, zoom, rotation, and viewer geometry changes.

### Typography

Use the character-weighted median computed `font-size` of body spans as the overlay translation font size. Annotation spans retain their own computed PDF text-layer font sizes. If no finite positive body font size is available, retain the design-system `1rem` fallback.

Keep the existing translation font family, reading line height, target-language `lang`, and RTL direction. This change matches source scale, not the PDF's font family, weight, color, or decorative styling.

## Data Flow

1. PDF.js text items become fragments with text and geometry.
2. Paragraph grouping identifies body fragments and untranslated annotation fragments.
3. `PdfParagraphTarget` carries normalized body text, body spans, annotation metadata, and page identity.
4. The translation engine receives only the normalized body text once.
5. The overlay measures current rendered spans, applies source width and representative body font size, renders the translated text, and positions untranslated annotations.
6. Existing geometry refresh events remeasure the active overlay after zoom, rotation, or viewer changes.

## Accessibility

- Preserve `aria-live="polite"`, translated language, and direction metadata.
- Keep annotation copies out of the live translation announcement so markers are not read twice while the source PDF text layer remains available.
- Do not add focusable controls or change PDF text-layer reading order.
- Keep the existing keyboard focus proxies and Escape dismissal behavior.

## Testing

- Paragraph unit test: a small raised marker is excluded from translation text and retained as annotation metadata.
- Paragraph unit test: a uniformly small footnote paragraph remains translatable body text.
- Overlay DOM test: source width is used without the old 240px/640px bounds, source minimum height is absent, and body font size follows PDF text.
- Overlay DOM test: annotation text keeps its own size and source-relative position.
- Regression checks: RTL metadata, loading/error states, geometry refresh, full test suite, static checks, and production build.
- Manual PDF QA: verify a normal paragraph, a narrow column, a heading, a superscript marker, and a separate footnote at multiple zoom levels.

## Out of Scope

- Line-by-line translation or exact source line-break preservation.
- Semantic alignment of a marker to reordered translated words.
- Source font-family, weight, color, or decoration cloning.
- OCR for scanned or image-only PDFs.
- Changes to ordinary web-page translation surfaces.
