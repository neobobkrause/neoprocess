# N2 · why layer 1 was slow and costly: the study Bob asked for (30 Oct 2026)

Bob, 30 Oct, 22:0xZ: "It's imperative that development be efficient, productive, AND FAST! The process being used here is none of those 3. So let's study what's causing these problems - to the point that we really understand. Then let figure out how to fix them, fix them, then confirm that they're fixed." Every number below names its source; what is not measured is called unknown.

## 1. Measured so far (BOB #2, 22:0xZ)

**Layer 1's wall clock** (state branch `state/E1`, commit times): opened 19:51; sessions created 20:30 (after the BOB #1 → #2 handoff); first completions platform 20:47, record 20:52; then review rounds to 22:00 and still open: platform reviewed 4 times (gaps 7, 3, 1, 4), record twice (18, 5).

**Tokens processed per session** (`get_session` usage, 22:00Z; the architecture session's from its own transcript):

| session | cache read | cache write | input | output | context now |
| --- | --- | --- | --- | --- | --- |
| BOB #2 (architecture) | 177,386,670 | 2,596,953 | 13,735 | 738,260 | 505,418 of 1,000,000 (past its 40 % refresh line) |
| PLATFORM #1 (job) | 73,139,939 | 578,891 | 10,193 | 150,339 | 448,984 (worker restarted 4 times: epoch 5) |
| RECORD #1 (job) | 60,935,851 | 761,530 | 4,625 | 169,621 | 441,360 (epoch 4) |
| five reviewers | about 112,000 to 162,000 each (the harness's own count per worker) | | | | fresh each |

So about 311 million cache-read tokens for one layer of two modules of about 900 and 1,100 lines; the architecture session alone is 57 % of it. P13 names the cause in general: cost grows with context size times turns.

**Where the architecture session's 97 minutes of tool time went** (its transcript, tool call to tool result):

| kind | calls | minutes |
| --- | --- | --- |
| the message check before each message to Bob (`proc say`: a fresh-reader model and an evidence-judge model, rerun on every refusal) | 62 | 19.0 |
| other shell work (reading, git, the tool's commands) | 98 | 13.9 |
| the code checks | 24 | 3.7 |
| sessions and messages | 28 | 3.4 |
| GitHub | 29 | 2.8 |
| the test suite | 3 | 1.6 |

The message check took more of the architecture session's time than any other kind of work, and REQUIREMENTS.md MSG-5 (accepted) already says no model judge sits between a session and Bob.

## 2. Being measured (helpers, from each job's transcript)

Each job's turns, time by kind of work, files read and how often, time per review round, restarts: `study-platform`, `study-record`.

- **record** (helper `study-record`, done 22:1xZ; whole result `build/plan/N2-study-record.md`): of 89 minutes, 44 % idle between turns (30 minutes of it waiting on a message from BOB, the longest 9.5, 8.2 and 5.2 minutes), 56 % inside 13 turns; of the turns' tool time, 78 % ran the test suite (11 full-suite runs of about 92 to 130 seconds, plus 3 inside `job complete`), 2 % read files; 58 % of turn time was the model writing with no tool running. A CHANGE sent while a turn ran waited 380 seconds to be read. No restart visible in the events read.
- **platform** (helper `study-platform`, done 22:1xZ; whole result `build/plan/N2-study-platform.md`): of 91 minutes, 48 % idle waiting for BOB's next message and 13 % idle waiting for a background check run; 27 % the model writing with no tool running; 12 % a tool running, of which the tests were 397 of 682 seconds. 27 turns: 13 started by a BOB message, 13 by a background task finishing. The worker was replaced four times, each after an idle gap of 6 to 10 minutes, each costing about 3 seconds. BOB's wait from a COMPLETE to his next message averaged 5 minutes 12 seconds over rounds 1 to 4.

**Read across both jobs (BOB #2, for BOB #3 to carry to causes):** about half of each job's wall clock was waiting on the architecture session; the architecture session's own time went most to the message check before each message to Bob; inside the jobs, full test-suite runs, repeated after every change, dominate tool time; review rounds multiplied all of it.

## 3. Causes, fixes, confirmation (BOB #3, 7 Nov 2026, from §1 and §2 only)

Layer 1's two jobs ran about 90 minutes each (record 89m16s, platform 91m28s). Their time splits into four causes, largest first. Each fix names where it is placed; layer 2 is measured the same way (§2's method, by a helper per job) to confirm it.

| # | cause | evidence | fix | placed |
| --- | --- | --- | --- | --- |
| C1 | **Review rounds.** Each round was a full cycle: review, CHANGE, rework, full checks, complete, wait. | platform 4 reviews (gaps 7, 3, 1, 4), record 2 (18, 5); 65 of layer 1's minutes were review rounds (K15); platform's rounds 1-4 hold 44m53s of job windows (study-platform §4b) | the job reviews its own whole change before each completion (K14); one independent review per job, its gaps fixed once and verified by the architecture session (K15) | K14, K15 now; N2-21, N2-27 in code |
| C2 | **Jobs waited on the architecture session.** | waiting for its next message: platform 2593 s of 5488 (47 %), record 1793 s of 5356 (33 %); mean 5m12s from a COMPLETE to its next message (study-platform §4b); a CHANGE sent mid-turn waited 380 s (study-record §4) | the architecture session's turns shortened: C3 removed, and each COMPLETE answered before other work in the same wake | practice now; N2-36 in code |
| C3 | **The model check of every message to Bob.** | 62 calls, 19.0 of the architecture session's 97 tool minutes, the largest kind (§1); REQUIREMENTS.md MSG-5 forbids a model judge | messages to Bob checked by the deterministic plain-words check only (`say --no-judge`), no model call | practice now (MSG-5); N2-36 in code |
| C4 | **The whole suite after every change.** | record: 11 full-suite runs of 92-130 s plus 3 inside `job complete`, 78 % of its tool time; platform: tests 397 of 682 tool seconds and 7 full checks of 77-157 s in the background (study-platform §2c) | a job runs its own module's tests while it works; the whole suite and the checks run once, in CI, on its pull request (GAT-1, GAT-2, JOB-5) | in every START and CHANGE from layer 2 on; N2-21, N2-23 in code |
| C5 | **The architecture session's context.** | 177 million cache-read tokens, 57 % of the layer's 311 million; 505,418 tokens of context at its handoff, past its 40 % line (§1); P13: cost is context times turns | refresh at 40 % read from the session's own record, not on Bob's word | practice now; N2-30 in code |

Not causes, measured and left: worker restarts (four, about 3 s each, study-platform §5); file reads (2 % of record's tool time, 4 % of platform's). The model writing with no tool running (record 58 % of turn time, platform 27 % of wall) is the work itself.

**Confirmation.** At layer 2's close: each job's wall clock, its share waiting on the architecture session, its full-suite runs in-session (expected 0), its review rounds (expected 1), and the architecture session's tool minutes by kind, set beside the figures above.

## 4. Confirmation: layer 2 beside layer 1 (BOB #3, 7 Nov 2026, 07:0xZ)

Measured from the state branch, the merge commits and `get_session` usage; what is not measured is named unknown.

| measure | layer 1 (30 Oct) | layer 2 (7 Nov) |
| --- | --- | --- |
| job start to merge | platform 20:30 to 22:06 (96 min); record 20:30 to its merge on 7 Nov (an account switch between) | requirements 06:11:33 to 06:30:52Z (19 min); architecture 06:11:34 to 06:59:22Z (48 min, part of it waiting for requirements' merge, not measured) |
| independent review rounds | platform 4, record 2 (+1 on 7 Nov) | 1 each, then one fix cycle each, verified by the architecture session (K15) |
| gaps per review | 7, 3, 1, 4; 18, 5 | 9 (7 the job's); 9 (5 the job's) |
| cache-read tokens per job session | platform 73.1 M, record 60.9 M (to 22:00Z) | requirements 22.7 M, architecture 46.9 M |
| the architecture session | 177.4 M cache read for layer 1 (BOB #2) | 58.1 M for its whole session to 07:00Z (takeover, layer 1's close, layer 2, layer 3's start); the model check of messages not run (C3) |
| full-suite runs in-session by a job | record 11 + 3, platform 7 in the background | unknown (no transcript read) |
| time jobs waited on the architecture session | 33-47 % | unknown (no transcript read) |

**Read.** C1 and C3 are confirmed by count: one review per job and no model check. Wall clock fell from about 90 minutes per job to 19 and 48, and job tokens to between a third and two thirds of layer 1's; C2 and C4 are consistent with that but unmeasured, and a transcript study of layer 3's jobs (study-record's method) settles them.

**Layer 3 (7 Nov, 07:02 to 08:1xZ), the same measures.** Start to merge: gate 21 min, planning 39 min, jobs 45 min (it waited on planning's merge), integration 66 min (it waited on all three). One review each, then one fix round; gaps per review 6 (4 the job's), 3, 9, 5. Cache-read tokens per job: planning 40.0 M, jobs 41.6 M, gate 19.8 M, integration 57.6 M. The architecture session: 122.7 M cache read for its whole session to 08:06Z. A CHANGE sent at 07:03 was read by the jobs job at 07:29, after its turn ended (C2's delivery wait, measured once). In-session full-suite runs: the jobs and gate jobs each ran the whole suite once before reading the CHANGE (their reports); after it, unknown.
