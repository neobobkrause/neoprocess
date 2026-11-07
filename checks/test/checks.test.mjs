// Tests of the architecture module (build/requirements/architecture.md): the module order, the runner, and the
// architecture, coverage, ownership, format and fixtures checks, against small product repositories built in a temporary
// directory. Each test builds exactly the state it needs and asserts the findings by their key and fields (R11), never by
// the sentence a check prints. A test titled with an id proves that requirement at the module's interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkArchitecture, importsOf, modules } from '../architecture.mjs';
import { checkCoverage } from '../coverage.mjs';
import { checkOwnership } from '../ownership.mjs';
import { checkFormat } from '../format.mjs';
import { checkFixtures } from '../fixtures.mjs';
import { checkChannels } from '../channels.mjs';
import { checkWords } from '../words.mjs';
import { run, readResult, RESULT_DEFAULT } from '../run.mjs';
import { snapshot } from '../lib.mjs';

const REQ = (ids) => `# m\n\n## Public\n\n### Purpose\n\nx\n\n### Provides\n\n${ids}\n\n## Private\n\n### Uses\n\nNone.\n\n### Invariants\n\n### Satisfies\n`;

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'product-'));
  const g = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  const write = (fs) => { for (const [p, c] of Object.entries(fs)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), c); } };
  write(files);
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  return { root, g, write, commit: (fs) => { write(fs); g('add', '-A'); g('commit', '-q', '-m', 'next'); } };
}

// The legacy module comes after the module extracted from it (R1): it is the one that imports the extracted code.
const MODULES = (extra = {}) => JSON.stringify({
  not_product: ['docs/', 'build/'],
  modules: [
    { id: 'a', layer: 1, paths: ['src/a/'], tests: ['test/a/'], uses: [] },
    { id: 'b', layer: 2, from: 'legacy', paths: ['src/b/'], tests: ['test/b/'], uses: ['a'] },
    { id: 'legacy', layer: 2, legacy: true, paths: ['src/legacy.mjs'], tests: [], uses: ['*earlier'] },
    ...(extra.more || []),
  ],
});
const LAYERS = '| layer | name | modules |\n| --- | --- | --- |\n| 1 | One | a |\n| 2 | Two | b, legacy |\n';

const base = (over = {}) => ({
  'build/modules.json': MODULES(), 'build/layers.md': LAYERS,
  'src/legacy.mjs': 'export const old = 1;\nexport const moved = 2;\n',
  'src/a/index.mjs': 'export const a = 1;\n',
  'src/b/index.mjs': "import { a } from '../a/index.mjs';\nexport const b = a;\n",
  'test/a/a.test.mjs': '// R1 R2\n', 'test/b/b.test.mjs': '// R1\n',
  'build/requirements/a.md': REQ('- **R1** one\n- **R2** two'),
  'build/requirements/b.md': REQ('- **R1** one'),
  ...over,
});
const edit = (json, fn) => { const m = JSON.parse(json); fn(m); return JSON.stringify(m); };

// A finding as the fields a test names: [key, file] by default.
const pick = (r, ...fields) => r.findings.map((f) => (fields.length ? fields : ['key', 'file']).map((k) => f[k]));
const keysOf = (r) => r.findings.map((f) => f.key);

// The epoch's record on a state branch, at the local ref a fetch leaves (`origin/state/<epoch>`), with each module's job line.
function stateBranch(r, { jobs = {}, layers = '1 STARTED', closed = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'state-'));
  const g = (...a) => execFileSync('git', ['-C', tmp, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'state'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  const files = { 'epoch.md': closed ? 'closed 2026-11-07\n' : 'E1 opened 2026-11-07\n', 'plan.md': `# Plan (transient)\n\n**Status** · OPEN · BOB #1 · session_01AAAAAAAAAAAAAAAAAAAAAAAA\n**Owed** · none\n**Layers** · ${layers}\n` };
  for (const [m, st] of Object.entries(jobs)) files[`jobs/${m}.md`] = `# ${m} (transient)\n\n**Status** · ${m.toUpperCase()} #1 · session_01BBBBBBBBBBBBBBBBBBBBBBBB · ${st} · PR #9\n`;
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(tmp, p)), { recursive: true }); writeFileSync(join(tmp, p), c); }
  g('add', '-A'); g('commit', '-q', '-m', 'state');
  r.g('fetch', '-q', tmp, '+state:refs/remotes/origin/state/E1');
}

// ---- R1: modules(R) and the map's order -------------------------------------------------------------------------

test('R1: modules answers build/modules.json in its one total order; a map that breaks it is an architecture finding', () => {
  const { root } = repo(base());
  const m = modules(root);
  assert.deepEqual(m.modules.map((x) => [x.id, x.layer]), [['a', 1], ['b', 2], ['legacy', 2]]);
  assert.deepEqual(m.findings, []);
  assert.deepEqual(checkArchitecture(root).findings, []);
  // lower layers first and a layer's modules adjacent; uses only earlier modules; from only a legacy module placed after
  const bad = edit(MODULES({ more: [{ id: 'c', layer: 1, paths: ['src/c/'], tests: [], uses: ['nobody'], from: ['a'] }] }), (j) => { j.modules[0].uses = ['b']; });
  const broken = repo(base({ 'build/modules.json': bad, 'build/layers.md': LAYERS.replace('| 1 | One | a |', '| 1 | One | a, c |'), 'src/c/x.mjs': 'x\n' }));
  const found = modules(broken.root).findings.map((f) => [f.key, f.module, f.used ?? f.from ?? null]);
  assert.deepEqual(found, [['use-not-earlier', 'a', 'b'], ['layer-order', 'c', null], ['use-not-earlier', 'c', 'nobody'], ['from-not-legacy', 'c', 'a']]);
  assert.deepEqual(keysOf(checkArchitecture(broken.root)).slice(0, 4), ['use-not-earlier', 'layer-order', 'use-not-earlier', 'from-not-legacy']);
  // a legacy module placed before the module extracted from it, and "*earlier" outside a legacy module
  const early = edit(MODULES(), (j) => { j.modules = [j.modules[2], j.modules[0], { ...j.modules[1], layer: 1 }]; j.modules[0].layer = 1; j.modules[1].uses = ['*earlier']; });
  const e = repo(base({ 'build/modules.json': early, 'build/layers.md': '| layer | name | modules |\n| --- | --- | --- |\n| 1 | One | legacy, a, b |\n' }));
  assert.deepEqual(modules(e.root).findings.map((f) => [f.key, f.module]), [['wildcard-not-legacy', 'a'], ['from-not-after', 'b']]);
  // a module job's scoped run names only its own module's map findings
  assert.deepEqual(keysOf(checkArchitecture(broken.root, ['b'])), []);
  assert.deepEqual(keysOf(checkArchitecture(broken.root, ['a'])), ['use-not-earlier']);
});

// ---- R2, R3: the runner and its result --------------------------------------------------------------------------

test('R2: run is one function: scoped to the module named, or whole over the product when none is named (the layer close)', async () => {
  const r = repo(base({ 'src/a/index.mjs': "import { b } from '../b/index.mjs';\n", 'build/requirements/b.md': REQ('- **R1** one\n- **R2** two'), 'build/modules.json': edit(MODULES(), (j) => { j.modules[1].paths.push('src/b/gone.mjs'); }) }));
  const whole = await run(r.root, { write: false });
  assert.deepEqual(whole.findings.map((f) => [f.check, f.key, f.module]), [['format', 'path-missing', 'b'], ['architecture', 'later-import', 'a'], ['coverage', 'id-unnamed', 'b']]);
  const a = await run(r.root, { module: 'a', write: false });
  assert.deepEqual(a.findings.map((f) => [f.check, f.key, f.module]), [['architecture', 'later-import', 'a']]);
  const b = await run(r.root, { module: 'b', write: false });
  assert.deepEqual(b.findings.map((f) => [f.check, f.key, f.module]), [['format', 'path-missing', 'b'], ['coverage', 'id-unnamed', 'b']]);
  // a product-level finding (no module) belongs to every scoped run, as to the whole one
  r.commit({ 'build/layers.md': `${LAYERS}<<<<<<< ours\n` });
  assert.ok((await run(r.root, { module: 'a', write: false })).findings.some((f) => f.key === 'conflict-marker'));
  // with a base, the scoped run is the job's gate run: ownership joins it
  r.commit({ 'src/a/more.mjs': 'export const more = 1;\n' });
  const gate = await run(r.root, { module: 'b', base: 'HEAD~1', write: false });
  assert.deepEqual(gate.findings.filter((f) => f.check === 'ownership').map((f) => [f.key, f.file]), [['outside', 'src/a/more.mjs']]);
  assert.equal(gate.ok, false);
  // the command is the same function: --module is the one switch, and the exit code says red
  const cmd = spawnSync('node', [fileURLToPath(new URL('../run.mjs', import.meta.url)), r.root, '--module', 'a', '--no-fetch'], { encoding: 'utf8' });
  assert.equal(cmd.status, 1);
  assert.deepEqual(readResult(r.root).findings.map((f) => [f.check, f.key]), [['format', 'conflict-marker'], ['architecture', 'later-import']]);
  assert.equal(readResult(r.root).module, 'a');
});

test('R3: run writes one machine-readable result (check, key, module, file, line) at the path the manifest names, default checks/result.json, and readResult reads it', async () => {
  const r = repo(base({ 'stray.mjs': 'x\n', 'build/requirements/a.md': REQ('- **R1** one\n- **R2** two\n- **R3** three') }));
  const out = await run(r.root);
  assert.equal(out.path, RESULT_DEFAULT);
  const written = JSON.parse(readFileSync(join(r.root, RESULT_DEFAULT), 'utf8'));
  assert.deepEqual(written, readResult(r.root));
  assert.equal(written.commit, r.g('rev-parse', 'HEAD').trim());
  assert.equal(written.ok, false);
  assert.deepEqual(written.findings.map(({ check, key, module, file, line }) => ({ check, key, module, file, line })), [
    { check: 'architecture', key: 'unowned', module: null, file: 'stray.mjs', line: null },
    { check: 'coverage', key: 'id-unnamed', module: 'a', file: 'build/requirements/a.md', line: 13 },
  ]);
  for (const f of written.findings) assert.equal(typeof f.finding, 'string');   // the text people read rides beside the fields
  // the text printed beside it: each check's failures and its summary line
  assert.equal(out.text.split('\n').filter((l) => l.startsWith('FAIL  ')).length, 2);
  // the manifest names another path
  r.commit({ 'build/manifest.md': "# Manifest\n\n| what | where |\n| --- | --- |\n| the checks' result | `build/out/checks.json` |\n" });
  assert.equal((await run(r.root)).path, 'build/out/checks.json');
  assert.equal(readResult(r.root).commit, r.g('rev-parse', 'HEAD').trim());
  assert.ok(existsSync(join(r.root, 'build/out/checks.json')));
  // a green run says so
  const clean = repo(base());
  assert.equal((await run(clean.root)).ok, true);
  assert.deepEqual(readResult(clean.root).findings, []);
  assert.equal(readResult(repo(base()).root), null, 'no run yet: no result');
});

// ---- R4: architecture -------------------------------------------------------------------------------------------

test('importsOf finds static, re-export, dynamic and require forms, and skips comments and packages', () => {
  const src = "import x from './x.mjs';\nexport { y } from \"../y.js\";\nconst z = await import('./z.mjs');\nconst w = require('./w');\nimport fs from 'node:fs';\n// import q from './q.mjs';\n/* import r from './r.mjs' */\nimport './side.mjs';\n";
  assert.deepEqual(importsOf(src), ['./x.mjs', '../y.js', './z.mjs', './w', './side.mjs']);
});

test('R4: every relative import names its own module or a declared earlier one; every file has one owner, the most specific path', () => {
  const { root } = repo(base());
  assert.deepEqual(checkArchitecture(root).findings, []);
  // an unowned product file fails, a not_product file does not
  assert.deepEqual(pick(checkArchitecture(repo(base({ 'stray.mjs': 'x', 'docs/note.md': 'x' })).root)), [['unowned', 'stray.mjs']]);
  // an import of a later module
  assert.deepEqual(pick(checkArchitecture(repo(base({ 'src/a/index.mjs': "import { b } from '../b/index.mjs';\n" })).root), 'key', 'module', 'file', 'target', 'used'),
    [['later-import', 'a', 'src/a/index.mjs', 'src/b/index.mjs', 'b']]);
  // an import of an earlier module not declared in uses
  const undeclared = repo(base({ 'build/modules.json': edit(MODULES(), (j) => { j.modules[1].uses = []; }) }));
  assert.deepEqual(pick(checkArchitecture(undeclared.root), 'key', 'module', 'used'), [['undeclared-import', 'b', 'a']]);
  // an import of a file no module owns because it is not product
  assert.deepEqual(pick(checkArchitecture(repo(base({ 'docs/helper.mjs': 'x\n', 'src/a/index.mjs': "import '../../docs/helper.mjs';\n" })).root), 'key', 'target'), [['not-product-import', 'docs/helper.mjs']]);
  // the most specific path owns a nested file: the legacy module's test/ holds the extracted module's test/b/
  const nested = repo(base({ 'build/modules.json': edit(MODULES(), (j) => { j.modules[2].tests = ['test/']; }), 'test/legacy.test.mjs': "import '../src/legacy.mjs';\n", 'test/b/b.test.mjs': "import '../../src/b/index.mjs';\n// R1\n" }));
  assert.deepEqual(checkArchitecture(nested.root).findings, []);
  // the legacy module ("*earlier") may import any earlier module
  assert.deepEqual(checkArchitecture(repo(base({ 'src/legacy.mjs': "import { b } from './b/index.mjs';\nimport { a } from './a/index.mjs';\n" })).root).findings, []);
});

test('architecture: an import naming no tracked file is counted, not judged', () => {
  const { root } = repo(base({ 'test/a/a.test.mjs': "const fixture = `import x from '../lib/w.mjs';`;\n// R1 R2\n" }));
  const r = checkArchitecture(root);
  assert.deepEqual(r.findings, []);
  assert.equal(r.counts.unresolved, 1);
});

test('architecture: named modules limit the check to their own files', () => {
  const { root } = repo(base({ 'src/a/index.mjs': "import { b } from '../b/index.mjs';\n", 'stray.mjs': 'x' }));
  assert.deepEqual(checkArchitecture(root, ['b']).findings, []);
  assert.deepEqual(keysOf(checkArchitecture(root, ['a'])), ['later-import']);
});

// ---- R5: ownership ----------------------------------------------------------------------------------------------

test('R5: a job\'s diff touches only its module\'s paths and tests, its job record and the strike of its own marks', () => {
  const r = repo(base({ 'build/requirements/b.md': REQ('- **R1** one *(not yet met: T1)*') }));
  r.commit({ 'src/b/more.mjs': 'x', 'test/b/more.test.mjs': 'x', 'build/jobs/T1/b.md': 'x', 'build/requirements/b.md': REQ('- **R1** one') });
  assert.deepEqual(checkOwnership(r.root, 'b', 'HEAD~1').findings, []);
  r.commit({ 'src/a/index.mjs': 'changed', 'build/jobs/T1/a.md': 'x', 'build/requirements/a.md': REQ('- **R1** one\n- **R2** two, changed') });
  assert.deepEqual(pick(checkOwnership(r.root, 'b', 'HEAD~1'), 'key', 'module', 'file'), [['outside', 'b', 'build/jobs/T1/a.md'], ['outside', 'b', 'build/requirements/a.md'], ['outside', 'b', 'src/a/index.mjs']]);
  // in its legacy module the job only removes the moved code and rewires its callers to an import of its own paths;
  // the net change is a removal, and every added line is listed for the architecture session's reading
  const x = repo(base({ 'src/legacy.mjs': CALLER }));
  x.commit({ 'src/b/moved.mjs': BODY, 'src/legacy.mjs': "import { moved } from './b/moved.mjs';\n\nexport class Store {\n  run(x) {\n    return moved(x);\n  }\n}\n" });
  const c = checkOwnership(x.root, 'b', 'HEAD~1');
  assert.deepEqual(c.findings, []);
  assert.deepEqual(c.added, ["src/legacy.mjs:1  import { moved } from './b/moved.mjs';"]);
  x.commit({ 'src/legacy.mjs': "import { moved } from './b/moved.mjs';\nimport { a } from './a/index.mjs';\n\nexport class Store {\n  run(x) {\n    return moved(x) + a;\n  }\n}\nexport const more = 1;\n" });
  assert.deepEqual(pick(checkOwnership(x.root, 'b', 'HEAD~1'), 'key', 'file', 'line'), [['legacy-import', 'src/legacy.mjs', 2], ['legacy-unrelated', 'src/legacy.mjs', 9], ['legacy-net', null, null]]);
  // a module with no legacy source may not touch the legacy file at all
  assert.deepEqual(pick(checkOwnership(x.root, 'a', 'HEAD~1'), 'key', 'file'), [['outside', 'src/legacy.mjs']]);
  assert.deepEqual(pick(checkOwnership(x.root, 'nobody', 'HEAD~1')), [['no-module', 'build/modules.json']]);
});

test('ownership: a job strikes the not-yet-met marks of its own requirements file, and changes nothing else there (JOB-LIFE §3)', () => {
  const r = repo(base({ 'build/requirements/b.md': REQ('- **R1** one *(not yet met: T1)*\n- **R2** two *(not yet met: T1, T2)*\n- **R3** three') }));
  r.commit({ 'build/requirements/b.md': REQ('- **R1** one\n- **R2** two *(not yet met: T2)*\n- **R3** three') });
  assert.deepEqual(checkOwnership(r.root, 'b', 'HEAD~1').findings, []);
  r.commit({ 'build/requirements/b.md': REQ('- **R1** one\n- **R2** two *(not yet met: T2)*\n- **R3** three, or so') });
  assert.deepEqual(pick(checkOwnership(r.root, 'b', 'HEAD~1'), 'key', 'module', 'file', 'line'), [['strike-changed', 'b', 'build/requirements/b.md', 13]]);
  r.commit({ 'build/requirements/b.md': REQ('- **R1** one *(not yet met: T1)*\n- **R2** two *(not yet met: T2)*\n- **R3** three, or so') });
  assert.deepEqual(keysOf(checkOwnership(r.root, 'b', 'HEAD~1')), ['strike-changed']);   // a mark put back is written, not struck
  r.commit({ 'build/requirements/b.md': REQ('- **R1** one *(not yet met: T1)*\n- **R2** two *(not yet met: T2)*\n- **R3** three, or so\n- **R4** four') });
  assert.deepEqual(pick(checkOwnership(r.root, 'b', 'HEAD~1'), 'key', 'added', 'removed'), [['strike-lines', 1, 0]]);
  r.commit({ 'build/requirements/a.md': REQ('- **R1** one *(not yet met: T1)*\n- **R2** two') });   // another module's file: never b's, marks or not
  assert.deepEqual(pick(checkOwnership(r.root, 'b', 'HEAD~1')), [['outside', 'build/requirements/a.md']]);
});

test('ownership: an extracting module may remove from its legacy module, never add', () => {
  const r = repo(base());
  r.commit({ 'src/legacy.mjs': 'export const old = 1;\n' });
  assert.deepEqual(checkOwnership(r.root, 'b', 'HEAD~1').findings, []);
  r.commit({ 'src/legacy.mjs': 'export const old = 1;\nexport const added = 3;\n' });
  assert.deepEqual(pick(checkOwnership(r.root, 'b', 'HEAD~1'), 'key', 'file', 'line', 'last'), [['legacy-unrelated', 'src/legacy.mjs', 2, 2], ['legacy-net', null, null, undefined]]);
  assert.deepEqual(keysOf(checkOwnership(r.root, 'a', 'HEAD~1')), ['outside']);
});

const BODY = 'export function moved(x) {\n  const y = x * 2;\n  const z = y + 1;\n  const w = z * 3;\n  const v = w - 2;\n  const u = v / 2;\n  return u + y;\n}\n';
const CALLER = BODY + '\nexport class Store {\n  run(x) {\n    return moved(x);\n  }\n}\n';

test('ownership: an extraction may rewire the legacy caller of the moved code to its own module (D4)', () => {
  const r = repo(base({ 'src/legacy.mjs': CALLER }));
  r.commit({
    'src/b/moved.mjs': BODY,
    'src/legacy.mjs': "import {\n  moved,\n} from './b/moved.mjs';\n\nexport { moved as movedAgain } from './b/moved.mjs';\nexport class Store {\n  run(x) {\n    return moved(x);\n  }\n  twice(x) {\n    return moved(moved(x));\n  }\n}\n",
  });
  const c = checkOwnership(r.root, 'b', 'HEAD~1');
  assert.deepEqual(c.findings, []);
  assert.ok(c.added.includes('src/legacy.mjs:1  import {'), c.added.join('\n'));
  assert.ok(c.added.some((a) => /return moved\(moved\(x\)\)/.test(a)));
  assert.ok(c.tally.legacy.added > 0 && c.tally.legacy.removed > 0);
});

test('ownership: a legacy line that spreads an own import (...fooOps(x)) is a use; obj.fooOps is not (N175)', () => {
  const FOO = 'export function fooOps(x) {\n  const y = x * 2;\n  const z = y + 1;\n  const w = z * 3;\n  return { w };\n}\n';
  const r = repo(base({ 'src/legacy.mjs': FOO + 'export const api = {\n  keep: 1,\n};\n' }));
  r.commit({ 'src/b/foo.mjs': FOO, 'src/legacy.mjs': "import { fooOps } from './b/foo.mjs';\nexport const api = {\n  keep: 1,\n  ...fooOps(x),\n};\n" });
  const c = checkOwnership(r.root, 'b', 'HEAD~1');
  assert.deepEqual(c.findings, []);
  assert.ok(c.added.some((a) => /\.\.\.fooOps\(x\),/.test(a)), c.added.join('\n'));
  const pad = 'export const p1 = 1;\nexport const p2 = 2;\nexport const p3 = 3;\nexport const p4 = 4;\nexport const p5 = 5;\nexport const p6 = 6;\nexport const p7 = 7;\n';
  const r2 = repo(base({ 'src/legacy.mjs': "import { fooOps } from './b/foo.mjs';\nexport const api = {\n  keep: 1,\n};\n" + pad + FOO }));
  r2.commit({ 'src/b/foo.mjs': FOO, 'src/legacy.mjs': "import { fooOps } from './b/foo.mjs';\nexport const api = {\n  keep: 1,\n  ...obj.fooOps(x),\n};\n" + pad });
  assert.deepEqual(pick(checkOwnership(r2.root, 'b', 'HEAD~1'), 'key', 'file', 'line', 'last'), [['legacy-unrelated', 'src/legacy.mjs', 4, 4]]);
});

test('ownership: an extraction fails on an added import of another module, an unrelated addition, or a net addition', () => {
  const r = repo(base({ 'src/legacy.mjs': CALLER }));
  r.commit({
    'src/b/moved.mjs': 'export function moved(x) { return x * 2 + 1; }\n',
    'src/legacy.mjs': "import { moved } from './b/moved.mjs';\nimport { a } from './a/index.mjs';\n\nexport class Store {\n  run(x) {\n    return moved(x);\n  }\n}\n\nexport const unrelated = 3;\n",
  });
  assert.deepEqual(pick(checkOwnership(r.root, 'b', 'HEAD~1'), 'key', 'file', 'line', 'spec'), [['legacy-import', 'src/legacy.mjs', 2, './a/index.mjs'], ['legacy-unrelated', 'src/legacy.mjs', 10, undefined]]);
  const r2 = repo(base({ 'src/legacy.mjs': 'export function moved() { return 1; }\n' }));
  r2.commit({ 'src/b/moved.mjs': 'export function moved() { return 1; }\n', 'src/legacy.mjs': "import { moved } from './b/moved.mjs';\nexport function one() {\n  return moved();\n}\nexport const two = () => moved();\n" });
  assert.deepEqual(pick(checkOwnership(r2.root, 'b', 'HEAD~1'), 'key', 'legacy', 'added', 'removed'), [['legacy-net', ['legacy'], 5, 1]]);
});

test('ownership: a base that exists only as origin/<base> is found there', () => {
  const r = repo(base());
  r.g('update-ref', 'refs/remotes/origin/tranche/X1', 'HEAD');
  r.commit({ 'src/b/more.mjs': 'x' });
  assert.deepEqual(checkOwnership(r.root, 'b', 'tranche/X1').findings, []);
});

test('ownership: a product in a subdirectory of its repository is checked on its own paths', () => {
  const r = repo({ 'README.md': 'outer\n', ...Object.fromEntries(Object.entries(base()).map(([k, v]) => [`toy/${k}`, v])) });
  r.commit({ 'toy/src/b/more.mjs': 'x', 'README.md': 'changed outside the product\n' });
  assert.deepEqual(checkOwnership(join(r.root, 'toy'), 'b', 'HEAD~1').findings, []);
  r.commit({ 'toy/src/a/more.mjs': 'x' });
  assert.deepEqual(pick(checkOwnership(join(r.root, 'toy'), 'b', 'HEAD~1')), [['outside', 'src/a/more.mjs']]);
});

test('ownership: a module extracted from two legacy modules removes from each and is judged per module (D5)', () => {
  const mods = JSON.stringify({ not_product: ['build/'], modules: [
    { id: 'b', layer: 1, from: ['cat', 'legacy'], paths: ['src/b/'], tests: ['test/b/'], uses: [] },
    { id: 'cat', layer: 2, legacy: true, paths: ['src/cat.mjs'], tests: [], uses: [] },
    { id: 'legacy', layer: 2, legacy: true, paths: ['src/legacy.mjs'], tests: [], uses: ['*earlier'] },
  ] });
  const r = repo(base({ 'build/modules.json': mods, 'src/cat.mjs': 'export const keep = 1;\nexport function gone() {\n  return 2;\n}\n', 'src/legacy.mjs': CALLER }));
  r.commit({ 'src/b/moved.mjs': BODY, 'src/cat.mjs': 'export const keep = 1;\n', 'src/legacy.mjs': "import { moved } from './b/moved.mjs';\n\nexport class Store {\n  run(x) {\n    return moved(x);\n  }\n}\n" });
  const c = checkOwnership(r.root, 'b', 'HEAD~1');
  assert.deepEqual(c.findings, []);
  assert.deepEqual(c.tally.cat, { added: 0, removed: 3 });
  assert.equal(c.tally.legacy.added, 1);
  r.commit({ 'src/cat.mjs': 'export const keep = 1;\nexport const more = 3;\n' });
  assert.deepEqual(pick(checkOwnership(r.root, 'b', 'HEAD~1'), 'key', 'file', 'line', 'legacy'), [['legacy-unrelated', 'src/cat.mjs', 2, 'cat'], ['legacy-net', null, null, ['cat', 'legacy']]]);
  const bad = JSON.parse(mods); bad.modules[0].from = ['cat', 'b'];
  const r2 = repo(base({ 'build/modules.json': JSON.stringify(bad), 'src/cat.mjs': 'x\n' }));
  assert.deepEqual(modules(r2.root).findings.map((f) => [f.key, f.module, f.from]), [['from-not-legacy', 'b', 'b']]);
});

test('ownership: the net removal is judged over all the legacy modules together (D5 finding)', () => {
  const mods = JSON.stringify({ not_product: ['build/'], modules: [
    { id: 'b', layer: 1, from: ['cat', 'legacy'], paths: ['src/b/'], tests: ['test/b/'], uses: [] },
    { id: 'cat', layer: 2, legacy: true, paths: ['src/cat.mjs'], tests: [], uses: [] },
    { id: 'legacy', layer: 2, legacy: true, paths: ['src/legacy.mjs'], tests: [], uses: ['*earlier'] },
  ] });
  const r = repo(base({ 'build/modules.json': mods, 'src/cat.mjs': 'export const keep = 1;\nexport function gone(x) {\n  const a = x;\n  const b = a;\n  return b;\n}\n', 'src/legacy.mjs': 'export function v(x) {\n  return x;\n}\n' }));
  r.commit({ 'src/b/gone.mjs': 'export function gone(x) { return x; }\n', 'src/cat.mjs': 'export const keep = 1;\n', 'src/legacy.mjs': "import { gone } from './b/gone.mjs';\nexport function v(x) {\n  const y = gone(x);\n  return y;\n}\n" });
  const c = checkOwnership(r.root, 'b', 'HEAD~1');
  assert.deepEqual(c.findings, []);
  assert.deepEqual(c.tally, { cat: { added: 0, removed: 5 }, legacy: { added: 3, removed: 1 } });
});

// K140 (SUITE G5, gap X8): a changed line that only removes is a removal, not an addition.
const K140 = (f) => readFileSync(new URL(`./fixtures/cert/k140/${f}`, import.meta.url), 'utf8');
const B_CONTENT = 'export function contentOf(ctx, deps) {\n  return { extraction: deps.extraction };\n}\n';

test('ownership: a legacy line that only loses a key is a removal, not an addition (K140, the T5 content case)', () => {
  const r = repo(base({ 'src/legacy.mjs': K140('legacy-before.mjs') }));
  r.commit({ 'src/b/index.mjs': B_CONTENT, 'src/legacy.mjs': K140('legacy-after.mjs') });
  const c = checkOwnership(r.root, 'b', 'HEAD~1');
  assert.deepEqual(c.findings, []);
  assert.ok(!c.added.some((a) => /return \{ observed/.test(a)), c.added.join('\n'));
  assert.deepEqual(c.edited, ['src/legacy.mjs:7  return { observed: { written: ex.written ?? 0, states: ex.states || [], reextraction: !!ex.reextraction } };']);
  assert.deepEqual(c.added, ["src/legacy.mjs:2  import { contentOf } from './b/index.mjs';", 'src/legacy.mjs:5  contentOf(ctx, { extraction: extractionOf(ctx) }).extraction.onReading("legacy-store", (e) => {']);
  assert.deepEqual(c.tally.legacy, { added: 2, removed: 8 });
});

test('ownership: a legacy import that only loses a name is a removal, even from another module (K140)', () => {
  const r = repo(base({ 'src/legacy.mjs': "import { a, other } from './a/index.mjs';\nexport const old = a + other;\nexport const moved = 2;\n" }));
  r.commit({ 'src/b/index.mjs': 'export const moved = 2;\n', 'src/legacy.mjs': "import { a } from './a/index.mjs';\nexport const old = a;\n" });
  const c = checkOwnership(r.root, 'b', 'HEAD~1');
  assert.deepEqual(c.findings, []);
  assert.deepEqual(c.added, []);
  assert.equal(c.edited.length, 2);
});

test('ownership: a changed legacy line that adds or replaces anything is still listed and judged (K140)', () => {
  const r = repo(base({ 'src/legacy.mjs': K140('legacy-before.mjs') }));
  r.commit({ 'src/b/index.mjs': B_CONTENT, 'src/legacy.mjs': K140('legacy-after.mjs').replace('return { observed:', 'return { extra: 1, observed:') });
  let c = checkOwnership(r.root, 'b', 'HEAD~1');
  assert.deepEqual(pick(c, 'key', 'file', 'line', 'last'), [['legacy-unrelated', 'src/legacy.mjs', 7, 7]]);
  assert.ok(c.added.some((a) => /^src\/legacy\.mjs:7 {2}return \{ extra: 1/.test(a)), c.added.join('\n'));
  assert.deepEqual(c.edited, []);
  const r2 = repo(base({ 'src/legacy.mjs': "import { a } from './a/index.mjs';\nexport const old = a;\nexport function moved() {\n  return 1;\n}\n" }));
  r2.commit({ 'src/b/index.mjs': 'export const moved = 2;\n', 'src/legacy.mjs': "import { a, b } from './a/index.mjs';\nexport const old = 'a';\n" });
  c = checkOwnership(r2.root, 'b', 'HEAD~1');
  assert.deepEqual(pick(c, 'key', 'line'), [['legacy-import', 1], ['legacy-unrelated', 2]]);
  assert.equal(c.added.length, 2);
  // Only removing `this.` so that the line now calls the module's own import is a rewire: listed, judged, passing.
  const r3 = repo(base({ 'src/legacy.mjs': 'export class Store {\n  run(x) {\n    return this.moved(x);\n  }\n  moved(x) {\n    return x;\n  }\n}\n' }));
  r3.commit({ 'src/b/index.mjs': 'export const moved = (x) => x;\n', 'src/legacy.mjs': "import { moved } from './b/index.mjs';\nexport class Store {\n  run(x) {\n    return moved(x);\n  }\n}\n" });
  c = checkOwnership(r3.root, 'b', 'HEAD~1');
  assert.deepEqual(c.findings, []);
  assert.deepEqual(c.edited, []);
  assert.ok(c.added.includes('src/legacy.mjs:4  return moved(x);'), c.added.join('\n'));
});

test('ownership: onlyRemoves reads tokens, and a string literal is one token (K140)', async () => {
  const { onlyRemoves, removalEdits } = await import('../ownership.mjs');
  assert.equal(onlyRemoves('return { staled, observed };', 'return { observed };'), true);
  assert.equal(onlyRemoves('f(a,  b)', 'f(a,b)'), true);
  assert.equal(onlyRemoves('x = foo;', 'x = bar;'), false);
  assert.equal(onlyRemoves("say('abc def')", "say('abc')"), false);
  const hunk = { gone: ['const x = f(a, b);'], lines: [{ n: 1, text: 'const x = f(a);' }, { n: 2, text: 'const y = 2;' }] };
  assert.deepEqual([...removalEdits(hunk)].map((l) => l.n), [1]);
});

// ---- R6: format -------------------------------------------------------------------------------------------------

test('R6: a map entry naming no file is pending beside its module\'s live job line, and fails without one or once the layer has closed (N2-45)', () => {
  const map = edit(MODULES(), (j) => { j.modules[1].paths.push('src/b/new.mjs'); j.modules[1].tests.push('test/b/new.test.mjs'); });
  const r = repo(base({ 'build/modules.json': map }));
  // no record: the entries fail, naming the module and the entry
  assert.deepEqual(pick(checkFormat(r.root), 'key', 'module', 'field', 'path'), [['path-missing', 'b', 'paths', 'src/b/new.mjs'], ['path-missing', 'b', 'tests', 'test/b/new.test.mjs']]);
  // b's job reads WORKING (or a recorded wait) and layer 2 is open: pending, no failure
  for (const st of ['STARTING', 'WORKING', 'WAITING: Q1 to BOB']) {
    stateBranch(r, { jobs: { b: st }, layers: '1 CLOSED; 2 STARTED' });
    const f = checkFormat(r.root);
    assert.deepEqual(f.findings, [], st);
    assert.deepEqual(f.pending.map((p) => [p.key, p.module, p.path, p.job]), [['path-pending', 'b', 'src/b/new.mjs', st], ['path-pending', 'b', 'test/b/new.test.mjs', st]]);
  }
  // the layer has closed: the same entries fail
  stateBranch(r, { jobs: { b: 'WORKING' }, layers: '1 CLOSED; 2 CLOSED' });
  assert.deepEqual(keysOf(checkFormat(r.root)), ['path-missing', 'path-missing']);
  // a job that is complete, or another module's live job, does not make the entry pending
  stateBranch(r, { jobs: { b: 'COMPLETE', a: 'WORKING' }, layers: '1 CLOSED; 2 STARTED' });
  assert.deepEqual(keysOf(checkFormat(r.root)), ['path-missing', 'path-missing']);
  // a closed epoch is no record
  stateBranch(r, { jobs: { b: 'WORKING' }, layers: '2 STARTED', closed: true });
  assert.deepEqual(keysOf(checkFormat(r.root)), ['path-missing', 'path-missing']);
  // once the file is written, nothing is pending
  r.commit({ 'src/b/new.mjs': 'x\n', 'test/b/new.test.mjs': '// R1\n' });
  stateBranch(r, { jobs: { b: 'WORKING' }, layers: '2 STARTED' });
  assert.deepEqual(checkFormat(r.root).pending, []);
  assert.deepEqual(checkFormat(r.root).findings, []);
});

test('R6: every requirements file parses by requirements.parse with no finding; a Test line requirements.isMeasurement names fails (REQ-3)', () => {
  const found = (files) => pick(checkFormat(repo(base(files)).root), 'key', 'module', 'line');
  assert.deepEqual(found({}), []);
  // a statement with no id, an id given twice, a section missing: the parser's findings, keyed
  assert.deepEqual(found({ 'build/requirements/a.md': REQ('- **R1** one\n- a statement with no id\n- **R2** two') }), [['req-statement', 'a', null]]);
  assert.deepEqual(found({ 'build/requirements/a.md': REQ('- **R1** one\n- **R2** two\n- **R2** again') }), [['req-ids-twice', 'a', 12]]);
  assert.deepEqual(found({ 'build/requirements/a.md': REQ('- **R1** one\n- **R2** two').replace('### Satisfies\n', '') }), [['req-section', 'a', null]]);
  // a Test line naming a fixture above the product's size (default 100,000 rows) is a measurement, not a test
  const big = REQ('- **R1** one. Test: a 1,000,000-row fixture answers in time.\n- **R2** two. Test: a 500-row fixture.');
  assert.deepEqual(found({ 'build/requirements/a.md': big }), [['test-measurement', 'a', 11]]);
  // the product's manifest sets a larger size, and the same line is a test again
  assert.deepEqual(found({ 'build/requirements/a.md': big, 'build/manifest.md': '| fixture limit | 2,000,000 rows |\n' }), []);
  // a figure on a deployed copy is a measurement whatever its size
  assert.deepEqual(found({ 'build/requirements/a.md': REQ('- **R1** one. Test: 3 s on the deployed copy.\n- **R2** two') }), [['test-measurement', 'a', 11]]);
});

test('format: a clean build state passes', () => {
  const { root } = repo(base());
  assert.deepEqual(checkFormat(root).findings, []);
});

test('format: a doubly claimed path, a stale layer row and a bad requirements file all fail', () => {
  const m = JSON.parse(MODULES());
  m.modules[1].paths.push('src/a/');
  const { root } = repo(base({
    'build/modules.json': JSON.stringify(m),
    'build/layers.md': LAYERS.replace('| 2 | Two | b, legacy |', '| 2 | Two | b, c |'),
    'build/requirements/zz.md': '# zz\n\n- **R1** x\n- **R1** y\n',
  }));
  const f = checkFormat(root).findings;
  const has = (key, fields) => f.some((x) => x.key === key && Object.entries(fields).every(([k, v]) => JSON.stringify(x[k]) === JSON.stringify(v)));
  assert.ok(has('path-twice', { module: 'b', path: 'src/a/', other: 'a' }), JSON.stringify(f));
  assert.ok(has('layer-row', { file: 'build/layers.md', line: 4, layer: 2 }));
  assert.ok(has('req-no-module', { module: 'zz' }));
  assert.ok(has('req-section', { module: 'zz', section: '## Public' }));
  assert.ok(has('req-ids-twice', { module: 'zz', ids: ['R1'] }));
});

test('format: an entry may be listed under two modules, never twice under one', () => {
  const plan = '# Plan\n\n**a**\n- N1 · x\n- D-5 · y\n\n**b** (3 ids)\n- N1 · x\n';
  assert.deepEqual(checkFormat(repo(base({ 'build/plan/current.md': plan })).root).findings, []);
  assert.deepEqual(pick(checkFormat(repo(base({ 'build/plan/current.md': plan + '- D-5 · again\n- D-5 · twice\n' })).root), 'key', 'file', 'entries'), [['entry-twice', 'build/plan/current.md', ['D-5']]]);
});

test('format: merge-conflict markers in the build state fail, naming file and line (N440)', () => {
  const marked = '<<<<<<< HEAD\n' + LAYERS + '=======\n' + LAYERS + '>>>>>>> other\n';
  const f = checkFormat(repo(base({ 'build/layers.md': marked })).root);
  for (const line of [1, 6, 11]) assert.ok(f.findings.some((x) => x.key === 'conflict-marker' && x.file === 'build/layers.md' && x.line === line), `line ${line}`);
  assert.deepEqual(checkFormat(repo(base()).root).findings, []);
});

test('format: every paths and tests entry names a committed file or directory (K1007); an uncommitted one does not count (R10)', () => {
  const m = JSON.parse(MODULES());
  m.modules[0].tests.push('test/a-extra/');
  const pass = repo(base({ 'build/modules.json': JSON.stringify(m) }));
  mkdirSync(join(pass.root, 'test/a-extra'));
  assert.deepEqual(pick(checkFormat(pass.root), 'key', 'module', 'path'), [['path-missing', 'a', 'test/a-extra/']], 'an empty directory is not in the commit');
  const r = repo(base({ 'src/gone.mjs': 'x\n', 'build/modules.json': edit(MODULES(), (j) => { j.modules[2].paths.push('src/gone.mjs'); }) }));
  assert.deepEqual(checkFormat(r.root).findings, []);
  r.g('rm', '-q', 'src/gone.mjs'); r.g('commit', '-q', '-m', 'delete');
  assert.deepEqual(pick(checkFormat(r.root), 'key', 'module', 'field', 'path'), [['path-missing', 'legacy', 'paths', 'src/gone.mjs']]);
  r.g('rm', '-rq', 'test/b/'); r.g('commit', '-q', '-m', 'delete tests');
  assert.ok(checkFormat(r.root).findings.some((x) => x.key === 'path-missing' && x.module === 'b' && x.field === 'tests' && x.path === 'test/b/'));
});

test('format: an approval ruling after the cut-over states its standing-list decision (§16, bio K1177)', () => {
  const head = '# Rulings\n\n';
  const line = (n, text) => `- K${n} · 2026-10-02 · process · ${text} · §16, P17\n`;
  const bare = 'Bob approved, in BOB #9\'s session, archiving BOB #8 (refused by the permission check)';
  const keyed = (files, o) => pick(checkFormat(repo(base(files)).root, o), 'key', 'line', 'ruling');
  // At or before the cut-over (K1181) the history is exempt; after it, the bare approval fails.
  assert.deepEqual(keyed({ 'build/rulings.md': head + line(1181, bare) }), []);
  assert.deepEqual(keyed({ 'build/rulings.md': head + line(1181, bare) + line(1182, bare) }), [['approval-standing', 4, 'K1182']]);
  // Either decision, stated, passes.
  for (const d of ['standing list: added `mcp__claude-code-remote__archive_session`', 'standing list: not added (a one-off act at a boundary)']) {
    assert.deepEqual(keyed({ 'build/rulings.md': head + line(1182, `${bare}; ${d}`) }), [], d);
  }
  // A decision with no rule or no reason is no decision.
  for (const d of ['standing list: added', 'standing list: added archive_session', 'standing list: not added', 'standing list: not added ()']) {
    assert.deepEqual(keyed({ 'build/rulings.md': head + line(1182, `${bare}; ${d}`) }), [['approval-standing', 3, 'K1182']], d);
  }
  // Recognised by naming the permission check without citing §16; not recognised when nothing was approved (a refusal
  // still waiting on Bob) or when no refusal is cited (Bob approving a requirement).
  const noCite = '- K1183 · 2026-10-02 · UX stream · PR #8 merged; the auto-mode check flagged it and Bob approved · P17\n';
  assert.deepEqual(keyed({ 'build/rulings.md': head + noCite }), [['approval-standing', 3, 'K1183']]);
  const waiting = line(1184, 'Archiving BOB #8 was refused by the permission check; NEEDS BOB, the approval to type named');
  const req = '- K1185 · 2026-10-02 · capture · Bob approved R31 as drafted · P5\n';
  assert.deepEqual(keyed({ 'build/rulings.md': head + waiting + req }), []);
  // The cut-over is configurable.
  assert.deepEqual(keyed({ 'build/rulings.md': head + line(1182, bare) }, { approvalsLastExempt: 1182 }), []);
});

// N656 (bio K1763; P15, P17): a statement of a limit on Anthropic's accounts, plans or terms cites the register or Bob.
const TERMS = (f) => readFileSync(new URL(`./fixtures/terms/${f}`, import.meta.url), 'utf8');
const withRegister = (over = {}) => base({ 'build/terms/anthropic.md': TERMS('register.md'), ...over });
const terms = (files) => checkFormat(repo(files).root, { terms: true });

test('format: a limit on Anthropic\'s terms citing a register id passes; an uncited one fails, naming file and line (N656, K1763)', () => {
  assert.deepEqual(terms(withRegister({ 'docs/architecture/cited.md': TERMS('cited.md') })).findings, []);
  assert.deepEqual(pick(terms(withRegister({ 'docs/architecture/uncited.md': TERMS('uncited.md') })), 'key', 'file', 'line'), [['terms-uncited', 'docs/architecture/uncited.md', 4]]);
});

test('format: an AT or U id the register does not define fails (N656, K1763)', () => {
  assert.deepEqual(pick(terms(withRegister({ 'docs/architecture/missing.md': TERMS('missing-id.md') })), 'key', 'file', 'line', 'ids'), [['terms-unknown-id', 'docs/architecture/missing.md', 3, ['AT-99']]]);
});

test('format: a limit labelled Bob\'s choice with his ruling passes; the ruling alone does not (N656, K1763 (2))', () => {
  assert.deepEqual(pick(terms(withRegister({ 'build/plan/next.md': TERMS('bobs-choice.md') })), 'key', 'file', 'line'), [['terms-uncited', 'build/plan/next.md', 4]]);
});

test('format: code spans, fenced blocks and ordinary product text are not claims about the terms (N656)', () => {
  assert.deepEqual(terms(withRegister({ 'docs/architecture/product.md': TERMS('product-text.md') })).findings, []);
});

test('format: rulings are read from K1764 on; the register itself and files out of scope are not read (N656)', () => {
  const claim = 'A Team plan seat may not serve the other members of the group.';
  const rulings = `# Rulings\n\n- K1763 · 2026-10-06 · process · ${claim} · P15\n- K1764 · 2026-10-06 · process · ${claim} · P15\n`;
  assert.deepEqual(pick(terms(withRegister({ 'build/rulings.md': rulings, 'build/jobs/T1/a.md': claim, 'docs/development/x.md': claim })), 'key', 'file', 'line'), [['terms-uncited', 'build/rulings.md', 4]]);
});

test('format: the register named in the manifest is used; a product with no register skips the arm (N656)', () => {
  const uncited = { 'docs/architecture/uncited.md': TERMS('uncited.md') };
  assert.deepEqual(terms(base(uncited)).findings, [], 'no register: skipped');
  assert.equal(terms(base(uncited)).register, null);
  const manifest = '# Build manifest\n\n| what | where |\n| --- | --- |\n| what Anthropic\'s plans and terms permit or forbid | `build/legal/terms.md` |\n';
  const moved = terms(base({ ...uncited, 'build/manifest.md': manifest, 'build/legal/terms.md': TERMS('register.md') }));
  assert.deepEqual(keysOf(moved), ['terms-uncited']);
  assert.equal(moved.register, 'build/legal/terms.md');
  assert.deepEqual(terms(base({ ...uncited, 'build/manifest.md': manifest, 'build/terms/anthropic.md': TERMS('register.md') })).findings, [], 'the manifest names a register that does not exist: skipped');
  assert.deepEqual(checkFormat(repo(withRegister(uncited)).root, { terms: false }).findings, [], 'opt-in until certified (P3)');
});

// P19, rulebook PLN 2 (bio K3923): an entry of next.md names one of P19's hard reasons; current.md is not judged.
const NEXT = (...lines) => `# Next\n\n**a**\n\n${lines.join('\n')}\n`;
test('format: a next.md entry names a P19 hard reason; any other reason or none fails, naming line and id (PLN 2, P19, K3923)', () => {
  const ok = NEXT(
    "- N1 · wait · hard reason: Bob's pending decision on the name",
    '- N2 · ship · hard reason: a deployment outside the tranche',
    '- N3 · size · hard reason: A measurement outside the tranche',
    '- N4 · dns · hard reason: outside the product, the domain does not exist yet');
  assert.deepEqual(checkFormat(repo(base({ 'build/plan/next.md': ok })).root).findings, []);
  const bad = NEXT("- N1 · fine · hard reason: Bob's call", '- N2 · order · hard reason: P10 (the order)', '- N3 · nothing said');
  assert.deepEqual(pick(checkFormat(repo(base({ 'build/plan/next.md': bad })).root), 'key', 'file', 'line', 'entry'), [['next-reason', 'build/plan/next.md', 6, 'N2'], ['next-reason', 'build/plan/next.md', 7, 'N3']]);
  const cur = '# Current\n\n**a**\n\n- N9 · no reason here at all\n';
  assert.deepEqual(checkFormat(repo(base({ 'build/plan/current.md': cur })).root).findings, [], 'current.md is not judged');
});

// P19, rulebook PLN 1 (bio K5015): a line of current.md, of the running fix round's plan file it names, or of the
// handoff that defers work fails, naming file and line, unless it cites next.md.
test('format: a deferring line in current.md, the named fix-round plan or the handoff fails unless it cites next.md (PLN 1, P19, K5015)', () => {
  const found = (files) => pick(checkFormat(repo(base(files)).root), 'key', 'file', 'line');
  const cur = (...lines) => `# Current\n\n**a**\n\nSee build/plan/fix-round-9-T51.md and build/plan/archive/fix-round-1-T51.md.\n${lines.join('\n')}\n`;
  assert.deepEqual(found({ 'build/plan/current.md': cur('Clean line.', 'Waits as an entry of next.md (N5), "next fix round" in words.') }), [], 'a line citing next.md passes');
  for (const [i, phrase] of ['next fix round', 'next round', 'a later round', 'later tranche', 'deferred to'].entries()) {
    assert.deepEqual(found({ 'build/plan/current.md': cur(`- the sheet work is ${phrase} (X)`) }), [['deferral', 'build/plan/current.md', 6]], `phrase ${i}`);
  }
  assert.deepEqual(found({ 'build/plan/current.md': cur('The Next Fix Round takes it.') }).length, 1, 'case-insensitive');
  const fr = '# Fix round 9\n\nok\nThe rest goes in the next fix round.\nThis waits (next.md N7), a later tranche.\n';
  assert.deepEqual(found({ 'build/plan/current.md': cur(), 'build/plan/fix-round-9-T51.md': fr }), [['deferral', 'build/plan/fix-round-9-T51.md', 4]]);
  assert.deepEqual(found({ 'build/plan/current.md': cur(), 'build/plan/archive/fix-round-1-T51.md': fr }), [], 'an archived plan is not judged');
  assert.deepEqual(found({ 'build/plan/current.md': '# Current\n\n**a**\n', 'build/plan/fix-round-9-T51.md': fr }), [], 'a fix-round file current.md does not name is not judged');
  assert.deepEqual(found({ 'build/plan/current.md': cur(), 'build/plan/other-plan.md': fr, 'build/plan/next.md': NEXT(fr) }), [], 'no other plan file, and not next.md, is judged');
  assert.deepEqual(found({ 'build/handoff.md': '# Handoff\n\nFine.\nDeferred to the sheets job.\n' }), [['deferral', 'build/handoff.md', 4]]);
  assert.deepEqual(found({ 'build/handoff.md': '# Handoff\n\nDeferred to next.md N3.\n' }), []);
});

// P20 (Bob, K5326): a lane's report dated 2026-10-29 or later carries `Evidence:` within its entry; older entries are exempt.
test('format: a dated lane report from 2026-10-29 on without Evidence: fails, naming file and line; older, headings and other files are exempt (P20)', () => {
  const found = (files) => pick(checkFormat(repo(base(files)).root), 'key', 'file', 'line');
  const H = (...l) => `# PLATFORM: handoff\n\n## Entries\n\n${l.join('\n')}\n`;
  const P = 'build/plan/beta/platform/HANDOFF.md';
  const bad = H('**P-27 · 2026-10-28** · old, no evidence.', '**P-28 · 2026-10-29** · new, none.', 'second line of it.', '**P-29 · 2026-10-30** · fine. Evidence: `node --test` → pass 3', '**H3 · 2026-11-02** · multi-line', 'detail', 'Evidence: s1-results.md:44', '**P-30 · 2026-10-31** · none either');
  assert.deepEqual(found({ [P]: bad }), [['lane-evidence', P, 6], ['lane-evidence', P, 12]]);
  assert.deepEqual(found({ [P]: H('**P-27 · 2026-10-28** · old.', '**P-28 · 2026-10-29** · new. Evidence: a.mjs:3') }), []);
  assert.deepEqual(found({ [P]: H('**P-28 · 2026-10-29** · new.', '## Next', 'Evidence: stray under another heading') }).length, 1, 'a heading ends the entry');
  assert.deepEqual(found({ 'build/plan/beta/files/HANDOFF.md': H('**U7 · 2026-10-29** · none'), 'docs/development/investigation-design/HANDOFF.md': H('**B2 · 2026-10-29** · none') }).length, 2, 'every lane file and the investigation-design file');
  assert.deepEqual(found({ 'build/plan/other/HANDOFF.md': H('**P-28 · 2026-10-29** · none'), 'build/plan/beta/platform/NOTES.md': H('**P-28 · 2026-10-29** · none') }), [], 'no other file is judged');
});

test('format: each ruling id once; the duplicates written before the check are named exceptions (lane R17)', () => {
  const line = (n, text) => `- K${n} · 2026-10-27 · process · ${text} · P15\n`;
  assert.deepEqual(pick(checkFormat(repo(base({ 'build/rulings.md': `# Rulings\n\n${line(7, 'a')}${line(8, 'b')}${line(8, 'c')}` })).root), 'key', 'line', 'ruling'), [['ruling-twice', 5, 'K8']]);
  assert.deepEqual(checkFormat(repo(base({ 'build/rulings.md': `# Rulings\n\n${line(5349, 'a')}${line(5349, 'b')}` })).root).findings, []);
});

// ---- R7: words (the words check's own tests are words.test.mjs) ------------------------------------------------

const WORD_TABLE = { words: [{ key: 'refusal.NO_ACCESS', en: 'You cannot see that project here.' }, { key: 'screen.home.title', en: 'Home' }] };
const WORDS_CONF = { 'docs/words.json': JSON.stringify(WORD_TABLE), 'build/words.json': JSON.stringify({ table: 'docs/words.json', wordsModule: 'a' }) };

test('R7: a literal user-facing sentence in a test is a finding that names the key it lives under; the same test by key passes (N2-10)', async () => {
  const byWords = 'import assert from "node:assert/strict";\nassert.equal(out.says, "You cannot see that project here.");\n// R1\n';
  const byKey = 'import assert from "node:assert/strict";\nimport { word } from "../../src/a/index.mjs";\nassert.equal(out.says, word("refusal.NO_ACCESS"));\n// R1\n';
  const bad = await checkWords(repo(base({ ...WORDS_CONF, 'test/b/b.test.mjs': byWords })).root);
  assert.deepEqual(pick(bad, 'key', 'module', 'file', 'line', 'wordKey'), [['testcopy', 'b', 'test/b/b.test.mjs', 2, 'refusal.NO_ACCESS']]);
  assert.deepEqual((await checkWords(repo(base({ ...WORDS_CONF, 'test/b/b.test.mjs': byKey })).root)).findings, []);
  // the words check is the one place text is compared: the runner runs it where the product has a word table
  const out = await run(repo(base({ ...WORDS_CONF, 'test/b/b.test.mjs': byWords })).root, { write: false });
  assert.deepEqual(out.findings.map((f) => [f.check, f.key, f.wordKey]), [['words', 'testcopy', 'refusal.NO_ACCESS']]);
});

test('run.mjs: the words check runs where the product configures it (build/words.json); a planted inline sentence fails it, exit 1', () => {
  const words = { 'docs/development/ux-substrate/screens/words.json': JSON.stringify({ words: [{ key: 'screen.home.title', en: 'Home' }] }), 'build/words.json': JSON.stringify({ table: 'docs/development/ux-substrate/screens/words.json' }) };
  const cmd = (root) => spawnSync('node', [fileURLToPath(new URL('../run.mjs', import.meta.url)), root, '--no-fetch'], { encoding: 'utf8' });
  const bad = repo(base({ ...words, 'src/a/index.mjs': 'export const a = "Your project could not be found here.";\n' })).root;
  assert.equal(cmd(bad).status, 1);
  assert.deepEqual(readResult(bad).findings.map((f) => [f.check, f.key, f.module, f.file]), [['words', 'inline', 'a', 'src/a/index.mjs']]);
  const good = repo(base(words)).root;
  assert.equal(cmd(good).status, 0);
  assert.ok('words' in readResult(good).summaries);
  const none = repo(base()).root;
  cmd(none);
  assert.ok(!('words' in readResult(none).summaries), 'no word table: the check is skipped');
});

// ---- R8: coverage -----------------------------------------------------------------------------------------------

test('R8: every live id of a module is named by one of its tests; an id named by no test is a finding naming it', () => {
  const ids = (r) => r.findings.map((f) => [f.key, f.module, f.id, f.line]);
  const { root } = repo(base({ 'build/requirements/a.md': REQ('- **R1** one\n- **R2** two\n- **R3** three\n- **R4** four *(retired 2026-09-26)*') }));
  const r = checkCoverage(root);
  assert.deepEqual(ids(r), [['id-unnamed', 'a', 'R3', 13]]);
  assert.deepEqual(r.counts, { modules: 2, ids: 4, covered: 3, ahead: 0 });   // the retired id needs no test
  // an id in bold after a signature is an id; a plain mention is not
  assert.deepEqual(checkCoverage(repo(base({ 'build/requirements/a.md': REQ('- `f(x) → y` — **R1** one\n- **R2** two, unlike R7') })).root, ['a']).counts, { modules: 1, ids: 2, covered: 2, ahead: 0 });
  // an id named only by another module's test does not count
  assert.deepEqual(ids(checkCoverage(repo(base({ 'test/a/a.test.mjs': '// R1\n', 'test/b/b.test.mjs': '// R1 R2\n' })).root, ['a'])), [['id-unnamed', 'a', 'R2', 12]]);
});

const AHEAD = { 'build/plan/current.md': '# Plan T9\n\n**Status** · OPEN\n', 'build/requirements/a.md': REQ('- **R1** one\n- **R3** two *(not yet met: T8)*\n- **R4** four') };

test('coverage: an id marked not yet met for this tranche, its module\'s job not started, is ahead: counted, never a failure (P18)', () => {
  const r = checkCoverage(repo(base({ ...AHEAD, 'build/requirements/a.md': REQ('- **R1** one\n- **R3** two *(not yet met: T9)*') })).root, ['a']);
  assert.deepEqual(r.findings, []);
  assert.equal(r.counts.ahead, 1);
});

test('coverage: the same id fails once the module\'s job record exists; an unmarked or other-tranche id fails while ahead', () => {
  const started = repo(base({ ...AHEAD, 'build/requirements/a.md': REQ('- **R1** one\n- **R3** two *(not yet met: T9)*'), 'build/jobs/T9/a.md': '**Status** · session_01AAAAAAAAAAAAAAAAAAAAAAAA · depth 1 · WORKING\n' }));
  assert.deepEqual(checkCoverage(started.root, ['a']).findings.map((f) => f.id), ['R3']);
  const unmarked = repo(base(AHEAD));
  assert.deepEqual(checkCoverage(unmarked.root, ['a']).findings.map((f) => f.id), ['R3', 'R4']);
});

test('coverage: neoProcess\'s plan title (`# Plan: … N1`, the id last) names the tranche, and its job branch `job/<m>` counts as started (JOB-LIFE §1)', () => {
  const files = { ...AHEAD, 'build/plan/current.md': '# Plan: neoProcess dry run N1\n\n**Status** · OPEN.\n', 'build/requirements/a.md': REQ('- **R1** one\n- **R3** two *(not yet met: N1)*') };
  const ahead = repo(base(files));
  assert.deepEqual(checkCoverage(ahead.root, ['a']).findings, []);
  assert.equal(checkCoverage(ahead.root, ['a']).counts.ahead, 1);
  ahead.g('branch', 'job/a');
  assert.deepEqual(checkCoverage(ahead.root, ['a']).findings.map((f) => f.id), ['R3']);
  const other = repo(base({ ...files, 'build/plan/current.md': '# Plan: neoProcess dry run N2\n' }));
  assert.deepEqual(checkCoverage(other.root, ['a']).findings.map((f) => f.id), ['R3']);
});

// ---- R9: fixtures -----------------------------------------------------------------------------------------------

test('R9: no test hand-builds another module\'s answer or words: the fixtures check as it stood at the START, its findings keyed by class', () => {
  const files = base({
    'src/a/index.mjs': 'export function give() { return { ok: false, reason: "A_REFUSED" }; }\n',
    'test/b/b.test.mjs': '// R1\nconst answer = { ok: false, reason: "A_REFUSED", detail: 1 };\nfunction fakeStore() { return {}; }\nimport assert from "node:assert/strict";\nassert.equal(out.reason, "NO_SUCH_CODE");\n',
  });
  const r = checkFixtures(repo(files).root);
  assert.deepEqual(pick(r, 'key', 'module', 'file', 'line', 'tag'), [['answer', 'b', 'test/b/b.test.mjs', 2, 'refusal'], ['code', 'b', 'test/b/b.test.mjs', 5, null], ['stub', 'b', 'test/b/b.test.mjs', 3, 'decl']]);
  assert.deepEqual(r.findings[0].providers, ['a']);
  // a test of the module's own answer is not hand-building another's
  assert.deepEqual(checkFixtures(repo(base({ 'src/b/index.mjs': 'export const own = () => ({ ok: false, reason: "B_OWN" });\n', 'test/b/b.test.mjs': '// R1\nconst own = { ok: false, reason: "B_OWN" };\n' })).root).findings, []);
  // the runner runs it, whole and scoped
  assert.ok(checkFixtures(repo(files).root, ['a']).findings.length === 0);
});

// ---- R10: a commit and nothing else -----------------------------------------------------------------------------

test('R10: a check reads code and record files at a commit: never the working tree\'s uncommitted state, never the network; the same commit gives the same findings', async () => {
  const r = repo(base());
  const head = r.g('rev-parse', 'HEAD').trim();
  const clean = await run(r.root, { write: false });
  // uncommitted changes, tracked and untracked, are not read
  r.write({ 'stray.mjs': 'x\n', 'src/a/index.mjs': "import { b } from '../b/index.mjs';\n", 'build/requirements/a.md': REQ('- **R1** one\n- **R2** two\n- **R9** nine'), 'build/modules.json': '{ not json' });
  const dirty = await run(r.root, { write: false });
  assert.deepEqual(dirty.findings, clean.findings);
  assert.deepEqual(dirty.findings, []);
  assert.equal(dirty.commit, head);
  // committed, the same changes are read; and the earlier commit still gives its own findings
  r.write({ 'build/modules.json': MODULES() });
  r.g('add', '-A'); r.g('commit', '-q', '-m', 'next');
  assert.deepEqual((await run(r.root, { write: false })).findings.map((f) => f.key).sort(), ['id-unnamed', 'later-import', 'unowned']);
  assert.deepEqual((await run(r.root, { ref: head, write: false })).findings, []);
  assert.deepEqual(snapshot(r.root, { ref: head }).read('stray.mjs'), null);
  // the network: a check never fetches; a branch moved on the remote is read only after the runner's refresh
  const remote = join(mkdtempSync(join(tmpdir(), 'remote-')), 'origin.git');
  execFileSync('git', ['clone', '-q', '--bare', r.root, remote]);
  r.g('remote', 'add', 'origin', remote);
  r.g('fetch', '-q', 'origin');
  const before = r.g('rev-parse', 'origin/main').trim();
  const other = mkdtempSync(join(tmpdir(), 'other-'));
  execFileSync('git', ['clone', '-q', remote, other]);
  execFileSync('git', ['-C', other, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'moved']);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:main']);
  checkFormat(r.root); checkCoverage(r.root); checkArchitecture(r.root); checkFixtures(r.root); checkChannels(r.root);
  await checkWords(r.root);
  assert.equal(r.g('rev-parse', 'origin/main').trim(), before, 'no check fetched');
});

// ---- R11: the checks' own tests name findings by key ------------------------------------------------------------

test('R11: every finding of every check carries its key, module, file and line, and the checks\' tests assert on those, never on a printed sentence', async () => {
  const r = repo(base({ 'stray.mjs': 'x\n', 'src/a/index.mjs': "import { b } from '../b/index.mjs';\n", 'build/requirements/a.md': REQ('- **R1** one\n- **R2** two\n- **R3** three'), 'build/layers.md': `${LAYERS}<<<<<<< x\n`, ...WORDS_CONF, 'test/b/b.test.mjs': '// R1\nconst x = "You cannot see that project here.";\nconst answer = { ok: false, reason: "SOME_CODE", detail: 1 };\n' }));
  r.commit({ 'src/legacy.mjs': 'export const more = 1;\n' });
  const all = [...(await run(r.root, { write: false })).findings, ...checkOwnership(r.root, 'b', 'HEAD~1').findings];
  assert.deepEqual([...new Set(all.map((f) => f.check))].sort(), ['architecture', 'coverage', 'fixtures', 'format', 'ownership', 'words']);
  for (const f of all) {
    assert.match(f.key, /^[a-z][a-z-]*$/, JSON.stringify(f));
    for (const k of ['check', 'module', 'file', 'line', 'finding']) assert.ok(k in f, `${k} in ${JSON.stringify(f)}`);
    assert.ok(f.line === null || Number.isInteger(f.line));
  }
  // the module's test files assert on findings, never on the failure sentences
  for (const t of ['checks.test.mjs', 'channels.test.mjs', 'words.test.mjs']) {
    const src = readFileSync(new URL(`./${t}`, import.meta.url), 'utf8').replace(/\/\/[^\n]*|'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, '');
    assert.doesNotMatch(src, new RegExp(['\\.fail' + 'ures\\b', '\\.summ' + 'ary\\b'].join('|')), t);
  }
});
