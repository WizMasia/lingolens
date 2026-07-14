# Document Title Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate and safely restore the browser-tab document title during full-page translation without broadening translation to forms, attributes, code, or editable content.

**Architecture:** Keep visible body elements on the existing `ElementRecord` and view path. Add a focused document-title translation unit that captures a stable source, owns only the exact translated value it writes, and exposes title work to the page controller as a discriminated page-job target.

**Tech Stack:** TypeScript 5, Vitest with happy-dom, Biome, Bun, Chrome Language Detector/Translator abstraction.

## Global Constraints

- Keep Chrome 138 as the minimum supported browser.
- Process title text only through the existing on-device `TranslationEngine`.
- Translate the document title only from the full-page action; targeted selection and hover remain element-only.
- Keep buttons, options, placeholders, inputs, textareas, editable content, code, preformatted text, SVG metadata, and text-bearing attributes excluded.
- Never overwrite a page-owned title that differs from the last title written by LingoLens.
- A title failure must not abort successful body translations.
- Preserve the existing bounded page-job concurrency and progress accounting.
- Add no runtime dependency.

---

### Task 0: Consolidate the existing untracked documentation

**Files:**
- Create: `docs/superpowers/specs/2026-07-13-multilingual-documentation-design.md`
- Create: `docs/superpowers/specs/2026-07-14-document-title-translation-design.md`
- Create: `docs/superpowers/plans/2026-07-14-document-title-translation.md`

**Interfaces:**
- Consumes: the three untracked source documents in `/Users/joonhokeum/Documents/TranslateProject/docs/superpowers/`.
- Produces: exact tracked copies of those documents in the isolated feature worktree.

- [ ] **Step 1: Copy the three documents without rewriting their content**

Read each source document from the primary checkout and add the corresponding file at the same repository-relative path in the isolated worktree. Use `apply_patch` for the file additions. Do not edit wording, headings, dates, or formatting while copying.

- [ ] **Step 2: Verify exact copies and clean Markdown whitespace**

Run:

```bash
diff -u /Users/joonhokeum/Documents/TranslateProject/docs/superpowers/specs/2026-07-13-multilingual-documentation-design.md docs/superpowers/specs/2026-07-13-multilingual-documentation-design.md
diff -u /Users/joonhokeum/Documents/TranslateProject/docs/superpowers/specs/2026-07-14-document-title-translation-design.md docs/superpowers/specs/2026-07-14-document-title-translation-design.md
diff -u /Users/joonhokeum/Documents/TranslateProject/docs/superpowers/plans/2026-07-14-document-title-translation.md docs/superpowers/plans/2026-07-14-document-title-translation.md
git diff --check -- docs/superpowers
```

Expected: all three `diff` commands and `git diff --check` exit 0 with no output.

- [ ] **Step 3: Commit the consolidated documentation**

```bash
git add docs/superpowers/specs/2026-07-13-multilingual-documentation-design.md docs/superpowers/specs/2026-07-14-document-title-translation-design.md docs/superpowers/plans/2026-07-14-document-title-translation.md
git commit -m "Document translation expansion plans"
```

---

### Task 1: Extract translation-setting derivation

**Files:**
- Create: `src/content/controller-settings.ts`
- Create: `tests/unit/controller-settings.test.ts`
- Modify: `src/content/controller.ts:1-18,112,137,154,209,252-259`
- Modify: `src/content/element-menu-selection.ts:1-6,69-83`

**Interfaces:**
- Consumes: `Settings`, `ElementLanguageChoice`.
- Produces: `targetLanguage(settings: Settings): string` and `settingsLanguages(settings: Settings): readonly ElementLanguageChoice[]`.

- [ ] **Step 1: Write failing settings-derivation tests**

```ts
import { describe, expect, it } from "vitest";
import { settingsLanguages, targetLanguage } from "../../src/content/controller-settings";
import type { Settings } from "../../src/shared/settings";

const settings = (source: Settings["source"], target: Settings["target"]): Settings => ({
  displayMode: "inline",
  source,
  target,
  liveChatNanoEnabled: false,
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
});

describe("controller settings", () => {
  it("resolves fixed and browser target languages", () => {
    expect(targetLanguage(settings({ kind: "auto" }, { kind: "fixed", language: "ja" }))).toBe(
      "ja",
    );
    expect(
      targetLanguage(settings({ kind: "auto" }, { kind: "browser", resolvedLanguage: "ko" })),
    ).toBe("ko");
  });

  it("builds deduplicated menu choices from configured languages", () => {
    expect(
      settingsLanguages(
        settings({ kind: "fixed", language: "en" }, { kind: "fixed", language: "en" }),
      ),
    ).toEqual([{ value: "en", label: "en" }]);
  });
});
```

- [ ] **Step 2: Run the new test and verify red**

Run: `bun test tests/unit/controller-settings.test.ts`

Expected: FAIL because `src/content/controller-settings.ts` does not exist.

- [ ] **Step 3: Add the focused settings helper**

```ts
import type { Settings } from "../shared/settings";
import type { ElementLanguageChoice } from "./element-menu";

export const targetLanguage = (settings: Settings): string =>
  settings.target.kind === "fixed" ? settings.target.language : settings.target.resolvedLanguage;

export const settingsLanguages = (settings: Settings): readonly ElementLanguageChoice[] => {
  const values = new Set<string>([targetLanguage(settings)]);
  if (settings.source.kind === "fixed") values.add(settings.source.language);
  return [...values].map((value) => ({ value, label: value }));
};
```

Import these functions from `controller-settings.ts` in `controller.ts`, delete the two local helpers, and remove `ElementLanguageChoice` from the value/helper dependency at the bottom of the file while retaining its exported controller dependency type. Import `targetLanguage` in `element-menu-selection.ts` and delete its duplicate local implementation.

- [ ] **Step 4: Verify green and unchanged controller behavior**

Run: `bun test tests/unit/controller-settings.test.ts tests/dom/retranslation.test.ts tests/dom/translation-detection-state.test.ts && bunx tsc --noEmit && bunx biome check src/content/controller-settings.ts src/content/controller.ts src/content/element-menu-selection.ts tests/unit/controller-settings.test.ts`

Expected: all tests and checks PASS with no warnings.

- [ ] **Step 5: Commit the extraction**

```bash
git add src/content/controller-settings.ts src/content/controller.ts src/content/element-menu-selection.ts tests/unit/controller-settings.test.ts
git commit -m "Extract translation setting resolution"
```

---

### Task 2: Add the document-title translation lifecycle

**Files:**
- Create: `src/content/document-title.ts`
- Create: `tests/dom/document-title.test.ts`

**Interfaces:**
- Consumes: `TranslationEngine.translate(request)`, live `Settings`, `PageJobOutcome`, `AbortSignal`, and `targetLanguage(settings)` from Task 1.
- Produces: `DocumentTitleAttempt`, `DocumentTitleTranslation`, and `createDocumentTitleTranslation(dependencies)`.

- [ ] **Step 1: Write failing lifecycle tests**

Create `tests/dom/document-title.test.ts` with a typed fake engine and these five behaviors:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranslationError, type TranslationEngine, type TranslationResult } from "../../src/content/ai-engine";
import { createDocumentTitleTranslation } from "../../src/content/document-title";
import type { Settings } from "../../src/shared/settings";

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  liveChatNanoEnabled: false,
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

const translated = (text: string): TranslationResult => ({
  kind: "translated",
  text,
  sourceLanguage: "en",
  targetLanguage: "ko",
  provenance: "language-detector",
});

const fakeEngine = (translate: TranslationEngine["translate"]): TranslationEngine => ({
  async detectSource() {
    return { kind: "detected", language: "en", provenance: "language-detector" };
  },
  translate,
  async availability() {
    return "available";
  },
  destroy() {},
});

const requiredAttempt = (
  title: ReturnType<typeof createDocumentTitleTranslation>,
): NonNullable<ReturnType<typeof title.prepare>> => {
  const attempt = title.prepare();
  if (attempt === undefined) throw new TypeError("expected a document-title attempt");
  return attempt;
};

afterEach(() => {
  document.title = "";
});

describe("document title translation", () => {
  it("translates and restores a meaningful title", async () => {
    document.title = "Original article";
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(vi.fn().mockResolvedValue(translated("번역된 글"))),
      settings: () => SETTINGS,
    });

    await expect(title.translate(requiredAttempt(title), new AbortController().signal)).resolves.toBe(
      "translated",
    );
    expect(document.title).toBe("번역된 글");
    title.restore();
    expect(document.title).toBe("Original article");
  });

  it("preserves a site-owned change and captures it on the next run", async () => {
    document.title = "Original article";
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(vi.fn().mockResolvedValue(translated("번역된 글"))),
      settings: () => SETTINGS,
    });
    await title.translate(requiredAttempt(title), new AbortController().signal);

    document.title = "Updated by site";
    title.restore();

    expect(document.title).toBe("Updated by site");
    expect(requiredAttempt(title).source).toBe("Updated by site");
  });

  it("discards a late result after cancellation", async () => {
    document.title = "Original article";
    let resolveResult: ((result: TranslationResult) => void) | undefined;
    const pending = new Promise<TranslationResult>((resolve) => {
      resolveResult = resolve;
    });
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(() => pending),
      settings: () => SETTINGS,
    });
    const abort = new AbortController();
    const result = title.translate(requiredAttempt(title), abort.signal);

    abort.abort();
    title.restore();
    resolveResult?.(translated("늦은 결과"));

    await expect(result).resolves.toBe("skipped");
    expect(document.title).toBe("Original article");
  });

  it("leaves a same-language title unchanged", async () => {
    document.title = "한국어 제목";
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(
        vi.fn().mockResolvedValue({
          kind: "skipped",
          sourceLanguage: "ko",
          provenance: "language-detector",
        }),
      ),
      settings: () => SETTINGS,
    });

    await expect(title.translate(requiredAttempt(title), new AbortController().signal)).resolves.toBe(
      "skipped",
    );
    expect(document.title).toBe("한국어 제목");
  });

  it("omits empty and non-linguistic titles", () => {
    const title = createDocumentTitleTranslation({
      document,
      engine: fakeEngine(vi.fn()),
      settings: () => SETTINGS,
    });
    document.title = "123 ...";
    expect(title.prepare()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run lifecycle tests and verify red**

Run: `bun test tests/dom/document-title.test.ts`

Expected: FAIL because `src/content/document-title.ts` does not exist.

- [ ] **Step 3: Implement title ownership and stale-result protection**

```ts
import type { Settings } from "../shared/settings";
import { TranslationError, type TranslationEngine, type TranslationResult } from "./ai-engine";
import { targetLanguage } from "./controller-settings";
import type { PageJobOutcome } from "./jobs";

const MEANINGFUL_TEXT = /[\p{L}\p{M}]/u;

export type DocumentTitleAttempt = Readonly<{
  source: string;
  observedTitle: string;
  version: number;
}>;

export type DocumentTitleTranslation = Readonly<{
  prepare(): DocumentTitleAttempt | undefined;
  translate(attempt: DocumentTitleAttempt, signal: AbortSignal): Promise<PageJobOutcome>;
  restore(): void;
}>;

type Dependencies = Readonly<{
  document: Document;
  engine: TranslationEngine;
  settings(): Settings;
}>;

export const createDocumentTitleTranslation = (
  dependencies: Dependencies,
): DocumentTitleTranslation => {
  let sourceTitle: string | null = null;
  let translatedTitle: string | null = null;
  let version = 0;

  const release = (): void => {
    sourceTitle = null;
    translatedTitle = null;
  };

  const prepare = (): DocumentTitleAttempt | undefined => {
    version += 1;
    const observedTitle = dependencies.document.title;
    const ownsCurrentTitle =
      sourceTitle !== null && translatedTitle !== null && observedTitle === translatedTitle;
    const source = ownsCurrentTitle ? sourceTitle : observedTitle;
    if (!ownsCurrentTitle) release();
    return MEANINGFUL_TEXT.test(source) ? { source, observedTitle, version } : undefined;
  };

  const isCurrent = (attempt: DocumentTitleAttempt, signal: AbortSignal): boolean =>
    !signal.aborted &&
    attempt.version === version &&
    dependencies.document.title === attempt.observedTitle;

  const commit = (attempt: DocumentTitleAttempt, result: TranslationResult): PageJobOutcome => {
    switch (result.kind) {
      case "translated":
        sourceTitle = attempt.source;
        translatedTitle = result.text;
        dependencies.document.title = result.text;
        return "translated";
      case "skipped":
        dependencies.document.title = attempt.source;
        release();
        return "skipped";
      case "unknown-source":
        return "failed";
      default:
        return assertNever(result);
    }
  };

  return {
    prepare,
    async translate(attempt, signal) {
      try {
        const settings = dependencies.settings();
        const result = await dependencies.engine.translate({
          text: attempt.source,
          source: settings.source,
          target: targetLanguage(settings),
        });
        if (!isCurrent(attempt, signal)) {
          if (dependencies.document.title !== attempt.observedTitle) release();
          return signal.aborted || attempt.version !== version ? "skipped" : "failed";
        }
        return commit(attempt, result);
      } catch (error: unknown) {
        if (signal.aborted || attempt.version !== version) return "skipped";
        if (dependencies.document.title !== attempt.observedTitle) release();
        if (error instanceof TranslationError) return "failed";
        throw error;
      }
    },
    restore() {
      version += 1;
      if (
        sourceTitle !== null &&
        translatedTitle !== null &&
        dependencies.document.title === translatedTitle
      ) {
        dependencies.document.title = sourceTitle;
      }
      release();
    },
  };
};

const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled variant: ${String(value)}`);
};
```

- [ ] **Step 4: Verify lifecycle green**

Run: `bun test tests/dom/document-title.test.ts && bunx tsc --noEmit && bunx biome check src/content/document-title.ts tests/dom/document-title.test.ts`

Expected: all five tests and both checks PASS.

- [ ] **Step 5: Commit the title lifecycle**

```bash
git add src/content/document-title.ts tests/dom/document-title.test.ts
git commit -m "Add document title translation lifecycle"
```

---

### Task 3: Integrate titles into full-page jobs

**Files:**
- Create: `tests/dom/document-title-page.test.ts`
- Modify: `src/content/page-controller.ts:1-21,46-74`
- Modify: `src/content/controller.ts:1-20,66-71,124-149`
- Modify: `README.md`
- Modify: `README.ko.md`

**Interfaces:**
- Consumes: `DocumentTitleAttempt`, `DocumentTitleTranslation`, `createDocumentTitleTranslation`, `PageJobOutcome`, and the existing generic `runPageJob`.
- Produces: full-page progress and restoration that include one eligible document-title target.

- [ ] **Step 1: Write failing full-page integration tests**

Create `tests/dom/document-title-page.test.ts` with this typed harness before the assertions:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationError, type TranslationEngine, type TranslationResult } from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import type { Settings } from "../../src/shared/settings";

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  liveChatNanoEnabled: false,
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

class FixtureRectList implements DOMRectList {
  readonly [index: number]: DOMRect;
  readonly 0 = new DOMRect(0, 0, 100, 20);
  readonly length = 1;

  item(index: number): DOMRect | null {
    return index === 0 ? this[0] : null;
  }

  [Symbol.iterator](): ArrayIterator<DOMRect> {
    return [this[0]][Symbol.iterator]();
  }
}

type TranslateText = (text: string) => string | Promise<string>;

const engineThatTranslates = (translateText: TranslateText): TranslationEngine => ({
  async detectSource() {
    return { kind: "detected", language: "en", provenance: "language-detector" };
  },
  async translate(request): Promise<TranslationResult> {
    return {
      kind: "translated",
      text: await translateText(request.text),
      sourceLanguage: "en",
      targetLanguage: request.target,
      provenance: "language-detector",
    };
  },
  async availability() {
    return "available";
  },
  destroy() {},
});

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(new FixtureRectList());
});

describe("document title page integration", () => {
```

Place these three tests inside the `describe` block and close it after the final test:

```ts
it("translates the title and a heading in one page job, then restores both", async () => {
  document.title = "Article title";
  const heading = document.createElement("h1");
  heading.textContent = "Visible heading";
  document.body.append(heading);
  const engine = engineThatTranslates((text) => `ko:${text}`);
  const controller = createTranslationController({ document, engine, settings: SETTINGS });

  await controller.translatePage();

  expect(document.title).toBe("ko:Article title");
  expect(controller.getState()).toMatchObject({ phase: "complete", completed: 2, total: 2 });
  expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(1);

  controller.restorePage();
  expect(document.title).toBe("Article title");
  expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
  controller.destroy();
});

it("counts a title failure without stopping body translation", async () => {
  document.title = "Broken title";
  const paragraph = document.createElement("p");
  paragraph.textContent = "Working body";
  document.body.append(paragraph);
  const engine = engineThatTranslates((text) => {
    if (text === "Broken title") {
      return Promise.reject(new TranslationError("translation-failed", "fixture title failure"));
    }
    return Promise.resolve(`ko:${text}`);
  });
  const controller = createTranslationController({ document, engine, settings: SETTINGS });

  await controller.translatePage();

  expect(document.title).toBe("Broken title");
  expect(controller.getState()).toMatchObject({
    phase: "complete",
    completed: 2,
    total: 2,
    failed: 1,
  });
  expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(1);
  controller.destroy();
});

it("keeps targeted translation element-only", async () => {
  document.title = "Article title";
  const heading = document.createElement("h1");
  heading.textContent = "Visible heading";
  document.body.append(heading);
  const requests: string[] = [];
  const engine = engineThatTranslates((text) => {
    requests.push(text);
    return `ko:${text}`;
  });
  const controller = createTranslationController({ document, engine, settings: SETTINGS });

  await controller.translateTarget(heading);

  expect(requests).toEqual(["Visible heading"]);
  expect(document.title).toBe("Article title");
  controller.destroy();
});

});
```

- [ ] **Step 2: Run integration tests and verify red**

Run: `bun test tests/dom/document-title-page.test.ts`

Expected: the full-page tests FAIL because the page controller still discovers body elements only; the targeted test already passes and locks the scope boundary.

- [ ] **Step 3: Add the discriminated page target and controller wiring**

In `page-controller.ts`, add the title dependency and page target union:

```ts
import type { DocumentTitleAttempt, DocumentTitleTranslation } from "./document-title";

type PageTarget =
  | Readonly<{ kind: "element"; source: HTMLElement }>
  | Readonly<{ kind: "title"; attempt: DocumentTitleAttempt }>;

export type PageControllerDependencies = Readonly<{
  document: Document;
  store: RecordStore;
  title: DocumentTitleTranslation;
  translate(source: HTMLElement, signal: AbortSignal): Promise<PageJobOutcome>;
  onStale(record: ElementRecord): void;
  onState(state: TabState): void;
}>;
```

Build the stable worklist and dispatch it exhaustively:

```ts
const pageTargets = (dependencies: PageControllerDependencies): readonly PageTarget[] => {
  const elements: readonly PageTarget[] = discoverTargets(dependencies.document).map((source) => ({
    kind: "element",
    source,
  }));
  const title = dependencies.title.prepare();
  return title === undefined ? elements : [{ kind: "title", attempt: title }, ...elements];
};

const translateTarget = (
  target: PageTarget,
  dependencies: PageControllerDependencies,
  signal: AbortSignal,
): Promise<PageJobOutcome> => {
  switch (target.kind) {
    case "element":
      return dependencies.translate(target.source, signal);
    case "title":
      return dependencies.title.translate(target.attempt, signal);
    default:
      return assertNever(target);
  }
};
```

Use `pageTargets(dependencies)` in `run`, pass `translateTarget(target, dependencies, job.signal)` to `runPageJob`, and call `dependencies.title.restore()` inside `reset` immediately after aborting the active job. Add the local exhaustive `assertNever` helper.

In `controller.ts`, construct and pass the title unit after the mutable `settings` variable is initialized:

```ts
import { createDocumentTitleTranslation } from "./document-title";

const title = createDocumentTitleTranslation({
  document: dependencies.document,
  engine: dependencies.engine,
  settings: () => settings,
});

const page = createPageController({
  document: dependencies.document,
  store,
  title,
  async translate(source, signal): Promise<PageJobOutcome> {
    const record = store.getOrCreate(source);
    const succeeded = await perform({
      source,
      preference: settings.source,
      target: targetLanguage(settings),
      signal,
    });
    if (signal.aborted) return "skipped";
    if (succeeded) return "translated";
    return record.phase === "error" || record.phase === "stale" ? "failed" : "skipped";
  },
  onStale(record) {
    (liveChat.has(record) ? liveChatView : view).markStale(record);
  },
  onState: dependencies.onState ?? (() => undefined),
});
```

- [ ] **Step 4: Document the expanded full-page scope**

Replace the English full-page bullet with:

```md
- **Full page:** open the toolbar popup and choose **페이지 전체 번역** to translate eligible page text and the browser-tab title. Use **원문 복원** to remove translations made by LingoLens.
```

Replace the first Korean usage bullet with:

```md
- 팝업에서 **페이지 전체 번역**을 누르면 번역 가능한 페이지 텍스트와 브라우저 탭 제목을 번역합니다. **원문 복원**을 누르면 LingoLens가 만든 번역을 지웁니다.
```

Keep the existing exclusion list unchanged.

- [ ] **Step 5: Verify focused integration and regression coverage**

Run: `bun test tests/dom/document-title-page.test.ts tests/dom/document-title.test.ts tests/dom/page-jobs.test.ts tests/dom/targets.test.ts tests/dom/stale-content.test.ts`

Expected: all focused tests PASS with no unhandled rejection.

- [ ] **Step 6: Run the full quality gate**

Run: `bun test && bun run check && bun run build && git diff --check`

Expected: the full test suite, TypeScript/Biome checks, production build, and whitespace check all exit 0.

- [ ] **Step 7: Enforce source-file size and architecture constraints**

Run:

```bash
for file in src/content/controller-settings.ts src/content/document-title.ts src/content/page-controller.ts src/content/controller.ts; do
  awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/|#|--)/' "$file" | wc -l
done
```

Expected: every modified source file is at most 250 pure lines. Confirm `document-title.ts` owns only title capture/translation/restoration, `page-controller.ts` owns page-job orchestration, and no `Any`, `@ts-ignore`, `@ts-expect-error`, or non-exhaustive tagged-union branch was introduced.

- [ ] **Step 8: Commit the integration**

```bash
git add src/content/page-controller.ts src/content/controller.ts tests/dom/document-title-page.test.ts README.md README.ko.md docs/superpowers/specs/2026-07-14-document-title-translation-design.md docs/superpowers/plans/2026-07-14-document-title-translation.md
git commit -m "Translate browser tab titles"
```
