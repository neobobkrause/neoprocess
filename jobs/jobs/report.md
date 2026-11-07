JOBS #1 · N2 · layer 3 · module jobs · completion 2: the review's three gaps (BOB #3's CHANGE, K15)

1. R5: `job reopen` on a COMPLETE job returns it to WORKING on the same branch and PR, clears its owed comment and ready, appends the CHANGE to its START, and prints `update_pull_request` with draft true; only a merged job gets a fresh branch and PR.
2. R6: a routed successor's `job start` prints its brief and the START without the whole-module read line; its reading set is what the brief names (the brief and the branch's diff against the tranche, measured), and attempts.md records that set's bytes.
3. R7: `job retire --unmeasured " "` refuses, as `job archived` does.
JOB-LIFE.md §7 and §9 say the same. Planning has not merged: the plan reading stays jobs' own until BOB says MERGED.

Not done: nothing. While working I ran only the module's tests and the checks scoped to jobs.

**Elsewhere** · none

**Met** · none

**Evidence**
- `node --test tools/test/jobs.test.mjs` → tests 11, pass 11
- `node checks/run.mjs . --module jobs --base 7337ea3` → format, architecture, coverage (10 of 10), fixtures, ownership: 0 failures each
- tools/jobs.mjs:490 (R5: a COMPLETE job re-opened on its own PR)
- tools/jobs.mjs:303 (R6: a successor's set from its brief)
- tools/jobs.mjs:534 (R7: an empty --unmeasured refused)

Tests: 11/11 (the module's own suite, 30 s). Checks here: ownership, format: no new finding; the rest is the gate's.
Self-review: approved (proc-self-review-jobs.md).
Size: test runs 2, module lines 674. Head 8af5f9a.