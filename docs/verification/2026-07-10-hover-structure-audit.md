# Hover Structure Runtime Audit

## Hypothesis 1: Hover translation adds a page-visible sibling

**Risk:** A helper host changes the surrounding page flow or inherits incompatible host styles.

**Evidence:** `tests/dom/views.test.ts` renders a successful hover translation and asserts that the source has no next sibling and no `[data-local-translator-ui="hover"]` node. The rendered source text changes only while active.

**Result:** The hover renderer owns no host, Shadow DOM, sibling, or tab stop.

## Hypothesis 2: A translation that resolves under the pointer is not shown

**Risk:** The pointer is already over the source when asynchronous translation completes, so no new `pointerenter` event occurs.

**Evidence:** `tests/dom/views.test.ts` simulates a source matching `:hover` at render time and confirms the translated text is applied immediately with no sibling element.

**Result:** Mount checks current pointer and focus state before returning.

## Hypothesis 3: Escape can be configured as the translation trigger

**Risk:** A persisted, differently cased `escape` trigger conflicts with hover restoration.

**Evidence:** `tests/unit/settings.test.ts` verifies both `Escape` and `escape` saved values normalize to the default `Control` trigger; `matchesTrigger` uses the same case normalization.

**Result:** Escape, Tab, and Enter remain reserved regardless of stored key casing.
