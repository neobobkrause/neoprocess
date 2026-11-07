// The one runner of the checks (build/requirements/architecture.md R2, R3; ARC-4, ARC-5, GAT-7; N2-11, N2-12).
// `run(R, { module })` runs every check scoped to the module named, or whole over the product when none is named: one
// function, one switch; the layer-close run is the whole-product run. Whole: format, architecture, coverage, fixtures,
// channels where the product has a registry `build/channels.md`, and words where the product configures it
// (`build/words.json`; rulebook BLD 5). Scoped to a module: format's findings about that module or about no module (a
// pending map entry is never a failure), architecture, coverage, fixtures and words over the module's files, channels
// (product-level, as in the whole run), and ownership when a base is given (the job's diff against it, its added legacy
// lines listed in the result; with no base given, the tranche's, and with no tranche ownership is a `not-run` finding). It prints each check's failures and summary line, as the
// checks always have, and writes one machine-readable result (each finding's check, key, module, file and line, R3) at
// the path the manifest names (a `build/manifest.md` row naming the checks' result, default `checks/result.json`), which
// the gate and `status` read through `readResult`.
// The checks read the product at a commit (R10). Refreshing the record they read (the epoch's state branch for the
// format check's pending entries, the mail branches for the channels check) is the runner's, and only when asked
// (`fetch`; the command does unless `--no-fetch`).
// Usage: node checks/run.mjs <product-root> [--module <m>] [--base <ref>] [--ref <ref>] [--no-fetch]
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, TRANCHE } from '../tools/record.mjs';
import { snapshot, report } from './lib.mjs';
import { checkArchitecture } from './architecture.mjs';
import { checkCoverage } from './coverage.mjs';
import { checkFormat } from './format.mjs';
import { checkChannels, refreshChannels } from './channels.mjs';
import { checkWords, WORDS_CONFIG } from './words.mjs';
import { checkFixtures } from './fixtures.mjs';
import { checkOwnership } from './ownership.mjs';

export const RESULT_DEFAULT = 'checks/result.json';
// The manifest's row for the result: its first cell names the checks' result, its first code span the path.
export function resultPath(root) {
  for (const line of (snapshot(root).read('build/manifest.md') || '').split('\n')) {
    if (!/^\|/.test(line) || !/\bchecks?'? (?:machine-readable )?result\b/i.test(line.split('|')[1] || '')) continue;
    const m = line.match(/`([^`\s]+)`/);
    if (m) return m[1];
  }
  return RESULT_DEFAULT;
}

// The runner's refresh of the record the checks read: the epoch's state branches and the mail branches, from origin.
export function refresh(R) {
  const fresh = [];
  try { if (!R.g(['remote']).split('\n').includes('origin')) return fresh; } catch { return fresh; }
  R.fetch(...R.heads('refs/heads/state/*'));
  fresh.push(...refreshChannels(R).findings);
  return fresh;
}

export async function run(R = '.', { module = null, base = null, ref = 'HEAD', fetch = false, write = true, print = false } = {}) {
  const Rp = typeof R === 'string' ? repo(R) : R;
  const fresh = fetch ? refresh(Rp) : [];
  const S = snapshot(Rp, { ref });
  const only = module ? [module] : [];
  const checks = [
    ['format', () => checkFormat(S)],
    ['architecture', () => checkArchitecture(S, only)],
    ['coverage', () => checkCoverage(S, only)],
    ['fixtures', () => checkFixtures(S, only)],
  ];
  if (S.read('build/channels.md') !== null) checks.push(['channels', () => checkChannels(S)]);   // product-level: in every run
  if (S.read(WORDS_CONFIG) !== null) checks.push(['words', () => checkWords(S, only)]);
  // A scoped run is the job's gate run, so ownership always runs in it: against the base given, else the tranche's (origin's
  // ref first, as the gate's merge base reads it); with neither, ownership is a finding of its own, not run, never a silent pass (R2).
  let own = null;
  if (module) {
    own = base || [`origin/${TRANCHE}`, TRANCHE].find((b) => S.q(['rev-parse', '--verify', '-q', `${b}^{commit}`]) !== null) || null;
    checks.push(['ownership', () => (own ? checkOwnership(S, module, own, ref) : { findings: [{ check: 'ownership', key: 'not-run', module, file: null, line: null, finding: `ownership: not run for ${module}: no base was given and the product has no ${TRANCHE} branch` }], failures: [], added: [], edited: [], summary: 'not run' })]);
  }
  const findings = [], pending = [], summaries = {}, lines = [];
  let listed = null;   // ownership's added and edited legacy lines, listed for the architecture session's reading (R5)
  for (const [name, fn] of checks) {
    const r = await fn();
    let found = r.findings;
    if (name === 'channels') found = [...fresh, ...found];
    if (name === 'format' && module) found = found.filter((f) => f.module === null || f.module === module);
    findings.push(...found);
    pending.push(...(r.pending || []).filter((p) => !module || p.module === module));
    summaries[name] = r.summary;
    if (name === 'ownership') listed = { added: r.added, edited: r.edited };
    const failures = name === 'coverage' ? r.failures.filter((t) => found.some((f) => f.finding === t)) : [...new Set(found.map((f) => f.finding))];
    for (const t of failures) lines.push(`FAIL  ${t}`);
    lines.push(`${name}: ${r.summary}; ${failures.length} failure${failures.length === 1 ? '' : 's'}`);
    if (print) { if (name === 'ownership') { for (const a of r.added) console.log(`ADDED ${a}`); for (const e of r.edited) console.log(`EDITED ${e}  (only removes from the line it replaces: a removal)`); } report(name, failures, r.summary); }
  }
  const result = { commit: S.commit, ref, module, base: own ?? base, ok: findings.length === 0, findings, pending, summaries, ...(listed ? { listed } : {}) };
  if (write) {
    const out = join(Rp.dir, resultPath(S));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
    result.path = resultPath(S);
  }
  return { ...result, text: `${lines.join('\n')}\n` };
}

// The result the last run wrote, for the gate and `status` (R3): null when none is there or it does not parse.
export function readResult(root = '.') {
  const R = typeof root === 'string' ? repo(root) : root;
  const f = join(R.dir, resultPath(R));
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
  const root = args.find((a, i) => !a.startsWith('--') && !['--module', '--base', '--ref'].includes(args[i - 1])) || '.';
  const r = await run(root, { module: opt('module'), base: opt('base'), ref: opt('ref') || 'HEAD', fetch: !args.includes('--no-fetch'), print: true });
  process.exitCode = r.ok ? 0 : 1;
}
