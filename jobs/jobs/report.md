JOBS #1 · N2 · layer 3 · module jobs

Entries applied: N2-19, N2-20, N2-21, N2-22, all four.
- N2-19: `tools/jobs.mjs` takes from `tools/proc.mjs` layer start; job pr, started, route, start, state, complete, takein, posted, reopen, retire, archived; defect; with the job line's parser and writer, the START, the session call, the start self-check, the evidence forms (moved from `tools/lib.mjs`, which re-exports them) and its own command table. `layer start` now measures every module's set before it makes any branch. The START has an `Acts:` line naming only the job's commands; a test reads them back against `COMMANDS`.
- N2-20: `job route` briefs a successor from the branch and the pull request (`jobs/<m>/route.md`, at most 4 KB: tip, PR, state, commits since the tranche), and that session's `job start` prints the brief. It prints no archive, refuses a version argument, and at a declared stop reads the plan's choice: `abandoned` gets no successor and no message, and its own start and completion refuse.
- N2-21: `job complete` no longer runs the gate in the session. Without `--review-file` it prints the reviewer's brief for the job's own whole change and completes nothing. That brief is `reviewBrief`, which `review decide` now uses too. It refuses a result naming gaps. Then it runs here only ownership, format and the module's own suite, the suite only when the job line's `**Suite**` time says the last run took under a minute. Each is judged against the base, so a red the tranche already had is inherited. It also refuses a committed generated artifact, and a report without `**Elsewhere**`.
- N2-22: `status` (BOB's queue) lists `STALE <m>` for a job WORKING with nothing pushed for an hour (`staleJobs`). Each attempt's reading set is a line in `jobs/<m>/attempts.md` at its start, and each attempt's row names it (`attempt <NAME> · reading <bytes>`). `job retire` is now a record line (ARCHIVED, `**Retired**`) plus that row; it calls and prints no classifier act. The row is measured only from `--usage`, otherwise it is named unmeasured: no act in the platform table returns usage.
- JOB-LIFE.md §3, §8, §9 and §11 say the same.

How later modules' services are reached: jobs imports only platform, record and requirements. The legacy tool passes in the services of modules not yet extracted, through `wire`: the lane-aware plan edit, open asks, process freshness, gate-neutral files, artifact regeneration, the archived tranche id. Each one's absence is handled where it matters (retire refuses without the asks; complete asks for the tranche to be merged in when it cannot read which files are neutral). `planning` is not imported yet (`tools/planning.mjs` is being written by its own job in this layer). The stop record is read through record's `parsePlan`, and plan entries by jobs' own reader.

Not done: nothing.

**Elsewhere** · Legacy test call sites in `tools/test/proc.test.mjs` and `hooks.test.mjs` were rewired to the new forms through `jobs.mjs` names, under the legacy rule. `hooks.mjs` now builds a routed successor's expected call with its brief (no hook is wired). Nothing found in another module's requirements.

**Met** · R1, R2, R3, R4, R5, R6, R7, R8, R9, R10

**Evidence**
- `node --test tools/test/jobs.test.mjs` → tests 11, pass 11
- `node --test checks/test/*.test.mjs tools/test/*.test.mjs` → tests 359, pass 359
- `node checks/run.mjs . --module jobs --base 7337ea3` (after the tranche, with gate merged, was merged in) → format, architecture, coverage (10 of 10 live ids named by a test), fixtures, ownership: 0 failures each; proc-legacy 42 lines added, 378 removed
- tools/jobs.mjs:189 (layer start: every set measured before any branch)
- tools/jobs.mjs:411 (job complete: the job's own review first)

Tests: 11/11 (the module's own suite, 29 s). Checks here: ownership, format: no new finding; the rest is the gate's.
Self-review: approved (proc-self-review-jobs.md).
Size: test runs 1, module lines 659. Head 2faba29.