VERDICT · approve
Read whole: build/requirements/integration.md; the diff 2065a3970382...HEAD (tools/integration.mjs, tools/test/integration.test.mjs, tools/proc.mjs, tools/test/proc.test.mjs, the requirements' struck marks); the report.
One gap found on the first pass and fixed before this verdict: R3 · tools/integration.mjs:249 · a layer-test CHANGE for a module whose job jobs retired early printed `proc job reopen`, which jobs refuses for ARCHIVED · now prints a new job for it, proven in R3's test.
R1 to R7 each checked against the code and its test; no other gap.
DONE review-integration · verdict