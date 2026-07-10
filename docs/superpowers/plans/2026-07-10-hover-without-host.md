# Structure-Preserving Hover Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hover translation replace only the source element's text temporarily, insert no visual sibling elements, and make hover the default display mode.

**Architecture:** Simplify `hover-view.ts` to maintain per-record source snapshots, pointer/focus listeners, and temporary language attributes without creating an action host or Shadow DOM. Errors remain available through the existing persistent live announcer and retranslation remains available with the configured trigger key. `parseSettings` changes only its fallback default to `hover`, preserving any saved explicit display mode.

**Tech Stack:** TypeScript 5.x, native DOM events, happy-dom/Vitest, Bun, esbuild, Chrome Manifest V3.

## Global Constraints

- Hover rendering must not append, insert, or otherwise create a visible DOM element beside the source.
- Pointer leave, focus loss, Escape, record stale/remove/clear, and destroy must restore exact original text and source `lang`/`dir` values.
- Hover errors must not create a page-visible helper surface; use the persistent extension announcer instead.
- Explicitly saved `inline` and `hover` values remain valid; only missing or malformed settings default to `hover`.
- Retranslation is still opened by the configured trigger key on an already translated source.

---

### Task 1: Remove hover action-host rendering

**Files:**

- Modify: `tests/dom/views.test.ts`
- Modify: `tests/dom/hover-retranslation-view.test.ts`
- Modify: `src/content/hover-view.ts`

**Interfaces:**

- Consumes: `createHoverView()` and `ElementRecord` lifecycle notifications.
- Produces: a hover `TranslationView` that mutates only source text/attributes temporarily and never adds `[data-local-translator-ui="hover"]`.

- [x] **Step 1: Write failing DOM tests**

Add assertions that hover translation adds no sibling or `data-local-translator-ui="hover"` host, replaces text on pointer/focus, restores on leave/blur/Escape, and reports errors without injecting a visible helper surface.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `bun test tests/dom/views.test.ts tests/dom/hover-retranslation-view.test.ts`

Expected: FAIL because the current hover renderer appends its action host.

- [x] **Step 3: Implement source-only hover rendering**

Remove hover action-surface creation, insertion, listeners, and controls. Retain only source listeners, temporary text/`lang`/`dir` ownership, and lifecycle cleanup; never add a tab stop. Route errors to no inserted UI.

- [x] **Step 4: Run focused behavior tests**

Run: `bun test tests/dom/views.test.ts tests/dom/hover-retranslation-view.test.ts tests/dom/records.test.ts`

Expected: PASS with existing restoration and stale-content invariants preserved.

### Task 2: Make hover the fallback display mode

**Files:**

- Modify: `tests/unit/settings.test.ts`
- Modify: `src/shared/settings.ts`

**Interfaces:**

- Consumes: `parseSettings(value, uiLanguage)`.
- Produces: `Settings` that use `displayMode: "hover"` when no valid persisted display mode exists.

- [x] **Step 1: Write a failing settings test**

Change the default-settings expectation to `displayMode: "hover"` and add an explicit persisted `inline` case.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `bun test tests/unit/settings.test.ts`

Expected: FAIL because fallback settings currently use `inline`.

- [x] **Step 3: Change the parser fallback**

Update the missing/malformed display-mode defaults in `parseSettings` to `hover` without changing parsing of explicit `inline` or `hover` values.

- [x] **Step 4: Run focused behavior tests**

Run: `bun test tests/unit/settings.test.ts tests/dom/options.test.ts`

Expected: PASS with user-selected modes still saved and rendered.

### Task 3: Build and Chrome acceptance check

- [x] **Step 1: Run complete verification**

Run: `bun test && bunx tsc --noEmit && bunx biome check . && bun run build && git diff --check`

Expected: all checks pass and `dist/` is rebuilt.

- [ ] **Step 2: Drive the unpacked extension in Chrome**

Reload `dist/` in Developer Mode, translate a fixture paragraph, hover and leave it, then confirm no added hover host exists, page structure remains unchanged, source restores exactly, and a saved inline setting still renders an inline card.
