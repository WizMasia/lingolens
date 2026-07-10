# Offline Language Detection Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve uncertain source languages through a deterministic offline fallback pipeline and show whether an element is uninspected, automatically detected, user-selected, or still needs confirmation.

**Architecture:** Keep Chrome-specific APIs inside `chromium-ai-adapter.ts`, and let `ai-engine.ts` own evidence ordering and thresholds. Persist detection state and provenance on `ElementRecord`; the controller runs detection when an untouched element menu opens, and the Shadow DOM menu renders the resulting state without changing page layout.

**Tech Stack:** TypeScript 5.9, Chrome MV3 APIs, Chrome `LanguageDetector`, `chrome.i18n.detectLanguage`, Vitest, Happy DOM, Bun, esbuild, Biome.

## Global Constraints

- No page text leaves Chrome; do not add network calls, remote code, telemetry, or cloud fallback.
- Do not add Gemini Nano to the automatic MVP fallback.
- Keep `minimum_chrome_version` at `138` and add no manifest permission for `chrome.i18n`.
- Accept a primary `LanguageDetector` result at confidence `>= 0.6`.
- Accept an unreliable CLD result only at percentage `>= 80` when it agrees with a normalized `LanguageDetector` candidate.
- Infer only Hangul as Korean, Hiragana/Katakana as Japanese, and Arabic script as Arabic.
- Preserve hover mode's no-added-element behavior; the menu remains a fixed body-level extension overlay.

---

### Task 1: Add the Chrome i18n detector boundary

**Files:**
- Modify: `src/content/ai-engine.ts`
- Modify: `src/content/chromium-ai-adapter.ts`
- Modify: `tests/unit/chromium-ai-adapter.test.ts`
- Modify: `tests/unit/ai-engine.test.ts`
- Modify: `tests/unit/translator-cache.test.ts`

**Interfaces:**
- Produces: `AiSecondaryDetection`, `AiAdapter.detectWithChrome(text)`, and a typed adapter wrapper around `chrome.i18n.detectLanguage()`.
- Consumes: existing `AiDetection`, `TranslationError`, and `createChromiumAiAdapter()`.

- [ ] **Step 1: Write failing adapter tests**

Add a typed `chrome.i18n.detectLanguage` fixture and assert both successful mapping and API failure:

```ts
it("maps Chrome i18n language evidence", async () => {
  const detectLanguage = vi.fn().mockResolvedValue({
    isReliable: true,
    languages: [
      { language: "fr", percentage: 91 },
      { language: "en", percentage: 9 },
    ],
  });
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { i18n: { detectLanguage } },
  });

  const adapter = createChromiumAiAdapter();

  await expect(adapter.detectWithChrome("Bonjour tout le monde")).resolves.toEqual({
    reliable: true,
    languages: [
      { language: "fr", percentage: 91 },
      { language: "en", percentage: 9 },
    ],
  });
});

it("returns no secondary evidence when Chrome i18n fails", async () => {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { i18n: { detectLanguage: vi.fn().mockRejectedValue(new Error("CLD failed")) } },
  });

  await expect(createChromiumAiAdapter().detectWithChrome("Brief")).resolves.toBeUndefined();
});
```

Restore the original `chrome` descriptor in `afterEach`, as the test already does for `LanguageDetector` and `Translator`.

- [ ] **Step 2: Run the adapter tests and confirm failure**

Run: `bun test tests/unit/chromium-ai-adapter.test.ts`

Expected: FAIL because `AiAdapter` and the Chromium adapter do not expose `detectWithChrome`.

- [ ] **Step 3: Add the typed secondary detector**

Add these contracts to `ai-engine.ts`:

```ts
export type AiSecondaryDetection = Readonly<{
  reliable: boolean;
  languages: readonly Readonly<{ language: string; percentage: number }>[];
}>;

export type AiAdapter = Readonly<{
  detect(text: string): Promise<readonly AiDetection[]>;
  detectWithChrome(text: string): Promise<AiSecondaryDetection | undefined>;
  availability(source: string, target: string): Promise<AiAvailability>;
  createTranslator(source: string, target: string): Promise<AiTranslator>;
  destroy(): void;
}>;
```

Implement the adapter method without treating CLD unavailability as a translation failure:

```ts
async detectWithChrome(text) {
  const detectLanguage = globalThis.chrome?.i18n?.detectLanguage;
  if (detectLanguage === undefined) return undefined;
  try {
    const result = await detectLanguage(text);
    return {
      reliable: result.isReliable,
      languages: result.languages.map(({ language, percentage }) => ({ language, percentage })),
    };
  } catch {
    return undefined;
  }
},
```

Update every test adapter fixture to provide `detectWithChrome: vi.fn().mockResolvedValue(undefined)` so strict structural typing stays intact.

- [ ] **Step 4: Run adapter and type checks**

Run: `bun test tests/unit/chromium-ai-adapter.test.ts && bunx tsc --noEmit`

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 5: Commit the adapter boundary**

```bash
git add src/content/ai-engine.ts src/content/chromium-ai-adapter.ts tests/unit/chromium-ai-adapter.test.ts tests/unit/ai-engine.test.ts tests/unit/translator-cache.test.ts
git commit -m "feat: add offline CLD detector"
```

---

### Task 2: Implement the evidence pipeline and script inference

**Files:**
- Create: `src/content/script-language.ts`
- Create: `tests/unit/script-language.test.ts`
- Modify: `src/content/ai-engine.ts`
- Modify: `tests/unit/ai-engine.test.ts`
- Modify: `tests/unit/translator-cache.test.ts`
- Modify: `tests/dom/page-jobs.test.ts`
- Modify: `tests/dom/retranslation.test.ts`
- Modify: `tests/dom/stale-content.test.ts`
- Modify: `tests/dom/targeted-translation.test.ts`
- Modify: `tests/dom/unknown-source-action.test.ts`

**Interfaces:**
- Produces: `DetectionProvenance`, `SourceDetection`, `TranslationEngine.detectSource(request)`, and `inferScriptLanguage(text)`.
- Consumes: `AiAdapter.detect`, `AiAdapter.detectWithChrome`, `normalizeLanguage`, and `TranslationRequest`.

- [ ] **Step 1: Write failing script-inference tests**

```ts
describe("script language inference", () => {
  it.each([
    ["안녕하세요", "ko"],
    ["これはテストです", "ja"],
    ["مرحبا بالعالم", "ar"],
  ])("infers an unambiguous script from %s", (text, expected) => {
    expect(inferScriptLanguage(text)).toBe(expected);
  });

  it.each(["Hello", "Привет", "中文", "1234"])("does not guess from %s", (text) => {
    expect(inferScriptLanguage(text)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write failing engine pipeline tests**

Extend the adapter fixture so tests control primary and CLD evidence. Cover these exact boundaries:

```ts
it("retries uncertain element text with context", async () => {
  const detect = vi
    .fn()
    .mockResolvedValueOnce([{ detectedLanguage: "en", confidence: 0.4 }])
    .mockResolvedValueOnce([{ detectedLanguage: "fr", confidence: 0.91 }]);
  const engine = createTranslationEngine(makeAdapter({ detect }));

  await expect(
    engine.detectSource({ text: "Bref", source: { kind: "auto", context: "Une phrase française" } }),
  ).resolves.toEqual({ kind: "detected", language: "fr", provenance: "context-detector" });
  expect(detect).toHaveBeenNthCalledWith(1, "Bref");
  expect(detect).toHaveBeenNthCalledWith(2, "Bref Une phrase française");
});

it("accepts reliable CLD evidence after detector uncertainty", async () => {
  const engine = createTranslationEngine(
    makeAdapter({
      detections: [[{ detectedLanguage: "fr", confidence: 0.41 }]],
      chromeDetection: {
        reliable: true,
        languages: [{ language: "fr", percentage: 74 }],
      },
    }),
  );

  await expect(engine.detectSource({ text: "Bref", source: { kind: "auto" } })).resolves.toEqual({
    kind: "detected",
    language: "fr",
    provenance: "chrome-i18n",
  });
});

it("requires agreement for unreliable CLD evidence", async () => {
  const adapter = makeAdapter({
    detections: [[{ detectedLanguage: "fr", confidence: 0.4 }]],
    chromeDetection: {
      reliable: false,
      languages: [{ language: "en", percentage: 95 }],
    },
  });

  await expect(
    createTranslationEngine(adapter).detectSource({ text: "Nom", source: { kind: "auto" } }),
  ).resolves.toEqual({ kind: "needs-confirmation" });
});
```

Also test `und` rejection, `80` acceptance with candidate agreement, `79` rejection, primary or secondary detector rejection continuing to the remaining fallback stages, valid `lang` provenance, and fixed-source provenance `user`.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `bun test tests/unit/script-language.test.ts tests/unit/ai-engine.test.ts`

Expected: FAIL because the new inference module and `detectSource` contract do not exist.

- [ ] **Step 4: Implement deterministic script inference**

Create `script-language.ts`:

```ts
export type ScriptLanguage = "ar" | "ja" | "ko";

export const inferScriptLanguage = (text: string): ScriptLanguage | undefined => {
  if (/\p{Script=Hangul}/u.test(text)) return "ko";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  if (/\p{Script=Arabic}/u.test(text)) return "ar";
  return undefined;
};
```

- [ ] **Step 5: Add the reusable source-detection contract**

Add to `ai-engine.ts`:

```ts
export type DetectionProvenance =
  | "lang"
  | "language-detector"
  | "context-detector"
  | "chrome-i18n"
  | "script"
  | "user";

export type SourceDetection =
  | Readonly<{ kind: "detected"; language: string; provenance: DetectionProvenance }>
  | Readonly<{ kind: "needs-confirmation" }>;

export type SourceDetectionRequest = Readonly<{
  text: string;
  source: AutomaticSource | Extract<SourcePreference, { readonly kind: "fixed" }>;
}>;
```

Expose `detectSource(request)` on `TranslationEngine`. `translate()` must call the same function, not duplicate resolution logic. Add `provenance` to translated and skipped results so record state reflects the evidence actually used.

- [ ] **Step 6: Implement evidence ordering**

Use these pure selection rules inside `ai-engine.ts`:

```ts
const PRIMARY_CONFIDENCE = 0.6;
const SECONDARY_PERCENTAGE = 80;

const acceptedPrimary = (detections: readonly AiDetection[]): SourceDetection | undefined => {
  const best = detections[0];
  const language = normalizeLanguage(best?.detectedLanguage ?? "");
  return language !== undefined && (best?.confidence ?? 0) >= PRIMARY_CONFIDENCE
    ? { kind: "detected", language, provenance: "language-detector" }
    : undefined;
};
```

The implementation must:

1. return fixed source as `user` and valid hint as `lang`;
2. detect the element text first;
3. retry only when non-empty context differs, using `${text} ${context}` bounded by the existing context collector;
4. normalize every candidate and keep all primary candidate languages for CLD agreement;
5. ignore `und` and malformed CLD codes;
6. apply the reliable/agreement percentage rules;
7. treat primary-detector rejection or API unavailability as absent evidence and continue locally;
8. call `inferScriptLanguage(text)` last;
9. return `needs-confirmation` when no evidence passes.

Update every structural `TranslationEngine` fixture in the listed DOM tests with a typed `detectSource` stub. Add `provenance: "language-detector"` to existing translated and skipped fixture results so the new result union remains exhaustive.

- [ ] **Step 7: Run engine tests and the existing cache tests**

Run: `bun test tests/unit/ai-engine.test.ts tests/unit/script-language.test.ts tests/unit/translator-cache.test.ts`

Expected: PASS; existing translator and request deduplication remains intact.

- [ ] **Step 8: Commit the detection pipeline**

```bash
git add src/content/ai-engine.ts src/content/script-language.ts tests/unit/ai-engine.test.ts tests/unit/script-language.test.ts tests/unit/translator-cache.test.ts tests/dom/page-jobs.test.ts tests/dom/retranslation.test.ts tests/dom/stale-content.test.ts tests/dom/targeted-translation.test.ts tests/dom/unknown-source-action.test.ts
git commit -m "feat: resolve uncertain source languages"
```

---

### Task 3: Persist detection state and provenance on element records

**Files:**
- Modify: `src/content/records.ts`
- Modify: `src/content/translation-attempt.ts`
- Modify: `tests/dom/records.test.ts`
- Modify: `tests/dom/targeted-translation.test.ts`
- Modify: `tests/dom/unknown-source-action.test.ts`

**Interfaces:**
- Produces: `ElementDetectionState`, `ElementRecord.detection`, `ElementRecord.setDetection()`, and translation commits carrying provenance.
- Consumes: `SourceDetection`, `DetectionProvenance`, and translation results from Task 2.

- [ ] **Step 1: Write failing record-state tests**

```ts
it("starts uninspected and stores automatic detection evidence", () => {
  const record = new ElementRecord(source, () => undefined);
  expect(record.detection).toEqual({ kind: "not-detected" });

  record.setDetection({ kind: "detected", language: "en", provenance: "chrome-i18n" });

  expect(record.detection).toEqual({
    kind: "detected",
    language: "en",
    provenance: "chrome-i18n",
  });
});

it("clears stale automatic evidence when source text changes", () => {
  const record = new ElementRecord(source, () => undefined);
  record.setDetection({ kind: "detected", language: "en", provenance: "language-detector" });
  source.textContent = "Bonjour";
  record.refreshSource();
  expect(record.detection).toEqual({ kind: "not-detected" });
});
```

Also test that a user override reports `user-selected`, clearing the override restores `not-detected`, and a failed pipeline stores `needs-confirmation`.

- [ ] **Step 2: Run record and translation tests and confirm failure**

Run: `bun test tests/dom/records.test.ts tests/dom/targeted-translation.test.ts tests/dom/unknown-source-action.test.ts`

Expected: FAIL because records do not expose detection state or provenance.

- [ ] **Step 3: Add record detection state**

Add to `records.ts`:

```ts
export type ElementDetectionState =
  | Readonly<{ kind: "not-detected" }>
  | Readonly<{ kind: "detected"; language: string; provenance: DetectionProvenance }>
  | Readonly<{ kind: "user-selected"; language: string }>
  | Readonly<{ kind: "needs-confirmation" }>;
```

`ElementRecord` owns `#detection`, exposes a getter, and updates it through `setDetection`. `refreshSource()` clears automatic or unresolved evidence. `setLanguageOverride()` stores `user-selected` for a fixed source and clears it when returning to automatic mode.

- [ ] **Step 4: Commit engine outcomes to the record**

Update `translation-attempt.ts` so `translated` and `skipped` results set detected/user-selected evidence before rendering or removal, while `unknown-source` becomes the `needs-confirmation` record state. Preserve the existing Korean notice and manual-selection action.

When cancellation restores `priorSuccess`, also restore its provenance; extend `TranslationSuccess` and `ElementRecord.complete()` accordingly:

```ts
export type TranslationSuccess = Readonly<{
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  provenance: DetectionProvenance;
}>;
```

- [ ] **Step 5: Run the DOM regression set**

Run: `bun test tests/dom/records.test.ts tests/dom/targeted-translation.test.ts tests/dom/unknown-source-action.test.ts tests/dom/stale-content.test.ts`

Expected: PASS, including restoration and stale-source behavior.

- [ ] **Step 6: Commit record state**

```bash
git add src/content/records.ts src/content/translation-attempt.ts tests/dom/records.test.ts tests/dom/targeted-translation.test.ts tests/dom/unknown-source-action.test.ts tests/dom/stale-content.test.ts
git commit -m "feat: track element detection state"
```

---

### Task 4: Detect on menu open and render truthful status

**Files:**
- Modify: `src/content/controller.ts`
- Modify: `src/content/element-menu.ts`
- Modify: `tests/dom/retranslation.test.ts`

**Interfaces:**
- Produces: `ElementMenuDetection`, provenance-aware menu copy, and controller inspection before opening an untouched element menu.
- Consumes: `TranslationEngine.detectSource`, `ElementRecord.detection`, and existing `ElementMenu.open()`.

- [ ] **Step 1: Write failing menu copy tests**

Replace the old untouched `Unknown` assertion and add provenance cases:

```ts
it("labels an untouched element as not detected yet", async () => {
  const pending = menu.open(source, {
    source: "auto",
    target: "ko",
    detection: { kind: "not-detected" },
  });
  expect(menuText()).toContain("Detected source: Not detected yet");
  menu.destroy();
  await pending;
});

it("shows the fallback detector provenance", async () => {
  const pending = menu.open(source, {
    source: "auto",
    target: "ko",
    detection: { kind: "detected", language: "fr", provenance: "chrome-i18n" },
  });
  expect(menuText()).toContain("Detected source: French (Chrome fallback)");
  menu.destroy();
  await pending;
});
```

Cover `Needs confirmation` and `English (User selected)` as separate assertions.

- [ ] **Step 2: Write a failing controller inspection test**

```ts
it("detects an untouched source before opening its menu", async () => {
  const detectSource = vi.fn().mockResolvedValue({
    kind: "detected",
    language: "en",
    provenance: "language-detector",
  });
  const engine = engineFixture({ detectSource });

  const pending = controller.openElementMenu(source);

  await vi.waitFor(() => expect(detectSource).toHaveBeenCalledTimes(1));
  expect(openedSelection.detection).toEqual({
    kind: "detected",
    language: "en",
    provenance: "language-detector",
  });
  menu.resolve({ kind: "cancel" });
  await pending;
});
```

- [ ] **Step 3: Run the menu test and confirm failure**

Run: `bun test tests/dom/retranslation.test.ts`

Expected: FAIL because the menu accepts only `detectedSource` and the controller does not inspect untouched records.

- [ ] **Step 4: Replace `detectedSource` with structured menu state**

Define in `element-menu.ts`:

```ts
export type ElementMenuDetection = ElementDetectionState;

export type ElementMenuSelection = Readonly<{
  source: "auto" | string;
  target: string;
  detection: ElementMenuDetection;
}>;
```

Render these exact labels:

- `Not detected yet`
- `<language> (HTML lang)`
- `<language> (Chrome AI)`
- `<language> (Chrome AI with context)`
- `<language> (Chrome fallback)`
- `<language> (Script inference)`
- `<language> (User selected)`
- `Needs confirmation`

- [ ] **Step 5: Inspect untouched records before menu open**

In `controller.ts`, add a small `inspectRecord(record)` function. When the current state is `not-detected` and automatic source mode is active, build the same source detection request used by translation, call `engine.detectSource`, verify the source fingerprint did not change, and store the result. Do not translate, render a translation view, or create an inline sibling.

Export a shared `sourceDetectionRequest()` from `translation-attempt.ts` so controller inspection and translation use identical `lang` and bounded-context collection. Do not duplicate `nearestLanguage()` or `nearbyContext()`.

- [ ] **Step 6: Run menu, controller, and shortcut regressions**

Run: `bun test tests/dom/retranslation.test.ts tests/dom/unknown-source-action.test.ts tests/dom/content-entry.test.ts`

Expected: PASS; the menu is still fixed-positioned and primary Ctrl still toggles translation instead of opening it.

- [ ] **Step 7: Commit menu inspection**

```bash
git add src/content/controller.ts src/content/element-menu.ts src/content/translation-attempt.ts tests/dom/retranslation.test.ts tests/dom/unknown-source-action.test.ts tests/dom/content-entry.test.ts
git commit -m "feat: show source detection evidence"
```

---

### Task 5: Full verification and installed-extension acceptance

**Files:**
- Modify if runtime evidence warrants: `docs/verification/2026-07-10-runtime-audit.md`
- Generated by build: `dist/**`

**Interfaces:**
- Consumes: all Tasks 1-4.
- Produces: a clean build and runtime evidence through the installed Chrome extension.

- [ ] **Step 1: Run all automated gates**

Run these independently so a failure identifies its gate:

```bash
bun test
bunx tsc --noEmit
bunx biome check src tests scripts vitest.config.ts
bun run build
git diff --check
```

Expected: all commands exit `0`; the test total is at least the existing 159 plus the new detector, engine, record, and menu cases.

- [ ] **Step 2: Run the post-implementation review and debugging audit**

Use the `review-work` skill and the `debugging` skill. Record runtime evidence for these three hypotheses:

1. CLD failure aborts translation instead of degrading to script/manual confirmation.
2. Opening the floating menu mutates page layout or translates the element.
3. Restoring or changing source text leaves stale detection provenance.

Expected: every review lane passes and each hypothesis is rejected with test or Chrome runtime evidence.

- [ ] **Step 3: Rebuild and reload the unpacked extension**

Run: `bun run build`

In `chrome://extensions`, reload the unpacked extension from the repository `dist` directory. Refresh the acceptance fixture or target web page so the new content script replaces the previous extension context.

- [ ] **Step 4: Exercise the installed extension in Chrome**

Through Chrome, verify:

1. open the menu on untouched English text and observe `English (Chrome AI)` after inspection without translation;
2. translate and restore with Ctrl, then reopen the menu and observe preserved provenance;
3. inspect short ambiguous Latin text and observe either context/CLD provenance or `Needs confirmation`;
4. inspect Hangul, Japanese kana, and Arabic fixtures after forcing low primary evidence in the test fixture, and observe script fallback;
5. choose a source language manually and observe `(User selected)`;
6. confirm no inline menu sibling is inserted and hover mode adds no translated element;
7. inspect the page console and confirm no `Extension context invalidated` or unhandled detection error.

- [ ] **Step 5: Verify offline behavior**

After all required Chrome models have downloaded, disable network connectivity for the test page and repeat detection plus one translation. Confirm the page text is not sent over the network and the operation completes using local Chrome models.

- [ ] **Step 6: Record runtime evidence and commit only if the audit changed**

If new evidence is added:

```bash
git add docs/verification/2026-07-10-runtime-audit.md dist
git commit -m "docs: verify offline detection fallback"
```

If `dist` is intentionally versioned by the repository, include its regenerated files with the runtime-evidence commit; otherwise leave generated output untracked and report that choice.
