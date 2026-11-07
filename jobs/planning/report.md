PLANNING #1 · N2 layer 3 · module planning · entries N2-16, N2-17, N2-18

**Met** · R1, R2, R3, R4, R5, R6, R7, R8, R9, R10

What changed. `tools/planning.mjs` (new) takes from proc-legacy tranche open/carry/close/merged, round open/close, footprint, ruling, the plan's title reader (`tranche`, `trancheId`, `archivedTranche`); it adds `stop` and `resume` (through `record.stop`/`record.resume`, mirrored in the durable plan's Status line so the pin outlives the epoch), `partial` (a layer started in part, its modules and reason under the layer's heading; `proc layer start --modules a,b --reason "…"` records it when the layer is not yet started), `place` (the running job as a CHANGE, else the START of a layer not started, else the completion round; `--defer bob|deployment|measurement|outside` to next.md with `hard reason:` as the format check reads it), `report` (the tranche report) and `planFindings` (a plan's shape: title, layer sections, size, entries in module groups of that layer, a hard reason P19 gives, each cited canon id cited by the module's requirements file through `requirements.parse`). `tranche open` now copies `build/plan/next.md` from main whole (its pin in the Status line, its legacy census before the first layer); `tranche close` refuses while an entry's module is not merged, and writes `build/plan/archive/<T>-report.md` (each entry's outcome, the usage) into the close PR. Every path a caller names is refused outside the product's repository (`within`).

Per K29, `tranche open` imports platform's `grantsHeld` and architecture's words check, and `tranche close` architecture's whole-product `run` (at HEAD and at the tranche's base, a finding the base had not this close's); both are async now. What the close needs from later modules (the open asks, the artifacts' regeneration) is passed in as `deps`, refused when not given.

proc-legacy: `tools/proc.mjs` imports and re-exports planning; `PLANNING_DEPS` (the open asks, `regenerate`) and the `tranche close` wrapper; `layer start --modules … --reason` records a part; the commands `tranche report`, `stop`, `resume`, `place`; 13 lines added, 228 removed. `tools/test/proc.test.mjs`: the tranche test opens from next.md and awaits planning's open and close (its plan-file refusals moved to planning's tests); 14 added, 14 removed.

Run 2, after BOB's CHANGE (self-review against every requirement, K14): R2's "only when every round is archived" had a gap: an unrun completion round file did not stop the close. Now `tranche close` refuses while `build/plan/<T>-completion.md` exists (tested in R2). Each `*(not yet met: N2)*` mark is struck (f0b3af5). From this run only the module's tests and its scoped checks are run in-session.

Reports sent: REPORT (N2-23a and ARC-5; parse and maintenance R1), answered by K26. QUESTION (planning's uses), answered by K29 and done in this job.

**Evidence**
- `node --test tools/test/planning.test.mjs` → tests 12, pass 12, fail 0
- `node tools/proc.mjs gate --module planning --base origin/tranche --product .` (base the tranche at 7337ea3) → "ok": true, "fails": [], tests pass 12 of 12, checks format, architecture, coverage, fixtures
- `node --test checks/test/*.test.mjs tools/test/*.test.mjs` → tests 369, pass 368, fail 1 (run 1, with gate merged in): the one red is inherited, not this job's (BLD 7): "a runaway test fails itself (lane R14)", tools/test/lib.test.mjs:95, asserts memory peaks this container does not report; it fails the same at the base faddc47 (`node --test --test-name-pattern="runaway test fails itself" tools/test/lib.test.mjs` in a worktree of faddc47 → pass 0, fail 1)
- `report({ product: '.', tranche: 'N2' })` on this repository's own record → 46 entries, 16 applied, 510 legacy lines removed (net), PLATFORM #1 named unmeasured, never estimated
- `planFindings` over build/plan/current.md at faddc47 → the one finding K26 settled (N2-23a cites ARC-5), so a round of N2 opens clean now
- tools/planning.mjs:101 (a cited canon id read from the module's live statements), tools/planning.mjs:44 (within: the product's own paths, R9)

Tests: 12/12. Checks: format, architecture, coverage, fixtures, ownership: no new finding.
Size: test runs 2, module lines 587. Head b17a2b7.