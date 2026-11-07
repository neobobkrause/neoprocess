// gate: the CI gate on a pull request (build/requirements/gate.md; REQUIREMENTS.md §8, GAT-1 to GAT-8; plan N2-23 to N2-26).
// The module's own suite and the checks scoped to it, against the pull request's base, a red the base already had
// inherited and named; the artifacts regenerated and only the changed ones verified; the workflow that runs it, triggered
// only by what the gate reads and never by a record path; the full regression as its own workflow, dispatched only by the
// tranche's close for a release or on Bob's word. A change to a provided service reaches its users through the
// architecture session's notice and each user's own job (R8): no user's suite is run here.
// Extracted from tools/proc.mjs (`runGate`, `gateCmd`, `moduleOfDiff`, `gateNeutral`, the gate workflow of `shims`).
// Usage (CI): node tools/gate.mjs [gate] --product <dir> [--base <ref>] [--module <m>]
//             node tools/gate.mjs regression --product <dir>
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROCESS, limits, processRepo } from './platform.mjs';
import { repo, refuse, TRANCHE, paths as recordPaths, ghRepo } from './record.mjs';
import { modules as orderedModules } from '../checks/architecture.mjs';
import { readResult, resultPath } from '../checks/run.mjs';
import { snapshot, artifactRows } from '../checks/lib.mjs';

export const TEMPLATE = join(PROCESS, 'tools/gate.yml.tmpl');
export const REGRESSION_WORKFLOW = 'regression.yml';
// The reasons the full regression is dispatched for (GAT-8): the tranche's close for a release, or Bob's word.
export const REGRESSION_REASONS = ['release', 'bob'];
// Minutes the regression workflow may run: its own budget, apart from the gate's and from any session's.
export const REGRESSION_MINUTES = 180;
// The lock files installed where they sit (GAT-5), each with its install command.
export const LOCKS = { 'package-lock.json': 'npm ci', 'npm-shrinkwrap.json': 'npm ci', 'yarn.lock': 'yarn install --frozen-lockfile', 'pnpm-lock.yaml': 'pnpm install --frozen-lockfile' };
// The product's Node version files, in the order read (setup-node reads each form).
export const NODE_FILES = ['.nvmrc', '.node-version', '.tool-versions', 'package.json'];
export const NODE_DEFAULT = '22';
// The build-state files the gate reads for every module (the map, the layers, the manifest, the words and ops tables).
const GATE_READS = ['build/modules.json', 'build/layers.md', 'build/manifest.md', 'build/words.json', 'build/ops.json', 'build/channels.md', 'build/requirements/README.md'];

const under = (f, p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`);
export const inCI = () => process.env.GITHUB_ACTIONS === 'true';
// A record path (REC-1, REC-4): a durable path of `record.paths()`, or anywhere in the build state (P2: `build/` is the
// process's record in the product).
export const isRecordPath = (f) => under(f, 'build/') || recordPaths().durable.some((p) => under(f, p));
const mods = (R, ref = 'HEAD') => orderedModules(snapshot(R, { ref })).modules;
const mod = (R, m, ref) => mods(R, ref).find((x) => x.id === m) ?? refuse(`no module ${m} in build/modules.json`);

// ---- artifacts (R2; GAT-4) ----

// The manifest's generated artifacts at HEAD; a "Generated artifacts" section with no row in the table's form is refused.
export function artifacts(R, ref = 'HEAD') {
  const text = snapshot(R, { ref }).read('build/manifest.md') || '';
  const rows = artifactRows(text);
  if (!rows.length && /^## Generated artifacts/m.test(text)) refuse('build/manifest.md has a Generated artifacts section but no row `| `<path>` | <owner> | `<regenerate>` | `<verify>` |` (PRODUCT-SUPPLIES)');
  return rows;
}
const sh = (R, c) => spawnSync('sh', ['-c', c], { cwd: R.dir, encoding: 'utf8' });
const moved = (R, ps) => (ps.length ? R.raw(['status', '--porcelain', '--untracked-files=all', '--', ...ps.map(R.rel)]).split('\n').filter(Boolean).map((l) => l.slice(3)) : []);
// Regenerates every artifact the manifest lists, then verifies only those the regeneration changed against HEAD; a
// regeneration that exits non-zero is named by its artifact (`failed`).
// { changed: [path], verified: [path], stale: [path], failed: [path] }. The working tree keeps the regenerated files; `restore` puts them back.
export function regenerate(R) {
  const rows = artifacts(R), failed = [];
  for (const a of rows) if (sh(R, a.regen).status !== 0) failed.push(...a.paths);
  const changed = [], verified = [], stale = [];
  for (const a of rows) {
    const c = a.paths.filter((p) => moved(R, [p]).length);
    if (!c.length) continue;
    changed.push(...c); verified.push(...a.paths);
    if (sh(R, a.verify).status !== 0) stale.push(...a.paths);
  }
  return { changed, verified, stale, failed };
}
// Every artifact path put back as HEAD has it (a file HEAD lacks is removed).
export function restore(R) {
  const paths = artifacts(R).flatMap((a) => a.paths);
  const files = moved(R, paths);
  const tracked = files.filter((f) => spawnSync('git', ['-C', R.root, 'cat-file', '-e', `HEAD:${f}`]).status === 0);
  if (tracked.length) R.g(['checkout', '-q', 'HEAD', '--', ...tracked]);
  for (const f of files.filter((x) => !tracked.includes(x))) rmSync(join(R.root, f), { recursive: true, force: true });
}

// ---- the module's own suite (R1) ----

// The module's test files at `ref`, product-relative.
export function testFiles(R, m, ref = 'HEAD') {
  const S = snapshot(R, { ref }), x = mods(R, ref).find((y) => y.id === m);
  if (!x) return [];
  return S.files.filter((f) => f.endsWith('.test.mjs') && (x.tests || []).some((p) => under(f, p)));
}
// One `node --test` run of the files, from the product's directory: totals, the failed tests by name, and the results it
// could not get, each with its cause (a run cut short, or past the platform's background limit).
export function suite(R, files) {
  const empty = { tests: 0, pass: 0, fail: 0, failed: [], noResult: [] };
  if (!files.length) return empty;
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const min = limits().backgroundMinutes;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: R.dir, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: min * 60000 });
  const text = r.stdout || '';
  const n = (k) => Number(text.match(new RegExp(`^# ${k} (\\d+)$`, 'm'))?.[1] ?? NaN);
  const failed = [...new Set([...text.matchAll(/^\s*not ok \d+ - (.+?)(?: # .*)?$/gm)].map((x) => x[1].trim()))];
  const out = { tests: n('tests'), pass: n('pass'), fail: n('fail'), failed, noResult: [] };
  const tail = `${text}\n${r.stderr || ''}`.trim().split('\n').filter((l) => l.trim()).slice(-3).join(' | ').slice(0, 300);
  if (r.error?.code === 'ETIMEDOUT') out.noResult.push({ name: 'the whole suite', cause: `timed out after ${min} min` });
  else if (r.signal) out.noResult.push({ name: 'the whole suite', cause: `the runner was killed (${r.signal})` });
  else if (Number.isNaN(out.tests)) out.noResult.push({ name: 'the whole suite', cause: `no summary, exit ${r.status}; its tail: ${tail}` });
  for (const k of ['tests', 'pass', 'fail']) if (Number.isNaN(out[k])) out[k] = 0;
  return out;
}
// What a run did not pass, by name: the failed tests and the results it could not get.
export const reds = (t) => [...(t.failed || []), ...(t.noResult || []).map((x) => `NO RESULT ${x.name}`)];

// ---- the checks scoped to the module (R1, R6; GAT-7) ----

// A finding's place, from the checks' result file: `<check>: <finding> [<module> <file>:<line>]`.
export const place = (f) => `${f.module ?? '-'} ${f.file ?? '-'}${f.line ? `:${f.line}` : ''}`;
// A finding compared across commits without its line numbers, so a finding that only moved is the same finding.
const same = (f) => `${f.check}|${f.key ?? ''}|${f.file ?? ''}|${String(f.finding).replace(/:\d+(?::\d+)?\b/g, '')}`;
// The checks scoped to the module, run by the architecture module's runner at `ref` (a commit: R10), and their findings
// read from its one result file (`readResult`), never from its log. The result file is left as the run wrote it when
// `keep` (CI's run, for the merge and `status` to read), else put back as it was found (the checkout is left as it was).
export function checks(R, m, base, ref = 'HEAD', { keep = false } = {}) {
  const file = join(R.dir, resultPath(R)), before = existsSync(file) ? readFileSync(file) : null;
  const r = spawnSync(process.execPath, [join(PROCESS, 'checks/run.mjs'), R.dir, '--module', m, '--base', base, '--ref', ref, '--no-fetch'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const result = readResult(R);
  if (!keep) { if (before === null) rmSync(file, { force: true }); else { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, before); } }
  if (!result || result.commit !== R.g(['rev-parse', `${ref}^{commit}`])) {
    const tail = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').pop();
    return { names: [], findings: [{ check: 'checks', key: 'no-result', module: m, file: resultPath(R), line: null, finding: `the checks wrote no result for ${ref} (exit ${r.status}): ${tail}` }] };
  }
  return { names: Object.keys(result.summaries || {}), findings: result.findings || [] };
}

// ---- the gate (R1, R6, R9; GAT-1, GAT-2, GAT-7) ----

// Runs `fn` with the checkout at `ref`, detached, and puts it back. Only on a clean checkout.
function at(R, ref, fn) {
  const back = R.branch(), head = R.g(['rev-parse', 'HEAD']);
  R.g(['checkout', '-q', '--detach', ref]);
  try { return fn(); } finally { R.g(['checkout', '-q', back === 'HEAD' ? head : back]); }
}
// The gate on the checkout's HEAD against `base` (the pull request's base): the artifacts regenerated and only the changed
// ones verified; the module's own suite; the checks scoped to the module (ownership against the base among them). A test
// or a finding the base already had is inherited and named, never a failure; a new one fails. No other module's suite runs,
// and no layer's tests. Nothing is committed, and the checkout is left as it was.
// `keep` leaves the checks' result file for the merge and `status` (CI's run).
// → { fails: [text], tests, checks: [name], findings: [finding], inherited: { tests, findings }, artifacts, ci }
export function runGate(R, m, base, { keep = false } = {}) {
  mod(R, m);
  if (R.g(['status', '--porcelain', '--untracked-files=no'])) refuse('the checkout has uncommitted changes: the gate measures commits');
  const fails = [];
  let art, tests;
  try {
    art = regenerate(R);
    tests = suite(R, testFiles(R, m));
  } finally { restore(R); }
  if (art.failed.length) fails.push(`artifacts: regeneration failed: ${art.failed.join(', ')}`);
  if (art.stale.length) fails.push(`artifacts: regenerated but not verified: ${art.stale.join(', ')}`);
  const ck = checks(R, m, base, 'HEAD', { keep });
  const red = reds(tests);
  const old = red.length ? at(R, base, () => { try { regenerate(R); return reds(suite(R, testFiles(R, m))); } finally { restore(R); } }) : [];
  const was = ck.findings.length ? new Set(checks(R, m, base, base).findings.map(same)) : new Set();
  const newReds = red.filter((n) => !old.includes(n)), oldReds = red.filter((n) => old.includes(n));
  if (!tests.tests && !tests.noResult.length) fails.push('tests: none ran');
  else if (newReds.length || (tests.fail && !red.length)) fails.push(`tests: ${tests.pass}/${tests.tests} pass; new reds: ${newReds.join('; ') || 'unnamed'}`);
  const newFindings = ck.findings.filter((f) => !was.has(same(f))), oldFindings = ck.findings.filter((f) => was.has(same(f)));
  fails.push(...newFindings.map((f) => `${f.check}: ${f.finding} [${place(f)}]`));
  return { fails, tests, checks: ck.names.filter((c) => c !== 'ownership'), findings: ck.findings, inherited: { tests: oldReds, findings: oldFindings }, artifacts: art, ci: inCI() };
}

// ---- the module of a diff (R4; K2) ----

// The module a diff belongs to: exactly one module's paths, tests or requirements file (one job, one module; P8); a
// touched module named in another touched module's `from` is that module's source, not a second module.
export function moduleOfDiff(R, base) {
  const gen = artifacts(R).flatMap((a) => a.paths);
  const files = R.g(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean).map((f) => relative(R.rel('.'), f)).filter((f) => !gen.includes(f));
  const all = mods(R);
  const owner = (f) => all.find((x) => [...(x.paths || []), ...(x.tests || [])].some((p) => under(f, p)) || f === `build/requirements/${x.id}.md`)?.id;
  const touched = [...new Set(files.map(owner).filter(Boolean))];
  if (!files.length) return null;   // the job's opening commit: nothing to check yet
  if (!touched.length) refuse(`no module's files changed since ${base.slice(0, 7)}: ${files.join(', ')}`);
  const from = (id) => [].concat(all.find((x) => x.id === id)?.from || []);
  const ids = touched.filter((id) => !touched.some((o) => o !== id && from(o).includes(id)));
  if (ids.length > 1) refuse(`the diff touches several modules: ${ids.join(', ')} (one job, one module; P8)`);
  return ids[0];
}

// ---- the hand form (R9) ----

// The gate on this checkout against the base, the module read from the diff when none is named. In a session it is a
// check of what CI will do, never a merge's evidence: `evidence` is true only in CI. In CI the checks' result file is kept
// for the merge and `status` to read (`keep`, by default there and nowhere else).
export function gateCheck(o) {
  const R = repo(o.product);
  let base;
  if (o.base) { try { base = R.g(['rev-parse', '--verify', `${o.base}^{commit}`]); } catch { refuse(`--base ${o.base}: not a commit this checkout sees`); } }
  else {
    R.fetch(TRANCHE);
    try { base = R.g(['merge-base', `origin/${TRANCHE}`, 'HEAD']); } catch { refuse(`no common history with ${TRANCHE}: --base <ref>`); }
  }
  const m = o.module || moduleOfDiff(R, base), evidence = inCI();
  if (!m) return { ok: true, module: null, base: base.slice(0, 7), fails: [], note: 'nothing changed since the base: the job\'s opening commit', tests: { pass: 0, tests: 0 }, checks: [], findings: [], inherited: { tests: [], findings: [] }, evidence };
  const r = runGate(R, m, base, { keep: o.keep ?? inCI() });
  return { ok: !r.fails.length, module: m, base: base.slice(0, 7), fails: r.fails, tests: { pass: r.tests.pass, tests: r.tests.tests }, checks: r.checks, findings: r.findings, inherited: r.inherited, evidence, ...(evidence ? {} : { note: 'a check of what CI will do, never a merge\'s evidence (GAT-1)' }) };
}

// ---- a green tip behind the tranche (R5; issue 86) ----

// The files the tranche changed since the tip's base, and those that hold the merge for the gate to run again (`held`,
// each with why): any file that is no record path, a module's code or tests, a generated artifact, a record the gate
// reads for the module (the map, the layers, the manifest, the tables, its own and its used modules' requirements), and
// its task summary. A tip whose base differs from the tranche only by other record paths merges as it stands.
export function gateNeutral(R, m, head) {
  const x = mod(R, m), all = mods(R), base = R.g(['merge-base', head, `origin/${TRANCHE}`]);
  const near = [m, ...(x.uses || []).filter((u) => !u.startsWith('*'))];
  const read = new Set([...GATE_READS, ...near.map((k) => `build/requirements/${k}.md`)]);
  const code = all.flatMap((y) => [...(y.paths || []), ...(y.tests || [])]), gen = artifacts(R).flatMap((a) => a.paths);
  const why = (f) => (code.some((p) => under(f, p)) ? "a module's code or tests" : gen.includes(f) ? 'a generated artifact' : read.has(f) ? `read by the gate for ${m}` : f.split('/')[1] === 'summaries' && f.endsWith(`/${m}.md`) ? `${m}'s task summary` : !isRecordPath(f) ? 'outside build/' : null);
  const files = R.g(['diff', '--name-only', base, `origin/${TRANCHE}`]).split('\n').filter(Boolean).map((f) => relative(R.rel('.'), f));
  return { files, held: files.map((f) => ({ file: f, why: why(f) })).filter((h) => h.why) };
}

// ---- the workflows (R3, R5, R7; GAT-5, GAT-6, GAT-8) ----

// The lock files the product has, each installed where it sits, and its Node version file (R3).
export function installs(R) {
  const S = snapshot(R);
  const locks = S.files.filter((f) => f.split('/').pop() in LOCKS && !f.split('/').includes('node_modules')).map((f) => ({ file: f, dir: dirname(f), run: LOCKS[f.split('/').pop()] }));
  const names = { 'package.json': (t) => !!JSON.parse(t || '{}').engines?.node, '.tool-versions': (t) => /^nodejs\s+\S/m.test(t || '') };
  const node = NODE_FILES.find((f) => S.has(f) && (!names[f] || names[f](S.read(f)))) ?? null;
  return { locks, node };
}
// The paths that trigger the gate (R5): every module's paths and tests and the generated artifacts; then every record
// path of `record.paths()` excluded; then, last, the files the checks read for a module (the tables GATE_READS names and
// each module's requirements file), even where they sit among the records. GitHub's filter takes the last pattern a file
// matches, so a record write triggers the gate only where the checks read it. Product-relative, as patterns from the
// repository's root.
export function triggers(R) {
  const S = snapshot(R), at = (p) => (S.prefix === '.' ? p : `${S.prefix}/${p}`), glob = (p) => (p.endsWith('/') ? `${at(p)}**` : at(p));
  const all = mods(R);
  const on = [...all.flatMap((y) => [...(y.paths || []), ...(y.tests || [])]), ...artifacts(R).flatMap((a) => a.paths)];
  const read = [...GATE_READS, ...all.map((y) => `build/requirements/${y.id}.md`)];
  return { paths: [...new Set(on.map(glob))], ignored: [...new Set(recordPaths().durable.map(glob))], read: [...new Set(read.map(glob))] };
}
const template = () => readFileSync(TEMPLATE, 'utf8').split(/^# ==== regression ====\n/m);
const fill = (text, vals) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vals ? vals[k] : refuse(`the gate template names {{${k}}}, which has no value`)));
// The values both workflows share: the process's checkout (none when the product is the process), the Node step, the installs.
function common(R, o = {}) {
  const S = snapshot(R), P = o.process || processRepo(), self = `${P.owner}/${P.repo}`.toLowerCase() === `${ghRepo(R).owner}/${ghRepo(R).repo}`.toLowerCase();
  const { locks, node } = installs(R), at = (p) => (S.prefix === '.' ? p : `${S.prefix}/${p}`);
  return {
    TRANCHE,
    PRODUCT: S.prefix,
    RESULT: at(resultPath(R)),
    PROC: self ? '.' : '.neoprocess',
    PROCESS_CHECKOUT: self ? '' : `      - uses: actions/checkout@v4\n        with:\n          repository: ${P.owner}/${P.repo}\n          ref: ${o.ref || 'main'}\n          path: .neoprocess\n`,
    NODE: node ? `node-version-file: ${at(node)}` : `node-version: ${NODE_DEFAULT}`,
    INSTALL: locks.map((l) => `      - name: install ${at(l.file)}\n        working-directory: ${l.dir === '.' ? S.prefix : at(l.dir)}\n        run: ${l.run}\n`).join(''),
  };
}
// The product's gate workflow, rendered from tools/gate.yml.tmpl (R5, R3).
export function workflow(R, o = {}) {
  const t = triggers(R), list = (xs) => xs.map((p) => `      - '${p}'`).join('\n');
  return fill(template()[0], { ...common(R, o), PATHS: list([...t.paths, ...t.ignored.map((p) => `!${p}`), ...t.read]) });
}
// The full regression's workflow, its own time budget, run on the runner only (R7).
export function regressionWorkflow(R, o = {}) {
  return fill(template()[1], { ...common(R, o), MINUTES: String(REGRESSION_MINUTES), WORKFLOW: REGRESSION_WORKFLOW });
}
// The dispatch of the full regression (R7): only for the tranche's close of a release or on Bob's word; the call is the
// platform's `actions_run_trigger` of the product's regression workflow on `main`, testing the branch named.
export function regression(R, o = {}) {
  if (!REGRESSION_REASONS.includes(o.why)) refuse(`the full regression is dispatched only for ${REGRESSION_REASONS.map((r) => `"${r}"`).join(' or ')} (the tranche's close for a release, or Bob's word; GAT-8), not ${o.why ?? 'none'}`);
  return { tool: 'actions_run_trigger', ...ghRepo(R), workflow_id: REGRESSION_WORKFLOW, ref: 'main', inputs: { ref: o.ref || TRANCHE, why: o.why } };
}
// The regression's run (on the runner only, never in a session): every module's suite and the checks whole.
export function runRegression(R) {
  if (!inCI()) refuse(`the full regression runs in its own workflow, never in a session (GAT-8; a session's background limit is ${limits().backgroundMinutes} minutes)`);
  const fails = [];
  for (const x of mods(R)) {
    const t = suite(R, testFiles(R, x.id));
    if (reds(t).length) fails.push(`${x.id}: ${t.pass}/${t.tests} pass; reds: ${reds(t).join('; ')}`);
  }
  const r = spawnSync(process.execPath, [join(PROCESS, 'checks/run.mjs'), R.dir, '--no-fetch'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  fails.push(...(readResult(R)?.findings || (r.status ? [{ check: 'checks', finding: 'no result' }] : [])).map((f) => `${f.check}: ${f.finding}${f.file ? ` [${place(f)}]` : ''}`));
  return { ok: !fails.length, fails };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'gate';
  try {
    const out = cmd === 'regression' ? runRegression(repo(opt('product') || '.')) : gateCheck({ product: opt('product') || '.', base: opt('base'), module: opt('module'), keep: inCI() });
    console.log(JSON.stringify(out, null, 1));
    process.exitCode = out.ok ? 0 : 1;
  } catch (e) { console.error(`REFUSED: ${e.message}`); process.exitCode = 1; }
}
