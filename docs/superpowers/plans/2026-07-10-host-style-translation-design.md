# Host-Style Translation Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inline translated text preserve the source element's visual reading style without allowing host-page CSS to style extension controls.

**Architecture:** `inline-view.ts` will read a bounded allowlist of computed source styles and assign those values directly to the translation element inside the closed Shadow Root. The host container will mirror only the source element's layout width and logical block margins. Existing extension-owned surface, status, and action styles remain isolated.

**Tech Stack:** TypeScript 5.x, native Shadow DOM, happy-dom/Vitest, Bun, esbuild.

## Global Constraints

- Copy only the allowlisted typography, text-flow, width, and logical block-margin properties named in `DESIGN.md`; retain extension-owned text color for contrast.
- Do not copy host backgrounds, borders, positioning, transforms, animations, or custom properties; set every extension token consumed by the inline Shadow Root on the host so host-page variables cannot override card or control styling.
- Keep translated text insertion as `textContent`.
- Preserve the current closed Shadow Root, language direction, error, stale, restore, and action behavior.

---

### Task 1: Copy safe source styles to inline translations

**Files:**

- Modify: `tests/dom/views.test.ts`
- Modify: `src/content/inline-view.ts`
- Modify: `DESIGN.md`

**Interfaces:**

- Consumes: `createInlineView(document)` and `ElementRecord`.
- Produces: `inline` translation hosts whose `translation` element receives an explicit bounded set of source computed-style values on each render.

- [x] **Step 1: Write failing DOM tests**

Add a source fixture with inline styles for typography, text flow, width, and logical block margins. Render a completed record, inspect the closed Shadow Root test hook, and assert that the translation element has matching explicit style values. Add an assertion that the extension-owned `.surface` style retains its own paper background rather than the source background.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `bun test tests/dom/views.test.ts`

Expected: FAIL because the translation element has no copied source style values.

- [x] **Step 3: Implement the bounded style copier**

In `src/content/inline-view.ts`, add a private helper that reads `document.defaultView?.getComputedStyle(source)` and copies only the approved properties to the translation element and host. Call it after the inline entry is mounted and whenever a successful translation is rendered. If computed style is unavailable, leave the extension defaults unchanged.

- [x] **Step 4: Run focused tests to verify the behavior**

Run: `bun test tests/dom/views.test.ts tests/dom/records.test.ts`

Expected: PASS, including stale, restore, and safe text rendering tests.

- [x] **Step 5: Run project verification and build**

Run: `bun test && bunx tsc --noEmit && bunx biome check . && bun run build && git diff --check`

Expected: all tests and checks pass; `dist/` contains the rebuilt unpacked extension.

- [ ] **Step 6: Manual Chrome visual QA**

Load/reload `dist/` as the unpacked extension, translate a fixture paragraph, and verify the translated text mirrors the source paragraph's typography and spacing while the compact language action remains extension-styled and readable.
