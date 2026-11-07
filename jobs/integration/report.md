**Met** · R1, R2, R3, R4, R5, R6, R7
**Elsewhere** · as in the first report (jobs' unused `defect`; whether jobs may retire a job before its layer's tests have run)
**Evidence**
- the review's five gaps, fixed in 76210f6 (and the legacy test's K15 step in d53e7c8; a sixth found by the self-review in d75a2b3)
- 1 · tools/integration.mjs:92 reviewDecide: after a gaps review, `--no-review` names fix commits after the reviewed head (recorded at tools/integration.mjs:136), refused without one or with one not after it — R1 test
- 2 · tools/integration.mjs:44 hasMerged: MERGED or a Merges entry, never ARCHIVED alone, for the plan's order — R2 test (beta waits on an ARCHIVED-unmerged alpha)
- 3 · tools/integration.mjs:244 layerClose refuses while a job has no merge — R3 test (alpha ARCHIVED without a merge)
- 4 · tools/integration.mjs:187 merged: the merge commit holds the tip printed on the `merging` line, with the branch gone — R2 test
- 5 · tools/integration.mjs:224 runLayerTests: each layer test file alone, its red to its file's owner — R3 test with a test named for beta in alpha's file
- 6 · tools/integration.mjs:214 layerFiles: a named layer-test path with no tracked file refuses the close — R3 test
- `node --test tools/test/integration.test.mjs` → tests 7, pass 7
- `node checks/ownership.mjs . integration origin/tranche HEAD` → proc-legacy: 8 line(s) added, 171 removed; 0 failures
- `node checks/coverage.mjs . integration` → 7 of 7 live requirement ids named by a test; 0 failures

Tests: 7/7 (the module's own suite, 22 s). Checks here: ownership, format: no new finding; the rest is the gate's.
Self-review: approved (proc-self-review-integration.md).
Size: test runs 2, module lines 335. Head d75a2b3.