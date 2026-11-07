# maintenance — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §12 (accepted by Bob, 30 Oct 2026) before the module's first START (K16). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

The process fixed and built under itself: flaw reports in and replies out; one pinned version per project between stops; proof layer by layer; the certification mark only after a real product's full tranche, deployment and walk.

### Provides

**issue file / ack / close / reply / seen; productReports; processReplies**
- **R1** A flaw report is filed from any session by one command, listed by the process's architecture session at each `status`, acknowledged, and answered by `main`; a flaw found anywhere is never fixed in place. (MNT-6; GOV 5)

**versionCheck(R) → PROCESS OK | STALE**
- **R2** A project runs one pinned process version from one stop to the next, named in its plan's Status line; each session checks once, at its start, that its process copy is at that commit and says so in its first line; no command checks again. (MNT-3)

**versionNewer(R) → newer commit | none**
- **R3** Whether a newer process version exists is read anonymously from the public process repository at a layer's close and offered there as a stop; with none, or none taken, the next layer starts at once. The pin moves only through planning's stop and resume, never while a job runs. (MNT-3, MNT-4; PLT-13)

**blocks(R, report, decision, why)**
- **R4** A flaw found while a layer runs is decided by the architecture session as blocking (a stop) or waiting (the next process release and the product's next tranche), and the decision is recorded with its reason. (MNT-5, MNT-8)

**versionNote(R) → VERSIONS.md**
- **R5** Each process version's note names the platform rows, the layers and stages, with their product sizes, it has been proven by, and whether it holds the certification mark; a layer's close appends its proof row; the mark is written only after a real product's full tranche, the deployment of its release and a walk of that release. (MNT-7, MNT-10)

## Private

### Uses

- `platform`: `processRoute`, `constraints`.
- `record`: `stateRead`, `stateWrite`, `commitPush`, `status`.
- `planning`: `stop`, `resume`, `report`.
- `integration`: `layerClose` (the proof row's caller).
- `messages`: the report and reply routes.

### Invariants

- **R6** The process is a product under itself: its modules in `build/modules.json`, their requirements in `build/requirements/`, each change a job with its own tests and a review, built in tranches with the version in use frozen. A process tranche runs on the last certified version, or while none holds the mark on the last proven one. (MNT-1, MNT-2)
- **R7** The process's own architecture session is started by Bob and refreshed by handoff; it starts no successor and arms no required task. (MNT-9)
- **R8** Nothing here checks the process version per command or on a timer. (MNT-3)

### Satisfies

- REQUIREMENTS.md §12 (MNT-1 to MNT-10).

### Suggestions

- `tools/maintenance.mjs`, extracted from `tools/proc.mjs` (the issue commands, `productReports`, `processReplies`; `processRefresh` becomes `versionNewer`, `processBehind` the start-time check with platform's `versionCheck`); `lane-neoprocess/` folded into the build state and DRYRUN's rows into the version note; the plan's entries N2-38 to N2-40.
