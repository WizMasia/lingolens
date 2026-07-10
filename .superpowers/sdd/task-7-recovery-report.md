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
