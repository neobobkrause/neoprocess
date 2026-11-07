# sessions — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §10 (accepted by Bob, 30 Oct 2026) before the module's first START (K16). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

Who starts whom, how a role hands over to its successor, what each role reads and within what budget, which model it runs on, and what a session cost; with no step depending on archiving a session or on a session starting its own successor.

### Provides

**roles() → the role table**
- **R1** The roles are the architecture session of a product, the process's own architecture session, jobs, lanes, and reading or review workers; ROOT exists only as a depth-0 starter of architecture sessions, does nothing else, and is replaced only by Bob; every printed `create_session` comes from a party at depth 0 or 1, so no session's depth passes 2. (SES-1; PLT-6) *(not yet met: N2)*

**takeover(R, name, session) / handoff(R) / processStart(R, branch, session) / processHandoff(R)**
- **R2** A refresh is a handoff the tool writes from git, at most one screen; the successor is started by the depth-0 starter (Bob, or ROOT) from it, never by its predecessor; the predecessor idles and nothing owes its archive. For the process's own architecture session the start records the role and the handoff writes the START file for Bob's `create_session`; no archive, backstop or address-announce act is printed as owed. (SES-2; MNT-9; PLT-2, PLT-7) *(not yet met: N2)*
- **R3** `status` prints the session's context share from `get_session` (or the transcript where `get_session` reads 0, a platform row) and REFRESH when it passes the role's threshold (the architecture session 40 %, a job or lane 50 %, ROOT 55 %); the threshold is text and a print, never a hook. (SES-3) *(not yet met: N2)*

**readingSet(R, role | module) → [{file, bytes}], budget**
- **R4** Each role's reading set is fixed in advance and printed with its sizes at the session's start. (SES-4) *(not yet met: N2)*
- **R5** Budgets are fractions of the model's context window, held in one table; no byte limit is a literal in code. (SES-5) *(not yet met: N2)*
- **R6** A set over its budget is measured before the session starts and recorded with its size and what bringing it under cost; the session is not started until the set is under, by trimming or splitting; the overrun is reported in the tranche report. A module's own requirements are never replaced by a summary; any other text in a set may be summarised only by helpers that read its sources whole, each statement citing its source, recorded, and never required by the tool. (SES-6, SES-7; REQ-6) *(not yet met: N2)*

**models() → the Sessions table**
- **R7** Each start command picks the model and effort from the table in SESSIONS §1. (SES-8) *(not yet met: N2)*

**auditReads(R, layer) → findings**
- **R8** Reads a sample of the layer's job transcripts (`list_events`) for one whole read of the module's requirements file, no offset and no limit, before the job's first write, and files a flaw report for each miss. (SES-9; REC-8) *(not yet met: N2)*

**usage(R, session) → counts | unmeasured**
- **R9** A session's usage is read by a route the platform table lists as dependable, never by archiving; where none answers it is recorded unmeasured, never estimated. (SES-10) *(not yet met: N2)*

## Private

### Uses

- `platform`: `acts`, `constraints`, `limits`.
- `record`: `stateRead`, `stateWrite`, `commitPush`, `metricsRow`, `status`, `addr`.
- `requirements`: `parse` (the module's requirements file for R6 and R8).
- `planning`: `report` (R6's overrun line).
- `jobs`: the job lines (`job route`'s replacement of a dead session).

### Invariants

- **R10** Workers run in the background and write only their result file. (SES-11) *(not yet met: N2)*
- **R11** The process's overhead per tranche (commits by purpose, sessions per job, gate runs per merged job, restarts, tokens by role) is computed from the record this module writes. (SES-12) *(not yet met: N2)*
- **R12** No step counts on a session's parent being alive; a COMPLETE job outliving two architecture sessions is ordinary. (SES-13) *(not yet met: N2)*
- **R13** Nothing here calls `archive_session`, `update_trigger`, `delete_trigger` or `interrupt_session`, or prints one as owed. (PLT-2) *(not yet met: N2)*

### Satisfies

- REQUIREMENTS.md §10 (SES-1 to SES-13); MNT-9.

### Suggestions

- `tools/sessions.mjs`, extracted from `tools/proc.mjs` (takeover, handoff, root start/bob, lane commands, `bobArchived`, `process start/handoff/archived`, the models table, `readingSet`); the plan's entries N2-30 to N2-34.
