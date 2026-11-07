REQUIREMENTS #1 · N2 · module requirements · second completion: the seven review fixes (K15, K20)

**Met** · R1, R2, R3, R4, R5, R6, R7, R8

Fixes, in the review's order:
1. R2: every bold name on a header line is now a service name, through the new `headerNames`. That covers names joined by ` · `, by a comma, or by ` / `; a name in brackets (a parameter or a returned field) is not one. This module's own blocks now read parse; marks, strike; isMeasurement; readingSet. Record's read stateRead, stateList, stateWrite.
2. R1: `parse` places each statement in the block it sits under, by position. The review's case gives b the ids R2 and R5. `serviceBlocks` keeps the issue-78 rule for what a job is charged.
3. R3: `strike` and `marks` act only on the statement whose own id leads the line (`- **R<n>**`). A line that cites a struck id in bold keeps its mark. `parse` counts only a statement's own id, so a citation is never a duplicate.
4. R4: only a count the line names as rows, records, elements, items, entries, documents, bundles, users or events is compared with the limit. Both of the review's lines now read false.
5. R4: deployed, production, staging or live counts only as a figure taken on such a copy ("on/against/in/from the … copy", with a number). The review's `deployed` field line now reads false.
6. R5: the measure now counts the whole set. It counts the START, or before it exists the module's entries from the plan, which the START carries (`readingSet(R, m, table, start)`). It counts the requirements, the layer row, and each used module's Purpose and named services, or all its Provides when the Uses line names none (K20). It counts the module's code and the tests that name an id its entries change. Test material (the module's tests and everything under its test files' directories, such as fixtures) is not counted as code.
7. R5: `job start` now measures the set before it writes WORKING. Over budget, it writes `jobs/<m>/overrun.md` and refuses, and the job stays STARTING. A new proc.test case reaches both refusals: layer start, then job start after the set grows.

For BOB, measured just now on the tranche with K19's table (450,000 bytes): every module is under budget except **maintenance, at 538,054 bytes**. Its paths are documents (`lane-neoprocess/`, `rulebooks/`, `REQUIREMENTS.md`, `HISTORY.md` and others), all counted as its code. Its layer start (layer 5) will refuse until it is trimmed or split, as REQ-6 means it to. Architecture is 388,981 bytes; it would have been 1.2 MB if its test fixtures counted as code.

**Evidence**
- `node --test tools/test/requirements.test.mjs`: tests 9, pass 9, fail 0.
- `node --test --test-name-pattern='over its budget|job.s life|issue 93' tools/test/proc.test.mjs`: pass 3, fail 0.
- `node checks/ownership.mjs . requirements 6b0e2b4`: 0 failures; proc-legacy: 36 lines added, 112 removed.
- `node checks/run.mjs .`: format, architecture, coverage and fixtures each 0 failures.
- Self-review against R1 to R8 (K14): done.

Tests: 9/9. Checks: format, architecture, coverage, fixtures, ownership: no new finding.
Size: test runs 2, module lines 257. Head f483bb2.