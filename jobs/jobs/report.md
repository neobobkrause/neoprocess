JOBS #1 · N2 · layer 3 · module jobs · completion 3: wired to planning (BOB #3's MERGED, planning at 021a6ff)

- tools/planning.mjs now gives jobs the plan as planning reads it: `tranche` (the tranche id and text, replacing jobs' own reader), `entries` (a module's entries in a layer), `planSections`, and `trancheId` (the archived tranche between rounds, for `defect`; the wired stand-in is gone).
- `layer start` carries planning's change to the legacy one (PLN-8): naming modules in a layer not yet started needs `--reason`, and the subset is recorded on the plan by `partial`. Tested under R1.
- Not wired, and why: `place` puts new work into the plan (BOB's act), and jobs places nothing itself. Planning has no reader of the stop record (its `stop` writes through record), so jobs keeps reading the stop's choices with record's `parsePlan`.
- Merge of origin/tranche: one conflict in tools/proc.mjs's imports, resolved to planning's imports plus jobs' block; nothing else of the moved job code had changed.

Not done: nothing. I ran only the module's tests and the checks scoped to jobs.

**Elsewhere** · none

**Met** · none

**Evidence**
- `node --test tools/test/jobs.test.mjs` → tests 11, pass 11
- `node checks/run.mjs . --module jobs --base 021a6ff` → format, architecture (8 relative imports), coverage (10 of 10), fixtures, ownership: 0 failures each; proc-legacy 42 lines added, 380 removed
- tools/jobs.mjs:18 (the planning import)
- tools/jobs.mjs:174 (a layer started in part)

Tests: 11/11 (the module's own suite, 32 s). Checks here: ownership, format: no new finding; the rest is the gate's.
Self-review: approved (proc-self-review-jobs.md).
Size: test runs 3, module lines 668. Head ea9bd47.