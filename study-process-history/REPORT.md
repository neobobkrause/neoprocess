# PROCESS-HISTORY #1: how the build ran 2026-10-10 to 2026-10-20, and what to carry forward

**Status** · Report to BOB, 2026-10-28, by PROCESS-HISTORY #1 (session_018BhcegpVcycdJPyBkTMphG). Research only: no code or build state changed. Question (BOB, 2026-10-28): what was the process doing about two weeks ago (tranches about T44-T50) that worked, as a guide for now. Facts carry their source; anything else is marked *unknown* or *inference*.

**How to read the sources.** Paths are in `believeinoakland/bio` branch `tranche/T53` @ `123133a532` (full history fetched) unless they say civicos-process (`cp`). `git`/`python` outputs are my own runs; "worker" = a sonnet-medium reading worker whose summary I reviewed (the counts I did not re-run are marked *worker*). I read whole: cp `roles/BOB.md` and `PROCESS-MECHANICS.md` as of 2026-10-19 (`a4c42ff`), today's `roles/BOB.md`, `lane-process-redesign/CHARTER.md`, `HANDOFF.md`, `DESIGN.md`, `evidence-pre-decline-practice.md`, bio `docs/archive/CLAUDE-2026-09-26-old-process.md`, bio `CLAUDE.md` and `build/manifest.md` of 2026-10-15, rulings K5319-K5326 and K5334, K4207.

---

## 1. The answer on one page

**What worked (2026-10-10 to 10-14, tranches T42-T44 and T48; T50 mostly).**

1. **Small tranches, fixed when they opened, closed to `main` in hours.** T42 7.6 h / 40 jobs, T43 5.2 h / 23, T44 3.4 h / 13, T48 8.1 h / 86 jobs (first BOB takeover to last merge; §3 table, my `git log` run). The T44 and T48 close reports say "Every entry applied / merged" (`archive/T44.md:86`, `archive/T48.md:364`; worker).
2. **One session per module per tranche.** 1.00 sessions per module in T42, T43, T44, T45, T46, T48 and 1.04 in T50, against 6.62 in T51 (`build/metrics/T*.csv`, my count of `role=job` rows over distinct modules). CHANGEs reached the *same* live job session.
3. **A BOB turn was short and the waits were short.** Every merge, layer close, bundle rebuild and `checks/run.mjs` ran as a foreground command in the BOB turn, and none lasted over about 51 s in two full BOB sessions (#155, #156, 2026-10-11; *worker*, §4). Notifications that arrived mid-turn were read 15-65 s later; Bob's typed prompts got a first tool call in 4-9 s (*worker*, §4).
4. **The one long command was a background task.** The full per-module test run (`module-tests.mjs`, up to about 40 min) was the only `run_in_background` Bash in #155 and #156; BOB kept merging, answering and spawning 14 background workers while it ran (*worker*, §4).
5. **BOB found its next act from a cheap wake, and always left a timer armed.** The first call of nearly every wake was `ReadNotifications` then `mail check`/`inbox`; every turn that ended waiting had a backstop armed about 21 min ahead, and the worker found no turn that ended with ready work and no timer (*worker*, §4). The text "BOB never idles while work remains" (mechanics §5.9, 2026-10-19) was in force; no Stop hook enforced it.
6. **BOB's reading set was 97 KB** at T42-T44 (155 KB by Oct 24) (`evidence-pre-decline-practice.md` table, which I did not re-measure).

**What to carry forward (my inference from the evidence, in order of how directly it answers today's two symptoms).**

1. **Keep each foreground BOB step under about a minute; run anything longer as a session-tracked background task** (bio K4207, 2026-10-20: "every long command runs as a session-tracked background task (twice lost today)"). What blocks today is longer than what blocked in October: `proc merge` took "about 2 minutes from COMPLETE" (HANDOFF R17), a layer close runs every check once, about 136 s (R10), a heavy suite run 13 min (R16), against 25-51 s then. The fix being built (background proc, one procedure at a time in code) matches the October pattern: the long thing in the background, short things inline, and the session free to read notifications in between.
2. **Wake BOB on events and keep the backstop short.** In October a job's ring woke BOB within 15-65 s and the backstop fired every ~21 min (#155: 7 fires in 3.4 h). Today's mechanics say the backstop is hourly (`PROCESS-MECHANICS.md` §5.4, roles/BOB.md "hourly"). I did not measure what idles BOB now; an hourly gap after a quiet turn is a candidate cause (*unknown*, not tested). A non-blocking way to give BOB its next act, in the spirit of Bob's ruling against never-idle Stop hooks: the backstop at 20-30 min and every wake begins with one `proc status` that prints the next owed act.
3. **Scoped checks at merge** (R10: 16 s against 136 s) are right and should stay. They took the per-merge cost from the minute range down to the October range.
4. **Rounds of fixed scope, one session per module until its layer closes, start STARTs ahead (P18).** Already in the redesign (DESIGN §2.1-2.2); the evidence supports them (§3, §5).
5. **Bulk work to background workers whose hand-backs wake BOB** (#156 ran 14 such workers and reviewed every one). Keep.

**What not to bring back** (each a measured failure).

1. **Open scope.** K3815 ("until released, deployed and walked, every defect fixed in T51"): 8.6 days open, 1,385 job sessions, 1,437 merges (§5).
2. **Archive at merge (K4219, 2026-10-20).** Sessions per module rose from 1.0-1.6 a day to 1.8-2.6; T51 6.62-6.96 per module, 9.4 COMPLETEs per module (HANDOFF R3; my count 6.62).
3. **Waves and no cap.** 57 jobs at once burned the weekly meter 88% to 96% (K4211); K5171 removed the cap and fix round 10 opened 488 STARTs, each costing BOB a ring, a read, a cursor and a merge (K5322).
4. **The two-command COMPLETE and the cursor refusal** (K5171, K5320): "cursor" in rulings went 3, 34, 60 on Oct 24, 25, 26 (K5322).
5. **Gates that fail everyone:** a 214-byte overrun of one file made the size gate refuse every job's `post` and `inbox` (K5123, R-evidence file §c).
6. **Rules accreted in the always-read file** (16.7 KB to 63.8 KB, then cut by K5012 to 25 KB and each new rule displacing one) (K5322).
7. **Doorbells without a live address:** set minutes late (K3686) or rung into an archived BOB (K5321). The redesign already replaced them with `send_message`.
8. **Full-history fetch at session start:** 3 min of a 5-min start (R8). Already removed.
9. **Do not copy October's 55% refresh blindly:** it ran BOBs 3.4-3.6 h at 568k of 1M tokens of context, but the 55% threshold was cut to 30% (K3271, Oct 14) and then 40% (K3671, Oct 17) at Bob's direction. Today's refresh point is Bob's, not a process finding.

---

## 2. What the October process was (as written, 2026-10-19)

Source: cp `roles/BOB.md` and `PROCESS-MECHANICS.md` at `a4c42ff` (read whole), the bio manifest of 2026-10-15.

| Topic | In force 2026-10-19 | Source |
| --- | --- | --- |
| Mailbox | Job writes `build/jobs/T<n>/<module>.md` (entries `J<n>`), BOB writes `<module>.bob.md` (`B<n>`); each side has a cursor (`mail done`); a routine into the other session is a content-free *doorbell* "MAIL (T) for X: check your mailbox"; `tools/mail.mjs` | MECHANICS §13 |
| Timers | BOB arms two: a **backstop** one-time routine into its own session every 20 min while a layer runs (re-armed at each check), and a **WATCH** into ROOT (moved 60 min ahead) | §5.4 |
| Backstop check | `mail check` lists READ, RING, QUIET (nothing pushed 20 min), UNCONFIRMED (15 min), `relay to Bob` | §5.4 |
| Merge | When COMPLETE and neither side owes a read: `checks/ownership.mjs`, merge branch into the tranche, strike `*(not yet met: T<n>)*` marks, one ruling per merge naming accepted reds | §5.5 |
| Layer close | Regenerate artifacts per manifest, `checks/run.mjs`, archive the layer's job sessions, write metrics rows, start next layer | §5.6 |
| Tranche close | Completion round, merge design PR, archive `current.md`, PR merged by GitHub merge tool, delete timers, report to Bob, open next tranche at once | §5.7 |
| Refresh | Context past 40% (was 55% to Oct 14, then 30%, K2287, K3271, K3671); lean handoff; ring ROOT; ROOT starts successor | §2, §5.8 |
| Alongside the steps | "BOB never idles while work remains"; prepare next plan, requirements, extraction maps; workers for bulk reading | §5.9 |
| Checks | five (architecture, coverage, ownership, format, channels); a sixth, words, from Oct 18 (`314d84f`) | §8 |
| Sessions | job session stays active until its layer closes; a CHANGE re-opens it | §5.5, §4 |
| Reading | job reads whole its own code, requirements, entries, contract, used services, tests naming a changed requirement; START measured against 600 KB | T50 plan rule 2 (`archive/T50.md:22`) |

Note: the Sept 26 document `docs/archive/CLAUDE-2026-09-26-old-process.md` describes the *pre-refactor* lanes (BOB, SCHEDULER, CONDUCT, DIST, FLEET with `coord` ledgers); the October process had already replaced it (bio `CLAUDE.md` of 2026-10-15 says so, line 3). I read it whole; it is not the October process.

---

## 3. Throughput, then against now

Measured by me from `git log` of `tranche/T53` (subjects `plan T<n>: MODULE #k session_…`, `merge … job/T<n>/…`). "Span" = first BOB takeover of the tranche to its last job merge. `jobs/h` = job sessions started / span.

| Tranche | Span h | Jobs started | Modules | Merges | BOBs | jobs/h | h per BOB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T42 (10-10/11) | 7.6 | 40 | 40 | 44 | 3 | 5.3 | 2.5 |
| T43 (10-11) | 5.2 | 23 | 23 | 25 | 1 | 4.4 | 5.2 |
| T44 (10-11) | 3.4 | 13 | 13 | 13 | 2 | 3.8 | 1.7 |
| T45 (10-11/12) | 8.7 | 49 | 49 | 57 | 4 | 5.6 | 2.2 |
| T46 (10-12) | ≥5.5 (to last start) | 64 | 64 | 31 matched* | 4 | ≤11.6 | 1.4 |
| T47 (10-12/14, includes a quiet day) | 42.3 | 97 | 88 | 108 | 7 | 2.3 | 6.0 |
| T48 (10-14) | 8.1 | 86 | 86 | 92 | 6 | 10.6 | 1.4 |
| T49 (10-14/15) | 20.1 | 40 | 35 | 54 | 8 | 2.0 | 2.5 |
| T50 (10-17/18) | 12.5 | 85 | 82 | 92 | 10 | 6.8 | 1.3 |
| **T51** (10-18 to 10-26, open 8.6 d) | 206.9 | **1,385** | 209† | 1,437 | 108 | 6.7 | 1.9 |
| T51b R1 (10-26/27, new process) | ~6 | 2 | 2 | 2 | 2 | n/a | n/a |
| T52 R1 (10-27) | 5.6 | 24 | 24 | 25 | 2 | 4.3 | 2.8 |
| T53 R1 (10-27/28, still open) | 27.6 | 81 | n/a‡ | 97 | 12 | 2.9 | 2.3 |

\* T46's merges used other subjects, so 31 is an undercount (the evidence file also marks it n/a). † Module count from the evidence file (6.96 sessions per module); my CSV count over job rows gives 6.62 per module, so the two differ and I did not reconcile them. ‡ Not counted. `plan T53:` subjects give 81 starts, the metrics CSV 61 job rows; one source lags (*unknown which*).

What the table does and does not show:

- **Hourly throughput did not fall.** T51 started 6.7 and merged 6.9 jobs per hour, inside the October range (2.0-10.6). What changed is what the jobs were: 1,385 sessions over about 199 modules in T51 (6.62 per module) against one per module before.
- **Elapsed time per unit of closed scope changed.** October tranches closed in 3.4-12.5 h (T47 42 h with a design-heavy quiet day); T51 never closed under its original scope.
- **BOB lifetime shortened.** #155 and #156 (2026-10-11) lived 3.4 h and 3.6 h (get_session `created_at` to `updated_at`: 13:01-16:25 and 16:25-20:00, *worker* on #156, I read #155's record myself). From T48 the BOB per hour is ~1.3-1.4 h (30%/40% refresh); T53 2.3 h.
- **Close reports, worker-read** (`archive/T44.md:85`, `T48.md:363`, `T50.md:227`): T44 elapsed "about 4 h 10 min", T48 "about 9.5 h", T50 "about 12.7 h" (these run to the close PR, a little past my last-merge spans). Applied: T44 13/13, T48 87 entries all merged, T50 84 ids in 77 jobs all merged. T48 and T50 carried reds accepted by name (150 of 168 modules green; T50 43 failing tests, `audit-T50-close.md:5` finds 9 of them not accepted).

### Tokens per job and per BOB (`build/metrics/T*.csv`, my sums of cache-read + cache-write + input + output over `role=job` rows)

| Tranche | Job rows | Job tokens M | M per job | Test runs per job | BOB rows | BOB tokens M |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| T42 | 40 | 571 | 14.3 | 13.4 | 2 | 321 |
| T43 | 23 | 397 | 17.2 | 11.0 | 2 | 208 |
| T44 | 13 | 260 | 20.0 | 11.6 | 1 | 118 |
| T45 | 49 | 1,703 | 34.8 | 16.6 | 4 | 524 |
| T46 | 64 | 1,610 | 25.2 | 12.1 | 4 | 534 |
| T47 | 97 | 2,519 | 26.0 | 14.3 | 5 | 890 |
| T48 | 86 | 1,478 | 17.2 | 12.7 | 7 | 680 |
| T49 | 40 | 1,225 | 30.6 | 15.3 | 19 | 967 |
| T50 | 85 | 1,959 | 23.0 | 12.3 | 11 | 1,157 |
| T51 | 1,324 | 21,705 | 16.4 | 11.7 | 103 | 12,106 |
| T53 (open) | 61 | 1,420 | 23.3 | 1.8 | 24 | 1,380 |

- Tokens per job session were **not** higher in T51 (16.4 M) than in October (14-35 M). The cost of T51 is the *number* of sessions (21.7 B job tokens, 12.1 B BOB tokens, K5319 says "about 35 B"), not the cost of each.
- BOB rows are written at a successor's archive, so they undercount in the October tranches (T44 has 1 BOB row for 2 BOBs; the close report says BOB #156's row was left to its successor, `T44.md:92`). I therefore do not state a BOB share for October. T49's 19 BOB rows for 8 BOB sessions reflect extra rows, not extra sessions.
- Where the October close reports give totals (worker): T44 378 M (13 jobs 260 M + BOB #155 118 M), T48 2,078 M, T50 3,066 M.
- BOB #155 and #156 (my `get_session` on #155, #154, #153; worker on #156): #155 cache-read 117 M, output 149 k tokens, cost_usd 31.49, context 568k of 1M; #154 83 M, $24.33, 548k; #153 123 M, $38.35, 557k. All opus-5-5.

---

## 4. How an October BOB turn ran (BOB #155 and #156, 2026-10-11, T44 and T45)

Read by one worker, whole, via `list_events` (user + assistant kinds; #155 846 events, #156 2,442 events; each content block is an event). I confirmed the sessions' existence and metadata myself; event-level counts, waits and quotes below are the worker's and I did not re-run them. **BOB #170-#176 (T48, 10-14) could not be read: `get_session` returns "not found" to this account (two attempts by me and one by a worker); the manifest says Bob runs two accounts, so these are likely on the other one.** T48's BOB behaviour is therefore *unknown*, except through its close report.

**Wake types** (#155: 43 notifications in 42 reads, #156: 26 reads): "MAIL (T44) for BOB" job rings (19 and 17), "BACKSTOP (T44) for BOB #n" (7 and 8), design-lane cross-session messages (16 in #155), one GitHub notice. Bob's typed prompts arrive as plain user text (7 in #155, 5 in #156).

**A job's COMPLETE** (example `image-codecs`, #155, 13:27:15-13:28:22): `ReadNotifications`; one Bash `git pull … ; mail.mjs check … ; mail.mjs inbox … --module image-codecs`; one chained Bash `git fetch … && checks/ownership.mjs … && git merge -q --no-ff … && sed -i 's/ \*(not yet met: T44)\*//' build/requirements/image-codecs.md …`; the module's tests; a ruling appended to `rulings.md` (K2738); `mail.mjs done --through J3`; `mail.mjs post --kind CHANGE`; re-arm timers; a plain report to Bob ending "Still open with you: …".

**Layer close** (layer 6, #155, 15:23:44): one Bash: merge, strike marks, `mail done`, `case-checker/build-program.mjs`, `bundles.mjs`, `newgroup npm run build`, `fleetbundles` and `newgroup-bundle-fresh` tests, `checks/run.mjs | tail -4`; two parallel `archive_session`; one Bash appending the metrics rows and the ruling (K2765), `git commit`, `git push` of the tranche and of the job-branch ref.

**Starting a layer** (15:24:23-15:24:35): `mail.mjs post --kind START --body-file build/plan/starts-T44/<module>.txt` (files written ahead at 13:09, "T44 STARTs for L2-L11, prepared (P18)"), `create_session` with the fixed prompt, `mail.mjs addjob`. Takeover (13:02-13:10) was 73 tool calls in one turn.

**Foreground / background / workers.** #155: Bash 198 (1 background), ReadNotifications 42, update_trigger 18, create_session 13, create_trigger 12, archive_session 9, Agent 1; no Monitor. #156: Bash 629 (1 background), Read 98, Edit 33, create_trigger 29, Agent 14 (all background; each hand-back woke BOB), Monitor 0. Longest foreground commands: #155 51 s (fleetbundles tests + checks), 26 s, 25 s; #156 46 s, 38 s, 38 s. The one background Bash in each was the full `module-tests.mjs` (#156: started 16:30:53, next log read 17:10:23; #155 started 16:18:48 and killed it at hand-off 16:20:22).

**Waits** (arrival to first tool call). Mid-turn notifications: design-lane message queued 14:04:11, read 14:05:05, first work 14:05:16 (≈65 s); MAIL queued 15:53:11, read 15:53:43, first tool 15:53:44 (≈34 s); MAIL queued 19:25:15, read 19:26:12, answer posted 19:26:34 (≈79 s). Idle: Bob's prompt "D13: as recommended" 13:49:22, first tool 13:49:28 (6 s); other Bob prompts 3.9-8.7 s. Typical idle wait 1-5 s.

**Timers.** `create_trigger`/`update_trigger` one-shots only (no CronCreate, no `send_later`): backstop re-armed to ~now+21 min after each check or merge (13:48, 14:10, 14:32 … 16:39), WATCH into ROOT pushed ~1 h ahead each time (never fired in either transcript), job rings "MAIL (T44) for pdf-pixels: check your mailbox" at the next minute (9 in #155, 17 in #156). At a backstop wake: `ReadNotifications`, `mail.mjs xcheck`, `mail.mjs check`, fetch of the design lanes' HANDOFF headings, two `update_trigger` calls, one status line ("My 20-minute check found nothing to act on … next check is at 14:10").

**Next act / idling.** Turns ended with a named wait ("Waiting on PROMOTION #42."; "Still waiting on the module tests and four drafting helpers. Nothing for you to do."). No turn ended with ready, unstarted work and no timer; one end was a deliberate hand to the successor (20:00:14, local-facts merge left to BOB #157). #156 also received five "Stop hook feedback" events about uncommitted/untracked files (16:32-17:31): a harness stop hook existed in October for unpushed work only.

**Totals.** #155 (3 h 23 m): 13 jobs created, 12 merged, rulings K2734-K2776 (43). #156 (3 h 35 m): merged plane, closed T44, PR #27 into `main` merged 17:11:43 through the GitHub tool, opened T45, 8 job merges, rulings K2777-K2812 (36). Both handed over at 55% of context.

*Limits of this sample:* two sessions, one day, the smallest tranches. They show that BOB stayed responsive when commands were short; they do not show it stays responsive at 60-80 concurrent jobs. T48 (86 jobs in 8 h, up to 26 concurrent in layer 11) is the larger good case and its BOB transcripts were unreadable.

---

## 5. What failed and led to the redesign (so it is not brought back)

Sources: bio K5319-K5326, K5334 (read whole), cp `HANDOFF.md` R1-R17 (read whole), `lane-process-redesign/evidence-pre-decline-practice.md` (read whole; its day tables agree with my counts where I checked: T42 40/40, T44 13/13, T48 86/86, T51 1,385).

| # | Failure | Evidence | Now |
| --- | --- | --- | --- |
| F1 | Scope grew without bound | K3813/K3815 (2026-10-18): T51 "every defect fixed in T51"; 80 jobs planned, 1,385 sessions run, open 8.6 d; plan file 190-230 KB | Rounds of fixed scope (DESIGN §2.1) |
| F2 | A session per change | K4219 (10-20): archive at merge; sessions per module 6.62 (T51) | Retired (DISPOSITION B23, K5339) |
| F3 | Wave of jobs at once | K4207: 57 jobs; K4211 meter 88%→96%; caps 10 then 20 | K5323: no cap but usage via `rate_limit_info` |
| F4 | Two-command COMPLETE and cursor refusal | K5320, K5171: "cursor" 3/34/60 rulings (K5322); SCREENS-ENTRY #15 COMPLETE behind B22 | Cursors removed; `send_message` |
| F5 | Doorbell faults | K5321: ring set 9 min ahead; ring into archived BOB #312; K3686 rings 4-5 min late, two jobs idle 5 and 9 min | `send_message` refuses archived at once (R2: 8 s round trip) |
| F6 | Rules accreted in the always-read file | K5322: `rulings-active.md` 16.7 → 63.8 KB; K5012 trim to 25 KB, 117 lines archived | Index by situation (K5323, DESIGN §2.6) |
| F7 | Gate failing everyone | K5123: 214-byte overrun, every job's `post`/`inbox` refused | Never a gate (R6) |
| F8 | Slow session start | R8: 3 of 5 min fetching full history (bio 68,264 commits) | `proc history`, shallow start |
| F9 | Bookkeeping dominates the repository | R8: of 46,227 October non-merge commits, 67% touch only job records and mailboxes, 12.5% product | Messages off git; one commit per merge (R9) |
| F10 | Runaway tests, "no result" without cause | R14, R16: 8 of 82 suites no summary; one file 12.6 GB | `proc tests`, memory watch (adopt at T52 open) |
| F11 | Merge hook deadlocked a round | R15: PR to the process repo refused until the product plan read CLOSING | Fixed (PR #12) |

Process faults found *in the new process* in use: R12/R13 (create_session hook refused lane successors), R15 (suffixed tranche ids, merge hook deadlock), R17 (ruling id K5349 given twice). The October-period faults the evidence file classified (about 11 in 1,090 rulings, Oct 9-14, about 1%; K2502, K2613, K2634, K2676, K2687, K2715, K2734, K2918, K2926, K3162 …) were isolated and not systemic. Fault classes in the later period grew (K3533, K3576, K3686, K3797, then K4211, K4297, K4426, K4547, K4589, K4975-K4976, K5012, K5123, K5171, K5180, K5319).

**Two cautions about the redesign's own evidence.** (a) Its "what worked" window is T42-T44 and T48, the *smallest* tranches (13-30 entries, except T48's 86); the evidence file says T45, T46, T47, T49 had 2-2.5 CHANGEs per module and "I did not find a recorded cause" (§b, §e). (b) Which of the Oct 20 changes (cap, archive at merge, wave size) caused the session inflation, versus the walker-driven fix rounds, "is not separable from these data" (§e).

---

## 6. Process rules in the T44/T48/T50 plans (worker, `archive/T44.md`, `T48.md`, `T50.md`, `audit-T50-close.md`)

- Merge order: within a layer `modules.json` order, a provider before its users, a new module first, promotion's stamp last (T44:21, T48:21, T50:21).
- Reading: T44 and T48 "Every job reads its own code and tests whole" (T44:22 — "two T43 jobs skipped it and a whole read then found three flaws"); T50 adds the 600 KB reading-set measure and "a job that would read only part of a document stops" (T50:22).
- Models: only T50 states them (haiku for mechanical, sonnet otherwise, default for new modules, jobs at medium effort; T50:23). T44 and T48 state none.
- Accepted reds: listed by name at the opening and again at close (T44:24-30, T48:31-52, T50:25-40). T50's audit found 43 failing tests of which 9 (8 modules) were not accepted (`audit-T50-close.md:5`), plus store-door's T50-50 not merged until a close audit found it (K3797; T50:228).
- Left to later tranches: T44 "Left out" (T44:67-81); T48 "Left for T49" (T48:372); T48 release 0.84.0 "found not ready" and its acceptance withdrawn (T48:47).
- No "fix round" section exists in these reports; mid-tranche additions went to a layer not yet started (T48 entries T48-81 to T48-87 by K3207, K3254, K3258, K3279).

---

## 7. Unknown, not measured

1. Correctness. Activity and rework are counted; whether T42-T44 output met its requirements better than later output is not shown. Tests green at merge, with reds accepted by name, is the only quality signal (T50's close audit shows that signal leaked).
2. What blocks BOB #332 today. I did not read #332's transcript. The foreground durations I cite for the new process are from HANDOFF R10, R16, R17 (lane measurements), not from #332.
3. Whether the hourly backstop causes the idling BOB reports. The October backstop interval (~21 min) and the present one (hourly) are documented; the effect is not measured.
4. BOB #170-#176 (T48) and any BOB of 10-15 to 10-20 on the other account: unreadable here.
5. The cause of rework in T45, T47, T49 (2-2.5 CHANGEs per module).
6. Platform timing for doorbells in October (delivery times, lost routines) is not in git except where a ruling quotes it (K3686, K5321).
7. Weekly meter readings are sparse and span two accounts (K2615 18%, K2677 26%, K2741 35%, K3323 68%, K4211 88%→96%), so cost per job cannot be compared across periods in meter terms.
8. The snapshot branch `snapshot/pre-refactor-2026-09-25` (read only, never touched) and the Sept 26 document describe the pre-October process; I did not find a measured error rate or stated reason for that earlier replacement (evidence file §d agrees).

## 8. Method and reproducibility

- Windows and counts: `git log origin/tranche/T53 --no-merges --format='%ad|%s'` and `--merges`, filtered by `plan T<n>: <MODULE> #k session_…`, `plan T<n>: BOB #…` and `job/T<n>/` merge subjects; the script is in the session scratchpad and uses only those subjects. Merge subjects after 10-27 under `proc` (`K<n>: merged …`) are matched by `job/T<n>/`.
- Tokens: `build/metrics/T*.csv`, columns cache read/write, input, output, summed over rows whose role is `job`. T52 and T51b headers are spelled with spaces; the script normalises them.
- Sessions: `get_session` on session_017fXJJy4Fp2h84wRcexJoGg (#155), session_01EVm8g7mziJQi1eQQrAtbNW (#154), session_01M1HKb2JkFH595E438e39Cz (#153); transcript events of #155 and #156 (session_01L1X4WzJQQ7Sdsh4iWKEui7) by the worker.
- Workers (sonnet, medium, background): BOB #155/#156 transcripts; T44/T48/T50 close reports and the T50 audit; a third was asked for T48's BOB transcripts and returned nothing (sessions not found).
