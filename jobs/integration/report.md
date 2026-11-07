**Met** · R1, R2, R3, R4, R5, R6, R7
**Elsewhere** · tools/jobs.mjs also exports `defect`: the `defect` command is integration's (R5 names the round; jobs' row does not), so jobs' copy is now unused by proc, for BOB to place its removal (P9); layer close names each merged job's retirement as jobs' `proc job retire` (jobs R7) rather than calling it, since its open-asks reader is wired only by the legacy caller; jobs' early retirement (ARCHIVED) cannot take a layer-test CHANGE (jobReopen refuses it), so layer close prints a new job for such a module — whether a job may retire before its layer's tests have run (R3: the jobs live until the close) is jobs' to settle
**Evidence**
- `node --test tools/test/integration.test.mjs` → tests 7, pass 7
- `node --test tools/test/proc.test.mjs tools/test/hooks.test.mjs tools/test/lib.test.mjs tools/test/bob-writer.test.mjs` → tests 45, pass 45 (after jobs' merge)
- `node checks/ownership.mjs . integration origin/tranche HEAD` → proc-legacy: 6 line(s) added, 170 removed; 0 failures
- `node checks/coverage.mjs . integration` → 7 of 7 live requirement ids named by a test; 0 failures
- `node checks/architecture.mjs . integration` → 15 relative imports; 0 failures
- tools/integration.mjs:91 reviewDecide (R1: --review | --no-review | --verified after the one review, K15)
- tools/integration.mjs:146 merge (R2), tools/integration.mjs:173 merged
- tools/integration.mjs:227 layerClose (R3: layer tests from the manifest, a red as a CHANGE, checks from their result file, stale rows)
- tools/integration.mjs:272 closeMerge (R4: only at CLOSING, expectedHeadSha the tranche's tip)

Tests: 7/7 (the module's own suite, 21 s). Checks here: ownership, format: no new finding; the rest is the gate's.
Self-review: approved (proc-self-review-integration.md).
Size: test runs 1, module lines 318. Head d1467ca.