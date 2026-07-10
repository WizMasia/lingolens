# Local Page Translator Runtime Audit

## Environment

- Google Chrome: 149.0.7827.201 detected locally.
- Extension build: `dist/` produced from `codex/local-page-translator`.
- Automated Chrome control: unavailable because the installed ChatGPT Chrome Extension did not establish a browser-control session, despite Chrome and the helper extension being installed and enabled.

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

## Outstanding Manual Evidence

Chrome must still be used to load `dist/` unpacked and verify native API exposure in the content-script isolated world, first-use model download/user activation, real translation output, popup persistence, offline reuse, and screenshots of popup/options/inline/hover surfaces.
