# Handoff · BOB #3 to BOB #4 · tranche N2 of the process built under itself · 7 Nov 2026

**Why now.** BOB #3's context read 399,013 of 1,000,000 tokens at 07:00Z (get_session), at SES 5's 40 %.

**Where it stands (08:1xZ).** Layers 1, 2 and 3 closed: layer 3's four modules merged (planning PR 131, jobs 132, gate 133, integration 134), each after one review and one verified fix round; their usage rows written from get_session. Layer 3's close already ran through the merged integration code: it lists platform's unconfirmed rows and retires jobs with `proc job retire`. Next: layer 4 (sessions, messages): enter their map entries first (K1: tools/sessions.mjs, tools/messages.mjs and their tests), then `proc layer start --layer 4`, the pull requests, the sessions, the how-to-work CHANGE. After a review with gaps, `review decide --no-review` must now name the verified fix commits (integration, K15). Rulings K16 to K30 are BOB #3's.

```
HANDOFF for BOB #4 · 2026-11-07 · tranche @ f3b2bcc · epoch E1
Queue (in order):
- none
Out:
- none
Lanes: none
Next: consume the queue from `proc status`
Account: this Claude account's GitHub identity is believeinoakland; issues and pull requests 83-128 are invisible to it, new ones (129 on) work (K17; state issues/2026-11-07-bob-3-1.md). No ROOT: Bob starts you from lane-neoprocess/START-BOB-4.md (MNT-9).
Within a layer, a module that uses another of the same layer builds against its requirements and wires to it once told MERGED with the commit (K24, K25, K29).
Each job: one independent review (review decide --review, dispatch the printed brief in the background); sort its gaps into the job's and not (K20, K23 show how: wording and other modules' entries are yours); send the job's once; verify the fix commit yourself; then review decide --no-review with the evidence, merge, merge_pull_request, merged, prune dispatch, and a usage row from get_session (job archived --usage).
Layer start needs the layer's map entries first (K1): layer 4 sessions tools/sessions.mjs, messages tools/messages.mjs; layer 5 maintenance (set under budget, K21), shims. Every START gets the how-to-work CHANGE (own tests only, K14, K15, marks, order).
Study (build/plan/N2-study.md §4): C2 and C4 are unmeasured; read layer 3's job transcripts by study-record's method at its close and add the figures.
Messages to Bob: proc say refuses for want of a hook record; run plainReason from tools/lib.mjs on the draft instead (N2-36 removes the dependency).

```
