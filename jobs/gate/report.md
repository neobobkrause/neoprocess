GATE #1 · N2 · layer 3 · module gate: entries N2-23, N2-23a, N2-24, N2-25, N2-26 applied. `tools/gate.mjs` and `tools/gate.yml.tmpl` are new, extracted from `tools/proc.mjs`; proc.mjs keeps only the import and a thin `gateCmd` (the shims drift check stays there, since shims is a later module).

**Met** · R1, R2, R3, R4, R5, R6, R7, R8, R9

What changed, by requirement:
- R1, R6 (N2-23, N2-23a): `runGate` runs the module's own suite and, as a child process, the checks scoped to the module (`checks/run.mjs --module --base --ref`, ownership included). It reads the findings from the checks' one result file (`readResult`) and names each finding's module, file and line. Anything also red at the base (a test, or a finding compared without line numbers) is inherited and named under `inherited`. The checkout is left as it was found; CI's run alone keeps the result file (`keep`), for the merge and `status`. `runGate` stays synchronous, so its legacy callers are rewired by import alone.
- R2 (N2-24): `regenerate` regenerates every artifact and verifies only the rows whose paths the regeneration changed against HEAD; `restore` puts them back.
- R3 (N2-25): `installs` finds every lock file where it sits and the Node version file (`.nvmrc`, `.node-version`, `.tool-versions`, `package.json` with `engines.node`). Both workflows install each lock in its own directory and use `node-version-file`, or 22 when the product has no version file.
- R4: `moduleOfDiff` moved unchanged; a module's requirements file counts as its own.
- R5 (N2-23): `workflow(R)` renders `tools/gate.yml.tmpl`. Its triggers are every module's paths and tests, the non-record files the checks read, and the generated artifacts. `build/**` and every durable path of `record.paths()` are excluded, listed last so the exclusions win. It runs on `types: [opened, synchronize, reopened]`, so once per tip. `gateNeutral` moved here: a tip whose base differs from the tranche only by record paths merges as it stands.
- R7 (N2-26): `regression(R, { why })` prints the `actions_run_trigger` of `regression.yml` on `main`, only for `release` or `bob`. `regressionWorkflow(R)` is the template's second part: `workflow_dispatch` only, `timeout-minutes: 180`. `runRegression` refuses outside CI.
- R8: `usersOfChange` and every user-suite path are deleted; no user's suite runs.
- R9: `gateCheck` is the hand form. In a session its result says `evidence: false`, with the note that it is a check of what CI will do and never a merge's evidence.

**Evidence**
- `node --test tools/test/gate.test.mjs` → tests 10, pass 10, fail 0
- `node tools/gate.mjs gate --product . --module gate --base origin/tranche` → "ok": true, "fails": [], tests 10/10, checks format, architecture, coverage, fixtures (ownership run, no finding), "evidence": false
- the same two runs again after merging origin/tranche (85a2de2) → tests 10, pass 10; gate "ok": true, "fails": []
- tools/gate.mjs:141 (runGate), tools/gate.mjs:115 (checks via readResult), tools/gate.mjs:55 (regenerate), tools/gate.mjs:218 (installs), tools/gate.mjs:167 (moduleOfDiff), tools/gate.mjs:227 (triggers), tools/gate.mjs:250 (workflow), tools/gate.mjs:205 (gateNeutral), tools/gate.mjs:260 (regression), tools/gate.mjs:185 (gateCheck)
- tools/gate.yml.tmpl:8 (once per tip), tools/gate.yml.tmpl:50 (the regression's own budget)
- tools/proc.mjs:63 (the rewire: `runGate`, `gateCheck`, `gateNeutral` imported from ./gate.mjs)

Found elsewhere (sent to BOB as a REPORT):
1. record: `record.paths()` names no `build/rulings.md` (it exists in this repository's `build/`) and no `build/summaries/`. Both are BOB's records on the tranche (issue 86), so a gate that read only `paths()` would hold a merge on them. I treat all of `build/` as record (P2) beside `paths()`. Record R5 and R12 are the place to add them.
2. Requirements against rulebook: INT 3 lists "the size limits" among what the gate runs, but gate R1 names only the module's suite and its scoped checks. I followed R1, so the gate no longer runs the size check (`proc job start` and `proc layer start` still measure the reading sets). One of the two should change.
3. jobs: `proc job complete` still calls `runGate` in the session (jobs R5, N2-19 to N2-22, takes that call out). Until then the hand form serves it, and its result says it is not a merge's evidence.

Tests: 10/10. Checks: format, architecture, coverage, fixtures, ownership: no new finding.
Size: test runs 1, module lines 349. Head 30389ac.