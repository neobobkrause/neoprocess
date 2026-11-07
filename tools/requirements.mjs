// The requirements module (layer 2; build/requirements/requirements.md): a module's requirements file as the thing a
// module is built and proven from. One parser every check and job reads it with (R1), the provided services as blocks
// (R2), the `not yet met` marks and their strike (R3), the line between a test and a measurement (R4), and the measure of
// a job's reading set against a budget drawn from the model's window (R5, R6). Pure (R7): no git write, no network, no
// session; the only read is `R.read`, the product checkout's file read that `record.repo` answers.

import { posix } from 'node:path';

// ---- R1: parse ----

// The sections in their order (REQ 3); Suggestions is optional and binds nothing.
export const SECTIONS = ['## Public', '### Purpose', '### Provides', '## Private', '### Uses', '### Invariants', '### Satisfies'];
// A statement's own id leads its line (`- **R<n>**`); an id cited in bold elsewhere on a line is not that line's.
const LEAD = /^\s*-\s+\*\*(R\d+)\*\*/;
// A retired id reads `*(retired …)*` or `*(moved to <module> R<n>)*`, and is never reused (R3).
const RETIRED = /\*\((?:retired|moved to [\w-]+ R\d+)/i;
const HEADER = /^\*\*([A-Za-z_$][\w$]*)\s*\(/;

// The text under one heading, up to the next heading of the same or a higher level.
function section(text, heading) {
  const lines = text.split('\n'), level = heading.match(/^#+/)[0].length, i = lines.findIndex((l) => l.trim() === heading);
  if (i < 0) return null;
  const out = [];
  for (const l of lines.slice(i + 1)) { const h = l.match(/^(#+) /); if (h && h[1].length <= level) break; out.push(l); }
  return out.join('\n');
}
const items = (body) => (body ?? '').split('\n').filter((l) => /^\s*- /.test(l)).map((l) => l.replace(/^\s*- /, '').trim());
const leadOf = (line) => line.match(LEAD)?.[1] ?? null;
// The service names of a header line: every bold name, as `**a(…)**`, `**a(…), b(…)**`, `**a(…)** · **b(…)**`
// or `**a(…) / b / c(…)**`; a name inside brackets (a parameter, a returned field) is none.
export function headerNames(line) {
  let flat = line, prev;
  do { prev = flat; flat = flat.replace(/\([^()]*\)|\{[^{}]*\}|\[[^[\]]*\]/g, '()'); } while (flat !== prev);
  return [...new Set([...flat.matchAll(/(?:\*\*|\/\s*)([A-Za-z_$][\w$]*)|,\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1] ?? m[2]))];
}
// The provided services by position: each header line and every line under it to the next header.
function provided(text) {
  const prov = (text.split(/^## Private/m)[0].split(/^### Provides\b/m)[1] ?? '').split(/^#{2,3} /m)[0];
  const blocks = [];
  let cur = null;
  for (const line of prov.split('\n')) {
    if (HEADER.test(line)) { cur = { names: headerNames(line), interface: line, text: `${line}\n`, ids: [] }; blocks.push(cur); continue; }
    if (!cur) continue;
    cur.text += `${line}\n`;
    const id = leadOf(line); if (id) cur.ids.push(id);
  }
  return blocks;
}

// The Uses section as a map from a used module to the services named for it: `module.service`, or a line
// "- `module`: `a`, `b` (…)" (several modules may share a line).
export function usesOf(text) {
  const sec = (text.split(/^## Private/m)[1] ?? '').split(/^### Uses\b/m)[1]?.split(/^#{2,3} /m)[0] ?? '';
  const out = new Map();
  for (const m of sec.matchAll(/`([\w-]+)\.([A-Za-z_$][\w$]*)`/g)) out.set(m[1], [...(out.get(m[1]) || []), m[2]]);
  for (const line of sec.split('\n')) for (const m of line.matchAll(/^- (?:\([^)]*\)\s*)?((?:`[\w-]+`(?:,\s*)?)+):/g)) {
    const names = [...line.slice(m[0].length).matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((x) => x[1]);
    for (const mod of [...m[1].matchAll(/`([\w-]+)`/g)].map((x) => x[1])) out.set(mod, [...(out.get(mod) || []), ...names]);
  }
  return out;
}

export function parse(text) {
  const findings = [], lines = text.split('\n');
  let from = 0;
  for (const s of SECTIONS) {
    const i = lines.findIndex((l, k) => k >= from && l.trim() === s);
    if (i < 0) findings.push(`section "${s}" missing or out of order`); else from = i + 1;
  }
  const purpose = (section(text, '### Purpose') ?? '').trim();
  const provides = provided(text);
  const invariants = items(section(text, '### Invariants')).map((s) => ({ ids: [leadOf(`- ${s}`)].filter(Boolean), text: s }));
  const satisfies = items(section(text, '### Satisfies')), suggestions = items(section(text, '### Suggestions'));
  const uses = [...usesOf(text)].map(([module, services]) => ({ module, services }));
  // Every statement is under a permanent id: a list item in Provides (below a service's header) or in Invariants.
  const prov = section(text, '### Provides') ?? '';
  let under = false;
  for (const l of prov.split('\n')) {
    if (HEADER.test(l)) { under = true; continue; }
    if (/^- /.test(l) && !leadOf(l)) findings.push(`a statement in Provides${under ? '' : ' (outside any service)'} has no id: ${l.replace(/^- /, '').trim().slice(0, 80)}`);
  }
  for (const s of invariants) if (!s.ids.length) findings.push(`a statement in Invariants has no id: ${s.text.slice(0, 80)}`);
  const all = [], live = [], retired = [];
  for (const l of lines) { const id = leadOf(l); if (id) { all.push(id); (RETIRED.test(l) ? retired : live).push(id); } }
  const dup = [...new Set(all.filter((r, i) => all.indexOf(r) !== i))];
  if (dup.length) findings.push(`ids given twice: ${dup.join(' ')}`);
  return { purpose, provides, uses, invariants, satisfies, suggestions, ids: { all, live, retired }, findings };
}

// ---- R2: serviceBlocks ----

// The provided services of a requirements file (or its Public part): each block from its `**name(` line to the next,
// with its names and text, and the Purpose. Issue 78 (BOB #337, Civicsmith): the last service took every line after it.
// A requirement belongs to the service above it while the numbers run on one by one from the header; after the first
// jump, only one that names the service is its.
export function serviceBlocks(text) {
  const publicText = text.split(/^## Private/m)[0];
  const purpose = publicText.match(/^### Purpose\b[\s\S]*?(?=^### |(?![\s\S]))/m)?.[0] ?? '';
  const prov = publicText.split(/^### Provides\b/m)[1]?.split(/^### /m)[0] ?? '';
  const blocks = [];
  let cur = null, last = null, keep = true, run = true;
  for (const line of prov.split('\n')) {
    if (HEADER.test(line)) { cur = { names: headerNames(line), text: `${line}\n` }; blocks.push(cur); last = null; keep = true; run = true; continue; }
    if (!cur) continue;
    const r = line.match(/^\s*- \*\*R(\d+)\*\*/);
    if (r) {
      const n = Number(r[1]), names = cur.names.some((x) => new RegExp(`(^|[^\\w$])${x.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(line));
      run = run && (last === null || n === last + 1);
      keep = run || names;
      last = n;
    }
    if (keep) cur.text += `${line}\n`;
  }
  return { purpose, blocks };
}

// ---- R3: marks and strike ----

const MARK = /\s*\*\(not yet met:([^)]*)\)\*/g;
const tranchesOf = (list) => list.split(/[\s,;]+/).filter(Boolean);
// Every `*(not yet met: …)*` mark, by id: [{ id, tranches }]; a retired id reads `retired` and has none.
export function marks(text) {
  const out = [];
  for (const l of text.split('\n')) {
    const id = leadOf(l);
    if (!id) continue;
    if (RETIRED.test(l)) { out.push({ id, retired: true, tranches: [] }); continue; }
    const tr = [...l.matchAll(MARK)].flatMap((m) => tranchesOf(m[1]).filter((x) => /^[A-Z]+\d+[a-z]?$/.test(x)));
    if (tr.length) out.push({ id, tranches: tr });
  }
  return out;
}
// Strikes tranche T from the mark of each statement whose own id is named (the whole mark when T was its only tranche);
// a line that only cites a named id is not its statement, and nothing else in the text changes.
export function strike(text, ids, T) {
  const want = new Set(ids);
  return text.split('\n').map((l) => (want.has(leadOf(l)) ? l.replace(MARK, (all, list) => {
    if (!tranchesOf(list).includes(T)) return all;
    const rest = tranchesOf(list).filter((x) => x !== T);
    return rest.length ? ` *(not yet met: ${rest.join(', ')})*` : '';
  }) : l)).join('\n');
}

// ---- R4: a test or a measurement ----

// The sentence the review brief carries (REQ-3; INT-2).
export const MEASUREMENT_RULE = 'A figure at a scale beyond the suite, or on a deployed copy, is a measurement with its own id in the plan, never a Test line; a measurement not yet taken is not a gap.';
export const FIXTURE_ROWS_DEFAULT = 100000;
// The fixture size the product sets: a manifest row or line naming the fixture limit, e.g. "| fixture limit | 50,000 rows |".
export function fixtureLimit(manifest) {
  const m = (manifest || '').match(/fixture[^\n]*?(\d[\d,_]*)\s*rows?\b/i);
  const n = m && Number(m[1].replace(/[,_]/g, ''));
  return n > 0 ? n : FIXTURE_ROWS_DEFAULT;
}
const SUP = { '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 };
const SCALE = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9, b: 1e9 };
// A fixture's size: a count the line names as rows, records, elements … ("1,000,000-row", "10⁶ elements", "10^6 distinct
// records", "2M rows", "a million rows"); any other number on the line (a result, a timeout) is not one.
const FIXTURE = /(10\^(\d+)|10([⁰¹²³⁴⁵⁶⁷⁸⁹]+)|(?<![\w^.,])(\d[\d,_]*(?:\.\d+)?)(?:\s*-?\s*(thousand|million|billion|[kmb])(?![a-z]))?|\ba (thousand|million|billion))\s*-?\s*(?:[a-z]+\s+)?(rows?|records?|elements?|items?|entries|entry|documents?|bundles?|users?|events?)\b/gi;
export function fixtureSizes(line) {
  return [...line.matchAll(FIXTURE)].map((m) => (m[2] ? 10 ** Number(m[2]) : m[3] ? 10 ** Number([...m[3]].map((c) => SUP[c]).join('')) : m[6] ? SCALE[m[6].toLowerCase()] : Number(m[4].replace(/[,_]/g, '')) * (SCALE[(m[5] || '').toLowerCase()] || 1)));
}
// A figure taken on a deployed copy: the line places a measure (a number) on a deployed, production, staging or live copy.
const DEPLOYED = /\b(?:on|against|in|from|of)\s+(?:the\s+|a\s+)?(?:deployed|production|staging|live)\b/i;
// A Test line is a measurement when it names a fixture larger than the product's size, or a figure on a deployed copy.
export function isMeasurement(line, manifest) {
  if (DEPLOYED.test(line) && /\d/.test(line)) return true;
  const limit = fixtureLimit(manifest);
  return fixtureSizes(line).some((n) => n > limit);
}

// ---- R5, R6: a job's reading set against its budget ----

// The budget is a fraction of the model's context window, in bytes, from the table its caller passes ({ window, fraction,
// bytesPerToken }: the Sessions table, SES-5; K19): floor(window × fraction × bytesPerToken); never a byte literal here.
export function budgetOf(table) {
  const w = Number(table?.window), f = Number(table?.fraction), b = Number(table?.bytesPerToken);
  if (!(w > 0) || !(f > 0 && f <= 1) || !(b > 0)) throw new Error('readingSet needs the Sessions table: { window, fraction, bytesPerToken } (SES-5; K19)');
  return Math.floor(w * f * b);
}
const moduleOf = (R, m) => {
  const t = R.read('build/modules.json');
  const x = t && (JSON.parse(t).modules || []).find((y) => y.id === m);
  if (!x) throw new Error(`no module ${m} in build/modules.json`);
  return x;
};
// The files a path names: a file, or every tracked file under a directory (`R.g`'s ls-files), as the product's paths.
function filesOf(R, p) {
  let t = null, dir = p.endsWith('/');
  if (!dir) { try { t = R.read(p); } catch { dir = true; } }
  if (!dir) return t === null ? [] : [[p, t]];
  const base = R.rel('.'), out = [];
  for (const f of R.g(['ls-files', '-z', '--', R.rel(p)]).split('\0').filter(Boolean)) {
    const q = base === '.' ? f : posix.relative(base, f), x = R.read(q);
    if (x !== null) out.push([q, x]);
  }
  return out;
}
// The module's entries in the plan: the lines under a heading that names it (`**m**` or `**a**, **m**`), every layer.
function entriesOf(plan, m) {
  const out = [];
  let under = [];
  for (const l of (plan || '').split('\n')) {
    if (/^#/.test(l)) { under = []; continue; }
    if (/^\*\*[a-z][a-z0-9-]*\*\*(,\s*\*\*[a-z][a-z0-9-]*\*\*)*(\s*\(.*\))?\s*$/.test(l)) { under = [...l.matchAll(/\*\*([a-z][a-z0-9-]*)\*\*/g)].map((x) => x[1]); continue; }
    if (under.includes(m) && /^- /.test(l)) out.push(l);
  }
  return out;
}
// A job's own set (BLD 1; R5): its START (given by the caller once it exists; before, the module's entries from the plan,
// which the START carries); its requirements, both parts, whole (never a summary: SES-7); its layer's contract (the
// table's head and its layer's row); of each used module its Purpose and the services its Uses line names, or all its
// Provides when it names none (K20: an over-count errs toward refusing); its code; and its tests that name an id its
// entries change (an id the entries name, or one whose statement cites a canon id they name). Every part is counted.
export function readingSet(R, m, table, start = null) {
  const budget = budgetOf(table), x = moduleOf(R, m), own = `build/requirements/${m}.md`, files = [own], missing = [], trimmed = [];
  let bytes = 0;
  const entries = entriesOf(R.read('build/plan/current.md'), m);
  if (start !== null) bytes += Buffer.byteLength(start); else bytes += Buffer.byteLength(entries.join('\n'));
  const ownText = R.read(own); if (ownText === null) missing.push(own); else bytes += Buffer.byteLength(ownText);
  const layers = R.read('build/layers.md');
  if (layers === null) missing.push('build/layers.md');
  else {
    const rows = layers.split('\n').filter((l) => /^\|/.test(l)), head = rows.slice(0, 2), row = rows.filter((l) => l.split('|').some((c) => c.split(',').map((w) => w.trim()).includes(m)));
    bytes += Buffer.byteLength([...head, ...row].join('\n')); files.push(`build/layers.md (the head and layer ${x.layer ?? '?'}'s row)`);
    trimmed.push('build/layers.md to its head and the module\'s row');
  }
  const named = usesOf(ownText || '');
  for (const u of x.uses || []) {
    if (u.startsWith('*')) continue;
    const f = `build/requirements/${u}.md`, t = R.read(f);
    if (t === null) { missing.push(f); continue; }
    const purpose = t.split(/^## Private/m)[0].match(/^### Purpose\b[\s\S]*?(?=^### |(?![\s\S]))/m)?.[0] ?? '', blocks = provided(t), want = new Set(named.get(u) || []);
    const hit = want.size ? blocks.filter((b) => b.names.some((n) => want.has(n))) : blocks;
    bytes += Buffer.byteLength(purpose) + hit.reduce((n, b) => n + Buffer.byteLength(b.text), 0);
    const which = want.size ? hit.flatMap((b) => b.names).join(', ') || 'none of its services matched' : 'all of Provides: no service named in its Uses line';
    files.push(`${f} (Public: Purpose; ${which})`);
    trimmed.push(`${f} to its Purpose and ${which}`);
  }
  // its code: the files of its paths, less its test material (its tests paths, and the directories its test files sit in,
  // with what is below them: fixtures); a test is read only when it names a changed id
  const testDirs = (x.tests || []).map((p) => (p.endsWith('/') ? p : `${posix.dirname(p)}/`));
  const isTest = (q) => (x.tests || []).includes(q) || testDirs.some((d) => d !== './' && q.startsWith(d));
  for (const p of x.paths || []) for (const [q, t] of filesOf(R, p)) if (!isTest(q)) bytes += Buffer.byteLength(t);
  const said = entries.join('\n'), canon = new Set(said.match(/\b[A-Z]{2,4}-\d+\b/g) || []), direct = new Set(said.match(/\bR\d+\b/g) || []);
  const changed = (ownText || '').split('\n').map((l) => [leadOf(l), l]).filter(([id, l]) => id && (direct.has(id) || [...(l.match(/\b[A-Z]{2,4}-\d+\b/g) || [])].some((c) => canon.has(c)))).map(([id]) => id);
  const tests = [];
  for (const p of x.tests || []) for (const [q, t] of filesOf(R, p)) if (changed.some((id) => new RegExp(`\\b${id}\\b`).test(t))) { bytes += Buffer.byteLength(t); tests.push(q); }
  if ((x.tests || []).length) trimmed.push(`the tests to those naming ${changed.join(', ') || 'no id its entries change'}${tests.length ? ` (${tests.join(', ')})` : ''}`);
  const over = bytes > budget;
  return { files, code: [...(x.paths || []), ...(x.tests || [])], bytes, budget, over, trimmed, missing, changed, tests };
}
// The record of a set over its budget (SES-6): its size, the module, and what was trimmed; the job is not started.
export function overrun(m, rs) {
  return `# ${m}: reading set over budget\n\n- size: ${rs.bytes} bytes, budget ${rs.budget} (a fraction of the model's window, SES-5)\n- module: ${m}\n- read: ${rs.files.join('; ')}\n- trimmed: ${rs.trimmed.join('; ') || 'nothing'}\n- the job is not started until the architecture session brings the set under by trimming or splitting (REQ-6, SES-6); a module's own requirements are never summarised (SES-7)\n`;
}
