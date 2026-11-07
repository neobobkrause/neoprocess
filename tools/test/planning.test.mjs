// The planning module's tests (build/requirements/planning.md R1-R10), at its interface, against real remotes: each product
// fixture is a bare origin seeded on `main` and one clone as BOB, driven from this one process checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as P from '../planning.mjs';
import { repo, TRANCHE, epochOpen, stateWrite, stateRead, fmtPlan, parsePlan, planEdit, recordLocal, ROLE_FILE, status, pinOf, metricsRow, commitPush } from '../record.mjs';

const B1 = 'session_01BBBBBBBBBBBBBBBBBBBBBBBB', J1 = 'session_01JJJJJJJJJJJJJJJJJJJJJJJJ';
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ident = (d, n) => { for (const [k, v] of [['user.name', n], ['user.email', `${n}@t`], ['commit.gpgsign', 'false']]) g(d, 'config', k, v); };
const put = (dir, p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); };
const reqFile = (m, ids) => `# ${m} — requirements\n\n## Public\n\n### Purpose\n\n${m}.\n\n### Provides\n\n**${m}(x) → y**\n${ids.map((id, i) => `- **R${i + 1}** does ${m}. (${id})`).join('\n')}\n\n## Private\n\n### Uses\n\n### Invariants\n\n### Satisfies\n\n- REQUIREMENTS.md §1.\n`;
// A plan: its title names T, its Status line the pin, its legacy census before its first layer, each entry in a module group.
const planText = (T, layers, { pin = 'abc1234', census = true, title = `# Plan: test · ${T}` } = {}) => `${title}\n\n**Status** · OPEN · the process pinned at \`${pin}\`.\n\n${census ? '**The legacy census** · none.\n\n' : ''}${layers.map(([L, mods]) => `## Layer ${L}\n\n${mods.map(([m, id, cite]) => `**${m}**\n- ${id} · ${cite}: make ${m}.\n`).join('\n')}`).join('\n')}`;
// A product: modules by layer, each with a requirements file citing its canon ids; next.md on main.
function product(base, name, mods, next) {
  const origin = join(base, `${name}.git`), seed = join(base, `${name}-seed`);
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['clone', '-q', origin, seed], { stdio: 'ignore' }); ident(seed, 'seed');
  put(seed, 'build/modules.json', JSON.stringify({ modules: mods.map(([id, layer]) => ({ id, layer, paths: [`src/${id}.mjs`], tests: [], uses: [] })) }, null, 2));
  for (const [id, , cites] of mods) { put(seed, `build/requirements/${id}.md`, reqFile(id, cites)); put(seed, `src/${id}.mjs`, `export const ${id} = 1;\n`); }
  put(seed, 'build/plan/next.md', next);
  g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'seed'); g(seed, 'branch', '-M', 'main'); g(seed, 'push', '-q', 'origin', 'main');
  const dir = join(base, `${name}-bob`);
  execFileSync('git', ['clone', '-q', '-b', 'main', origin, dir], { stdio: 'ignore' }); ident(dir, 'bob');
  return { origin, seed, dir, R: repo(dir), o: (x = {}) => ({ product: dir, ...x }), g: (...a) => g(dir, ...a) };
}
const OK = { grants: () => null, words: () => [] };
const CLOSE = { asks: () => [], regenerate: () => ({ changed: [], stale: [] }), checks: () => ({ fails: new Set() }) };
// BOB's record, as takeover leaves it: the role on the checkout and the plan's Status line (record's own format)
function asBob(p, layers = {}) {
  recordLocal(p.dir, ROLE_FILE, { role: 'bob', product: '.', session: B1, name: 'BOB #1' });
  stateWrite(p.R, { 'plan.md': fmtPlan({ state: 'OPEN', bob: { name: 'BOB #1', session: B1 }, owed: [], layers, retiring: [] }) }, 'takeover');
}
const jobLine = (p, m, state, pr = 3) => stateWrite(p.R, { [`jobs/${m}.md`]: `# ${m} (transient)\n\n**Status** · ${m.toUpperCase()} #1 · ${state === 'ARCHIVED' ? '-' : J1} · ${state} · PR #${pr}\n` }, `${m}: ${state}`);
// A job's pull request merged into the tranche as GitHub merges it ("Merge pull request #n from <owner>/job/<m>").
function mergeJob(p, m, n, file = `src/${m}.mjs`) {
  p.g('checkout', '-q', '-b', `job/${m}`); put(p.dir, file, `export const ${m} = ${n};\n`); p.g('add', '.'); p.g('commit', '-q', '-m', `${m}: its work`);
  p.g('checkout', '-q', TRANCHE); p.g('merge', '-q', '--no-ff', '-m', `Merge pull request #${n} from o/job/${m}`, `job/${m}`); p.g('push', '-q', 'origin', `HEAD:${TRANCHE}`);
}
const TWO = [['alpha', 1, ['XYZ-1']], ['beta', 2, ['XYZ-2']]];
const TWO_PLAN = planText('T1', [[1, [['alpha', 'T1-1', 'XYZ-1']]], [2, [['beta', 'T1-2', 'XYZ-2']]]]);

test('R1 trancheOpen opens on tranche fast-forwarded to main, the plan copied whole from next.md with its census first and its pin; refused while a plan on main reads CLOSING, the words check has a finding, or the grant check is missing, failed or stale', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const p = product(base, 'a', TWO, TWO_PLAN);
  assert.throws(() => P.trancheOpen(p.o()), /grant check is not given/);
  assert.throws(() => P.trancheOpen(p.o(), { grants: () => null }), /words check is not given/);
  assert.throws(() => P.trancheOpen(p.o(), { ...OK, grants: () => 'the grants were proven at 2026-10-01, over 24 hours ago' }), /over 24 hours ago/);
  assert.throws(() => P.trancheOpen(p.o(), { ...OK, words: () => ['FAIL words: an inline sentence'] }), /words check reports 1 finding/);
  // the plan's own shape, on main: its pin, its census before its first layer, its entries in module groups
  const onMain = (text) => { put(p.seed, 'build/plan/next.md', text); g(p.seed, 'add', '-A'); g(p.seed, 'commit', '-q', '-m', 'next'); g(p.seed, 'push', '-q', 'origin', 'main'); };
  onMain(TWO_PLAN.replace(/pinned at `abc1234`/, 'pinned'));
  assert.throws(() => P.trancheOpen(p.o(), OK), /names the pinned process commit/);
  onMain(planText('T1', [[1, [['alpha', 'T1-1', 'XYZ-1']]]], { census: false }) + '\n**The legacy census** · late.\n');
  assert.throws(() => P.trancheOpen(p.o(), OK), /legacy census .* comes before its first layer/);
  onMain(TWO_PLAN.replace('**alpha**\n', ''));
  assert.throws(() => P.trancheOpen(p.o(), OK), /entry T1-1 is under no module group/);
  onMain(TWO_PLAN.replace('XYZ-1:', 'XYZ-9:'));
  assert.throws(() => P.trancheOpen(p.o(), OK), /T1-1: cites XYZ-9, which build\/requirements\/alpha\.md does not/);
  // an archived plan on main still CLOSING
  put(p.seed, 'build/plan/archive/T0-R1.md', '# Plan: old · T0\n\n**Status** · CLOSING\n'); onMain(TWO_PLAN);
  assert.throws(() => P.trancheOpen(p.o(), OK), /still reads CLOSING on main: build\/plan\/archive\/T0-R1\.md/);
  g(p.seed, 'rm', '-q', 'build/plan/archive/T0-R1.md'); g(p.seed, 'commit', '-q', '-m', 'closed'); g(p.seed, 'push', '-q', 'origin', 'main');
  const to = P.trancheOpen(p.o(), OK);
  assert.deepEqual([to.tranche, to.round, to.layers, to.pin, p.R.branch()], ['T1', 1, [1, 2], 'abc1234', TRANCHE]);
  assert.equal(readFileSync(join(p.dir, P.PLAN), 'utf8'), `${TWO_PLAN.trimEnd()}\n`);   // whole
  assert.equal(existsSync(join(p.dir, P.NEXT)), false);
  assert.equal(p.g('rev-parse', `origin/${TRANCHE}~1`), p.g('rev-parse', 'origin/main'));   // main's tip, plus the plan's move
  assert.equal(p.g('rev-parse', `origin/${TRANCHE}`), p.g('rev-parse', 'HEAD'));
  assert.throws(() => P.trancheOpen(p.o(), OK), /holds work not on main/);
});

test('R2 trancheClose only when every round is archived and every job merged: main merged in (never a rebase), the archive with each entry\'s outcome and the usage, CLOSING, the one close PR; trancheMerged records it', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const p = product(base, 'a', TWO, TWO_PLAN);
  P.trancheOpen(p.o(), OK); epochOpen(p.o()); asBob(p);
  assert.throws(() => P.trancheClose(p.o()), /the asks check is not given/);
  assert.throws(() => P.trancheClose(p.o(), CLOSE), /a round is open/);
  mergeJob(p, 'alpha', 3);
  jobLine(p, 'alpha', 'ARCHIVED', 3);
  planEdit(p.R, (q) => ({ ...q, layers: { 1: 'CLOSED', 2: 'CLOSED' } }), 'layers run');
  P.roundClose(p.o());
  assert.throws(() => P.trancheClose(p.o(), { ...CLOSE, asks: () => ['A1'] }), /asks still open: A1/);
  assert.throws(() => P.trancheClose(p.o(), CLOSE), /entries whose module's job is not merged: beta \(T1-2\)/);
  mergeJob(p, 'beta', 4);
  jobLine(p, 'beta', 'ARCHIVED', 4);
  metricsRow(p.R, [J1, 'job', 'ALPHA #1', 'alpha', 100, 20, 3, 7, 1, 2, '', ''], { tranche: 'T1' });
  metricsRow(p.R, [B1, 'BOB', 'BOB #1', '', 50, 10, 0, 0, '', '', '', ''], { tranche: 'T1' });
  commitPush(p.R, TRANCHE, ['build/metrics/T1.csv'], 'metrics');
  // main moved meanwhile (Bob's design stream): merged in at the close, never a rebase
  put(p.seed, 'docs/ux.md', 'a design\n'); g(p.seed, 'add', '.'); g(p.seed, 'commit', '-q', '-m', 'ux'); g(p.seed, 'push', '-q', 'origin', 'main');
  assert.throws(() => P.trancheClose(p.o(), { ...CLOSE, checks: (R) => ({ fails: new Set(R.read('src/beta.mjs').includes('4') ? ['check: beta'] : []) }) }), /checks: 1 finding\(s\) new since the tranche opened: check: beta/);   // a finding the base had is not new
  p.g('reset', '-q', '--hard', `origin/${TRANCHE}`);
  const tc = P.trancheClose(p.o(), CLOSE);
  p.g('fetch', '-q', 'origin');
  assert.doesNotThrow(() => p.g('merge-base', '--is-ancestor', 'origin/main', `origin/${TRANCHE}`));
  assert.ok(p.g('log', '--format=%s', `origin/${TRANCHE}`).includes('Merge pull request #3 from o/job/alpha'));   // its history kept
  assert.deepEqual([tc.tranche, tc.report, tc.pr.head, tc.pr.base, tc.pr.title, tc.pr.draft], ['T1', 'build/plan/archive/T1-report.md', TRANCHE, 'main', 'T1: close', false]);
  const rep = readFileSync(join(p.dir, tc.report), 'utf8');
  assert.match(rep, /^\| T1-1 \| 1 \| alpha \| applied \|$/m); assert.match(rep, /^\| T1-2 \| 2 \| beta \| applied \|$/m);
  assert.match(rep, /^\*\*Cost\*\* · 190 tokens \(job 130, BOB 60\)$/m);
  const st = parsePlan(stateRead(p.R, 'plan.md'));
  assert.deepEqual([st.state, st.owed], ['CLOSING', [`merge ${TRANCHE}`]]);
  assert.deepEqual([tc.merge.tool, tc.merge.merge_method, tc.merge.expectedHeadSha], ['merge_pull_request', 'merge', p.g('rev-parse', `origin/${TRANCHE}`)]);
  assert.throws(() => P.trancheMerged(p.o({ sha: p.g('rev-parse', 'origin/main') })), /is not in/);
  g(p.seed, 'pull', '-q', 'origin', 'main'); g(p.seed, 'fetch', '-q', 'origin', TRANCHE); g(p.seed, 'merge', '-q', '--no-ff', '-m', 'T1: close (#9)', 'FETCH_HEAD'); g(p.seed, 'push', '-q', 'origin', 'main');
  p.g('fetch', '-q', 'origin');
  assert.equal(P.trancheMerged(p.o({ sha: p.g('rev-parse', 'origin/main') })).merged, p.g('rev-parse', '--short', 'origin/main'));
  assert.deepEqual([parsePlan(stateRead(p.R, 'plan.md')).state, parsePlan(stateRead(p.R, 'plan.md')).owed], ['CLOSED', []]);
});

test('R3 roundOpen copies a round\'s entries whole, grouped by module under their layers, refused while a round runs; the completion round has its own file, distinct from next.md, opened after the last layer', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const p = product(base, 'a', TWO, TWO_PLAN);
  P.trancheOpen(p.o(), OK); epochOpen(p.o()); asBob(p);
  put(p.dir, 'build/plan/r2.md', planText('T1', [[1, [['alpha', 'T1-3', 'XYZ-1']]]]));
  assert.throws(() => P.roundOpen(p.o({ planFile: 'build/plan/r2.md' })), /a round is running: layer\(s\) 1, 2/);
  planEdit(p.R, (q) => ({ ...q, layers: { 1: 'CLOSED', 2: 'CLOSED' } }), 'layers run');
  // the completion round's file wins over a next.md that is the next tranche's list, which stays
  put(p.dir, P.NEXT, planText('T2', [[1, [['alpha', 'T2-1', 'XYZ-1']]]]));
  put(p.dir, P.completionFile('T1'), planText('T1', [[2, [['beta', 'T1-9', 'XYZ-2']]]], { title: '# Plan: the completion round · T1' }));
  commitPush(p.R, TRANCHE, [P.NEXT, P.completionFile('T1')], 'the completion round; the next tranche');
  const rc = P.roundClose(p.o());
  assert.deepEqual([rc.round, rc.archived, rc.next, rc.completion], [1, 'build/plan/archive/T1-R1.md', 'build/plan/T1-completion.md', true]);
  assert.match(readFileSync(join(p.dir, P.PLAN), 'utf8'), /^\*\*beta\*\*\n- T1-9 · XYZ-2: make beta\.$/m);
  assert.equal(existsSync(join(p.dir, P.completionFile('T1'))), false); assert.equal(existsSync(join(p.dir, P.NEXT)), true);
  assert.deepEqual(parsePlan(stateRead(p.R, 'plan.md')).layers, {});
  // the last round closed: no plan runs; a round opens from a file in the product, its entries checked; another tranche's refused
  planEdit(p.R, (q) => ({ ...q, layers: { 2: 'CLOSED' } }), 'layer 2 run');
  assert.equal(P.roundClose(p.o()).next, null);
  assert.throws(() => P.roundOpen(p.o({ planFile: P.NEXT })), /the current plan is T1's; a plan for T2 opens with a new tranche/);
  put(p.dir, 'build/plan/r3.md', '# Plan: test · T1\n\n## Layer 1\n\n- T1-4 · XYZ-1: loose.\n'); commitPush(p.R, TRANCHE, ['build/plan/r3.md'], 'r3');
  assert.throws(() => P.roundOpen(p.o({ planFile: 'build/plan/r3.md' })), /entry T1-4 is under no module group/);
  put(p.dir, 'build/plan/r3.md', planText('T1', [[1, [['beta', 'T1-4', 'XYZ-2']]]])); commitPush(p.R, TRANCHE, ['build/plan/r3.md'], 'r3');
  assert.throws(() => P.roundOpen(p.o({ planFile: 'build/plan/r3.md' })), /T1-4: beta is in layer 2, not 1/);
  put(p.dir, 'build/plan/r3.md', planText('T1', [[1, [['alpha', 'T1-4', 'XYZ-1']]]])); commitPush(p.R, TRANCHE, ['build/plan/r3.md'], 'r3');
  const ro = P.roundOpen(p.o({ planFile: 'build/plan/r3.md' }));
  assert.deepEqual([ro.tranche, ro.round, ro.layers], ['T1', 3, [1]]);
  assert.equal(readFileSync(join(p.dir, P.PLAN), 'utf8'), readFileSync(join(p.dir, 'build/plan/r3.md'), 'utf8'));
  // a round's plan over the limit is two rounds (SESSIONS §6.3)
  assert.deepEqual(P.planFindings(null, planText('T1', [[1, [['alpha', 'T1-6', `XYZ-1 ${'x'.repeat(P.PLAN_LIMIT)}`]]]])).filter((x) => /limit/.test(x)).length, 1);
});

test('R3 the completion round opens by --completion after the last round, needing no approval', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const p = product(base, 'a', TWO, TWO_PLAN);
  P.trancheOpen(p.o(), OK); epochOpen(p.o()); asBob(p, { 1: 'CLOSED', 2: 'CLOSED' });
  assert.equal(P.roundClose(p.o()).next, null);
  put(p.dir, P.completionFile('T1'), planText('T1', [[1, [['alpha', 'T1-5', 'XYZ-1']]]], { title: '# Plan: the completion round · T1' }));
  commitPush(p.R, TRANCHE, [P.completionFile('T1')], 'the completion round');
  const ro = P.roundOpen(p.o({ completion: true }));
  assert.deepEqual([ro.round, ro.from], [2, P.completionFile('T1')]);
  assert.equal(existsSync(join(p.dir, P.completionFile('T1'))), false);
  assert.match(p.g('log', '-1', '--format=%s'), /round R2 opens \(the completion round\)/);
});

test('R4 partial records a layer started in part, its modules and the architecture session\'s reason, in the plan; the rest start once it has merged', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const mods = [['alpha', 1, ['XYZ-1']], ['beta', 1, ['XYZ-2']], ['gamma', 1, ['XYZ-3']]];
  const p = product(base, 'a', mods, planText('T1', [[1, [['alpha', 'T1-1', 'XYZ-1'], ['beta', 'T1-2', 'XYZ-2'], ['gamma', 'T1-3', 'XYZ-3']]]]));
  P.trancheOpen(p.o(), OK);
  assert.throws(() => P.partial(p.R, 1, ['alpha'], ''), /names the architecture session's reason/);
  assert.throws(() => P.partial(p.R, 1, ['delta'], 'r'), /delta: no entries in layer 1/);
  assert.throws(() => P.partial(p.R, 4, ['alpha'], 'r'), /layer 4 has no section/);
  const r = P.partial(p.R, 1, ['alpha', 'beta'], 'the version is new to the project · a flaw is suspected');
  assert.deepEqual([r.layer, r.modules, r.rest], [1, ['alpha', 'beta'], ['gamma']]);
  const text = readFileSync(join(p.dir, P.PLAN), 'utf8');
  assert.deepEqual(P.partsOf(text, 1).map((x) => [x.modules, x.reason]), [[['alpha', 'beta'], 'the version is new to the project; a flaw is suspected']]);
  assert.equal(p.g('rev-parse', `origin/${TRANCHE}`), p.g('rev-parse', 'HEAD'));   // on the record
  assert.deepEqual(P.partsOf(text, 2), []);
});

test('R5 stop records once, by the architecture session, at the pin, each unmerged job complete-allowed or abandoned; every role\'s status shows it; resume clears it and moves the pin once', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const p = product(base, 'a', TWO, TWO_PLAN);
  P.trancheOpen(p.o(), OK); epochOpen(p.o());
  recordLocal(p.dir, ROLE_FILE, { role: 'job', module: 'alpha', product: '.', session: J1 });
  assert.throws(() => P.stop(p.o({ why: 'x' })), /architecture session's \(BOB's\) act/);
  asBob(p, { 1: 'STARTED' });
  jobLine(p, 'alpha', 'WORKING', 3);
  assert.throws(() => P.stop(p.o({ why: 'a process flaw', choices: '' })), /a choice for each unmerged job: none for alpha/);
  assert.throws(() => P.stop(p.o({ why: 'a process flaw', choices: 'alpha kept' })), /complete-allowed or abandoned, not kept/);
  assert.throws(() => P.resume(p.o({ version: 'def5678' })), /not stopped/);
  const s = P.stop(p.o({ why: 'the gate refuses every extraction', choices: 'alpha complete-allowed' }));
  assert.deepEqual([s.version, s.choices], ['abc1234', { alpha: 'complete-allowed' }]);
  assert.throws(() => P.stop(p.o({ why: 'again', choices: 'alpha abandoned' })), /already stopped/);
  for (const role of ['job', 'bob', 'lane', 'root']) {
    const st = status({ product: p.dir, role });
    assert.deepEqual([st.stop.why, st.stop.version, st.stop.choices], ['the gate refuses every extraction', 'abc1234', { alpha: 'complete-allowed' }]);
  }
  assert.match(readFileSync(join(p.dir, P.PLAN), 'utf8'), /^\*\*Status\*\* · .* STOPPED \S+ by the architecture session: the gate refuses every extraction at `abc1234` \(alpha complete-allowed\)\.$/m);
  assert.throws(() => P.resume(p.o({ version: 'main' })), /--version/);
  const r = P.resume(p.o({ version: 'def5678' }));
  assert.equal(r.resumed, 'def5678');
  const st = status({ product: p.dir, role: 'job' });
  assert.deepEqual([st.stop, st.resumed, st.pin], [null, 'def5678', 'def5678']);
  // the durable plan carries the move, so the pin outlives the epoch; nothing else moves it
  assert.equal(pinOf(readFileSync(join(p.dir, P.PLAN), 'utf8').match(/^\*\*Status\*\* · .*$/m)[0], null), 'def5678');
  assert.throws(() => P.resume(p.o({ version: '0123abc' })), /not stopped/);
});

test('R6 place puts work found while a round runs at once: the running job as a CHANGE, else the START of a layer not started, else the completion round; deferred only for P19\'s three reasons, named', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const mods = [['alpha', 1, ['XYZ-1']], ['beta', 1, ['XYZ-2']], ['gamma', 2, ['XYZ-3']]];
  const p = product(base, 'a', mods, planText('T1', [[1, [['alpha', 'T1-1', 'XYZ-1'], ['beta', 'T1-2', 'XYZ-2']]]]));
  P.trancheOpen(p.o(), OK); epochOpen(p.o()); asBob(p, { 1: 'STARTED' });
  jobLine(p, 'alpha', 'WORKING', 3); jobLine(p, 'beta', 'ARCHIVED', 4);
  assert.throws(() => P.place(p.o({ module: 'alpha', entry: 'make it better' })), /one plan entry/);
  // the running job
  const a = P.place(p.o({ module: 'alpha', entry: '- T1-10 · XYZ-1: a gap found.' }));
  assert.deepEqual([a.where, a.send.session_id], ['running job', J1]);
  assert.match(a.send.message, /^CHANGE: an entry placed in your job \(P10\):\n- T1-10 · XYZ-1: a gap found\.$/);
  assert.match(stateRead(p.R, 'jobs/alpha/start.md'), /- T1-10 · XYZ-1: a gap found\./);
  // a layer not started: its START, the plan's entries (the layer's section made in order)
  const c = P.place(p.o({ module: 'gamma', entry: '- T1-11 · XYZ-3: found early.' }));
  assert.deepEqual([c.where, c.layer], ['start', 2]);
  const plan = readFileSync(join(p.dir, P.PLAN), 'utf8');
  assert.deepEqual(P.entries(plan).map((e) => [e.id, e.layer, e.module]), [['T1-1', 1, 'alpha'], ['T1-2', 1, 'beta'], ['T1-11', 2, 'gamma']]);
  assert.throws(() => P.place(p.o({ module: 'gamma', entry: '- T1-12 · XYZ-7: cites another module\'s id.' })), /T1-12: cites XYZ-7/);
  // a started layer whose job is not running: the completion round
  const b = P.place(p.o({ module: 'beta', entry: '- T1-13 · XYZ-2: found late.' }));
  assert.deepEqual([b.where, b.file], ['completion round', 'build/plan/T1-completion.md']);
  assert.deepEqual(P.entries(readFileSync(join(p.dir, b.file), 'utf8')).map((e) => [e.id, e.module]), [['T1-13', 'beta']]);
  assert.equal(P.place(p.o({ module: 'beta', entry: '- T1-14 · XYZ-2: also late.' })).file, b.file);
  assert.deepEqual(P.entries(readFileSync(join(p.dir, b.file), 'utf8')).map((e) => e.id), ['T1-13', 'T1-14']);
  // deferred: only for P19's three reasons, named beside it, to the next tranche's list
  assert.throws(() => P.place(p.o({ module: 'beta', entry: '- T1-15 · XYZ-2: big.', defer: 'size' })), /only for bob, deployment, measurement, outside/);
  const d = P.place(p.o({ module: 'beta', entry: '- T1-15 · XYZ-2: needs a deployed copy.', defer: 'measurement' }));
  assert.deepEqual([d.where, d.file, d.reason], ['next tranche', P.NEXT, 'a measurement that cannot happen inside the tranche']);
  assert.deepEqual(P.entries(readFileSync(join(p.dir, P.NEXT), 'utf8')).map((e) => [e.id, e.deferred]), [['T1-15', 'a measurement that cannot happen inside the tranche']]);
  assert.match(readFileSync(join(p.dir, P.NEXT), 'utf8'), /^- T1-15 · XYZ-2: needs a deployed copy\. · hard reason: a measurement/m);   // as the format check reads it (rulebook PLN 2)
  // a hard reason that is none of P19's is a finding of the plan's check
  assert.deepEqual(P.planFindings(null, planText('T1', [[1, [['alpha', 'T1-1', 'XYZ-1']]]]).replace('make alpha.', 'make alpha. · hard reason: too big')), ['T1-1: its hard reason "too big" is none of P19\'s: Bob\'s decision, a deployment or a measurement that cannot happen inside the tranche, something outside the product']);
});

test('R7 report states elapsed time, work finished, each deferred entry with its reason, work left, cost, the overhead (commits by purpose, sessions per job, gate runs per merged job, restarts, tokens by role) and the stages run for the first time under a version', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const p = product(base, 'a', [...TWO, ['legacy', 2, ['XYZ-3']]], TWO_PLAN);
  const mods = JSON.parse(readFileSync(join(p.dir, 'build/modules.json'), 'utf8'));
  mods.modules[2].legacy = true; put(p.seed, 'build/modules.json', JSON.stringify(mods)); put(p.seed, 'src/legacy.mjs', 'a\nb\nc\nd\n');
  g(p.seed, 'commit', '-q', '-am', 'legacy'); g(p.seed, 'push', '-q', 'origin', 'main'); p.g('pull', '-q');
  P.trancheOpen(p.o(), OK); epochOpen(p.o()); asBob(p, { 1: 'CLOSED', 2: 'CLOSED' });
  // alpha's job: two sessions (one restart), two commits on its branch, a net removal from the legacy file
  p.g('checkout', '-q', '-b', 'job/alpha'); put(p.dir, 'src/alpha.mjs', 'export const alpha = 2;\n'); p.g('commit', '-q', '-am', 'alpha 1');
  put(p.dir, 'src/legacy.mjs', 'a\n'); p.g('commit', '-q', '-am', 'alpha 2: moved out of the legacy file');
  p.g('checkout', '-q', TRANCHE); p.g('merge', '-q', '--no-ff', '-m', 'Merge pull request #3 from o/job/alpha', 'job/alpha'); p.g('push', '-q', 'origin', `HEAD:${TRANCHE}`);
  jobLine(p, 'alpha', 'ARCHIVED', 3);
  put(p.dir, P.NEXT, planText('T2', [[2, [['beta', 'T1-2', 'XYZ-2']]]]).replace('make beta.', 'make beta. · hard reason: Bob\'s decision on the layer'));
  metricsRow(p.R, [J1, 'job', 'ALPHA #1', 'alpha', 100, 0, 0, 0, '', '', '', ''], { tranche: 'T1' });
  metricsRow(p.R, ['session_01J2', 'job', 'ALPHA #2', 'alpha', 50, 0, 0, 0, '', '', '', ''], { tranche: 'T1' });
  metricsRow(p.R, [B1, 'BOB', 'BOB #1', '', 40, 5, 3, 2, '', '', '', ''], { tranche: 'T1' });
  metricsRow(p.R, ['session_01X', 'job', 'BETA #1', 'beta', '', '', '', '', '', '', '', 'unmeasured: archived elsewhere'], { tranche: 'T1' });
  commitPush(p.R, TRANCHE, ['build/metrics/T1.csv', P.NEXT], 'metrics; the next list');
  P.roundClose(p.o());
  const r = P.report(p.o({ tranche: 'T1', stages: ['tranche close'] }));
  assert.equal(r.tranche, 'T1'); assert.equal(r.pin, 'abc1234');
  assert.ok(r.elapsedHours >= 0 && Number.isFinite(r.elapsedHours));
  assert.deepEqual(r.finished, { legacyLinesRemoved: 3, entriesApplied: 1 });
  assert.deepEqual(r.entries.map((e) => [e.id, e.outcome]), [['T1-1', 'applied'], ['T1-2', "deferred: Bob's decision on the layer"]]);
  assert.deepEqual(r.left, { notApplied: [], completion: [], nextTranche: 1 });
  assert.deepEqual(r.cost, { tokens: 200, byRole: { job: 150, BOB: 50 }, unmeasured: ['BETA #1 (session_01X)'] });
  assert.deepEqual([r.overhead.sessionsPerJob, r.overhead.gateRunsPerMergedJob, r.overhead.restarts, r.overhead.share], [1.5, 2, 1, '25 %']);
  assert.ok(r.overhead.commitsByPurpose['job code'] >= 2 && r.overhead.commitsByPurpose.records >= 1 && r.overhead.commitsByPurpose.merges === 1);
  assert.deepEqual([r.stages, r.firstRuns], [['tranche close'], ['tranche close']]);
  for (const k of ['Elapsed', 'Finished', 'Deferred', 'Left', 'Cost', 'Overhead', 'Stages', 'First runs under this version']) assert.match(r.text, new RegExp(`^\\*\\*${k}\\*\\* · `, 'm'));
  // a stage an earlier report under the same pin already named is not a first run
  put(p.dir, P.reportFile('T0'), '# The tranche report · T0\n\n**Pin** · abc1234\n**Stages** · tranche close\n'); commitPush(p.R, TRANCHE, [P.reportFile('T0')], 'an earlier report');
  assert.deepEqual(P.report(p.o({ tranche: 'T1', stages: ['tranche close', 'completion round'] })).firstRuns, ['completion round']);
  // an entry placed out of the tranche onto the next tranche's list is named deferred, with its reason
  assert.deepEqual(r.deferred, [{ id: 'T1-2', module: 'beta', reason: "Bob's decision on the layer" }]);
});

test('R7 report names an entry deferred by place, with its reason; a reason the tranche\'s own plan carries is history, not a deferral', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const p = product(base, 'a', TWO, TWO_PLAN.replace('make beta.', 'make beta. · hard reason: outside the product, last tranche'));
  P.trancheOpen(p.o(), OK);
  assert.deepEqual(P.report(p.o({ tranche: 'T1' })).deferred, []);
  P.place(p.o({ module: 'alpha', entry: '- T1-7 · XYZ-1: needs the vendor\'s API.', defer: 'outside' }));
  const r = P.report(p.o({ tranche: 'T1' }));
  assert.deepEqual(r.deferred, [{ id: 'T1-7', module: 'alpha', reason: 'outside the product: something that does not yet exist' }]);
  assert.match(r.text, /^\*\*Deferred\*\* · T1-7 \(alpha\): outside the product: something that does not yet exist$/m);
});

test('R8 ruling writes one line K<n> · date · area · ruling · why in build/rulings.md, committed with the files it changes; footprint counts the commits by purpose', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const p = product(base, 'a', TWO, TWO_PLAN);
  P.trancheOpen(p.o(), OK);
  assert.throws(() => P.ruling(p.o({ text: 'x' })), /--why/);
  assert.throws(() => P.ruling(p.o({ text: 'x', why: 'y', files: 'no/such.md' })), /no such file/);
  put(p.dir, 'build/requirements/alpha.md', reqFile('alpha', ['XYZ-1', 'XYZ-4']));
  const k = P.ruling(p.o({ text: 'alpha also does XYZ-4\n(a clarification) · noted', why: 'the identity', module: 'alpha', files: 'build/requirements/alpha.md' }));
  assert.equal(k.ruling, 'K1');
  assert.match(readFileSync(join(p.dir, 'build/rulings.md'), 'utf8'), /^- K1 · \d{4}-\d{2}-\d{2} · alpha · alpha also does XYZ-4 \(a clarification\); noted · the identity$/m);
  assert.deepEqual(p.g('show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['build/requirements/alpha.md', 'build/rulings.md']);
  assert.equal(P.ruling(p.o({ text: 'second', why: 'z' })).ruling, 'K2');
  const fp = P.footprint(p.o());
  assert.deepEqual([fp.kinds.product, fp.merges], [0, 0]); assert.equal(fp.kinds['build state'], 3); assert.equal(fp.bookkeeping, '100 %');
});

test('R9 no function reads or writes outside the product\'s own repository: two products on one checkout of the process run tranches independently', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const a = product(base, 'a', TWO, TWO_PLAN), b = product(base, 'b', [['solo', 1, ['XYZ-1']]], planText('T7', [[1, [['solo', 'T7-1', 'XYZ-1']]]]));
  const ta = P.trancheOpen(a.o(), OK), tb = P.trancheOpen(b.o(), OK);
  assert.deepEqual([ta.tranche, tb.tranche], ['T1', 'T7']);
  epochOpen(a.o()); epochOpen(b.o()); asBob(a); asBob(b);
  P.ruling(a.o({ text: 'a only', why: 'a' }));
  // a path of the other product, or of no product, is refused
  assert.throws(() => P.ruling(a.o({ text: 'x', why: 'y', files: join(b.dir, 'build/modules.json') })), /outside the product's repository/);
  assert.throws(() => P.roundOpen(a.o({ planFile: join(b.dir, P.PLAN) })), /outside the product's repository/);
  assert.throws(() => P.roundClose(a.o({ next: '../b-bob/build/plan/current.md' })), /outside the product's repository|layer\(s\)/);
  assert.throws(() => P.within(a.R, '../b-bob/x'), /outside the product's repository/);
  assert.equal(P.within(a.R, 'build/x.md'), 'build/x.md');
  // each product's record is its own: the other's tranche, plan, rulings and state untouched
  assert.equal(existsSync(join(b.dir, 'build/rulings.md')), false);
  assert.match(readFileSync(join(b.dir, P.PLAN), 'utf8'), /^# Plan: test · T7/);
  assert.deepEqual(g(b.origin, 'for-each-ref', '--format=%(refname:short)').split('\n').sort(), ['main', 'state/E1', TRANCHE]);
  assert.deepEqual(g(a.origin, 'log', '--format=%s', '-1', TRANCHE), 'K1: a only');
  assert.equal(P.report(b.o({ tranche: 'T7' })).entries.length, 1);
  assert.equal(P.report(a.o({ tranche: 'T1' })).entries.length, 2);
});

test('R10 nothing assumes a product\'s size or shape: one layer of one module, and three layers of several, run the same', () => {
  const base = mkdtempSync(join(tmpdir(), 'planning-'));
  const small = product(base, 's', [['only', 1, ['XYZ-1']]], planText('S1', [[1, [['only', 'S1-1', 'XYZ-1']]]]));
  const mods = [['a1', 1, ['XYZ-1']], ['a2', 1, ['XYZ-2']], ['b1', 2, ['XYZ-3']], ['c1', 3, ['XYZ-4']], ['c2', 3, ['XYZ-5']]];
  const big = product(base, 'b', mods, planText('B4', [[1, [['a1', 'B4-1', 'XYZ-1'], ['a2', 'B4-2', 'XYZ-2']]], [2, [['b1', 'B4-3', 'XYZ-3']]], [3, [['c1', 'B4-4', 'XYZ-4'], ['c2', 'B4-5', 'XYZ-5']]]]));
  for (const [p, layers] of [[small, [1]], [big, [1, 2, 3]]]) {
    const t = P.trancheOpen(p.o(), OK);
    assert.deepEqual(t.layers, layers);
    epochOpen(p.o()); asBob(p, Object.fromEntries(layers.map((l) => [l, 'CLOSED'])));
    assert.equal(P.roundClose(p.o()).round, 1);
    assert.equal(P.report(p.o({ tranche: t.tranche })).entries.length, layers.length === 1 ? 1 : 5);
  }
});
