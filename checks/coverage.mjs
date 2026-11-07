// Check 2, coverage (rulebooks BLD 5, INT 2; P7; build/requirements/architecture.md R8): every live requirement id of a
// module is named by at least one of that module's tests. A test names an id by writing it as a word (`R12`) anywhere in a
// file under the module's `tests` paths, conventionally in the test's title. A test that cannot fail will not count once
// the cannot-fail check exists (INT 2, planned); until then every naming test counts.
// Usage: node checks/coverage.mjs <product-root> [module ...]
import { pathToFileURL } from 'node:url';
import { snapshot, readModules, pathMatches, requirementIds, requirementFiles, finder, report } from './lib.mjs';

// The tranche the plan names: `# Plan T<n>` (mechanics), or `# Plan: … N<n>` with the id last (neoProcess, JOB-LIFE §1); or null.
function planTranche(S) {
  const title = (S.read('build/plan/current.md') || '').match(/^# Plan(:?) (.*)$/m);
  if (!title) return null;
  return title[1] ? title[2].match(/\b([A-Z]+\d+[a-z]?)\s*$/)?.[1] ?? null : title[2].split(/\s+/)[0];
}
// A module's job for the tranche has started: its record is in the commit, or its job branch exists (local or origin):
// `job/<T>/<m>` under the mechanics, `job/<m>` under neoProcess (one job per module, JOB-LIFE §1).
function jobStarted(S, T, m) {
  if (S.has(`build/jobs/${T}/${m}.md`)) return true;
  return [`refs/heads/job/${T}/${m}`, `refs/remotes/origin/job/${T}/${m}`, `refs/heads/job/${m}`, `refs/remotes/origin/job/${m}`].some((r) => S.q(['rev-parse', '--verify', '-q', r]) !== null);
}

export function checkCoverage(root, only = []) {
  const S = snapshot(root);
  const state = readModules(S);
  const { findings, add } = finder('coverage');
  let modules = 0, ids = 0, covered = 0, ahead = 0;
  const T = planTranche(S);
  for (const id of requirementFiles(S)) {
    if (only.length && !only.includes(id)) continue;
    const m = state.modules.find((x) => x.id === id);
    if (!m) continue; // the format check reports a requirements file with no module
    modules++;
    const file = `build/requirements/${id}.md`;
    const text = S.read(file) || '';
    const { live } = requirementIds(text);
    // P18: an id marked `*(not yet met: <T>)*` for this tranche, in a module whose job has not started, is written ahead: counted, never a failure.
    const isAhead = (r) => T && !jobStarted(S, T, id) && text.split('\n').some((l) => l.includes(`**${r}**`) && !/\*\(retired/i.test(l) && [...l.matchAll(/\*\(not yet met:([^)]*)\)\*/g)].some((x) => x[1].split(/[\s,;]+/).includes(T)));
    const named = new Set();
    for (const f of S.files) {
      if (!(m.tests || []).some((p) => pathMatches(p, f))) continue;
      for (const t of (S.read(f) || '').matchAll(/\bR(\d+)\b/g)) named.add(`R${t[1]}`);
    }
    const unnamed = live.filter((r) => !named.has(r));
    const missing = unnamed.filter((r) => !isAhead(r));
    ahead += unnamed.length - missing.length;
    ids += live.length; covered += live.length - unnamed.length;
    if (missing.length) {
      const lines = text.split('\n');
      for (const r of missing) add('id-unnamed', { module: id, file, line: lines.findIndex((l) => l.includes(`**${r}**`)) + 1 || null, id: r }, `${id}: ${r} is named by no test`);
    }
  }
  // the printed text keeps one line per module (the legacy callers compare lines without their numbers)
  const byModule = new Map();
  for (const f of findings) (byModule.get(f.module) ?? byModule.set(f.module, []).get(f.module)).push(f.id);
  const failures = [...byModule].map(([id, rs]) => `${id}: ${rs.length} of ${requirementIds(S.read(`build/requirements/${id}.md`) || '').live.length} live ids named by no test: ${rs.join(' ')}`);
  for (const f of findings) f.finding = failures.find((x) => x.startsWith(`${f.module}: `));
  return { findings, failures, counts: { modules, ids, covered, ahead }, summary: `${modules} modules, ${covered} of ${ids} live requirement ids named by a test${ahead ? `, ${ahead} written ahead (not yet met, job not started)` : ''}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { failures, summary } = checkCoverage(process.argv[2] || '.', process.argv.slice(3));
  process.exitCode = report('coverage', failures, summary);
}
