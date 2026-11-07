// neoProcess's hooks (PROTOCOL §9, JOB-LIFE §11, SESSIONS §1a; rulebook SES 1, 3, 6, 8). Registered by the one skill
// `neoprocess`, whose argument is the role; the hooks read the role from `.git/proc-role.json`, written by the start
// commands (`proc takeover`, `proc job start`, `proc lane start`; `proc process start` for the neoProcess lane), and refuse every act until one is recorded, so the role
// is set by the record and never by which skill was invoked. Claude Code passes the event as JSON on stdin; this script
// always exits 0 and answers in JSON: a PreToolUse refusal as `permissionDecision: "deny"` (a pre-approved act of the
// act table as `"allow"`, PERMISSIONS §8.6), a Stop refusal as
// `decision: "block"`. What it refuses is what must never happen (code, P16); what a goal sends a session back for is text.
//   node tools/hooks.mjs <pre|post|display|stop|evidence>
// Pushes: a job pushes only `job/<m>`, a lane only `tranche`, BOB `tranche` (its prepared files, P18); nobody pushes
// `main` or a `state/*` branch by hand (the tool writes the state branch by plumbing). JOB-LIFE §4's "any push to the
// tranche branch" is read as: a job's work reaches `tranche` only through the queue; BOB's hand merge of a job branch,
// `gh pr merge` and the merge tool are refused but for the call `proc merge` printed, so no push of BOB's can carry a job around the gate.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT_BOB_FILE, repo, readRole, unpushed, status, addr, parsePlan, parseJob, stateRead, jobSession, laneSession, processSession, processTriggerReason, jobBranch, jobFiles, lanes, refusalsOf, TRANCHE, ghRepo, PROCESS, processRepo, backstopReason, ISSUE_FILE, ISSUES_FILE, BACKSTOP_FILE, ISSUE_FRESH_MIN, WORKERS_FILE, TOOKOVER_FILE, runningWorkers } from './proc.mjs';
import { recordLocal } from './record.mjs';
import { resolve, sep } from 'node:path';
import { stepsReason, lastAssistantText, plainReason, BOB_READS, judgeReason, EVIDENCE_MODEL, saidPassed, SAY_HINT } from './lib.mjs';
import { spawnSync } from 'node:child_process';   // P20: steps for Bob verified against their source (`proc steps`)

const REMOTE = 'mcp__claude-code-remote__', GH = 'mcp__github__', PROCESS_TRIGGER_FILE = 'proc-process-trigger.json';
// A push is `push` as git's subcommand, after git's own options (`-C <dir>`, `-c <k=v>`, `--flag`), never the word in a
// commit message (`git commit -m "… push …"` was refused as a push to its words, #7, 29 Oct).
const GIT_SUB = String.raw`\bgit(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+`;
const FORCE = new RegExp(GIT_SUB + String.raw`push\b[^|;&]*(\s(-f|--force|--force-with-lease|--mirror|--delete|-d)\b|\s\+\S+|\s:\S)`);
const PUSH = new RegExp(GIT_SUB + String.raw`push\b([^|;&]*)`);
const REDIRECT = /(\d*>>?&\d+-?|&>>?\s*[^\s|;&]+|\d*>>?\s*[^\s|;&]+|<+\s*[^\s|;&]+)/g;
// A hand merge, tag, branch, reset, rebase or pull request from a state branch (PROTOCOL §7d).
const STATE_REF = /\bgit\b[^|;&]*\b(merge|tag|branch|checkout|switch|worktree|rebase|cherry-pick|reset|pull)\b[^|;&]*\bstate\//;
const LONG = /(?:^|[\s;&|(])node\s+(?:\S+\/)?proc\.mjs\s+(job\s+complete|layer\s+close)\b/;
const START_CMD = /(?:^|[\s;&|(])node\s+(?:\S+\/)?proc\.mjs\s+(takeover|job\s+start|lane\s+start|root\s+start|process\s+start|onboard\s+start)\b/;
const WRITES = /\bgit\b[^|;&]*\b(push|commit|merge|rebase|reset|tag|branch|checkout|switch)\b|(?:^|[\s;&|(])(rm|mv|cp|tee|sed\s+-i|gh)\b|(?<![<>])>(?!>)|>>/;
// a redirect that writes no file: a descriptor duplicated (`2>&1`, `>&2`) or sent to /dev/null (issue 69)
const NO_FILE = /\d*>&\d+-?|\d*>>?\s*\/dev\/null\b/g;
const GH_CLI = /(?:^|[\s;&|(])gh\s+pr\s+(merge|ready|review|edit|close|reopen|create)\b/;
const NAME = /^[A-Z][A-Z0-9-]* #\d+$/;

// P20, rulebook SES 3: a document of a reading set is read whole; a Read with an offset or limit, or a shell cut in the
// same pipeline as one, stops before its end and is refused. A search is not judged here.
export const SET_DOC = /(?:^|[\s/'"=])(PROCESS-DESIGN\.md|\.claude\/rules\/[\w-]+\.md|rulebooks\/[\w-]+\.md|build\/(?:layers|lanes|manifest)\.md|build\/requirements\/[\w.-]+\.md|build\/lanes\/[\w-]+\/(?:charter|decisions)\.md|build\/plan\/current\.md)(?=$|[\s'"|;&)])/;
const CUT = /(?:^|[\s|;&(])(?:head|tail)\b|\bsed\s+(?:-\w*\s+)*-n\b|\bcut\s+(?:-\w+\s+)*-c/;
export function partialReadReason(tool, ti) {
  const why = (f) => `${f} is in a reading set and is read whole (P20; a read that stops before the end is a scan): read it with no offset or limit, or \`cat\` it; a set too large to read whole is BLOCKED: reading (SESSIONS §6)`;
  if (tool === 'Read' && (ti.offset != null || ti.limit != null)) { const m = String(ti.file_path || '').match(SET_DOC); if (m) return why(m[1]); }
  if (tool === 'Bash') for (const pipe of String(ti.command || '').split(/;|&&|\|\||\n/)) { if (CUT.test(pipe)) { const m = pipe.match(SET_DOC); if (m) return why(m[1]); } }
  return null;
}
const refs = (push) => push[1].trim().split(/\s+/).filter((w) => w && !w.startsWith('-') && w !== 'origin').map((r) => r.split(':').pop().replace(/^refs\/heads\//, ''));
const R_of = (ctx) => repo(join(ctx.root, ctx.product || '.'));
// The one branch a role pushes: a job its job branch, the neoProcess lane the branch its start recorded, every other `tranche`.
const ownBranch = (role, ctx) => (role === 'job' ? jobBranch(ctx.module) : role === 'process' || role === 'onboard' ? ctx.branch : TRANCHE);
// The neoProcess lane regenerates a product's shims after the process repository is renamed or moved (PERMISSIONS §9.5, §9.6):
// that push names the product's URL, never `origin`, and only the branch `shims`, which the product's `main` ruleset takes by a
// pull request. (#11, 29 Oct: the onboarding role's route of #9 was refused as Self-Modification in a two-repository session.)
export const SHIMS_BRANCH = 'shims';
function shimsPush(role, push, ctx) {
  if (role !== 'process') return false;
  const words = push[1].trim().split(/\s+/).filter((w) => w && !w.startsWith('-'));
  const m = words[0]?.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (!m || words.length < 2) return false;
  if (!words.slice(1).every((r) => { const [l, t] = r.includes(':') ? r.split(':') : [r, r]; return t.replace(/^refs\/heads\//, '') === SHIMS_BRANCH && ['HEAD', SHIMS_BRANCH].includes(l.replace(/^refs\/heads\//, '')); })) return false;
  let own; try { const g = ghRepo(R_of(ctx)); own = `${g.owner}/${g.repo}`; } catch { return false; }   // the process repository's remote unreadable: not proven another repository
  return m[1] !== own;
}
const WHO = { job: 'a job', lane: 'a lane', bob: 'BOB', root: 'ROOT', process: 'the neoProcess lane', onboard: 'the onboarding session' };
// The two roles outside a running product (no state branch, no BOB): the neoProcess lane and an onboarding session (ONBOARDING §1).
const OUTSIDE = new Set(['process', 'onboard']);
// The process checkout, wherever this hook runs from: a product session's edit there is refused (GOV 5).
const insideProcess = (f) => { if (typeof f !== 'string' || !f) return false; const p = resolve(f), root = resolve(PROCESS); return p === root || p.startsWith(root + sep); };
// A process issue (Bob, 30 Oct): filed by any role only as `proc issue` printed it, closed by the lane only as `proc issue
// close` printed it, both on the process repository; an issue elsewhere is not the process's to judge (undefined).
const record = (ctx, f) => { try { return JSON.parse(readFileSync(join(ctx.root, '.git', f), 'utf8')); } catch { return null; } };
const same = (a, b) => JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]])) === JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k]]));
export function issueReason(role, ti, ctx, now = Date.now()) {
  let own; try { own = processRepo(); } catch { return undefined; }
  if (ti.owner !== own.owner || ti.repo !== own.repo) return undefined;
  const r = record(ctx, ISSUE_FILE) || {};
  if (ti.method === 'create') {
    if (r.call && same(r.call, ti) && now - Date.parse(r.at) < ISSUE_FRESH_MIN * 60e3) return null;
    return `a process issue is filed only as \`proc issue --title "<the flaw>" --file <report.md>\` printed it, unchanged, within ${ISSUE_FRESH_MIN} minutes`;
  }
  if (role === 'process' && r.close && same(r.close, ti) && now - Date.parse(r.closeAt) < ISSUE_FRESH_MIN * 60e3) return null;
  return role === 'process' ? 'the lane closes a process issue only as `proc issue close` printed it, once its fix is on main' : `only the neoProcess lane changes a process issue; ${WHO[role] ?? role} files one (\`proc issue\`) or comments on it`;
}
// The fresh reader (rulebook SES 9; issue 61): the skill `neoprocess-reader` registers a prompt-type Stop hook, a model
// given only the message and who Bob is. A prompt hook cannot read the role, so the skill is invoked only by the roles Bob
// reads; the post event records it once the call has run, and their Stop hook refuses a turn's end until it is on for the session.
export const READER_SKILL = 'neoprocess-reader', READER_FILE = 'proc-reader.json';
const isReader = (name) => String(name || '').replace(/^.*:/, '') === READER_SKILL;
export function readerReason(role, ctx) {
  if (!BOB_READS.has(role)) return null;
  // a product gets the skill with its shims; until they are regenerated it has none to invoke, and the plain-words check stands alone
  if (!existsSync(join(ctx.root, '.claude', 'skills', READER_SKILL, 'SKILL.md')) && !existsSync(join(PROCESS, '.claude', 'skills', READER_SKILL, 'SKILL.md'))) return null;
  return record(ctx, READER_FILE)?.session === ctx.session && ctx.session ? null : `the fresh reader is not on for this session: invoke the skill ${READER_SKILL} (rulebook SES 9), then end the turn again`;
}
const unpushedReason = (ctx, what) => { const u = unpushed(R_of(ctx)); return u.length ? `${what} only once your record and work are pushed (PROTOCOL §2, §7b): ${u.join('; ')}` : null; };

// The reason a tool call is refused, or null. `ctx` is the role file's record plus `root`; `role` null until one is recorded.
export function preReason(role, input, ctx) {
  const tool = input.tool_name || '', ti = input.tool_input || {};
  const partial = partialReadReason(tool, ti); if (partial) return partial;
  const c = tool === 'Bash' ? String(ti.command || '').replace(REDIRECT, ' ') : '';
  if (!role) {
    if (tool === 'Bash' && START_CMD.test(String(ti.command || ''))) return null;
    if (['Write', 'Edit', 'NotebookEdit', 'Agent'].includes(tool) || tool.startsWith('mcp__') || (tool === 'Bash' && WRITES.test(String(ti.command || '').replace(NO_FILE, ' ')))) return 'no role is recorded for this session: read your set, then run your start command (`proc takeover`, `proc job start`, `proc lane start`, `proc root start` for ROOT, `proc process start` for the neoProcess lane, `proc onboard start` for an onboarding session) before any act (SESSIONS §1a)';
    return null;
  }
  if (tool === 'Bash') {
    if (FORCE.test(c)) return 'a force push, mirror or remote delete is never done by hand (standing safety rule; the tool alone deletes a state branch or a merged job branch)';
    if (STATE_REF.test(c)) return 'nothing merges, tags, branches, resets or pulls from a state branch: it is thrown away whole (PROTOCOL §7d)';
    const lp = c.match(LONG);
    if (lp && ti.run_in_background !== true) return `\`proc ${lp[1].replace(/\s+/g, ' ')}\` runs for minutes and a message reaches you only between tool calls (P13; rulebook SES 6): run it with run_in_background true and timeout 7200000 (two hours, the platform's most: a gate with many users outlived the default half hour, issue 113), then end your turn or do other work until its completion notice arrives`;
    if (GH_CLI.test(c)) return 'a pull request is opened, marked ready, reviewed and merged only as `proc` prints the call (JOB-LIFE §11); the queue merges';
    if (/\bgit\b[^|;&]*\bmerge\b[^|;&]*\bjob\//.test(c)) return `a job branch is merged only by the queue, after \`proc merge\` (JOB-LIFE §6)${role === 'job' ? '; your own module\'s branch from an earlier round is taken in by `proc job takein --branch job/<tranche>/<module>` (JOB-LIFE §1a)' : ''}`;
    const push = c.match(PUSH);
    if (push) {
      const to = refs(push);
      if (to.some((r) => r === 'main')) return 'nothing is pushed to main: the tranche reaches main only by its close PR (P12)';
      if (to.some((r) => r.startsWith('state/'))) return 'the state branch is written only by the tool (PROTOCOL §7d)';
      if (shimsPush(role, push, ctx)) return null;
      const own = ownBranch(role, ctx);
      if (!own || to.some((r) => r !== own)) return `${WHO[role] ?? role} pushes only ${own ?? 'the branch its start recorded'} (JOB-LIFE §11)${role === 'process' ? ', or a product\'s regenerated shims to its branch `shims`, its URL named (PERMISSIONS §9.5)' : ''}`;
    }
    return null;
  }
  // GOV 5 (Bob, 30 Oct): a process flaw found in any project is filed as an issue and never fixed in place
  if (role !== 'process' && ['Write', 'Edit', 'NotebookEdit'].includes(tool) && insideProcess(ti.file_path || ti.notebook_path)) return `the process is never changed in place by ${WHO[role] ?? role}: file the flaw as an issue on the process repository (\`proc issue --title "<the flaw>" --file <report.md>\`), and the neoProcess lane fixes it (GOV 5)`;
  if (tool === `${GH}issue_write`) { const why = issueReason(role, ti, ctx); if (why !== undefined) return why; }
  if (tool === 'Skill' && isReader(ti.skill) && !BOB_READS.has(role)) return `the fresh reader judges only what Bob reads; ${WHO[role] ?? role}'s messages go to BOB, never to him (rulebook SES 9)`;
  if (tool === 'Agent' && ti.run_in_background !== true) return 'a worker is never waited on in the foreground (P13; rulebook SES 6): start it with run_in_background true and end your turn; its completion wakes you';
  if (tool === `${REMOTE}send_message`) {
    const u = unpushedReason(ctx, 'a message is sent'); if (u) return u;
    if (role !== 'bob' && !OUTSIDE.has(role)) {   // the process repository has no BOB: the neoProcess lane's message is data to its reader
      let bob; try { bob = addr({ product: join(ctx.root, ctx.product || '.'), bob: true }); } catch (e) { return `BOB's address could not be read from the state branch (${e.message})`; }
      if (ti.session_id !== bob) return `a ${role} sends every message to BOB's address, read from git now (\`proc addr --bob\` → ${bob}), never to a lane or another job (PROTOCOL §1)`;
    }
    return null;
  }
  if (role !== 'bob') {
    // the neoProcess lane has no parent session to start its successor, so it starts it itself, with the one
    // create_session `proc process handoff` printed (rulebook SES 1; Bob, 29 Oct: the lane refreshes without him)
    if (role === 'process' && tool === `${REMOTE}create_session`) {
      let want; try { want = processSession(R_of(ctx), ctx.branch); } catch (e) { return `the successor's create_session could not be derived (${e.message})`; }
      if (ti.title === want.title && ti.prompt === want.prompt && ti.source_revision === want.source_revision && ti.source_url === want.source_url) return null;
      return `the neoProcess lane starts only its successor ${want.title}, with the create_session \`proc process handoff\` printed, unchanged (rulebook SES 1)`;
    }
    if (role === 'process' && tool === `${REMOTE}send_later`) return backstopReason(ti);
    if (role === 'process' && tool === `${REMOTE}create_trigger`) {   // issue 96: its successor at a depth that does not grow
      let want = null; try { want = processSession(R_of(ctx), ctx.branch); } catch { /* a probe needs none */ }
      return processTriggerReason(ti, want);
    }
    if (role === 'process' && tool === `${REMOTE}fire_trigger`) {   // the task just armed, fired at once rather than on the scheduler's lag
      const a = record(ctx, PROCESS_TRIGGER_FILE);
      return a && !a.fired && Date.now() - Date.parse(a.at) < 30 * 60e3 ? null : 'the neoProcess lane fires only the one-shot task it armed in the last 30 minutes, once (issue 96)';
    }   // the lane's own backstop (Bob, 30 Oct)
    // ROOT starts every BOB (rulebook SES 1, SESSIONS §3a): exactly the create_session `proc root bob` printed, once (issue 65)
    if (role === 'root' && tool === `${REMOTE}create_session`) {
      const want = record(ctx, ROOT_BOB_FILE);
      if (want && !want.passed && ['title', 'source_url', 'source_revision', 'prompt'].every((k) => ti[k] === want[k]) && (ti.model == null || ti.model === want.model)) return null;
      return want?.passed ? `${want.title} was already started by this ROOT: do nothing (SESSIONS §3a)` : 'ROOT starts only a BOB, with the create_session `proc root bob --n <n>` printed, unchanged (rulebook SES 1)';
    }
    // issue 90 (Bob, 30 Oct): a retiring BOB keeps its session until its workers have finished and it has released itself
    if (role === 'root' && tool === `${REMOTE}archive_session`) {
      let r = null; try { r = parsePlan(stateRead(R_of(ctx), 'plan.md') || '').retiring.find((x) => x.session === ti.session_id); } catch { /* no epoch: nothing retiring */ }
      if (r?.state === 'released') { let bob = null; try { bob = parsePlan(stateRead(R_of(ctx), 'plan.md') || '').bob; } catch { /* unread */ } if (!bob || bob.session === ti.session_id) return `${r.name} is released, but no successor has taken over on the record: archive it once the new BOB has sent "TOOK OVER BOB #<n>" (issue 104; Bob, 30 Oct)`; }
      if (r?.state === 'running') return `${r.name} is retiring and may still be finishing its workers: archive it once it sends "RELEASED ${r.name}" (its Retiring line then reads released); if get_session reads it failed or archived, \`proc bob release --session ${r.session} --failed "<what get_session reads>"\` first (PROTOCOL §7a)`;
    }
    if ([`${REMOTE}create_session`, `${REMOTE}create_trigger`, `${REMOTE}fire_trigger`, `${REMOTE}send_later`].includes(tool)) return `a ${role} starts no session and arms no timer (rulebook SES 1)`;
    // the neoProcess lane opens and merges its own pull request to the process repository's main (no BOB there); it never reviews one
    if (OUTSIDE.has(role) && [`${GH}merge_pull_request`, `${GH}create_pull_request`].includes(tool)) return null;   // an onboarding session: the one seed pull request
    if ([`${GH}merge_pull_request`, `${GH}enable_pr_auto_merge`, `${GH}pull_request_review_write`, `${GH}create_pull_request`].includes(tool)) return `a ${role} never opens, reviews or merges a pull request: BOB and the queue do (JOB-LIFE §11)`;
    if (role === 'job' && [`${GH}update_pull_request`, `${GH}add_issue_comment`].includes(tool)) {
      let j = null; try { j = parseJob(stateRead(R_of(ctx), `jobs/${ctx.module}.md`) || ''); } catch { /* read below */ }
      if (!j) return 'your job line could not be read from the state branch';
      if (tool === `${GH}add_issue_comment` && !(j.owed.includes('comment') && Number(ti.issue_number) === j.pr)) return `a job comments on its own PR (#${j.pr}) only the report \`proc job complete\` printed, while that comment is owed (JOB-LIFE §3)`;
      if (tool === `${GH}update_pull_request` && !(j.owed.includes('ready') && Number(ti.pullNumber) === j.pr && ti.draft === false && Object.keys(ti).every((k) => ['owner', 'repo', 'pullNumber', 'draft'].includes(k)))) return `a job marks its own PR (#${j.pr}) ready for review only as \`proc job complete\` printed, while that act is owed; nothing else on the PR is its to change (JOB-LIFE §11)`;
    }
    return null;
  }
  // BOB
  if (tool === `${REMOTE}fire_trigger`) return 'never fire a routine to reach a session: send a message (PROTOCOL §6)';
  if (tool === `${REMOTE}create_trigger` && ti.persistent_session_id !== ctx.session) return 'BOB arms only its own backstop; a job or a lane is reached by send_message, never by a routine (PROTOCOL §7)';
  if (tool === `${GH}merge_pull_request`) {
    const R = R_of(ctx); let state = null; try { state = parsePlan(stateRead(R, 'plan.md') || '').state; } catch { /* unread */ }
    // the close PR (rulebook INT 9): the merge tool's input names no base, so the one merge at CLOSING is the one whose
    // expected head is the tranche's tip, as `tranche close` printed it; a job branch's head is never that tip (DRYRUN §4.20)
    if (state === 'CLOSING') {
      // a refusal still OPEN is routed first: its metrics row rides the close PR, since nothing is pushed to the tranche
      // once main holds it (BOB #3's R-BOB-3-1 was left unrouted; DRYRUN §4.21)
      let open = []; try { open = refusalsOf(R).filter((x) => x.status === 'OPEN').map((x) => x.id); } catch { /* none */ }
      if (open.length) return `route the open refusal(s) first (\`proc refused routed\`): ${open.join(', ')}; the row rides the close PR, and nothing is pushed to the tranche after it merges (DRYRUN §4.21)`;
      R.fetch(TRANCHE); let tip = null; try { tip = R.g(['rev-parse', `origin/${TRANCHE}`]); } catch { /* none */ }
      if (tip && ti.merge_method === 'merge' && /^[0-9a-f]{7,40}$/.test(String(ti.expectedHeadSha || '')) && tip.startsWith(String(ti.expectedHeadSha))) return null;
    }
    let job = null; try { job = jobFiles(R).map((p) => parseJob(stateRead(R, p) || '')).find((j) => j && j.pr === Number(ti.pullNumber)); } catch { /* unread */ }
    if (job && /^merging /.test(job.merge || '') && ti.merge_method === 'merge') return null;
    return 'a job\'s PR is merged only as `proc merge` printed it (the gate green on its tip, the tip holding the tranche; JOB-LIFE §6); the one other merge BOB makes is the close PR to main, once the plan reads CLOSING, as `tranche close` printed it with expectedHeadSha the tranche\'s tip (rulebook INT 9)';
  }
  if (tool === `${REMOTE}create_session`) {
    const title = String(ti.title || '');
    if (!NAME.test(title) || /^BOB /.test(title)) return 'BOB starts only jobs and lanes, each titled as `proc` printed it (rulebook SES 1)';
    const R = R_of(ctx), id = title.split(' #')[0];
    let plan; try { plan = parsePlan(stateRead(R, 'plan.md') || ''); } catch (e) { return `the plan could not be read from the state branch (${e.message})`; }
    if (lanes(R).some((l) => l.id === id && l.status === 'OPEN')) {   // a closed lane's id is no lane (R-BOB-1-4)
      if (!plan.owed.includes(`start lane ${id}`)) return `no start is owed for lane ${id}: run \`proc lane open\`, \`proc lane route\` or \`proc ask ask\` first, and use the call it prints`;
      const want = laneSession(R, id, Number(title.split('#')[1]));
      if (ti.prompt !== want.prompt || ti.source_revision !== want.source_revision) return `use the create_session \`proc\` printed for ${title}, unchanged (the goal, the standing lines, the branch ${want.source_revision})`;
      return null;
    }
    const m = id.toLowerCase(), j = parseJob(stateRead(R, `jobs/${m}.md`) || '');
    if (!j || !plan.owed.includes(`start ${m}`)) return `no start is owed for ${m}: run \`proc layer start\` or \`proc job route\` first, and use the call it prints`;
    const want = jobSession(R, m, title, j.model || 'opus');
    if (ti.prompt !== want.prompt || ti.source_revision !== want.source_revision) return `use the create_session \`proc\` printed for ${title}, unchanged (the goal, the standing lines, the branch ${want.source_revision})`;
  }
  return null;
}

// The reason a tool call is pre-approved, or null (PERMISSIONS §8.6): a PreToolUse `allow` skips the permission prompt,
// never past a deny or ask rule, so only what the act table gives every role is answered here, and only when every part
// of the command is one: the tool's own commands, the checks, the tests, a read of git, a push to the role's own branch
// (preReason has already refused every other push), with `cd` and read-only filters between them. A substitution, a
// redirect to a file or anything else falls through to the rules and the mode. Asked only once preReason found nothing.
const QUIET = /\s+(?:\d?>&\d|\d?>\s*\/dev\/null)(?=$|[\s;&|])/g;
const ALLOW_PART = [
  /^node\s+(?:\S+\/)?(?:tools\/proc|checks\/run)\.mjs(?:\s|$)/,
  /^node\s+--test(?:\s|$)/,
  /^git\s+(?:-C\s+\S+\s+)?(?:status|log|diff|show|fetch|rev-parse|ls-files|ls-remote|cat-file|merge-base|blame|describe|shortlog)(?:\s|$)/,
  /^git\s+(?:-C\s+\S+\s+)?branch(?:\s+(?:-a|-r|-v|-vv|--list|--show-current|--contains\s+\S+|--merged(?:\s+\S+)?))*$/,
  /^git\s+(?:-C\s+\S+\s+)?remote(?:\s+-v)?$/,
  /^cd\s+\S+$/,
  /^(?:head|tail|grep|wc)(?:\s+[^\s]+)*$/,
];
export function allowReason(role, input, ctx) {
  if (role && input.tool_name === `${GH}issue_write` && issueReason(role, input.tool_input || {}, ctx) === null) return 'the call `proc issue` printed (Bob, 30 Oct: every project files process flaws as issues)';
  if (role === 'process' && input.tool_name === `${REMOTE}send_later` && backstopReason(input.tool_input || {}) === null) return 'the neoProcess lane\'s backstop, as `proc process status` printed it';
  if (!role || input.tool_name !== 'Bash') return null;
  const c = String(input.tool_input?.command || '').replace(QUIET, '');
  if (/[`<>]|\$\(|\n|(?<!&)&(?!&)|--output\b/.test(c)) return null;
  const parts = c.split(/&&|\|\||;|\|/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const own = ownBranch(role, ctx);
  for (const part of parts) {
    if (ALLOW_PART.some((re) => re.test(part))) continue;
    const push = part.match(/^git\s+(?:-C\s+\S+\s+)?push((?:\s+(?:-u|--set-upstream|-q|--quiet))*\s+origin\s+\S+)$/);
    if (push && own && !FORCE.test(part) && refs(push).length && refs(push).every((r) => r === own)) continue;
    return null;
  }
  return `the act table gives every ${role === 'bob' ? 'BOB' : role === 'process' ? 'neoProcess lane' : role === 'onboard' ? 'onboarding session' : role} this act (PERMISSIONS §8.6)`;
}

// The reason a turn may not end, or null: no role yet; a job's record WORKING; anything `proc status` gates for the role.
export function stopReason(role, ctx) {
  if (!role) return 'run your start command first (`proc takeover`, `proc job start`, `proc lane start`, `proc root start` for ROOT, `proc process start` for the neoProcess lane, `proc onboard start` for an onboarding session): the role is recorded by it (SESSIONS §1a)';
  if (role === 'process') return laneStopReason(ctx);
  if (role === 'root') return null;   // ROOT edits and pushes nothing, and BOB's queue is BOB's (SESSIONS §3a; issue 65)
  if (OUTSIDE.has(role)) return null;   // the process repository has no state branch, so no gate of `proc status` to read
  if (role === 'bob' && !ctx.epoch) return null;   // carrying a running tranche before the first epoch (issue 69): no queue yet
  const R = R_of(ctx), st = status({ product: R.dir });
  const why = [...st.gate];
  if (role === 'bob') {   // issue 90: a retiring BOB stays while its workers run, and releases itself once none does
    const tk = record(ctx, TOOKOVER_FILE);   // issue 104: the takeover reported to ROOT by message before the first turn ends
    if (tk && tk.session === ctx.session && !tk.sent) why.push(`your takeover is not reported to ROOT: send_message the ROOT session your start prompt names the line \`proc takeover\` printed ("${tk.message.slice(0, 40)}…")`);
    const r = parsePlan(stateRead(R, 'plan.md') || '').retiring.find((x) => x.session === ctx.session);
    if (r?.state === 'running' && (runningWorkers(ctx.root, ctx.session) || []).length === 0) why.push(`you are retiring and none of your workers runs: record any result not yet recorded, then \`proc bob release\` and send ROOT the line it prints (PROTOCOL §7a)`);
  }
  if (role === 'job') {
    const j = st.jobs.find((x) => x.module === ctx.module);
    if (j?.state === 'WORKING') why.push('your record reads WORKING: finish the step, or set the wait you end on (`proc job state --set "WAITING: …"`), or run `proc job complete` (JOB-LIFE §11)');
  }
  return why.length ? why.join('; ') : null;
}
// The neoProcess lane's turn ends with its issues read and every one acknowledged, and its backstop due (Bob, 30 Oct). The
// hook has no network: it reads what `proc process status` kept and what the post event recorded once the backstop was armed.
export function laneStopReason(ctx, now = Date.now()) {
  const why = [], iss = record(ctx, ISSUES_FILE), back = record(ctx, BACKSTOP_FILE);
  if (!iss) why.push('the process issues are not read: run `proc process status`');
  else if (!iss.ok) why.push(`the process issues could not be read (${iss.error}): run \`proc process status\` again`);
  else { const nw = iss.issues.filter((i) => i.state !== 'ACKNOWLEDGED').map((i) => `#${i.number}`); if (nw.length) why.push(`issue(s) ${nw.join(', ')} not acknowledged: \`proc issue ack\`, the comment it prints, then \`proc process status\``); }
  const unfiled = (iss?.reports || []).filter((x) => x.state === 'NEW').map((x) => x.id);   // issue 75: a product's report not yet filed
  if (unfiled.length) why.push(`product report(s) ${unfiled.join(', ')} not filed: \`proc issue --report <id>\`, the call it prints, then \`proc process status\``);
  const handed = record(ctx, 'proc-handoff.json')?.session === ctx.session && ctx.session;   // handed off: the backstop is the successor's
  if (!handed && !(back && Date.parse(back.due) > now)) why.push('no backstop is due: arm it with the send_later `proc process status` printed');
  return why.length ? why.join('; ') : null;
}
// An act's record is written when the act has run, never when it was asked (issue 107, 30 Oct: the classifier refused
// neoProcess #18's archive of #17 after the pre hook had already recorded it archived). PostToolUse runs only after a tool
// completed (a denial fires PreToolUse and PermissionDenied, never it: code.claude.com/docs/en/hooks, read 30 Oct), so
// every record of a remote act lives here: ROOT's one BOB start made, the lane's task armed or fired, its backstop due,
// the fresh reader on, each background worker started, BOB's takeover reported. An archive is recorded by
// `proc process archived` from what the call returned, or its refusal's words (REC-5).
export function postRecord(role, input, ctx) {
  const t = input.tool_name, ti = input.tool_input || {}, at = new Date().toISOString(), f = (name) => join(ctx.root, '.git', name);
  const edit = (name, fn) => { let w; try { w = JSON.parse(readFileSync(f(name), 'utf8')); } catch { return null; } const n = fn(w); if (n) writeFileSync(f(name), JSON.stringify(n)); return n; };
  if (role === 'root' && t === `${REMOTE}create_session`) return edit(ROOT_BOB_FILE, (w) => ({ ...w, passed: at }));
  if (role === 'process' && t === `${REMOTE}create_trigger`) { writeFileSync(f(PROCESS_TRIGGER_FILE), JSON.stringify({ at })); return { at }; }
  if (role === 'process' && t === `${REMOTE}fire_trigger`) return edit(PROCESS_TRIGGER_FILE, (w) => ({ ...w, fired: at }));
  if (role === 'process' && t === `${REMOTE}send_later`) { const w = { due: new Date(Date.now() + Number(ti.delay_minutes) * 60e3).toISOString() }; writeFileSync(f(BACKSTOP_FILE), JSON.stringify(w)); return w; }
  // the fresh reader on, and a background worker started, recorded once the call has run, never by the pre event (N2-6)
  if (t === 'Skill' && isReader(ti.skill) && ctx.session) return recordLocal(ctx.root, READER_FILE, { session: ctx.session, at });
  if (t === 'Agent' && ti.run_in_background === true && ctx.session) return recordLocal(ctx.root, WORKERS_FILE, { session: ctx.session, at, running: [...(runningWorkers(ctx.root, ctx.session) || []), { id: input.tool_use_id, type: 'subagent', description: ti.description }] });
  if (role === 'bob' && t === `${REMOTE}send_message` && /^TOOK OVER BOB #\d+/.test(String(ti.message || ''))) return edit(TOOKOVER_FILE, (w) => ({ ...w, sent: at }));
  return null;
}
// Issue 102 (Bob, 30 Oct: "you're report responses to my prompts multiple times"): the Stop hook judges a turn's last
// message after Claude Code has shown it, so Bob sees every refused draft and its rewrite. No hook runs before the text
// exists; the one that touches what is shown is MessageDisplay, which may replace the text rendered (display only: it
// cannot block, and the transcript keeps the draft; code.claude.com/docs/en/hooks, read 30 Oct). In a non-interactive
// run it fires once per message with the whole text (`index` 0, `final` true), so the checks the Stop hook runs without
// a model (the reader on, the steps, plain words) judge the draft here first, and a draft they refuse is shown as one
// line. It holds back nothing the Stop hook would let through: only while the stop count says the next refusal still
// blocks. Each call is logged, so whether this runtime fires it, and in which shape, is measured (DRYRUN §24).
export const DISPLAY_FILE = (id) => join(tmpdir(), `proc-display-${String(id || 'none').replace(/[^\w-]/g, '')}.json`);
export const WITHHELD = '(a draft the process refused; the message that passes follows)\n';
export function displayReason(role, input, ctx, stopCount = 0) {
  if (!BOB_READS.has(role) || input.index !== 0 || input.final !== true || typeof input.delta !== 'string' || stopCount >= 3) return null;
  let why = readerReason(role, ctx);
  if (!why) { try { why = stepsReason(input.delta, join(ctx.root, ctx.product || '.')); } catch { why = null; } }
  if (!why) { try { why = plainReason(input.delta); } catch { why = null; } }
  return why;
}
// P13, rulebook SES 5: BOB past 40 % of its window, a job or a lane past half, ends a turn only with its refresh recorded
// (BOB #2 of N1 ran to 67 % while BOB's own threshold was text: DRYRUN §4.17). The context is the last assistant turn's
// input (fresh, cache read and cache write) in the transcript; the window is the model's, 1,000,000 unless
// NEO_CONTEXT_WINDOW says otherwise. BOB's refresh is its handoff (`proc handoff` marks it for its session); a job's or a
// lane's is the wait `BLOCKED: context`, which BOB's queue lists as UNBLOCK and answers by `proc job route` / `lane route`.
export const THRESHOLD = { bob: 0.4, job: 0.5, lane: 0.5, process: 0.4, onboard: 0.5 };
export const WINDOW = Number(process.env.NEO_CONTEXT_WINDOW) || 1_000_000;
export function contextUsed(input) {
  if (typeof input?.transcript_path !== 'string') return null;
  let lines; try { lines = readFileSync(input.transcript_path, 'utf8').split('\n'); } catch { return null; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let r; try { r = JSON.parse(lines[i]); } catch { continue; }
    const u = r?.message?.usage;
    if (u && !r.isSidechain && (r.type === 'assistant' || r.message.role === 'assistant')) return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  }
  return null;
}
export function contextReason(role, used, ctx, window = WINDOW) {
  if (!(role in THRESHOLD) || !(used > THRESHOLD[role] * window)) return null;
  const pct = Math.round((100 * used) / window), limit = Math.round(100 * THRESHOLD[role]), at = `you are at ${pct} % of your window, past ${limit} % (P13; rulebook SES 5)`;
  if (role === 'bob' || OUTSIDE.has(role)) {
    const f = join(ctx.root, '.git', 'proc-handoff.json');
    if (existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).session === ctx.session) return null;
    if (role === 'onboard') return `${at}: refresh now: commit and push the project's onboard branch, then end the turn; the owner starts the next onboarding session, which continues from \`proc init --check\``;
    if (role === 'process') return `${at}: refresh now: write lane-neoprocess/HANDOFF.md (its From line naming you), commit, push, run \`proc process handoff\` and create your successor with the call it prints, then take no further act`;
    return `${at}: refresh now: run \`proc handoff --next "<the next step>"\` at a clean point and send ROOT the START line it prints, then take no further act`;
  }
  const R = R_of(ctx);
  const line = role === 'job' ? parseJob(stateRead(R, `jobs/${ctx.module}.md`) || '')?.state : stateRead(R, `lanes/${ctx.lane}.md`)?.match(/· (BLOCKED: .*)$/m)?.[1];
  if (/^BLOCKED: context/.test(line || '')) return null;
  return `${at}: record it, \`proc ${role === 'job' ? 'job' : 'lane'} state --set "BLOCKED: context (${pct} %)"\`, push, and send BOB one line; BOB starts your successor, which continues from git`;
}
export function refusalCount(last, why) { return why ? (last?.why ? (last.n || 0) + 1 : 1) : 0; }
// Bob, 29 Oct: "you should not be stopping to involve me in these details"; a session told to keep going keeps going.
// A BOB's or a lane's turn that ends on words waiting for Bob is refused: decide it (DES 1, GOV 2), or route it by
// `proc ask route --bob --users --canon-silent` and go on with the queue. Code, not resolve (P16).
const ASKING_BOB = /\b(waiting (on|for) (you|your (word|answer|reply|decision|go-ahead))|tell me when|let me know (when|if|whether|which)|reply ["“]?[a-z]["”]? or|answer ["“]?[a-z]["”]? or|do you want me to|would you like me to|should I\b|shall I\b|please (reply|answer|decide|confirm|choose|pick)|your call\b|up to you\b|once you (confirm|decide|answer|approve)|if you (approve|agree|prefer)\b)/i;
export function askingBobReason(text) {
  const m = String(text || '').match(ASKING_BOB);
  return m ? `this turn ends waiting on Bob ("${m[0]}"): decide it and report it done (DES 1, GOV 2), or route it with \`proc ask route --bob --users --canon-silent\` and go on with the queue; a session never ends a turn waiting on Bob (Bob, 29 Oct; P17, P19)` : null;
}

// The evidence check's model run (issue 61): a fresh `claude -p` with no tools, in a clean environment that keeps only the
// path, the home, the proxy and its certificates (acts.md `claude -p`), so it shares nothing with the session it judges.
const KEEP_ENV = ['PATH', 'HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'ANTHROPIC_BASE_URL', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
export function runJudge(prompt) {
  const env = Object.fromEntries(KEEP_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const r = spawnSync('claude', ['-p', '--model', EVIDENCE_MODEL, '--tools', '', '--output-format', 'json'], { input: prompt, env, cwd: tmpdir(), encoding: 'utf8', timeout: 170e3, maxBuffer: 16 << 20 });
  return r.stdout || '';
}
// It refuses at most twice in a row, so a claim the session cannot source never loops (#14's round 4: a third
// refusal measured no gain, 16/24 accurate against round 3's 20/24, so the cheaper cap stays).
export const EVIDENCE_TRIES = 2;

function main() {
  const ev = process.argv[2];
  let input = {}; try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* empty */ }
  // The role is recorded in the checkout the session works in: its project directory, or, for the two roles that work in the
  // process repository itself, that repository when the session started elsewhere (#13, 30 Oct: a lane session started
  // with two repositories has /home/user as its project directory, and its hooks found no role and no tools; issue 63).
  let root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  if (!readRole(root) && ['process', 'onboard'].includes(readRole(PROCESS)?.role)) root = PROCESS;
  const r = readRole(root) || {}, role = r.role || null, ctx = { ...r, root };
  if (ev === 'pre') {
    let why = null; try { why = preReason(role, input, ctx); } catch (e) { why = `the check failed (${e.message}); fix the cause`; }
    if (why) { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `PROCESS: ${why}` } })); return; }
    let ok = null; try { ok = allowReason(role, input, ctx); } catch { /* falls through to the rules */ }
    if (ok) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `PROCESS: ${ok}` } }));
    return;
  }
  if (ev === 'post') { try { postRecord(role, input, ctx); } catch { /* a record is never a refusal */ } return; }
  if (ev === 'display') {
    const id = input.session_id || r.session, f = DISPLAY_FILE(id);
    let log = []; try { log = JSON.parse(readFileSync(f, 'utf8')); } catch { /* first call */ }
    log.push({ at: new Date().toISOString(), role, index: input.index, final: input.final, len: String(input.delta ?? '').length });
    try { writeFileSync(f, JSON.stringify(log.slice(-40))); } catch { /* none */ }
    let n = 0; try { n = JSON.parse(readFileSync(join(tmpdir(), `proc-stop-${String(id || 'none').replace(/[^\w-]/g, '')}.json`), 'utf8')).n || 0; } catch { /* no refusal yet */ }
    let why = null; try { why = displayReason(role, input, ctx, n); } catch { /* shown as written */ }
    if (why) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: WITHHELD } }));
    return;
  }
  if (ev === 'evidence') {
    if (!BOB_READS.has(role) || readerReason(role, ctx)) return;   // the same messages the fresh reader judges
    if (saidPassed(root, r.session, lastAssistantText(input))) return;   // issue 102: judged by `proc say` before it was sent
    let why = null; try { why = judgeReason(input, runJudge); } catch { /* the check never blocks on its own failure */ }   // the fresh reader, then the evidence judge (issue 111)
    const f = join(tmpdir(), `proc-evidence-${String(input.session_id || r.session || 'none').replace(/[^\w-]/g, '')}.json`);
    const last = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
    const n = refusalCount(last, why);
    try { writeFileSync(f, JSON.stringify({ why, n })); } catch { /* none */ }
    if (why && n <= EVIDENCE_TRIES) console.log(JSON.stringify({ decision: 'block', reason: why }));
    return;
  }
  if (ev === 'stop') {
    // issue 90: the session's running background tasks, as Claude Code lists them to the Stop hook (measured #16, 30 Oct)
    if (Array.isArray(input.background_tasks) && r.session) { try { writeFileSync(join(root, '.git', WORKERS_FILE), JSON.stringify({ session: r.session, at: new Date().toISOString(), running: input.background_tasks.filter((t) => t.status === 'running').map(({ id, type, description }) => ({ id, type, description })) })); } catch { /* not a git checkout */ } }
    let why = null; try { why = stopReason(role, ctx); } catch (e) { why = `the stop check failed (${e.message}); fix the cause`; }
    // Bob reads these roles' last message and only it (rulebook SES 9): the fresh reader on, steps verified, plain words;
    // a message `proc say` passed was judged before it was sent, and is not judged again (issue 102)
    const said = BOB_READS.has(role) && saidPassed(root, r.session, lastAssistantText(input)), before = why;
    if (!why && BOB_READS.has(role) && !said) why = readerReason(role, ctx);
    if (!why && BOB_READS.has(role) && !said) { try { why = stepsReason(lastAssistantText(input), join(root, r.product || '.')); } catch (e) { why = `the steps check failed (${e.message}); fix the cause`; } }
    if (!why && BOB_READS.has(role) && !said) { try { why = plainReason(lastAssistantText(input)); } catch (e) { why = `the plain-words check failed (${e.message}); fix the cause`; } }
    if (!why && !said && (role === 'bob' || role === 'lane' || OUTSIDE.has(role))) { try { why = askingBobReason(lastAssistantText(input)); } catch { /* no text */ } }
    if (why && !before && BOB_READS.has(role)) why += SAY_HINT;
    if (!why && role) { try { why = contextReason(role, contextUsed(input), ctx); } catch (e) { why = `the context check failed (${e.message}); fix the cause`; } }
    // The same refusal three times in a row lets the turn end, so a cause the session cannot clear never loops.
    // Kept per session outside the checkout, so it counts where the session has no git directory too (#13's probe, 30 Oct:
    // with no role and no checkout the write failed, the count never rose, and the platform's cap ended the turn at 9).
    const f = join(tmpdir(), `proc-stop-${String(input.session_id || r.session || 'none').replace(/[^\w-]/g, '')}.json`);
    const last = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
    const n = refusalCount(last, why);
    try { writeFileSync(f, JSON.stringify({ why, n })); } catch { /* not a git checkout */ }
    if (why && n <= 3) console.log(JSON.stringify({ decision: 'block', reason: `PROCESS: ${why}` }));
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
