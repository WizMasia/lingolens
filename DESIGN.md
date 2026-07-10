# Local Page Translator Design System

## 0. Research Log

- Embedded references: shortlisted Notion, Mintlify, and Claude for readable warm surfaces. Picked `taste-skill` plus Notion because its paper-like neutrals, whisper borders, and content-first hierarchy fit an extension that should recede behind the reading task.
- Direction: `DESIGN_VARIANCE 3`, `MOTION_INTENSITY 2`, `VISUAL_DENSITY 6`. This is compact, accessibility-critical operational UI, so predictable placement and information density take priority over expressive composition.
- Lazyweb: skipped because marketing and full-product screen research is not representative of a 340px extension popup, an options form, or controls injected into arbitrary host pages. No product screen exists in Task 1 to inspect without inventing unrelated layout evidence.
- Imagen drafts: skipped because a raster concept would over-specify a configuration-only task and cannot meaningfully represent host-page Shadow DOM integration. Primitive rendering begins with the later UI implementation tasks.
- React tooling: skipped because the approved implementation is vanilla TypeScript and native Web Components, not React.
- Palette and type lookup: skipped because the approved brief supplies the exact palette and system font roles. Additional lookup would reopen locked decisions rather than validate an open one.

## 1. Atmosphere & Identity

The extension feels like a calm reading margin: local, quiet, and trustworthy. Warm paper supports long-form reading while ink and moss keep controls legible without looking like browser chrome. The signature is a translated passage set in system serif beside compact system-sans controls, separated by a whisper border rather than a floating card. The interface stays light-themed so extension-owned surfaces remain predictable when isolated from arbitrary host pages.

## 2. Color

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Text and structure | `--lt-color-ink` | `#17201b` | Primary text, icons, headings |
| Owned surface | `--lt-color-paper` | `#f7f4ec` | Popup, options, inline translation background |
| Primary action | `--lt-color-moss` | `#2f6d4f` | Primary controls, links, focus ring |
| Warning | `--lt-color-amber` | `#b66a22` | Model preparation and recoverable warnings |
| Error | `--lt-color-danger` | `#a33a32` | Failure text and destructive actions |
| Border | `--lt-color-border` | `rgb(23 32 27 / 12%)` | Whisper separation on owned surfaces |

Accent color carries meaning and is never decorative. Moss identifies an action or focus, amber identifies a recoverable delay, and danger identifies a failure or destructive action. Extension-owned surfaces always pair ink with paper for body copy. Host-page colors never replace owned-surface tokens.

## 3. Typography

| Role | Token | Value | Weight | Line height | Usage |
| --- | --- | --- | --- | --- | --- |
| Caption | `--lt-font-size-caption` | `0.75rem` | 500 | `--lt-line-height-control` | Status and helper text |
| Control body | `--lt-font-size-body` | `0.875rem` | 400-600 | `--lt-line-height-control` | Labels, buttons, fields |
| Surface title | `--lt-font-size-title` | `1.125rem` | 600 | `--lt-line-height-control` | Popup and options headings |
| Translation | `--lt-font-size-body` | `0.875rem` minimum | 400 | `--lt-line-height-reading` | Translated reading copy |

- Controls use `--lt-font-control`: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Translations use `--lt-font-translation`: `ui-serif, Georgia, Cambria, "Times New Roman", serif`.
- Control text uses `--lt-line-height-control`: `1.4`.
- Translation copy uses `--lt-line-height-reading`: `1.6`.
- The serif role is justified by the reading task and is never used for controls.
- Controls inherit user zoom and browser text scaling. No essential text is smaller than the caption token.

## 4. Spacing & Layout

| Token | Value | Usage |
| --- | --- | --- |
| `--lt-space-1` | `4px` | Icon and label separation |
| `--lt-space-2` | `8px` | Tight control groups |
| `--lt-space-3` | `12px` | Field and row padding |
| `--lt-space-4` | `16px` | Surface padding and section gaps |
| `--lt-space-6` | `24px` | Major options sections |
| `--lt-target-min` | `44px` | Minimum interactive width and height |
| `--lt-popup-width` | `340px` | Fixed popup width |
| `--lt-options-max-width` | `720px` | Centered options content limit |

All margins, padding, and gaps use the spacing tokens. The popup is a single compact column. The options page is a single reading column capped at 720px, with related controls grouped by spacing rather than cards. Inline controls wrap when host-page width is constrained. Right-to-left documents preserve logical reading order with logical CSS properties and `dir` inherited from the translated language where known.

## 5. Components

### Surface

- **Structure**: title, optional description, content region, status region, actions.
- **Variants**: popup at `--lt-popup-width`; options at `--lt-options-max-width`; injected surface inside Shadow DOM.
- **Spacing**: `--lt-space-3`, `--lt-space-4`, and `--lt-space-6`.
- **States**: default paper background, busy with polite status, error with danger text, disabled controls retaining readable labels.
- **Accessibility**: semantic headings, source-order tab flow, no color-only status, 44px targets.

### Action Control

- **Structure**: native button or link with text label and optional library icon.
- **Variants**: moss primary, ink secondary, danger destructive, text-only contextual action.
- **States**: hover changes opacity; active uses a subtle transform; focus uses `--lt-focus-ring`; disabled keeps ink at readable opacity; loading preserves width and announces progress separately.
- **Accessibility**: visible name, native semantics, 44px minimum target, no emoji or hand-drawn icon.
- **Motion**: only opacity and transform use `--lt-motion-duration` and `--lt-motion-easing`.

### Inline Translation Block

- **Structure**: translated text, source and target language summary, status slot, contextual action row.
- **Variants**: ready, preparing, translating, recoverable error, unavailable.
- **Spacing**: text uses `--lt-space-3`; actions use `--lt-space-2`; outer separation uses `--lt-space-2`.
- **States**: loading retains original content; error retains the last successful translation; disabled actions explain the unavailable capability.
- **Accessibility**: translation copy uses serif with 1.6 line height; status updates use `aria-live="polite"`; errors are textual; the original page text remains available.
- **Isolation**: styles live inside an extension-owned Shadow Root and consume the same `--lt-*` contract.

### Hover Action

- **Structure**: one compact action surface anchored to the focused or hovered target, containing language summary and translate or retranslate action.
- **Variants**: translate, retranslate, restore, unavailable.
- **States**: pointer hover and keyboard focus reveal the same actions; Escape dismisses; focus does not disappear while moving into the action surface; loading and errors are announced politely.
- **Accessibility**: keyboard reachability does not depend on hover, target is at least 44px, and placement never changes DOM reading order.
- **Motion**: appearance uses opacity only. Reduced-motion duration is zero.

### Field Group

- **Structure**: visible label, native input or select, optional helper text, inline error.
- **States**: default, hover, focus, disabled, loading, error.
- **Accessibility**: placeholders never replace labels; helper and error IDs connect with `aria-describedby`; invalid fields use `aria-invalid`.

### Live Status

- **Structure**: concise text inside a persistent status region.
- **Variants**: neutral, warning, error, completion.
- **States**: updates are polite and do not steal focus; repeated progress is throttled to meaningful changes.
- **Accessibility**: `role="status"` or `aria-live="polite"`; urgent alerts are reserved for failures that require immediate action.

## 6. Motion & Interaction

| Token | Value | Usage |
| --- | --- | --- |
| `--lt-motion-duration` | `140ms` | Hover, press, and appearance feedback |
| `--lt-motion-easing` | `ease-out` | Fast, calm state confirmation |

Opacity, transform, control-color, and progress-size transitions provide state feedback. No control moves merely for decoration. Hover clarifies interactivity, active transform confirms a press, and progress width communicates work. Under `prefers-reduced-motion: reduce`, `--lt-motion-duration` becomes `0ms`. Keyboard and pointer users receive equivalent state feedback.

## 7. Depth & Surface

Extension-owned surfaces use paper with `--lt-border`, defined as `1px solid var(--lt-color-border)`, and `--lt-radius` at `10px`. The popup/options shell uses a subtle paper gradient and low-contrast shadows to separate primary actions and live status from Chrome's surrounding UI; injected page surfaces remain border-led and avoid decorative nesting. Spacing groups related content, and borders separate functionally distinct regions.

| Token | Value | Usage |
| --- | --- | --- |
| `--lt-radius` | `10px` | Owned surfaces and controls |
| `--lt-border` | `1px solid var(--lt-color-border)` | Surface boundary and functional divider |
| `--lt-focus-ring` | `0 0 0 2px var(--lt-color-moss)` | Visible keyboard focus |

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA. Text inside extension-owned surfaces maintains at least 4.5:1 contrast, and non-text controls maintain at least 3:1 contrast.
- Every interactive target is at least 44px in both dimensions and has a visible 2px moss focus ring.
- Popup, options, injected inline blocks, and hover actions are fully keyboard reachable. Hover never exposes an action that focus cannot expose.
- Progress and completion use polite live regions. Errors remain visible until resolved or dismissed.
- Reduced motion removes transitions. User zoom, text scaling, high contrast settings, and logical RTL layout remain usable.
- Shadow DOM isolates extension-owned styles from host pages. Owned controls use semantic HTML and do not alter the host document's reading order.
- Translated content sets language and direction when known. Mixed-language metadata remains in logical source order.

### Inclusive personas

- **Keyboard reader**: must translate, retranslate, restore, and edit settings without pointer input or focus loss.
- **Low-vision reader**: must distinguish text, status, focus, and controls at 200% zoom without horizontal scrolling inside owned surfaces.
- **Motion-sensitive reader**: receives immediate state changes with no transition when reduced motion is enabled.
- **Multilingual RTL reader**: receives correct language metadata and logical direction without mirrored action meaning.
- **Distracted reader**: sees one primary action, stable progress text, and errors next to the action that needs attention.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
| --- | --- | --- | --- |
| Host-page colors may reduce visual harmony around an inline block, but never contrast below 4.5:1 inside extension-owned surfaces. | Injected inline and hover surfaces | Arbitrary host styling cannot be harmonized safely without weakening isolation or predictability. | Keep paper and ink inside Shadow DOM; revisit only with real-page visual QA evidence. |

### Verification handoff

Task 1 defines tokens and anatomy only. Primitive showcase and browser visual QA are intentionally deferred until popup, options, inline, and hover primitives exist. Later UI tasks must exercise default, hover, active, focus, disabled, loading, error, RTL, reduced-motion, 200% zoom, and 375px, 768px, and 1280px contexts before product surfaces are accepted.
