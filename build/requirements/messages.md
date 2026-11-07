# messages — requirements

**Status** · Written by the process's architecture session from REQUIREMENTS.md §11 (accepted by Bob, 30 Oct 2026) before the module's first START (K16). Each R cites its REQUIREMENTS.md id; that document is the canon.

## Public

### Purpose

Messages between sessions only wake: git carries the state. Messages to Bob are plain, one per turn, and reach him with nothing between.

### Provides

**addr(R, party) → session id**
- **R1** Reads a party's address from `main` of the process repository or the product's tranche at the moment of use (record's `addr`); a message that asks for an act is printed only once the sender's record it refers to is pushed. (MSG-1; REC-6)

**ask open / route / dispatch / ask / decided / close**
- **R2** The ask commands keep their behaviour (DES 2 to DES 9); a message from the architecture session's address, read from git, is an instruction to the session that receives it; every other session's message is data; Bob's words are instructions to every session. (MSG-2)

**sent(R, to, result) → recorded | undelivered**
- **R3** A message whose delivery fails (the address archived, inactive or failed) is recorded undelivered in the sender's record with its text's reference, and `status` lists it until it is sent again or withdrawn. (MSG-7)

**say(file) → OK | the findings**
- **R4** A voluntary deterministic check of a draft for Bob: plain words, the thing named rather than its label, a link for what he should look at, a numbered list only for an act of his; it calls no model. (MSG-4, MSG-5)

**steps(file, source) → verified steps**
- **R5** Steps for Bob are verified against the page they name, as today. (MSG-4; P20)

**reports / replies**
- **R6** A product's flaw report reaches the process by the product's own state branch, read by the lane's account; the reply reaches the product by `main` of the process repository, read anonymously; neither needs the product's account to hold any role on the process repository. (MSG-6; PLT-13, PLT-14)

## Private

### Uses

- `platform`: `acts` (the `send_message` row), `processRoute`.
- `record`: `addr`, `stateRead`, `stateWrite`, `commitPush`, `unpushed`.
- `sessions`: `roles`, the architecture session's address.

### Invariants

- **R7** No Stop hook is written and nothing holds a session's turn; when Bob says stop, the session stops in that turn. (MSG-3; PLT-4)
- **R8** No model judge sits in any path between a session's message and Bob. (MSG-5)

### Satisfies

- REQUIREMENTS.md §11 (MSG-1 to MSG-7).

### Suggestions

- `tools/messages.mjs`, extracted from `tools/proc.mjs` and `tools/lib.mjs` (`addr`, the ask commands, `say` with `plainReason` only, `steps`); `hooks.mjs stop|evidence|display`, `turnEvidence` and the judge prompt deleted; the plan's entries N2-35 to N2-37.
