// Check 3, ownership (rulebooks BLD 4, REQ 9; JOB-LIFE §3; P7): a module job's diff touches only its module's
// paths and tests, its own job record, and the `*(not yet met: T)*` marks of its own requirements file (struck, never written); a generated artifact the manifest lists (rulebook REP 7) is not judged. The one exception (mechanics: legacy modules; rulebook REQ 9): a module extracted
// from a legacy module may remove the moved code from that legacy module's files, and may rewire the
// legacy code that called it: an added line there is either part of an import (or re-export) from the
// job's own paths, or in a block of added lines that uses a name so imported. The legacy module's net
// change, over all its legacy modules together, is a removal. Every added legacy line is listed, for BOB's review at the layer close.
// A changed line that only removes tokens from the line it replaces (a dropped key, a lost import name) is a
// removal, not an addition (bio K140): it is listed as EDITED, neither judged nor counted as added.
// R5 (build/requirements/architecture.md): every finding carries its key, module, file and line (R3); git is reached
// through record's repo only (N2-12), and the diff is read between commits, never from the working tree (R10).
// Usage: node checks/ownership.mjs <product-root> <module> <base-ref> [head-ref]
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshot, readModules, pathMatches, report, generatedPaths, isGenerated, finder, texts } from './lib.mjs';

// git diff between two refs for the product's own paths: `--relative` to the product's directory, which may sit inside its
// repository; a file is named product-relative and given to git repository-relative.
const diffOf = (S, args, file) => S.git(['diff', ...args, '--no-renames', S.prefix === '.' ? '--relative' : `--relative=${S.prefix}/`, ...(file === undefined ? ['--', S.prefix === '.' ? '.' : S.prefix] : ['--', S.at(file)])]);

// Static imports and re-exports (`import … from`, `export … from`, `import '…'`).
const STATEMENT = /(^|\n)([ \t]*)(import|export)(\s*[\w$*{}\s,]*?\s*from\s*|\s*)(['"])([^'"\n]+)\5/g;

// The local names an import clause binds: `X`, `* as ns`, `{ a, b as c }`.
export function boundNames(clause) {
  const names = [];
  const c = clause.replace(/\bfrom\s*$/, '').replace(/\btype\b/g, ' ');
  const braces = c.match(/\{([^}]*)\}/);
  if (braces) for (const part of braces[1].split(',')) { const w = part.trim().split(/\s+as\s+/).pop().trim(); if (w) names.push(w); }
  const ns = c.match(/\*\s*as\s+([\w$]+)/);
  if (ns) names.push(ns[1]);
  const def = c.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+[\w$]+/, '').split(',')[0].trim();
  if (/^[\w$]+$/.test(def)) names.push(def);
  return names;
}

// Every static import or re-export in `text`: kind, specifier, bound names, and its 1-based line span.
export function statementsOf(text) {
  const out = [];
  for (const m of text.matchAll(STATEMENT)) {
    const start = m.index + m[1].length;
    const first = text.slice(0, start).split('\n').length;
    const last = first + m[0].slice(m[1].length).split('\n').length - 1;
    out.push({ kind: m[3], spec: m[6], names: m[3] === 'import' ? boundNames(m[4]) : [], first, last });
  }
  return out;
}

// A line with no behaviour: blank, brackets and separators only, or a comment.
const STRUCTURAL = (t) => /^[\s{}()[\];,]*$/.test(t.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').replace(/^\s*(\/\*|\*).*$/, ''));

// Added and removed lines of `file` between the refs, grouped by diff hunk, and the number of removed lines.
function hunksOf(S, ref, head, file) {
  const diff = diffOf(S, ['-U0', `${ref}...${head}`], file);
  const hunks = [];
  let cur = null, n = 0, removed = 0;
  for (const line of diff.split('\n')) {
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { cur = { lines: [], gone: [] }; hunks.push(cur); n = Number(h[1]); continue; }
    if (!cur) continue;
    if (line.startsWith('+')) cur.lines.push({ n: n++, text: line.slice(1) });
    else if (line.startsWith('-')) { removed++; cur.gone.push(line.slice(1)); }
  }
  return { hunks: hunks.filter((x) => x.lines.length), removed };
}

// A line's tokens: identifiers and numbers, whole string literals, and single punctuation marks.
// A string literal is one token, so shortening a string is a change, not a removal.
const TOKEN = /[\w$]+|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`|\S/g;
export const tokensOf = (t) => t.match(TOKEN) || [];

// True when `after` is `before` with tokens deleted and none added or changed: its tokens are a
// subsequence of `before`'s (K140: a line that only drops an import name or a key is a removal).
export function onlyRemoves(before, after) {
  const b = tokensOf(before), a = tokensOf(after);
  let i = 0;
  for (const t of b) if (i < a.length && t === a[i]) i++;
  return i === a.length;
}

// Pairs each added line of a hunk with a removed line of the same hunk, in order, when the added line only
// removes from it (bio K140, SUITE G5). Returns the added lines that are such edits. A structural line (a lone
// bracket, a blank, a comment) is never paired: it is a subsequence of almost any line, and it stays counted as added.
export function removalEdits(hunk) {
  const edits = new Set();
  let j = 0;
  for (const l of hunk.lines) {
    if (STRUCTURAL(l.text)) continue;
    for (let k = j; k < hunk.gone.length; k++) {
      if (onlyRemoves(hunk.gone[k], l.text)) { edits.add(l); j = k + 1; break; }
    }
  }
  return edits;
}


// The lines a job added to one legacy file, judged against the job's own paths.
export function judgeLegacyFile(root, ref, head, file, own) {
  const S = snapshot(root);
  const { findings, add } = finder('ownership');
  const added = [], edited = [];
  const text = S.git(['show', `${head}:${S.at(file)}`]);
  const isOwn = (spec) => {
    if (!spec.startsWith('.')) return false;
    const t = posix.normalize(posix.join(posix.dirname(file), spec));
    return own.some((p) => [t, `${t}.mjs`, `${t}.js`, `${t}/index.mjs`, `${t}/index.js`].some((c) => pathMatches(p, c)));
  };
  const stmts = statementsOf(text);
  const inStmt = (n) => stmts.find((x) => n >= x.first && n <= x.last);
  const ownNames = stmts.filter((s) => s.kind === 'import' && isOwn(s.spec)).flatMap((s) => s.names);
  const esc = (x) => x.replace(/\$/g, '\\$');
  const usesOwn = ownNames.length ? new RegExp(`(^|[^\\w$.]|\\.\\.\\.)(${ownNames.map(esc).join('|')})(?![\\w$])`) : null;
  const dynamicOwn = (t) => [...t.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/g)].some((m) => isOwn(m[2]));
  const { hunks, removed } = hunksOf(S, ref, head, file);
  let count = 0;
  for (const h of hunks) {
    const code = [];
    let uses = false;
    const edits = removalEdits(h);
    for (const l of h.lines) {
      // A changed line that only removes (a dropped key or import name) is a removal, never an addition (K140);
      // one that now names the module's own import (`this.#f(x)` becoming `f(x)`) is a rewire, still listed and judged.
      if (edits.has(l) && !((usesOwn && usesOwn.test(l.text)) || dynamicOwn(l.text))) { edited.push(`${file}:${l.n}  ${l.text.trim()}`); continue; }
      count++;
      added.push(`${file}:${l.n}  ${l.text.trim()}`);
      const s = inStmt(l.n);
      if (s) {
        if (!isOwn(s.spec)) add('legacy-import', { file, line: l.n, spec: s.spec }, `${file}:${l.n}: adds to an import or re-export of ${s.spec}, which is not the module's own`);
        continue;
      }
      if (STRUCTURAL(l.text)) continue;
      code.push(l.n);
      if ((usesOwn && usesOwn.test(l.text)) || dynamicOwn(l.text)) uses = true;
    }
    if (code.length && !uses) add('legacy-unrelated', { file, line: code[0], last: code[code.length - 1] }, `${file}:${code[0]}-${code[code.length - 1]}: added lines that neither import from nor use the module's own paths`);
  }
  return { findings, failures: texts(findings), added, edited, count, removed };
}

// The job strikes its own marks (JOB-LIFE §3; P7): in `build/requirements/<module>.md` a job may remove a
// `*(not yet met: T)*` mark, or one tranche from a mark's list, on the lines of the ids its report meets, and nothing
// else: every changed line, marks aside, reads as it did, and a mark after the change names only tranches it named before.
const MARK = /\s*\*\(not yet met:([^)]*)\)\*/g;
const marksOf = (line) => [...line.matchAll(MARK)].flatMap((x) => x[1].split(/[\s,;]+/).filter(Boolean));
const bare = (line) => line.replace(MARK, '').replace(/\s+/g, ' ').trim();
export function strikeFailures(root, ref, head, file) {
  const S = snapshot(root);
  const diff = diffOf(S, ['-U0', `${ref}...${head}`], file);
  const { findings, add } = finder('ownership');
  let gone = [], added = [], n = 0;
  const judge = () => {
    if (!gone.length && !added.length) return;
    if (gone.length !== added.length) { add('strike-lines', { file, line: n, added: added.length, removed: gone.length }, `${file}:${n}: ${added.length} line(s) added and ${gone.length} removed; a job only strikes its \`*(not yet met: T)*\` marks here`); }
    else for (let i = 0; i < gone.length; i++) {
      const before = marksOf(gone[i]), after = marksOf(added[i]);
      if (bare(gone[i]) !== bare(added[i]) || after.some((x) => !before.includes(x)) || after.length >= before.length) add('strike-changed', { file, line: n + i }, `${file}:${n + i}: changed beyond striking a \`*(not yet met: T)*\` mark: ${added[i].trim()}`);
    }
    gone = []; added = [];
  };
  for (const line of diff.split('\n')) {
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { judge(); n = Number(h[1]); continue; }
    if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1));
    else if (line.startsWith('-') && !line.startsWith('---')) gone.push(line.slice(1));
  }
  judge();
  return findings;
}

export function checkOwnership(root, moduleId, base, head = 'HEAD') {
  const S = snapshot(root, { ref: head });
  const state = readModules(S);
  const { findings, add } = finder('ownership');
  const m = state.modules.find((x) => x.id === moduleId);
  if (!m) { add('no-module', { module: moduleId, file: 'build/modules.json' }, `${moduleId}: no such module in build/modules.json`); return { findings, failures: texts(findings), added: [], edited: [], summary: 'nothing checked' }; }
  // `from` names one legacy module or several (a module's code may sit in more than one monolith).
  const legacies = [].concat(m.from || []).map((id) => state.modules.find((x) => x.id === id)).filter(Boolean);
  const own = [...(m.paths || []), ...(m.tests || [])];
  const record = new RegExp(`^build/jobs/[A-Z]+\\d+[a-z]?/${moduleId.replace(/[-]/g, '\\-')}\\.md$`);
  const added = [], edited = [];
  // A generated artifact (rulebook REP 7) is no module's hand-written code: its committed copy is always the one the
  // merge regenerates, so a job's copy of it is never judged (bio K5583's revert of the word rows, BOB #327).
  const gen = generatedPaths(S);
  const tally = new Map(legacies.map((l) => [l.id, { added: 0, removed: 0 }]));
  // A job's checkout often has only the remote-tracking branch (found in the D1 dry run): fall back to origin/<base>.
  let ref = base;
  if (S.q(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]) === null) ref = `origin/${base}`;
  const lines = diffOf(S, ['--numstat', `${ref}...${head}`]).split('\n').filter(Boolean);
  for (const line of lines) {
    const [a, r, file] = line.split('\t');
    if (own.some((p) => pathMatches(p, file)) || record.test(file) || isGenerated(gen, file)) continue;
    if (file === `build/requirements/${moduleId}.md`) { findings.push(...strikeFailures(S, ref, head, file).map((f) => ({ ...f, module: moduleId }))); continue; }
    const legacy = legacies.find((l) => (l.paths || []).some((p) => pathMatches(p, file)));
    if (legacy) {
      const t = tally.get(legacy.id);
      t.removed += Number(r) || 0;
      if (a === '0') continue;
      const j = judgeLegacyFile(S, ref, head, file, m.paths || []);
      findings.push(...j.findings.map((f) => ({ ...f, module: moduleId, legacy: legacy.id })));
      added.push(...j.added);
      edited.push(...j.edited);
      t.added += j.count;
      continue;
    }
    add('outside', { module: moduleId, file }, `${file}: outside ${moduleId}'s paths, tests and job record`);
  }
  // The net change is judged over all the legacy modules together: the moved code and its caller may sit
  // in different ones (D5: the catalogue loses the code, the store gains the rewired call).
  const sum = [...tally.values()].reduce((s, t) => ({ added: s.added + t.added, removed: s.removed + t.removed }), { added: 0, removed: 0 });
  if (sum.added && sum.added >= sum.removed) add('legacy-net', { module: moduleId, legacy: [...tally.keys()], added: sum.added, removed: sum.removed }, `${[...tally.keys()].join(' + ')}: ${moduleId} adds ${sum.added} line(s) and removes ${sum.removed}; an extraction's net change to its legacy modules is a removal`);
  const tail = [...tally].map(([id, t]) => `; ${id}: ${t.added} line(s) added, ${t.removed} removed`).join('');
  return { findings, failures: texts(findings), added, edited, tally: Object.fromEntries(tally), summary: `${lines.length} files changed by ${moduleId} between ${base} and ${head}${tail}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [root, mod, base, head] = process.argv.slice(2);
  if (!root || !mod || !base) { console.error('usage: node checks/ownership.mjs <product-root> <module> <base-ref> [head-ref]'); process.exit(2); }
  const { failures, added, edited, summary } = checkOwnership(root, mod, base, head);
  for (const a of added) console.log(`ADDED ${a}`);
  for (const e of edited) console.log(`EDITED ${e}  (only removes from the line it replaces: a removal)`);
  process.exitCode = report('ownership', failures, summary);
}
