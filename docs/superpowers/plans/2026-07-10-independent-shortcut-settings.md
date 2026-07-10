# Independent Shortcut Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure translation-toggle and element-menu shortcuts independently, defaulting to Ctrl and Ctrl+Shift with order-independent modifier chords.

**Architecture:** Extend `Settings` with `menuTrigger` and parse legacy storage by preserving `trigger` while supplying a collision-free default. Match modifier-only chords as sets of active modifiers. The content app defers modifier-only actions until key release so a larger configured chord can replace a pending prefix action. The options page owns two independent capture controls and refuses identical bindings.

**Tech Stack:** TypeScript, native KeyboardEvent handling, happy-dom/Vitest, Bun, Chrome MV3.

## Global Constraints

- Existing stored `trigger` remains the translation trigger.
- Missing `menuTrigger` defaults to Ctrl+Shift.
- Translation and menu triggers must be distinct.
- Modifier-only chord matching must not depend on key press order.
- Editable fields remain excluded from extension shortcuts.

### Task 1: Settings schema and matching

- [x] Add failing settings tests for `menuTrigger` defaults, legacy migration, collision repair, and order-independent Ctrl+Shift matching.
- [x] Run `bun test tests/unit/settings.test.ts` and confirm red.
- [x] Add `menuTrigger` to `Settings`, parse both bindings, and implement modifier-set matching.
- [x] Run the focused settings tests and confirm green.

### Task 2: Independent options controls

- [x] Add failing options tests for loading, capturing, saving two bindings, and rejecting identical shortcuts.
- [x] Add separate translation/menu capture buttons, outputs, and warnings to the options HTML and app.
- [x] Defer modifier-only capture finalization until keyup so Ctrl+Shift can be captured in either order.
- [x] Run `bun test tests/dom/options.test.ts` and confirm green.

### Task 3: Content shortcut state machine

- [x] Add failing content-entry tests for Ctrl firing on release, Ctrl+Shift opening only the menu in both press orders, and editable exclusion.
- [x] Implement pending modifier-only action arbitration and independent menu matching.
- [x] Run `bun test tests/dom/content-entry.test.ts` and confirm green.

### Task 4: Verification

- [x] Run the full test suite, TypeScript, scoped Biome, build, and diff check.
- [ ] Reload the unpacked extension and verify both defaults plus independent options persistence in Chrome.
