# Trigger Toggle and Floating Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the configured trigger toggle a target translation and use Alt plus that trigger to open a fixed-position language menu that does not alter page flow.

**Architecture:** Split trigger classification in the content entry point: the configured trigger invokes `translateTarget`, while its Alt-modified form invokes `openElementMenu`. The controller removes a successful record on a repeated primary trigger. The existing element menu becomes a body-level Shadow DOM overlay positioned from the anchor's viewport rectangle, rather than a sibling after that anchor.

**Tech Stack:** TypeScript 5.x, native DOM events, happy-dom/Vitest, Bun, Chrome Manifest V3.

## Global Constraints

- Primary configured trigger: translate an un-translated target; restore a successfully translated target.
- Alt plus the configured trigger: open per-element language selection only; it must not translate or restore directly.
- Alt is reserved for the menu action; saved primary triggers containing Alt fall back to Control.
- A floating menu must append only to `document.body`, use `position: fixed`, and never be inserted beside a source element.
- Escape and outside pointer interaction close the menu without mutating the target translation.
- Existing inline action buttons continue to open the same floating menu.

---

### Task 1: Separate primary and Alt-modified trigger actions

**Files:**

- Modify: `src/shared/settings.ts`
- Modify: `src/content/index.ts`
- Modify: `tests/unit/settings.test.ts`
- Modify: `tests/dom/content-entry.test.ts`

**Interfaces:**

- Produces: `matchesMenuTrigger(event, trigger): boolean` for Alt plus the configured trigger.
- Consumes: existing `matchesTrigger(event, trigger)` for the primary trigger.

- [x] **Step 1: Write failing trigger-classification tests**

Add tests showing that an Alt-modified default Control key does not match `matchesTrigger` but does match `matchesMenuTrigger`.

```ts
expect(matchesTrigger(event({ key: "Control", ctrlKey: true, altKey: true }), trigger)).toBe(false);
expect(matchesMenuTrigger(event({ key: "Control", ctrlKey: true, altKey: true }), trigger)).toBe(true);
```

- [x] **Step 2: Run the focused unit test**

Run: `bun test tests/unit/settings.test.ts`

Expected: FAIL because `matchesMenuTrigger` does not exist.

- [x] **Step 3: Implement normalized Alt-trigger matching**

Add a typed helper that compares the configured key and its non-Alt modifiers using the existing normalized-key logic, and requires `event.altKey === true`. Keep Escape, Tab, and Enter reserved.

- [x] **Step 4: Route content events by action**

In `createContentApp`, check the menu trigger before the primary trigger. Menu trigger calls `void controller.openElementMenu(currentTarget)`; primary trigger calls `void controller.translateTarget()`.

- [x] **Step 5: Verify entry behavior tests**

Run: `bun test tests/unit/settings.test.ts tests/dom/content-entry.test.ts`

Expected: PASS; primary trigger routes only to translation and Alt trigger routes only to menu opening.

### Task 2: Toggle successful translations in the controller

**Files:**

- Modify: `src/content/controller.ts`
- Modify: `tests/dom/targeted-translation.test.ts`

**Interfaces:**

- Consumes: `ElementRecord.lastSuccess` and `restoreElement(source)`.
- Produces: repeated `translateTarget(source)` that removes an existing successful record without invoking `ElementMenu.open`.

- [x] **Step 1: Write a failing controller test**

Create a successful translation, invoke `translateTarget(source)` a second time, and assert that the record is no longer active, inline UI is gone, and a supplied menu fake was not opened.

```ts
await controller.translateTarget(source);
await controller.translateTarget(source);
expect(controller.store.active).toHaveLength(0);
expect(opened).toBe(0);
```

- [x] **Step 2: Run the focused controller test**

Run: `bun test tests/dom/targeted-translation.test.ts`

Expected: FAIL because the second call currently opens the menu.

- [x] **Step 3: Restore on repeated primary action**

Change the successful-record branch in `translateTarget` to call `restoreElement(target)` and return. Preserve `record.phase === "error"` behavior so the explicit Alt-trigger menu can still recover from automatic source detection failure.

- [x] **Step 4: Verify focused controller tests**

Run: `bun test tests/dom/targeted-translation.test.ts tests/dom/unknown-source-action.test.ts`

Expected: PASS; success toggles off and unknown-source recovery remains available through the menu route.

### Task 3: Render the language menu as a fixed overlay

**Files:**

- Modify: `src/content/element-menu.ts`
- Modify: `tests/dom/retranslation.test.ts`

**Interfaces:**

- Consumes: `open(anchor, selection)` and `anchor.getBoundingClientRect()`.
- Produces: one `[data-local-translator-ui="element-menu"]` host appended to `document.body` with a fixed-position Shadow DOM surface.

- [x] **Step 1: Write failing menu placement and dismissal tests**

Assert that opening a menu appends it to `document.body`, leaves `anchor.nextElementSibling` unchanged, applies fixed positioning, and closes when a pointer event occurs outside the Shadow host.

```ts
const result = menu.open(source, { source: "auto", target: "ko" });
expect(document.body.lastElementChild?.dataset.localTranslatorUi).toBe("element-menu");
expect(source.nextElementSibling).toBeNull();
```

- [x] **Step 2: Run the focused menu tests**

Run: `bun test tests/dom/retranslation.test.ts`

Expected: FAIL because the menu is currently inserted with `anchor.after(host)`.

- [x] **Step 3: Implement fixed overlay placement**

Append the host to `document.body`; set inline `position: fixed`, logical viewport coordinates from the anchor rectangle, and a z-index token. Add a document-capture pointer listener that ignores interactions inside the host and closes on outside interaction. Remove all menu listeners during `finish`.

- [x] **Step 4: Verify focused menu tests**

Run: `bun test tests/dom/retranslation.test.ts tests/dom/unknown-source-action.test.ts`

Expected: PASS; menu controls still support translate, restore, Escape, and cleanup.

### Task 4: Build and verify the unpacked extension

- [x] **Step 1: Run complete automated verification**

Run: `bun test && bunx tsc --noEmit && bunx biome check src/shared/settings.ts src/content/index.ts src/content/controller.ts src/content/element-menu.ts tests/unit/settings.test.ts tests/dom/content-entry.test.ts tests/dom/targeted-translation.test.ts tests/dom/retranslation.test.ts && bun run build && git diff --check`

Expected: all checks pass.

- [x] **Step 2: Drive Chrome acceptance**

Reload the unpacked `dist` extension, use Ctrl to translate and restore the English fixture paragraph, use Alt+Ctrl to open language selection, and confirm the source has no sibling menu while the menu appears as a viewport overlay.
