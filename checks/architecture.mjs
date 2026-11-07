// Check 1, architecture (ARC-1; P4; build/requirements/architecture.md R1, R4): the modules in one total order within
// layers (`modules`), every product file in exactly one module's paths or tests (the most specific path owns it), and every
// import to the module itself or to a module earlier in the order that it declares in `uses`.
// Usage: node checks/architecture.mjs <product-root> [module ...]
// Named modules limit the check to the files and map entries those modules own, which is how a module job runs it.
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshot, ownerIndex, notProduct, finder, texts, report, moduleLines } from './lib.mjs';

const SOURCE = /\.(mjs|cjs|js|ts)$/;

// Relative specifiers of static imports, re-exports, dynamic imports and require(), each with the line its specifier
// stands on (comments are blanked, their line breaks kept, so the lines are the file's).
export function importLines(text) {
  const body = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');
  const out = [];
  const re = /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*[\w*{}\s,$]+\s*from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
  for (const m of body.matchAll(re)) if (m[2].startsWith('.')) out.push({ spec: m[2], line: body.slice(0, m.index + m[0].length).split('\n').length });
  return out;
}
export const importsOf = (text) => importLines(text).map((x) => x.spec);

export function resolveImport(files, from, spec) {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  for (const c of [base, `${base}.mjs`, `${base}.js`, `${base}/index.mjs`, `${base}/index.js`]) if (files.has(c)) return c;
  return null;
}

// R1: build/modules.json as one total order. Each module has one positive integer layer and the layers never go down
// (a layer's modules adjacent, lower layers first); `uses` names only modules earlier in the order (a legacy module may
// write "*earlier"); `from` names only legacy modules placed after the module extracted from them. Answers the modules in
// order and the findings of a map that breaks this.
export function modules(root) {
  const S = snapshot(root);
  const { findings, add } = finder('architecture');
  let state;
  try { state = JSON.parse(S.read('build/modules.json')); if (!state || typeof state !== 'object') throw new Error('no map'); } catch (e) { add('map-unreadable', { file: 'build/modules.json' }, `build/modules.json: does not parse (${e.message})`); return { modules: [], state: { modules: [] }, findings }; }
  const mods = Array.isArray(state.modules) ? state.modules : [];
  if (!mods.length) add('no-modules', { file: 'build/modules.json', line: 1 }, 'build/modules.json: no modules');
  const at = (id) => mods.findIndex((x) => x && x.id === id);
  // the line of the i-th module's object in the file: its `"id"` line, the i-th such line where the id repeats
  const lines = moduleLines(S.read('build/modules.json'), mods);
  const lineOf = (i) => lines[i];
  const seen = new Set();
  let last = 0;
  mods.forEach((m, i) => {
    const line = lineOf(i);
    // a module the order cannot place is a finding, never skipped (R1)
    if (!m || typeof m.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(m.id)) { add('id-invalid', { file: 'build/modules.json', line, index: i }, `build/modules.json: module ${i}: id missing or invalid`); return; }
    const where = { module: m.id, file: 'build/modules.json', line };
    if (seen.has(m.id)) add('id-twice', where, `build/modules.json: ${m.id}: id given twice`);
    seen.add(m.id);
    if (!Number.isInteger(m.layer) || m.layer < 1) add('layer-invalid', where, `build/modules.json: ${m.id}: layer is not a positive integer`);
    else {
      if (m.layer < last) add('layer-order', where, `build/modules.json: ${m.id}: layer ${m.layer} after layer ${last}; a layer's modules are adjacent and in order (P4)`);
      else last = m.layer;
    }
    for (const u of m.uses || []) {
      if (u === '*earlier') { if (!m.legacy) add('wildcard-not-legacy', where, `build/modules.json: ${m.id}: only a legacy module may use "*earlier"`); continue; }
      const j = at(u);
      if (j < 0 || j >= i) add('use-not-earlier', { ...where, used: u }, `build/modules.json: ${m.id}: uses ${u}, which is ${j < 0 ? 'no module' : 'not earlier in the order'}`);
    }
    for (const f of [].concat(m.from ?? [])) {
      const j = at(f);
      if (j < 0 || !mods[j].legacy) add('from-not-legacy', { ...where, from: f }, `build/modules.json: ${m.id}: from ${f}, which is no legacy module`);
      else if (j < i) add('from-not-after', { ...where, from: f }, `build/modules.json: ${m.id}: from ${f}, a legacy module placed before it; a legacy module comes after the modules extracted from it`);
    }
  });
  return { modules: mods, state, findings };
}

export function checkArchitecture(root, only = []) {
  const S = snapshot(root);
  const map = modules(S);
  const state = map.state;
  const owner = ownerIndex(state);
  const skip = notProduct(state);
  const order = new Map(state.modules.map((m, i) => [m.id, i]));
  const byId = new Map(state.modules.map((m) => [m.id, m]));
  const files = new Set(S.files);
  const { findings, add } = finder('architecture');
  for (const f of map.findings) if (!only.length || only.includes(f.module)) findings.push(f);
  let product = 0, imports = 0, unresolved = 0;
  for (const f of S.files) {
    if (skip(f)) continue;
    const o = owner(f);
    if (only.length && (!o || !only.includes(o.module))) continue;
    product++;
    if (!o) { add('unowned', { file: f }, `${f}: owned by no module`); continue; }
    if (!SOURCE.test(f)) continue;
    const me = byId.get(o.module);
    if (!me || !Array.isArray(me.uses)) continue;   // its map entry is a finding of its own
    for (const { spec, line } of importLines(S.read(f) || '')) {
      imports++;
      const target = resolveImport(files, f, spec);
      // An import that names no tracked file cannot be judged: it is text inside a fixture or string
      // more often than a real import, and a real one fails when that file is loaded. It is counted.
      if (!target) { unresolved++; continue; }
      if (skip(target)) { add('not-product-import', { module: o.module, file: f, line, target }, `${f}: imports ${target}, which is not product`); continue; }
      const t = owner(target);
      if (!t) continue; // reported as unowned in its own right
      if (t.module === o.module) continue;
      const earlier = order.get(t.module) < order.get(o.module);
      const declared = me.uses.includes(t.module) || (me.uses.includes('*earlier') && earlier);
      if (!earlier) add('later-import', { module: o.module, file: f, line, target, used: t.module }, `${f} (${o.module}): imports ${target} of ${t.module}, which is not earlier in the order`);
      else if (!declared) add('undeclared-import', { module: o.module, file: f, line, target, used: t.module }, `${f} (${o.module}): imports ${target} of ${t.module}, which ${o.module} does not declare in uses`);
    }
  }
  return { findings, failures: texts(findings), counts: { product, imports, unresolved }, summary: `${product} product files, ${imports} relative imports (${unresolved} naming no tracked file, not judged)` };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { failures, summary } = checkArchitecture(process.argv[2] || '.', process.argv.slice(3));
  process.exitCode = report('architecture', failures, summary);
}
