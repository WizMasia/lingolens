# Local Page Translator MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome 138+ desktop extension that privately translates whole pages or individual elements with Chrome's local Language Detector and Translator APIs, supports inline and hover display, and permits per-element retranslation with explicit languages.

**Architecture:** A Manifest V3 content script owns DOM discovery, local AI calls, translation state, rendering, and restoration. A small background service worker relays tab state; popup and options documents are dependency-light TypeScript surfaces. Shared discriminated unions define settings and runtime messages, and all browser/AI boundaries are injected behind typed interfaces for deterministic tests.

**Tech Stack:** TypeScript 5.x, Bun, esbuild, Vitest with happy-dom, Biome, Chrome Manifest V3, `@types/chrome`, `@types/dom-chromium-ai`, native Web Components/Shadow DOM.

## Global Constraints

- Minimum supported browser is Chrome 138 desktop; mobile and non-Chromium browsers are out of scope.
- Translation must use native `LanguageDetector` and `Translator`; no cloud fallback, API keys, telemetry, or remote code.
- All page text remains on device; never request network-service host permissions.
- Match only `http://*/*` and `https://*/*`; protected pages must fail with an explanatory popup state.
- Default settings are per-element automatic source detection, Chrome UI target language with `ko` fallback, inline display, and modifier-only `Ctrl` trigger.
- Never translate editable controls, code/preformatted content, hidden content, punctuation-only content, or extension-owned UI.
- Never write translation output as HTML. Preserve exact original text and the last successful translation on failure.
- Source files must remain at or below 250 non-blank, non-comment lines; split before crossing that boundary.
- Use strict TypeScript with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and no `any`, type assertions, non-null assertions, or suppression directives.
- Each task follows red-green-refactor and ends with its own atomic commit.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `DESIGN.md` | Visual tokens, component anatomy, states, motion, accessibility, and accepted debt |
| `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `scripts/build.ts` | Reproducible build and quality gates |
| `src/manifest.json` | MV3 permissions, entry points, host matches, Chrome floor |
| `src/shared/settings.ts` | Settings types, defaults, normalization, trigger matching |
| `src/shared/protocol.ts` | Exhaustive runtime message and tab-state contracts |
| `src/shared/languages.ts` | Supported UI language list and BCP-47 normalization |
| `src/content/targets.ts` | Visible meaningful-element discovery and selection/hover targeting |
| `src/content/ai-engine.ts` | Built-in AI availability, language resolution, Translator/result caches |
| `src/content/records.ts` | Element record ownership, original snapshots, state transitions |
| `src/content/inline-view.ts` | Inline translation blocks inside an isolated UI root |
| `src/content/hover-view.ts` | Reversible text-node swaps and hover/focus behavior |
| `src/content/element-menu.ts` | Accessible per-element source/target/retranslate controls |
| `src/content/jobs.ts` | Bounded full-page job queue, cancellation, progress |
| `src/content/controller.ts` | Targeted/full-page orchestration, restore, stale handling |
| `src/content/index.ts` | Content-script event and runtime-message entry point |
| `src/background.ts` | Per-tab state relay and settings broadcasts |
| `src/popup/*` | Current-tab translate/restore/status UI |
| `src/options/*` | Validated language, mode, and trigger settings UI |
| `tests/unit/*`, `tests/dom/*` | Pure and happy-dom behavior tests |
| `tests/fixtures/mixed-language.html` | Manual/integration mixed-language page |
| `README.md` | Install, requirements, privacy, usage, and troubleshooting |

---

### Task 1: Toolchain and Visual Contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `vitest.config.ts`
- Create: `scripts/build.ts`
- Create: `DESIGN.md`
- Create: `src/styles/tokens.css`
- Create: `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: `bun run build`, `bun run check`, `bun test`; CSS custom properties under `--lt-*` used by popup, options, and injected controls.

- [ ] **Step 1: Add a failing toolchain smoke test**

```ts
// tests/unit/smoke.test.ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs TypeScript tests", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Add strict project configuration**

Create `package.json` with scripts `build`, `check`, `test`, and `test:watch`; dependencies `esbuild`; dev dependencies `@biomejs/biome`, `@types/chrome`, `@types/dom-chromium-ai`, `happy-dom`, `typescript`, and `vitest`. Create `tsconfig.json` targeting `ES2022` and `DOM` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, and `verbatimModuleSyntax`. Configure Biome for two-space indentation, double quotes, import organization, and recommended lint rules. Configure Vitest for `happy-dom`, `tests/**/*.test.ts`, and restored mocks.

```ts
// scripts/build.ts
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content/index.ts",
    popup: "src/popup/popup.ts",
    options: "src/options/options.ts",
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome138",
  sourcemap: true,
});
await Promise.all([
  cp("src/manifest.json", "dist/manifest.json"),
  cp("src/popup/popup.html", "dist/popup.html"),
  cp("src/popup/popup.css", "dist/popup.css"),
  cp("src/options/options.html", "dist/options.html"),
  cp("src/options/options.css", "dist/options.css"),
  cp("src/styles", "dist/styles", { recursive: true }),
  cp("src/icons", "dist/icons", { recursive: true }),
]);
```

- [ ] **Step 3: Write the visual contract before UI code**

Create `DESIGN.md` with a calm local-first “reading margin” direction: ink `#17201b`, paper `#f7f4ec`, moss `#2f6d4f`, amber `#b66a22`, danger `#a33a32`; system sans for controls and system serif for translation copy; 4/8/12/16/24 spacing; 10px radii; 1px ink-at-12% borders; 140ms opacity/transform transitions disabled under reduced motion. Specify popup width 340px, options max width 720px, 44px minimum targets, visible 2px focus ring, polite live regions, inline block anatomy, hover action anatomy, loading/error/disabled states, RTL behavior, Shadow DOM isolation, and accepted debt that host-page colors may reduce inline visual harmony but never contrast below 4.5:1 inside extension-owned surfaces. Copy the exact variables into `src/styles/tokens.css`.

- [ ] **Step 4: Install and verify the empty system**

Run: `bun install && bun test && bunx tsc --noEmit && bunx biome check .`

Expected: one passing test, zero TypeScript errors, zero Biome errors.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock tsconfig.json biome.json vitest.config.ts scripts/build.ts DESIGN.md src/styles/tokens.css tests/unit/smoke.test.ts
git commit -m "build: scaffold translator extension"
```

---

### Task 2: Settings, Languages, and Message Contracts

**Files:**
- Create: `src/shared/languages.ts`
- Create: `src/shared/settings.ts`
- Create: `src/shared/protocol.ts`
- Create: `tests/unit/settings.test.ts`
- Create: `tests/unit/protocol.test.ts`

**Interfaces:**
- Produces: `normalizeLanguage(tag: string): string | undefined`, `resolveBrowserTarget(uiLanguage: string): string`, `parseSettings(value: unknown, uiLanguage: string): Settings`, `matchesTrigger(event: KeyboardEvent, trigger: TriggerBinding): boolean`, `parseMessage(value: unknown): RuntimeMessage | undefined`.
- Produces types: `DisplayMode`, `SourcePreference`, `TargetPreference`, `TriggerBinding`, `Settings`, `TabState`, `RuntimeMessage`.

- [ ] **Step 1: Write failing settings tests**

```ts
// tests/unit/settings.test.ts
import { describe, expect, it } from "vitest";
import { matchesTrigger, parseSettings, resolveBrowserTarget } from "../../src/shared/settings";

describe("settings", () => {
  it("falls back from an unusable browser language to Korean", () => {
    expect(resolveBrowserTarget("und")).toBe("ko");
  });

  it("normalizes a regional browser language to its base", () => {
    expect(resolveBrowserTarget("pt-BR")).toBe("pt");
  });

  it("defaults to automatic source, browser target, inline, and Control", () => {
    expect(parseSettings(undefined, "ko-KR")).toEqual({
      displayMode: "inline",
      source: { kind: "auto" },
      target: { kind: "browser", resolvedLanguage: "ko" },
      trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
    });
  });

  it("matches modifier-only Control without firing on repeats", () => {
    const event = new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, repeat: false });
    expect(matchesTrigger(event, parseSettings(undefined, "ko").trigger)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm missing modules**

Run: `bun test tests/unit/settings.test.ts`

Expected: FAIL because `src/shared/settings.ts` does not exist.

- [ ] **Step 3: Implement exact settings and language contracts**

```ts
// src/shared/settings.ts
export type DisplayMode = "inline" | "hover";
export type SourcePreference = { readonly kind: "auto" } | { readonly kind: "fixed"; readonly language: string };
export type TargetPreference =
  | { readonly kind: "browser"; readonly resolvedLanguage: string }
  | { readonly kind: "fixed"; readonly language: string };
export type TriggerBinding = Readonly<{
  key: string;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  shift: boolean;
}>;
export type Settings = Readonly<{
  displayMode: DisplayMode;
  source: SourcePreference;
  target: TargetPreference;
  trigger: TriggerBinding;
}>;
```

Implement structural parsing with `typeof`, `Array.isArray`, and property checks at the storage boundary; invalid fields fall back independently. `normalizeLanguage` uses `Intl.getCanonicalLocales`, returns the lowercase base subtag, and rejects `und` or malformed tags. `matchesTrigger` compares normalized key and all four modifier flags and rejects `event.repeat`.

- [ ] **Step 4: Add and test exhaustive runtime messages**

```ts
// src/shared/protocol.ts
export type TabState = Readonly<{
  phase: "idle" | "downloading" | "translating" | "complete" | "error";
  completed: number;
  total: number;
  skipped: number;
  failed: number;
  message?: string;
}>;

export type RuntimeMessage =
  | { readonly type: "translate-page" }
  | { readonly type: "restore-page" }
  | { readonly type: "get-tab-state" }
  | { readonly type: "settings-changed" }
  | { readonly type: "tab-state"; readonly state: TabState };
```

Test that `parseMessage({ type: "translate-page" })` succeeds, malformed state counts fail, and unknown tags return `undefined`.

- [ ] **Step 5: Run quality gates and commit**

Run: `bun test tests/unit/settings.test.ts tests/unit/protocol.test.ts && bunx tsc --noEmit && bunx biome check src/shared tests/unit`

Expected: all tests pass and checks exit 0.

```bash
git add src/shared tests/unit/settings.test.ts tests/unit/protocol.test.ts
git commit -m "feat: add extension contracts"
```

---

### Task 3: Meaningful DOM Target Discovery

**Files:**
- Create: `src/content/targets.ts`
- Create: `tests/dom/targets.test.ts`

**Interfaces:**
- Consumes: no earlier runtime services.
- Produces: `isEligibleElement(element: Element): element is HTMLElement`, `discoverTargets(root: Document | ShadowRoot): readonly HTMLElement[]`, `targetFromSelection(selection: Selection | null): HTMLElement | undefined`, `nearestTarget(element: Element | null): HTMLElement | undefined`, `collectSourceText(element: HTMLElement): string`.

- [ ] **Step 1: Write failing target tests**

```ts
// tests/dom/targets.test.ts
import { describe, expect, it } from "vitest";
import { discoverTargets, targetFromSelection } from "../../src/content/targets";

describe("target discovery", () => {
  it("keeps meaningful leaves and excludes script, editables, code, and extension UI", () => {
    document.body.innerHTML = `
      <main><p>Hello world from a paragraph.</p><div><span>Nested leaf text</span></div></main>
      <code>const secret = 1</code><input value="Do not translate">
      <div contenteditable="true">Draft</div><div data-local-translator-ui>Own UI</div>
    `;
    expect(discoverTargets(document).map((element) => element.textContent?.trim())).toEqual([
      "Hello world from a paragraph.",
      "Nested leaf text",
    ]);
  });

  it("returns the closest eligible element containing the selection anchor", () => {
    document.body.innerHTML = `<article><p id="target">Selected sentence here.</p></article>`;
    const text = document.querySelector("#target")?.firstChild;
    if (text === null || text === undefined) throw new Error("fixture text missing");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(targetFromSelection(selection)?.id).toBe("target");
  });
});
```

- [ ] **Step 2: Run tests to verify red state**

Run: `bun test tests/dom/targets.test.ts`

Expected: FAIL because the target module is absent.

- [ ] **Step 3: Implement conservative scanning**

Use a `TreeWalker` over elements. Reject disconnected nodes; tags `SCRIPT`, `STYLE`, `NOSCRIPT`, `TEMPLATE`, `CODE`, `PRE`, `TEXTAREA`, `INPUT`, `SELECT`, `OPTION`, `BUTTON`; `[contenteditable]:not([contenteditable="false"])`; `[aria-hidden="true"]`; `[hidden]`; `[data-local-translator-ui]`; zero-sized elements from `getClientRects()`; and text that is empty, punctuation-only, or numeric-only. Prefer the deepest eligible block/leaf and do not return an ancestor when an eligible descendant represents its meaningful text. Traverse open shadow roots recursively. In `tests/dom/targets.test.ts`, stub `HTMLElement.prototype.getClientRects` to return one `DOMRect` in `beforeEach` and restore it in `afterEach`; add a dedicated test that overrides one element with an empty rect list and verifies exclusion. Production code never branches on test-environment detection.

`collectSourceText` joins non-empty descendant text nodes with normalized single spaces without mutating DOM. `targetFromSelection` rejects collapsed selections and maps a text anchor to its parent element before calling `nearestTarget`.

- [ ] **Step 4: Verify edge cases and commit**

Add tests for hidden elements, punctuation, nested eligible descendants, collapsed selection, and an open shadow root.

Run: `bun test tests/dom/targets.test.ts && bunx tsc --noEmit && bunx biome check src/content/targets.ts tests/dom/targets.test.ts`

Expected: all target tests pass and checks exit 0.

```bash
git add src/content/targets.ts tests/dom/targets.test.ts
git commit -m "feat: discover translatable page elements"
```

---

### Task 4: Local AI Translation Engine

**Files:**
- Create: `src/content/ai-engine.ts`
- Create: `tests/unit/ai-engine.test.ts`

**Interfaces:**
- Consumes: `SourcePreference`, language normalization.
- Produces: `AiAdapter`, `TranslationRequest`, `TranslationResult`, `TranslationError`, `createTranslationEngine(adapter: AiAdapter): TranslationEngine` with `translate(request)`, `availability(source, target)`, and `destroy()`.

- [ ] **Step 1: Define fakes in failing behavior tests**

```ts
// tests/unit/ai-engine.test.ts
import { describe, expect, it, vi } from "vitest";
import { createTranslationEngine, type AiAdapter } from "../../src/content/ai-engine";

describe("translation engine", () => {
  it("detects each automatic source and skips target-language text", async () => {
    const adapter: AiAdapter = {
      detect: vi.fn().mockResolvedValue([{ detectedLanguage: "ko", confidence: 0.99 }]),
      availability: vi.fn().mockResolvedValue("available"),
      createTranslator: vi.fn(),
      destroy: vi.fn(),
    };
    const engine = createTranslationEngine(adapter);
    await expect(engine.translate({ text: "안녕하세요", source: { kind: "auto" }, target: "ko" }))
      .resolves.toEqual({ kind: "skipped", sourceLanguage: "ko" });
  });

  it("deduplicates translator creation and identical in-flight text", async () => {
    const translate = vi.fn().mockResolvedValue("안녕하세요");
    const adapter = makeAdapter({ detectedLanguage: "en", translate });
    const engine = createTranslationEngine(adapter);
    const request = { text: "Hello", source: { kind: "auto" } as const, target: "ko" };
    await Promise.all([engine.translate(request), engine.translate(request)]);
    expect(adapter.createTranslator).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
```

The test-local `makeAdapter` returns a typed `AiAdapter` with configurable detected language and translator method; it does not use type assertions.

- [ ] **Step 2: Run tests to verify red state**

Run: `bun test tests/unit/ai-engine.test.ts`

Expected: FAIL because the engine module is absent.

- [ ] **Step 3: Implement detection precedence and caches**

```ts
export type TranslationRequest = Readonly<{
  text: string;
  source: { readonly kind: "auto"; readonly languageHint?: string; readonly context?: string }
    | { readonly kind: "fixed"; readonly language: string };
  target: string;
}>;

export type TranslationResult =
  | { readonly kind: "translated"; readonly text: string; readonly sourceLanguage: string; readonly targetLanguage: string }
  | { readonly kind: "skipped"; readonly sourceLanguage: string }
  | { readonly kind: "unknown-source" };
```

Resolve source in this order: fixed source, valid `languageHint`, detector result. Detect from `context` only when trimmed source text is under 20 Unicode letters. Require confidence `>= 0.6`; otherwise return `unknown-source`. Cache translators by `source→target` and results by `source\0target\0text`, cap result cache at 500 insertion-ordered entries, and share in-flight promises. Convert API absence, unavailable pairs, download rejection, and translation rejection into a typed `TranslationError` with codes `api-unavailable`, `pair-unavailable`, or `translation-failed`.

The production adapter calls `LanguageDetector.availability/create/detect` and `Translator.availability/create/translate`, forwards `downloadprogress`, and destroys created objects on teardown. Do feature detection before reading either global.

- [ ] **Step 4: Cover failures and lifecycle**

Add tests for hint precedence, low confidence, context detection, unsupported pair, cached successful results, failed-result non-caching, 500-entry eviction, and `destroy()` destroying detector/translators once.

Run: `bun test tests/unit/ai-engine.test.ts && bunx tsc --noEmit && bunx biome check src/content/ai-engine.ts tests/unit/ai-engine.test.ts`

Expected: all engine tests pass and checks exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/content/ai-engine.ts tests/unit/ai-engine.test.ts
git commit -m "feat: add local translation engine"
```

---

### Task 5: Element Records and Reversible Display Modes

**Files:**
- Create: `src/content/records.ts`
- Create: `src/content/inline-view.ts`
- Create: `src/content/hover-view.ts`
- Create: `tests/dom/records.test.ts`
- Create: `tests/dom/views.test.ts`

**Interfaces:**
- Produces: `ElementRecord`, `RecordStore` with `getOrCreate`, `active`, `markStale`, `remove`, `clear`; `InlineView` and `HoverView` implementing the exact view contract below.

```ts
export type TranslationView = Readonly<{
  render(record: ElementRecord): void;
  setError(record: ElementRecord, message: string): void;
  restore(record: ElementRecord): void;
  destroy(): void;
}>;
```

- [ ] **Step 1: Write failing record and renderer tests**

```ts
it("updates one inline block instead of duplicating it", () => {
  document.body.innerHTML = `<p id="source">Hello world</p>`;
  const source = document.querySelector<HTMLElement>("#source");
  if (source === null) throw new Error("fixture source missing");
  const store = createRecordStore();
  const record = store.getOrCreate(source);
  record.complete("안녕하세요", "en", "ko");
  const view = createInlineView(document);
  view.render(record);
  record.complete("Bonjour", "en", "fr");
  view.render(record);
  expect(document.querySelectorAll("[data-local-translator-ui]")).toHaveLength(1);
  expect(document.body.textContent).toContain("Bonjour");
});

it("restores exact text nodes after hover replacement", () => {
  document.body.innerHTML = `<p id="source">Hello <em>careful</em> world</p>`;
  // create translated record, dispatch pointerenter then pointerleave
  // assert translated text appears while active and original innerHTML returns exactly
});
```

- [ ] **Step 2: Run tests to verify red state**

Run: `bun test tests/dom/records.test.ts tests/dom/views.test.ts`

Expected: FAIL because records and views are absent.

- [ ] **Step 3: Implement explicit record transitions**

Define record phases `idle | queued | detecting | downloading | translating | translated | stale | error`. Snapshot each descendant text node as `{ node: Text; value: string }` on creation. Record methods enforce valid transitions and retain `lastSuccess` separately from current error. Store active records in a `Set` paired with a `WeakMap<HTMLElement, ElementRecord>`.

Inline view appends one extension-owned host after the source, attaches a closed Shadow DOM, adopts token styles, renders translation with `lang` and computed `dir`, and exposes action slots through callbacks rather than runtime messages.

Hover view registers pointer/focus listeners only after success. On activation it sets the first non-empty snapshotted text node to the full translation and all remaining snapshotted nodes to empty strings; on leave/blur it restores every exact value. It must restore before rerender, stale marking, record removal, or destroy.

- [ ] **Step 4: Add accessibility and failure tests**

Test target `lang`/`dir`, focus activation, immediate restore during destroy, inline error preserving last success, and no translated HTML interpretation using `<img onerror=...>` as returned text.

Run: `bun test tests/dom/records.test.ts tests/dom/views.test.ts && bunx tsc --noEmit && bunx biome check src/content tests/dom`

Expected: all record/view tests pass and checks exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/content/records.ts src/content/inline-view.ts src/content/hover-view.ts tests/dom/records.test.ts tests/dom/views.test.ts
git commit -m "feat: render reversible translations"
```

---

### Task 6: Targeted Translation and Per-Element Retranslation

**Files:**
- Create: `src/content/element-menu.ts`
- Create: `src/content/controller.ts`
- Create: `tests/dom/targeted-translation.test.ts`
- Create: `tests/dom/retranslation.test.ts`

**Interfaces:**
- Consumes: settings, target discovery, engine, store, views.
- Produces: `TranslationController` with `setHovered(element: HTMLElement | undefined): void`, `translateTarget(element: HTMLElement): Promise<void>`, `retranslate(element: HTMLElement, choice: ElementLanguageChoice): Promise<void>`, `openElementMenu(element: HTMLElement): Promise<void>`, `restoreElement(element: HTMLElement): void`, `applySettings(settings: Settings): void`, and `destroy(): void`; `ElementLanguageChoice` and `ElementMenu`.

- [ ] **Step 1: Write failing targeted-translation tests**

Test these exact outcomes with a fake engine: selection beats hover; hover is used when selection is collapsed; no target emits notice `텍스트 요소를 선택하거나 가리켜 주세요.`; same-target result renders nothing; successful translation renders through the configured view.

```ts
it("retranslation replaces the prior result without changing global settings", async () => {
  const harness = createControllerHarness({ displayMode: "inline" });
  await harness.controller.translateTarget(harness.source);
  await harness.controller.retranslate(harness.source, { source: "en", target: "ja" });
  expect(harness.translationBlocks()).toHaveLength(1);
  expect(harness.translationText()).toBe("こんにちは");
  expect(harness.settings().target).toEqual({ kind: "browser", resolvedLanguage: "ko" });
});
```

- [ ] **Step 2: Run tests to verify red state**

Run: `bun test tests/dom/targeted-translation.test.ts tests/dom/retranslation.test.ts`

Expected: FAIL because controller and element menu are absent.

- [ ] **Step 3: Implement controller orchestration**

`translateTarget` collects text, ancestor `lang`, and up to 160 characters of nearest sibling/parent context. It transitions the record, awaits the engine, verifies the element is still connected and its source fingerprint is unchanged, then renders. For an already translated record, the configured trigger opens the menu instead of issuing an identical request.

The element menu is one Shadow DOM popover with two native `<select>` controls, `Translate again`, `Restore original`, and a polite live region. Source choices include Auto plus the language list; target choices exclude Auto. It returns a promise resolving to:

```ts
export type ElementMenuResult =
  | { readonly kind: "translate"; readonly source: "auto" | string; readonly target: string }
  | { readonly kind: "restore" }
  | { readonly kind: "cancel" };
```

On successful retranslation, replace `lastSuccess` and keep an element-only override. On failure, keep the previous `lastSuccess`, render its text unchanged, and announce the mapped error. Restoration clears both the record and override.

- [ ] **Step 4: Verify menu accessibility and failure preservation**

Test focus enters the first select, Escape cancels and returns focus, explicit language pair reaches the engine, failed retranslation keeps old text, restore removes the block, and translated strings remain text-only.

Run: `bun test tests/dom/targeted-translation.test.ts tests/dom/retranslation.test.ts && bunx tsc --noEmit && bunx biome check src/content tests/dom`

Expected: all targeted and retranslation tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/element-menu.ts src/content/controller.ts tests/dom/targeted-translation.test.ts tests/dom/retranslation.test.ts
git commit -m "feat: add element retranslation controls"
```

---

### Task 7: Full-Page Jobs, Progress, and Stale Content

**Files:**
- Create: `src/content/jobs.ts`
- Modify: `src/content/controller.ts`
- Create: `tests/dom/page-jobs.test.ts`
- Create: `tests/dom/stale-content.test.ts`

**Interfaces:**
- Produces: `runPageJob(targets, worker, onProgress, signal, concurrency = 3): Promise<PageJobSummary>`; controller methods `translatePage(): Promise<PageJobSummary>`, `restorePage(): void`, and `getState(): TabState`; progress `TabState` messages.

```ts
export type PageJobOutcome = "translated" | "skipped" | "failed";
export type PageJobSummary = Readonly<{
  translated: number;
  skipped: number;
  failed: number;
  total: number;
}>;
```

- [ ] **Step 1: Write failing job tests**

Test concurrency never exceeds 3, completion counts translated/skipped/failed separately, one failure does not abort peers, abort prevents queued work from starting, a second page job aborts the first, and restore aborts active work before removing UI.

```ts
it("marks a translation stale when page-owned text changes", async () => {
  const harness = createControllerHarness();
  await harness.controller.translateTarget(harness.source);
  harness.source.firstChild?.replaceWith(document.createTextNode("Updated source"));
  await harness.flushMutations();
  expect(harness.record().phase).toBe("stale");
  expect(harness.translationBlock().textContent).toContain("원문이 변경되었습니다");
});
```

- [ ] **Step 2: Run tests to verify red state**

Run: `bun test tests/dom/page-jobs.test.ts tests/dom/stale-content.test.ts`

Expected: FAIL because jobs and page methods are absent.

- [ ] **Step 3: Implement bounded jobs and progress**

Use an index shared by exactly three async worker loops, checking `AbortSignal.aborted` before claiming each element. Return immutable counts and emit progress after every terminal element. Controller captures a stable `discoverTargets(document)` list, aborts any previous controller, runs translations, and maps the final summary to `complete` or `error` only when zero elements succeeded and at least one failed.

Create a `MutationObserver` only while active records exist. Observe `subtree`, `childList`, and `characterData`; map mutations to the nearest active source element. Restore active hover text before fingerprint comparison, mark changed records stale, and never treat extension-owned UI mutations as source changes.

- [ ] **Step 4: Verify repeated execution and cleanup**

Add tests that a second full-page run updates existing blocks without duplication, newly inserted content is included only on the next explicit run, disconnected records leave the active set, and `restorePage` synchronously restores all text and disconnects the observer.

Run: `bun test tests/dom/page-jobs.test.ts tests/dom/stale-content.test.ts && bun test && bunx tsc --noEmit && bunx biome check .`

Expected: full suite passes and checks exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/content/jobs.ts src/content/controller.ts tests/dom/page-jobs.test.ts tests/dom/stale-content.test.ts
git commit -m "feat: translate and restore full pages"
```

---

### Task 8: Extension Entry Points, Popup, and Options

**Files:**
- Create: `src/manifest.json`
- Create: `src/background.ts`
- Create: `src/content/index.ts`
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.ts`
- Create: `src/popup/popup.css`
- Create: `src/options/options.html`
- Create: `src/options/options.ts`
- Create: `src/options/options.css`
- Create: `src/icons/icon-16.png`
- Create: `src/icons/icon-32.png`
- Create: `src/icons/icon-48.png`
- Create: `src/icons/icon-128.png`
- Create: `tests/unit/background.test.ts`
- Create: `tests/dom/popup.test.ts`
- Create: `tests/dom/options.test.ts`

**Interfaces:**
- Consumes: settings and protocol contracts; controller.
- Produces: a loadable `dist/` extension with popup, options, background, and always-on HTTP/HTTPS content script.

- [ ] **Step 1: Write failing shell tests**

Test background stores the latest `tab-state` by sender tab ID, returns idle for unknown tabs, removes state on tab close, and broadcasts `settings-changed` after storage changes. Test popup buttons send `translate-page`/`restore-page`, progress text handles zero totals, unsupported tabs show the protected-page explanation, and Options saves only parsed settings.

- [ ] **Step 2: Run tests to verify red state**

Run: `bun test tests/unit/background.test.ts tests/dom/popup.test.ts tests/dom/options.test.ts`

Expected: FAIL because entry points and surfaces are absent.

- [ ] **Step 3: Implement manifest and message wiring**

```json
{
  "manifest_version": 3,
  "name": "Local Page Translator",
  "version": "0.1.0",
  "minimum_chrome_version": "138",
  "description": "Translate page text privately with Chrome's on-device models.",
  "permissions": ["storage"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html", "default_title": "Local Page Translator" },
  "options_page": "options.html",
  "content_scripts": [{
    "matches": ["http://*/*", "https://*/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "icons": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" }
}
```

Content entry loads parsed settings, constructs production adapter/controller, tracks hovered eligible targets using `pointerover`, handles configured `keydown` in capture phase, parses runtime messages exhaustively, and destroys resources on `pagehide`. It ignores key events from editable targets.

- [ ] **Step 4: Implement popup and options from `DESIGN.md`**

Popup semantic structure: header/title/privacy badge; status card with live region and progress; primary Translate button; secondary Restore button; footer link to Options. Options semantic structure: one form with display radio group, source select, target select, trigger capture input, conflict note, Save button, and saved live status. Use no framework, inline event handlers, remote assets, or dynamically inserted HTML.

Trigger capture records the physical key string and current modifiers, allows modifier-only Control/Alt/Meta/Shift, rejects Escape/Tab/Enter and bare printable letters, and shows the normalized binding before save. `chrome.i18n.getUILanguage()` is resolved only while parsing defaults; stored browser-target settings refresh their `resolvedLanguage` on every options/content load.

Generate a simple original icon set: paper-colored rounded square, moss border, and two offset ink/moss speech lines; use the same geometry at all four raster sizes and verify legibility at 16px.

- [ ] **Step 5: Verify UI behavior, build, and commit**

Run: `bun test tests/unit/background.test.ts tests/dom/popup.test.ts tests/dom/options.test.ts && bun run check && bun run build`

Expected: tests and checks pass; `dist/manifest.json`, four JS bundles, two HTML files, `popup.css`, `options.css`, shared styles, and four icons exist.

```bash
git add src tests/unit/background.test.ts tests/dom/popup.test.ts tests/dom/options.test.ts
git commit -m "feat: add extension control surfaces"
```

---

### Task 9: End-to-End Hardening and Manual Acceptance

**Files:**
- Create: `tests/fixtures/mixed-language.html`
- Create: `README.md`
- Modify only after a reproducing test: the owning file under `src/content/`, `src/shared/`, `src/popup/`, `src/options/`, or `src/background.ts` from Tasks 2–8.

**Interfaces:**
- Produces: verified unpacked extension in `dist/` and complete user/developer documentation.

- [ ] **Step 1: Add a deterministic manual fixture**

Create a local page with English and Japanese paragraphs, a Korean paragraph to skip, a short label with `lang="fr"`, nested emphasis, a link inside text, hidden text, code, an input, a contenteditable region, an RTL Arabic paragraph, a button that changes one paragraph after two seconds, and a button that appends infinite-scroll-like content. Include a visible checklist of expected translated/skipped behavior.

- [ ] **Step 2: Add README instructions**

Document Chrome 138+ desktop and model hardware/download requirements; `bun install`, `bun test`, `bun run check`, `bun run build`; unpacked loading from `dist`; inline/hover modes; Ctrl and custom trigger behavior; full-page restore; element language override; privacy; protected-page limitations; low-confidence short text; first-use downloads; and `chrome://on-device-internals` diagnostics.

- [ ] **Step 3: Run all automated verification**

Run: `bun test && bunx tsc --noEmit && bunx biome check . && bun run build && git diff --check`

Expected: all tests pass, all quality tools exit 0, build completes, and diff check is empty.

- [ ] **Step 4: Audit source size and forbidden escapes**

Run:

```bash
find src tests scripts -type f -name '*.ts' -print0 | xargs -0 -n1 sh -c 'count=$(awk '\''!/^[[:space:]]*$/ && !/^[[:space:]]*\/\//'\'' "$0" | wc -l); test "$count" -le 250 || { echo "$0: $count"; exit 1; }'
rg -n '\bany\b|@ts-ignore|@ts-expect-error|[^=!<>]\![.;,)]' src tests scripts
```

Expected: size command exits 0 with no paths; forbidden-pattern search returns no code escape hatches.

- [ ] **Step 5: Load and exercise the extension in real Chrome**

Open `chrome://extensions`, enable Developer mode, load `dist`, and open the local fixture over HTTP. Verify in this order:

1. Popup reports idle and target language matches Chrome UI language or Korean fallback.
2. Ctrl over English translates one element inline; Ctrl again opens language controls.
3. Explicit English→Japanese retranslation replaces the block; an unsupported pair preserves it.
4. Selection takes precedence over another hovered element.
5. Full-page translation reports translated/skipped/failed counts and creates no duplicate blocks.
6. Restore removes all UI and exactly restores nested markup/text.
7. Hover mode swaps only while pointer/focus is present and restores on leave/blur.
8. Custom trigger works after saving options; editable fields ignore it.
9. Changed source becomes stale; appended content waits for the next explicit page run.
10. DevTools console contains no uncaught errors; network panel shows no extension-origin requests carrying page text.
11. After required models are present, disconnect networking and repeat targeted and full-page translation successfully.
12. Popup on `chrome://settings` explains that the page is unsupported.

- [ ] **Step 6: Lock any discovered defect before fixing it**

For each failure, add the smallest failing Vitest case to the owning test file, run that single test to observe failure, patch the owning source file, rerun the test, then repeat Step 3 and the affected manual acceptance item. Do not change behavior without a reproducing test.

- [ ] **Step 7: Run final runtime audit**

Record three hypotheses and evidence in `docs/verification/2026-07-10-runtime-audit.md`:

- model initialization can lose user activation: evidence from first-use download initiated by popup and Ctrl;
- DOM restoration can corrupt nested text: evidence from fixture DOM snapshot before/after both modes;
- repeated/cancelled jobs can leave stale UI: evidence from back-to-back page translation and immediate restore.

Run the `omo:debugging` runtime audit and `omo:review-work` post-implementation review. Any inconclusive or failed lane blocks completion.

- [ ] **Step 8: Commit the verified product**

```bash
git add README.md tests/fixtures docs/verification src tests
git commit -m "docs: add translator acceptance guide"
```

Final expected repository state: `git status --short` is empty and `git log --oneline` shows one atomic commit for each task.
