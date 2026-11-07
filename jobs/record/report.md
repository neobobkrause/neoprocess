RECORD #2 · completion 5 · the CHANGE from BOB #3 (K15: the three gaps of pull request 128's independent review), fixed in commit afa8139 on job/record.

Applied:
- R4 · tools/record.mjs:94 · commitPush commits the named files only (`git commit --only -- <named>`); anything else already staged stays staged and uncommitted; a named path gone and never committed records nothing; a named file unchanged makes no commit even with other work staged.
- R7 · tools/record.mjs:355 · THRESHOLDS gives `process` 40 %: the process's own architecture session refreshes as BOB does (SES 5, MNT-9).
- R11 · tools/record.mjs:328 · a measured metrics row has all four counts as whole numbers (a number that is a safe non-negative integer, or a string of digits); an estimate (`~5000`), a fraction, a negative, `1e3`, a missing count beside the others, or Infinity is refused, never written.

Not done: nothing. Found in other modules: nothing. Self-review (K14) of the whole change against every requirement of record.md: R4, R7 and R11 changed as above. R3's epochOpen and epochClose name every file they write, so the narrower commit leaves them as they were. Every commitPush caller in tools/proc.mjs names its files and stages nothing beforehand; tools/mail.mjs has its own commitPush. R1, R2, R5, R6, R8, R9, R10, R12 and R13 are untouched.

**Met** · R4, R7, R11

**Evidence**
- tools/test/record.test.mjs:137 · R4: other.md staged, then commitPush(R, TRANCHE, ['one.md'], 'one'); the pushed commit holds one.md only and other.md stays staged; a named deletion is committed alone.
- tools/test/record.test.mjs:284 · R7: contextShare at 45 % for 'process' prints `context: 45 % of 1000000 (threshold 40 %) REFRESH`; 39 % does not.
- tools/test/record.test.mjs:492 · R11: metricsText(null, ['session_01A','job','A #1','a','~5000','','','','','','','']) is refused, with eight other non-whole counts.
- `node --test tools/test/record.test.mjs tools/test/mail.test.mjs checks/test/mail-open.test.mjs checks/test/running-cap.test.mjs` → tests 65, pass 65, fail 0
- the same record tests against the record.mjs before afa8139 → tests 34, pass 31, fail 3 (exactly the three new tests), so each new test can fail.

Tests: 65/65. Checks: format, architecture, coverage, fixtures, ownership: no new finding.
Size: test runs 5, module lines 1147. Head afa8139.