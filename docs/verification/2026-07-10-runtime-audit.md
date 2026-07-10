# Local Page Translator Runtime Audit

## Environment

- Google Chrome: 149.0.7827.201 detected locally.
- Extension build: `dist/` produced from `codex/local-page-translator`.
- Automated Chrome control: unavailable because the installed ChatGPT Chrome Extension did not establish a browser-control session, despite Chrome and the helper extension being installed and enabled.
- Automated regression suite: 129 tests across 20 files, 228 assertions.
- Headless unpacked-extension smoke test: Chrome accepted `dist/` and started `chrome-extension://fignfifoniblkonapihmkfakmlgkbkcf/service_worker.js`.

## Hypothesis 1: Model initialization loses visible progress

**Risk:** A first-use detector or translator download begins in the content script but the popup remains idle.

**Evidence:** `tests/unit/chromium-ai-adapter.test.ts` observes native `downloadprogress`; `src/content/index.ts` maps each progress event to a `tab-state` message with phase `downloading`; `tests/unit/background.test.ts` proves the background stores the sender tab's latest state; `tests/dom/popup.test.ts` proves the popup renders a state returned by the coordinator without zero-total arithmetic failure.

**Result:** The progress path is covered end-to-end at typed boundary level. A real first-use model download still requires the blocked Chrome manual pass.

## Hypothesis 2: Hover or inline restoration corrupts nested page text

**Risk:** Temporary replacement or restoration loses nested text, attributes, or later page-owned edits.

**Evidence:** `tests/dom/views.test.ts` verifies exact multi-node restoration, keyboard and pointer lifecycle, restoration during destroy, preservation of page-owned changes, and changed-source baselines. `tests/dom/records.test.ts` verifies snapshots and injected attribute ownership. `tests/dom/stale-content.test.ts` verifies synchronous page restoration and observer behavior. The manual fixture contains nested emphasis and link text for the pending real-browser pass.

**Result:** Automated DOM runtime tests pass for original-text and attribute ownership. Real CSS/layout behavior remains part of the blocked Chrome visual pass.

## Hypothesis 3: Cancelled or restored work leaves late translation UI

**Risk:** A pending full-page or per-element promise resolves after restoration and resurrects a translation block.

**Evidence:** `tests/dom/page-jobs.test.ts` verifies active full-page translation cannot render after synchronous restoration and pending retranslation cannot resurrect records. `tests/unit/page-jobs.test.ts` verifies cancellation stops queued work and caps concurrency at three. `tests/dom/stale-content.test.ts` verifies restored hover content remains restored.

**Result:** Pending work is identity-checked and cancelled work does not republish UI in automated runtime tests.

## Hypothesis 4: Excluded descendant text leaks into local AI or hover replacement

**Risk:** A visible parent contains hidden, editable, code, or other excluded descendants, but those descendants are still sent to the detector/translator or temporarily overwritten.

**Evidence:** `src/content/targets.ts` now exposes one filtered text-node collector shared by target discovery and element snapshots. `tests/dom/targeted-translation.test.ts` verifies request text and automatic-detection context omit code, hidden, and editable descendants. `tests/dom/views.test.ts` verifies hover replacement leaves each excluded descendant unchanged.

**Result:** Translation requests, detection context, and hover mutation use the same safe-text contract.

## Hypothesis 5: Overlapping requests corrupt per-element state

**Risk:** Full-page translation, trigger translation, or explicit retranslation overlaps for one element and causes an invalid lifecycle transition or lets an older result overwrite a newer choice.

**Evidence:** `src/content/records.ts` assigns an element-local attempt version. `src/content/translation-attempt.ts` ignores completion and error paths from superseded attempts. `tests/dom/targeted-translation.test.ts` resolves two overlapping requests out of order and proves the latest explicit result remains committed.

**Result:** Same-element translation is last-request-wins without invalid state transitions.

## Hypothesis 6: Worker suspension loses popup state

**Risk:** Manifest V3 suspends the background worker, erasing its in-memory state map and making the popup incorrectly report idle.

**Evidence:** `src/background.ts` asks the active tab's content script for `get-tab-state` when no cached state exists and falls back to idle only when that script is unavailable. `tests/unit/background.test.ts` covers both recovery and unavailable-content behavior.

**Result:** Popup state can recover after a service-worker restart.

## Hypothesis 7: Shadow DOM hover events select the host

**Risk:** Browser event retargeting hides the actual open-shadow descendant, so the configured trigger translates the wrong element or no element.

**Evidence:** `src/content/index.ts` selects the first `Element` in `event.composedPath()` before falling back to `event.target`. `tests/dom/content-entry.test.ts` proves the helper returns the shadow paragraph rather than its host.

**Result:** Open-shadow hover targeting follows the composed event path.

## Hypothesis 8: Unknown automatic source leaves no recovery action

**Risk:** A first translation attempt has insufficient detection confidence, but no result UI exists yet, leaving the user unable to select an explicit source language.

**Evidence:** Inline and hover error rendering now mount a language-action surface even without a prior successful translation. `tests/dom/unknown-source-action.test.ts` verifies the first unknown-source response displays the local error and opens the per-element language menu.

**Result:** Low-confidence automatic detection has an immediate explicit-language recovery path.

## Build and visual evidence

- `bun test`, `bunx tsc --noEmit`, `bunx biome check .`, `bun run build`, and `git diff --check` passed on the audited revision.
- Every production TypeScript file remains at or below 250 non-blank, non-comment lines.
- Source audit found no `any`, TypeScript suppression, non-null assertion, remote URL, dynamic evaluation, or unsafe HTML assignment in production TypeScript.
- Popup and options build HTML/CSS were rendered through Chrome at 380×480 and 980×900. Both surfaces showed readable Korean text, visible controls, no clipping, and no overlapping layout. The popup included active display-mode and target-language status.
- Direct headless navigation to extension HTML returned Chromium's development-extension content-verification error, so those screenshots used the exact built HTML/CSS through Chrome document injection. Extension loadability was independently proven by the running service worker.

## Outstanding Manual Evidence

An interactive Chrome session must still verify native API exposure in the content-script isolated world, first-use model download/user activation, real translation output, popup persistence, offline reuse, and inline/hover behavior on a live page. Automated browser control cannot currently attach to the user's Chrome session, and the headless environment cannot provide a trustworthy installed-model/offline acceptance pass.
