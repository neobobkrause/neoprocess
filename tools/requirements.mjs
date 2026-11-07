// The requirements module (layer 2; build/requirements/requirements.md): a module's requirements file as the thing a
// module is built and proven from. One parser every check and job reads it with (R1), the provided services as blocks
// (R2), the `not yet met` marks and their strike (R3), the line between a test and a measurement (R4), and the measure of
// a job's reading set against a budget drawn from the model's window (R5, R6). Pure (R7): no git write, no network, no
// session; the only read is `R.read`, the product checkout's file read that `record.repo` answers.

// ---- R1: parse ----

// The sections in their order (REQ 3); Suggestions is optional and binds nothing.
export const SECTIONS = ['## Public', '### Purpose', '### Provides', '## Private', '### Uses', '### Invariants', '### Satisfies'];
const ID = /\*\*(R\d+)\*\*/g;
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
const idsOf = (line) => [...line.matchAll(ID)].map((m) => m[1]);

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
  const provides = serviceBlocks(text).blocks.map((b) => ({ names: b.names, interface: b.text.split('\n')[0], text: b.text, ids: idsOf(b.text) }));
  const invariants = items(section(text, '### Invariants')).map((s) => ({ ids: idsOf(s), text: s }));
  const satisfies = items(section(text, '### Satisfies')), suggestions = items(section(text, '### Suggestions'));
  const uses = [...usesOf(text)].map(([module, services]) => ({ module, services }));
  // Every statement is under a permanent id: a list item in Provides (below a service's header) or in Invariants.
  const prov = section(text, '### Provides') ?? '';
  let under = false;
  for (const l of prov.split('\n')) {
    if (HEADER.test(l)) { under = true; continue; }
    if (/^- /.test(l) && !idsOf(l).length) findings.push(`a statement in Provides${under ? '' : ' (outside any service)'} has no id: ${l.replace(/^- /, '').trim().slice(0, 80)}`);
  }
  for (const s of invariants) if (!s.ids.length) findings.push(`a statement in Invariants has no id: ${s.text.slice(0, 80)}`);
  const all = [], live = [], retired = [];
  for (const l of lines) for (const id of idsOf(l)) { all.push(id); (RETIRED.test(l) ? retired : live).push(id); }
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
    if (HEADER.test(line)) { cur = { names: [...line.matchAll(/(?:^\*\*|,\s*)([A-Za-z_$][\w$]*)\s*\(/g)].map((x) => x[1]), text: `${line}\n` }; blocks.push(cur); last = null; keep = true; run = true; continue; }
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
    const ids = idsOf(l);
    if (!ids.length) continue;
    if (RETIRED.test(l)) { for (const id of ids) out.push({ id, retired: true, tranches: [] }); continue; }
    const tr = [...l.matchAll(MARK)].flatMap((m) => tranchesOf(m[1]).filter((x) => /^[A-Z]+\d+[a-z]?$/.test(x)));
    if (tr.length) for (const id of ids) out.push({ id, tranches: tr });
  }
  return out;
}
// Strikes tranche T from the marks on the lines of the ids named (the whole mark when T was its only tranche); nothing
// else in the text changes.
export function strike(text, ids, T) {
  const want = new Set(ids);
  return text.split('\n').map((l) => (idsOf(l).some((id) => want.has(id)) ? l.replace(MARK, (all, list) => {
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
// The counts a line names: "1,000,000-row", "10⁶ rows", "10^6", "2M rows", "a million rows".
function counts(line) {
  const out = [];
  for (const m of line.matchAll(/10(?:\^(\d+)|([⁰¹²³⁴⁵⁶⁷⁸⁹]+))/g)) out.push(10 ** Number(m[1] ?? [...m[2]].map((c) => SUP[c]).join('')));
  for (const m of line.matchAll(/(?<![\w^.])(\d[\d,_]*(?:\.\d+)?)\s*-?\s*(thousand|million|billion|[kmb](?![a-z]))?/gi)) {
    if (/^10$/.test(m[1]) && /^[\^⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(line.slice(m.index + m[0].length))) continue;
    out.push(Number(m[1].replace(/[,_]/g, '')) * (SCALE[(m[2] || '').toLowerCase()] || 1));
  }
  for (const m of line.matchAll(/\ba (thousand|million|billion)\b/gi)) out.push(SCALE[m[1].toLowerCase()]);
  return out;
}
// A Test line is a measurement when it names a fixture (rows, records, elements …) above the product's size, or a figure
// on a deployed copy.
export function isMeasurement(line, manifest) {
  if (/\b(deployed|production|staging)\b/i.test(line) || /\blive (copy|site|deployment|service)\b/i.test(line)) return true;
  if (!/\b(rows?|records?|elements?|items?|entries|documents?|bundles?|fixtures?|users?)\b/i.test(line)) return false;
  const limit = fixtureLimit(manifest);
  return counts(line).some((n) => n > limit);
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
// A job's own set (BLD 1, SESSIONS §3): its requirements, both parts, whole (never a summary: SES-7); its layer's contract
// (the table's head and its layer's row); of each used module the services its Uses line names, each its Provides block,
// with that module's Purpose (issue 71). Its code and tests are listed to read whole; they are the module's own size (P6).
export function readingSet(R, m, table) {
  const budget = budgetOf(table), x = moduleOf(R, m), own = `build/requirements/${m}.md`, files = [own], missing = [], trimmed = [];
  let bytes = 0;
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
    const { purpose, blocks } = serviceBlocks(t), want = new Set(named.get(u) || []);
    const hit = blocks.filter((b) => b.names.some((n) => want.has(n)));
    bytes += Buffer.byteLength(purpose) + hit.reduce((n, b) => n + Buffer.byteLength(b.text), 0);
    files.push(hit.length ? `${f} (Public: Purpose; ${hit.flatMap((b) => b.names).join(', ')})` : `${f} (Public: Purpose; no service named in its Uses line: read a service whole when the job touches it)`);
    trimmed.push(`${f} to its Purpose${hit.length ? ` and ${hit.flatMap((b) => b.names).join(', ')}` : ''}`);
  }
  const over = bytes > budget;
  return { files, code: [...(x.paths || []), ...(x.tests || [])], bytes, budget, over, trimmed, missing };
}
// The record of a set over its budget (SES-6): its size, the module, and what was trimmed; the job is not started.
export function overrun(m, rs) {
  return `# ${m}: reading set over budget\n\n- size: ${rs.bytes} bytes, budget ${rs.budget} (a fraction of the model's window, SES-5)\n- module: ${m}\n- read: ${rs.files.join('; ')}\n- trimmed: ${rs.trimmed.join('; ') || 'nothing'}\n- the job is not started until the architecture session brings the set under by trimming or splitting (REQ-6, SES-6); a module's own requirements are never summarised (SES-7)\n`;
}
