// tools/record.mjs at its interface (build/requirements/record.md R1-R13), against a real remote: a bare origin and
// clones of it, the state branch opened by `epochOpen` as a build opens it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as REC from '../record.mjs';
import * as PLATFORM from '../platform.mjs';

const { repo, ghRepo, unpushed, commitPush, epoch, epochOpen, epochClose, stateRead, stateList, stateWrite, parsePlan, fmtPlan, planEdit, stop, resume, recordAct, actDone, USAGE_FIELDS, addr, paths, metricsRow, metricsText, unmeasuredRow, METRICS_HEAD, status, statusLines, contextShare, readingSizes, Refused, TRANCHE } = REC;
const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const S = (c) => `session_01${c.repeat(24)}`;
const BOB = S('B');
const put = (d, p, text) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), text); };

// A product: a bare origin with `tranche`, one clone on it, and the epoch's state branch opened with a plan.
function world({ plan = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'record-'));
  const origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const d = clone(base, origin, 'p', null);
  put(d, 'build/epochs.md', '# Epochs (labels only: nothing here points into a state branch)\n');
  put(d, 'src/a.mjs', 'export const a = 1;\n');
  g(d, 'add', '.'); g(d, 'commit', '-q', '-m', 'seed'); g(d, 'branch', '-M', TRANCHE); g(d, 'push', '-q', 'origin', TRANCHE);
  g(d, 'push', '-q', 'origin', `${TRANCHE}:refs/heads/main`);
  g(d, 'branch', '-q', '--set-upstream-to', `origin/${TRANCHE}`);
  writeFileSync(join(d, '.git', REC.ROLE_FILE), JSON.stringify({ role: 'bob', session: BOB, product: '.' }));   // BOB pushes to the tranche
  if (plan) {
    epochOpen({ product: d });
    stateWrite(repo(d), { 'plan.md': fmtPlan({ state: 'OPEN', bob: { name: 'BOB #1', session: BOB }, owed: [], layers: { 1: 'STARTED' } }) }, 'plan');
  }
  return { base, origin, d };
}
function clone(base, origin, name, branch) {
  const d = join(base, name);
  execFileSync('git', ['clone', '-q', ...(branch ? ['-b', branch] : []), origin, d], { stdio: 'ignore' });
  for (const [k, v] of [['user.name', name], ['user.email', `${name}@t`], ['commit.gpgsign', 'false']]) g(d, 'config', k, v);
  return d;
}
const worktree = (d) => `${g(d, 'rev-parse', 'HEAD')} ${g(d, 'rev-parse', '--abbrev-ref', 'HEAD')} ${g(d, 'status', '--porcelain')} ${g(d, 'worktree', 'list').split('\n').length}`;

test('R1: repo opens a product checkout from a subdirectory and answers its plumbing, its relative paths and its remote name', () => {
  const w = world({ plan: false });
  mkdirSync(join(w.d, 'sub'));
  const R = repo(join(w.d, 'sub'));
  assert.equal(R.root, g(w.d, 'rev-parse', '--show-toplevel'));
  assert.equal(R.rel('x.md'), 'sub/x.md');
  assert.equal(R.branch(), TRANCHE);
  assert.deepEqual(R.heads('refs/heads/*').sort(), ['main', TRANCHE]);
  assert.equal(R.remote(TRANCHE, '../src/a.mjs'), 'export const a = 1;');
  assert.equal(R.remote(TRANCHE, 'absent.md'), null);
  assert.equal(R.read('../src/a.mjs'), 'export const a = 1;\n');
  R.write('n.md', 'n\n'); assert.equal(readFileSync(join(w.d, 'sub/n.md'), 'utf8'), 'n\n');
  g(w.d, 'remote', 'set-url', 'origin', 'https://github.com/own/prod.git');
  assert.deepEqual(ghRepo(R), { owner: 'own', repo: 'prod' });
});

test('R2: the state branch is read and written by plumbing, with no checkout and no second worktree; a write is one pushed commit', () => {
  const w = world(), R = repo(w.d), e = epoch(R), before = worktree(w.d);
  const tip0 = g(w.d, 'rev-parse', `origin/state/${e}`);
  const c = stateWrite(R, { 'jobs/a.md': 'A\n', 'jobs/b.md': 'B\n' }, 'two files');
  assert.equal(worktree(w.d), before, 'the checkout is untouched');
  assert.equal(g(w.origin, 'rev-parse', `state/${e}`).slice(0, 7), c, 'pushed');
  assert.equal(g(w.origin, 'rev-list', '--count', `${tip0}..state/${e}`), '1', 'one commit');
  assert.equal(stateRead(R, 'jobs/a.md'), 'A');
  assert.deepEqual(stateList(R, 'jobs'), ['jobs/a.md', 'jobs/b.md']);
  stateWrite(R, { 'jobs/b.md': null }, 'remove');
  assert.deepEqual(stateList(R, 'jobs'), ['jobs/a.md']);
  assert.equal(stateWrite(R, { 'jobs/a.md': 'A\n' }, 'same'), g(w.origin, 'rev-parse', `state/${e}`).slice(0, 7), 'a write that changes nothing makes no commit');
});

test('R2: a write that loses a race is re-applied on the new tip and pushed, never forced: the other writer\'s commit stays', () => {
  const w = world(), R = repo(w.d), e = epoch(R);
  const other = clone(w.base, w.origin, 'other', `state/${e}`);
  // the first push from the product loses: a pre-push hook lets the other writer push first, once
  const hook = join(w.d, '.git/hooks/pre-push'), mark = join(w.base, 'raced');
  writeFileSync(hook, `#!/bin/sh\n[ -e ${mark} ] && exit 0\ntouch ${mark}\ncd ${other} && echo O > lanes-other.md && git add . && git commit -q -m other && git push -q origin HEAD:state/${e}\nexit 0\n`);
  chmodSync(hook, 0o755);
  stateWrite(R, { 'jobs/mine.md': 'M\n' }, 'mine');
  assert.ok(existsSync(mark), 'the race happened');
  const log = g(w.origin, 'log', '--format=%s', `state/${e}`);
  assert.match(log, /^mine\nother\n/, 'mine on top of the other, which is kept');
  assert.equal(stateRead(R, 'jobs/mine.md'), 'M');
  assert.equal(stateRead(R, 'lanes-other.md'), 'O');
});

test('R3: epochOpen opens the next epoch\'s state branch empty and logs its label on the tranche', () => {
  const w = world({ plan: false });
  const r = epochOpen({ product: w.d });
  assert.equal(r.epoch, 'E1');
  assert.equal(g(w.origin, 'ls-tree', '--name-only', 'state/E1'), 'epoch.md');
  assert.equal(g(w.origin, 'rev-list', '--count', 'state/E1'), '1', 'an orphan: one commit, no parent');
  assert.match(g(w.origin, 'show', `${TRANCHE}:build/epochs.md`), /^- E1 · opened \d{4}-\d\d-\d\d$/m);
  assert.throws(() => epochOpen({ product: w.d }), /E1 is still open/);
});

test('R3: epochClose is refused while an ask is open, and once none is, deletes the state branch and logs the close', () => {
  const w = world(), R = repo(w.d);
  stateWrite(R, { 'asks/A1.md': '# A1\n\n**From** · X #1\nq\n**Status** · RECEIVED\n' }, 'ask');
  assert.throws(() => epochClose({ product: w.d }), (e) => e instanceof Refused && /asks still open: A1 RECEIVED/.test(e.message));
  assert.match(g(w.origin, 'branch', '--list', 'state/E1'), /state\/E1/, 'still there');
  stateWrite(R, { 'asks/A1.md': '# A1\n\n**From** · X #1\nq\n**Status** · CLOSED\n' }, 'closed');
  const r = epochClose({ product: w.d });
  assert.equal(r.prune.deleted, true, 'deleted (the bare fixture allows it)');
  assert.equal(g(w.origin, 'branch', '--list', 'state/E1'), '', 'gone from origin');
  assert.match(g(w.origin, 'show', `${TRANCHE}:build/epochs.md`), /^- E1 · opened \S+ · closed \d{4}-\d\d-\d\d$/m);
  assert.equal(epoch(R), null);
});

test('R3: a delete the proxy refuses is printed as the prune workflow\'s dispatch (the route platform names), never forced', () => {
  const w = world(), R = repo(w.d);
  writeFileSync(join(w.origin, 'hooks', 'pre-receive'), '#!/bin/sh\nwhile read o n r; do [ "$n" = "0000000000000000000000000000000000000000" ] && { echo "deletes refused" >&2; exit 1; }; done\nexit 0\n');
  chmodSync(join(w.origin, 'hooks', 'pre-receive'), 0o755);
  const r = epochClose({ product: w.d });
  assert.equal(r.prune.deleted, false);
  assert.deepEqual([r.prune.dispatch.tool, r.prune.dispatch.workflow_id, r.prune.dispatch.ref, r.prune.dispatch.inputs.ref], [PLATFORM.limits().deleteRoute.act, PLATFORM.limits().deleteRoute.workflow, PLATFORM.limits().deleteRoute.ref, 'state/E1']);
  assert.match(g(w.origin, 'show', 'state/E1:epoch.md'), /^closed /m, 'marked closed, so no epoch reads open');
  assert.equal(epoch(R), null);
});

test('R4: commitPush commits only the files named on the branch named and pushes; unpushed lists what is not pushed', () => {
  const w = world({ plan: false }), R = repo(w.d);
  put(w.d, 'one.md', '1\n'); put(w.d, 'src/a.mjs', 'export const a = 2;\n');
  const c = commitPush(R, TRANCHE, ['one.md'], 'one');
  assert.equal(g(w.origin, 'rev-parse', '--short', TRANCHE), c);
  assert.equal(g(w.origin, 'show', '--name-only', '--format=', TRANCHE), 'one.md');
  assert.deepEqual(unpushed(R), ['uncommitted changes'], 'the other change is left alone');
  g(w.d, 'checkout', '-q', 'src/a.mjs');
  put(w.d, 'two.md', '2\n'); g(w.d, 'add', 'two.md'); g(w.d, 'commit', '-q', '-m', 'local');
  assert.deepEqual(unpushed(R), [`1 commit(s) on ${TRANCHE} not pushed`]);
});

test('R4: commitPush commits the files named and nothing else already staged; the rest stays staged (K15)', () => {
  const w = world({ plan: false }), R = repo(w.d);
  put(w.d, 'other.md', 'o\n'); g(w.d, 'add', 'other.md');
  put(w.d, 'one.md', '1\n');
  const c = commitPush(R, TRANCHE, ['one.md'], 'one');
  assert.equal(g(w.origin, 'rev-parse', '--short', TRANCHE), c);
  assert.equal(g(w.origin, 'show', '--name-only', '--format=', TRANCHE), 'one.md', 'the pushed commit holds one.md only');
  assert.equal(g(w.d, 'diff', '--cached', '--name-only'), 'other.md', 'the other staged file is still staged, uncommitted');
  // a named deletion is committed alone too, with other work staged beside it
  execFileSync('rm', [join(w.d, 'src/a.mjs')]);
  commitPush(R, TRANCHE, ['src/a.mjs', 'never.md'], 'drop a');
  assert.equal(g(w.origin, 'show', '--name-status', '--format=', TRANCHE), 'D\tsrc/a.mjs', 'the deletion only; a named path never committed records nothing');
  assert.equal(g(w.d, 'diff', '--cached', '--name-only'), 'other.md');
  const tip = g(w.origin, 'rev-parse', TRANCHE);
  commitPush(R, TRANCHE, ['one.md'], 'nothing');
  assert.equal(g(w.origin, 'rev-parse', TRANCHE), tip, 'a named file unchanged makes no commit, though other work is staged');
});

test('R4: a push to any branch but the role\'s own, as its role record names it, is refused before anything is written', () => {
  const w = world({ plan: false }), R = repo(w.d);
  writeFileSync(join(w.d, '.git', REC.ROLE_FILE), JSON.stringify({ role: 'job', module: 'alpha', session: S('A') }));
  put(w.d, 'one.md', '1\n');
  const head = g(w.d, 'rev-parse', 'HEAD'), remote = g(w.origin, 'rev-parse', TRANCHE);
  assert.throws(() => commitPush(R, TRANCHE, ['one.md'], 'one'), (e) => e instanceof Refused && /a push to tranche is refused: this session's role pushes to job\/alpha only/.test(e.message));
  assert.deepEqual([g(w.d, 'rev-parse', 'HEAD'), g(w.origin, 'rev-parse', TRANCHE)], [head, remote], 'nothing committed, nothing pushed');
  g(w.d, 'checkout', '-q', '-b', 'job/alpha');
  commitPush(R, 'job/alpha', ['one.md'], 'own');
  assert.equal(g(w.origin, 'show', 'job/alpha:one.md'), '1');
  writeFileSync(join(w.d, '.git', REC.ROLE_FILE), JSON.stringify({ role: 'process', branch: 'lane-x', session: S('P') }));
  assert.throws(() => commitPush(R, 'job/alpha', ['one.md'], 'x'), /pushes to lane-x only/);
  assert.equal(REC.ownBranch({ role: 'bob', session: BOB }), TRANCHE);
});

test('R4: before any role record only the tranche is pushed; a record that names no branch, or a checkout on another branch, is refused', () => {
  const w = world({ plan: false }), R = repo(w.d), role = join(w.d, '.git', REC.ROLE_FILE);
  put(w.d, 'one.md', '1\n');
  const head = g(w.d, 'rev-parse', 'HEAD'), remote = () => g(w.origin, 'rev-parse', TRANCHE), before = remote();
  writeFileSync(role, '{}');
  assert.throws(() => commitPush(R, TRANCHE, ['one.md'], 'x'), /no role record names this session's own branch/);
  execFileSync('rm', [role]);
  assert.throws(() => commitPush(R, 'main', ['one.md'], 'x'), /a push to main is refused: no role is recorded yet \(no \.git\/proc-role\.json\): a session pushes to tranche only/, 'before any role: BOB\'s bootstrap, the tranche only');
  writeFileSync(role, JSON.stringify({ role: 'job', session: S('A') }));
  assert.throws(() => commitPush(R, 'job/alpha', ['one.md'], 'x'), /no role record names/, 'a job record without its module');
  writeFileSync(role, JSON.stringify({ role: 'job', module: 'alpha', session: S('A') }));
  assert.throws(() => commitPush(R, 'job/alpha', ['one.md'], 'x'), /the checkout is on tranche; check out job\/alpha first/);
  assert.deepEqual([g(w.d, 'rev-parse', 'HEAD'), remote()], [head, before], 'nothing committed, nothing pushed');
  assert.equal(g(w.d, 'diff', '--cached', '--name-only'), '', 'nothing staged');
});
test('R5: the two path tables are data and no path is in both, or under one of the other', () => {
  const { durable, transient } = paths();
  assert.ok(durable.length && transient.length);
  assert.ok(Object.isFrozen(durable) && Object.isFrozen(transient));
  const under = (a, b) => a === b || (b.endsWith('/') && a.startsWith(b)) || (a.endsWith('/') && b.startsWith(a));
  for (const d of durable) for (const t of transient) assert.ok(!under(d, t), `${d} and ${t}`);
  assert.ok(transient.includes('plan.md') && durable.includes('build/plan/'), 'the transient plan and the durable plan are different paths');
});

// A halted build, modelled on the measured halt of REC-7 (Civicsmith, 30 Oct): one open pull request, three idle merged
// job sessions, one archived unmerged job; an owed act, an open ask, an undelivered message, a stop.
function halted() {
  const w = world(), R = repo(w.d);
  put(w.d, 'build/plan/current.md', '# Plan: a halted build · N1\n\n**Status** · OPEN · the process pinned at `a0f8c6f7845c` (the tip at its open).\n');
  g(w.d, 'add', '.'); g(w.d, 'commit', '-q', '-m', 'plan'); g(w.d, 'push', '-q', 'origin', TRANCHE);
  const job = (name, sess, state, pr, extra = '') => `# x (transient)\n\n**Status** · ${name} · ${sess} · ${state}${pr ? ` · PR #${pr}` : ''}\n**Runs** · 1\n**Owed** · none\n${extra}`;
  stateWrite(R, {
    'plan.md': fmtPlan({ state: 'OPEN', bob: { name: 'BOB #7', session: BOB }, owed: ['archive LEDGER #1'], layers: { 3: 'STARTED' } }),
    'jobs/ledger.md': job('LEDGER #1', S('L'), 'COMPLETE', 41),
    'jobs/auth.md': job('AUTH #1', S('U'), 'MERGED', 38, '**Merges** · abc1234 2026-10-30 0\n'),
    'jobs/feed.md': job('FEED #2', S('F'), 'MERGED', 39),
    'jobs/mail.md': job('MAIL #1', S('M'), 'MERGED', 40),
    'jobs/search.md': job('SEARCH #1', '-', 'WORKING', 42),
    'lanes/UX.md': `# UX (transient)\n\n**Status** · LIVE UX #3 ${S('X')} · WAITING: a colour\n`,
    'asks/A4.md': '# A4\n\n**From** · LEDGER #1 · s · 2026-10-30 · QUESTION #2\nIs it?\n**Status** · RECEIVED\n',
    'asks/A3.md': '# A3\n\n**Status** · CLOSED\n',
    'undelivered/M1.md': 'to session_01X: COMPLETE #1 ledger\n',
  }, 'a halt');
  stop(R, 'a process flaw', { ledger: 'complete-allowed', search: 'abandoned' }, 'a0f8c6f7845c');
  return w;
}

test('R6: status on a fresh clone of a halted build tells everything open, idle, merged, unmerged and owed, with sizes (N2-8)', () => {
  const w = halted();
  const fresh = clone(w.base, w.origin, 'fresh', TRANCHE);   // a fresh session: nothing but the clone
  const s = status({ product: fresh });
  assert.equal(s.epoch, 'E1');
  assert.deepEqual(s.plan.bob, { name: 'BOB #7', session: BOB });
  assert.deepEqual(s.open, ['ledger COMPLETE PR #41', 'search WORKING PR #42']);
  assert.deepEqual(s.idle.sort(), [`auth AUTH #1 ${S('U')}`, `feed FEED #2 ${S('F')}`, `mail MAIL #1 ${S('M')}`]);
  assert.deepEqual(s.merged.sort(), ['auth', 'feed', 'mail']);
  assert.deepEqual(s.unmerged, ['ledger PR #41', 'search PR #42 (no session)']);
  assert.deepEqual(s.owed, ['plan: archive LEDGER #1']);
  assert.deepEqual(s.asks, [{ id: 'A4', status: 'RECEIVED' }]);
  assert.deepEqual(s.undelivered, [{ id: 'M1', text: 'to session_01X: COMPLETE #1 ledger' }]);
  assert.match(s.lanes[0].line, /WAITING: a colour/);
  assert.equal(s.pin, 'a0f8c6f7845c', 'the pin the durable plan names');
  for (const f of s.files.filter((x) => x.path.startsWith('state/'))) assert.ok(f.bytes > 0, f.path);
  assert.ok(s.files.some((f) => f.path === 'state/E1:plan.md'));
  assert.ok(s.files.some((f) => f.path === `${TRANCHE}:build/plan/current.md` && f.bytes > 0));
  const lines = statusLines(s).join('\n');
  for (const want of [/^STOPPED a process flaw · a0f8c6f7845c · ledger complete-allowed; search abandoned: take no new step$/m, /^pin: a0f8c6f7845c$/m, /^unmerged: ledger PR #41; search PR #42 \(no session\)$/m, /^owed: plan: archive LEDGER #1$/m, /^SIZE state\/E1:jobs\/ledger\.md \d+$/m, /^undelivered: M1 /m]) assert.match(lines, want);
});

test('R6: the pin is the one the durable plan\'s Status line names, moved by a RESUMED there and by a resume on the state branch', () => {
  const w = world(), R = repo(w.d);
  assert.equal(status({ product: w.d }).pin, null, 'no plan: no pin, never a guess');
  put(w.d, 'build/plan/current.md', '# Plan: x · N9\n\n**Status** · OPEN · the process pinned at `a0f8c6f` (the tip); STOPPED then; RESUMED at `c9749e2` (the pin moved once).\n');
  g(w.d, 'add', '.'); g(w.d, 'commit', '-q', '-m', 'plan'); g(w.d, 'push', '-q', 'origin', TRANCHE);
  assert.equal(status({ product: w.d }).pin, 'c9749e2');
  assert.match(statusLines(status({ product: w.d })).join('\n'), /^pin: c9749e2$/m);
  stateWrite(R, { 'jobs/a.md': `# a\n\n**Status** · A #1 · ${S('A')} · WORKING · PR #1\n` }, 'a');
  stop(R, 'a flaw', { a: 'complete-allowed' }, 'c9749e2'); resume(R, 'deadbee');
  assert.equal(status({ product: w.d }).pin, 'deadbee');
});

test('R6: before any epoch is open, status answers the state that exists (the durable plan, no jobs, no asks), never a refusal', () => {
  const w = world({ plan: false });
  const s = status({ product: w.d, role: 'root' });
  assert.deepEqual([s.epoch, s.jobs, s.asks, s.lanes, s.owed, s.stop], [null, [], [], [], [], null]);
  assert.match(statusLines(s)[0], /^epoch none open · plan \? · no BOB$/);
});

test('R6: a job\'s reading set is worked out from the record (its START\'s "Read whole, by path:" line) and measured from git', () => {
  const w = world(), R = repo(w.d);
  stateWrite(R, { 'jobs/alpha.md': `# a\n\n**Status** · ALPHA #1 · ${S('A')} · WORKING · PR #1\n`, 'jobs/alpha/start.md': 'START ALPHA #1\nRead whole, by path: src/a.mjs; build/epochs.md (its head); absent.md.\n' }, 'start');
  g(w.d, 'checkout', '-q', '-b', 'job/alpha'); g(w.d, 'push', '-q', 'origin', 'job/alpha');
  put(w.d, 'src/a.mjs', 'x'.repeat(5000));   // the working tree is not what is measured
  const s = status({ product: w.d, role: { role: 'job', module: 'alpha', session: S('A') } });
  assert.deepEqual(s.set, [{ path: 'src/a.mjs', bytes: 20 }, { path: 'build/epochs.md', bytes: Buffer.byteLength(g(w.d, 'show', 'origin/job/alpha:build/epochs.md')) + 1 }, { path: 'absent.md', bytes: null }]);
  // any other role: the set its caller gives (SESSIONS §3, above this layer): a path measured here from git, an entry measured by the caller kept
  assert.deepEqual(status({ product: w.d, role: 'bob', set: [{ path: 'PROCESS-DESIGN.md', bytes: 14203 }, 'src/a.mjs'] }).set, [{ path: 'PROCESS-DESIGN.md', bytes: 14203 }, { path: 'src/a.mjs', bytes: 20 }]);
  assert.deepEqual(status({ product: w.d, role: 'bob' }).set, [], 'no set given: none invented');
});
test('R6: a job\'s owed acts are listed beside the plan\'s', () => {
  const w = world(), R = repo(w.d);
  stateWrite(R, { 'jobs/a.md': `# a\n\n**Status** · A #1 · ${S('A')} · COMPLETE · PR #3\n**Owed** · mark PR #3 ready; post the report\n` }, 'a');
  assert.deepEqual(status({ product: w.d }).owed, ['a: mark PR #3 ready', 'a: post the report']);
});

test('R7: status prints the context share from get_session\'s output and REFRESH past the role\'s threshold', () => {
  const gs = (used, max = 1000000, st = 'SESSION_STATUS_RUNNING') => ({ ccr: { session_status: st, external_metadata: { context_usage: { max_tokens: max, used_tokens: used } } } });
  assert.deepEqual([contextShare(gs(510000), 'job').pct, contextShare(gs(510000), 'job').refresh], [51, true]);
  assert.equal(contextShare(gs(500000), 'job').refresh, false, 'half is not past half');
  assert.equal(contextShare(gs(410000), 'bob').refresh, true);
  assert.equal(contextShare(gs(390000), 'bob').refresh, false);
  assert.equal(contextShare(gs(560000), 'root').refresh, true);
  assert.equal(contextShare(gs(540000), 'root').refresh, false);
  assert.equal(contextShare(gs(510000), 'lane').refresh, true);
  // the process's own architecture session refreshes at 40 %, as BOB does (SES 5, MNT-9; K15)
  assert.match(contextShare(gs(450000), 'process').line, /^context: 45 % of 1000000 \(threshold 40 %\) REFRESH$/);
  assert.equal(contextShare(gs(390000), 'process').refresh, false);
  assert.match(contextShare(JSON.stringify(gs(510000)), 'job').line, /^context: 51 % of 1000000 \(threshold 50 %\) REFRESH$/);
  assert.match(contextShare({}, 'job').line, /unknown/);
  const s = status({ product: world().d, role: 'job', session: gs(600000) });
  assert.match(statusLines(s).join('\n'), /^context: 60 % .* REFRESH$/m);
});

test('R7: no platform status is read as a work state: the session\'s status changes nothing printed', () => {
  const gs = (st) => ({ ccr: { session_status: st, status_bucket: st, external_metadata: { context_usage: { max_tokens: 100, used_tokens: 30 } } } });
  const a = contextShare(gs('SESSION_STATUS_IDLE'), 'job'), b = contextShare(gs('SESSION_STATUS_RUNNING'), 'job'), c = contextShare(gs('SESSION_STATUS_ARCHIVED'), 'job');
  assert.deepEqual(a, b); assert.deepEqual(b, c);
  assert.ok(!/IDLE|RUNNING|ARCHIVED/.test(a.line));
});

test('R7: REFRESH is decided on the exact share, not the rounded one', () => {
  const gs = (used) => ({ ccr: { external_metadata: { context_usage: { max_tokens: 1000000, used_tokens: used } } } });
  const c = contextShare(gs(500400), 'job');
  assert.deepEqual([c.pct, c.refresh], [50, true], '50.04 % is past half, though it prints as 50');
  assert.equal(contextShare(gs(500000), 'job').refresh, false);
});
test('R8: a remote act is written as done only from the call\'s result, with the fields platform.acts() names for the act its owed line names; a request, a refusal or no result leaves it owed', () => {
  const w = world(), R = repo(w.d);
  planEdit(R, (p) => ({ ...p, owed: ['create_session ALPHA #1', 'merge_pull_request PR #4', 'actions_run_trigger prune.yml state/E1', 'start lane UX'] }), 'owe');
  const owed = () => parsePlan(stateRead(R, 'plan.md')).owed;
  // the fields come from the platform's row for the act the owed line names, never from the caller
  assert.deepEqual(PLATFORM.acts({ id: 'create_session' })[0].result, { id: null });
  assert.deepEqual(PLATFORM.acts({ id: 'merge_pull_request' })[0].result, { merged: true });
  for (const bad of [undefined, null, '', { error: 'Permission denied by the classifier' }, '{"isError":true}', 'not json', [], { title: 'ALPHA #1', prompt: 'x' }, { id: '' }]) {
    assert.throws(() => recordAct(R, 'create_session ALPHA #1', bad), /not recorded as done: the call's result shows no id/, JSON.stringify(bad));
  }
  assert.throws(() => recordAct(R, 'merge_pull_request PR #4', { merged: false, sha: 'abc' }), /shows no merged: true/, 'a fixed value must match');
  assert.throws(() => recordAct(R, 'merge_pull_request PR #4', { id: 1 }, 'create_session'), /shows no merged: true/, 'a caller cannot pick another act\'s fields');
  assert.throws(() => recordAct(R, 'start lane UX', { id: 'session_01X' }), /names no platform act by its first word/, 'an owed line naming no act is never recorded from a result');
  assert.throws(() => recordAct(R, 'actions_run_trigger prune.yml state/E1', { anything: 1 }), /carries no fields/, 'an act whose result carries none is never recorded from it');
  assert.throws(() => recordAct(R, 'archive_session OLD #1', { id: 'y' }), /classifier/, 'an act the classifier decides is no act');
  assert.deepEqual(owed(), ['create_session ALPHA #1', 'merge_pull_request PR #4', 'actions_run_trigger prune.yml state/E1', 'start lane UX'], 'all still owed');
  assert.equal(recordAct(R, 'create_session ALPHA #1', JSON.stringify({ id: 'session_01ALPHA' })).recorded, true);
  assert.equal(recordAct(R, 'merge_pull_request PR #4', { merged: true, sha: 'abc' }).recorded, true);
  assert.deepEqual(owed(), ['actions_run_trigger prune.yml state/E1', 'start lane UX']);
  assert.equal(recordAct(R, 'merge_pull_request PR #9', { merged: true }).recorded, false, 'not owed: nothing written');
  // a measurement (a session's usage) names its own count fields
  assert.equal(actDone({ session_id: 'session_01OLD' }, USAGE_FIELDS), false, 'a request\'s own arguments are not its result');
  assert.equal(actDone({ cache_read_tokens: 5, cache_write_tokens: 4, input_tokens: 3, output_tokens: 'many' }, USAGE_FIELDS), false);
  // behaviour, not names: every record function that takes a call's answer refuses a request's own arguments
  for (const [f, call] of [['recordAct', () => recordAct(R, 'actions_run_trigger prune.yml state/E1', { workflow_id: 'prune.yml', ref: 'main' })], ['actDone', () => { if (actDone({ title: 'x', prompt: 'y' }, PLATFORM.acts({ id: 'create_session' })[0].result)) throw new Error('recorded'); throw new Refused('no'); }]]) assert.throws(call, Refused, f);
});
test('R3: the delete route is the platform\'s: through the proxy no direct delete is tried, and the printed dispatch is the platform\'s workflow, act and ref', () => {
  const w = world(), R = repo(w.d), route = PLATFORM.limits().deleteRoute;
  assert.deepEqual(route, { direct: 'refused', workflow: 'prune.yml', act: 'actions_run_trigger', ref: 'main' });
  g(w.d, 'remote', 'set-url', '--push', 'origin', 'https://github.com/own/prod.git');   // a proxied remote (never reached)
  g(w.d, 'remote', 'set-url', 'origin', 'https://github.com/own/prod.git');
  const r = REC.pruneRef(R, 'state/E1');
  assert.deepEqual([r.deleted, r.dispatch.tool, r.dispatch.workflow_id, r.dispatch.ref, r.dispatch.inputs.ref, r.dispatch.owner, r.dispatch.repo], [false, route.act, route.workflow, route.ref, 'state/E1', 'own', 'prod']);
  assert.match(r.why, /the platform refuses a direct delete/);
  assert.match(g(w.origin, 'branch', '--list', 'state/E1'), /state\/E1/, 'nothing deleted, nothing tried');
  const other = REC.pruneRef(R, 'x', { direct: 'refused', workflow: 'other.yml', act: 'actions_run_trigger', ref: 'main' });
  assert.equal(other.dispatch.workflow_id, 'other.yml', 'the route given is the route taken');
  assert.throws(() => REC.pruneRef(R, 'x', {}), /names no delete route/);
});
test('R9: an address is read from the record at the moment of use, never from a side branch or the product\'s own main', () => {
  const w = world(), R = repo(w.d);
  assert.equal(addr(R, 'bob'), BOB);
  planEdit(repo(clone(w.base, w.origin, 'bob2', TRANCHE)), (p) => ({ ...p, bob: { name: 'BOB #2', session: S('C') } }), 'successor');
  assert.equal(addr(R, 'bob'), S('C'), 'the successor\'s address, written elsewhere, is read at once');
  stateWrite(R, { 'jobs/alpha.md': `# a\n\n**Status** · ALPHA #1 · ${S('A')} · WORKING\n`, 'lanes/UX.md': `# UX\n\n**Status** · LIVE UX #2 ${S('X')}\n` }, 'addresses');
  assert.equal(addr(R, { module: 'alpha' }), S('A'));
  assert.equal(addr(R, { lane: 'UX' }), S('X'));
  assert.throws(() => addr(R, { module: 'beta' }), /no live session for beta/);
  // the process's parties: the process repository's main only (issue 123; K4)
  const hand = (sess) => `# Handoff\n\n**From** · neoProcess #9 (\`${sess}\`), the lane's address.\n`;
  put(w.d, 'lane-neoprocess/HANDOFF.md', hand(S('W'))); g(w.d, 'add', '.'); g(w.d, 'commit', '-q', '-m', 'h'); g(w.d, 'push', '-q', 'origin', `${TRANCHE}:main`);
  assert.throws(() => addr(R, 'process'), /the process repository \(opts\.process\)/, 'never the product\'s own main');
  const P = world({ plan: false }), PR = repo(P.d);
  put(P.d, 'lane-neoprocess/HANDOFF.md', hand(S('N'))); g(P.d, 'add', '.'); g(P.d, 'commit', '-q', '-m', 'h'); g(P.d, 'push', '-q', 'origin', `${TRANCHE}:main`);
  put(P.d, 'lane-neoprocess/HANDOFF.md', hand(S('Z'))); g(P.d, 'add', '.'); g(P.d, 'commit', '-q', '-m', 'side'); g(P.d, 'push', '-q', 'origin', 'HEAD:refs/heads/claude/lane-side');
  assert.equal(addr(R, 'process', { process: PR }), S('N'), 'main\'s address, not the side branch\'s, the working tree\'s or the product\'s');
  g(P.d, 'push', '-q', 'origin', 'HEAD:main');
  assert.equal(addr(R, 'process', { process: PR }), S('Z'), 'read again at the moment of use once main has it');
});
test('R10: a stop writes STOPPED <why> · <version> with each unmerged job\'s choice, a resume RESUMED <version>; status shows both', () => {
  const w = world(), R = repo(w.d);
  stateWrite(R, { 'jobs/alpha.md': `# a\n\n**Status** · ALPHA #1 · ${S('A')} · COMPLETE · PR #1\n`, 'jobs/beta.md': `# b\n\n**Status** · BETA #1 · - · WORKING · PR #2\n`, 'jobs/gamma.md': `# c\n\n**Status** · GAMMA #1 · ${S('C')} · MERGED · PR #3\n` }, 'jobs');
  assert.throws(() => stop(R, 'x', { alpha: 'maybe', beta: 'abandoned' }, 'abc1234'), /complete-allowed or abandoned/);
  assert.throws(() => stop(R, 'x', { alpha: 'abandoned', beta: 'abandoned' }, 'not-a-sha'), /process version/);
  assert.throws(() => stop(R, 'x', {}, 'abc1234'), /a choice for each unmerged job: none for alpha, beta/);
  assert.throws(() => stop(R, 'x', { alpha: 'abandoned' }, 'abc1234'), /none for beta/);
  assert.throws(() => stop(R, 'x', { alpha: 'abandoned', beta: 'abandoned', gamma: 'abandoned', delta: 'abandoned' }, 'abc1234'), /only for an unmerged job: gamma \(merged\), delta \(no such job\)/);
  assert.throws(() => resume(R, 'abc1234'), /not stopped/);
  stop(R, 'flaw · in\nthe gate', { alpha: 'complete-allowed', beta: 'abandoned' }, 'abc1234');
  const text = stateRead(R, 'plan.md');
  assert.match(text, new RegExp(`^\\*\\*Status\\*\\* · OPEN · BOB #1 · ${BOB} · STOPPED flaw in the gate · abc1234 · choices alpha complete-allowed, beta abandoned$`, 'm'));
  assert.deepEqual(status({ product: w.d }).stop, { why: 'flaw in the gate', version: 'abc1234', choices: { alpha: 'complete-allowed', beta: 'abandoned' } });
  assert.throws(() => stop(R, 'again', { alpha: 'abandoned', beta: 'abandoned' }, 'abc1234'), /already stopped/);
  resume(R, 'def5678');
  const after = stateRead(R, 'plan.md');
  assert.match(after, new RegExp(`^\\*\\*Status\\*\\* · OPEN · BOB #1 · ${BOB} · RESUMED def5678$`, 'm'));
  assert.ok(!/choices/.test(after), 'a resume clears the choices with the stop');
  const s = status({ product: w.d });
  assert.deepEqual([s.stop, s.resumed, s.pin], [null, 'def5678', 'def5678']);
  assert.match(statusLines(s).join('\n'), /^RESUMED def5678$/m);
  assert.deepEqual(parsePlan(after).bob, { name: 'BOB #1', session: BOB }, 'the BOB in the line is still read');
});
test('R11: metricsRow writes one row per session id to the tranche\'s metrics file; an unmeasured session is named so, never estimated', () => {
  const w = world({ plan: false }), R = repo(w.d), file = join(w.d, 'build/metrics/N2.csv');
  const A = ['session_01A', 'job', 'A #1', 'a', 1, 2, 3, 4, '', '', '', ''];
  assert.throws(() => metricsRow(R, A), /the tranche, or the file/);
  metricsRow(R, A, { tranche: 'N2' });
  assert.equal(readFileSync(file, 'utf8'), `${METRICS_HEAD}session_01A,job,A #1,a,1,2,3,4,,,,\n`);
  metricsRow(R, A, { tranche: 'N2' });
  assert.equal(readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('session_01A,')).length, 1, 'one row per session id');
  assert.throws(() => metricsRow(R, ['session_01C', 'job', 'C #1', 'c', '', '', '', '', '', '', '', ''], { tranche: 'N2' }), /a row without counts is named unmeasured, with the reason/);
  const u = unmeasuredRow('session_01B', 'job', 'B #1', 'b', 'archive refused, by the classifier\nagain');
  assert.deepEqual(u.slice(4, 11), ['', '', '', '', '', '', ''], 'no count is estimated');
  assert.equal(u[11], 'unmeasured: archive refused  by the classifier again');
  metricsRow(R, u, { tranche: 'N2' });
  metricsRow(R, ['session_01B', 'job', 'B #1', 'b', 5, 6, 7, 8, '', '', '', ''], { tranche: 'N2' });   // measured later: replaces its unmeasured row
  assert.deepEqual(readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1), ['session_01A,job,A #1,a,1,2,3,4,,,,', 'session_01B,job,B #1,b,5,6,7,8,,,,']);
  metricsRow(R, unmeasuredRow('session_01B', 'job', 'B #1', 'b', 'read again, refused'), { tranche: 'N2' });   // never the other way
  metricsRow(R, unmeasuredRow('session_01A', 'job', 'A #1', 'a', 'refused'), { tranche: 'N2' });
  assert.deepEqual(readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1), ['session_01A,job,A #1,a,1,2,3,4,,,,', 'session_01B,job,B #1,b,5,6,7,8,,,,'], 'an unmeasured row never overwrites a measured one');
  assert.equal(metricsText(null, A), `${METRICS_HEAD}session_01A,job,A #1,a,1,2,3,4,,,,\n`);
  assert.equal(REC.metricsFile('N2'), 'build/metrics/N2.csv');
});
test('R12: paths() is disjoint from every module\'s paths and tests in this product\'s build/modules.json', () => {
  const mods = JSON.parse(readFileSync(join(HERE, 'build/modules.json'), 'utf8'));
  const own = mods.modules.flatMap((m) => [...(m.paths || []), ...(m.tests || [])]);
  assert.ok(own.length > 10);
  const hit = (a, b) => a === b || (b.endsWith('/') && a.startsWith(b)) || (a.endsWith('/') && b.startsWith(a));
  const { durable, transient } = paths();
  for (const p of [...durable, ...transient]) for (const o of own) assert.ok(!hit(p, o), `${p} is ${o}`);
  assert.ok(mods.not_product.includes('build/'), 'the build state is not product');
});
test('R13: status prints the role\'s reading set with sizes, and every state file it read with its size', () => {
  const w = world(), R = repo(w.d);
  put(w.d, 'build/requirements/a.md', 'x'.repeat(321)); g(w.d, 'add', '.'); g(w.d, 'commit', '-q', '-m', 'req'); g(w.d, 'push', '-q', 'origin', TRANCHE);
  const s = status({ product: w.d, set: ['build/requirements/a.md', 'absent.md'] });
  assert.deepEqual(s.set, [{ path: 'build/requirements/a.md', bytes: 321 }, { path: 'absent.md', bytes: null }]);
  const lines = statusLines(s);
  assert.ok(lines.includes('READ build/requirements/a.md 321'));
  assert.ok(lines.includes('READ absent.md absent'));
  assert.ok(lines.some((l) => /^SIZE state\/E1:plan\.md \d+$/.test(l)));
  assert.deepEqual(readingSizes(R, ['build/requirements/a.md'], `origin/${TRANCHE}`), [{ path: 'build/requirements/a.md', bytes: 321 }]);
});

test('R6: status prints the durable plan\'s Status line', () => {
  const w = world();
  put(w.d, 'build/plan/current.md', '# Plan: x · N9\n\n**Status** · OPEN · round 2 of 3; the process pinned at `a0f8c6f`.\n');
  g(w.d, 'add', '.'); g(w.d, 'commit', '-q', '-m', 'plan'); g(w.d, 'push', '-q', 'origin', TRANCHE);
  assert.ok(statusLines(status({ product: w.d })).includes('plan status: OPEN · round 2 of 3; the process pinned at `a0f8c6f`.'));
});

test('R2: a write that keeps losing its race is refused after a bounded number of tries, never forced', () => {
  const w = world(), R = repo(w.d), e = epoch(R), before = g(w.origin, 'rev-parse', `state/${e}`);
  const hook = join(w.d, '.git/hooks/pre-push');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n'); chmodSync(hook, 0o755);
  assert.throws(() => stateWrite(R, { 'jobs/x.md': 'X\n' }, 'x'), (err) => err instanceof Refused && /could not be pushed after 4 tries/.test(err.message));
  assert.equal(g(w.origin, 'rev-parse', `state/${e}`), before, 'the branch as it was');
});

test('R11: an unmeasured row carries no counts, and no field may break the row', () => {
  assert.throws(() => metricsText(null, ['session_01A', 'job', 'A #1', 'a', 9, 9, 9, 9, '', '', '', 'unmeasured: guessed']), /an unmeasured row carries no counts/);
  assert.throws(() => metricsText(null, ['session_01A', 'job', 'A, #1', 'a', 1, 2, 3, 4, '', '', '', '']), /field 3 holds a comma or a line break/);
  assert.throws(() => metricsText(null, ['session_01A', 'job', 'A #1', 'a', 1, 2, 3, 4, '', '', '', 'two\nlines']), /field 12/);
});

test('R4, R3: epochOpen and epochClose make no remote change for a role that may not push the tranche, or from a checkout behind it', () => {
  const w = world({ plan: false }), R = repo(w.d), role = join(w.d, '.git', REC.ROLE_FILE);
  writeFileSync(role, JSON.stringify({ role: 'job', module: 'alpha', session: S('A') }));
  assert.throws(() => epochOpen({ product: w.d }), /a push to tranche is refused: this session's role pushes to job\/alpha only/);
  assert.equal(g(w.origin, 'branch', '--list', 'state/*'), '', 'no state branch pushed');
  writeFileSync(role, JSON.stringify({ role: 'bob', session: BOB }));
  epochOpen({ product: w.d });
  writeFileSync(role, JSON.stringify({ role: 'job', module: 'alpha', session: S('A') }));
  assert.throws(() => epochClose({ product: w.d }), /pushes to job\/alpha only/);
  assert.match(g(w.origin, 'branch', '--list', 'state/E1'), /state\/E1/, 'not deleted');
  assert.doesNotMatch(g(w.origin, 'show', 'state/E1:epoch.md'), /^closed /m, 'not marked closed');
  // a checkout behind the tranche: refused before anything is pushed, never left mid-merge
  writeFileSync(role, JSON.stringify({ role: 'bob', session: BOB }));
  const other = clone(w.base, w.origin, 'other', TRANCHE);
  writeFileSync(join(other, '.git', REC.ROLE_FILE), JSON.stringify({ role: 'bob', session: BOB }));
  epochClose({ product: other });                     // E1 closed from the other clone
  assert.throws(() => epochOpen({ product: w.d }), /is not tranche's remote tip/);
  assert.equal(g(w.origin, 'branch', '--list', 'state/*'), '', 'no used label re-opened');
  assert.equal(g(w.d, 'status', '--porcelain', '--untracked-files=no'), '', 'no merge left half-done');
  g(w.d, 'pull', '-q', 'origin', TRANCHE);
  assert.equal(epochOpen({ product: w.d }).epoch, 'E2', 'once current: the next label');
});

test('R8, R10: a plan whose Status line is not in BOB\'s form is refused, never a crash', () => {
  const w = world(), R = repo(w.d);
  stateWrite(R, { 'plan.md': '**Status** · OPEN\n**Owed** · merge_pull_request X #1\n' }, 'malformed');
  assert.throws(() => recordAct(R, 'merge_pull_request X #1', { merged: true }), (e) => e instanceof Refused && /no Status line in BOB's form/.test(e.message));
  assert.throws(() => planEdit(R, (p) => p, 'x'), Refused);
  planEdit(R, (p) => ({ ...p, state: 'OPEN', bob: { name: 'BOB #3', session: BOB } }), 'takeover');   // the edit that writes BOB's line passes
  assert.deepEqual(parsePlan(stateRead(R, 'plan.md')).bob, { name: 'BOB #3', session: BOB });
});

test('R4: an unreadable role record names no known role: refused, never a crash; status still answers', () => {
  const w = world(), R = repo(w.d);
  writeFileSync(join(w.d, '.git', REC.ROLE_FILE), '{');
  assert.throws(() => commitPush(R, TRANCHE, ['build/epochs.md'], 'x'), (e) => e instanceof Refused && /no role record names this session's own branch/.test(e.message));
  writeFileSync(join(w.d, '.git', REC.ROLE_FILE), '[1]');
  assert.throws(() => commitPush(R, TRANCHE, ['build/epochs.md'], 'x'), Refused);
  assert.equal(status({ product: w.d }).epoch, 'E1');
});

test('R11: a row is measured only with all four counts whole numbers; an estimate, a fraction or a missing count is refused (K15)', () => {
  const row = (c) => ['session_01A', 'job', 'A #1', 'a', ...c, '', '', '', ''];
  for (const bad of [['~5000', '', '', ''], ['~5000', 1, 2, 3], [1.5, 2, 3, 4], [-1, 2, 3, 4], ['1e3', 2, 3, 4], [1, 2, 3, ''], ['5k', 2, 3, 4], [Infinity, 2, 3, 4], [' 5', 2, 3, 4]]) {
    assert.throws(() => metricsText(null, row(bad)), (e) => e instanceof Refused && /all four counts as whole numbers/.test(e.message), JSON.stringify(bad));
  }
  assert.equal(metricsText(null, row(['5000', 0, '12', 7])), `${METRICS_HEAD}session_01A,job,A #1,a,5000,0,12,7,,,,\n`, 'whole numbers, as numbers or digits');
});

test('R11: a metrics row is keyed by a session id and has the head\'s twelve fields', () => {
  assert.throws(() => metricsText(null, ['', 'job', 'A #1', 'a', 1, 2, 3, 4, '', '', '', '']), /keyed by a session id/);
  assert.throws(() => metricsText(null, ['session_01A', 'job', 'A #1', 'a', 1]), /has 12 fields, not 5/);
});

