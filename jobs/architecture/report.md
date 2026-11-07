ARCHITECTURE #1 · N2 · module architecture · first completion: N2-10, N2-11, N2-12, N2-45 and every id of the module

**Met** · R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11

What changed:
1. R2, R3 (N2-11, N2-12): `checks/run.mjs` exports `run(R, { module, base })`, one function for the scoped run and the whole run (the layer close). It writes one result, each finding's check, key, module, file and line, at `checks/result.json` or the path a manifest row naming the checks' result gives. `readResult` reads it. Where the gate and `status` read it is placed by K22 (N2-23a, N2-48).
2. R10, N2-12: every check reads one commit (`snapshot` in checks/lib.mjs) and reaches git only through record's `repo`. The channels check's fetch and forced-rewrite comparison are now a refresh step that the runner takes before the check.
3. R1: `modules(R)` answers the order. The architecture check (no longer format) reports a lower layer after a higher one, a use of a later or unknown module, and a `from` naming no legacy module or a legacy module placed before the module extracted from it.
4. R6 (N2-45): a map entry a live job has not written is pending while that job's line on the state branch reads live and its layer is not CLOSED; otherwise it fails. Requirement files are read by `requirements.parse`, and a Test line `requirements.isMeasurement` names fails (N2-14's check half, Q1).
5. R7 (N2-10): a `testcopy` or `testenglish` finding names the key the copied sentence lives under (`wordKey`).
6. R11: the module's tests assert on finding keys and fields, with one test per id.

For BOB (P9, in requirements' terms): requirements R1's `parse` counts only an id that leads its line (`- **R<n>**`). Coverage still counts a bold id anywhere on its line (ruling BOB #38: three files put ids after a service's signature; test "R8 … an id in bold after a signature is an id"). Routing coverage through `parse` and `marks` would drop those ids, so I left coverage on its own rule. Whether the parser or the ruling gives way is yours.

**Evidence**
- `node --test` on checks.test, channels.test, words.test, model.test, cert.test and fixtures.test: tests 212, pass 212, fail 0.
- `node --test tools/test/proc.test.mjs` (the legacy callers of the checks; run at da220f9, before the R6 commit): pass 15, fail 0.
- `node checks/run.mjs . --module architecture --base origin/tranche --no-fetch`: format, architecture, coverage (11 of 11), fixtures, ownership: 0 failures each.
- `node checks/format.mjs .`: 13 modules, 12 requirements files; 0 failures (requirements' files parse).
- Self-review against R1 to R11 (K14): done; one gap found and reported above.

Tests: 212/212. Checks: no new finding.
Size: test runs 6, module lines 2884. Head 1a49c09.

Tests: 155/155. Checks: format, architecture, coverage, fixtures, ownership: no new finding.
Size: test runs 1, module lines 14014. Head 1a49c09.