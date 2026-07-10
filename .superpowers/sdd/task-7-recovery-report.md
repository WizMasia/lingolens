# Task 7 Recovery Report

## Scope

Recovered the interrupted full-page translation Task 7 work without resetting its
uncommitted changes. The completed scope covers bounded page jobs, controller
page translation/restoration state, active-record stale detection, and focused
regressions.

## Runtime debugging evidence

The failing scenario was reproduced with:

```text
bun test tests/dom/page-jobs.test.ts tests/dom/stale-content.test.ts
Expected: "stale"
Received: "translated"
```

Three hypotheses were evaluated:

1. The document observer did not receive mutations within an open ShadowRoot.
   A no-edit delivery probe observed `documentDeliveries: 0` and
   `shadowDeliveries: 1` for a changed text node in the active record.
2. Mutation-to-record lookup did not cross the root boundary. The same probe
   showed `sourceContainsMutationTarget: true`, so lookup succeeds when the
   ShadowRoot observer delivers the mutation.
3. The record fingerprint omitted the changed source. The fingerprint probe
   established that the supported target is the element inside the open root;
   its source text is refreshed and compared correctly once a mutation arrives.

Root cause: `createActiveRecordObserver` observed only `document`. DOM mutation
observers do not deliver ShadowRoot descendants through document observation, so
the stale transition was never considered.

## Fix

`src/content/stale-records.ts` now keeps one observer while records are active
and additionally registers every active record's open ShadowRoot. Repeated
`sync()` calls register roots added after document observation has begun. The
root set resets on disconnect so restoration and destruction release all
observation state.

The original focused test stayed red before the code change. A second regression
was added for a translated source in a ShadowRoot that is introduced after an
ordinary document record has already started observation. Before the fix, both
tests failed with `translated`; after the fix, the focused suite reported:

```text
17 pass
0 fail
30 expect() calls
```

## Task 7 behavior covered

- `runPageJob` caps concurrent workers at three, records translated/skipped/
  failed outcomes, reports terminal progress, keeps peers running after one
  failure, and does not claim queued targets after cancellation.
- The controller cancels prior page jobs, preserves a stable target list per
  run, publishes `TabState`, restores synchronously, and ignores late results
  from a cancelled job.
- Existing inline blocks update without duplication; newly inserted page content
  participates only in a later explicit run.
- Active translations become stale after page-owned source changes, preserve
  their stale inline notice, ignore extension-owned UI mutations, and remove
  disconnected records.
- Active records in initial and dynamically added open ShadowRoots now receive
  stale detection.

## Final verification

Commands run after the final source edit:

```text
bun test                         # 106 pass, 0 fail
bunx tsc --noEmit                # exit 0
bunx biome check .               # exit 0
bun run build                    # exit 0
git diff --check                 # exit 0
```

The manual source audit found no `any` annotations, assertions, non-null
assertions, TypeScript suppression directives, debug statements, or whitespace
errors in the Task 7 files. The no-excuse helper itself could not resolve its
own `typescript` package from the external skill directory, so this audit was
performed with its equivalent pattern checks plus TypeScript and Biome.

All changed Task 7 source files are at or below 250 non-blank, non-comment
lines. `src/content/hover-view.ts` is exactly 250 lines after the Task 7
interface addition.

## Cleanup

The temporary `.debug-journal.md` is removed before the Task 7 commit. No debug
instrumentation, temporary scripts, or background processes were introduced.

## Review recovery: late retranslation and hover inspection

The review found two lifecycle holes after the original Task 7 commit.

### RED evidence

```text
bun test tests/dom/page-jobs.test.ts tests/dom/stale-content.test.ts
17 pass
2 fail
```

1. A translated record was retranslated, `restorePage()` cleared the store, and
   the pending engine promise then resolved. The new regression received
   `store.active.length === 1`, proving the old record completed and re-entered
   the active set after restoration.
2. A hover source received a normal child-list mutation whose final source
   fingerprint remained unchanged. The regression received `"Hello"` after a
   subsequent hover where it expected `"안녕하세요"`, proving the inspection
   restorer had removed the hover entry and its listeners.
3. The first failure was not caused by active page-job publication: the case
   uses the element retranslation path directly and still reproduced after the
   restore returned idle. The late commit was therefore owned by
   `executeTranslation`, not by `PageController` state publication.

### GREEN fix

- `RecordStore.has(record)` now verifies that a record is still the current
  store-owned record for its source. `executeTranslation` checks this identity
  immediately after the engine promise resolves or rejects, before cancelled
  recovery, success, stale, error, rendering, or announcement paths can mutate
  the orphaned record.
- Hover view lifecycle handling now treats `inspect` as temporary text
  restoration only. Terminal lifecycle reasons still remove listeners, action
  UI, tabindex ownership, and the entry.

The focused regressions then passed:

```text
19 pass
0 fail
35 expect() calls
```

### Final verification after review recovery

```text
bun test                         # 108 pass, 0 fail
bun run check                    # exit 0
bun run build                    # exit 0
git diff --check                 # exit 0
```

The changed TypeScript source and focused tests were also searched for
`any`, TypeScript suppression directives, non-null assertions, and debug
logging; no forbidden escapes were found. The two focused regressions prove
that a completed restore leaves no active records or translation UI after the
pending promise settles, and that an unchanged-source observer inspection keeps
hover translation available for a later pointer entry.

## Review recovery: explicit concurrency cap

The final review identified that `runPageJob` normalized a requested worker
count only to a minimum of one. A caller could therefore request four workers,
which violated Task 7's three-worker upper bound.

### Runtime debugging audit

1. The default worker configuration might already be unsafe. The existing
   default-concurrency regression passed, so the default value remained bounded
   at three.
2. A caller-provided value might bypass the worker limit. A direct
   `runPageJob(..., 4)` reproduction peaked at four active workers, isolating
   the fault to the job runner rather than the controller.
3. The worker pool length might not be the actual scheduling limit. After the
   clamp, the same direct reproduction and the controller-focused page suite
   passed, confirming the pool length is the operative concurrency boundary.

### RED evidence

The new focused regression calls `runPageJob` with `concurrency: 4` and tracks
the maximum number of active async workers. Before the source edit:

```text
bun test tests/dom/page-jobs.test.ts
Expected: <= 3
Received: 4
9 pass
1 fail
```

### GREEN fix and verification

`src/content/jobs.ts` now normalizes the worker count with a lower bound of one
and an upper bound of three. The regression uses production scheduling rather
than mocks and confirms that an explicit value above three cannot start more
than three workers.

```text
bun test tests/dom/page-jobs.test.ts tests/dom/stale-content.test.ts
20 pass, 0 fail

bun test
109 pass, 0 fail

bun run check
exit 0

bun run build
exit 0

git diff --check
exit 0
```
