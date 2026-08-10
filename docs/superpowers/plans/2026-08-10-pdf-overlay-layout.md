# PDF Translation Overlay Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate PDF paragraphs once with superscripts normalized as parenthetical text, then size the translation overlay from the source paragraph width and representative body font size.

**Architecture:** Extend paragraph grouping to associate small raised or lowered fragments with an adjacent body fragment before geometric grouping. Preserve all source span indexes for overlay bounds, expose body-only indexes for typography, and keep the translation request as one normalized paragraph string. The overlay measures the live PDF.js text layer on every display or geometry refresh.

**Tech Stack:** TypeScript, PDF.js 6, Chrome MV3, Vitest 4 with happy-dom, Biome, Bun.

## Global Constraints

- Translate each normalized paragraph exactly once; never translate line by line.
- Inline annotation: height at most 75% of the anchor height, baseline offset from 20% through 120% of anchor height, horizontal gap at most 1.5 anchor heights.
- Normalize each attached annotation after its anchor as ` (<annotation text>)`; translate the parentheses with the paragraph.
- Standalone small footnote paragraphs remain ordinary translatable paragraphs.
- Overlay width equals the source paragraph width, clamped only by the 8px viewport margins.
- Overlay height is content-driven; retain the existing viewport-height safety cap.
- Overlay font size is the character-weighted median computed font size of body spans; fallback is `1rem`.
- Do not add dependencies or change ordinary web-page translation.
- GitHub issue [#1](https://github.com/WizMasia/lingolens/issues/1) closes only after checks, build, and manual visual QA pass.

## File Map

- Modify `src/pdf/paragraphs.ts`: annotation association, parenthetical normalization, body indexes.
- Modify `src/pdf/paragraph-interaction.ts`: expose body spans on each target.
- Modify `src/pdf/pdfjs-viewer.ts`: map paragraph body indexes to rendered spans.
- Modify `src/pdf/overlay.ts`: source-width sizing and weighted body font size.
- Modify `tests/unit/pdf-paragraphs.test.ts`: annotation and footnote grouping contracts.
- Create `tests/dom/pdf-overlay.test.ts`: overlay geometry and typography contracts.
- Create `tests/fixtures/pdf-overlay-layout.html`: reproducible visual-QA PDF source.
- Modify `DESIGN.md`: record source-width and source-scale PDF overlay behavior.

---

### Task 1: Normalize inline PDF annotations

**Files:**
- Modify: `src/pdf/paragraphs.ts:1-185`
- Test: `tests/unit/pdf-paragraphs.test.ts`

**Interfaces:**
- Produces: `PdfParagraph.bodyFragmentIndexes: readonly number[]`.
- Produces: `PdfParagraph.text` with attached annotations rendered as parenthetical text.
- Preserves: `PdfParagraph.fragmentIndexes` containing body and annotation fragments for geometry.

- [ ] **Step 1: Write the failing annotation tests**

Add these cases to `tests/unit/pdf-paragraphs.test.ts`:

```typescript
it("places a raised annotation after its anchor as translated parenthetical text", () => {
  const paragraphs = groupPdfParagraphs(1, [
    fragment("Term", 20, 700, undefined, 10),
    fragment("1", 46, 706, undefined, 6),
    fragment("continues", 54, 700, undefined, 10),
  ]);

  expect(paragraphs).toHaveLength(1);
  expect(paragraphs[0]?.text).toBe("Term (1) continues");
  expect(paragraphs[0]?.fragmentIndexes).toEqual([0, 1, 2]);
  expect(paragraphs[0]?.bodyFragmentIndexes).toEqual([0, 2]);
});

it("keeps multiple raised annotations in source order after one anchor", () => {
  const paragraphs = groupPdfParagraphs(1, [
    fragment("Term", 20, 700, undefined, 10),
    fragment("1", 46, 706, undefined, 6),
    fragment("a", 52, 706, undefined, 6),
    fragment("continues", 100, 700, undefined, 10),
  ]);

  expect(paragraphs[0]?.text).toBe("Term (1) (a) continues");
  expect(paragraphs[0]?.bodyFragmentIndexes).toEqual([0, 3]);
});

it("keeps a uniformly small footnote as ordinary translatable text", () => {
  const paragraphs = groupPdfParagraphs(1, [
    fragment("1.", 20, 100, undefined, 6),
    fragment("Footnote text", 34, 100, undefined, 6),
  ]);

  expect(paragraphs.map(({ text }) => text)).toEqual(["1. Footnote text"]);
  expect(paragraphs[0]?.bodyFragmentIndexes).toEqual([0, 1]);
});

it("does not attach a distant small fragment as an inline annotation", () => {
  const paragraphs = groupPdfParagraphs(1, [
    fragment("Body", 20, 700, undefined, 10),
    fragment("1", 20, 100, undefined, 6),
  ]);

  expect(paragraphs.map(({ text }) => text)).toEqual(["Body", "1"]);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun run test tests/unit/pdf-paragraphs.test.ts
```

Expected: FAIL because `bodyFragmentIndexes` does not exist and the raised marker currently becomes separate or plain text rather than `Term (1)`.

- [ ] **Step 3: Add annotation association and normalization**

Extend the paragraph type:

```typescript
export type PdfParagraph = Readonly<{
  id: string;
  pageNumber: number;
  text: string;
  fragmentIndexes: readonly number[];
  bodyFragmentIndexes: readonly number[];
}>;

type AnnotationAssociation = Readonly<{
  bodyIndexes: readonly number[];
  annotationsByAnchor: ReadonlyMap<number, readonly number[]>;
}>;
```

Add a focused association helper in `paragraphs.ts`. It must scan outward to the nearest body-sized fragment on each side in PDF reading order, skipping other small annotation candidates, require all three thresholds from Global Constraints, prefer the smallest horizontal gap, and leave the candidate as body when no anchor qualifies:

```typescript
const associateAnnotations = (
  fragments: readonly PdfTextFragment[],
  indexes: readonly number[],
): AnnotationAssociation => {
  const annotationsByAnchor = new Map<number, number[]>();
  const annotationIndexes = new Set<number>();

  for (const [position, candidateIndex] of indexes.entries()) {
    const candidate = requiredAt(fragments, candidateIndex);
    const anchor = nearestBodyNeighbors(fragments, indexes, position, candidate)
      .filter(({ fragment }) => qualifiesAsAnchor(candidate, fragment))
      .sort(
        (left, right) =>
          horizontalGap(candidate, left.fragment) - horizontalGap(candidate, right.fragment),
      )[0];
    if (anchor === undefined) continue;
    const annotations = annotationsByAnchor.get(anchor.index) ?? [];
    annotations.push(candidateIndex);
    annotationsByAnchor.set(anchor.index, annotations);
    annotationIndexes.add(candidateIndex);
  }

  return {
    bodyIndexes: indexes.filter((index) => !annotationIndexes.has(index)),
    annotationsByAnchor,
  };
};
```

Implement `nearestBodyNeighbors` by walking backward and forward until each direction finds the first fragment whose height is greater than `candidate.height / 0.75`; return at most those two candidates. Implement `qualifiesAsAnchor` with `candidate.height <= anchor.height * 0.75`, absolute baseline delta between `anchor.height * 0.2` and `anchor.height * 1.2`, and `horizontalGap <= anchor.height * 1.5`. `horizontalGap` returns zero for horizontally overlapping rectangles.

Run geometric baseline and paragraph grouping only on `bodyIndexes`. When a body paragraph is finalized, expand its all-fragment indexes from its body indexes plus attached annotation indexes. Build normalized text anchor-by-anchor:

```typescript
const text = bodyFragmentIndexes
  .map((index) => {
    const body = requiredAt(fragments, index).text.trim();
    const annotations = annotationsByAnchor.get(index) ?? [];
    return `${body}${annotations
      .map((annotationIndex) => ` (${requiredAt(fragments, annotationIndex).text.trim()})`)
      .join("")}`;
  })
  .filter(Boolean)
  .join(" ")
  .replace(/\s+/gu, " ")
  .trim();
```

Tagged groups run the same association helper inside their structure block. Untagged indexes run it before `geometricParagraphs`, so an inline marker inherits its anchor's line and paragraph.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
bun run test tests/unit/pdf-paragraphs.test.ts
```

Expected: all PDF paragraph grouping tests pass.

- [ ] **Step 5: Run TypeScript and Biome checks for the changed unit**

Run:

```bash
bunx tsc --noEmit
bunx biome check src/pdf/paragraphs.ts tests/unit/pdf-paragraphs.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the paragraph behavior**

```bash
git add src/pdf/paragraphs.ts tests/unit/pdf-paragraphs.test.ts
git commit -m "Normalize PDF inline annotations"
```

---

### Task 2: Size the overlay from PDF body geometry

**Files:**
- Modify: `src/pdf/paragraph-interaction.ts:3-9`
- Modify: `src/pdf/pdfjs-viewer.ts:107-138`
- Modify: `src/pdf/overlay.ts:4-40`
- Create: `tests/dom/pdf-overlay.test.ts`
- Create: `tests/fixtures/pdf-overlay-layout.html`
- Modify: `DESIGN.md` under `PDF Viewer and Translation Overlay`

**Interfaces:**
- Consumes: `PdfParagraph.bodyFragmentIndexes` from Task 1.
- Produces: `PdfParagraphTarget.bodySpans: readonly HTMLElement[]`.
- Preserves: `PdfParagraphTarget.spans` as all source spans for bounds and hover mapping.

- [ ] **Step 1: Write the failing overlay DOM test**

Create `tests/dom/pdf-overlay.test.ts` with a happy-dom window, two source spans, deterministic client rectangles, and a translated result:

```typescript
import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";
import type { TranslationResult } from "../../src/content/ai-engine";
import { createPdfOverlay } from "../../src/pdf/overlay";
import type { PdfParagraphTarget } from "../../src/pdf/paragraph-interaction";

const testWindow = new Window({ width: 800, height: 600 });
Object.defineProperties(globalThis, {
  document: { configurable: true, value: testWindow.document },
  window: { configurable: true, value: testWindow },
});

const translated: TranslationResult = {
  kind: "translated",
  text: "번역된 문단 (1)",
  sourceLanguage: "en",
  targetLanguage: "ko",
  provenance: "lang",
};

describe("PDF translation overlay", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("uses the source width and body font size without a source minimum height", () => {
    const body = document.createElement("span");
    body.textContent = "Term";
    body.style.fontSize = "12px";
    const annotation = document.createElement("span");
    annotation.textContent = "1";
    annotation.style.fontSize = "6px";
    Object.defineProperty(body, "getClientRects", {
      value: () => [{ left: 100, top: 80, right: 280, bottom: 100 }],
    });
    Object.defineProperty(annotation, "getClientRects", {
      value: () => [{ left: 270, top: 76, right: 280, bottom: 84 }],
    });
    document.body.append(body, annotation);
    const target: PdfParagraphTarget = {
      id: "one",
      text: "Term (1)",
      pageNumber: 1,
      spans: [body, annotation],
      bodySpans: [body],
    };

    createPdfOverlay(document).showResult(target, translated);

    const overlay = document.querySelector<HTMLElement>(".lt-pdf-translation-overlay");
    expect(overlay?.style.inlineSize).toBe("180px");
    expect(overlay?.style.minBlockSize).toBe("");
    expect(overlay?.style.fontSize).toBe("12px");
    expect(overlay?.textContent).toBe("번역된 문단 (1)");
    expect(overlay?.lang).toBe("ko");
    expect(overlay?.dir).toBe("ltr");
  });
});
```

- [ ] **Step 2: Run the overlay test and verify RED**

Run:

```bash
bun run test tests/dom/pdf-overlay.test.ts
```

Expected: FAIL because `bodySpans` is absent, the width is forced to 240px, `minBlockSize` is set, and the overlay font remains `1rem`.

- [ ] **Step 3: Propagate body spans**

Add `bodySpans` to `PdfParagraphTarget`:

```typescript
export type PdfParagraphTarget = Readonly<{
  id: string;
  text: string;
  pageNumber: number;
  spans: readonly HTMLElement[];
  bodySpans: readonly HTMLElement[];
}>;
```

In `pdfjs-viewer.ts`, keep mapping `fragmentIndexes` into `spans` and additionally map `bodyFragmentIndexes` into `bodySpans` using the same checked lookup. Update the target helper in `tests/dom/pdf-interaction.test.ts` to set `bodySpans: spans` because those interaction fixtures contain no annotations.

- [ ] **Step 4: Implement source width and weighted font size**

In `overlay.ts`, replace the old width and minimum-height assignments:

```typescript
const width = Math.min(right - left, window.innerWidth - margin * 2);
const x = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
overlay.style.inlineSize = `${width}px`;
overlay.style.insetInlineStart = `${x}px`;
overlay.style.fontSize = representativeFontSize(document, target.bodySpans) ?? "1rem";
```

Do not set `minBlockSize`. Add a local `representativeFontSize` helper that parses finite positive computed pixel sizes, weights each size by the trimmed span text length with a minimum weight of one, sorts ascending, and returns the first size whose cumulative weight reaches half the total:

```typescript
const representativeFontSize = (
  document: Document,
  spans: readonly HTMLElement[],
): string | undefined => {
  const view = document.defaultView;
  if (view === null) return undefined;
  const values = spans
    .map((span) => ({
      size: Number.parseFloat(view.getComputedStyle(span).fontSize),
      weight: Math.max(span.textContent?.trim().length ?? 0, 1),
    }))
    .filter(({ size }) => Number.isFinite(size) && size > 0)
    .sort((left, right) => left.size - right.size);
  const midpoint = values.reduce((sum, { weight }) => sum + weight, 0) / 2;
  let cumulative = 0;
  for (const value of values) {
    cumulative += value.weight;
    if (cumulative >= midpoint) return `${value.size}px`;
  }
  return undefined;
};
```

Keep `spans` for rectangle measurement and hover mapping, so the visible marker area remains part of the source target.

- [ ] **Step 5: Update the design-system contract**

In `DESIGN.md`, replace the PDF overlay's fixed plain-text description with these explicit rules:

```markdown
- **Source geometry**: the overlay follows the detected paragraph's rendered width, clamped only by the viewer margin, and grows vertically with translated content up to the viewport safety cap.
- **Source scale**: translated text uses the character-weighted median font size of body spans; inline superscript and footnote markers do not shrink the translation.
- **Annotation normalization**: attached superscripts and footnote markers appear as translated parenthetical text after their anchor word.
```

- [ ] **Step 6: Add the visual-QA PDF source**

Create `tests/fixtures/pdf-overlay-layout.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>PDF overlay layout fixture</title>
    <style>
      body {
        width: 560px;
        margin: 48px;
        font: 18px/1.5 Georgia, serif;
      }
      h1 {
        font-size: 30px;
      }
      sup {
        font-size: 60%;
      }
      .footnote {
        margin-block-start: 180px;
        font-size: 11px;
      }
    </style>
  </head>
  <body>
    <h1>Source-sized translation</h1>
    <p>Term<sup>1</sup> continues across a paragraph with enough text to wrap naturally.</p>
    <p class="footnote">1. Footnote text remains a separate translatable paragraph.</p>
  </body>
</html>
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
bun run test tests/dom/pdf-overlay.test.ts tests/dom/pdf-interaction.test.ts tests/unit/pdf-paragraphs.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 8: Run TypeScript and Biome checks for the changed surface**

Run:

```bash
bunx tsc --noEmit
bunx biome check src/pdf/paragraph-interaction.ts src/pdf/pdfjs-viewer.ts src/pdf/overlay.ts tests/dom/pdf-overlay.test.ts tests/dom/pdf-interaction.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit the overlay behavior**

```bash
git add DESIGN.md src/pdf/paragraph-interaction.ts src/pdf/pdfjs-viewer.ts src/pdf/overlay.ts tests/dom/pdf-overlay.test.ts tests/dom/pdf-interaction.test.ts tests/fixtures/pdf-overlay-layout.html
git commit -m "Match PDF overlay to source text"
```

---

### Task 3: Verify the shipped behavior and close issue #1

**Files:**
- Verify only; update GitHub issue #1 after all gates pass.

**Interfaces:**
- Consumes: normalized paragraph targets and source-sized overlay from Tasks 1 and 2.
- Produces: validated build evidence recorded on GitHub issue #1.

- [ ] **Step 1: Run the complete automated gate**

Run exactly:

```bash
issue_evidence_dir=/tmp/lingolens-issue-1-evidence
mkdir -p "$issue_evidence_dir"
set -o pipefail
bun run check 2>&1 | tee "$issue_evidence_dir/check.log"
bun run test 2>&1 | tee "$issue_evidence_dir/test.log"
bun run build 2>&1 | tee "$issue_evidence_dir/build.log"
```

Expected: all commands exit 0 and Vitest reports every test passing.

- [ ] **Step 2: Inspect the built extension contract**

Run:

```bash
jq -e '.version == "0.2.0" and .background.service_worker == "background.js"' dist/manifest.json
test -f dist/pdf-viewer.html
test -f dist/pdf-viewer.js
test -f dist/styles/pdf.css
```

Expected: every command exits 0.

- [ ] **Step 3: Manually verify a real text PDF in Chrome**

Generate the exact QA PDF:

```bash
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --headless=new \
  --disable-gpu \
  --no-pdf-header-footer \
  --print-to-pdf=/tmp/lingolens-pdf-overlay-layout.pdf \
  "file://$PWD/tests/fixtures/pdf-overlay-layout.html"
```

Load the repository `dist` directory as an unpacked extension, open `/tmp/lingolens-pdf-overlay-layout.pdf`, then verify:

1. Hovering the body shows one translated paragraph request/result.
2. The marker appears in translated parentheses after its anchor word.
3. The standalone footnote translates as its own paragraph.
4. The overlay width tracks the source paragraph or column at 100% and 150% zoom.
5. The overlay font follows body or heading scale and is not reduced by the marker.
6. The overlay height follows the translated text without the old source minimum height.
7. Escape, pointer leave, rotation, RTL metadata, and page navigation retain existing behavior.

Record the PDF name, Chrome version, zoom levels, and pass/fail observations in the issue comment. If Chrome internal-page automation is blocked, perform this step through the visible user Chrome UI; do not replace it with a source inspection claim.

- [ ] **Step 4: Confirm the final Git state**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: only the intended plan/design and implementation commits are ahead of `origin/main`, with no uncommitted files.

- [ ] **Step 5: Push the completed commits**

```bash
git push origin main
```

Expected: the push exits 0 without force.

- [ ] **Step 6: Record evidence and close issue #1**

Post a comment containing the final commit SHA, exact automated test counts, build result, and manual QA observations, then close only after the comment succeeds:

```bash
final_commit=$(git rev-parse HEAD)
test_result=$(rg 'Tests\s+[0-9]+ passed' /tmp/lingolens-issue-1-evidence/test.log | tail -1 | xargs)
gh issue comment 1 --repo WizMasia/lingolens --body "Implemented and verified in $final_commit. Automated tests: $test_result. Static checks and production build passed. Manual Chrome QA passed with tests/fixtures/pdf-overlay-layout.html printed to PDF at 100% and 150% zoom: parenthetical marker translation, standalone footnote translation, source width, body font scale, content height, Escape, pointer leave, rotation, RTL metadata, and page navigation were verified."
gh issue close 1 --repo WizMasia/lingolens --reason completed
```
