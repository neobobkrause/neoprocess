# planning — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §6 (accepted by Bob, 30 Oct 2026) before the module's first START (K8). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

Tranches, rounds and layers as the only structure a build has; entries placed at once and never deferred without a hard reason; stop and resume as first-class records; the tranche report with the process's own overhead measured.

### Provides

**trancheOpen(R) / trancheCarry(R, from) / trancheClose(R) → the plan's state**
- **R1** Opens a tranche on `tranche` fast-forwarded to `main`, the plan copied whole from `next.md` to `current.md` with its legacy census first and its Status line naming the pinned process commit; refuses while an archived plan on `main` reads CLOSING, while the words check reports a finding, or while the grant check is missing, failed or older than a day. (PLN-1, PLN-2; PLN 5, PLN 8; PLT-10)
- **R2** Closes a tranche only when every round is archived and every job merged: merges `main` into `tranche` (never a rebase), writes the plan's archive with each entry's outcome and the tranche's measured usage, sets CLOSING, and prints the one close pull request. (PLN-6; REL 2)

**roundOpen(R) / roundClose(R)**
- **R3** Opens a round by copying its entries whole, grouped by module under their layers, and refuses while another round is open; the completion round has its own file, distinct from the next tranche's list, opened after the last layer and needing no approval. (PLN-3, PLN-4; PLN 5, PLN 7)

**partial(R, layer, modules, reason)**
- **R4** Records a layer started in part, with the modules and the architecture session's reason, in the plan, so the subset is on the record and the rest start once it has merged. (PLN-8)

**stop(R, why, choices) / resume(R, version)**
- **R5** Records a stop once in the plan's Status line (`STOPPED <why> · <version>`), by the architecture session, with each unmerged job marked complete-allowed or abandoned, through `record.stop`; `resume --version <commit>` clears it and moves the pin once; nothing else moves the pin, and every role's `status` shows the stop. (PLN-5; MNT-3, MNT-4)

**place(R, entry, module) → where it went**
- **R6** Places work found while a round runs at once: in the running job of its module as a CHANGE, else in the START of its module's job in a layer not yet started, else in the completion round; an entry leaves the tranche only for one of P19's three reasons, named beside it, and the format check refuses any other. (PLN-2, PLN-3)

**report(R) → the tranche report**
- **R7** States elapsed time, the work finished (legacy lines removed, entries applied), each deferred entry with its reason, the work left, the cost, the share that was the process's own overhead (commits by purpose, sessions per job, gate runs per merged job, restarts, tokens by role, computed from git and the metrics), and any stage that runs for the first time under a version. (PLN-6, SES-12; INT-5)

**ruling(R, text, why, files) / footprint(R)**
- **R8** Writes a ruling as one line `K<n> · date · area · ruling · why` in `build/rulings.md`, committed with the files it changes; `footprint` as today. (GOV 7; REL 10)

## Private

### Uses

- `platform`: `grantsHeld` (tranche open's grant check).
- `architecture`: the words check and `run` (the whole-product checks at tranche open and close).
- `record`: `stateRead`, `stateWrite`, `planEdit`, `commitPush`, `stop`, `resume`, `metricsRow`, `status`.
- `requirements`: `parse` (a plan entry's requirement ids checked against the module's file).

### Invariants

- **R9** No function reads or writes a path outside the product's own repository; two products on one account run tranches independently (a test with two product fixtures on one checkout). (PLN-7)
- **R10** The only structure assumed is layers within rounds within tranches; nothing here assumes a product's size or shape. (PLN-1)

### Satisfies

- REQUIREMENTS.md §6 (PLN-1 to PLN-8).

### Suggestions

- `tools/planning.mjs`, extracted from `tools/proc.mjs` (tranche open/carry/close, round open/close, footprint, ruling); the plan's entries N2-16 to N2-18.
