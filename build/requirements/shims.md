# shims — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §13 (accepted by Bob, 30 Oct 2026) before the module's first START (K16). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

What a product receives from the process, kept small and checked for drift, and how a product comes under the process.

### Provides

**shims(R, process, repo, ref) → the written files**
- **R1** A product receives exactly: a `CLAUDE.md` under thirty lines naming the pinned process commit and the one command that fetches it; the one skill; a settings file carrying the standing permission list only, with no hooks and no environment; the gate workflow from the gate module's template (every lock file installed where it sits, the product's Node version, triggered only by the module's paths, tests, the files the checks read for it and generated inputs); the prune workflow. A check fails on drift. (SHM-1; GAT-5, GAT-6; PLT-4) *(not yet met: N2)*

**repoShims(R, repo) → the dispatch**
- **R2** A product's shims are regenerated on GitHub's runner and merged by pull request, never by a session attaching a second repository; the workflow runs with the product owner's own token, from the process repository where that owner holds a secret there, or from the product's own repository with its own secret, so an owner who is not Bob needs nothing on the process repository. (SHM-2; PLT-8, PLT-9, PLT-13) *(not yet met: N2)*

**init(R, mode) / initCheck(R) / onboardStart(R, session)**
- **R3** Onboarding writes the build state's skeleton, the grant list and the first plan; measures the product against REQUIREMENTS.md §0's sizes and reports each dimension beyond the proven range to Bob before the first tranche; and records the product's route to the process (public read, a read grant, or reports carried by its owner) as the value platform's `processRoute` reads. (SHM-3; PLT-14; MNT-10) *(not yet met: N2)*
- **R4** The steps printed for a new or moved product name a session created on that repository (`create_session` with its URL), never `add_repo`. (PLT-2, PLT-3) *(not yet met: N2)*

**trancheCarry(R, from)**
- **R5** A product with a tranche running at conversion carries it by one command, which removes stale local tracking refs first. (SHM-4) *(not yet met: N2)*

## Private

### Uses

- `platform`: `acts`, `processRoute`, the runner workflows' dispatch.
- `record`: `repo`, `commitPush`.
- `gate`: the workflow template.
- `planning`: `trancheOpen` (the carried tranche).
- `maintenance`: the pinned commit.

### Invariants

- **R6** A product's own session setup (toolchain, installs) is the product's script, named in its manifest and run by its sessions' first command, never by a hook. (SHM-5; PLT-4) *(not yet met: N2)*
- **R7** The process repository is gated as a product by its own `gate.yml`, written by this module, from the layer this module's job merges in. (MNT-1; ARC-1) *(not yet met: N2)*

### Satisfies

- REQUIREMENTS.md §13 (SHM-1 to SHM-5).

### Suggestions

- `tools/shims.mjs`, extracted from `tools/proc.mjs` (`shims`, `settingsText`, the CLAUDE.md template, the workflows, `init`, `initCheck`, `onboardStart`, `tranche carry`); the plan's entries N2-41 to N2-44.
