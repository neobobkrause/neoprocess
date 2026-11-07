GATE #1, completion 2: the review's four gaps (BOB #3's CHANGE; K15, K28) are fixed in eb25ec2, after merging origin/tranche (2cf9dec, then 99704dc).

**Met** · R2, R3, R5, R6

- 1 · R5 · tools/gate.mjs:233 `triggers`: only `record.paths()`' durable paths are excluded (no blanket `build/**`). The files the checks read (the tables GATE_READS names and every module's requirements file) are listed after the exclusions, so GitHub's last-match rule makes them trigger. Test: toy/build/requirements/alpha.md, stats.md, modules.json, layers.md and manifest.md come after the last exclusion and match last as included; toy/build/plan/current.md matches last as excluded.
- 2 · R6 · tools/gate.mjs:188 `gateCheck` keeps the checks' result file by default in CI (`o.keep ?? inCI()`), so `gateCmd` (tools/proc.mjs, unchanged) keeps it. Test: with GITHUB_ACTIONS=true the file at resultPath(R) is HEAD's result, for module alpha, with the findings the gate reported; a session's run leaves none. The legacy assertion that the checkout is clean right after `gateCmd` (proc.test.mjs) is removed, since that no longer holds in CI; gate.test R1 keeps the session's case.
- 3 · R2 · tools/gate.mjs:56 `regenerate` names every artifact whose regeneration exits non-zero (`failed`), and runGate fails with `artifacts: regeneration failed: <paths>`. Test: a row regenerating by `exit 1` → `failed: ['gen/broken.txt']` and that gate failure.
- 4 · R3 · tools/gate.mjs:221 `installs`: `.tool-versions` is the Node file only with a `nodejs` line. Test: `python 3.12` alone → null; with `nodejs 20.11.0` → `.tool-versions`.

Self-review (K14): I re-read every requirement of build/requirements/gate.md against the whole change; R1, R4, R7, R8 and R9 are unchanged and their tests pass. Only my own tests and the scoped gate were run (no whole suite).

**Evidence**
- `node --test tools/test/gate.test.mjs` → tests 11, pass 11, fail 0
- `node tools/gate.mjs gate --product . --module gate --base origin/tranche` → "ok": true, "fails": [], tests 11/11, checks format, architecture, coverage, fixtures (ownership run, no finding)
- tools/gate.mjs:233, tools/gate.mjs:188, tools/gate.mjs:56, tools/gate.mjs:221

Tests: 11/11. Checks: format, architecture, coverage, fixtures, ownership: no new finding.
Size: test runs 2, module lines 356. Head 99704dc.