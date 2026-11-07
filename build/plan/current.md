# Plan: the process built under itself · N2

**Status** · OPEN · opened 30 Oct 2026 on Bob's word; round R1, epoch E1; the process pinned at `a0f8c6f` (the `tranche` tip when layer 1's two jobs were started, 20:30Z; MNT-3); STOPPED 20:5xZ, 30 Oct, by the architecture session (K2: the gate refused every extraction; MNT-4, MNT-8), both layer-1 jobs complete-allowed (JOB-4, none abandoned); RESUMED at `c9749e2` (the pin moved once; PLN-5). Written from REQUIREMENTS.md (accepted) and from what remains (P19). One round, five layers, lowest first; all jobs of a layer start together unless the architecture session starts a subset first (PLN-8). Every job's first act is to read its module's requirements file whole (REQ-6); every job extracts its module from `proc-legacy` (`tools/proc.mjs`, `tools/lib.mjs`, `tools/hooks.mjs`), writes one test per requirement id it meets, and leaves proc-legacy delegating to it (REQ 9: the net change in the legacy files is a removal).

**The legacy census** (PLN 8). `proc-legacy`: 2,604 + 463 + 450 lines. Retired by the jobs below in this tranche, down to the command dispatcher (`COMMANDS`, `args`), which the last job (shims) leaves as the one entry point `tools/proc.mjs`. Hard reasons for anything left: none known.

**What runs this tranche** (MNT-2, the bootstrap). The last proven version of the process is today's `main` with the hooks removed (nothing holds the certification mark). Its tool is the helper: `layer start` opens each job's branch and draft pull request; the gate in CI is today's suite plus the checks until the gate job lands, after which the shims job writes this repository's own `gate.yml`. The architecture session of the process is the lane's successor, started by Bob (MNT-9). No hook is wired, no session archives another, no scheduled task is required (PLT-2, PLT-4, PLT-7).

**Version pin** (MNT-3). This tranche runs on the process commit named in the plan's Status line at its open; the pin moves only at a stop (MNT-4). Civicsmith is halted and picks up the result at its own resume, as a subset of its next layer first (PLN-8).

**Measurements** (SES-12, taken by the architecture session, never by a job): per layer, commits by purpose, sessions per job, gate runs per merged job, restarts, tokens by role; the reading set of every job at its start (REQ-6).

---

## Layer 1 · foundations

**platform**
- N2-1 · PLT-1, PLT-3, PLT-12: `tools/platform.mjs` holds the constraints table as data (`tools/platform.md` is its rendering): each row a measured fact, date, count, evidence, workaround; the acts the process depends on with their pass counts (today's: `create_session` 23+, `send_message`, pull request calls, `actions_run_trigger`, own-branch push). The act table `tools/acts.md` is folded into it and retired as a prediction table. Test: every platform call any module prints is a row; a row without a date fails the format check.
- N2-2 · PLT-9, PLT-10: the runner workflows' dispatch (repo setup, rename, transfer, shims) and `grants check` move here from proc-legacy unchanged in behaviour, with their tests.
- N2-3 · PLT-13, PLT-14: no function here takes the process repository as a write target for a product role; the onboarding route (public, read grant, or carried) is a value the record holds.
- N2-4 · MNT-3's check: `processHead`, `versionCheck` move here: one check at a session's start against the pin, printing PROCESS OK or STALE; nothing calls it per command.

**record**
- N2-5 · REC-1, REC-2, REC-3: `tools/record.mjs` takes `repo`, `stateRead/List/Write`, `epochOpen/Close`, `commitPush`, `unpushed`, `parsePlan`, `planEdit`, `metricsRow` and `status`'s reading of the state; the path tables (durable, transient) are data with a test that no path is in both.
- N2-6 · REC-5: a remote act is recorded by the command that takes its result, never by a request; the refresh record of proc-legacy (`REFRESH_FILE`) and every pre-hook write are removed.
- N2-7 · REC-6: `addr` reads an address from `main` or the tranche at the moment of use; a test that an address on a side branch is not read.
- N2-8 · REC-7: `status` on a fresh clone of a halted build prints everything open, idle, merged, unmerged, owed; fixture: Civicsmith's halt of 30 Oct as a frozen fixture (its state branch and handoff copied).
- N2-9 · PLN-5's record: the Status line's `STOPPED <why> · <version>` and `RESUMED <version>` forms, read by every role's `status`.

## Layer 2 · the shape of a product

**architecture**
- N2-10 · ARC-3: the words check refuses a literal user-facing sentence in a test and names the key; the coverage and fixtures checks unchanged. Test: a fixture test with a sentence fails, the same test by key passes.
- N2-11 · ARC-5, GAT-7: `checks/run.mjs` writes one machine-readable result (module, file, line, check, finding) beside its text; `status` and the gate read it.
- N2-12 · ARC-4: scoping to a module and the whole-product run are one function with a `--module` switch; the layer-close run is the whole-product run; the checks reach git only through record's `repo` (record R1; K4).
- N2-45 · ARC-2 with REQ 8 (found at layer 1's start, K1): a module's `paths` or `tests` entry may name a file its live job has not yet written: the format check reports such an entry as pending while the module's job reads STARTING or WORKING on the state branch, and fails it only once the module's layer has closed; the ownership check is unchanged. Test: a map entry naming no file passes beside a live job line and fails without one.

**requirements**
- N2-13 · REQ-1, REQ-4: parsing of requirement files, `serviceBlocks`, the mark strike move to `tools/requirements.mjs` with their tests.
- N2-14 · REQ-3: the format check refuses a Test line naming a fixture above the size the product sets in its manifest (default 100,000 rows); the review brief says a measurement not taken is not a gap.
- N2-15 · REQ-6, SES-5, SES-6: `readingSet` measures a job's set against a budget that is a fraction of the model's window from the Sessions table, never a byte literal; a set over budget is recorded (size, module, what was trimmed or split) and the job is not started; the summary path for a module's own requirements is removed (SES-7).

## Layer 3 · the work

**planning**
- N2-16 · PLN-2, PLN-4, PLN-5, PLN-8: `tools/planning.mjs` takes tranche open/carry/close, round open/close, footprint, ruling; adds `stop --why` (marks each unmerged job of the layer complete-allowed or abandoned by the architecture session's choice, records the pin), `resume --version <commit>` (moves the pin once), and `layer start --modules` recorded with its reason as a partial layer.
- N2-17 · PLN-6, SES-12: the tranche report's fields, the overhead counts computed from git (commits by purpose, sessions per job, gate runs per merged job, restarts) and from the metrics.
- N2-18 · PLN-7: no function here reads or writes a path outside the product's own repository; a test with two product fixtures on one checkout.

**jobs**
- N2-19 · JOB-1 to JOB-3, JOB-6 to JOB-8: `tools/jobs.mjs` takes layer start, job pr/started/route/start/state/complete/takein/posted/reopen/retire/archived, defect; the START generator names only tool commands (a test enumerates its acts against `COMMANDS`).
- N2-20 · JOB-4: `job route` replaces a dead session with a brief from the branch and pull request, not a re-read of the module; no function archives or replaces a live job for a version; the abandon and complete-allowed choices are read from the plan's stop record.
- N2-21 · JOB-5: `job complete` runs locally only ownership, format and the module's own suite when it is under a minute (measured by the previous run's record), pushes, posts, marks ready, sets COMPLETE; the in-session gate is removed; before it, the job reviews its own whole change against every requirement of its module with the reviewer's own brief (`review decide`'s text, read by `job complete`) and fixes every gap it finds, so a review round finds what the job could not and a job is rerun once per review, never once per gap (Bob, 30 Oct; K14).
- N2-22 · JOB-9, JOB-10: the Stop-hook rules become the record: `status` lists a job WORKING with nothing pushed for an hour; each job attempt's reading set and tokens are its own row.

**gate**
- N2-23 · GAT-1, GAT-2, GAT-6: `tools/gate.mjs` holds `runGate` for CI only: the module's own suite and the checks scoped to it; `usersOfChange` and every user-suite path removed; the workflow template `tools/gate.yml.tmpl` triggers on the module's paths and tests, the files the checks read for it and generated inputs, never on record paths, read from record's `paths()` and proven by a test (record R12; K4).
- N2-24 · GAT-4: artifacts regenerated, verified only when changed against HEAD.
- N2-25 · GAT-5: every lock installed where it sits; Node from the product's version file (as today, proven live).
- N2-26 · GAT-8: the full regression as its own workflow, dispatched only by `tranche close` for a release or on Bob's word.

**integration**
- N2-27 · INT-2, INT-3, INT-6: `tools/integration.mjs` takes review decide/result, merge, `gateNeutral`, merged, job retire's record half, bob release; nothing in a merge or close calls `archive_session`; retirement is a record line and the usage read by SES-10's route or named unmeasured; one independent review per job (K15): after its gaps are fixed, the architecture session verifies the fix commits against the named gaps and merges, with no further review round.
- N2-28 · INT-4 and P11: `layer close` runs the layer's tests (from the manifest) over the merged layer and refuses to close on a red, naming the module and printing the CHANGE for its job; it lists platform's stale constraint rows (`constraints({ olderThan })`, platform R2; K3).
- N2-29 · INT-5: the completion round, tranche close, close pull request, release cut, deployment and walk kept as today, each with a fixture test, and the tranche report naming any stage that runs for the first time under a version.

## Layer 4 · the people

**sessions**
- N2-30 · SES-1, SES-2, SES-3: `tools/sessions.mjs` takes takeover, handoff (at most one screen, generated), root start/bob, lane open/started/start/state/charter/route/close/archived, bobArchived, the models table; `status` prints the context share from `get_session` and REFRESH when past the role's threshold; no successor is started by its predecessor (the lane's self-spawn `processHandoff` → a handoff file for Bob's or the starter's `create_session`).
- N2-31 · SES-4, SES-5: each role's reading set with sizes at start; budgets as fractions of the window in one table The table is { window, fraction, bytesPerToken } per role (K19: a job 0.15 of a 1,000,000 window at 3 bytes a token until measured); bytesPerToken is measured from a sample of sessions' reads against their token counts and the measured figure replaces 3.
- N2-32 · SES-9, REC-8: `audit reads --layer <n>` reads a sample of the layer's job transcripts (`list_events`) for one whole read of the requirements file before the first write, and files a flaw report on a miss.
- N2-33 · SES-10, SES-13: usage by a route PLT-3 allows (measured first: `list_events` usage fields, or `get_session`), else unmeasured; nothing counts on a parent being alive.
- N2-34 · the process's own architecture session (MNT-9): `process start`, `process handoff`, `process archived` reduced to: record the role, print the handoff, write the START file for Bob's `create_session`; the owed archive, backstop and address-announce acts removed.

**messages**
- N2-35 · MSG-1, MSG-2, MSG-7: `tools/messages.mjs` takes `addr` and the ask commands; a message whose delivery fails is recorded undelivered and listed by `status`.
- N2-36 · MSG-3, MSG-5: no Stop hook, no judge: `hooks.mjs stop|evidence|display` deleted; `say` stays as a voluntary deterministic plain-words check (`plainReason`) a session may run on its own draft, with no model call; `turnEvidence` and the judge prompt deleted.
- N2-37 · MSG-4, MSG-6: `steps` (verified from the page) stays; the flaw-report route is unchanged and tested with a product whose account holds no role here (PLT-13).

## Layer 5 · the process itself

**maintenance**
- N2-38 · MNT-3, MNT-4, MNT-6, MNT-8: `tools/maintenance.mjs` takes issue file/ack/close/reply/seen, productReports, processReplies; `processRefresh` becomes `version newer` (an anonymous read of `main`'s tags against the pin, called by `layer close` to offer the stop) and `processBehind` becomes the one start-time check (N2-4); the hourly refresh and per-command checks removed.
- N2-39 · MNT-7, MNT-10: the version note (`VERSIONS.md`): per version, the layers and stages it has been proven by with their product sizes, and whether it holds the certification mark; `layer close` appends the layer's proof row; the mark is written only by `tranche merged` after a release's deployment and walk on a real product.
- N2-40 · MNT-1, MNT-2, MNT-5: the lane's record (`lane-neoprocess/`) becomes this product's build state: DRYRUN's rows migrate to the version note; fixes that do not block are placed in `next.md` for the next process tranche, never merged mid-layer.

**shims**
- N2-41 · SHM-1: `tools/shims.mjs` takes `shims`, `settingsText` (permissions only; no hooks, no env), the CLAUDE.md template naming the pinned commit and the one clone command, the gate workflow from the gate module's template, the prune workflow; `init`, `initCheck`, `onboardStart`.
- N2-42 · SHM-2: `repo shims` runnable from the product's own repository with its own secret (a second workflow template the product may hold), proven on the first other-owner product.
- N2-43 · SHM-3, SHM-4, SHM-5: onboarding measures the product against §0's sizes and reports each dimension beyond the proven range; `tranche carry` removes stale tracking refs first; the product's setup script is named in its manifest and run by its sessions' first command, not a hook; onboarding records the product's route to the process (public read, a read grant, or carried reports) as the value platform's `processRoute` reads (platform R9; K3); the steps `repo setup` and `repo transfer` print for a new or moved product name a session created on that repository (`create_session` with its URL, PLT-3), never `add_repo`, which the classifier decides case by case (PLT-2; platform's report A6; K13).
- N2-44 · this repository's own shims: `gate.yml` for the process repository written by the module and merged, so the process is gated as a product from layer 5 on (ARC-1's import check then runs over `tools/`).

proc-legacy (no job: retired by the jobs above)
- At the layer's close `tools/proc.mjs` holds only `COMMANDS` and `args`, delegating to the modules; `tools/lib.mjs` and `tools/hooks.mjs` are deleted; the legacy row leaves `build/modules.json`.

---

## Completion round (PLN 7; opened by `proc round open` after layer 5)

**platform**
- N2-46 · platform R13 (K3, K7): adds to platform's requirements `R13 · No module prints as owed an act R4 names: the R12 enumeration refuses a printed call whose constraint row is classifier-judged (PLT-2)`, with its test, once N2-27, N2-34 and N2-36 have merged (the coverage check counts a marked id as live once a module's job has started, so the id enters the file with its test, in this round).

**record**
- N2-47 · REC-7's fixture (K3): N2-8's halted-build fixture rebuilt from a frozen copy of Civicsmith's real state branch and handoff of 30 Oct, once a session on this account can read that repository (the record job built it from the measured description, its report of 30 Oct).

## Deferred, with the hard reason (PLN 2)
- INT-5's stages proven live, and the certification mark: a real product's full tranche, deployment and walk (a measurement that cannot happen inside this tranche).
- PLT-14's private-product route and SHM-2's other-owner workflow proven live: something outside the product that does not yet exist (no such product).
- SES-9's confidence: measured on the first product layers run under this version (a measurement outside this tranche).
- P11's text in `PROCESS-DESIGN.md`: Bob's word to change the principle file (a decision of Bob's not yet made; the wording is accepted in REQUIREMENTS.md §14).