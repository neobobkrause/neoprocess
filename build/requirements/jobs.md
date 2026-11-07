# jobs — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §7 (accepted by Bob, 30 Oct 2026) before the module's first START (K8). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

One job, one module, one pull request: a layer's jobs opened together, each with a branch, a START, a draft pull request and a session; a job's start, take-in, completion, re-open, route to a successor and retirement, every step a tool command and a record line.

### Provides

**layerStart(R, layer, { modules, mechanical }) → the jobs to open**
- **R1** For each module of the layer with entries: its branch `job/<module>` at the tranche tip, its START (at most 4 KB: the entries, the reading set by path, the tool, the two standing lines) on the state branch, the draft pull request printed with the START as its body, and the session call printed with the model and effort the Sessions table gives; every reading set is measured first (`requirements.readingSet`) and no job starts whose set is over budget, the module and the size named. (JOB-1; REQ-6; SES-4, SES-8)
- **R2** A START names only acts the tool supports, each as the command the job runs; a test enumerates the START's acts against the command table. (JOB-2)

**jobPr / jobStarted / jobStart / jobState**
- **R3** `job start` is the job's first command: it merges the tranche into the job's branch, records the role, sets WORKING, and prints the START and the reading set with sizes; the state line is read or set to WORKING or a named wait, and COMPLETE only by `job complete`. (JOB-1; REC-8; JOB-9)

**jobTakein(R, branch, sha)**
- **R4** Takes a module's earlier unmerged branch into the job's own branch by one command, on the job's branch only; a conflict is left for the job. (JOB-3)

**jobComplete(R) / jobPosted / jobReopen**
- **R5** Runs locally only ownership, format and the module's own suite when the previous run's record says it takes under a minute; pushes; posts the report (Met, Evidence, what was found elsewhere) as the pull request's comment; marks it ready; sets COMPLETE; refuses without a Met line and an Evidence item, and on a red the tranche did not already have; `job reopen` returns a COMPLETE job to WORKING on a CHANGE and it completes again. (JOB-5, JOB-7; BLD 7, BLD 8, BLD 10)

**jobRoute(R, module, { sessionStatus, contextPct })**
- **R6** Replaces a session that is gone (archived, failed, past half its window) by a successor started from the branch and the pull request with a brief, never a re-read of the module; a job is interrupted for a process reason only at a declared stop, and then by the choice recorded in the plan's stop record (complete-allowed or abandoned), which this module reads; no function archives or replaces a live job for a version. (JOB-4, JOB-6)

**jobRetire(R, module) / jobArchived(R, module, usage)**
- **R7** Retirement is a record line when nothing more can reach the job this round; the usage is read by a route the platform allows, else the row is named unmeasured; nothing here calls an act the classifier decides. (INT-6; SES-10; PLT-2)

**status lines**
- **R8** `status` lists a job WORKING with nothing pushed for an hour; the rule that a turn ends only COMPLETE or on a named wait is text and record, with no hook. (JOB-9)
- **R9** Each job attempt's reading set at its start and its tokens at its end are its own metrics row naming the attempt, so a restart is never counted as a job. (JOB-10)

## Private

### Uses

- `platform`: `acts`, `limits` (the session call's model table, the depth and background limits).
- `record`: `stateRead`, `stateWrite`, `commitPush`, `addr`, `metricsRow`, `status`.
- `requirements`: `readingSet`, `strike`.
- `planning`: `place`, the stop record.

### Invariants

- **R10** A job's record is its pull request and its state line, both written by the tool; a job never commits a generated artifact. (JOB-1, JOB-8)

### Satisfies

- REQUIREMENTS.md §7 (JOB-1 to JOB-10).

### Suggestions

- `tools/jobs.mjs`, extracted from `tools/proc.mjs` (layer start; job pr/started/route/start/state/complete/takein/posted/reopen/retire/archived); the plan's entries N2-19 to N2-22.
