// Check 5, words (bio rulings-active §5: K3366 "Words by key", K3810, K3268): measures that no module holds
// member-facing English and no test copies a sentence or hand-lists another module's ops, rows or words.
// Four arms, each failure reported as `<arm> <module> <file>:<line> [tag] <short excerpt>`:
//   inline       a member-facing English sentence in a module's own product source (tag `?`: a message given to a
//                custom `*Error` class, uncertain; `copy`: equals a words.json `en`; `table`: in a hand-written word
//                table; `stitched`: a `+` chain of literals and non-literals whose joined text is a sentence, see
//                stitchedChains; `plain`: a lowercase, unpunctuated string of 5+ words that reads as a reason or a
//                message, see isPlainSentence, bio K3957). A string given to a built-in error constructor (BUILTIN_ERRORS) is developer text,
//                not a failure (BOB's ruling, P17; member-facing refusals are codes read by key, DEC-83); the summary
//                counts those as `dev <n>`.
//   testcopy     a test string equal to (2+ words), or a 25+ character substring of, a words.json `en` (K3810). Also
//                (bio K3962, tag `code`) the same comparison with the `en` of every `localize(id, en, ...)` call in the
//                product source the check reads (the literal second argument, `{name}` placeholders as they stand, as
//                for words.json), so a test cannot copy a sentence the product holds in code either.
//   missingkey   a literal key given to word(/hasWord(/wordsOf( or listed in words-reads.json that words.json lacks.
//   handlist     a test array of 5+ strings that are op names, refusal codes or word keys (K3268). Tag `?` on
//                op names and refusal codes (whose owner module is not known to the check); word keys are certain.
// The words come from the table `build/words.json` names ({words: [{key, en}]}); op names from the
// product's op declarations (`opDeclarations`, its `OPS`) or, failing that, from
// `build/ops.json` (a JSON array of names). Files read: tracked files of the module's `paths` / `tests` with a
// JS/TS extension; never generated files (a header saying GENERATED or "do not edit by hand", the manifest's
// "Generated artifacts" table), vendored code, node_modules, dist, fixtures, the word list's own module (`wordsModule`).
// Words B (bio K3930; words-B-design §10): the marker `localize(id, en, vars)` (MARKER; named `t` until bio K3943, renamed
// because 1,450 of bio's files bind `t` already) is a reading like word(): the literals given as its first and second
// arguments are never `inline` or `testcopy` findings. Fifth arm:
//   marker       a marker call whose id or en is not a plain string literal (a template with no placeholder is plain), whose id
//                is not KEY_RE, whose id is used with two different en across the tree (each place after the first), or
//                that sits in a drawn-screen module (DRAWN_MODULES). `missingkey` still judges word/hasWord/wordsOf only.
//   unreviewed   only with `--release` (`checkWords(root, only, { release: true })`; run.mjs does not pass it): one failure per
//                row of the `unreviewed` file `build/words.json` names ({unreviewed: [{id,en,module,file,line}]}),
//                the design stream's review list, which must be empty at a release cut.
// ARC-3, N2-10 (build/requirements/architecture.md R7): a `testcopy` or `testenglish` finding names the key the copied
// sentence lives under (` -> key <key>`: the word table's key, or the id of the localize call that holds it), so the test
// is rewritten to read it by that key. Every finding carries its key (the arm), module, file and line (R3), and the
// check reads the product at a commit (R10).
// Usage: node checks/words.mjs <product-root> [module ...] [--release]
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { importsOf, resolveImport } from './architecture.mjs';
import { pathToFileURL } from 'node:url';
import { snapshot, readModules, ownerIndex, notProduct, finder, report } from './lib.mjs';

// The process names no product (Bob, 29 Oct): where a product keeps its words, and what its modules are called, come from
// its own `build/words.json`, and the check runs only where that file exists (PRODUCT-SUPPLIES). Its keys:
//   table        the word table ({words: [{key, en}]})                 reads        the design's words-reads.json
//   rows         the generated word rows (the design's words followed by the sentences written first in code; a key
//                there is a word `word(key)` answers, so `missingkey` does not judge it)
//   unreviewed   the design stream's review list, judged with --release  baseline     the test files that hold English today
//   opDeclarations  a module exporting OPS and OP_FAMILIES              marker       the marker function's name
//   wordsModule  the word list's own module (holds the English by definition; its tests may test the marker's refusals)
//   declModules  modules whose tests may list ops                     drawnPrefix, drawnModules  the drawn-screen modules
export const WORDS_CONFIG = 'build/words.json';
export function wordsConfig(root) {
  const text = snapshot(root).read(WORDS_CONFIG);
  if (text === null) return null;
  const c = JSON.parse(text);
  const drawn = new Set(c.drawnModules || []);
  return { ...c, marker: c.marker || 'localize', own: new Set(c.wordsModule ? [c.wordsModule] : []), decl: new Set(c.declModules || []), drawn: (id) => (c.drawnPrefix ? id.startsWith(c.drawnPrefix) : false) || drawn.has(id) };
}
const NONE = { own: new Set(), decl: new Set(), drawn: () => false, marker: 'localize' };
const CODE_EXT = /\.(mjs|js|cjs|ts|tsx|jsx)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|vendor|vendored|fixtures?|testdata|generated|coverage|profiles|datasets?|scripts|\.git)\//;
const TABLE_FILE = /(^|\/)[^/]*(words|texts|messages|copy|strings|labels|glossary|vocabulary)[^/]*\.m?js$/i;
// Drawn screens are written first by the design and read their words only through word(); a marker call there fails the check.
const KEY_RE = /^[a-z][a-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;
const ERROR_CALLEE = /(^|\.)\w*Error$/;
const TITLE_CALLEE = /^(test|it|describe|suite|before|after)(\.\w+)?$/;
// the argument index of an assertion's message (node:assert): compared with nothing, so never a sentence copy (bio K4053)
const ASSERT_MESSAGE_AT = Object.fromEntries([
  ...['assert', 'assert.ok'].map((c) => [c, 1]),
  ...['equal', 'notEqual', 'strictEqual', 'notStrictEqual', 'deepEqual', 'notDeepEqual', 'deepStrictEqual', 'notDeepStrictEqual', 'match', 'doesNotMatch']
    .map((c) => [`assert.${c}`, 2]),
]);
const BUILTIN_ERRORS = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError']);
const REGEX_PREV_KW = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await']);

// ---- scanner: JS tokens with line numbers; comments dropped; strings and templates decoded ----------------------
export function scan(src) {
  const toks = [];
  let line = 1;
  const n = src.length;
  const ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
  function readEscape(i, out) { // src[i] === '\\'
    const c = src[i + 1];
    if (c === 'u') {
      if (src[i + 2] === '{') { const e = src.indexOf('}', i); out.push(String.fromCodePoint(parseInt(src.slice(i + 3, e), 16) || 63)); return e + 1; }
      out.push(String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16) || 63)); return i + 6;
    }
    if (c === 'x') { out.push(String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16) || 63)); return i + 4; }
    if (c === '\n') { line++; return i + 2; }
    out.push(ESC[c] ?? c); return i + 2;
  }
  function template(i, startLine) { // src[i] is the char after the opening backtick; returns index after closing backtick
    const out = []; let interp = false;
    while (i < n) {
      const c = src[i];
      if (c === '`') { toks.push({ t: 'str', v: out.join(''), line: startLine, tpl: true, interp }); return i + 1; }
      if (c === '\\') { i = readEscape(i, out); continue; }
      if (c === '$' && src[i + 1] === '{') {
        interp = true; out.push('{}');
        const saveLen = toks.length;
        i = code(i + 2, true);
        toks.length = saveLen; // the expression's tokens belong to no sentence
        continue;
      }
      if (c === '\n') line++;
      out.push(c); i++;
    }
    return i;
  }
  function code(i, nested) { // scans until the `}` closing a `${`, when nested; else to the end
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const stop = e < 0 ? n : e + 2; for (let k = i; k < stop; k++) if (src[k] === '\n') line++; i = stop; continue; }
      if (c === '#' && src[i + 1] === '!' && i === 0) { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '"' || c === "'") {
        const out = []; const startLine = line; i++;
        while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i = readEscape(i, out); else out.push(src[i++]); }
        i++; toks.push({ t: 'str', v: out.join(''), line: startLine }); continue;
      }
      if (c === '`') { i = template(i + 1, line); continue; }
      if (c === '/') {
        const prev = toks[toks.length - 1];
        const regexOk = !prev || (prev.t === 'p' && !')]}'.includes(prev.v)) || (prev.t === 'id' && REGEX_PREV_KW.has(prev.v));
        if (regexOk) { // a regex literal
          let inClass = false; i++; const rxStart = i;
          while (i < n && src[i] !== '\n') { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') inClass = true; else if (d === ']') inClass = false; else if (d === '/' && !inClass) break; i++; }
          const rxEnd = i;
          i++; while (/[a-z]/.test(src[i] || '')) i++;
          toks.push({ t: 're', v: '/', rx: src.slice(rxStart, rxEnd), line }); continue;
        }
      }
      if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++; toks.push({ t: 'id', v: src.slice(i, j), line }); i = j; continue; }
      if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; toks.push({ t: 'num', v: src.slice(i, j), line }); i = j; continue; }
      if (c === '{') depth++;
      if (c === '}') { if (nested && depth === 0) return i + 1; depth--; }
      toks.push({ t: 'p', v: c, line }); i++;
    }
    return i;
  }
  code(0, false);
  return toks;
}

// Literal chains: a maximal run of two or more pure string literals (no `${}`) joined only by `+` is one literal, at the
// first one's line, so a sentence written as `"The record could not be read, " + "so nothing was shown."` is judged whole.
// A chain with any other operand (`x + "a" + "b"`, `"a" + "b" + x`, `"a" + "b".trim()`, `"a" + "b" * 2`) is left as the scanner gave it.
const NOT_LITERAL_PREV = '+-*/%.';
const NOT_LITERAL_NEXT = '.([*/%-+';
export function foldLiteralChains(toks) {
  const pure = (x) => x && x.t === 'str' && !x.interp;
  const plus = (x) => x && x.t === 'p' && x.v === '+';
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const prev = toks[k - 1];
    if (pure(t) && plus(toks[k + 1]) && pure(toks[k + 2]) && !(prev && prev.t === 'p' && NOT_LITERAL_PREV.includes(prev.v))) {
      let j = k;
      while (plus(toks[j + 1]) && pure(toks[j + 2])) j += 2;
      const nx = toks[j + 1];
      if (!(nx && nx.t === 'p' && NOT_LITERAL_NEXT.includes(nx.v))) {
        let v = '', tpl = false;
        for (let i = k; i <= j; i += 2) { v += toks[i].v; tpl = tpl || !!toks[i].tpl; }
        out.push({ t: 'str', v, line: t.line, ...(tpl ? { tpl: true, interp: false } : {}) });
        k = j; continue;
      }
    }
    out.push(t);
  }
  return out;
}

// Adds `ctx` to each string token: { importPath, error, console, title, callee } from its enclosing call.
export function withContext(toks) {
  const stack = [];
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t === 'p' && '([{'.includes(tk.v)) {
      let callee = null;
      if (tk.v === '(') {
        const p = toks[k - 1];
        if (p && p.t === 'id' && !['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await'].includes(p.v)) {
          callee = p.v; let j = k - 1;
          while (toks[j - 1] && toks[j - 1].t === 'p' && toks[j - 1].v === '.' && toks[j - 2] && toks[j - 2].t === 'id') { callee = `${toks[j - 2].v}.${callee}`; j -= 2; }
        }
      }
      stack.push({ open: tk.v, callee, args: 0 });
    } else if (tk.t === 'p' && ')]}'.includes(tk.v)) stack.pop();
    else if (tk.t === 'p' && tk.v === ',' && stack.length && stack[stack.length - 1].open === '(') stack[stack.length - 1].args++;
    else if (tk.t === 'str') {
      const ctx = {};
      const p = toks[k - 1];
      if (p && p.t === 'id' && (p.v === 'from' || p.v === 'import')) ctx.importPath = true;
      for (let s = stack.length - 1; s >= 0; s--) {
        const f = stack[s];
        if (f.open === '{') break;
        if (f.open === '(' && f.callee) {
          ctx.callee = f.callee;
          if (ERROR_CALLEE.test(f.callee)) ctx.error = true;
          if (BUILTIN_ERRORS.has(f.callee.split('.').pop())) ctx.dev = true;
          if (/^console\./.test(f.callee)) ctx.console = true;
          if (f.callee === 'require' || f.callee === 'import') ctx.importPath = true;
          if (TITLE_CALLEE.test(f.callee) && toks[k - 1] && toks[k - 1].v === '(') ctx.title = true;
          // an assertion's message argument, the whole argument, is compared with nothing: never a copy (bio K4053)
          const at = ASSERT_MESSAGE_AT[f.callee];
          const nx = toks[k + 1];
          if (s === stack.length - 1 && at !== undefined && f.args === at && toks[k - 1] && toks[k - 1].v === ',' && nx && nx.t === 'p' && (nx.v === ')' || nx.v === ',')) ctx.assertMsg = true;
          break;
        }
      }
      tk.ctx = ctx;
    }
  }
  return toks;
}

// Stitched sentences: a `+` chain is the maximal run of operands joined by `+` at one bracket depth within one expression.
// Approximation: the chain is cut at `, ; = ? : & | < > !`, at `+=`, at the keywords in CHAIN_CUT, and at any bracket;
// a bracketed group, call or member access inside an operand makes that operand non-literal (one `{}`). An operand is a
// literal only when it is exactly one string token (a template literal counts as its text, `{}` for each ${}).
// A chain counts only when one literal piece has 3+ words of its own. Limits: operator precedence is not modelled (`a + b * 'x'` is one chain), `?:` branches and `||` alternatives each
// start a new chain, and a `+` that is arithmetic on numbers beside a literal reads as concatenation.
const CHAIN_CUT = new Set(['return', 'throw', 'case', 'yield', 'else', 'do', 'in', 'of', 'void', 'delete', 'await']);
export function stitchedChains(toks) {
  const out = [];
  const frames = [{ ops: [], cur: [] }];
  const flush = (f) => {
    const operands = [...f.ops, f.cur];
    if (f.ops.length && operands.every((o) => o.length)) {
      const lit = (o) => o.length === 1 && o[0].t === 'str';
      if (operands.some(lit) && operands.some((o) => !lit(o))) {
        let text = '';
        for (const o of operands) { if (lit(o)) text += o[0].v; else if (!text.endsWith('{}')) text += '{}'; }
        out.push({ line: operands[0][0].line, text, lits: operands.filter(lit).map((o) => o[0]) });
      }
    }
    f.ops = []; f.cur = [];
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], f = frames[frames.length - 1];
    if (t.t === 'p' && '([{'.includes(t.v)) { f.cur.push({ t: 'grp', line: t.line }); frames.push({ ops: [], cur: [] }); continue; }
    if (t.t === 'p' && ')]}'.includes(t.v)) { if (frames.length > 1) { flush(frames.pop()); } continue; }
    if (t.t === 'p' && t.v === '+') {
      const nx = toks[k + 1];
      if (nx && nx.t === 'p' && (nx.v === '=' || nx.v === '+')) { flush(f); k++; continue; } // += and ++
      if (!f.cur.length) continue; // unary
      f.ops.push(f.cur); f.cur = []; continue;
    }
    if ((t.t === 'p' && ',;=?:&|<>!'.includes(t.v)) || (t.t === 'id' && CHAIN_CUT.has(t.v))) { flush(f); continue; }
    f.cur.push(t);
  }
  while (frames.length) flush(frames.pop());
  return out;
}

// ---- the heuristics -------------------------------------------------------------------------------------------------
const SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|WITH|BEGIN|COMMIT|ROLLBACK|REPLACE)\b/;
const WORDISH = /^["'(\[]*(?:[A-Za-z][A-Za-z'’-]*|\{[A-Za-z0-9_]*\})[.,;:!?)"'\]]*$/;

// The shared exclusions of isSentence and isPlainSentence: the normalised text and its tokens when the string has
// `minWords`+ wordish tokens and is not a URL, SQL, CSS, code or mostly placeholders; else null.
function readable(raw, minWords) {
  let s = raw;
  if (/<\/?[A-Za-z][^>]*>/.test(s)) s = s.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  s = s.replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 12) return null;
  if (/:\/\/|^\/|^\.\.?\//.test(s) || SQL.test(s)) return null;
  if (/[;{][^}]*:[^}]*;|[a-z-]+:\s*[^;]+;\s*[a-z-]+:/.test(s) && !/[.?!]$/.test(s)) return null; // CSS
  const toks = s.split(' ');
  const wordish = toks.filter((t) => WORDISH.test(t));
  if (wordish.length < minWords || wordish.length < toks.length * 0.7) return null;
  if (toks.some((t) => /[=<>|\\]|\w\.\w+\(|=>/.test(t))) return null; // code-like token
  if (toks.filter((t) => /^[A-Z]{2,}$/.test(t)).length >= 2 && /\b(JOIN|WHERE|FROM|SELECT|ORDER|GROUP|LIMIT|INTO|VALUES|AND|ON)\b/.test(s) && !/[.!]$/.test(s)) return null; // SQL
  if (toks.filter((t) => /^\{\}$|^\?$/.test(t)).length * 2 >= toks.length) return null; // mostly placeholders
  return { s, toks, wordish };
}

// Is this string a member-facing English sentence? (Context exclusions are applied by the caller.)
export function isSentence(raw) {
  const r = readable(raw, 4);
  if (!r) return false;
  const { s, toks } = r;
  const first = toks[0].replace(/^["'(\[]+/, '');
  const capital = /^[A-Z]/.test(first) && !/^[A-Z0-9_]+$/.test(first.replace(/[^A-Za-z0-9_]/g, '')); // not a CONSTANT_CODE
  const endsPunct = /[.?!]["')\]]*$/.test(s);
  const placeholder = /\{[A-Za-z0-9_]*\}/.test(s);
  return capital || endsPunct || placeholder;
}

// A plain sentence (bio K3957): what isSentence rejects, yet 5+ wordish tokens of lowercase, unpunctuated prose such as a
// `why:` reason a member can read. Not a fragment (no leading or trailing whitespace) and not an identifier or reference
// (no backtick, R12 / DEC-83 / K3957 / N4, ALL-CAPS word of 3+ letters, or `_` inside a token). Used only by the inline arm.
export function isPlainSentence(raw) {
  if (isSentence(raw) || /^\s|\s$/.test(raw)) return false;
  const r = readable(raw, 5);
  if (!r) return false;
  const { s, toks } = r;
  if (!/^[a-z]/.test(toks[0].replace(/^["'(\[]+/, ''))) return false;
  if (/`|\b(?:R\d+|DEC-\d+|K\d+|N\d+)\b|\b[A-Z]{3,}\b/.test(s)) return false;
  return !toks.some((t) => t.includes('_'));
}

// An exact copy counts when it is a phrase: 3+ words, or 2 words and 18+ characters (not 'a person', not a name).
const isCopyLen = (v) => { const w = v.trim().split(/\s+/).length; return w >= 3 || (w === 2 && v.length >= 18); };

function excerpt(v) {
  const s = v.replace(/\s+/g, ' ').trim();
  return JSON.stringify(s.length > 70 ? s.slice(0, 67) + '...' : s);
}

// ---- product knowledge ------------------------------------------------------------------------------------------------
export function loadWords(root) {
  const S = snapshot(root);
  const C = wordsConfig(S) || {}, table = C.table ? S.read(C.table) : null;
  if (table === null) return { keys: new Set(), ens: new Map(), blob: '', codes: new Set(), codeKeys: new Set() };
  const rows = JSON.parse(table).words || [];
  const keys = new Set(), ens = new Map(), codes = new Set();
  for (const r of rows) {
    keys.add(r.key);
    if (typeof r.en === 'string') ens.set(r.en, r.key);
    const m = /^refusal\.([A-Za-z0-9_]+)$/.exec(r.key);
    if (m) codes.add(m[1]);
  }
  const blob = '\n' + [...ens.keys()].join('\n') + '\n';
  const codeKeys = new Set();
  const g = C.rows ? S.read(C.rows) : null;
  if (g !== null) for (const m of g.matchAll(/^\s*\["([^"\\]+)",/gm)) codeKeys.add(m[1]);
  return { keys, ens, blob, codes, codeKeys };
}
// N2-10: the key a copied sentence lives under: the row whose `en` it is, or the first row whose `en` holds it.
export function keyOf(words, text) {
  if (words.ens.has(text)) return words.ens.get(text);
  for (const [en, key] of words.ens) if (en.includes(text)) return key;
  return null;
}

// op name -> owning module id (or null when the declarations give no owner). From `build/ops.json` (an array of names,
// or an object name -> owner) and the product's op declarations: `OPS` names every op, `OP_FAMILIES[family].{kinds,acts,
// proposals,reads,extra}` name the family's ops, and the family key is the owning module.
export async function loadOpNames(root) {
  const S = snapshot(root);
  const names = new Map();
  const j = S.read('build/ops.json');
  if (j !== null) {
    const d = JSON.parse(j);
    if (Array.isArray(d)) for (const x of d) names.set(x, null); else for (const [k, v] of Object.entries(d)) names.set(k, v);
  }
  // The declarations are code, imported from the commit (R10, K23): the file and the relative imports it reaches, as the
  // commit holds them, written to a scratch directory and imported from there; the working tree is never read.
  const od = (wordsConfig(S) || {}).opDeclarations;
  if (od && S.read(od) !== null) {
    const dir = mkdtempSync(join(tmpdir(), 'words-ops-'));
    try {
      const files = new Set(S.files), todo = [od], done = new Set();
      while (todo.length) {
        const f = todo.pop();
        if (done.has(f)) continue;
        done.add(f);
        const text = S.read(f);
        if (text === null) continue;
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        writeFileSync(join(dir, f), text);
        for (const spec of importsOf(text)) { const t = resolveImport(files, f, spec); if (t) todo.push(t); }
      }
      const m = await import(`${pathToFileURL(join(dir, od)).href}?commit=${S.commit}`);
      for (const k of Object.keys(m.OPS || {})) if (!names.has(k)) names.set(k, null);
      const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v) : []);
      for (const [fam, v] of Object.entries(m.OP_FAMILIES || {})) {
        for (const fld of ['kinds', 'acts', 'proposals', 'reads', 'extra']) for (const o of list(v?.[fld])) if (typeof o === 'string' && !names.get(o)) names.set(o, v.owner || fam);
      }
    } catch { /* declarations unreadable: the ops arm degrades */ } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return names;
}

// The design's own list of inline strings no member reads (words-reads.json `unkeyed`), per module, placeholders normalised.
export function loadUnkeyed(root) {
  const S = snapshot(root);
  const r = (wordsConfig(S) || {}).reads, text = r ? S.read(r) : null;
  const out = new Map();
  if (text === null) return out;
  let j; try { j = JSON.parse(text); } catch { return out; }
  for (const [id, e] of Object.entries(j.modules || {})) {
    if ((e.unkeyed || []).length) out.set(id, '\n' + e.unkeyed.map((u) => String(u.text).replace(/\$?\{[^}]*\}/g, '{}')).join('\n') + '\n');
  }
  return out;
}

function generatedFromManifest(S) {
  const files = new Set();
  const text = S.read('build/manifest.md');
  if (text === null) return { files };
  const at = text.indexOf('## Generated artifacts');
  if (at < 0) return { files };
  const rest = text.slice(at + 5), end = rest.search(/\n## /);
  for (const row of (end < 0 ? rest : rest.slice(0, end)).split('\n')) {
    if (!row.startsWith('|')) continue;
    const first = row.split('|')[1] || '';
    for (const m of first.matchAll(/`([^`]+)`/g)) { const f = m[1]; if (/\.(mjs|js)$/.test(f) && f.includes('/')) files.add(f); }
  }
  return { files };
}

function isGeneratedText(src) {
  const head = src.slice(0, 1200);
  return /\bGENERATED\b|generated (by|from)\b|do not edit( it)? by hand|DO NOT EDIT/i.test(head);
}


// ---- the check --------------------------------------------------------------------------------------------------------
const ASSERTISH = /^assert|includes$|\.has$|^has$|match$|^ok$/;
const RX_CALLS = new Set(['match', 'doesNotMatch', 'test', 'exec', 'search']);
// the prose fragments of a regex source: literal runs of 12+ characters with two words in them
const rxFragments = (rx) => rx.replace(/\\(.)/g, '$1').split(/[\[\]()|?*+{}^$]|\.(?=[*+?])/).map((x) => x.trim()).filter((x) => /[A-Za-z]+ [A-Za-z]+/.test(x) && x.length >= 12);
export function loadBaseline(root) {
  const S = snapshot(root);
  const b = (wordsConfig(S) || {}).baseline, text = b ? S.read(b) : null;
  if (text === null) return null;
  try { const j = JSON.parse(text); return { files: j.files || {} }; } catch { return { files: {} }; }
}

export async function checkWords(root, only = [], { release = false, record = false } = {}) {
  const S = snapshot(root);
  const C = wordsConfig(S) || NONE, MARKER = C.marker, DRAWN_MODULES = C.drawn, OWN_WORDS_MODULES = C.own, OWN_DECL_MODULES = C.decl;
  const READS_JSON = C.reads || null, UNREVIEWED_JSON = C.unreviewed || null;
  const state = readModules(S);
  const words = loadWords(S);
  const ops = await loadOpNames(S);
  const owner = ownerIndex(state);
  const outside = notProduct(state);
  const gen = generatedFromManifest(S);
  const unkeyed = loadUnkeyed(S);
  let designUnkeyed = 0; // inline strings on the design's unkeyed list, not counted (bio K3944)
  const files = S.files;
  const { findings, add: found } = finder('words');
  const counts = {}; // module -> arm -> n
  const bump = (m, arm, tag) => { const c = (counts[m] ??= { inline: 0, testenglish: 0, testcopy: 0, missingkey: 0, handlist: 0, marker: 0, unreviewed: 0, q: 0, plain: 0 }); c[arm]++; if (tag === '?') c.q++; if (tag === 'plain') c.plain++; };
  const items = []; // the failures with their full literal, for tools that analyse them
  // `wordKey`: the key a copied sentence lives under (N2-10), named in the finding so the test reads it by that key
  const add = (arm, m, file, line, tag, text, raw, wordKey = null, why = null) => { items.push({ arm, module: m, file, line, tag, raw: raw ?? text, wordKey }); found(arm, { module: m, file, line, tag: tag || null, wordKey, why, raw: raw ?? text }, `${arm} ${m} ${file}:${line} ${tag ? `[${tag}] ` : ''}${text}${wordKey ? ` -> key ${wordKey}` : ''}`); bump(m, arm, tag); };
  let literals = 0;
  let englishNow = null; // file -> count of testenglish candidates, for --baseline
  const tIds = new Map(); // t id -> { en, where } of its first use
  const tReads = new Set(); // the string tokens given as a t call's id and en
  const codeEns = new Map(); // the en of every marker call in product source (bio K3962) -> its id
  const baseline = record ? { files: {} } : loadBaseline(root); // null: the arm is off until the product records one
  const engTests = []; // testenglish candidates: { m, f, line, frags }
  const codeTests = []; // test strings not yet judged against codeEns: { m, f, s }
  let dev = 0; // sentences given to built-in error constructors: developer text, not failures
  const ownLits = new Map(); // module -> Set of string values in its own product source (a code is its own when its source names it)
  const lists = []; // handlist candidates, judged once every module's own source has been read
  const modsSeen = new Set();

  // A key a module declares by a `localize(id, en)` or `t(id, en)` call in its own source is a word `word(key)` answers
  // once the rows are regenerated at merge: `missingkey` does not judge it, so a job's tests can read its own new keys
  // before the merge regenerates the rows (bio K5583).
  const declared = new Set();
  for (const f of files) {
    if (!CODE_EXT.test(f) || SKIP_DIR.test(f) || outside(f) || !owner(f)) continue;
    const src = S.read(f); if (src === null) continue;
    if (isGeneratedText(src)) continue;
    for (const m of src.matchAll(/(?<![\w.$])(?:localize|t)\(\s*(["'`])([A-Za-z][\w.-]*)\1\s*,/g)) declared.add(m[2]);
  }

  for (const f of files) {
    if (!CODE_EXT.test(f) || SKIP_DIR.test(f) || outside(f)) continue;
    const o = owner(f);
    if (!o) continue;
    const m = state.modules.find((x) => x.id === o.module);
    if (only.length && !only.includes(m.id)) continue;
    const isTest = o.role === 'tests';
    if (!isTest && OWN_WORDS_MODULES.has(m.id)) continue;
    const src = S.read(f);
    if (src === null) continue;
    if (!isTest && (gen.files.has(f) || isGeneratedText(src))) { const set = ownLits.get(m.id) ?? ownLits.set(m.id, new Set()).get(m.id); for (const t of scan(src)) if (t.t === 'str') set.add(t.v); continue; }
    if (isGeneratedText(src)) continue;
    modsSeen.add(m.id);
    const toks = withContext(foldLiteralChains(scan(src)));
    const strs = toks.filter((t) => t.t === 'str');
    literals += strs.length;
    if (!isTest) { const set = ownLits.get(m.id) ?? ownLits.set(m.id, new Set()).get(m.id); for (const t of strs) set.add(t.v); }

    // missingkey: literal keys given to word/hasWord/wordsOf
    for (let k = 0; k < toks.length - 3; k++) {
      const t = toks[k];
      if (t.t === 'id' && (t.v === 'word' || t.v === 'hasWord' || t.v === 'wordsOf') && toks[k + 1].v === '(' && toks[k + 1].t === 'p') {
        const a = toks[k + 2];
        if (a.t === 'str' && !a.interp && KEY_RE.test(a.v) && words.keys.size && !words.keys.has(a.v) && !words.codeKeys.has(a.v) && !declared.has(a.v)) {
          const next = toks[k + 3];
          const sameLine = toks.filter((x) => x.line === a.line && x.t === 'id').map((x) => x.v);
          const negated = (toks[k - 1] && toks[k - 1].v === '!') || sameLine.some((x) => ['false', 'throws', 'notOk', 'rejects', 'UNKNOWN_WORD', 'WORD_ROWS'].includes(x)) || /no[._ -]?such|nonesuch|nonexist|not[._-]a[._-]key|unknown|\bzz\b/i.test(a.v); // a test of the refusal itself
          if (next && (next.v === ')' || next.v === ',') && !negated) add('missingkey', m.id, f, a.line, '', a.v);
        }
      }
    }

    // marker: t(id, en, vars) calls
    const plain = (x) => x && x.t === 'str' && !x.interp;
    const endsArg = (x) => x && x.t === 'p' && (x.v === ',' || x.v === ')');
    // A bare marker call is the reading only where the file imports the marker FROM the word list's own module (a source
    // path ending in its name or `<name>/index.mjs`): a product's tests may bind the same name to node:test's `test` and other helpers. Any other
    // binding of `t` (default import, `x as t`, another module, a local declaration) is neither a marker nor an exempt
    // reading. A member call `.t(` is not judged.
    let hasT = false;
    for (let k = 0; k < toks.length && !hasT; k++) {
      if (!(toks[k].t === 'id' && toks[k].v === 'import' && toks[k + 1] && toks[k + 1].v === '{')) continue;
      let j = k + 2, named = false;
      for (; j < toks.length && toks[j].v !== '}'; j++) if (toks[j].t === 'id' && toks[j].v === MARKER && !['as'].includes(toks[j - 1].v) && !(toks[j + 1] && toks[j + 1].v === 'as')) named = true;
      const from = toks[j + 1], src = toks[j + 2];
      if (named && from && from.v === 'from' && src && src.t === 'str' && C.wordsModule && new RegExp(`(^|/)${C.wordsModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/index\\.mjs)?$`).test(src.v)) hasT = true;
    }
    // The word list's own module (OWN_WORDS_MODULES) tests the marker's refusals on purpose: its `t` calls are not judged.
    for (let k = 0; hasT && !OWN_WORDS_MODULES.has(m.id) && k < toks.length - 1; k++) {
      const t = toks[k];
      if (toks[k - 1] && toks[k - 1].t === 'p' && toks[k - 1].v === '.') continue;
      if (!(t.t === 'id' && t.v === MARKER && toks[k + 1].t === 'p' && toks[k + 1].v === '(')) continue;
      if (toks[k - 1] && toks[k - 1].t === 'id' && ['function', 'async'].includes(toks[k - 1].v)) continue; // a definition
      const a = toks[k + 2], b = toks[k + 4];
      const idOk = plain(a) && endsArg(toks[k + 3]), enOk = idOk && toks[k + 3].v === ',' && plain(b) && endsArg(toks[k + 5]);
      if (idOk) tReads.add(a);
      if (enOk) tReads.add(b);
      if (enOk && !isTest && !codeEns.has(b.v)) codeEns.set(b.v, a.v);
      if (DRAWN_MODULES(m.id)) add('marker', m.id, f, t.line, '', `${MARKER} call in a drawn-screen module (read by word())`, undefined, null, 'drawn');
      if (!idOk) { add('marker', m.id, f, t.line, '', `${MARKER} id is not a plain string literal`, undefined, null, 'id-not-literal'); continue; }
      if (!KEY_RE.test(a.v)) add('marker', m.id, f, a.line, '', `${MARKER} id ${excerpt(a.v)} is not <module>.<area>.<name>`, undefined, null, 'id-malformed');
      if (!enOk) { add('marker', m.id, f, t.line, '', `${MARKER}(${excerpt(a.v)}, en): en is not a plain string literal`, undefined, null, 'en-not-literal'); continue; }
      const prev = tIds.get(a.v);
      if (!prev) tIds.set(a.v, { en: b.v, where: `${f}:${a.line}` });
      else if (prev.en !== b.v) add('marker', m.id, f, a.line, '', `${MARKER} id ${excerpt(a.v)} has a different en than at ${prev.where}`, undefined, null, 'two-en');
    }

    if (isTest) {
      // testcopy
      for (const s of strs) {
        if (s.ctx.importPath || s.ctx.title || s.ctx.console || s.ctx.assertMsg) continue;
        const last = (s.ctx.callee || '').split('.').pop();
        if (tReads.has(s) || /^(word|hasWord|wordsOf)$/.test(last) || (hasT && last === MARKER)) continue;
        const v = s.v;
        if (s.interp) { // static chunks between placeholders
          let hit = false;
          for (const chunk of v.split('{}')) if (chunk.length >= 25 && !chunk.includes('\n') && words.blob.includes(chunk)) { add('testcopy', m.id, f, s.line, '', excerpt(chunk), undefined, keyOf(words, chunk)); hit = true; break; }
          if (!hit) codeTests.push({ m: m.id, f, s });
          continue;
        }
        if (words.ens.has(v) && isCopyLen(v)) add('testcopy', m.id, f, s.line, '', excerpt(v), undefined, keyOf(words, v));
        else if (v.length >= 25 && !v.includes('\n') && words.blob.includes(v)) add('testcopy', m.id, f, s.line, 'part', excerpt(v), undefined, keyOf(words, v));
        else codeTests.push({ m: m.id, f, s });
      }
      // testenglish candidates (bio K5426): an assertion-position sentence, or a regex given to a match/test call, whose prose is a
      // words.json value or sits in a module's product source; judged below once every product source has been read
      if (baseline) {
        for (const s of strs) {
          if (s.ctx.importPath || s.ctx.title || s.ctx.console || s.ctx.assertMsg || !ASSERTISH.test(s.ctx.callee || '')) continue;
          const last = (s.ctx.callee || '').split('.').pop();
          if (tReads.has(s) || /^(word|hasWord|wordsOf)$/.test(last) || (hasT && last === MARKER) || !isSentence(s.v)) continue;
          engTests.push({ m: m.id, f, line: s.line, frags: s.v.split('{}').map((x) => x.trim()).filter((x) => x.length >= 12) });
        }
        for (let k = 0; k < toks.length; k++) {
          if (toks[k].t !== 're') continue;
          const near = toks.filter((x) => x.line === toks[k].line && x.t === 'id').map((x) => x.v);
          if (!near.some((x) => RX_CALLS.has(x))) continue;
          const frags = rxFragments(toks[k].rx);
          if (frags.length) engTests.push({ m: m.id, f, line: toks[k].line, frags });
        }
      }
      // handlist: array literals of 5+ strings
      if (!OWN_DECL_MODULES.has(m.id) && !OWN_WORDS_MODULES.has(m.id)) {
        for (let k = 0; k < toks.length; k++) {
          if (toks[k].t !== 'p' || toks[k].v !== '[') continue;
          const items = []; let j = k + 1, ok = true;
          while (j < toks.length) {
            const x = toks[j];
            if (x.t === 'str' && !x.interp) items.push(x.v);
            else { ok = false; break; }
            const y = toks[j + 1];
            if (y && y.t === 'p' && y.v === ',') { j += 2; if (toks[j] && toks[j].t === 'p' && toks[j].v === ']') break; continue; }
            if (y && y.t === 'p' && y.v === ']') break;
            ok = false; break;
          }
          if (!ok || items.length < 5) continue;
          lists.push({ m: m.id, f, line: toks[k].line, items });
        }
      }
    } else {
      // inline
      const table = TABLE_FILE.test(f);
      const stitched = new Set();
      for (const ch of stitchedChains(toks)) {
        if (!isSentence(ch.text) || !ch.lits.some((l) => l.v.trim().split(/\s+/).filter(Boolean).length >= 3)) continue; // scaffolding between placeholders is not a sentence
        if (ch.lits.some((l) => l.ctx.importPath || l.ctx.console || l.ctx.title)) continue;
        for (const l of ch.lits) stitched.add(l);
        if (ch.lits.some((l) => l.ctx.dev)) { dev++; continue; }
        // the design's unkeyed list holds joined text too: not counted, as in the arm below (bio K3944; UX-DESIGN U376)
        const joined = ch.text.trim().replace(/\$?\{[^}]*\}/g, '{}');
        if (joined.length >= 10 && (unkeyed.get(m.id) || '').includes(joined)) { designUnkeyed++; continue; }
        add('inline', m.id, f, ch.line, 'stitched', excerpt(ch.text), ch.text);
      }
      for (const s of strs) {
        const c = s.ctx;
        if (stitched.has(s) || tReads.has(s) || c.importPath || c.console || c.title) continue;
        const v = s.v;
        const isCopy = !s.interp && words.ens.has(v) && isCopyLen(v);
        const plainOnly = !isCopy && !isSentence(v);
        if (plainOnly && (s.interp || !isPlainSentence(v))) continue;
        if (c.dev) { if (!plainOnly) dev++; continue; }
        const dec = v.trim().length >= 10 && (unkeyed.get(m.id) || '').includes(v.trim().replace(/\$?\{[^}]*\}/g, '{}'));
        // The design's unkeyed list (DEC-258, DEC-260: "`unkeyed` stays in source") is text the design keeps in code: not
        // counted. A row copy it names is kept on purpose (signed text whose words a live row also holds, K1333): not
        // counted either; an unlisted copy still is (bio K3944, K4038; UX-DESIGN U380).
        if (dec) { if (!plainOnly) designUnkeyed++; continue; }
        const tag = plainOnly ? 'plain' : isCopy ? 'copy' : table ? 'table' : c.error ? '?' : '';
        add('inline', m.id, f, s.line, tag, excerpt(v), v);
      }
    }
  }

  // testcopy against the marker calls of product source (bio K3962), judged once every product file has been read
  // a substring copy holds a space: an identifier (a placeholder's or an export's name) is no sentence (bio K3967)
  if (codeEns.size) {
    const codeBlob = '\n' + [...codeEns.keys()].join('\n') + '\n';
    const idOf = (t) => codeEns.get(t) ?? [...codeEns].find(([en]) => en.includes(t))?.[1] ?? null;
    for (const { m, f, s } of codeTests) {
      if (s.ctx && s.ctx.assertMsg) continue;
      const v = s.v;
      if (s.interp) {
        for (const chunk of v.split('{}')) if (chunk.length >= 25 && /\s/.test(chunk.trim()) && !chunk.includes('\n') && codeBlob.includes(chunk)) { add('testcopy', m, f, s.line, 'code', excerpt(chunk), undefined, idOf(chunk)); break; }
      } else if ((codeEns.has(v) && isCopyLen(v)) || (v.length >= 25 && /\s/.test(v.trim()) && !v.includes('\n') && codeBlob.includes(v))) add('testcopy', m, f, s.line, 'code', excerpt(v), undefined, idOf(v));
    }
  }

  // handlist: an array of 5+ strings, 80%+ of them one kind (ops, codes, keys), the kind's items named by no source of the test's own module
  for (const { m, f, line, items } of lists) {
    const own = ownLits.get(m) ?? new Set();
    const kinds = { ops: (x) => ops.has(x), codes: (x) => words.codes.has(x), keys: (x) => words.keys.has(x) };
    for (const [kind, is] of Object.entries(kinds)) {
      const hit = items.filter(is);
      const foreign = hit.filter((x) => (kind === 'ops' && ops.get(x) ? ops.get(x) !== m : !own.has(x)));
      if (hit.length >= items.length * 0.8 && foreign.length >= 5) {
        add('handlist', m, f, line, kind === 'keys' ? '' : '?', `${kind}: ${foreign.slice(0, 3).join(', ')}, ... (${foreign.length} of ${items.length} not the module's own)`, undefined, null, kind);
        break;
      }
    }
  }

  // missingkey: words-reads.json (the design's list of the keys each module reads), global and per-module files
  const checkReads = (rel, text, scopeModule) => {
    let j; try { j = JSON.parse(text); } catch { return; }
    const lines = text.split('\n');
    const lineOf = (key) => { const i = lines.findIndex((l) => l.includes(`"${key}"`)); return i < 0 ? 1 : i + 1; };
    const entries = j.modules ? Object.entries(j.modules) : [[scopeModule, j]];
    for (const [id, e] of entries) {
      if (!id || (only.length && !only.includes(id))) continue;
      if (!state.modules.some((x) => x.id === id)) continue;
      modsSeen.add(id);
      for (const key of e.reads || []) {
        if (key === '*' || !words.keys.size || words.keys.has(key)) continue;
        add('missingkey', id, rel, lineOf(key), '', key);
      }
    }
  };
  if (READS_JSON && S.read(READS_JSON) !== null) checkReads(READS_JSON, S.read(READS_JSON));
  for (const f of files) if (basename(f) === 'words-reads.json' && f !== READS_JSON && !SKIP_DIR.test(f)) {
    const o = state.modules.find((x) => (x.paths || []).some((p) => (p.endsWith('/') ? f.startsWith(p) : p === f)));
    if (o) checkReads(f, S.read(f), o.id);
  }

  if (release && UNREVIEWED_JSON && S.read(UNREVIEWED_JSON) !== null) {
    let u = []; try { u = JSON.parse(S.read(UNREVIEWED_JSON)).unreviewed || []; } catch { /* unreadable: no rows */ }
    for (const r of u) if (!only.length || only.includes(r.module)) add('unreviewed', r.module, r.file, r.line, '', r.id);
  }
  // testenglish: the product's own literals are now all read; a candidate counts when a prose fragment is a word's value or product text
  const idOfCode = (t) => codeEns.get(t) ?? [...codeEns].find(([en]) => en.includes(t))?.[1] ?? null;
  if (baseline) {
    const productBlob = '\n' + [...ownLits.values()].flatMap((x) => [...x]).join('\n') + '\n';
    const perFile = new Map();
    for (const c of engTests) if (c.frags.some((x) => words.blob.includes(x) || productBlob.includes(x))) (perFile.get(c.f) ?? perFile.set(c.f, []).get(c.f)).push(c);
    for (const [f, cs] of perFile) {
      const allowed = baseline.files[f] ?? 0;
      if (cs.length <= allowed) continue;
      for (const c of cs) add('testenglish', c.m, f, c.line, allowed ? `grew ${allowed} to ${cs.length}` : 'new', excerpt(c.frags[0]), undefined, c.frags.map((x) => keyOf(words, x) ?? idOfCode(x)).find(Boolean) ?? null);
    }
    englishNow = Object.fromEntries([...perFile].map(([f, cs]) => [f, cs.length]).sort());
  }
  findings.sort((a, b) => (a.finding < b.finding ? -1 : a.finding > b.finding ? 1 : 0));
  const failures = findings.map((x) => x.finding);
  const tot = { inline: 0, testenglish: 0, testcopy: 0, missingkey: 0, handlist: 0, marker: 0, unreviewed: 0, q: 0, plain: 0 };
  for (const c of Object.values(counts)) for (const k of Object.keys(tot)) tot[k] += c[k];
  const summary = `${modsSeen.size} modules, ${literals} string literals read, ${words.keys.size} words; inline ${tot.inline}, plain ${tot.plain}, testcopy ${tot.testcopy}, missingkey ${tot.missingkey}, handlist ${tot.handlist} (${tot.q} tagged ?), marker ${tot.marker}${release ? `, unreviewed ${tot.unreviewed}` : ''}, dev ${dev}, unkeyed ${designUnkeyed}${baseline ? `, testenglish ${tot.testenglish}` : ''}`;
  return { findings, failures, summary, counts, totals: { ...tot, dev, unkeyed: designUnkeyed }, items, englishNow };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const { failures, summary, englishNow } = await checkWords(args.find((a) => !a.startsWith('--')) || '.', args.filter((a) => !a.startsWith('--')).slice(1), { release: args.includes('--release'), record: args.includes('--baseline') });
  if (args.includes('--baseline')) { console.log(JSON.stringify({ files: englishNow || {} }, null, 1)); process.exit(0); }
  process.exitCode = report('words', failures, summary);
}
