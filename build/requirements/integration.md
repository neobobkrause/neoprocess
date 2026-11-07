# integration — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §9 (accepted by Bob, 30 Oct 2026) before the module's first START (K8). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

Work counts only when merged and proven: the review decision and its worker, the merge of a green current tip, the layer's close with its tests, the tranche's close, the release.

### Provides

**reviewDecide(R, module, reason) / reviewResult(R, module, result)**
- **R1** A review is decided by judgment from the listed reasons (a new module, a changed provided service, a sensitive path, a large diff, thin evidence, a third completion) and the decision written; the reviewer is a fresh worker that never saw the job, reads only the module's requirements, the diff and the job's report, and reports gaps against the requirements with file and line; a measurement not yet taken is not a gap; the verdict is posted on the pull request, and gaps reach the job as a CHANGE. (INT-2; REQ-3)

**merge(R, module, head, gate) / merged(R, module, sha)**
- **R2** Merges, by the printed call, a tip that is green on the gate, current with the tranche, COMPLETE with nothing owed, reviewed and approved where a review ran, and in the order the plan names; a tip behind the tranche is updated first unless it differs only by record paths; a red is never merged; the merge is recorded from GitHub, never from a report; nothing here depends on archiving a session. (INT-1, INT-3, INT-6)

**layerClose(R, layer)**
- **R3** Closes a layer when every pull request is merged, the layer's tests (where the manifest names them) pass once over the merged layer, and the checks pass whole over the product; a red in the layer's tests goes back to the responsible module's job as a CHANGE, the jobs staying live until the close; it regenerates and commits the artifacts once, lists platform's stale constraint rows, and prints the next layer's start; the layer's proof row and the offer of a stop for a newer process version are maintenance's (its R3, R5), called by the layer-close command once maintenance exists. (INT-4; platform R2; K24)

**trancheClose / closePr / releaseCut / deploy / walk**
- **R4** The close pull request to `main` is merged only once the plan reads CLOSING, and `main` moves by nothing else, proven by a fixture test of the close and merge commands as they stand; the tranche close itself is planning's (its R2), the report's first-run line planning's (its R7), and the release cut, its deployment and the walk stay as REL 1 to REL 8 state them, run by no command. (INT-5; REL 1 to REL 8; K24) *(not yet met: N2)*

**jobRetire's record / bobRelease / defect**
- **R5** A job's retirement and a BOB's release are record lines; `defect` writes a metrics row naming the module, the round and whether its merge was reviewed, so the review decision is tuned by evidence. (INT-6; INT 10)

## Private

### Uses

- `platform`: `acts` (the pull request and merge calls as printed), `limits`.
- `record`: `stateRead`, `stateWrite`, `commitPush`, `metricsRow`, `addr`.
- `planning`: `place`, `report`, the stop record.
- `jobs`: `jobReopen`, `jobRetire`, the job lines.
- `gate`: `runGate`'s result, `gateNeutral`.

### Invariants

- **R6** Nothing here calls `archive_session`, `update_trigger`, `delete_trigger` or `interrupt_session`, or prints one as owed. (PLT-2)
- **R7** Every merge and every other repository act is the architecture session's, never asked of Bob; the one act of his is approving a GitHub release. (GOV 10)

### Satisfies

- REQUIREMENTS.md §9 (INT-1 to INT-6).

### Suggestions

- `tools/integration.mjs`, extracted from `tools/proc.mjs` (review decide/result, merge, `gateNeutral`, merged, layer close, tranche close, the release commands); the plan's entries N2-27 to N2-29.
