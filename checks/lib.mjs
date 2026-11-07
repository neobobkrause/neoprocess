// Shared reading of a product repository's build state (PRODUCT-SUPPLIES; JOB-LIFE §4; build/requirements/architecture.md).
// R10: a check reads code and record files at a commit and nothing else (never a session, the network, or the working
// tree's uncommitted state), so the same commit gives the same findings. Every read goes through a snapshot of one
// commit, and every git call through record's `repo` (record R1; N2-12).
import { repo } from '../tools/record.mjs';

// A snapshot of the product at `ref` (default HEAD): its tracked files, product-relative (a product may sit in a
// subdirectory of its repository), and their text as committed. Passing a snapshot where a root is asked for reuses it.
export function snapshot(root = '.', { ref = 'HEAD' } = {}) {
  if (root && typeof root === 'object' && root.isSnapshot) return root;
  const R = root && typeof root === 'object' && root.g ? root : repo(root || '.');
  const prefix = R.rel('.');
  const at = (p) => (prefix === '.' ? p : `${prefix}/${p}`);
  let files = [];
  let commit = null;
  try {
    commit = R.g(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
    files = R.raw(['ls-tree', '-r', '-z', '--name-only', '--full-tree', commit, ...(prefix === '.' ? [] : ['--', prefix])]).split('\0').filter(Boolean)
      .map((f) => (prefix === '.' ? f : f.slice(prefix.length + 1)));
  } catch { /* no commit yet: an empty product */ }
  const set = new Set(files);
  const cache = new Map();
  const read = (p) => {
    if (!set.has(p) || !commit) return null;
    if (!cache.has(p)) { let t = null; try { t = R.raw(['show', `${commit}:${at(p)}`]); } catch { /* unreadable */ } cache.set(p, t); }
    return cache.get(p);
  };
  // a file, or a directory holding committed files (a path ending in `/` names a directory)
  const has = (p) => { const d = p.endsWith('/') ? p : `${p}/`; return set.has(p) || files.some((f) => f.startsWith(d)); };
  const list = (dir) => { const d = dir.endsWith('/') ? dir : `${dir}/`; return files.filter((f) => f.startsWith(d)); };
  // git through record's repo, for the reads a snapshot does not answer (a diff between refs, a ref of the record)
  const q = (args) => { try { return R.raw(args); } catch { return null; } };
  return { isSnapshot: true, R, ref, commit, prefix, at, files, read, has, list, git: (args) => R.raw(args), q };
}

// N2-45: the record of the epoch, read at the local ref of its state branch (record's layout: `epoch.md`, `plan.md`,
// `jobs/<module>.md`). None, or more than one open, reads as no record: no entry is pending.
const JOB_LINE = /^\*\*Status\*\* · ([A-Z][A-Z0-9-]* #\d+) · (session_[0-9A-Za-z]+|-) · (.+?)(?: · PR #(\d+))?$/m;
// A live job: its line reads any state but MERGED or ARCHIVED (R6, K23).
export const LIVE_JOB = { test: (state) => !!state && !/^(?:MERGED|ARCHIVED)\b/.test(state) };
export function stateRecord(S) {
  const refs = (S.q(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/state/']) || '').split('\n').filter(Boolean);
  const open = refs.filter((r) => { const e = S.q(['show', `${r}:epoch.md`]); return e !== null && !/^closed /m.test(e); });
  if (open.length !== 1) return null;
  const ref = open[0];
  const layers = {};
  for (const part of ((S.q(['show', `${ref}:plan.md`]) || '').match(/^\*\*Layers\*\* · (.*)$/m)?.[1] || '').split(';')) { const m = part.trim().match(/^(\d+) (\S+)/); if (m) layers[m[1]] = m[2]; }
  const job = (m) => { const t = S.q(['show', `${ref}:jobs/${m}.md`]); const x = t && t.match(JOB_LINE); return x ? x[3] : null; };
  return { ref, layers, job };
}

// The line of each module in build/modules.json's text, by its index in the list: where the module's own `"id"` key
// stands (the n-th module's is the n-th `"id"` key at the list's depth; a one-line map gives line 1 to each); null if unknown.
export function moduleLines(text, mods) {
  const ids = [...String(text || '').matchAll(/"id"\s*:/g)].map((m) => m.index);
  const at = (i) => String(text).slice(0, i).split('\n').length;
  return mods.map((m, i) => (ids.length === mods.length ? at(ids[i]) : null));
}

// The product's generated artifacts (PRODUCT-SUPPLIES): rows of build/manifest.md's table
// `| \`<path>\`[, \`<path>\`…] | <owner> | \`<regenerate>\` | \`<verify>\` |`, in the table's order.
export function artifactRows(text) {
  return [...String(text || '').matchAll(/^\| (`[^`|]+`(?:, `[^`|]+`)*) \| [^|]+ \| `([^`]+)` \| `([^`]+)` \|$/gm)].map((x) => ({ paths: [...x[1].matchAll(/`([^`]+)`/g)].map((y) => y[1]), regen: x[2], verify: x[3] }));
}
// Every generated artifact path of the product (a directory's path is matched as its prefix, `dist` as `dist/`).
export function generatedPaths(root) {
  return artifactRows(snapshot(root).read('build/manifest.md')).flatMap((r) => r.paths);
}
export const isGenerated = (paths, file) => paths.some((p) => file === p || file.startsWith(p.endsWith('/') ? p : `${p}/`));

// Tracked files only: what the commit holds, never a local build or node_modules.
export function trackedFiles(root) {
  return snapshot(root).files;
}

export function readModules(root) {
  return JSON.parse(snapshot(root).read('build/modules.json'));
}

// A path ending in "/" owns everything under it; any other path owns that one file.
export function pathMatches(p, file) {
  return p.endsWith('/') ? file.startsWith(p) : file === p;
}

// Who owns a file. Ruling (BOB #38, 2026-09-26): "exactly one owner" (P4, rulebook REQ 1) is read as
// the MOST SPECIFIC matching path: a legacy module's directory may contain an extracted module's
// directory (bio-plane/test/ holds bio-plane/test/m/<module>/). Two modules claiming the same
// path is an error, reported by the format check.
export function ownerIndex(state) {
  const entries = [];
  for (const m of state.modules) {
    for (const p of m.paths || []) entries.push({ path: p, module: m.id, role: 'code' });
    for (const p of m.tests || []) entries.push({ path: p, module: m.id, role: 'tests' });
  }
  entries.sort((a, b) => b.path.length - a.path.length);
  return (file) => entries.find((e) => pathMatches(e.path, file)) || null;
}

export function notProduct(state) {
  return (file) => (state.not_product || []).some((p) => pathMatches(p, file));
}

// Requirement ids in a requirements file: an id is defined where it is written in bold, `**Rn**`
// (build/requirements/README.md, rule 5); a mention elsewhere is written plain (`R12`). Ruling (BOB #38,
// 2026-09-26): the bold is the marker, wherever it stands on its line, because three approved files put
// ids after a service's signature. A retired id carries "*(retired" on its line and needs no test.
export function requirementIds(text) {
  const live = [], retired = [], all = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/\*\*(R\d+)\*\*/g)) {
      all.push(m[1]);
      (/\*\(retired/i.test(line) ? retired : live).push(m[1]);
    }
  }
  return { live, retired, all };
}

export function requirementFiles(root) {
  return snapshot(root).list('build/requirements').filter((f) => /^build\/requirements\/[^/]+\.md$/.test(f) && f !== 'build/requirements/README.md')
    .map((f) => f.slice('build/requirements/'.length, -3)).sort();
}

// R3: every finding is machine-readable: the check, its key (what kind of finding, the name a test asserts on, R11),
// the module, file and line it is about (null where it has none), and the text printed for people.
export function finder(check) {
  const findings = [];
  const add = (key, { module = null, file = null, line = null, ...rest } = {}, finding) => { findings.push({ check, key, module, file, line, ...rest, finding }); };
  return { findings, add };
}
// The printed text of a list of findings (what the legacy callers and people read).
export const texts = (findings) => findings.map((f) => f.finding);

export function report(name, failures, summary) {
  for (const f of failures) console.log(`FAIL  ${typeof f === 'string' ? f : f.finding}`);
  console.log(`${name}: ${summary}; ${failures.length} failure${failures.length === 1 ? '' : 's'}`);
  return failures.length ? 1 : 0;
}
