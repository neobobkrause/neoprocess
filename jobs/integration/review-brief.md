Brief review-integration · for BOB #3 · 2026-11-07
Task: Review pull request #134 of module integration (tranche N2) against the module's requirements. Report only correctness gaps against the requirements, each with the requirement id, file:line, and a way to show it (a command or a test). No style, no praise, no rewrite. A figure at a scale beyond the suite, or on a deployed copy, is a measurement with its own id in the plan, never a Test line; a measurement not yet taken is not a gap. Why this review: K15: the module's one independent review; review, merge and layer close for every job; concerns: diff of 843 lines (over 400); provided service changed (19 export line(s) differ).
Read whole, and nothing else: build/requirements/integration.md (the requirements); the diff, by `git -C /home/user/neoprocess diff origin/tranche...origin/job/integration`; the job's report, by `git -C /home/user/neoprocess show origin/state/E1:jobs/integration/report.md`.
Write your result to: /home/user/neoprocess/.git/proc-review-integration.md
Form of the result: first line `VERDICT · approve` or `VERDICT · gaps`; then one line per gap: `- R<id> · <file>:<line> · <what fails> · <how to show it>`.
If you need something not listed above, stop and write what it is in the result; do not search for it.
End with the line: DONE review-integration · verdict
Model: Opus · Effort: high · Due: 60
