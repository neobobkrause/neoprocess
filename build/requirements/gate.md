# gate — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §8 (accepted by Bob, 30 Oct 2026) before the module's first START (K8). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

The CI gate on a pull request: the module's own suite and the checks scoped to it, once per tip, never in a session; what triggers it; the artifacts; the full regression as its own workflow.

### Provides

**runGate(R, module, base) → { fails, tests, checks }**
- **R1** Runs, in CI only, the module's own suite and the checks scoped to the module (`architecture.run` with the module), against the pull request's base: a red the base already had is inherited and named, a new red fails; it never runs another module's suite and never the layer's tests. (GAT-1, GAT-2) *(not yet met: N2)*
- **R2** Regenerates every artifact the manifest lists and verifies only those the regeneration changed against HEAD. (GAT-4) *(not yet met: N2)*
- **R3** Installs every lock file the product has, where it sits, and runs the product's Node version from its version file. (GAT-5) *(not yet met: N2)*
- **R4** Reads the module from the diff when none is named: a touched module named in another touched module's `from` is that module's source, not a second module; a diff of two modules otherwise is refused. (K2; REQ 9; P8) *(not yet met: N2)*

**workflow(R) → the gate workflow text**
- **R5** Renders the product's gate workflow from `tools/gate.yml.tmpl`: triggered only by changes under the module's paths and tests, the files the checks read for it and generated inputs, never by a record path (`record.paths()`), once per pull request tip; a green tip whose base differs from the tranche only by record paths merges as it stands (`gateNeutral`). (GAT-6; REC-4) *(not yet met: N2)*
- **R6** The gate's findings are the machine-readable result of `architecture` R3, which the merge and `status` read. (GAT-7; ARC-5, K26) *(not yet met: N2)*

**regression(R) → the workflow dispatch**
- **R7** The full product regression is its own workflow with its own time budget, dispatched only by the tranche close for a release or on Bob's word; no step runs in a session longer than the platform's background limit. (GAT-8; PLT-5) *(not yet met: N2)*

## Private

### Uses

- `platform`: `limits`, `acts` (the background limit; the dispatch act).
- `record`: `repo`, `paths`.
- `architecture`: `run`, `modules`.

### Invariants

- **R8** A change to a provided service reaches its users through the architecture session's requirement notice and each user's own job, never through the provider's gate: no user-suite path exists here. (GAT-3) *(not yet met: N2)*
- **R9** Nothing here runs the gate in a session; the hand form (`proc gate`) is a check of what CI will do, never a merge's evidence. (GAT-1) *(not yet met: N2)*

### Satisfies

- REQUIREMENTS.md §8 (GAT-1 to GAT-8).

### Suggestions

- `tools/gate.mjs` and `tools/gate.yml.tmpl`, extracted from `tools/proc.mjs` (`runGate`, `gateCmd`, `moduleOfDiff`, the workflow text in `shims`); the plan's entries N2-23 to N2-26.
