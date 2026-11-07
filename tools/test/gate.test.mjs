// tools/gate.mjs at its interface (build/requirements/gate.md R1 to R9), on the dry run's toy product in a real git
// checkout with a bare origin: the product sits in a subdirectory (`toy/`) of its repository, as a product may.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../gate.mjs';
import { repo, paths as recordPaths, TRANCHE } from '../record.mjs';
import { isKnown, limits } from '../platform.mjs';
import { resultPath } from '../../checks/run.mjs';

delete process.env.GITHUB_ACTIONS;   // these runs are a session's unless a test says otherwise
const HERE = dirname(fileURLToPath(import.meta.url)), TOY = join(HERE, '..', '..', 'dryrun');
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function world() {
  const base = mkdtempSync(join(tmpdir(), 'gate-')), origin = join(base, 'origin.git'), root = join(base, 'work');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['clone', '-q', origin, root], { stdio: 'ignore' });
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false']]) g(root, 'config', k, v);
  cpSync(TOY, join(root, 'toy'), { recursive: true });
  g(root, 'add', '.'); g(root, 'commit', '-q', '-m', 'seed'); g(root, 'branch', '-M', TRANCHE); g(root, 'push', '-q', 'origin', TRANCHE);
  const dir = join(root, 'toy'), R = repo(dir);
  const put = (files, msg) => { for (const [p, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); } g(root, 'add', '-A'); g(root, 'commit', '-q', '-m', msg); return g(root, 'rev-parse', 'HEAD'); };
  const job = (m, from = TRANCHE) => { g(root, 'checkout', '-q', '-b', `job/${m}`, from); return g(root, 'rev-parse', 'HEAD'); };
  return { root, dir, R, put, job, head: () => g(root, 'rev-parse', 'HEAD') };
}
const passing = (name) => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${name}', () => { assert.equal(1, 1); });\n`;
const failing = (name) => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${name}', () => { assert.equal(1, 2); });\n`;

test('R1 R6: the module\'s own suite and the checks scoped to it, green on a clean change; the checkout left as it was', () => {
  const w = world(), base = w.job('alpha');
  w.put({ 'alpha/test/extra.test.mjs': passing('extra') }, 'alpha: a test');
  const r = G.runGate(w.R, 'alpha', base);
  assert.deepEqual(r.fails, []);
  assert.equal(r.tests.tests, G.suite(w.R, G.testFiles(w.R, 'alpha')).tests);   // alpha's own files, no other module's
  assert.ok(r.tests.tests > 0 && r.tests.pass === r.tests.tests);
  assert.deepEqual(r.checks, ['format', 'architecture', 'coverage', 'fixtures']);
  assert.equal(g(w.root, 'status', '--porcelain'), '');   // artifacts restored; the result file put back as found
  assert.equal(existsSync(join(w.dir, resultPath(w.R))), false);
});

test('R1: a new red fails; a red the base already had is inherited and named, never a failure', () => {
  const w = world();
  const base = w.job('alpha');
  w.put({ 'alpha/test/broken.test.mjs': failing('new red') }, 'alpha: a red');
  const r = G.runGate(w.R, 'alpha', base);
  assert.equal(r.fails.length, 1); assert.match(r.fails[0], /^tests: .*new reds: .*new red/);
  // the same red already on the base: inherited
  g(w.root, 'checkout', '-q', TRANCHE);
  const base2 = w.put({ 'alpha/test/broken.test.mjs': failing('old red') }, 'tranche: a red');
  g(w.root, 'checkout', '-q', '-b', 'job/alpha2', base2);
  w.put({ 'alpha/src/note.mjs': 'export const note = 1;\n' }, 'alpha: a file');
  const r2 = G.runGate(w.R, 'alpha', base2);
  assert.deepEqual(r2.fails, []);
  assert.deepEqual(r2.inherited.tests, ['old red']);
});

test('R1 R6: a check\'s finding is read from the checks\' result file with its module, file and line; one the base had is inherited', () => {
  const w = world(), base = w.job('alpha');
  w.put({ 'beta/src/index.mjs': `${readFileSync(join(w.dir, 'beta/src/index.mjs'), 'utf8')}// not alpha's\n` }, 'alpha: touches beta');
  const r = G.runGate(w.R, 'alpha', base);
  const f = r.findings.find((x) => x.check === 'ownership' && x.file === 'beta/src/index.mjs');
  assert.ok(f, JSON.stringify(r.findings));
  assert.equal(f.module, 'alpha');
  assert.ok(r.fails.includes(`ownership: ${f.finding} [${G.place(f)}]`));
  // an untested requirement on the base is the base's coverage finding: inherited by a job that does not add it
  g(w.root, 'checkout', '-q', TRANCHE);
  const rq = readFileSync(join(w.dir, 'build/requirements/alpha.md'), 'utf8').replace('## Private', '- **R77** Untested here.\n\n## Private');
  const base2 = w.put({ 'build/requirements/alpha.md': rq }, 'tranche: R77');
  g(w.root, 'checkout', '-q', '-b', 'job/alpha3', base2);
  w.put({ 'alpha/src/note.mjs': 'export const note = 1;\n' }, 'alpha: a file');
  const r2 = G.runGate(w.R, 'alpha', base2);
  assert.deepEqual(r2.fails, []);
  assert.ok(r2.inherited.findings.some((x) => x.check === 'coverage' && /R77/.test(x.finding)), JSON.stringify(r2.inherited));
});

test('R2: every artifact regenerated; only those the regeneration changed against HEAD verified', () => {
  const w = world();
  const mf = readFileSync(join(w.dir, 'build/manifest.md'), 'utf8')
    .replace(/(\| `legacy\/dist\/legacy\.bundle\.txt` .*\n)/, '$1| `gen/same.txt` | alpha | `true` | `false` |\n| `gen/new.txt` | alpha | `mkdir -p gen && echo new > gen/new.txt` | `false` |\n| `gen/ok.txt` | alpha | `mkdir -p gen && echo ok > gen/ok.txt` | `true` |\n');
  const base = w.put({ 'build/manifest.md': mf, 'gen/same.txt': 'same\n', 'gen/ok.txt': 'old\n' }, 'tranche: artifacts');
  const a = G.regenerate(w.R);
  assert.deepEqual(a.changed.filter((p) => p.startsWith('gen/')).sort(), ['gen/new.txt', 'gen/ok.txt']);
  assert.ok(!a.verified.includes('gen/same.txt'));   // unchanged: its failing verify is never run
  assert.deepEqual(a.stale, ['gen/new.txt']);
  assert.deepEqual(a.failed, []);
  G.restore(w.R);
  assert.equal(g(w.root, 'status', '--porcelain'), '');
  w.job('alpha');
  w.put({ 'alpha/src/note.mjs': 'export const note = 1;\n' }, 'alpha: a file');
  assert.deepEqual(G.runGate(w.R, 'alpha', base).fails, ['artifacts: regenerated but not verified: gen/new.txt']);
  // a regeneration that exits non-zero is a finding naming its artifact
  g(w.root, 'checkout', '-q', TRANCHE);
  const base2 = w.put({ 'build/manifest.md': mf.replace('| `gen/new.txt` | alpha | `mkdir -p gen && echo new > gen/new.txt` | `false` |\n', '| `gen/broken.txt` | alpha | `exit 1` | `true` |\n') }, 'tranche: a broken regeneration');
  assert.deepEqual(G.regenerate(w.R).failed, ['gen/broken.txt']); G.restore(w.R);
  g(w.root, 'checkout', '-q', '-b', 'job/alpha2', base2);
  w.put({ 'alpha/src/note.mjs': 'export const note = 1;\n' }, 'alpha: a file');
  assert.deepEqual(G.runGate(w.R, 'alpha', base2).fails, ['artifacts: regeneration failed: gen/broken.txt']);
});

test('R3: every lock file installed where it sits; the product\'s Node version from its version file', () => {
  const w = world();
  assert.deepEqual(G.installs(w.R), { locks: [], node: null });
  w.put({ '.tool-versions': 'python 3.12\n' }, 'a .tool-versions with no nodejs line');
  assert.equal(G.installs(w.R).node, null);
  w.put({ '.tool-versions': 'python 3.12\nnodejs 20.11.0\n' }, 'a .tool-versions with nodejs');
  assert.equal(G.installs(w.R).node, '.tool-versions');
  g(w.root, 'rm', '-q', 'toy/.tool-versions'); g(w.root, 'commit', '-q', '-m', 'no .tool-versions');
  assert.match(G.workflow(w.R), new RegExp(`node-version: ${G.NODE_DEFAULT}\\n`));
  w.put({ '.nvmrc': '20\n', 'web/package-lock.json': '{}\n', 'yarn.lock': '\n' }, 'locks');
  const i = G.installs(w.R);
  assert.equal(i.node, '.nvmrc');
  assert.deepEqual(i.locks.map((l) => [l.file, l.dir, l.run]).sort(), [['web/package-lock.json', 'web', G.LOCKS['package-lock.json']], ['yarn.lock', '.', G.LOCKS['yarn.lock']]]);
  for (const text of [G.workflow(w.R), G.regressionWorkflow(w.R)]) {
    assert.match(text, /node-version-file: toy\/\.nvmrc\n/);
    assert.match(text, new RegExp(`working-directory: toy/web\\n +run: ${G.LOCKS['package-lock.json']}\\n`));
    assert.match(text, new RegExp(`working-directory: toy\\n +run: ${G.LOCKS['yarn.lock'].replace(/-/g, '\\-')}\\n`));
  }
});

test('R4: the module read from the diff; a touched module named in another\'s `from` is its source; two modules otherwise refused', () => {
  const w = world(), base = w.job('stats'), root = w.root;
  assert.equal(G.moduleOfDiff(w.R, base), null);   // nothing changed yet: the opening commit
  const step = (files) => { g(root, 'checkout', '-q', '--detach', base); w.put(files, 'step'); return G.moduleOfDiff(w.R, base); };
  assert.equal(step({ 'stats/src/k2.mjs': 'export const k2 = 1;\n', 'legacy/k2.mjs': '// moved out\n', 'catalog/k2.md': 'moved out\n' }), 'stats');
  assert.equal(step({ 'legacy/k2.mjs': '// a change in the legacy module alone\n' }), 'legacy');
  assert.equal(step({ 'build/requirements/beta.md': '# beta\n' }), 'beta');   // a module's requirements file is its own
  assert.throws(() => step({ 'stats/src/k2.mjs': 'x', 'alpha/src/k2.mjs': 'y' }), /several modules: alpha, stats/);
  assert.throws(() => step({ 'alpha/src/k2.mjs': 'y', 'legacy/k2.mjs': 'z' }), /several modules: alpha, legacy/);
});

test('R5: the gate workflow from the template, triggered by the module paths, tests, generated artifacts and the files the checks read, never by another record path, once per tip', () => {
  const w = world(), text = G.workflow(w.R);
  assert.match(text, /^name: gate\n/);
  assert.match(text, new RegExp(`branches: \\[${TRANCHE}\\]\\n +types: \\[opened, synchronize, reopened\\]\\n`));   // a new tip only
  const listed = [...text.matchAll(/^ {6}- '([^']+)'$/gm)].map((x) => x[1]), on = listed.filter((p) => !p.startsWith('!')), off = listed.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
  for (const p of ['toy/alpha/src/**', 'toy/alpha/test/**', 'toy/beta/scripts/**', 'toy/legacy/**', 'toy/beta/dist/bundle.txt']) assert.ok(on.includes(p), p);
  for (const p of recordPaths().durable) assert.ok(off.includes(`toy/${p}${p.endsWith('/') ? '**' : ''}`), p);
  assert.ok(!off.includes('toy/build/**'));   // only record.paths()' records are excluded
  // GitHub's filter takes a file's last matching pattern: the files the checks read come after the exclusions, so they trigger
  const lastOff = listed.lastIndexOf(`!${off[off.length - 1]}`);
  for (const p of ['toy/build/requirements/alpha.md', 'toy/build/requirements/stats.md', 'toy/build/modules.json', 'toy/build/layers.md', 'toy/build/manifest.md']) assert.ok(listed.indexOf(p) > lastOff, p);
  const lastMatch = (f) => { let hit = null; for (const p of listed) { const neg = p.startsWith('!'), q = neg ? p.slice(1) : p; if (q === f || (q.endsWith('**') && f.startsWith(q.slice(0, -2)))) hit = !neg; } return hit; };
  assert.equal(lastMatch('toy/build/requirements/alpha.md'), true);
  assert.equal(lastMatch('toy/build/plan/current.md'), false);   // a record the checks do not read
  assert.equal(lastMatch('toy/alpha/src/index.mjs'), true);
  assert.match(text, /run: node \.neoprocess\/tools\/gate\.mjs gate --product "toy" --base HEAD\^1\n/);
  assert.doesNotMatch(text, /\{\{\w+\}\}/);
  // a green tip whose base differs from the tranche only by record paths merges as it stands; any other file holds it
  g(w.root, 'push', '-q', 'origin', `${TRANCHE}`); const tip = g(w.root, 'rev-parse', 'HEAD');
  w.put({ 'build/rulings.md': '- K1 · a ruling\n', 'build/plan/next.md': '# Plan: next\n' }, 'tranche: records'); g(w.root, 'push', '-q', 'origin', TRANCHE);
  assert.deepEqual(G.gateNeutral(w.R, 'alpha', tip).held, []);
  w.put({ 'build/requirements/alpha.md': `${readFileSync(join(w.dir, 'build/requirements/alpha.md'), 'utf8')}\n` }, 'tranche: alpha\'s requirements');
  w.put({ 'beta/src/index.mjs': `${readFileSync(join(w.dir, 'beta/src/index.mjs'), 'utf8')}// x\n` }, 'tranche: beta'); g(w.root, 'push', '-q', 'origin', TRANCHE);
  assert.deepEqual(G.gateNeutral(w.R, 'alpha', tip).held.map((h) => h.file).sort(), ['beta/src/index.mjs', 'build/requirements/alpha.md']);
});

test('R7: the full regression is its own workflow with its own budget, dispatched only for a release or on Bob\'s word, never run in a session', () => {
  const w = world();
  for (const why of G.REGRESSION_REASONS) {
    const d = G.regression(w.R, { why });
    assert.deepEqual([d.tool, d.workflow_id, d.ref, d.inputs], ['actions_run_trigger', G.REGRESSION_WORKFLOW, 'main', { ref: TRANCHE, why }]);
    assert.ok(isKnown(d.tool));   // an act of the platform's table
  }
  for (const why of [undefined, 'layer close', 'tired']) assert.throws(() => G.regression(w.R, { why }), /dispatched only for "release" or "bob"/);
  const text = G.regressionWorkflow(w.R);
  assert.match(text, /^name: regression\n/);
  assert.match(text, /\n {2}workflow_dispatch:\n/);
  assert.doesNotMatch(text, /pull_request/);
  assert.match(text, new RegExp(`timeout-minutes: ${G.REGRESSION_MINUTES}\\n`));
  assert.ok(G.REGRESSION_MINUTES > limits().backgroundMinutes);   // longer than a session may run: the runner's only
  assert.throws(() => G.runRegression(w.R), /never in a session/);
});

test('R8: no user-suite path: a change to what the module provides runs only its own suite', () => {
  assert.equal(G.usersOfChange, undefined);
  const w = world();
  w.put({ 'beta/test/broken.test.mjs': failing('beta red') }, 'tranche: beta, a user of alpha, is red');
  const base = w.job('alpha');
  const src = join(w.dir, 'alpha/src/index.mjs');
  w.put({ 'alpha/src/index.mjs': readFileSync(src, 'utf8').replace('export function add(a, b)', 'export function add(a, b, ...rest)') }, 'alpha: add changed');
  const r = G.runGate(w.R, 'alpha', base);
  assert.deepEqual(r.fails, []);
  assert.equal(r.users, undefined);
  assert.ok(!JSON.stringify(r.tests).includes('beta red'));
});

test('R9: the hand form in a session is a check of what CI will do, never a merge\'s evidence; in CI it is', () => {
  const w = world(); w.job('alpha');
  w.put({ 'alpha/src/note.mjs': 'export const note = 1;\n' }, 'alpha: a file');
  const s = G.gateCheck({ product: w.dir });
  assert.deepEqual([s.ok, s.module, s.evidence], [true, 'alpha', false]);
  assert.match(s.note, /never a merge's evidence/);
  assert.equal(existsSync(join(w.dir, resultPath(w.R))), false);   // a session's run leaves no result file
  process.env.GITHUB_ACTIONS = 'true';
  try {
    const c = G.gateCheck({ product: w.dir, base: TRANCHE });
    assert.deepEqual([c.ok, c.evidence, c.note], [true, true, undefined]);
  } finally { delete process.env.GITHUB_ACTIONS; }
  assert.throws(() => G.gateCheck({ product: w.dir, base: 'nope' }), /not a commit/);
});

test('R6: a CI run keeps the checks\' result file for the merge and `status` to read; it is the findings the gate reported', () => {
  const w = world(); w.job('alpha');
  w.put({ 'beta/src/index.mjs': `${readFileSync(join(w.dir, 'beta/src/index.mjs'), 'utf8')}// not alpha's\n` }, 'alpha: touches beta');
  process.env.GITHUB_ACTIONS = 'true';
  let c;
  try { c = G.gateCheck({ product: w.dir, base: TRANCHE, module: 'alpha' }); } finally { delete process.env.GITHUB_ACTIONS; }
  const file = join(w.dir, resultPath(w.R));
  assert.ok(existsSync(file));
  const kept = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(kept.commit, g(w.root, 'rev-parse', 'HEAD'));   // HEAD's result, not the base's
  assert.equal(kept.module, 'alpha');
  assert.deepEqual(kept.findings, c.findings);
  assert.ok(c.findings.some((f) => f.check === 'ownership' && f.file === 'beta/src/index.mjs'));
});
