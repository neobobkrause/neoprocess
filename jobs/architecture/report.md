ARCHITECTURE #1 · N2 · module architecture · second completion: the five review gaps (K15, K23)

**Met** · R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11

Fixes, in the review's order:
1. R1: in `modules(R)` an id that is missing, invalid or given twice, a layer that is not a positive integer, and an empty map are architecture findings. None is skipped, and each carries the module's line in build/modules.json (`moduleLines` in checks/lib.mjs; a one-line map gives line 1). The format check no longer repeats them.
2. R2: a scoped run with no `base` runs ownership against the tranche, reading origin's ref first as the gate does. With no tranche at all, ownership is a `not-run` finding and the run answers `ok: false`. The result's `base` names the base that was used.
3. R4: `later-import`, `undeclared-import` and `not-product-import` carry the line their specifier stands on (`importLines`; comments are blanked with their line breaks kept). The map findings of architecture and format carry the module's line.
4. R10: `loadOpNames` imports the op declarations from the commit. It writes the file and the relative imports it reaches, as committed, to a scratch directory and imports them from there. An uncommitted edit leaves the findings unchanged, and the edit is read once committed.
5. R10: coverage's `jobStarted` reads the module's job line on the state branch at origin's state ref, never a local or remote job branch. The test now has a local `job/a` and `origin/job/a` start nothing, and a state-branch line does.
Also R6 per K23's wording: a live job is any state but MERGED or ARCHIVED, so COMPLETE and REOPENED now keep an entry pending; tested.

**Evidence**
- `node --test` on checks.test, channels.test, words.test, model.test, cert.test and fixtures.test: tests 212, pass 212, fail 0.
- `node checks/run.mjs . --module architecture --no-fetch`: format, architecture, coverage (11 of 11), fixtures, ownership (default base origin/tranche): 0 failures each.
- Self-review against R1 to R11 and the five gaps (K14): done.

Tests: 212/212. Checks: no new finding.
Size: test runs 4, module lines 2928. Head 1c0b86a.

Tests: 155/155. Checks: format, architecture, coverage, fixtures, ownership: no new finding.
Size: test runs 2, module lines 14103. Head 1c0b86a.