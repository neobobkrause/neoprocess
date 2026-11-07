# architecture — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §4 (accepted by Bob, 30 Oct 2026) before the module's first START (K5). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

The modules of a product in one total order within layers, and the checks on its code (architecture, ownership, format, words, coverage, fixtures): scoped to a module in the gate, whole at a layer's close, every finding machine-readable with its module, file and line.

### Provides

**modules(R) → the ordered list**
- **R1** Answers `build/modules.json` as one total order: each module in exactly one layer, lower layers first, a layer's modules adjacent, `uses` naming only earlier modules, `from` naming legacy modules placed after the modules extracted from them; a map that breaks this is a finding of the architecture check. (ARC-1; P4)

**run(R, { module }) → { findings, text }**
- **R2** Runs every check scoped to the module named, or whole over the product when none is named; the layer-close run is the whole-product run; one function with the one switch. (ARC-4)
- **R3** Writes one machine-readable result (module, file, line, check, finding) at the path the manifest names (default `checks/result.json`) beside the text it prints, and the gate and `status` read it, so a red is never searched for in a log. (ARC-5, GAT-7)

**the checks** · each answers findings, every one with its module, file and line
- **R4** architecture: every relative import in a module's files names its own module or a module declared in its `uses` and earlier in the order; every file has one owner, the most specific matching path; a violation fails the gate. (ARC-1)
- **R5** ownership: a job's diff touches only its module's paths and tests, its job record and the strike of its own marks; in a legacy module its module names in `from` it may only remove the moved code and rewire callers by an import from its own paths and lines using it, the net change over the legacy modules a removal, every added line listed for the architecture session's reading before the merge. (ARC-2; REQ 9)
- **R6** format: a map entry names a file or directory, except one a live job has not yet written, reported pending while that module's job reads STARTING or WORKING on the state branch and failed once the module's layer has closed; every requirements file parses by `requirements.parse` with no finding; a Test line that `requirements.isMeasurement` names fails. (ARC-1; REQ-3; N2-45)
- **R7** words: a test asserts on a text's key, never on its words: a literal user-facing sentence in a test is a finding that names the key the sentence lives under; every user-facing sentence lives once in the word table, and the words check is the only place text is compared. (ARC-3)
- **R8** coverage: every live requirement id of a module is named by a test at the module's interface; an id named by no test is a finding; a test that cannot fail does not count once the cannot-fail check exists. (P7; INT-2)
- **R9** fixtures: no test hand-builds another module's answer or its words; the fixtures check as it stands at the module's START, unchanged by this tranche. (BLD 5; N2-10)

## Private

### Uses

- `record`: `repo` (files and diffs read at a ref, the state branch read for a job's line).
- `requirements`: `parse`, `isMeasurement`, `marks` (the requirement-file half of the format check; the ids the coverage check counts).

### Invariants

- **R10** A check reads code and record files at a commit and nothing else: never a session, never the network, never the working tree's uncommitted state; the same commit gives the same findings.
- **R11** A check's own tests name their findings by key, as R7 asks of every module.

### Satisfies

- REQUIREMENTS.md §4 (ARC-1 to ARC-5); REQ-3's format half; GAT-7.

### Suggestions

- `checks/run.mjs` and the six check files as today, with the result file added; the plan's entries N2-10 to N2-12 and N2-45.
