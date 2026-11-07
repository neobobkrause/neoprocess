# requirements — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §5 (accepted by Bob, 30 Oct 2026) before the module's first START (K5). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

A module's requirements file as the thing a module is built and proven from: its two parts, its permanent ids and marks, the one parser every check and job reads it with, the line between a test and a measurement, and the measure of a job's reading set against a budget drawn from the model's window.

### Provides

**parse(text) → { purpose, provides, uses, invariants, satisfies, suggestions, ids }**
- **R1** Parses a requirements file into its public part (Purpose; Provides, each service block with its interface line and the `R<n>` statements under it) and its private part (Uses as `<module>.<service>`, Invariants, Satisfies citing the canon by section, Suggestions, which bind nothing); every statement is under a permanent `R<n>`; a duplicate id, a statement without one, or a part missing is a finding the format check reports. (REQ-1)
- **R2** `serviceBlocks(text)` answers the provided services with their names and text, so a change to what a module provides is read as the blocks whose text differs and the names an export line adds or drops. (REQ-1; GAT-3)

**marks(text) → list** · **strike(text, ids, tranche) → text**
- **R3** Reads the `*(not yet met: T)*` marks by id; `strike` removes a mark, or one tranche from a mark's list, on the ids named and changes nothing else; a retired id reads `retired` or `moved to <module> R<n>` and is never reused. (REQ-4; REQ 5)

**isMeasurement(line, manifest) → boolean**
- **R4** A Test line naming a fixture above the size the product's manifest sets (`build/manifest.md`, default 100,000 rows), or a figure on a deployed copy, is a measurement: it belongs in the plan under its own id, never in a requirement's Test line, and a review never counts an untaken measurement as a gap; the review brief carries that sentence from here. (REQ-3)

**readingSet(R, module, table) → { files, bytes, budget, over, trimmed }**
- **R5** Measures a job's set (its START, its requirements both parts, its entries, its layer's contract, its code, of each used module the services its entries touch, the tests naming an id its entries change) in bytes against a budget that is a fraction of the model's context window read from the Sessions table, never a byte literal in code; a set over budget is recorded with its size, the module and what was trimmed or split, and the job is not started. (REQ-6, SES-5, SES-6)
- **R6** A module's own requirements are never replaced by a summary: no summary path exists for them; a summary of another text in a set is allowed only as P20 states (helpers read the sources whole, every statement cites its source), is recorded, and is never required by the tool. (SES-7)

## Private

### Uses

- `record`: `repo` (a file read at a ref, a path's size).

### Invariants

- **R7** Parsing and measuring are pure: no git write, no network, no session; the only read is through `record.repo`.
- **R8** The parser accepts every requirements file on the product's tranche as it stands, so a change here never fails a merged module's format check.

### Satisfies

- REQUIREMENTS.md §5 (REQ-1 to REQ-6).

### Suggestions

- `tools/requirements.mjs`, extracted from `tools/proc.mjs` (`serviceBlocks`, the mark strike of `job complete`, `readingSet`) and `checks/format.mjs` (the requirement-file half); the plan's entries N2-13 to N2-15.
