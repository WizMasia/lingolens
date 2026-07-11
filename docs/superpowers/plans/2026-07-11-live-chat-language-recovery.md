# Live Chat Language Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover unsupported or ambiguous YouTube Live Chat source languages with an opt-in, on-device Gemini Nano detector and a reliable per-author manual-language fallback.

**Architecture:** Preserve the current deterministic source detector as the first path. A content-script Nano client asks the background coordinator for an extension-owned offscreen Prompt API result only after `needs-confirmation`; the Translator API remains the only translation engine. A session-local author-language map makes the existing fixed-position menu shortcut recover mixed or romanized chat without changing layout.

**Tech Stack:** Chrome MV3, TypeScript 5.9, Chrome Prompt API (`LanguageModel`), Chrome Offscreen Documents API, Chrome Translator/LanguageDetector APIs, esbuild, Vitest, happy-dom.

## Global Constraints

- Keep `minimum_chrome_version` at `138`; add only the MV3 `offscreen` permission.
- Do not add a network request, remote code, telemetry, cloud provider, API key, or external dependency.
- Nano is opt-in, disabled by default, used only after existing detection returns `needs-confirmation`, and never translates text.
- Do not initiate a Nano model download except in an explicit options-page button click.
- Accept Nano output only when JSON parsing, language normalization, confidence `>= 0.8`, and Translator pair availability all pass.
- Keep all author-language state in memory for one content-controller lifetime; clear it through page restore, pagehide, and tab navigation.
- Preserve hover-only rendering for live chat and keep `data-local-translator-ui="inline"` absent from its frame.
- Do not claim support for romanized Hindi or any Prompt API input language Chrome does not document; manual per-author selection remains the recovery path only for Chrome Translator-supported languages. Romanized Urdu remains unsupported while no Urdu pair is available.
- New or touched TypeScript source files must remain at or below 250 pure lines.

---

## File structure

- Create `src/content/nano-language-detector.ts`: Prompt API availability, preparation, constrained response parsing, and session-backed language decision.
- Create `src/background/nano-offscreen-bridge.ts`: create/reuse the offscreen document and exchange typed Nano requests with it.
- Create `src/offscreen/nano-offscreen.ts` and `src/offscreen/nano-offscreen.html`: hold one Nano session and reply to bridge requests.
- Create `src/content/live-chat-language-memory.ts`: session-local author ID to fixed source-language mapping.
- Modify `src/shared/settings.ts`, `src/shared/protocol.ts`: parse the opt-in preference and typed Nano request/response messages at the extension boundary.
- Modify `src/options/options.ts`, `src/options/options.html`, `src/styles/options.css`: render the experimental opt-in and explicit model-preparation status.
- Modify `src/content/chromium-ai-adapter.ts`, `src/content/ai-engine.ts`, `src/content/source-detection.ts`: inject the Nano detector after all deterministic stages.
- Modify `src/content/controller.ts`, `src/content/index.ts`, `src/content/youtube-live-chat.ts`: author-memory precedence, child-frame menu shortcut, and new-message queue priority.
- Modify `src/background.ts`, `src/manifest.json`, `scripts/build.ts`: bridge Nano messages, clean bridge state, offscreen permission, and generated offscreen assets.
- Modify `src/content/element-menu.ts`: label Nano provenance.
- Modify `README.md`, `README.ko.md`, `PRIVACY.md`, `docs/verification/2026-07-10-runtime-audit.md`: document experimental scope, model requirements, data boundary, and tested behavior.
- Create focused unit/DOM tests adjacent to `tests/unit/source-detection.test.ts`, `tests/unit/chromium-ai-adapter.test.ts`, `tests/unit/background.test.ts`, `tests/dom/options.test.ts`, `tests/dom/content-entry.test.ts`, `tests/dom/page-jobs.test.ts`, and `tests/dom/youtube-live-chat.test.ts`.

### Task 1: Lock Nano decision and author-memory contracts

**Files:**
- Create: `src/content/nano-language-detector.ts`
- Create: `src/content/live-chat-language-memory.ts`
- Modify: `src/content/source-detection.ts`
- Modify: `src/content/ai-engine.ts`
- Modify: `src/shared/settings.ts`
- Test: `tests/unit/nano-language-detector.test.ts`
- Test: `tests/unit/source-detection.test.ts`
- Test: `tests/unit/settings.test.ts`

**Interfaces:**

```ts
export type NanoLanguageDecision =
  | Readonly<{ kind: "detected"; language: string; confidence: number }>
  | Readonly<{ kind: "unavailable" }>;

export type NanoLanguageDetector = Readonly<{
  detect(text: string, context: string): Promise<NanoLanguageDecision>;
}>;

export type LiveChatLanguageMemory = Readonly<{
  get(authorId: string): string | undefined;
  set(authorId: string, language: string): void;
  clear(authorId: string): void;
  destroy(): void;
}>;
```

- [ ] **Step 1: Write failing Nano parser and memory tests**

```ts
it("accepts only a normalized, sufficiently confident constrained decision", async () => {
  const detector = createNanoLanguageDetector(fakeNano('{"language":"es-ES","confidence":0.8}'));
  await expect(detector.detect("hola", "buenos días")).resolves.toEqual({
    kind: "detected", language: "es", confidence: 0.8,
  });
});

it.each([
  '{"language":"und","confidence":0.9}',
  '{"language":"es","confidence":0.79}',
  'not json',
])("rejects unsafe Nano output %s", async (reply) => {
  const detector = createNanoLanguageDetector(fakeNano(reply));
  await expect(detector.detect("hola", "")).resolves.toEqual({ kind: "unavailable" });
});

it("keeps a selected source isolated to one author and clears it", () => {
  const memory = createLiveChatLanguageMemory();
  memory.set("/channel/one", "hi");
  expect(memory.get("/channel/one")).toBe("hi");
  expect(memory.get("/channel/two")).toBeUndefined();
  memory.clear("/channel/one");
  expect(memory.get("/channel/one")).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused tests and confirm the missing contracts fail**

Run: `bunx vitest run tests/unit/nano-language-detector.test.ts tests/unit/source-detection.test.ts tests/unit/settings.test.ts`

Expected: FAIL because `createNanoLanguageDetector`, `createLiveChatLanguageMemory`, and `liveChatNanoEnabled` do not exist.

- [ ] **Step 3: Implement the pure contracts and append Nano last in automatic detection**

```ts
export const createLiveChatLanguageMemory = (): LiveChatLanguageMemory => {
  const languages = new Map<string, string>();
  return {
    get: (authorId) => languages.get(authorId),
    set: (authorId, language) => languages.set(authorId, language),
    clear: (authorId) => languages.delete(authorId),
    destroy: () => languages.clear(),
  };
};

const nano = await adapter.detectWithNano?.(request.text, detectionText);
if (nano?.kind === "detected" && nano.confidence >= 0.8) {
  return detected(nano.language, "gemini-nano");
}
```

Add `liveChatNanoEnabled: boolean` to `Settings`, parse only literal `true` as enabled, and default it to `false`. Add `gemini-nano` to `DetectionProvenance`; preserve user, deterministic, and cached detection precedence before the Nano branch.

- [ ] **Step 4: Run the focused tests and type check**

Run: `bunx vitest run tests/unit/nano-language-detector.test.ts tests/unit/source-detection.test.ts tests/unit/settings.test.ts && bunx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the pure language contracts**

```bash
git add src/content/nano-language-detector.ts src/content/live-chat-language-memory.ts src/content/source-detection.ts src/content/ai-engine.ts src/shared/settings.ts tests/unit/nano-language-detector.test.ts tests/unit/source-detection.test.ts tests/unit/settings.test.ts
git commit -m "feat: add local chat language recovery"
```

### Task 2: Add explicit Nano preparation and offscreen feasibility gate

**Files:**
- Create: `src/background/nano-offscreen-bridge.ts`
- Create: `src/offscreen/nano-offscreen.ts`
- Create: `src/offscreen/nano-offscreen.html`
- Modify: `src/shared/protocol.ts`
- Modify: `src/background.ts`
- Modify: `src/manifest.json`
- Modify: `scripts/build.ts`
- Test: `tests/unit/nano-offscreen-bridge.test.ts`
- Test: `tests/unit/protocol.test.ts`
- Test: `tests/unit/background.test.ts`

**Interfaces:**

```ts
export type NanoDetectRequest = Readonly<{ text: string; context: string }>;
export type NanoDetectResponse = NanoLanguageDecision;

export type NanoOffscreenBridge = Readonly<{
  detect(request: NanoDetectRequest): Promise<NanoDetectResponse>;
  close(): Promise<void>;
}>;
```

- [ ] **Step 1: Write failing bridge/protocol tests**

```ts
it("creates one offscreen document and forwards a bounded Nano request", async () => {
  const bridge = createNanoOffscreenBridge(fakeOffscreen(), fakeRuntime());
  await expect(bridge.detect({ text: "hola", context: "buenos días" })).resolves.toEqual({
    kind: "detected", language: "es", confidence: 0.9,
  });
  expect(fakeOffscreen().createDocument).toHaveBeenCalledOnce();
});

it("rejects malformed Nano request messages", () => {
  expect(parseMessage({ type: "detect-nano-source", text: 3, context: "x" })).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `bunx vitest run tests/unit/nano-offscreen-bridge.test.ts tests/unit/protocol.test.ts tests/unit/background.test.ts`

Expected: FAIL because the bridge and message variants do not exist.

- [ ] **Step 3: Implement the offscreen bridge and entry point**

```ts
const ensureDocument = async (): Promise<void> => {
  if (creating === undefined) {
    creating = offscreen.createDocument({
      url: "nano-offscreen.html",
      reasons: ["DOM_SCRAPING"],
      justification: "Run an on-device language classification session",
    }).catch((error: unknown) => {
      creating = undefined;
      throw error;
    });
  }
  await creating;
};
```

Add typed `detect-nano-source` (content to background) and `offscreen-nano-detect` (background to offscreen) variants. The offscreen document creates one `LanguageModel` session only after `LanguageModel.availability()` is `available`; it uses a JSON response constraint and returns `{ kind: "unavailable" }` for every API, parsing, or session failure. It must never call a cloud API.

Add `"offscreen"` to manifest permissions; add `nano-offscreen` to esbuild entry points and copy its HTML to `dist`. Dispose the bridge from tab removal and extension shutdown paths.

- [ ] **Step 4: Run focused verification and build**

Run: `bunx vitest run tests/unit/nano-offscreen-bridge.test.ts tests/unit/protocol.test.ts tests/unit/background.test.ts && bunx tsc --noEmit && bun run build`

Expected: PASS and `dist/nano-offscreen.js`, `dist/nano-offscreen.html`, and `dist/manifest.json` exist.

- [ ] **Step 5: Commit the Nano bridge**

```bash
git add src/background/nano-offscreen-bridge.ts src/offscreen/nano-offscreen.ts src/offscreen/nano-offscreen.html src/shared/protocol.ts src/background.ts src/manifest.json scripts/build.ts tests/unit/nano-offscreen-bridge.test.ts tests/unit/protocol.test.ts tests/unit/background.test.ts
git commit -m "feat: bridge Nano language detection"
```

### Task 3: Expose opt-in preparation in Options

**Files:**
- Modify: `src/options/options.html`
- Modify: `src/options/options.ts`
- Modify: `src/styles/options.css`
- Modify: `src/content/nano-language-detector.ts`
- Test: `tests/dom/options.test.ts`
- Test: `tests/unit/nano-language-detector.test.ts`

**Interfaces:**

```ts
export type NanoPreparation = Readonly<{
  prepare(onProgress: (loaded: number) => void): Promise<"ready" | "unavailable">;
}>;
```

- [ ] **Step 1: Write failing options tests**

```ts
it("keeps Nano assistance disabled by default and saves an explicit opt-in", async () => {
  const save = vi.fn<(settings: Settings) => Promise<void>>().mockResolvedValue();
  const app = createOptionsApp(document, { load: async () => DEFAULTS, save, uiLanguage: "ko" });
  await app.ready;
  document.querySelector<HTMLInputElement>("#live-chat-nano")?.click();
  document.querySelector<HTMLFormElement>("#settings-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  expect(save).toHaveBeenCalledWith({ ...DEFAULTS, liveChatNanoEnabled: true });
});

it("reports unavailable preparation without changing the setting", async () => {
  const app = createOptionsApp(document, { ...deps, prepareNano: async () => "unavailable" });
  await app.ready;
  document.querySelector<HTMLButtonElement>("#prepare-live-chat-nano")?.click();
  await Promise.resolve();
  expect(document.querySelector("#nano-status")?.textContent).toContain("사용할 수 없습니다");
});
```

- [ ] **Step 2: Run the focused options tests and confirm failure**

Run: `bunx vitest run tests/dom/options.test.ts tests/unit/nano-language-detector.test.ts`

Expected: FAIL because the Nano controls and `prepareNano` dependency do not exist.

- [ ] **Step 3: Implement the explicit preparation UI**

Add a checkbox `#live-chat-nano`, a button `#prepare-live-chat-nano`, and live region `#nano-status`. The Korean copy must state that this is experimental, local-only, separately downloaded, and not guaranteed for romanized or unsupported languages. Call `prepareNano` only from the button listener; update progress with `로컬 모델 준비 중: ${Math.round(loaded * 100)}%`; render `준비됨` or `이 기기에서는 사용할 수 없습니다` on completion. Include `liveChatNanoEnabled` in `readSettings`.

- [ ] **Step 4: Run options verification and build**

Run: `bunx vitest run tests/dom/options.test.ts tests/unit/nano-language-detector.test.ts && bunx tsc --noEmit && bun run build`

Expected: PASS.

- [ ] **Step 5: Commit the options flow**

```bash
git add src/options/options.html src/options/options.ts src/styles/options.css src/content/nano-language-detector.ts tests/dom/options.test.ts tests/unit/nano-language-detector.test.ts
git commit -m "feat: add Nano preparation option"
```

### Task 4: Integrate live-chat author recovery, child menu, and fresh-message priority

**Files:**
- Modify: `src/content/chromium-ai-adapter.ts`
- Modify: `src/content/controller.ts`
- Modify: `src/content/index.ts`
- Modify: `src/content/youtube-live-chat.ts`
- Modify: `src/content/element-menu.ts`
- Test: `tests/dom/content-entry.test.ts`
- Test: `tests/dom/page-jobs.test.ts`
- Test: `tests/dom/youtube-live-chat.test.ts`
- Test: `tests/dom/retranslation.test.ts`

**Interfaces:**

```ts
export type LiveChatMessage = Readonly<{ source: HTMLElement; authorId?: string }>;

export type YouTubeLiveChatSession = Readonly<{
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
  authorId(source: HTMLElement): string | undefined;
  isMessage(source: HTMLElement): boolean;
}>;
```

- [ ] **Step 1: Write failing integration tests**

```ts
it("opens only the language menu in a child live-chat frame", async () => {
  const app = createContentApp(document, { controller, loadSettings: async () => SETTINGS, isTopFrame: () => false, isTrustedEvent: () => true });
  message.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  message.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", ctrlKey: true, shiftKey: true, bubbles: true }));
  expect(controller.openElementMenu).toHaveBeenCalledWith(message);
  expect(controller.translateTarget).not.toHaveBeenCalled();
  app.destroy();
});

it("reuses a fixed source only for later messages from the selected author", async () => {
  authorOneChoice.setLanguageOverride({ source: "hi", target: "ko" });
  await controller.retranslate(authorOneChoice, { source: "hi", target: "ko" });
  appendMessage(items, { author: "/channel/one", text: "namaste" });
  appendMessage(items, { author: "/channel/two", text: "namaste" });
  await flushMutations();
  expect(requests).toContainEqual(expect.objectContaining({ source: { kind: "fixed", language: "hi" } }));
  expect(requests).toContainEqual(expect.objectContaining({ source: { kind: "auto" } }));
});

it("processes a new message before historical queued messages", async () => {
  const first = deferred<void>();
  const session = createYouTubeLiveChatSession({ document, translate: (source) => source.textContent === "old" ? first.promise : Promise.resolve() });
  items.append(messageRenderer("old"), messageRenderer("older"));
  await session.start();
  items.append(messageRenderer("new"));
  first.resolve();
  await flushMutations();
  expect(translated).toEqual(["old", "new", "older"]);
});
```

- [ ] **Step 2: Run the focused integration tests and confirm failure**

Run: `bunx vitest run tests/dom/content-entry.test.ts tests/dom/page-jobs.test.ts tests/dom/youtube-live-chat.test.ts tests/dom/retranslation.test.ts`

Expected: FAIL because child frames ignore all shortcuts, selections are not author-scoped, and history is queued before new messages.

- [ ] **Step 3: Implement integration with strict precedence**

In `createContentApp`, install pointer tracking and the menu shortcut in child frames, but keep the translation toggle disabled when `isTopFrame()` is false. In `createTranslationController`, resolve source in this order: explicit element menu choice, selected author's session language, global fixed setting, automatic source detection including Nano. `retranslate` records a fixed live-chat choice under its stable `#author-name[href]` URL; `auto` clears that author's choice. Do not create an author entry if the renderer or URL is absent.

Change initial live-chat traversal to append history and mutation traversal to prepend new entries while retaining DOM order. Keep one active translation and the existing 100-entry cap; when a new entry makes the queue exceed the cap, discard the oldest history entry at the tail.

Add `gemini-nano: "Gemini Nano (experimental)"` to menu provenance labels. Keep the menu host fixed-positioned and do not add an inline view.

- [ ] **Step 4: Run integration verification and targeted lint**

Run: `bunx vitest run tests/dom/content-entry.test.ts tests/dom/page-jobs.test.ts tests/dom/youtube-live-chat.test.ts tests/dom/retranslation.test.ts && bunx biome check src/content tests/dom/content-entry.test.ts tests/dom/page-jobs.test.ts tests/dom/youtube-live-chat.test.ts tests/dom/retranslation.test.ts && bunx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the live-chat integration**

```bash
git add src/content/chromium-ai-adapter.ts src/content/controller.ts src/content/index.ts src/content/youtube-live-chat.ts src/content/element-menu.ts tests/dom/content-entry.test.ts tests/dom/page-jobs.test.ts tests/dom/youtube-live-chat.test.ts tests/dom/retranslation.test.ts
git commit -m "feat: recover live chat source languages"
```

### Task 5: Verify feasibility, document limits, and release the build

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `PRIVACY.md`
- Modify: `docs/verification/2026-07-10-runtime-audit.md`
- Test: `tests/unit/brand-assets.test.ts`

- [ ] **Step 1: Add documentation assertions and a manual acceptance checklist**

Add assertions that the English and Korean READMEs state: Nano assistance is opt-in, experimental, on-device, not a translator, requires explicit preparation, and lacks guaranteed romanized Hindi/Urdu support. Add privacy text that bounded text and nearby context can be passed only to the Chrome-resident Nano model and are not transmitted or retained after the tab session.

Add the following manual gate to the runtime audit:

```markdown
1. Enable Experimental live-chat language assistance and click Prepare in Options.
2. Confirm the options status reaches Ready without a network request carrying chat text.
3. Run page translation on YouTube Live Chat; verify a supported normal message uses hover-only translation.
4. Use the configured menu shortcut over a romanized message, select Hindi, and verify later messages from that author use Hindi while another author's messages remain automatic.
5. Restore the page; confirm hover translation and author choices no longer apply.
6. Disable network after preparation and repeat a supported local translation.
```

- [ ] **Step 2: Run documentation and complete automated verification**

Run: `bunx vitest run && bunx tsc --noEmit && bunx biome check src tests scripts vitest.config.ts && bun run build && git diff --check`

Expected: all tests, type check, scoped Biome, build, and whitespace validation pass.

- [ ] **Step 3: Run the Nano feasibility gate in installed Chrome**

Reload the unpacked `dist` extension. In Options, explicitly enable and prepare Nano. If preparation and one offscreen structured detection succeed, capture the observed status and continue the manual acceptance checklist. If either call fails because of Chrome capability or activation rules, leave Nano disabled, document the observed limitation in the runtime audit, retain per-author manual recovery, and do not claim Nano availability.

- [ ] **Step 4: Commit documentation and release evidence**

```bash
git add README.md README.ko.md PRIVACY.md docs/verification/2026-07-10-runtime-audit.md tests/unit/brand-assets.test.ts
git commit -m "docs: document chat language recovery"
```

## Plan self-review

- Spec coverage: Task 1 covers opt-in setting parsing, safe Nano output, and author memory. Task 2 covers the extension-owned offscreen boundary and feasibility gate. Task 3 covers explicit user activation and progress. Task 4 covers normal-message-only routing, per-author recovery, hover-only UI, and current-message priority. Task 5 covers privacy, limitations, automated checks, and actual Chrome use.
- Placeholder scan: no `TBD`, `TODO`, or unbounded implementation step remains.
- Type consistency: Nano decisions flow from `NanoLanguageDetector` through `AiAdapter.detectWithNano`, while author state is `LiveChatLanguageMemory`; each later task uses these exact names.
