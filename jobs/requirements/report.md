REQUIREMENTS #1 · N2 · module requirements · entries N2-13, N2-14, N2-15

**Met** · R1, R2, R3, R4, R5, R6, R7, R8

What changed:
- `tools/requirements.mjs` is new. It holds `parse` (both parts, ids live and retired, and findings for a missing or out-of-order section, a statement with no id, or a duplicate id), `serviceBlocks`, `usesOf`, `marks`, `strike`, `isMeasurement` with `fixtureLimit` and `MEASUREMENT_RULE`, `readingSet`, `budgetOf` and `overrun`. The code comes out of `tools/proc.mjs`.
- `readingSet(R, m, table)` measures the set against floor(window × fraction × bytesPerToken), using the table its caller passes (K19). It throws when there is no table. It returns `budget`, `over` and `trimmed`. The summary path is gone (SES-7).
- In the legacy file `tools/proc.mjs`: `MODULE_SET` (a byte literal) is replaced by `SET_TABLE` = { window 1,000,000 (or NEO_CONTEXT_WINDOW), fraction 0.15, bytesPerToken 3 } (K19, until N2-31). When a set is over budget, `layer start` writes `jobs/<m>/overrun.md` on the state branch and refuses. `job complete` strikes the marks through `strike`. The review brief now carries `MEASUREMENT_RULE`. `usersOfChange` reads Uses through `usesOf`.
- Legacy tests: I removed the hooks test of the summary path, because that behaviour is gone. I added one assertion to proc.test: the review brief contains the measurement rule.

For BOB:
- The format check's refusal of a measurement Test line, and its call to `parse`, belong to architecture (its R6, N2-45). This module provides `isMeasurement`, `parse` and `fixtureLimit`.
- SESSIONS.md §6.3 still describes the summary remedy and a 40 KB limit. That file is the sessions module's (N2-31), so I did not change it.
- The over-budget refusal in `layer start` is legacy code. The suite proves `readingSet`'s `over` flag and `overrun`, but no layer-start test reaches that refusal.

**Evidence**
- `node --test tools/test/requirements.test.mjs`: tests 9, pass 9, fail 0.
- `node checks/ownership.mjs . requirements 023621c HEAD`: 0 failures; proc-legacy: 15 lines added, 112 removed.
- `node checks/run.mjs .`: format 0 failures (12 requirements files); architecture 0; coverage 0 (38 of 116 live ids named); fixtures 0.
- Self-review against R1 to R8 (K14) is done. Following BOB's CHANGE, the whole suite was not run here; the gate in `job complete` runs it. A partial run stopped early had 146 ok and 0 not ok.

Tests: 9/9. Checks: format, architecture, coverage, fixtures, ownership: no new finding.
Size: test runs 1, module lines 201. Head d35fcdb.