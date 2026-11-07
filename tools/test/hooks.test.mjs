// tools/hooks.mjs against a real remote: the role from the record, and each refusal PROTOCOL §9, JOB-LIFE §11 and
// SESSIONS §1a name, for no role, BOB, a job and a lane; the Stop hook by `proc status`'s gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync, mkdirSync, rmSync, existsSync, unlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as N from '../proc.mjs';
import { preReason, stopReason, partialReadReason, allowReason, askingBobReason, contextUsed, contextReason, issueReason, laneStopReason, readerReason, postRecord, displayReason, READER_FILE } from '../hooks.mjs';
import { readLocal, recordLocal, METRICS_HEAD, metricsText, status as recordStatus, statusLines } from '../record.mjs';
import * as N_HOOKS from '../hooks.mjs';
import * as N_LIB from '../lib.mjs';
import { plainFaults, plainReason, BOB_READS, turnEvidence, evidencePrompt, evidenceVerdict, evidenceReason } from '../lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), TOY = join(HERE, '..', '..', 'dryrun');
const B1 = 'session_01BBBBBBBBBBBBBBBBBBBBBBBB', J1 = 'session_01AAAAAAAAAAAAAAAAAAAAAAAA', L1 = 'session_01LLLLLLLLLLLLLLLLLLLLLLLL';
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ident = (d, n) => { for (const [k, v] of [['user.name', n], ['user.email', `${n}@t`], ['commit.gpgsign', 'false']]) g(d, 'config', k, v); };
const f = (dir, name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
function world() {
  const base = mkdtempSync(join(tmpdir(), 'hooks-')), origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const seed = join(base, 'seed');
  execFileSync('git', ['clone', '-q', origin, seed], { stdio: 'ignore' }); ident(seed, 'seed');
  cpSync(TOY, join(seed, 'toy'), { recursive: true });
  writeFileSync(join(seed, 'toy/build/plan/current.md'), '# Plan: test T1\n\n**Status** · OPEN.\n\n## Layer 1\n\n**alpha**\n- N1 · Add a comment.\n');
  g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'seed'); g(seed, 'branch', '-M', 'main'); g(seed, 'push', '-q', 'origin', 'main');
  g(seed, 'push', '-q', 'origin', `main:refs/heads/${N.TRANCHE}`);
  const clone = (name) => { const d = join(base, name); execFileSync('git', ['clone', '-q', '-b', N.TRANCHE, origin, d], { stdio: 'ignore' }); ident(d, name); return { dir: join(d, 'toy'), root: d }; };
  return { base, origin, bob: clone('bob'), clone };
}
const ctxOf = (root) => ({ ...(N.readRole(root) || {}), root });
const bash = (command, extra = {}) => ({ tool_name: 'Bash', tool_input: { command, ...extra } });
const tool = (tool_name, tool_input = {}) => ({ tool_name, tool_input });
const REMOTE = 'mcp__claude-code-remote__', GH = 'mcp__github__';

test('the hooks: no role until recorded; BOB, a job and a lane each refused what is never theirs; the Stop hook by the gate', () => {
  const w = world(), o = (x) => ({ product: w.bob.dir, ...x }), root = w.bob.root;
  const pre = (r, input) => preReason(ctxOf(r).role || null, input, ctxOf(r));
  // no role: reads and the start command pass; a write, a remote tool, a git write are refused; the turn cannot end
  assert.equal(pre(root, bash('cat PROCESS-DESIGN.md')), null);
  assert.equal(pre(root, bash('node /x/tools/proc.mjs takeover --name "BOB #1" --session s --product toy')), null);
  assert.match(pre(root, tool('Write', { file_path: 'x' })), /no role is recorded/);
  assert.match(pre(root, bash('git push origin HEAD:tranche')), /no role is recorded/);
  assert.match(pre(root, bash('echo x > y')), /no role is recorded/);
  assert.match(pre(root, tool(`${REMOTE}send_message`, { session_id: B1, message: 'x' })), /no role is recorded/);
  assert.match(stopReason(null, ctxOf(root)), /start command first/);
  // a reading-set document read short is refused for every role
  assert.match(partialReadReason('Read', { file_path: '/p/toy/build/requirements/alpha.md', offset: 10 }), /read whole/);
  assert.match(partialReadReason('Bash', { command: 'head -40 PROCESS-DESIGN.md' }), /read whole/);
  assert.equal(partialReadReason('Bash', { command: 'cat PROCESS-DESIGN.md | head -40' }), 'PROCESS-DESIGN.md is in a reading set and is read whole (P20; a read that stops before the end is a scan): read it with no offset or limit, or `cat` it; a set too large to read whole is BLOCKED: reading (SESSIONS §6)');
  assert.equal(partialReadReason('Bash', { command: 'grep -n R1 build/requirements/alpha.md' }), null);

  N.epochOpen(o()); N.takeover(o({ name: 'BOB #1', session: B1 }));
  assert.equal(ctxOf(root).role, 'bob');
  // BOB: the standing refusals
  assert.match(pre(root, bash('git push --force origin HEAD:tranche')), /force push/);
  assert.match(pre(root, bash('git push origin :refs/heads/job/alpha')), /force push, mirror or remote delete/);
  assert.match(pre(root, bash('git merge origin/state/E1')), /state branch/);
  assert.match(pre(root, bash('git checkout -b x origin/state/E1')), /state branch/);
  assert.match(pre(root, bash('git push origin HEAD:main')), /nothing is pushed to main/);
  assert.match(pre(root, bash('git push origin HEAD:refs/heads/state/E1')), /written only by the tool/);
  assert.equal(pre(root, bash('git push origin HEAD:tranche 2>&1')), null);
  assert.equal(pre(root, bash('git push -u origin tranche')), null);
  assert.match(pre(root, bash('git push origin HEAD:job/alpha')), /BOB pushes only tranche/);
  assert.match(pre(root, bash('gh pr merge 11')), /only as `proc` prints/);
  assert.match(pre(root, bash('git merge --no-ff origin/job/alpha')), /merged only by the queue/);
  assert.match(pre(root, bash('node tools/proc.mjs layer close --layer 1 --product toy')), /run_in_background true/);
  assert.equal(pre(root, bash('node tools/proc.mjs layer close --layer 1 --product toy', { run_in_background: true })), null);
  assert.equal(pre(root, bash('pgrep -f "proc.mjs job complete"')), null);
  assert.match(pre(root, tool('Agent', { prompt: 'x' })), /never waited on in the foreground/);
  assert.equal(pre(root, tool('Agent', { prompt: 'x', run_in_background: true })), null);
  assert.match(pre(root, tool(`${GH}merge_pull_request`, { pullNumber: 11 })), /only as `proc merge` printed it.*once the plan reads CLOSING/);
  assert.match(pre(root, tool(`${REMOTE}fire_trigger`, {})), /never fire a routine/);
  assert.match(pre(root, tool(`${REMOTE}create_trigger`, { persistent_session_id: J1 })), /only its own backstop/);
  assert.equal(pre(root, tool(`${REMOTE}create_trigger`, { persistent_session_id: B1 })), null);
  assert.equal(pre(root, tool(`${REMOTE}send_message`, { session_id: L1, message: 'x' })), null);   // BOB writes to anyone
  assert.match(pre(root, tool(`${REMOTE}create_session`, { title: 'ALPHA #1', prompt: 'x' })), /no start is owed for alpha/);
  assert.match(pre(root, tool(`${REMOTE}create_session`, { title: 'helper', prompt: 'x' })), /titled as `proc` printed/);
  assert.equal(stopReason('bob', ctxOf(root)), null);   // nothing owed yet: the turn may end
  // ...the layer started: the printed create_session passes, any other is refused; the owed start stops the turn
  const ls = N.layerStart(o({ layer: 1 })), spec = ls.jobs[0].session;
  assert.equal(pre(root, tool(`${REMOTE}create_session`, { title: spec.title, prompt: spec.prompt, source_revision: spec.source_revision, model: spec.model })), null);
  assert.match(pre(root, tool(`${REMOTE}create_session`, { title: spec.title, prompt: `${spec.prompt} and hurry`, source_revision: spec.source_revision })), /unchanged/);
  assert.match(pre(root, tool(`${REMOTE}create_session`, { title: spec.title, prompt: spec.prompt, source_revision: 'tranche' })), /unchanged/);
  assert.match(stopReason('bob', ctxOf(root)), /owed: open PR alpha; owed: start alpha/);
  N.jobPr(o({ module: 'alpha', number: 11 })); N.jobStarted(o({ module: 'alpha', name: 'ALPHA #1', session: J1 }));
  assert.equal(stopReason('bob', ctxOf(root)), null);
  // a job's PR is merged only as `proc merge` printed it: its Merge line reads `merging`, the number and method as printed
  N.stateWrite(N.repo(w.bob.dir), { 'jobs/alpha.md': `**Status** · ALPHA #1 · ${J1} · COMPLETE · PR #11\n**Runs** · 1\n**Owed** · none\n**Review** · no review · x · concerns: none\n**Merge** · merging abcdef0 now\n` }, 'alpha merging');
  assert.equal(pre(root, tool(`${GH}merge_pull_request`, { owner: 'o', repo: 'r', pullNumber: 11, merge_method: 'merge' })), null);
  assert.match(pre(root, tool(`${GH}merge_pull_request`, { owner: 'o', repo: 'r', pullNumber: 11, merge_method: 'squash' })), /only as `proc merge` printed it/);
  assert.match(pre(root, tool(`${GH}merge_pull_request`, { owner: 'o', repo: 'r', pullNumber: 12, merge_method: 'merge' })), /only as `proc merge` printed it/);
  N.stateWrite(N.repo(w.bob.dir), { 'jobs/alpha.md': `**Status** · ALPHA #1 · ${J1} · WORKING · PR #11\n**Runs** · 0\n**Owed** · none\n` }, 'alpha working');
  // at CLOSING the close PR's merge passes as `tranche close` printed it: the expected head the tranche's tip (DRYRUN §4.20)
  const planNow = N.stateRead(N.repo(w.bob.dir), 'plan.md');
  N.stateWrite(N.repo(w.bob.dir), { 'plan.md': planNow.replace(/· OPEN ·/, '· CLOSING ·') }, 'closing');
  const rfz = N.refused(o({ act: 'x', kind: 'platform', reason: 'y' }));   // an open refusal: the close merge waits on its route (DRYRUN §4.21)
  assert.match(pre(root, tool(`${GH}merge_pull_request`, { owner: 'o', repo: 'r', pullNumber: 20, merge_method: 'merge', expectedHeadSha: 'deadbeef' })), /route the open refusal\(s\) first.*R-BOB-1-1/);
  N.refusedRouted(o({ id: rfz.refusal, route: 'z' }));
  const tipT = g(root, 'rev-parse', 'origin/tranche');   // the route's metrics row moved the tranche: the expected head is its tip now
  assert.equal(pre(root, tool(`${GH}merge_pull_request`, { owner: 'o', repo: 'r', pullNumber: 20, merge_method: 'merge', expectedHeadSha: tipT })), null);
  assert.match(pre(root, tool(`${GH}merge_pull_request`, { owner: 'o', repo: 'r', pullNumber: 20, merge_method: 'merge' })), /expectedHeadSha the tranche's tip/);
  assert.match(pre(root, tool(`${GH}merge_pull_request`, { owner: 'o', repo: 'r', pullNumber: 20, merge_method: 'merge', expectedHeadSha: 'deadbeef' })), /only as `proc merge` printed it/);
  assert.match(pre(root, tool(`${GH}merge_pull_request`, { owner: 'o', repo: 'r', pullNumber: 20, merge_method: 'squash', expectedHeadSha: tipT })), /only as `proc merge` printed it/);
  N.stateWrite(N.repo(w.bob.dir), { 'plan.md': planNow }, 'open again');
  // a lane opened: the printed create_session passes once its start is owed
  const lo = N.laneOpen(o({ id: 'ARITH', area: 'arithmetic', charterFile: f(w.base, 'c.md', 'Area: arithmetic.\n') }));
  assert.equal(pre(root, tool(`${REMOTE}create_session`, { title: 'ARITH #1', prompt: lo.start.prompt, source_revision: 'tranche' })), null);
  assert.match(pre(root, tool(`${REMOTE}create_session`, { title: 'ARITH #1', prompt: 'go', source_revision: 'tranche' })), /unchanged/);
  N.laneStarted(o({ id: 'ARITH', name: 'ARITH #1', session: L1 }));

  // the job, from its clone: its role from its start command; messages to BOB only, pushed first; its branch only
  const alpha = w.clone('alpha'); g(alpha.root, 'checkout', '-q', 'job/alpha');
  assert.match(pre(alpha.root, tool('Edit', { file_path: 'x' })), /no role is recorded/);
  N.jobStart({ product: alpha.dir, module: 'alpha', session: J1 });
  assert.equal(ctxOf(alpha.root).role, 'job');
  assert.equal(pre(alpha.root, tool(`${REMOTE}send_message`, { session_id: B1, message: 'QUESTION #1: x' })), null);
  assert.match(pre(alpha.root, tool(`${REMOTE}send_message`, { session_id: L1, message: 'x' })), /every message to BOB's address, read from git now \(`proc addr --bob` → session_01BBBBBBBBBBBBBBBBBBBBBBBB\)/);
  assert.match(pre(alpha.root, tool(`${REMOTE}create_session`, { title: 'X #1' })), /starts no session/);
  assert.match(pre(alpha.root, tool(`${REMOTE}send_later`, {})), /arms no timer/);
  assert.match(pre(alpha.root, tool(`${GH}create_pull_request`, {})), /never opens, reviews or merges/);
  assert.match(pre(alpha.root, tool(`${GH}enable_pr_auto_merge`, {})), /never opens, reviews or merges/);
  assert.equal(pre(alpha.root, bash('git push origin HEAD:job/alpha')), null);
  assert.equal(pre(alpha.root, bash('git push -u origin job/alpha')), null);
  assert.match(pre(alpha.root, bash('git push origin HEAD:tranche')), /a job pushes only job\/alpha/);
  assert.match(pre(alpha.root, bash('gh pr ready 11')), /only as `proc` prints/);
  assert.match(pre(alpha.root, tool(`${GH}add_issue_comment`, { issue_number: 11, body: 'hi' })), /only the report `proc job complete` printed, while that comment is owed/);
  assert.match(pre(alpha.root, tool(`${GH}update_pull_request`, { pullNumber: 11, draft: false })), /only as `proc job complete` printed, while that act is owed/);
  assert.match(stopReason('job', ctxOf(alpha.root)), /reads WORKING/);
  // unpushed work: no message; the turn cannot end
  const src = join(alpha.dir, 'alpha/src/index.mjs');
  writeFileSync(src, `${readFileSync(src, 'utf8')}// N1\n`);
  g(alpha.root, 'add', '-A'); g(alpha.root, 'commit', '-q', '-m', 'alpha: N1');
  assert.match(pre(alpha.root, tool(`${REMOTE}send_message`, { session_id: B1, message: 'x' })), /only once your record and work are pushed.*1 commit\(s\) on job\/alpha not pushed/);
  N.jobState({ product: alpha.dir, module: 'alpha', set: 'WAITING: is a comment enough?' });
  assert.match(stopReason('job', ctxOf(alpha.root)), /1 commit\(s\) on job\/alpha not pushed/);
  g(alpha.root, 'push', '-q', 'origin', 'HEAD:job/alpha');
  assert.equal(stopReason('job', ctxOf(alpha.root)), null);   // a wait recorded, everything pushed: the turn ends
  assert.equal(pre(alpha.root, tool(`${REMOTE}send_message`, { session_id: B1, message: 'x' })), null);
  // complete: the two owed acts pass exactly as printed, nothing else; the turn cannot end while they are owed
  const jc = N.jobComplete({ product: alpha.dir, module: 'alpha', reportFile: f(w.base, 'r.md', '**Met** · none\n**Evidence**\n- alpha/src/index.mjs:1\n') });
  assert.match(stopReason('job', ctxOf(alpha.root)), /alpha owes: comment; alpha owes: ready/);
  assert.equal(pre(alpha.root, tool(`${GH}add_issue_comment`, { owner: 'o', repo: 'r', issue_number: 11, body: jc.acts[0].body })), null);
  assert.match(pre(alpha.root, tool(`${GH}add_issue_comment`, { owner: 'o', repo: 'r', issue_number: 12, body: 'x' })), /its own PR \(#11\)/);
  assert.equal(pre(alpha.root, tool(`${GH}update_pull_request`, { owner: 'o', repo: 'r', pullNumber: 11, draft: false })), null);
  assert.match(pre(alpha.root, tool(`${GH}update_pull_request`, { owner: 'o', repo: 'r', pullNumber: 11, draft: false, title: 'better' })), /nothing else on the PR/);
  assert.match(pre(alpha.root, tool(`${GH}update_pull_request`, { owner: 'o', repo: 'r', pullNumber: 11, draft: true })), /nothing else on the PR/);
  N.jobPosted({ product: alpha.dir, module: 'alpha', comment: 5, ready: true });
  assert.equal(stopReason('job', ctxOf(alpha.root)), null);
  assert.match(pre(alpha.root, tool(`${GH}update_pull_request`, { owner: 'o', repo: 'r', pullNumber: 11, draft: false })), /while that act is owed/);

  // the lane, from its clone: messages to BOB only; pushes to the tranche only
  const lane = w.clone('lane');
  N.laneStart({ product: lane.dir, id: 'ARITH', session: L1 });
  assert.equal(ctxOf(lane.root).role, 'lane');
  assert.equal(pre(lane.root, tool(`${REMOTE}send_message`, { session_id: B1, message: 'DECISION: x' })), null);
  assert.match(pre(lane.root, tool(`${REMOTE}send_message`, { session_id: J1, message: 'x' })), /every message to BOB's address/);
  assert.equal(pre(lane.root, bash('git push origin HEAD:tranche')), null);
  assert.match(pre(lane.root, bash('git push origin HEAD:job/alpha')), /a lane pushes only tranche/);
  assert.match(pre(lane.root, tool(`${REMOTE}create_session`, { title: 'X #1' })), /starts no session/);
  assert.equal(stopReason('lane', ctxOf(lane.root)), null);

  // past its threshold a session ends a turn only with its refresh recorded (P13; SES 5; DRYRUN §4.17): the context is the
  // last assistant turn's input in the transcript, a subagent's turns aside
  const tr = f(w.base, 't.jsonl', [{ type: 'user', message: { role: 'user', content: 'x' } }, { type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 2, cache_read_input_tokens: 640000, cache_creation_input_tokens: 9998 } } }, { type: 'assistant', isSidechain: true, message: { role: 'assistant', usage: { input_tokens: 1, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 } } }, { type: 'system' }].map((x) => JSON.stringify(x)).join('\n'));
  assert.equal(contextUsed({ transcript_path: tr }), 650000);
  assert.equal(contextUsed({}), null);
  assert.equal(contextReason('bob', 390000, ctxOf(root)), null);
  assert.match(contextReason('bob', 650000, ctxOf(root)), /at 65 % of your window, past 40 %.*proc handoff/);
  N.handoff(o({ next: 'the layer close' }));   // the refresh recorded for BOB #1's session
  assert.equal(contextReason('bob', 650000, ctxOf(root)), null);
  assert.equal(contextReason('job', 450000, ctxOf(alpha.root)), null);
  assert.match(contextReason('job', 650000, ctxOf(alpha.root)), /past 50 %.*proc job state --set "BLOCKED: context \(65 %\)"/);
  N.jobState({ product: alpha.dir, module: 'alpha', set: 'BLOCKED: context (65 %)' });
  assert.equal(contextReason('job', 650000, ctxOf(alpha.root)), null);
  assert.match(N.status(o()).queue.map((q) => q.item).join(';'), /UNBLOCK alpha/);
  assert.match(contextReason('lane', 650000, ctxOf(lane.root)), /proc lane state --set "BLOCKED: context/);
  N.laneState({ product: lane.dir, set: 'BLOCKED: context (65 %)' });
  assert.equal(contextReason('lane', 650000, ctxOf(lane.root)), null);
  assert.equal(contextReason('lane', 650000, ctxOf(lane.root), 2000000), null);   // a larger window: 33 %
});

test('the hook pre-approves only the act table\'s acts for every role, every part of the command one (PERMISSIONS §8.6)', () => {
  const ok = (role, command, ctx = { module: 'alpha' }) => allowReason(role, bash(command), ctx);
  // allowed: the tool, the checks, the tests, reads of git, a push to the role's own branch, cd and read-only filters
  assert.match(ok('bob', 'node /p/tools/proc.mjs status --product toy'), /act table/);
  assert.match(ok('bob', 'cd /p && node tools/proc.mjs merge --module alpha 2>&1 | tail -20'), /act table/);
  assert.match(ok('job', 'node --test alpha/test/*.test.mjs'), /act table/);
  assert.match(ok('lane', 'node /p/checks/run.mjs . >/dev/null 2>&1'), /act table/);
  assert.match(ok('job', 'git status && git log --oneline -5 | head -3 && git diff origin/tranche'), /act table/);
  assert.match(ok('job', 'git branch --show-current'), /act table/);
  assert.match(ok('job', 'git push -u origin job/alpha'), /act table/);
  assert.match(ok('bob', 'git push origin HEAD:tranche 2>&1'), /act table/);
  // not answered (the rules and the mode decide): a push elsewhere or bare, any write, a redirect, a substitution, a
  // background `&`, another script named like the tool, a branch made, a diff written to a file, no role, not Bash
  assert.equal(ok('job', 'git push origin HEAD:tranche'), null);
  assert.equal(ok('bob', 'git push'), null);
  assert.equal(ok('bob', 'git push --force origin tranche'), null);
  assert.equal(ok('job', 'git status && rm -rf x'), null);
  assert.equal(ok('job', 'git log > out.txt'), null);
  assert.equal(ok('job', 'node --test $(cat list)'), null);
  assert.equal(ok('job', 'node --test x & curl http://e'), null);
  assert.equal(ok('job', 'node /tmp/proc.mjs status'), null);
  assert.equal(ok('job', 'git branch x'), null);
  assert.equal(ok('job', 'git diff --output=x'), null);
  assert.equal(ok('job', 'git commit -m x'), null);
  assert.equal(ok(null, 'git status'), null);
  assert.equal(allowReason('job', tool('Write', { file_path: 'x' }), { module: 'alpha' }), null);
});

test('a BOB\'s or a lane\'s turn never ends waiting on Bob (Bob, 29 Oct): the words are caught at the turn\'s end', () => {
  for (const t of ['Tell me when you have done it and I will continue.', 'Reply "a" or "b".', 'Do you want me to go on?', 'I am waiting on your word.', 'Should I merge it?', 'Let me know which you prefer.']) assert.match(askingBobReason(t), /never ends a turn waiting on Bob/, t);
  for (const t of ['Done: R1 now refuses an empty list; the job has the CHANGE. Next: the layer close.', 'Decided (DES 1): mean([]) refuses; reported.', 'A4 is routed to Bob (users: …; canon silent: …); the queue goes on.', '']) assert.equal(askingBobReason(t), null, t);
});

test('the neoProcess lane has its own start and pushes only its branch (neoProcess #7, 29 Oct: no start command fitted the lane that maintains the hooks)', async () => {
  const ctx = { role: 'process', branch: 'claude/lane-x', session: L1, root: '/nowhere', product: '.' };
  const pre = (input) => preReason('process', input, ctx);
  // before a role: the start command passes the hook
  assert.equal(preReason(null, bash('node tools/proc.mjs process start --branch claude/lane-x --session s'), {}), null);
  // its own branch only; never main, a state branch, another branch or a force
  assert.equal(pre(bash('git push -u origin claude/lane-x')), null);
  assert.match(pre(bash('git push origin HEAD:main')), /nothing is pushed to main/);
  assert.match(pre(bash('git push origin HEAD:tranche')), /neoProcess lane pushes only claude\/lane-x/);
  assert.match(pre(bash('git push --force origin claude/lane-x')), /force push/);
  assert.match(preReason('process', bash('git push origin x'), { ...ctx, branch: undefined }), /the branch its start recorded/);
  // the word in a commit message is not a push; git's own options before the subcommand still are
  assert.equal(pre(bash('git add -A && git commit -q -m "a missing push grant named before work relied on it"')), null);
  assert.match(pre(bash('git -c core.x=1 push origin HEAD:main')), /nothing is pushed to main/);
  assert.match(pre(bash('git --no-pager push --force origin claude/lane-x')), /force push/);
  // it starts its own successor, with the one create_session `proc process handoff` prints (Bob, 29 Oct), and arms no timer;
  // it opens and merges its own pull request, never reviews one
  const here = { ...ctx, root: N.PROCESS }, want = N.processSession(N.repo(N.PROCESS), 'claude/lane-x');
  assert.match(want.title, /^NEOPROCESS #\d+$/); assert.equal(want.source_revision, 'claude/lane-x'); assert.match(want.source_url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  assert.match(want.prompt, new RegExp(`^You are neoProcess #${want.n}, the successor of neoProcess #${want.n - 1} \\(session_[0-9A-Za-z]+\\) in the neoProcess lane of [\\w.-]+\\/[\\w.-]+, on branch claude\\/lane-x \\(push there only\\)\\. Invoke the skill neoprocess with the argument process`));
  assert.match(want.prompt, /Your first acts: put your own session id in the handoff's From line and push; run proc process start again and take the acts it lists as owed at this refresh .*; then item 1 of "What remains"\.$/);
  assert.equal(preReason('process', tool(`${REMOTE}create_session`, { title: want.title, prompt: want.prompt, source_url: want.source_url, source_revision: want.source_revision }), here), null);
  assert.match(preReason('process', tool(`${REMOTE}create_session`, { title: want.title, prompt: `${want.prompt} and hurry`, source_url: want.source_url, source_revision: want.source_revision }), here), /starts only its successor NEOPROCESS #\d+, with the create_session `proc process handoff` printed, unchanged/);
  assert.match(preReason('process', tool(`${REMOTE}create_session`, { title: 'X #1', prompt: want.prompt, source_url: want.source_url, source_revision: want.source_revision }), here), /starts only its successor/);
  assert.match(preReason('process', tool(`${REMOTE}create_session`, { title: want.title, prompt: want.prompt, source_url: want.source_url, source_revision: 'main' }), here), /starts only its successor/);
  assert.match(pre(tool(`${REMOTE}create_session`, { title: 'X #1' })), /could not be derived/);   // no repository at the fixture's root
  assert.throws(() => N.processSession(N.repo(N.PROCESS), undefined), /no branch recorded/);
  // issue 96: the one-shot scheduled task for the successor, as printed, or the probe; fresh, within 30 minutes, no connector
  const soon = new Date(Date.now() + 3 * 60e3).toISOString(), trig = (x) => preReason('process', tool(`${REMOTE}create_trigger`, { name: `${want.title} starter`, prompt: N.starterPrompt(N.successorCall(want)), run_once_at: soon, create_new_session_on_fire: true, ...x }), here);
  assert.equal(trig({}), null);
  assert.equal(trig({ name: 'neoProcess lane probe 2', prompt: N.starterPrompt(N.probeChild(want)) }), null);
  assert.match(N.starterPrompt(N.successorCall(want)), /^STARTER \(neoProcess lane, issue 96\): your one act is to call the tool create_session .*"model":"claude-opus-5-5"/);
  assert.equal(trig({ name: 'neoProcess lane probe (issue 96)', prompt: N.PROCESS_PROBE }), null);
  assert.equal(preReason('process', tool(`${REMOTE}create_trigger`, { name: 'neoProcess lane probe', prompt: N.PROCESS_PROBE, run_once_at: soon, create_new_session_on_fire: true }), ctx), null);   // a probe needs no handoff
  for (const bad of [{ prompt: `${want.prompt} and hurry` }, { name: 'X #1' }, { prompt: want.prompt }, { name: 'neoProcess lane probe', prompt: N.starterPrompt({ ...N.probeChild(want), source_revision: 'main' }) }, { create_new_session_on_fire: false }, { persistent_session_id: L1 }, { cron_expression: '0 * * * *' }, { run_once_at: new Date(Date.now() - 60e3).toISOString() }, { run_once_at: new Date(Date.now() + 31 * 60e3).toISOString() }, { connectors: ['Gmail'] }, { name: 'neoProcess lane probe', prompt: 'anything' }])
    assert.match(trig(bad), /arms only the one-shot scheduled task that starts NEOPROCESS #\d+'s starter as `proc process handoff` printed it/);
  assert.match(preReason('job', tool(`${REMOTE}create_trigger`, { prompt: N.PROCESS_PROBE }), ctx), /starts no session and arms no timer/);
  // one fire of the task armed in the last 30 minutes, read from the record the hook keeps in .git
  const fx = mkdtempSync(join(tmpdir(), 'fire-')); mkdirSync(join(fx, '.git')); const fctx = { ...ctx, root: fx }, fire = () => preReason('process', tool(`${REMOTE}fire_trigger`, { trigger_id: 'trig_x' }), fctx);
  assert.match(fire(), /fires only the one-shot task it armed in the last 30 minutes, once/);
  writeFileSync(join(fx, '.git', 'proc-process-trigger.json'), JSON.stringify({ at: new Date().toISOString() })); assert.equal(fire(), null);
  writeFileSync(join(fx, '.git', 'proc-process-trigger.json'), JSON.stringify({ at: new Date().toISOString(), fired: new Date().toISOString() })); assert.match(fire(), /once/);
  writeFileSync(join(fx, '.git', 'proc-process-trigger.json'), JSON.stringify({ at: new Date(Date.now() - 31 * 60e3).toISOString() })); assert.match(fire(), /30 minutes/);
  assert.match(N.processStartText(want, 'o/r'), /^# Starting neoProcess #\d+ \(written by `proc process handoff`/);
  // after a rename or move of the process repository it pushes a product's regenerated shims: the product's URL named, the branch
  // `shims` only, never the process repository itself (PERMISSIONS §9.5, §9.6; #11, 29 Oct)
  assert.equal(preReason('process', bash('git -C ../x9 push -u https://github.com/o/x9 shims'), here), null);
  assert.equal(preReason('process', bash('git push https://github.com/o/x9.git HEAD:shims'), here), null);
  assert.match(preReason('process', bash('git push https://github.com/o/x9 HEAD:main'), here), /nothing is pushed to main/);
  assert.match(preReason('process', bash('git push https://github.com/o/x9 fix'), here), /pushes only claude\/lane-x \(JOB-LIFE §11\), or a product's regenerated shims/);
  assert.match(preReason('process', bash('git push https://github.com/o/x9 fix:shims'), here), /pushes only claude\/lane-x/);
  assert.match(preReason('process', bash('git push origin shims'), here), /pushes only claude\/lane-x/);
  assert.match(preReason('process', bash(`git push ${want.source_url} shims`), here), /pushes only claude\/lane-x/);
  assert.match(pre(bash('git push https://github.com/o/x9 shims')), /pushes only claude\/lane-x/);   // the process remote unreadable at /nowhere
  assert.match(preReason('process', bash('git push --force https://github.com/o/x9 shims'), here), /force push/);
  assert.match(preReason('onboard', bash('git push https://github.com/o/x9 shims'), { ...here, role: 'onboard', branch: 'onboard' }), /pushes only onboard/);
  assert.match(pre(tool(`${REMOTE}send_later`, {})), /arms only its backstop/);   // its one timer (Bob, 30 Oct)
  assert.equal(pre(tool(`${REMOTE}send_later`, { delay_minutes: 60, message: N.BACKSTOP_MESSAGE })), null);
  assert.match(preReason('bob', tool(`${REMOTE}send_later`, {}), ctx) ?? '', /^$/);
  assert.match(preReason('lane', tool(`${REMOTE}send_later`, { delay_minutes: 60, message: N.BACKSTOP_MESSAGE }), ctx), /arms no timer/);
  assert.equal(pre(tool(`${GH}create_pull_request`, {})), null);
  assert.equal(pre(tool(`${GH}merge_pull_request`, {})), null);
  assert.match(pre(tool(`${GH}pull_request_review_write`, {})), /never opens, reviews or merges/);
  // the act table's pre-approval reads its branch
  assert.match(allowReason('process', bash('git push -u origin claude/lane-x'), ctx), /neoProcess lane/);
  assert.equal(allowReason('process', bash('git push origin tranche'), ctx), null);
  // no product gate to read, but its issues read and acknowledged and its backstop due (Bob, 30 Oct); past 40 % of its window (issue 96)
  // the turn ends only with its handoff marked
  assert.match(stopReason('process', ctx), /process issues are not read.*no backstop is due/);
  const rdir = mkdtempSync(join(tmpdir(), 'refresh-')); mkdirSync(join(rdir, '.git')); const rctx = { ...ctx, root: rdir };
  assert.equal(postRecord('process', tool(`${REMOTE}archive_session`, { session_id: 'session_01OTHER' }), rctx), null);
  assert.equal(postRecord('bob', tool(`${REMOTE}send_message`, { session_id: 'session_01BOB', message: 'x' }), rctx), null);
  assert.ok(postRecord('process', tool(`${REMOTE}send_later`, { delay_minutes: 60, message: N.BACKSTOP_MESSAGE }), rctx).due);
  const csv = 'session,role,name,module,cache-read,cache-write,input,output,test runs,module lines,reviewed,note\nsession_01A,process,neoProcess #7,,,,,,,,,unmeasured: refused\nsession_01B,process,neoProcess #8,,1,2,3,4,,,,\nsession_01C,job,x,,,,,,,,,unmeasured: refused\n';
  assert.deepEqual(N.idleLaneSessions(csv), [{ session: 'session_01A', name: 'neoProcess #7' }]);
  assert.match(metricsText(csv, ['session_01A', 'process', 'neoProcess #7', '', 9, 9, 9, 9, '', '', '', '']), /\nsession_01A,process,neoProcess #7,,9,9,9,9,,,,\nsession_01B/);
  assert.match(metricsText(csv, ['session_01D', 'process', 'neoProcess #9', '', '', '', '', '', '', '', '', 'unmeasured: refused']), /session_01C,job[^\n]*\nsession_01D,process,neoProcess #9,,,,,,,,,unmeasured: refused\n$/);
  assert.match(contextReason('process', 600_000, ctx, 1_000_000), /proc process handoff` and create your successor with the call it prints/);
  assert.match(contextReason('process', 410_000, ctx, 1_000_000), /past 40 %/);
  assert.equal(contextReason('process', 390_000, ctx, 1_000_000), null);
  // the start refuses outside the process repository and on main; its reading set is the lane's
  const w = world();
  await assert.rejects(N.processStart({ product: w.bob.dir, branch: 'claude/lane-x', session: L1 }), /works in the process repository/);
  await assert.rejects(N.processStart({ product: N.PROCESS, branch: 'main', session: L1 }), /never main/);
  await assert.rejects(N.processStart({ product: N.PROCESS, session: L1 }), /--branch/);
  const r = N.reading({ role: 'process' });
  assert.deepEqual(r.files.map((x) => x.book).filter(Boolean), ['design', 'governance', 'sessions']);
  assert.match(r.next, /proc process start --branch/);
});

test('an onboarding session pushes only the project\'s onboard branch, opens and merges the seed pull request, and starts no session (ONBOARDING §1)', () => {
  const ctx = { role: 'onboard', branch: 'onboard', session: L1, root: '/nowhere', product: '../p' };
  const pre = (input) => preReason('onboard', input, ctx);
  assert.equal(preReason(null, bash('node tools/proc.mjs onboard start --product ../p --session s'), {}), null);
  assert.equal(pre(bash('git -C ../p push -u origin onboard')), null);
  assert.match(pre(bash('git -C ../p push origin HEAD:main')), /nothing is pushed to main/);
  assert.match(pre(bash('git -C ../p push origin tranche')), /onboarding session pushes only onboard/);
  assert.equal(pre(tool(`${GH}create_pull_request`, {})), null);
  assert.equal(pre(tool(`${GH}merge_pull_request`, {})), null);
  assert.match(pre(tool(`${REMOTE}create_session`, { title: 'ROOT #1' })), /starts no session/);
  assert.equal(stopReason('onboard', ctx), null);
  assert.match(contextReason('onboard', 600_000, ctx, 1_000_000), /proc init --check/);
});

// Bob, 30 Oct ("Go with A"): every project raises a process flaw as an issue on the process repository; the lane reads the
// open issues at its start and each backstop, acknowledges each, and closes it naming the fix's commit on main.
test('process issues: filed by any role only as `proc issue` printed it; the lane reads, acknowledges and closes them; a product session never edits the process', async () => {
  const w = world(), own = N.processRepo(), root = w.bob.root;
  // the two roles that work in the process repository file directly (an onboarding session has both repositories)
  writeFileSync(join(root, '.git', N.ROLE_FILE), JSON.stringify({ role: 'onboard', product: 'toy', session: B1, name: 'ONBOARD #1' }));
  const rep = f(w.base, 'report.md', 'The gate runs node 22; the product pins 26.\n');
  // filing: the call printed, for the process repository only, the reporter named in the body
  const r = N.issueFile({ product: w.bob.dir, title: 'The gate ignores the product\'s node version', file: rep });
  assert.equal(r.tool, `${GH}issue_write`); assert.deepEqual([r.call.method, r.call.owner, r.call.repo], ['create', own.owner, own.repo]);
  assert.match(r.call.body, /^The gate runs node 22; the product pins 26\.\n\n\*\*Filed by\*\* · ONBOARD #1 \(onboard, session_01B+\) on [\w.-]+\/[\w.-]+, by `proc issue`, \d{4}-\d\d-\d\d\./);
  writeFileSync(join(root, '.git', N.ROLE_FILE), JSON.stringify({ role: 'bob', product: 'toy', session: B1, name: 'BOB #1' }));
  const ctx = ctxOf(root);
  assert.throws(() => N.issueFile({ product: w.bob.dir, file: rep }), /--title/);
  // the hook passes exactly that call, and pre-approves it; a changed title, another method or a stale record is refused
  assert.equal(issueReason('bob', r.call, ctx), null);
  assert.equal(preReason('bob', tool(`${GH}issue_write`, r.call), ctx), null);
  assert.match(allowReason('bob', tool(`${GH}issue_write`, r.call), ctx), /the call `proc issue` printed/);
  assert.match(issueReason('bob', { ...r.call, title: 'x' }, ctx), /only as `proc issue/);
  assert.match(issueReason('bob', r.call, ctx, Date.now() + 31 * 60e3), /within 30 minutes/);
  assert.match(issueReason('bob', { method: 'update', owner: own.owner, repo: own.repo, issue_number: 1, state: 'closed' }, ctx), /only the neoProcess lane changes a process issue/);
  assert.equal(issueReason('bob', { method: 'create', owner: 'someone', repo: 'else', title: 't' }, ctx), undefined);   // not the process's
  assert.equal(allowReason('bob', tool(`${GH}issue_write`, { ...r.call, title: 'x' }), ctx), null);
  // GOV 5: no role but the lane edits a file of the process checkout
  for (const role of ['bob', 'job', 'lane', 'root', 'onboard']) assert.match(preReason(role, tool('Edit', { file_path: join(N.PROCESS, 'tools', 'hooks.mjs') }), { ...ctx, module: 'alpha' }), /never changed in place.*proc issue/, role);
  assert.equal(preReason('process', tool('Edit', { file_path: join(N.PROCESS, 'tools', 'hooks.mjs') }), { role: 'process', root: N.PROCESS, branch: 'x' }), null);
  assert.equal(preReason('bob', tool('Write', { file_path: join(w.bob.dir, 'notes.md') }), ctx), null);
  assert.equal(preReason('bob', tool('Write', { file_path: `${N.PROCESS}-other/x.md` }), ctx), null);   // a sibling directory is not the checkout
  // the lane's reading of the issues: pull requests dropped, NEW until a comment of the lane's, the read kept for the Stop hook
  const api = `https://api.github.com/repos/${own.owner}/${own.repo}`;
  const fake = (comments) => async (url) => ({ status: 200, text: async () => JSON.stringify(url === `${api}/issues?state=open&per_page=100`
    ? [{ number: 7, title: 'a flaw', user: { login: 'civicsmith' }, created_at: '2026-10-30T01:00:00Z', comments: 1, html_url: 'u7' }, { number: 8, title: 'a PR', pull_request: {}, user: { login: 'x' } }, { number: 9, title: 'quiet', user: { login: 'y' }, created_at: '2026-10-30T02:00:00Z', comments: 0, html_url: 'u9' }]
    : url === `${api}/issues/7/comments?per_page=100` ? comments : []) });
  const a = await N.openIssues({ fetch: fake([{ body: 'thanks' }]) });
  assert.deepEqual(a.issues.map((i) => [i.number, i.state, i.by]), [[7, 'NEW', 'civicsmith'], [9, 'NEW', 'y']]);
  const b = await N.openIssues({ fetch: fake([{ body: `${N.LANE_MARK}acknowledged, today.` }]) });
  assert.deepEqual(b.issues.map((i) => i.state), ['ACKNOWLEDGED', 'NEW']);
  const down = await N.openIssues({ fetch: async () => ({ status: 403, text: async () => '{}' }) });
  assert.equal(down.ok, false); assert.match(down.error, /answered 403/);
  // the lane's Stop hook: the issues read, every one acknowledged, a backstop due
  const lane = mkdtempSync(join(tmpdir(), 'lane-')); execFileSync('git', ['init', '-q', lane]);
  const lctx = { role: 'process', root: lane, session: L1, branch: 'x' }, keep = (name, v) => writeFileSync(join(lane, '.git', name), JSON.stringify(v));
  assert.match(laneStopReason(lctx), /issues are not read.*no backstop is due/);
  keep(N.ISSUES_FILE, a); assert.match(laneStopReason(lctx), /issue\(s\) #7, #9 not acknowledged/);
  keep(N.ISSUES_FILE, { ...b, issues: b.issues.slice(0, 1) }); assert.match(laneStopReason(lctx), /^no backstop is due/);
  keep(N.BACKSTOP_FILE, { due: new Date(Date.now() + 60e3).toISOString() }); assert.equal(laneStopReason(lctx), null);
  keep(N.ISSUES_FILE, down); assert.match(laneStopReason(lctx), /could not be read \(GET .* answered 403\)/);
  keep(N.ISSUES_FILE, { ok: true, issues: [] }); keep(N.BACKSTOP_FILE, { due: '2000-01-01T00:00:00Z' }); assert.match(laneStopReason(lctx), /no backstop/);
  keep('proc-handoff.json', { session: L1 }); assert.equal(laneStopReason(lctx), null);   // handed off: the successor's backstop
  assert.match(N.backstopReason({ message: N.BACKSTOP_MESSAGE, delay_minutes: 600 }), /30 to 240/);
  assert.match(N.backstopReason({ message: 'later', delay_minutes: 60 }), /arms only its backstop/);
  assert.match(allowReason('process', tool(`${REMOTE}send_later`, { message: N.BACKSTOP_MESSAGE, delay_minutes: 60 }), lctx), /backstop/);
  // acknowledging and closing are the lane's, each printed; a close names a commit already on main
  assert.throws(() => N.issueAck({ product: w.bob.dir, number: 7, note: 'x' }), /only the neoProcess lane/);
  assert.throws(() => N.issueClose({ product: w.bob.dir, number: 7, commit: 'HEAD', note: 'x' }), /only the neoProcess lane/);
  writeFileSync(join(root, '.git', N.ROLE_FILE), JSON.stringify({ role: 'process', product: '.', session: L1, name: 'NEOPROCESS', branch: 'x' }));
  const ack = N.issueAck({ product: w.bob.dir, number: 7, note: 'Fixed by the next certified change.' });
  assert.ok(ack.call.body.startsWith(`${N.LANE_MARK}acknowledged, `)); assert.equal(ack.call.issue_number, 7);
  g(root, 'commit', '-q', '--allow-empty', '-m', 'a fix not on main');
  assert.throws(() => N.issueClose({ product: w.bob.dir, number: 7, commit: 'HEAD', note: 'x' }), /not on main yet/);
  assert.throws(() => N.issueClose({ product: w.bob.dir, number: 7, commit: 'nope', note: 'x' }), /not a commit here/);
  const main = g(root, 'rev-parse', 'origin/main'), c = N.issueClose({ product: w.bob.dir, number: 7, commit: main, note: 'The gate reads the product\'s version.' });
  assert.deepEqual(c.calls.map((x) => x.tool), [`${GH}add_issue_comment`, `${GH}issue_write`]);
  assert.match(c.calls[0].call.body, new RegExp(`^\\*\\*neoProcess lane\\*\\* · fixed by ${main} on main`));
  const np = N.issueClose({ product: w.bob.dir, number: 9, notPlanned: true, note: 'A question, answered here.' });
  assert.equal(np.calls[1].call.state_reason, 'not_planned'); assert.match(np.calls[0].call.body, /closed with no change: not a process flaw/);
  const dup = N.issueClose({ product: w.bob.dir, number: 9, duplicateOf: 7, note: 'Same flaw.' });
  assert.deepEqual([dup.calls[1].call.state_reason, dup.calls[1].call.duplicate_of], ['duplicate', 7]);
  assert.throws(() => N.issueClose({ product: w.bob.dir, number: 9, note: 'x' }), /--commit/);
  N.issueClose({ product: w.bob.dir, number: 7, commit: main, note: 'The gate reads the product\'s version.' });
  const pctx = ctxOf(root);
  assert.equal(issueReason('process', c.calls[1].call, pctx), null);
  assert.match(issueReason('process', { ...c.calls[1].call, issue_number: 8 }, pctx), /only as `proc issue close` printed it/);
});

// Issue 61 (Bob, 30 Oct: "speak to your audience in words they understand ... consistently every time"): Bob reads only the
// last message of the turns of BOB, ROOT, a lane, the neoProcess lane and an onboarding session.
test('plain words for Bob: the deterministic check refuses labels, ids, code, file names and acts in prose; plain news passes', () => {
  const kinds = (m) => plainFaults(m).map((f) => f.kind.split(' (')[0]);
  // the message that drew Bob's words, and the kinds the onboarding session measured
  assert.deepEqual(kinds('Your one step: start #13 on that account and paste in the block from your page.'), ['a bare number', 'an act asked of Bob in prose']);
  assert.deepEqual(kinds('BOB #335 (session_01RAN5ejjuYNZmiep8zGD5YK) runs on another account.'), ['a session, trigger or environment id', 'a bare number']);
  assert.deepEqual(kinds('Done: K2055 folded into GOV 1 (§6); see tools/proc.mjs, commit 8edac3e. ONB-1 stays in next.md.').sort(), ['a commit hash', 'a file name', 'a file name', 'a principle, rule or section number', 'a principle, rule or section number', 'an entry or ruling id', 'an entry or ruling id'].sort());
  assert.deepEqual(kinds('Run `proc status` to see it.'), ['code in backticks']);
  assert.deepEqual(kinds('Please approve it on your phone.'), ['an act asked of Bob in prose']);
  assert.deepEqual(kinds('Paste this as the new session\'s first message:\n\n```\nYou are X.\n```'), ['an act asked of Bob in prose']);   // the block is not judged; the act is
  assert.deepEqual(kinds('1. Open github.com and sign in.\n2. Click the green button.'), ['steps for Bob without the page\'s own labels in bold']);
  assert.deepEqual(kinds('Merged by P17 rule 9 and section 3.'), ['a principle, rule or section number', 'a principle, rule or section number', 'a principle, rule or section number']);
  // not judged: a link's address, a fenced block to paste, bold-labelled steps (verified by `proc steps` in the steps check), Bob's own field
  for (const m of [
    'The fix is on main: the process\'s checks now run in every session ([the issue](https://github.com/o/r/issues/63)). Nothing for Bob to do.',
    'The text for the new session is in the box below, unchanged:\n\n```\nYou are neoProcess #14 (session_01X) on branch claude/x.\n```\n\nNothing else waits on it.',
    '1. Open **Settings** on the repository page.\n2. Click **Rulesets**.',
    'In Q3 the CO2 numbers under SB100 matter; the tranche closed with 14 modules changed and every test green.',
    'Civicsmith\'s pull request waits for the current tranche to close. Nothing for Bob to do.',
    'Waiting on the UX design lane\'s answer about the installer. Nothing for Bob to do.',
    '']) assert.deepEqual(plainFaults(m), [], m);
  assert.equal(plainReason('Nothing for Bob to do.'), null);
  assert.match(plainReason('Fixed in #64.'), /^Bob reads this message and nothing else \(rulebook SES 9\): a bare number \("#64"\)\. Rewrite it in words he knows/);
  assert.deepEqual([...BOB_READS].sort(), ['bob', 'lane', 'onboard', 'process', 'root']);
});

test('the fresh reader: on only for the roles Bob reads, recorded by the pre hook, required by their Stop hook; its skill is the products\' too', () => {
  const lane = mkdtempSync(join(tmpdir(), 'reader-')); execFileSync('git', ['init', '-q', lane]);
  const ctx = { role: 'process', root: lane, session: L1, branch: 'x' };
  assert.match(readerReason('process', ctx), /invoke the skill neoprocess-reader/);
  for (const role of ['bob', 'root', 'lane', 'onboard']) assert.match(readerReason(role, { ...ctx, role }), /not on for this session/, role);
  assert.equal(readerReason('job', { ...ctx, role: 'job' }), null);
  writeFileSync(join(lane, '.git', READER_FILE), JSON.stringify({ session: 'session_01OTHER' }));
  assert.match(readerReason('process', ctx), /not on/);   // another session's reader is not this one's
  writeFileSync(join(lane, '.git', READER_FILE), JSON.stringify({ session: L1 }));
  assert.equal(readerReason('process', ctx), null);
  assert.match(preReason('job', tool('Skill', { skill: 'neoprocess-reader' }), { role: 'job', module: 'alpha', root: lane }), /judges only what Bob reads/);
  assert.equal(preReason('process', tool('Skill', { skill: 'neoprocess-reader' }), ctx), null);
  // the hook itself records it (the post event) and the Stop event then lets a plain message end, and refuses a label
  const HOOKS = join(HERE, '..', 'hooks.mjs');
  writeFileSync(join(lane, '.git', N.ROLE_FILE), JSON.stringify({ role: 'process', product: '.', session: 'session_01HOOK', branch: 'x' }));
  writeFileSync(join(lane, '.git', N.ISSUES_FILE), JSON.stringify({ ok: true, issues: [] }));
  writeFileSync(join(lane, '.git', N.BACKSTOP_FILE), JSON.stringify({ due: '2099-01-01T00:00:00Z' }));
  const run = (ev, input) => execFileSync('node', [HOOKS, ev], { input: JSON.stringify({ session_id: `t-${ev}-${Math.random()}`, ...input }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: lane } });
  assert.match(run('stop', { last_assistant_message: 'Nothing for Bob to do.' }), /fresh reader is not on/);
  run('post', { tool_name: 'Skill', tool_input: { skill: 'neoprocess-reader' } });   // recorded once the call has run (N2-6)
  assert.equal(readLocal(lane, READER_FILE).session, 'session_01HOOK');
  assert.equal(run('stop', { last_assistant_message: 'The fix is on main. Nothing for Bob to do.' }), '');
  assert.match(JSON.parse(run('stop', { last_assistant_message: 'Fixed in #64; see tools/proc.mjs.' })).reason, /a bare number \("#64"\); a file name \("tools\/proc\.mjs"\)/);
  // issue 102: the display event judges a whole draft before it is shown (non-interactive shape: index 0, final), with the
  // same checks minus the model, and withholds only what the Stop hook would still refuse
  const dctx = { role: 'process', session: 'session_01HOOK', root: lane, product: '.' }, draft = (delta, x = {}) => ({ index: 0, final: true, delta, ...x });
  assert.match(displayReason('process', draft('Fixed in #64; see tools/proc.mjs.'), dctx), /a bare number/);
  assert.equal(displayReason('process', draft('The fix is on main. Nothing for Bob to do.'), dctx), null);
  assert.equal(displayReason('process', draft('Fixed in #64.', { final: false }), dctx), null);   // a batch of an interactive run: not the whole draft
  assert.equal(displayReason('process', draft('Fixed in #64.', { index: 2 }), dctx), null);
  assert.equal(displayReason('process', draft('Fixed in #64.'), dctx, 3), null);   // the Stop hook lets the next one through: so does the display
  assert.equal(displayReason('job', draft('Fixed in #64.'), { ...dctx, role: 'job' }), null);   // nothing Bob reads
  try { unlinkSync(N_HOOKS.DISPLAY_FILE('session_01DISP')); } catch { /* first run */ }
  const dout = run('display', { session_id: 'session_01DISP', turn_id: 't', message_id: 'm', ...draft('Fixed in #64; see tools/proc.mjs.') });
  assert.deepEqual(JSON.parse(dout), { hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: N_HOOKS.WITHHELD } });
  assert.equal(run('display', { session_id: 'session_01DISP', turn_id: 't', message_id: 'm', ...draft('Nothing for Bob to do.') }), '');
  const dlog = JSON.parse(readFileSync(N_HOOKS.DISPLAY_FILE('session_01DISP'), 'utf8'));
  assert.equal(dlog.length, 2); assert.deepEqual(dlog.map((x) => [x.role, x.index, x.final, x.len]), [['process', 0, true, 33], ['process', 0, true, 22]]);
  // one text for every product: the shims copy the process's own reader skill verbatim; its hook is a prompt on Sonnet
  const skill = readFileSync(join(N.PROCESS, '.claude/skills/neoprocess-reader/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: neoprocess-reader\n/); assert.doesNotMatch(skill, /^hooks:/m);   // issue 111: the reader's prompt is run by the Stop command hook, not a frontmatter hook
  assert.match(N_LIB.FRESH_READER_PROMPT, /^You are a fresh reader standing in for Bob/);
  assert.match(N_LIB.FRESH_READER_PROMPT, /\$ARGUMENTS/); assert.match(N_LIB.FRESH_READER_PROMPT, /last_assistant_message/);
});

// Issue 69 (BOB #335, Civicsmith's first BOB, 30 Oct): the product had no `tranche`; its paused tranche ran on another branch
// under the old process, so the first epoch could not open, and the old record's BOB numbers were given again.
test('a running tranche is carried onto `tranche` before the first epoch: main merged in and winning, the old plan archived, the old record named', () => {
  const base = mkdtempSync(join(tmpdir(), 'carry-')), origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const seed = join(base, 'seed'); execFileSync('git', ['clone', '-q', origin, seed], { stdio: 'ignore' }); ident(seed, 'seed');
  cpSync(TOY, join(seed, 'toy'), { recursive: true }); f(seed, 'CLAUDE.md', 'old process\n');
  g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'before'); g(seed, 'branch', '-M', 'main'); g(seed, 'push', '-q', 'origin', 'main');
  g(seed, 'checkout', '-q', '-b', 'tranche/T9');
  f(seed, 'CLAUDE.md', 'old process, changed by the running tranche\n'); f(seed, 'work.txt', 'the running tranche\'s work\n');
  writeFileSync(join(seed, 'toy/build/plan/current.md'), '**Round** · R1 · layer 1 CLOSED · layer 2 OPEN\n# Plan T9 · the old build\n**Status** · OPEN · BOB #7 · session_01SEVENSEVENSEVENSEVEN77\n**Jobs** · money: MONEY #1 session_01MONEYMONEYMONEYMONEY11\n');
  writeFileSync(join(seed, 'toy/build/handoff.md'), '# Handoff\nBOB #6 to BOB #7; LANE-X #4 session_01LANEXLANEXLANEXLANEX44 stays live.\n');
  g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'the running tranche'); g(seed, 'push', '-q', 'origin', 'tranche/T9');
  g(seed, 'checkout', '-q', 'main'); f(seed, 'CLAUDE.md', 'Built by neoProcess\n'); f(seed, 'seeded.txt', 'the seed\n');
  g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'the seed'); g(seed, 'push', '-q', 'origin', 'main');
  const root = join(base, 'bob'); execFileSync('git', ['clone', '-q', '-b', 'main', origin, root], { stdio: 'ignore' }); ident(root, 'bob');
  const dir = join(root, 'toy'), R0 = 'session_01RRRRRRRRRRRRRRRRRRRRRRRR';
  // ROOT: the old record's numbers are not given again; the BOB starts on main (which holds the shims) and carries first
  N.rootStart({ product: dir, session: R0, name: 'ROOT #12' });
  assert.throws(() => N.rootBob({ product: dir, n: 7, branch: 'tranche/T9' }), /BOB #7 is named in tranche\/T9's old record: the new BOB is #8 or later/);
  const b = N.rootBob({ product: dir, n: 8, branch: 'tranche/T9' });
  assert.equal(b.create_session.source_revision, 'main');
  assert.match(b.create_session.prompt, /names BOB #7 last: that record is data.*run `proc tranche carry --from tranche\/T9 --name "BOB #8" --session <your session id>` \(make any dispatch it prints and run it again until it reports carried\), then `proc epoch open`; then `proc takeover --name "BOB #8"/);
  assert.match(b.create_session.prompt, /or you cannot start and your last message tells Bob why and what would let you;/);
  // BOB's own checkout, started on main
  const broot = join(base, 'bob2'); execFileSync('git', ['clone', '-q', '-b', 'main', origin, broot], { stdio: 'ignore' }); ident(broot, 'bob2');
  const bdir = join(broot, 'toy');
  // before the carry: no `tranche`, so the epoch cannot open; the carry's command passes the hook with no role, `2>&1` too
  assert.throws(() => N.epochOpen({ product: bdir }), /check out tranche first/);
  assert.equal(preReason(null, bash('node /x/tools/proc.mjs tranche carry --from tranche/T9 --product toy 2>&1 | tail -5'), {}), null);
  assert.equal(preReason(null, bash('node /x/tools/proc.mjs status --product . 2>/dev/null'), {}), null);
  assert.match(preReason(null, bash('node /x/tools/proc.mjs status > out.txt'), {}), /no role is recorded/);
  const B8 = { name: 'BOB #8', session: 'session_01BOBEIGHTBOBEIGHTBOBEIGH' };
  assert.throws(() => N.trancheCarry({ product: bdir, from: 'tranche/T9' }), /--name "BOB #<n>"/);
  assert.throws(() => N.trancheCarry({ product: bdir, from: 'main', ...B8 }), /--from/);
  // the fixed branch cannot sit beside `tranche/*` (git: a ref is a file or a directory): the old tip is kept, the old name pruned
  // (a bare remote takes the delete; a session's proxy refuses it and the command prints the prune workflow's dispatch instead)
  // issue 72: a local tracking name of an old branch the remote no longer has (a session's proxy refused the delete, so the
  // prune workflow deleted it on the remote only) blocks `origin/tranche`; the carry drops it
  g(broot, 'update-ref', 'refs/remotes/origin/tranche/T0', g(broot, 'rev-parse', 'origin/main'));
  const c = N.trancheCarry({ product: bdir, from: 'tranche/T9', ...B8 });
  assert.equal(g(broot, 'rev-parse', '--abbrev-ref', 'tranche@{upstream}'), 'origin/tranche');
  assert.equal(c.phase, 'carried'); assert.deepEqual(c.kept, ['carried/T9']); assert.equal(c.from, 'carried/T9');
  assert.equal(N.readRole(broot).role, 'bob'); assert.equal(stopReason('bob', ctxOf(broot)), null);   // before the epoch: no queue to gate
  assert.deepEqual(c.conflicts, ['CLAUDE.md']); assert.equal(c.archived, 'build/plan/archive/T9-R1.md'); assert.equal(c.lastBob, 7);
  assert.deepEqual(c.oldSessions.sort(), ['BOB #7 session_01SEVENSEVENSEVENSEVEN77', 'LANE-X #4 session_01LANEXLANEXLANEXLANEX44', 'MONEY #1 session_01MONEYMONEYMONEYMONEY11']);
  g(broot, 'fetch', '-q', 'origin');
  assert.equal(g(broot, 'show', 'origin/tranche:CLAUDE.md'), 'Built by neoProcess');   // main's text wins the conflict
  assert.equal(g(broot, 'show', 'origin/tranche:work.txt'), 'the running tranche\'s work');   // the running work kept
  assert.equal(g(broot, 'show', 'origin/tranche:seeded.txt'), 'the seed');
  assert.match(g(broot, 'show', 'origin/tranche:toy/build/plan/archive/T9-R1.md'), /# Plan T9 · the old build/);
  assert.throws(() => g(broot, 'show', 'origin/tranche:toy/build/plan/current.md'));
  g(broot, 'merge-base', '--is-ancestor', 'origin/carried/T9', 'origin/tranche'); g(broot, 'merge-base', '--is-ancestor', 'origin/main', 'origin/tranche');   // a merge, never a rebase
  // then the first epoch opens on it, and a second carry is refused
  assert.match(N.epochOpen({ product: bdir }).epoch, /^E\d+$/);
  assert.throws(() => N.trancheCarry({ product: bdir, from: 'tranche/T9', ...B8 }), /is open: a tranche is carried only before the first epoch/);
});

// Issue 75 (BOB #336, Civicsmith, 30 Oct): a product session reaches only its product, so its report goes on the product's
// state branch; the lane reads every product's reports by git, files each new one, and its turn ends only once all are filed.
test('a product role reports a process flaw on its state branch; the lane reads it by git, files it once, and the epoch keeps it', () => {
  const w = world(), o = { product: w.bob.dir };
  N.epochOpen(o); N.takeover({ ...o, name: 'BOB #1', session: B1 });
  const rep = f(w.base, 'flaw.md', 'The tool refuses every layer start.\n');
  const r1 = N.issueFile({ ...o, title: 'Layer start refuses every module', file: rep }), r2 = N.issueFile({ ...o, title: 'A second flaw', file: rep });
  assert.match(r1.reported, /:state\/E\d+:issues\/\d{4}-\d\d-\d\d-bob-1-1\.md$/); assert.match(r2.reported, /-bob-1-2\.md$/);
  assert.match(N.stateRead(N.repo(w.bob.dir), r1.reported.split(':').pop()), /^# Layer start refuses every module\n\nThe tool refuses every layer start\.\n\n\*\*Filed by\*\* · BOB #1 \(bob, /);
  // the lane: its own checkout, the product listed by its remote; both reports NEW
  const lane = w.clone('lane'); g(lane.root, 'checkout', '-q', '-b', 'lanebranch');
  writeFileSync(join(lane.root, '.git', N.ROLE_FILE), JSON.stringify({ role: 'process', product: '.', session: 'session_01LANE', branch: 'lanebranch' }));
  mkdirSync(join(lane.root, 'lane-neoprocess'), { recursive: true }); writeFileSync(join(lane.root, N.PRODUCTS_FILE), JSON.stringify([w.origin]));
  const LR = N.repo(lane.root), seen = N.productReports(LR);
  assert.deepEqual(seen.errors, []); assert.deepEqual(seen.reports.map((x) => [x.state, x.path.replace(/\d{4}-\d\d-\d\d-/, '')]), [['NEW', 'issues/bob-1-1.md'], ['NEW', 'issues/bob-1-2.md']]);
  // filed from the report: its title and text, its id in the body, the call recorded for the hook; then FILED, never twice
  const fi = N.issueFile({ product: lane.root, report: seen.reports[0].id });
  assert.equal(fi.call.title, 'Layer start refuses every module'); assert.match(fi.call.body, /^The tool refuses every layer start\.[\s\S]*\*\*Filed by\*\* · BOB #1 [^\n]*\n\n\*\*Report\*\* · .*bob-1-1\.md, on .*'s branch state\/E\d+, filed by the neoProcess lane \d{4}-\d\d-\d\d\.\n\n---\n_Generated by \[Claude Code\]\(https:\/\/claude\.ai\/code\)_$/);
  assert.equal(issueReason('process', fi.call, ctxOf(lane.root)), null);
  assert.deepEqual(N.productReports(LR).reports.map((x) => x.state), ['FILED', 'NEW']);
  assert.throws(() => N.issueFile({ product: lane.root, report: seen.reports[0].id }), /already filed/);
  assert.throws(() => N.issueFile({ product: w.bob.dir, report: seen.reports[1].id }), /only the neoProcess lane/);
  // the lane's turn ends only with every report filed (the Stop hook reads what `proc process status` kept)
  writeFileSync(join(lane.root, '.git', N.ISSUES_FILE), JSON.stringify({ ok: true, issues: [], reports: N.productReports(LR).reports.map(({ text, ...x }) => x) }));
  writeFileSync(join(lane.root, '.git', N.BACKSTOP_FILE), JSON.stringify({ due: '2099-01-01T00:00:00Z' }));
  assert.match(laneStopReason(ctxOf(lane.root)), /product report\(s\) .*bob-1-2\.md not filed/);
  // the epoch's close keeps its reports on the tranche, where the lane still reads them
  const ec = N.epochClose(o);
  assert.equal(ec.reports.length, 2); assert.ok(ec.reports.every((x) => /^build\/process-issues\/\d{4}-\d\d-\d\d-bob-1-\d\.md$/.test(x)));
  assert.deepEqual(N.productReports(LR).reports.filter((x) => x.ref === 'tranche').map((x) => x.state).sort(), ['FILED', 'NEW']);
  // with no epoch, there is nowhere to put it: the session says it in plain words and Bob relays it
  assert.throws(() => N.issueFile({ ...o, title: 'x', file: rep }), /no epoch is open/);
});

// Issue 102 (Bob, 30 Oct): a message for Bob is judged before it is sent; the turn's end skips what `proc say` passed
test('a draft judged by proc say never reaches Bob when refused, and is not judged again when it passed', async () => {
  const lane = mkdtempSync(join(tmpdir(), 'say-')); execFileSync('git', ['init', '-q', lane]);
  writeFileSync(join(lane, '.git', N.ROLE_FILE), JSON.stringify({ role: 'process', product: '.', session: 'session_01SAY', branch: 'x' }));
  writeFileSync(join(lane, '.git', READER_FILE), JSON.stringify({ session: 'session_01SAY' }));
  writeFileSync(join(lane, '.git', N.ISSUES_FILE), JSON.stringify({ ok: true, issues: [] }));
  writeFileSync(join(lane, '.git', N.BACKSTOP_FILE), JSON.stringify({ due: '2099-01-01T00:00:00Z' }));
  const HOOKS = join(HERE, '..', 'hooks.mjs'), run = (ev, input) => execFileSync('node', [HOOKS, ev], { input: JSON.stringify({ session_id: 'session_01SAY', ...input }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: lane } });
  const bad = 'Fixed in #64; see tools/proc.mjs.', good = 'The fix is on main. Nothing for Bob to do.';
  await assert.rejects(N.say({ product: lane, file: join(lane, 'none.md') }), /--file/);
  const r1 = await N.say({ product: lane, file: f(lane, 'd1.md', bad), judge: false });
  assert.equal(r1.ok, false); assert.match(r1.faults[0], /a bare number/); assert.equal(r1.judged, false);
  assert.equal(N_LIB.saidPassed(lane, 'session_01SAY', bad), false);
  assert.match(JSON.parse(run('stop', { last_assistant_message: bad })).reason, /a bare number.*judge the rewrite before you send it: write it to a file and run `proc say --file/);   // sent unjudged: refused, with the way
  const r2 = await N.say({ product: lane, file: f(lane, 'd2.md', good), judge: false });
  assert.deepEqual([r2.ok, r2.faults, r2.judged], [true, [], false]);
  assert.equal(N_LIB.saidPassed(lane, 'session_01SAY', good), true); assert.equal(N_LIB.saidPassed(lane, 'session_01SAY', `${good}\n`), true);   // the hook's text may end in a newline
  assert.equal(N_LIB.saidPassed(lane, 'session_01OTHER', good), false); assert.equal(N_LIB.saidPassed(lane, 'session_01SAY', bad), false);
  assert.equal(run('stop', { last_assistant_message: good }), '');
  // the passed text, then another: only the last judged text is on record
  const r3 = await N.say({ product: lane, file: f(lane, 'd3.md', bad), judge: false }); assert.equal(r3.ok, false);
  assert.equal(N_LIB.saidPassed(lane, 'session_01SAY', good), false);
  // a message a job would send is not judged this way; ROOT's ending on Bob is not an askingBob fault (ROOT has no queue)
  writeFileSync(join(lane, '.git', N.ROLE_FILE), JSON.stringify({ role: 'job', module: 'alpha', product: '.', session: 'session_01SAY' }));
  await assert.rejects(N.say({ product: lane, file: join(lane, 'd2.md') }), /only a role whose last message Bob reads/);
  // the session's transcript, where Claude Code keeps it; the fresh reader's prompt from the reader skill, the verdict read
  const home = mkdtempSync(join(tmpdir(), 'home-')), pdir = join(home, '.claude', 'projects', resolve(lane).replace(/[^A-Za-z0-9]/g, '-'));
  assert.equal(N_LIB.transcriptOf(lane, home), null);
  mkdirSync(pdir, { recursive: true }); writeFileSync(join(pdir, 'old.jsonl'), '{}\n'); const late = join(pdir, 'new.jsonl'); writeFileSync(late, '{}\n'); const t = new Date(Date.now() + 5000); utimesSync(late, t, t);
  assert.equal(N_LIB.transcriptOf(lane, home), late);
  let seen = null; const judge = (prompt) => { seen = prompt; return JSON.stringify({ result: '{"ok": false, "reason": "Fresh reader (Bob sees only this message): fault 1: \\"#64\\": name the thing."}' }); };
  assert.match(N_LIB.freshReaderReason(bad, judge), /^Fresh reader \(Bob sees only this message\): fault 1/);
  assert.match(seen, /You are a fresh reader standing in for Bob/); assert.ok(seen.includes(JSON.stringify({ last_assistant_message: bad }))); assert.ok(!seen.includes('$ARGUMENTS'));
  assert.equal(N_LIB.freshReaderReason(bad, () => JSON.stringify({ result: '{"ok": true}' })), null);
  assert.equal(N_LIB.freshReaderReason(bad, () => 'not json'), null);
  // the turn's end: the fresh reader first, then the evidence judge, with the same run; nothing for an empty message
  let calls = 0; const run2 = (prompt) => { calls++; return JSON.stringify({ result: /fresh reader/.test(prompt) ? '{"ok": true}' : '{"ok": false, "reason": "Evidence check (P20, translate, never add): x"}' }); };
  assert.match(N_LIB.judgeReason({ last_assistant_message: bad, transcript_path: late }, run2), /^Evidence check/); assert.equal(calls, 2);
  assert.equal(N_LIB.judgeReason({ last_assistant_message: '  ' }, run2), null);
});

// DRYRUN §12 (30 Oct): an issue's comment is out of a product session's reach, so the lane's reply to a product's report is
// written in the process repository, which the product holds read-only; BOB's status lists it until BOB records it seen.
test('the lane replies to a product\'s report in the process repository; the product\'s BOB sees it in its status once', () => {
  const w = world(), o = { product: w.bob.dir };
  N.epochOpen(o); N.takeover({ ...o, name: 'BOB #1', session: B1 });
  const r1 = N.issueFile({ ...o, title: 'Layer start refuses every module', file: f(w.base, 'flaw.md', 'The tool refuses every layer start.\n') });
  const lane = w.clone('lane'); g(lane.root, 'checkout', '-q', '-b', 'lanebranch');
  writeFileSync(join(lane.root, '.git', N.ROLE_FILE), JSON.stringify({ role: 'process', product: '.', session: 'session_01LANE', branch: 'lanebranch' }));
  mkdirSync(join(lane.root, 'lane-neoprocess'), { recursive: true }); writeFileSync(join(lane.root, N.PRODUCTS_FILE), JSON.stringify([w.origin]));
  const id = N.productReports(N.repo(lane.root)).reports[0].id, note = 'Layer start now reads the layer row; nothing to do but run it again.';
  assert.throws(() => N.issueReply({ product: lane.root, report: id, number: 80, note }), /not filed yet/);
  N.issueFile({ product: lane.root, report: id });
  assert.throws(() => N.issueReply({ product: lane.root, report: id, number: 80, note: 'short' }), /--note/);
  assert.throws(() => N.issueReply({ product: w.bob.dir, report: id, number: 80, note }), /only the neoProcess lane/);
  const rp = N.issueReply({ product: lane.root, report: id, number: 80, note });
  assert.match(rp.reply, /^lane-neoprocess\/replies\/[\w.-]+bob-1-1\.md$/);
  const text = g(lane.root, 'show', `origin/lanebranch:${rp.reply}`);
  assert.match(text, /^# Layer start refuses every module\n\n\*\*Report\*\* · \S+bob-1-1\.md\n\*\*Issue\*\* · https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/80\n\*\*Replied\*\* · \d{4}-\d\d-\d\d, by the neoProcess lane\n\nLayer start now reads/);
  // the process repository's main, as a product session's read-only clone sees it: nothing until the reply is merged there
  const pbare = join(w.base, 'process.git'), pseed = join(w.base, 'pseed'), pdir = join(w.base, 'proc');
  execFileSync('git', ['init', '-q', '--bare', pbare]); execFileSync('git', ['clone', '-q', pbare, pseed], { stdio: 'ignore' }); ident(pseed, 'pseed');
  f(pseed, 'README.md', 'the process\n'); g(pseed, 'add', '.'); g(pseed, 'commit', '-q', '-m', 'p'); g(pseed, 'branch', '-M', 'main'); g(pseed, 'push', '-q', 'origin', 'main');
  execFileSync('git', ['clone', '-q', '--branch', 'main', pbare, pdir], { stdio: 'ignore' });   // as the shims' SessionStart hook clones it
  const B = { ...o, processDir: pdir }, items = () => N.status(B).queue.filter((q) => q.item.startsWith('READ PROCESS REPLY')).map((q) => q.item);
  assert.deepEqual(items(), []);
  mkdirSync(join(pseed, 'lane-neoprocess', 'replies'), { recursive: true }); f(pseed, rp.reply, `${text}\n`);
  f(pseed, 'lane-neoprocess/replies/other-product-1.md', text.replace(/\*\*Report\*\* · \S+/, '**Report** · someone/else:x.md'));
  g(pseed, 'add', '.'); g(pseed, 'commit', '-q', '-m', 'reply'); g(pseed, 'push', '-q', 'origin', 'main');
  assert.deepEqual(items(), []);   // fetched at most hourly: the stamp holds
  rmSync(join(pdir, '.git', 'proc-replies-fetch.json'));
  assert.deepEqual(items(), [`READ PROCESS REPLY ${id}`]);   // its own product's reply only
  assert.ok(existsSync(join(pdir, rp.reply)));   // issue 92: the clone itself brought to the process's main, so a fix reaches a running session
  f(pdir, 'README.md', 'changed in place\n');
  assert.deepEqual(N.processRefresh(pdir), { refreshed: false, why: 'changed in place' });
  g(pdir, 'checkout', '-q', '--', 'README.md'); g(pdir, 'checkout', '-q', '-b', 'other');
  assert.deepEqual(N.processRefresh(pdir), { refreshed: false, why: 'not on main' });
  g(pdir, 'checkout', '-q', 'main');
  f(pseed, 'NEW.md', 'a fix\n'); g(pseed, 'add', '.'); g(pseed, 'commit', '-q', '-m', 'fix'); g(pseed, 'push', '-q', 'origin', 'main');
  assert.equal(N.processRefresh(pdir).refreshed, true); assert.ok(existsSync(join(pdir, 'NEW.md')));
  // issue 98: a role's start brings the copy to main, and refuses one it cannot bring there (changed in place)
  f(pseed, 'NEW2.md', 'another fix\n'); g(pseed, 'add', '.'); g(pseed, 'commit', '-q', '-m', 'fix 2'); g(pseed, 'push', '-q', 'origin', 'main');
  assert.equal(N.processBehind(pdir), null); assert.ok(existsSync(join(pdir, 'NEW2.md')));
  f(pdir, 'README.md', 'changed in place\n');
  assert.match(N.processBehind(pdir), /is changed in place and cannot be brought to main/);
  assert.throws(() => N.jobStart({ ...o, module: 'alpha', session: 'session_01x', processDir: pdir }), /is changed in place/);
  g(pdir, 'checkout', '-q', '--', 'README.md');
  // the shims' start line on a copy already there (issue 98): brought to the tip, as a new session's start runs it
  f(pseed, 'NEW3.md', 'a third fix\n'); g(pseed, 'add', '.'); g(pseed, 'commit', '-q', '-m', 'fix 3'); g(pseed, 'push', '-q', 'origin', 'main');
  const line = `if [ -d "${pdir}/.git" ]; then { [ "$(git -C "${pdir}" rev-parse --abbrev-ref HEAD)" = main ] && [ -z "$(git -C "${pdir}" status --porcelain --untracked-files=no)" ] && git -C "${pdir}" fetch -q origin +refs/heads/main:refs/remotes/origin/main && git -C "${pdir}" merge -q --ff-only origin/main; } || echo "neoProcess: could not bring ${pdir} to the tip of main" >&2; else exit 9; fi`;
  execFileSync('sh', ['-c', line]); assert.ok(existsSync(join(pdir, 'NEW3.md')));
  const head = g(pseed, 'rev-parse', 'HEAD');
  // the pre-role hooks pass the command (reads only; its answers are the platform module's test, R6)
  assert.equal(preReason(null, bash(N.versionCheck(head)), {}), null);
  assert.match(N.status(B).queue.find((q) => q.item.startsWith('READ')).detail, /issues\/80\): read it whole by `git -C .* show origin\/main:lane-neoprocess\/replies\/.*`, act on it, then `proc issue seen --report /);
  // BOB records it seen on the tranche, once; the next BOB does not see it again
  assert.throws(() => N.issueSeen({ product: lane.root, report: id, processDir: pdir }), /BOB records/);
  const s = N.issueSeen({ ...B, report: id });
  assert.equal(s.seen, id); assert.match(g(w.bob.root, 'show', `origin/${N.TRANCHE}:toy/${N.SEEN_FILE}`), /^- \S+bob-1-1\.md · \d{4}-\d\d-\d\d · BOB #1 · Layer start refuses every module$/m);
  assert.deepEqual(items(), []);
  assert.throws(() => N.issueSeen({ ...B, report: id }), /no unseen reply/);
  void r1;
});

// Issue 78 (BOB #337, Civicsmith, 30 Oct): the last service took every requirement after it; and a set over 40 KB after
// trimming and splitting had no way to SESSIONS §6.3's third remedy, a summary for that task.
test('a service is charged only its own requirements; a set over its limit is read through a cited task summary', () => {
  const pub = '## Public\n\n### Purpose\n\nP.\n\n### Provides\n\n**first(a)**\n- **R1** one.\n- **R2** two.\n\n**last(b)**\n- **R3** three.\n- **R4** four.\n- **R9** (later) `last` also does this.\n- **R7** (later) about `first` only.\n- **R8** (later) about nothing named.\n- **R10** (later) `last` again.\n';
  const { blocks } = N.serviceBlocks(pub);
  assert.deepEqual(blocks.map((b) => [b.names, (b.text.match(/R\d+/g) || [])]), [[['first'], ['R1', 'R2']], [['last'], ['R3', 'R4', 'R9', 'R10']]]);
  // the toy's alpha made too large to read whole; its task summary, named for the running tranche, read instead
  const w = world(), dir = w.bob.dir, R = N.repo(dir), req = join(dir, 'build/requirements/alpha.md');
  writeFileSync(req, `${readFileSync(req, 'utf8')}\n${'- a long private note, kept for the test.\n'.repeat(1200)}`);
  const full = N.readingSet(R, 'alpha');
  assert.ok(full.bytes > N.MODULE_SET); assert.equal(full.summary, undefined);
  mkdirSync(join(dir, 'build/summaries/T1'), { recursive: true });
  writeFileSync(join(dir, 'build/summaries/T1/alpha.md'), '# alpha for T1\n\n- `add` returns the sum (alpha R1).\n- `sum` adds left to right (alpha R3).\n');
  const sm = N.readingSet(R, 'alpha');
  assert.ok(sm.bytes < N.MODULE_SET); assert.deepEqual(sm.summary.uncited, []); assert.equal(sm.summary.sources, full.bytes);
  assert.match(sm.files[0], /^build\/summaries\/T1\/alpha\.md \(the task summary, SESSIONS §6\.3: its sources stay binding/);
  writeFileSync(join(dir, 'build/summaries/T1/alpha.md'), '# alpha for T1\n\n- `add` returns the sum (alpha R1).\n- a statement with no source.\n');
  assert.deepEqual(N.readingSet(R, 'alpha').summary.uncited, [4]);
  // a summary for another tranche is not this task's
  rmSync(join(dir, 'build/summaries/T1'), { recursive: true }); mkdirSync(join(dir, 'build/summaries/T0'), { recursive: true });
  writeFileSync(join(dir, 'build/summaries/T0/alpha.md'), '- old (alpha R1).\n');
  assert.equal(N.readingSet(R, 'alpha').summary, undefined);
});

// Issue 61 (#14, 30 Oct): the fresh reader sees only the message, so a claim the session added passed it (#13's writer test:
// 20 of 35 finals fully accurate). The evidence check gives a fresh model the message and what the session saw.
test('the evidence check: what the session was told, ran and saw, never its own words; the model\'s verdict blocks', () => {
  const rows = [
    { type: 'user', message: { role: 'user', content: 'Run the suite.' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'my own claim' }, { type: 'tool_use', id: 'a', name: 'Bash', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'pass 38, fail 2' }] }] } },
    { type: 'user', message: { role: 'user', content: 'Stop hook feedback:\nrewrite it' } },
    { type: 'user', isSidechain: true, message: { role: 'user', content: 'a worker\'s prompt' } },
  ];
  const ev = turnEvidence(rows);
  assert.equal(ev, "[a message to the session]\nRun the suite.\n\n[the session ran Bash]\n{}\n\n[a tool's output]\npass 38, fail 2");
  assert.match(turnEvidence(rows, 20), /^\[earlier evidence cut: older than this is unknown to the judge\]\n.{20}$/s);
  // the lane's turn of 30 Oct (#19): over the limit, every tool output is shrunk to a head and a tail first, so the
  // session's earliest acts and every result line survive; the oldest is cut only when the shrunk evidence is still over
  const big = (id, text) => [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { f: id } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } },
  ];
  const long = [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 's', name: 'mcp__claude-code-remote__send_message', input: { session_id: 'x' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 's', content: [{ type: 'text', text: '{"status":"delivered"}' }] }] } },
    ...big('r1', 'A'.repeat(50_000) + ' END ONE'), ...big('r2', 'B'.repeat(50_000) + ' END TWO'),
  ];
  const shrunk = turnEvidence(long, 20_000);
  assert.doesNotMatch(shrunk, /^\[earlier evidence cut/);
  assert.match(shrunk, /\[the session ran mcp__claude-code-remote__send_message\]\n\{"session_id":"x"\}\n\n\[a tool's output\]\n\{"status":"delivered"\}/);
  assert.match(shrunk, /characters of this output cut …\]\n[A]+ END ONE/);
  assert.match(shrunk, / END TWO$/);
  assert.ok(shrunk.length <= 20_000, String(shrunk.length));
  assert.match(turnEvidence(long, 500), /^\[earlier evidence cut: older than this is unknown to the judge\]\n/);   // still over at the smallest cap
  const p = evidencePrompt('38 of 40 passed.', ev);
  assert.match(p, /<<<EVIDENCE\n\[a message to the session\]\nRun the suite\.[\s\S]*<<<MESSAGE\n38 of 40 passed\.\nMESSAGE>>>/);
  const out = (v) => JSON.stringify({ result: `Here: ${JSON.stringify(v)}` });
  assert.equal(evidenceVerdict(out({ ok: true })), null);
  assert.equal(evidenceVerdict(out({ ok: false, reason: 'Evidence check: "flaky" is not in what the session read' })), 'Evidence check: "flaky" is not in what the session read');
  for (const bad of ['', 'not json', JSON.stringify({ result: 'no verdict' }), out({ ok: false })]) assert.equal(evidenceVerdict(bad), null);   // never blocks on its own failure
  const d = mkdtempSync(join(tmpdir(), 'ev-')), tp = join(d, 't.jsonl');
  writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join('\n'));
  let seen = null;
  assert.equal(evidenceReason({ transcript_path: tp, last_assistant_message: 'The two failures are flaky.' }, (q) => { seen = q; return out({ ok: false, reason: 'unsupported: flaky' }); }), 'unsupported: flaky');
  assert.match(seen, /pass 38, fail 2/); assert.doesNotMatch(seen, /my own claim|rewrite it|a worker's prompt/);
  assert.equal(evidenceReason({ transcript_path: tp, last_assistant_message: '' }, () => { throw new Error('not run'); }), null);
  // registered beside the Stop hook in the process's skill and every product's shims; a job (Bob never reads it) is not judged
  const HOOKS = join(HERE, '..', 'hooks.mjs');
  assert.equal(JSON.parse(readFileSync(join(N.PROCESS, '.claude/settings.json'), 'utf8')).hooks, undefined);   // Bob, 30 Oct: the repository's settings wire no hook; the check below runs the code directly (PLT-4)
  const w = world();
  writeFileSync(join(w.bob.root, '.git', N.ROLE_FILE), JSON.stringify({ role: 'job', product: 'toy', session: J1, module: 'alpha' }));
  assert.equal(execFileSync('node', [HOOKS, 'evidence'], { input: JSON.stringify({ transcript_path: tp, last_assistant_message: 'x' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: w.bob.root, PATH: process.env.PATH } }), '');
});

// Issue 65 (ROOT #11, Civicsmith's first ROOT, 30 Oct): ROOT had no start command, so the hooks refused every act it needs.
test('ROOT records its role before any epoch exists, and starts a BOB only with the create_session `proc root bob` printed, once', () => {
  const w = world(), root = w.bob.root, R0 = 'session_01RRRRRRRRRRRRRRRRRRRRRRRR';
  // before the start: the start command passes the hook, an MCP tool does not
  assert.equal(preReason(null, bash(`node /x/tools/proc.mjs root start --session ${R0} --product toy`), {}), null);
  assert.match(preReason(null, tool(`${REMOTE}get_session`, {}), {}), /proc root start` for ROOT/);
  const st = N.rootStart({ product: w.bob.dir, session: R0, name: 'ROOT #11' });
  assert.equal(st.epoch, null); assert.match(st.next, /no BOB is recorded and no epoch is open: start the first with `proc root bob --n <n> --branch/);
  const ctx = ctxOf(root); assert.equal(ctx.role, 'root');
  assert.throws(() => N.rootStart({ product: w.bob.dir, session: 'x' }), /--session/);
  // what SESSIONS §3a gives ROOT passes; its turn's end is not BOB's gate
  for (const t of ['get_session', 'list_sessions', 'list_events', 'archive_session']) assert.equal(preReason('root', tool(`${REMOTE}${t}`, {}), ctx), null, t);
  assert.equal(stopReason('root', ctx), null);
  // the BOB start: printed, the branch on the remote, the commit on it; the hook passes exactly it, then never again
  assert.throws(() => N.rootBob({ product: w.bob.dir, n: 335, branch: 'nope' }), /not on the product's remote/);
  assert.throws(() => N.rootBob({ product: w.bob.dir, n: 335, commit: 'deadbeef00' }), /cannot start BOB #335/);
  const b = N.rootBob({ product: w.bob.dir, n: 335, commit: g(root, 'rev-parse', 'HEAD') });
  assert.equal(b.create_session.title, 'BOB #335'); assert.equal(b.create_session.source_revision, N.TRANCHE);
  assert.match(b.create_session.prompt, /^\/goal The run has ended, or the queue/);
  assert.match(b.create_session.prompt, new RegExp(`You are BOB #335, started by ROOT \\(${R0}\\)\\. You are the first BOB under neoProcess here.*run \`proc epoch open\` first; then \`proc takeover --name "BOB #335"`));
  assert.match(preReason('root', tool(`${REMOTE}create_session`, { ...b.create_session, title: 'BOB #336' }), ctx), /only a BOB, with the create_session `proc root bob/);
  assert.match(preReason('root', tool(`${REMOTE}create_session`, { ...b.create_session, prompt: 'hurry' }), ctx), /unchanged/);
  assert.equal(preReason('root', tool(`${REMOTE}create_session`, b.create_session), ctx), null);
  const HOOKS = join(HERE, '..', 'hooks.mjs');
  execFileSync('node', [HOOKS, 'pre'], { input: JSON.stringify({ session_id: 'r', tool_name: `${REMOTE}create_session`, tool_input: b.create_session }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  assert.equal(preReason('root', tool(`${REMOTE}create_session`, b.create_session), ctx), null);   // issue 107: asked is not made; a refused call leaves the start owed
  execFileSync('node', [HOOKS, 'post'], { input: JSON.stringify({ session_id: 'r', tool_name: `${REMOTE}create_session`, tool_input: b.create_session, tool_response: {} }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  assert.match(preReason('root', tool(`${REMOTE}create_session`, b.create_session), ctx), /already started by this ROOT/);
  assert.equal(N.rootBob({ product: w.bob.dir, n: 335 }).already, true);
  // ROOT arms no timer and opens no pull request; it files a process issue as any role does
  assert.match(preReason('root', tool(`${REMOTE}send_later`, {}), ctx), /arms no timer/);
  assert.match(preReason('root', tool(`${GH}create_pull_request`, {}), ctx), /never opens, reviews or merges/);
  assert.equal(N.reading({ role: 'root' }).next, 'proc root start --session <your session id>');
});

// A product for the two N2-6 tests below: a bare origin and one clone on the tranche (record's fixture).
const RB = 'session_01RBRBRBRBRBRBRBRBRBRBRBRB', RS = (c) => `session_01${c.repeat(24)}`;
function recWorld() {
  const base = mkdtempSync(join(tmpdir(), 'rec-hooks-')), origin = join(base, 'origin.git'), d = join(base, 'p');
  execFileSync('git', ['init', '-q', '--bare', origin]); execFileSync('git', ['clone', '-q', origin, d], { stdio: 'ignore' }); ident(d, 'p');
  writeFileSync(join(d, 'seed.md'), 'seed\n'); g(d, 'add', '.'); g(d, 'commit', '-q', '-m', 'seed'); g(d, 'branch', '-M', N.TRANCHE); g(d, 'push', '-q', 'origin', N.TRANCHE);
  return { base, origin, d };
}
// N2-6 (REC-5): the refresh record and the pre event's writes are gone; an archive is recorded from what the call returned.
test('R8: the lane\'s predecessor is recorded archived only from what archive_session returned, or unmeasured with the refusal', () => {
  const w = recWorld();
  g(w.d, 'checkout', '-q', '-b', 'lanebranch');
  mkdirSync(join(w.d, 'lane-neoprocess'), { recursive: true }); writeFileSync(join(w.d, 'lane-neoprocess/HANDOFF.md'), `# H\n\n**From** · neoProcess #10 (\`${RS('N')}\`), the lane's address. Before it #9 \`${RS('O')}\`, #8 \`${RS('P')}\`.\n`);
  g(w.d, 'add', '.'); g(w.d, 'commit', '-q', '-m', 'h'); g(w.d, 'push', '-q', 'origin', 'lanebranch');
  writeFileSync(join(w.d, '.git', N.ROLE_FILE), JSON.stringify({ role: 'process', product: '.', session: RS('N'), branch: 'lanebranch' }));
  const o = { product: w.d }, shown = () => g(w.d, 'show', `origin/lanebranch:${N.LANE_METRICS}`), rows = () => shown().split('\n').slice(1);
  assert.equal(N.REFRESH_FILE, undefined, 'no refresh record'); assert.equal(N.keepRefresh, undefined);
  assert.throws(() => N.processArchived({ ...o, session: RS('Q'), refused: 'x' }), /is not owed/);
  recordLocal(w.d, N.ROLE_FILE, { role: 'process', product: '.', session: RS('X'), branch: 'lanebranch' });   // a lane session the handoff does not name
  assert.throws(() => N.processArchived({ ...o, refused: 'x' }), /does not name this session/);
  recordLocal(w.d, N.ROLE_FILE, { role: 'process', product: '.', session: RS('N'), branch: 'lanebranch' });
  for (const bad of ['{"error":"Permission denied"}', '{}', 'not json', `{"session_id":"${RS('O')}"}`, '{"cache_read_tokens":5}']) assert.throws(() => N.processArchived({ ...o, usage: bad }), /shows no archive/, bad);
  assert.equal(existsSync(join(w.d, N.LANE_METRICS)), false, 'nothing written from a request or a failure');
  const r = N.processArchived({ ...o, refused: 'Permission denied by the classifier, [External System Writes]' });
  assert.deepEqual([r.archived, r.unmeasured], [RS('O'), true]);
  assert.deepEqual(rows(), [`${RS('O')},process,neoProcess #9,,,,,,,,,unmeasured: Permission denied by the classifier  [External System Writes]`]);
  assert.ok(shown().startsWith(METRICS_HEAD.trim()), 'the record\'s metrics head');
  N.processArchived({ ...o, refused: 'refused again, at a later refresh' });   // a later refusal replaces the unmeasured row
  assert.deepEqual(rows(), [`${RS('O')},process,neoProcess #9,,,,,,,,,unmeasured: refused again  at a later refresh`]);
  N.processArchived({ ...o, usage: '{"session_id":"x","cache_read_tokens":5,"cache_write_tokens":4,"input_tokens":3,"output_tokens":2}' });
  assert.deepEqual(rows(), [`${RS('O')},process,neoProcess #9,,5,4,3,2,,,,`], 'the measured row replaces the unmeasured one');
  assert.throws(() => N.processArchived({ ...o, usage: '{"cache_read_tokens":1}' }), /already recorded/);
});

test('R8: the hooks\' pre event writes no record; the post event records the fresh reader and a background worker once the call has run', () => {
  const w = recWorld(), ctx = { role: 'bob', session: RB, root: w.d };
  writeFileSync(join(w.d, '.git', N.ROLE_FILE), JSON.stringify({ role: 'bob', session: RB, product: '.' }));
  const HOOKS = join(HERE, '..', 'hooks.mjs');
  const run = (ev, input) => execFileSync('node', [HOOKS, ev], { input: JSON.stringify({ session_id: RB, ...input }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: w.d } });
  run('pre', { tool_name: 'Skill', tool_input: { skill: 'neoprocess-reader' } });
  run('pre', { tool_name: 'Agent', tool_input: { description: 'w1', prompt: 'x', run_in_background: true }, tool_use_id: 't1' });
  assert.equal(readLocal(w.d, N_HOOKS.READER_FILE), null, 'the pre event records nothing');
  assert.equal(readLocal(w.d, N.WORKERS_FILE), null);
  N_HOOKS.postRecord('bob', { tool_name: 'Skill', tool_input: { skill: 'neoprocess-reader' } }, ctx);
  assert.equal(readLocal(w.d, N_HOOKS.READER_FILE).session, RB);
  N_HOOKS.postRecord('bob', { tool_name: 'Agent', tool_input: { description: 'w1', run_in_background: true }, tool_use_id: 't1' }, ctx);
  N_HOOKS.postRecord('bob', { tool_name: 'Agent', tool_input: { description: 'w2', run_in_background: true }, tool_use_id: 't2' }, ctx);
  assert.deepEqual(N.runningWorkers(w.d, RB).map((x) => x.description), ['w1', 'w2']);
  assert.equal(N_HOOKS.postRecord('bob', { tool_name: 'Agent', tool_input: { description: 'fg' } }, ctx), null, 'a foreground worker is not a background one');
  assert.equal(recordLocal(join(w.base, 'nowhere'), 'x.json', {}), null, 'no checkout: nothing recorded, nothing thrown');
});

// R6 (review of PR 128): `proc status` runs the record's status for every role, before an epoch and after, with sizes and
// the context share from `--get-session`.
test('proc status delegates to the record\'s status: the same lines, before any epoch and after, with the context share', () => {
  const w = recWorld(), PROC = join(HERE, '..', 'proc.mjs');
  const cli = (...a) => JSON.parse(execFileSync('node', [PROC, 'status', '--product', w.d, ...a], { encoding: 'utf8' }));
  const before = cli();
  assert.deepEqual(before.record, statusLines(recordStatus({ product: w.d })), 'no epoch: the record\'s state, not a refusal');
  assert.match(before.record[0], /^epoch none open/);
  N.epochOpen({ product: w.d });
  const gs = JSON.stringify({ ccr: { external_metadata: { context_usage: { max_tokens: 1000, used_tokens: 600 } } } });
  writeFileSync(join(w.d, '.git', N.ROLE_FILE), JSON.stringify({ role: 'bob', session: RB, product: '.' }));
  const after = cli('--get-session', gs);
  assert.equal(after.epoch, 'E1', 'BOB\'s own queue beside it');
  assert.ok(after.record.some((l) => /^SIZE state\/E1:plan\.md /.test(l)));
  assert.ok(after.record.includes('context: 60 % of 1000 (threshold 40 %) REFRESH'));
  // BOB's reading set, from SESSIONS §3 by `reading`, given to the record's status (R6, K12)
  const set = N.reading({ role: 'bob' }).files;
  assert.ok(set.length > 1);
  for (const f of set) assert.ok(after.record.includes(`READ ${f.path.slice(N.PROCESS.length + 1)} ${f.bytes}`), f.path);
  assert.deepEqual(recordStatus({ product: w.d, set: set.map((f) => ({ path: f.path.slice(N.PROCESS.length + 1), bytes: f.bytes })) }).set.map((x) => x.path), set.map((f) => f.path.slice(N.PROCESS.length + 1)));
});
