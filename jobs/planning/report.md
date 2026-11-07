PLANNING #1 · run 3 · module planning · entries N2-16, N2-17, N2-18

**Met** · R1, R2, R3, R4, R5, R6, R7, R8, R9, R10

The review's nine (K15, on f0b3af5), each fixed in f0e77af and tested in tools/test/planning.test.mjs:
1. R3: round open refuses while the current plan exists, whatever its layers read ("its layers are closed but build/plan/current.md is not archived").
2. R3: round close with no --next takes a next.md titled for this tranche first, the completion file only when none waits.
3. R5: the Status line reads exactly `· STOPPED <why> · <version>` and `· RESUMED <version>` (durable plan; the state branch's through record).
4. R5: round open and close keep the tranche's Status line and its pin; tested with a round plan naming another pin (status pin stays abc1234).
5. R6: a layer started in any earlier round of the tranche counts as started; its module's found work goes to the completion round (new test).
6. R7, R2: an entry placed as a CHANGE is also written to the plan under its module.
7. R7: gate runs per merged job are read from the gate's recorded runs (`--gate-runs`, as read from CI's run list) or named unmeasured per job; never counted from commits.
8. R2: tranche close refuses while a completion file (b17a2b7) or a next.md titled for this tranche waits (now both, tested).
9. R9: `within` compares real paths (links followed); a link in the product pointing outside is refused (tested).

Self-review (K14) against every requirement: the gate-runs figure also takes the command line's JSON. One flaw found outside the module, reported to BOB: record's pinOf does not read the exact `RESUMED <version>` form from the durable plan, so after an epoch closes the resumed pin is not seen (record, completion round).

**Evidence**
- `node --test tools/test/planning.test.mjs` → tests 13, pass 13, fail 0
- `node --test --test-name-pattern="a tranche opened from main" tools/test/proc.test.mjs` (proc-legacy's tranche test, which awaits planning) → pass 1, fail 0
- tools/planning.mjs:47 (within on real paths), tools/planning.mjs:171 (round close: next.md for the tranche before the completion round)

Tests: 13/13. Checks: format, architecture, coverage, fixtures, ownership: no new finding.
Size: test runs 3, module lines 608. Head f0e77af.