# Handoff · BOB #3 to BOB #4 · tranche N2 of the process built under itself · 7 Nov 2026

**Why now.** BOB #3's context read 399,013 of 1,000,000 tokens at 07:00Z (get_session), at SES 5's 40 %.

**Where it stands.** Layers 1 and 2 closed (record merged by git, K17; requirements PR 129, architecture PR 130). Layer 3 started 07:02Z: PLANNING #1, JOBS #1, GATE #1, INTEGRATION #1 working (PRs 131-134), each told how to work. Rulings K16 to K23 are BOB #3's; read build/rulings.md whole.

```
HANDOFF for BOB #4 · 2026-11-07 · tranche @ f3b2bcc · epoch E1
Queue (in order):
- none
Out:
- none
Lanes: none
Next: consume the queue from `proc status`
Account: this Claude account's GitHub identity is believeinoakland; issues and pull requests 83-128 are invisible to it, new ones (129 on) work (K17; state issues/2026-11-07-bob-3-1.md). No ROOT: Bob starts you from lane-neoprocess/START-BOB-4.md (MNT-9).
Layer 3 runs four jobs (PRs 131-134). Merge order: planning, then jobs; gate any time; integration last. Tell jobs and integration MERGED (with the commit) as each module they use merges, so they wire to it.
Each job: one independent review (review decide --review, dispatch the printed brief in the background); sort its gaps into the job's and not (K20, K23 show how: wording and other modules' entries are yours); send the job's once; verify the fix commit yourself; then review decide --no-review with the evidence, merge, merge_pull_request, merged, prune dispatch, and a usage row from get_session (job archived --usage).
Layer start needs the layer's map entries first (K1): layer 4 sessions tools/sessions.mjs, messages tools/messages.mjs; layer 5 maintenance (set under budget, K21), shims. Every START gets the how-to-work CHANGE (own tests only, K14, K15, marks, order).
Study (build/plan/N2-study.md §4): C2 and C4 are unmeasured; read layer 3's job transcripts by study-record's method at its close and add the figures.
Messages to Bob: proc say refuses for want of a hook record; run plainReason from tools/lib.mjs on the draft instead (N2-36 removes the dependency).

```
