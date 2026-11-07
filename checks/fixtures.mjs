// Check 6, fixtures (bio rulings K4990, K4993 (2), K4995, K4996; plan F9 §7 item 7): measures that no module's test
// hand-builds another module's answer or a stub of another module's interface, and that no test names a refusal code
// that no product source gives. DRAFT (bio K4993 (2)): not run by checks/run.mjs; its text binds only when Bob approves it (K1258).
// Candidates are found mechanically over the whole tree, so the list, not a sample, is the audit's coverage (K4996).
// Files read: tracked JS/TS files under a module's `tests` paths and under test-support's `paths` (the harness), never
// node_modules, dist, vendored code or generated files. Source = tracked files under the `paths` of every module but
// test-support. Three classes, each failure reported as `<class> <user module> <file>:<line> [tag] <excerpt> -> <provider>`:
//   answer    an object literal of another module's answer shape (tag = the shape): `ok` with `reason`, `detail`, `refusal`,
//             `error` or `failure_class` (refusal, `ok` written as true or false); `ok` with `done`, `final`, `outstanding` or `waiting_on` (owed);
//             an `extent` whose value opens `{ kind` (extent; not where the literal is the argument of a member call, an input). A literal that is an argument of an assert/expect call is an
//             expected value, not a hand-built answer, and is skipped. A literal whose `reason` code only the user module's
//             own source gives is the user's own shape and is skipped. Tag `invented <CODE>` when its code is in no source.
//   stub      (1) an identifier named *Stub, *Fake, *Double, fake*, stub* or double* (camel-case word), once per file and name, at
//             its first declaration, import or use (tag `decl`, `import`, `use`); (2) a function standing in for a service
//             of INTERFACE_NAMES (registerJob, readHeld, armJobs, owedLater, keepLater, deliver, partsOf, ...) that the user
//             module's own source does not define: `x.name = ...`, `name: <function>`, `name(...) {` in an object, or a
//             declaration `function name` / `const name` in the test (tag `stand-in`). A call of the real service is no stand-in.
//   code      a string literal shaped like a refusal code (UPPER_SNAKE with an underscore) given as a `reason`, `code`, `error`,
//             `failure_class`, `refusal` or `why` (key, or the other operand of a comparison or assertion) in a test, found
//             in no source file at all. Not reported again where it sits inside a flagged `answer` literal (that carries tag `invented`).
// Tightening (second pass): an `extent` literal is an answer only inside a stub or double's body or value, or given as the argument of a call
// of one, never as data passed in; a refusal/owed literal that is a direct argument of a member call or of a helper imported from another
// module (a real provider or the harness) is an input, not an answer (a Response.json, resolve/reject or stub call still builds one); names in
// PLATFORM_DOUBLE (FakeDate, fakeBinding, alarmDouble, and fake/stub/double or *Stub/*Fake/*Double of Date, Clock, Timers, Fetch, R2, DO, KV, Bucket,
// Binding, Alarm, Storage, Miniflare, Workerd, ...) are never stubs; a bare local `stub`/`fake`/`double` counts only where its value or its
// `stub.name =` assignments name another module's exported name (6+ characters; tag `spy standing in <name>`); a code literal that the file both
// feeds in (outside an assertion) and asserts (inside one) is pass-through data: not class `code`, and not an `invented` tag.
// Third pass: a bare spy's exported name must be compound (not one lower-case word such as `settings`); an answer literal inside the arguments of a
// plug-in registrar call (`register*`, `on*`, but not a listed seam) is the user's own code; a literal that is a direct argument of a function the user
// module imports from its OWN product source is an input; a code under a data key (`why`, `data`, `meta`, `payload`, `extra`, `fields`, `input`,
// `args`, `params`) is data, and `why` is no longer a code key.
// Fourth pass: a refusal/owed literal nested in an object or list that is itself the argument of such an input call is an input; a `why`-keyed
// `ok` literal (no `reason`) and a `code` in an object pushed into a list (`findings.push({ code })`) are the module's own data; a stub or double name
// imported from the user's own product source is its own double and skipped.
// K5044 (the T51 fixture audit's rules). (1) Skipped as not another module's answer: a platform double (a named stub whose value has a `fetch`
// member, i.e. a Durable Object or store double, with its `{ok, result}` wrapper and trap branches; fakeCtx, installRuntime, loadWorker; stubSdk,
// stubClaude; a `{head, get, put}` bucket; a `{calls, binding}` double; an IndexedDB double by name; the literals inside any `fetch` stand-in);
// a fault injection (a stand-in whose body only throws, never settles `new Promise(() => {})`, returns undefined, or returns a nameless
// `{ok:false}`); a delegating wrapper or spy (its body calls the same-named function of another object); a pass-through (an answer literal whose
// code the same test also asserts, as for codes; a raw `{ok:false, error: e.stack|e.message}`; a lower_snake `reason`, a provider's vocabulary);
// the user's own seam (a literal handed through `.transact(`, the user's own export or a local wrapper of it, or under a `check`/`validate`
// key); harness-own values (test-support's own tests, its generators `*gen.mjs`/corpus/seeded/make-*, an object naming `test-shell`, stub names
// imported from the user's own tests); a name clash (a local `function deliver` never handed in as a value; `double_`/`fake_`/`stub_` snake_case
// keys); an expected value held in a variable used only inside assertions. A template `PREFIX_${..}` in source gives every code with that prefix.
// (2) `// fixtures-generic: <CODE>` on the candidate's line or up to MARK_SPAN lines above accepts a code made up on purpose (an invented code, a
// sentinel; class code too); a code it does not name stays a finding; a marker that covers no candidate fails (class contract, tag `idle-generic`).
// (3a) A local builder (a test function whose body builds a refusal or owed literal whose reason/code/error is a parameter) is reported at EACH
// call site, tag `builder <name>` (+ `invented <CODE>`), provider resolved from the code argument; its own literal is then not reported.
// (3b) A scripted op table: an object literal key that is a product op name, with a value (function or object) that builds an `{ok: ..}` answer,
// is one answer finding per entry, tag `op-table <op>`, provider the module declaring the op (the user's own op: skipped). Op names are read from
// product source (not test-support): the top-level keys of `DECLARED_OPS = Object.freeze({..})`, and of the object a function named `<x>Ops`
// returns at its own top level (`answersOps(..) { return { rule: .., .. } }`); a value that holds a further op table is judged at its entries.
// (4) A `fixtures-contract` marker in a test-support (harness) file covers the whole value (declaration) that follows it, and every import of
// that value in other modules' tests; the provider's tests must carry `// fixtures-run: test-support <id>`, as for any contract.
// V3 (K5044 read against the live list of the T51 tip: the audit's FALSE lines the check still listed). Fixes of K5044 (1): a stand-in written `async (..) =>` is
// read as a function (a fault when it only throws, counts or answers nothing, `() => ({})` included); the absence of a service (`x.owedLater = undefined`) and a
// list of faults (`for (const keepLater of [undefined, async () => { throw }])`) are faults; a spy that calls the product code the test imports (and builds no
// answer), or an alias of the original taken from the same object, a restore of the original and a name bound to a fault are no stand-in; a call through a
// namespace import (`U.run(..)`), a name bound by `await import(..)`, a loop name the table binds to the user's own exports, and the module under test as a
// test's own loader binds it (`export const M = await import(<own source>)`) are the user's own export; a test's own assertion helper (`(label, got, want)`)
// makes its `want` an expectation; an expected value is judged in the scope of its declaration; a code fed in as an object key and asserted back is a
// pass-through, and so is a row of a case table (`for (const [body, status] of [..])`) whose name is asserted back as an operand in the loop (not a message,
// not a comparison, not computed over) or handed to the user's own code, unless the table holds a code only later modules give (a contract table, K4995) or
// the row copies a whole answer (`check` or `translation`); the seams of (1) hold for a bare code (a transaction's callback, a `check` key, a code handed to
// the user's own export as data, a table row) but not a fetch stand-in's invented code; a stack written out (`Error: ..\n at ..`, or a name holding one) is
// a raw platform error; a code from a provider's own function (`staleBaseRefusal().reason`) or data (`Object.entries(CHECKS)`) is built by the provider; plain
// data held in a `const` and handed to the user's own export is an input; `ERR_*` is the platform's vocabulary; the script handed to a platform double's factory is
// the double's. Names: a SQL handle, a fake time quantity (`fakeMs`), a stub got from `ns.get(ns.idFromName(..))` or made by a platform factory are platform.
// Markers: `// fixtures-generic: WORD` (K5044 (2)) names any word, not only an UPPER_SNAKE code, and an answer whose code is built or held in a name, or empty,
// is covered by any marker in reach; a stand-in is covered by the codes in it; `// fixtures-own: <platform|input|harness|synthetic> <why>` accepts what it covers
// (any class, same reach) for a double the audit read and found to be no module's answer and no rule can say so (a failing marker: class contract, `idle-own`).
// Provider: for a code, the modules whose source holds it; for a stub name, the modules whose files declare it (an import
// resolves to the module owning the file; STAND_FOR maps jobRegistrarStub to registerJob); for a stand-in, the modules whose
// source defines the service. Shown as `-> <modules> (earlier|later|mixed)` against the user's position in build/modules.json
// (array order), or `-> ?` when none is found. `--list` also prints the modules the file imports.
// THE CONTRACT MARKER (bio K4995): a hand-built answer or stub is accepted, not reported, only where its provider is LATER in
// modules.json than its user and a test of that provider runs it. The user marks the hand-built value with a line comment on
// the line of the candidate or up to MARK_SPAN lines above it (the nearest marker above a candidate is the one that covers it):
//     // fixtures-contract: <provider-module> <contract-id>
// (an object literal with `ok` written as true or false, starting on the marker's line or up to MARK_SPAN lines below it, is covered by the marker even
// when no rule classes it as an answer: a seam's `{ ok: true, rows, next }`; an unmarked one is no candidate)
// and a file under the provider's `tests` runs the contract against the provider's real code and says so with
//     // fixtures-run: <user-module> <contract-id>
// (<contract-id>: letters, digits, `.`, `-`, `_`; one id names one contract, which may cover many candidates). A marker whose
// provider is not later fails (tag `contract-not-later`: use the provider's published fixture, K4990), as does one the provider
// does not run (`contract-no-run`), one naming an unknown module (`contract-unknown-provider`), one covering no candidate
// (class `contract`, tag `idle`), and a `fixtures-run` no user marks (class `contract`, tag `orphan-run`). Class `code` is never accepted.
// Usage: node checks/fixtures.mjs <product-root> [module ...] [--list]
//   --list prints every candidate (accepted ones too) as `<class> <user> <file>:<line> <status> <tag> <provider> imports:<modules> <excerpt>`
//   for the reading workers, then the summary, and exits 0.
// Every finding carries its key (the class), module (the user), file and line (R3; build/requirements/architecture.md);
// the check reads the product at a commit (R10); its rules are as they stood at the module's N2 START (R9).
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshot, readModules, ownerIndex, notProduct, report } from './lib.mjs';
import { scan } from './words.mjs';

const CODE_EXT = /\.(mjs|js|cjs|ts|tsx|jsx)$/;
const TEXT_EXT = /\.(mjs|js|cjs|ts|tsx|jsx|json|jsonc|html|css|sql|toml|yml|yaml)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|vendor|vendored|generated|coverage|\.git)\//;
const MAX_BYTES = 3 << 20;
export const MARK_SPAN = 8; // a contract marker covers its own line and this many lines below it
export const INTERFACE_NAMES = ['registerJob', 'readHeld', 'armJobs', 'owedLater', 'keepLater', 'deliver', 'partsOf',
  'deliverOwedRender', 'owedFetch', 'owedRun', 'homeOf', 'registerHolds', 'accountFor']; // the audit's seams (K4990, K4995)
export const STAND_FOR = { jobRegistrarStub: 'registerJob' }; // a named stub whose interface its name does not say
const STUB_WORD = /^(fake|stub|double)([A-Z0-9_]|$)|[a-z0-9_](Stub|Fake|Double)([A-Z0-9_]|$)|^(Stub|Fake|Double)([A-Z0-9_]|$)/;
// Platform doubles (bio K4996 tightening): stand-ins for the platform, not another module's interface; never reported as stubs.
export const PLATFORM_DOUBLE = /^(FakeDate|fakeBinding|alarmDouble|(fake|stub|double|mock)(Date|Clock|Timers?|Now|Ms|Millis|Time|Fetch|R2|DO|Do|KV|Bucket|Binding|Bindings|Alarm|Storage|Miniflare|Workerd|Crypto|Random|Sleep)([A-Z0-9_]\w*)?|\w*([Dd]ate|[Cc]lock|[Ff]etch|R2|DO|KV|[Bb]ucket|[Bb]inding|[Aa]larm|[Mm]iniflare|[Ww]orkerd)(Stub|Fake|Double))$/;
// K5044 (1): further platform names (the Workers runtime, ctx and loader; the Agent SDK and CLI; the Durable Object and store doubles the ruling names)
// (the Durable Object and store doubles, such as stubOf, fakeStore, newStub, stubFor, dumbStub, bootstrapStub, acquireStub, stubStore, stubOver,
// are found by their value: a `fetch` member)
export const PLATFORM_NAMES = new Set(['fakeCtx', 'installRuntime', 'loadWorker', 'stubSdk', 'stubClaude']);
const PLATFORM_EXTRA = /^(fake|stub|double|mock)(Ctx|Context|Sdk|Cli|Claude|Runtime|Loader|Idb|IndexedDb|IndexedDB|Sql|SQL|Sqlite)([A-Z0-9_]\w*)?$|^(Idb|IDB|IndexedDb|IndexedDB|Sql|SQL|Sqlite)\w*(Stub|Fake|Double)$|^\w*([Ss]ql|SQL|[Ss]qlite)(Stub|Fake|Double)$/;
const SNAKE_DATA = /^(fake|stub|double)_[a-z0-9_]*$/; // a snake_case data key (`double_speak_or_reversal`), no double
const IDB_NAME = /idb|indexeddb/i;
const GENERATOR_FILE = /(^|\/)([\w-]*gen|corpus|seeded|make-[\w-]+)\.m?js$/; // test-support's generators: their vocabulary is their own
const LOWER_SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/; // an external provider's reason vocabulary (`overloaded_error`)
const CHECK_KEYS = new Set(['check', 'validate']); // the user's own seam: a literal under one of these keys
const GENERIC_RE = /\/\/\s*fixtures-generic:\s*([\w.-]+)/;
const OWN_RE = /\/\/\s*fixtures-own:\s*(platform|input|harness|synthetic)\s+(\S.*)$/; // V3: a double the audit read and found to be no module's answer, declared where it stands
const TEMPLATE_PREFIX_RE = /([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_)\$\{/g; // `BAD_${name}`: a code the product builds
const BARE_SPY = /^(stubs?|fakes?|doubles?)$/; // a local spy: counts only where it stands in for another module's exported name
const HAND_BUILDER = /(^|\.)(json|resolve|reject|resolves|rejects|mockResolvedValue|mockReturnValue)$|^Response$/;
const CODE_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const STACK_TEXT = /^\w*Error: [\s\S]*|[\s\S]*\n\s+at \S/; // V3: a thrown error's stack written out in a test (`Error: boom\n    at Store.fetch (store.mjs:1:1)`)
const WORDLIKE = /^[A-Za-z0-9_.-]{1,60}$/; // V3: a reason/code/error string of any shape that a marker or a pass-through can name
const CODE_IN_TEXT = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const CODE_KEYS = new Set(['reason', 'code', 'error', 'failure_class', 'refusal']);
const DATA_KEYS = new Set(['why', 'data', 'meta', 'payload', 'extra', 'fields', 'input', 'args', 'params']); // an object under one of these is data, its `code` a field
const PLUGIN_CALLEE = /^(register[A-Z]\w*|on[A-Z]\w*)$/; // a plug-in registrar (`promotion.registerStep`, `onAlarm`): what is handed to it is the user's own code
const GENERIC_EXPORT = /^[a-z]+$/; // an exported name of one lower-case word (`settings`, `config`) is a common property name, not a seam
const REFUSAL_KEYS = ['reason', 'detail', 'refusal', 'error', 'failure_class'];
const OWED_KEYS = ['done', 'final', 'outstanding', 'waiting_on'];
const EXPECT_CALLEE = /^(assert|expect)(\.|$)|\.(assert|deepEqual|deepStrictEqual|strictEqual|notStrictEqual|notDeepEqual|notDeepStrictEqual|equal|notEqual|match|doesNotMatch|rejects|doesNotReject|throws|doesNotThrow|ok|partialDeepStrictEqual|toEqual|toBe|toMatchObject)$/;
const CONTRACT_RE = /\/\/\s*fixtures-contract:\s*([\w.-]+)\s+([\w.-]+)/;
const RUN_RE = /\/\/\s*fixtures-run:\s*([\w.-]+)\s+([\w.-]+)/;
const OPEN = '([{', CLOSE = ')]}';
// the index of the last token of the value that starts at j (up to a top-level `,`, `;` or the closing bracket)
function valueEnd(toks, match, j) {
  while (j < toks.length) {
    const t = toks[j];
    if (t.t === 'p' && OPEN.includes(t.v)) { if (match[j] < 0) return j; j = match[j] + 1; continue; }
    if (t.t === 'p' && (CLOSE.includes(t.v) || t.v === ',' || t.v === ';')) return j - 1;
    j++;
  }
  return j - 1;
}
// the token range [a, b] of the function or value a name at k is bound to (`function n() {}`, `n = ..`, `n: ..`, `n() {}`), else null
function regionFrom(toks, match, k) {
  const p = toks[k - 1], nx = toks[k + 1];
  if (nx && nx.t === 'id' && nx.v === 'of' && p && p.t === 'id' && /^(const|let|var)$/.test(p.v) && isP(toks[k - 2], '(') && toks[k - 3] && toks[k - 3].v === 'for' && match[k - 2] > 0) return [k + 2, match[k - 2] - 1]; // V3: `for (const name of <list>)`: the list it takes its values from
  if (p && p.t === 'id' && (p.v === 'function' || p.v === 'class' || (p.v === 'async' && toks[k - 2] && toks[k - 2].v === 'function'))) {
    let j = k + 1; if (isP(toks[j], '(') && match[j] > 0) j = match[j] + 1;
    return isP(toks[j], '{') && match[j] > 0 ? [k, match[j]] : null;
  }
  if (isP(nx, '=') && !isP(toks[k + 2], '=')) return [k + 2, valueEnd(toks, match, k + 2)];
  if (isP(nx, ':')) return [k + 2, valueEnd(toks, match, k + 2)];
  if (isP(nx, '(') && match[k + 1] > 0 && isP(toks[match[k + 1] + 1], '{') && match[match[k + 1] + 1] > 0) return [k, match[match[k + 1] + 1]];
  return null;
}

// ---- token helpers -----------------------------------------------------------------------------------------------
// match[k] = index of the bracket closing the one at k (or -1); parent[k] = index of the innermost bracket open at k.
function brackets(toks) {
  const match = new Int32Array(toks.length).fill(-1);
  const parent = new Int32Array(toks.length).fill(-1);
  const stack = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    parent[k] = stack.length ? stack[stack.length - 1] : -1;
    if (t.t === 'p' && OPEN.includes(t.v)) stack.push(k);
    else if (t.t === 'p' && CLOSE.includes(t.v) && stack.length) { const o = stack.pop(); match[o] = k; parent[k] = stack.length ? stack[stack.length - 1] : -1; }
  }
  return { match, parent };
}
const isP = (t, v) => t && t.t === 'p' && t.v === v;
// the callee text of the call whose `(` is at k: `assert.deepEqual`, `run`; null when the paren only groups
function calleeOf(toks, k) {
  const prev = toks[k - 1];
  if (!prev || prev.t !== 'id') return null;
  let s = prev.v, j = k - 2;
  while (j >= 1 && isP(toks[j], '.') && toks[j - 1].t === 'id') { s = `${toks[j - 1].v}.${s}`; j -= 2; }
  if (/^(if|for|while|switch|catch|function|return|typeof|await|in|of)$/.test(s)) return null;
  return s;
}
let ASSERT_HELPERS = new Map(); // V3: a test's own assertion helpers (`const t = (label, got, want) => ..`) -> the position of the expected value, set per file
const isExpect = (callee) => EXPECT_CALLEE.test(callee) || ASSERT_HELPERS.has(callee);
function argIndex(toks, match, parent, q, u) { // the position of the argument of the call opening at q that holds token u
  let arg = 0;
  for (let j = q + 1; j < u; j++) { const t = toks[j]; if (t.t === 'p' && OPEN.includes(t.v) && match[j] > 0 && match[j] < u) { j = match[j]; continue; } if (isP(t, ',') && parent[j] === q) arg++; }
  return arg;
}
function insideExpectation(toks, parent, k, match) {
  for (let p = parent[k]; p >= 0; p = parent[p]) {
    if (!isP(toks[p], '(')) continue;
    const callee = calleeOf(toks, p);
    if (!callee) continue;
    if (EXPECT_CALLEE.test(callee)) return true;
    const want = ASSERT_HELPERS.get(callee); // an assertion helper of the test: only its expected value is an expectation
    return want !== undefined && match && argIndex(toks, match, parent, p, k) === want;
  }
  return false;
}
// the top-level keys of the object literal opening at k, with the index of each key's value
function objectKeys(toks, match, k) {
  const end = match[k];
  const keys = new Map();
  let j = k + 1;
  while (j < end) {
    const t = toks[j];
    if (isP(t, ',')) { j++; continue; }
    if (isP(t, '.')) { // `...expr`: a spread is no key; skip its expression
      j += 3;
      while (j < end && !isP(toks[j], ',')) { const u = toks[j]; j = (u.t === 'p' && OPEN.includes(u.v) && match[j] > 0) ? match[j] + 1 : j + 1; }
      continue;
    }
    if (t.t === 'p' && OPEN.includes(t.v)) { j = (match[j] < 0 ? end : match[j]) + 1; continue; }
    if (t.t === 'id' || t.t === 'str' || t.t === 'num') {
      let name = t.v, at = j;
      if (t.v === 'async' && toks[j + 1] && toks[j + 1].t === 'id' && isP(toks[j + 2], '(')) { name = toks[j + 1].v; at = j + 1; j++; }
      const nx = toks[at + 1];
      if (isP(nx, ':')) { keys.set(name, at + 2); j = at + 2; }
      else if (isP(nx, ',') || at + 1 >= end) { keys.set(name, -1); j = at + 1; }
      else if (isP(nx, '(')) { keys.set(name, at + 1); j = at + 1; } // method shorthand
      else j = at + 1;
      // skip the value up to the next top-level comma
      while (j < end && !isP(toks[j], ',')) { const u = toks[j]; j = (u.t === 'p' && OPEN.includes(u.v) && match[j] > 0) ? match[j] + 1 : j + 1; }
      continue;
    }
    j++;
  }
  return keys;
}
const isObjectStart = (toks, k) => {
  const p = toks[k - 1];
  if (!p) return false;
  if (p.t === 'p') return '(,=:[?&|!'.includes(p.v) && !(p.v === '=' && false);
  return p.t === 'id' && (p.v === 'return' || p.v === 'yield');
};

// ---- K5044 helpers: function bodies, fault injection, builders --------------------------------------------------
const arrowAt = (toks, j) => isP(toks[j], '=') && isP(toks[j + 1], '>');
// the inner token range [s, e] of the function whose text starts at a (`function f(..) {..}`, `async (..) => ..`, `x => ..`, `f(..) {..}`), else null
function fnBody(toks, match, a, b) {
  let j = a;
  if (toks[j] && toks[j].t === 'id' && toks[j].v === 'async' && (!isP(toks[j + 1], '(') || (match[j + 1] > 0 && arrowAt(toks, match[j + 1] + 1)))) j++; // `async x =>`, `async function`, and `async (..) =>` (V3)
  if (toks[j] && toks[j].t === 'id' && toks[j].v === 'function') { j++; if (toks[j] && toks[j].t === 'id') j++; }
  else if (toks[j] && toks[j].t === 'id' && !isP(toks[j + 1], '(')) { if (arrowAt(toks, j + 1)) return arrowBody(toks, match, j + 3, b); return null; }
  else if (toks[j] && toks[j].t === 'id' && isP(toks[j + 1], '(') && match[j + 1] > 0 && isP(toks[match[j + 1] + 1], '{')) j++; // method shorthand
  if (!isP(toks[j], '(') || match[j] < 0) return null;
  j = match[j] + 1;
  if (arrowAt(toks, j)) return arrowBody(toks, match, j + 2, b);
  return isP(toks[j], '{') && match[j] > 0 ? [j + 1, match[j] - 1] : null;
}
function arrowBody(toks, match, j, b) {
  if (isP(toks[j], '{') && match[j] > 0) return [j + 1, match[j] - 1];
  return [j, Math.max(j, b)];
}
// does the token range [s, e] read `new Promise(() => {})` (never settles)
function neverSettles(toks, s, e) {
  for (let j = s; j <= e; j++) if (toks[j].t === 'id' && toks[j].v === 'new' && toks[j + 1] && toks[j + 1].v === 'Promise' && isP(toks[j + 2], '(') && isP(toks[j + 3], '(') && isP(toks[j + 4], ')') && arrowAt(toks, j + 5) && isP(toks[j + 7], '{') && isP(toks[j + 8], '}')) return true;
  return false;
}
// a stand-in that is a fault: its body only throws, never settles, returns undefined, or returns a nameless `{ok:false}`
function isFaultFn(toks, match, parent, a, b, literalFault) {
  const body = fnBody(toks, match, a, b);
  if (!body) return false;
  const [s, e] = body;
  if (s > e) return true; // an empty body
  if (e === s && toks[s].t === 'id' && toks[s].v === 'undefined') return true;
  if (e - s === 3 && isP(toks[s], '(') && isP(toks[s + 1], '{') && isP(toks[s + 2], '}') && isP(toks[s + 3], ')')) return true; // V3: `() => ({})` answers nothing
  if (neverSettles(toks, s, e)) return true;
  let throws = false, valueReturn = false, anyReturn = false;
  for (let j = s; j <= e; j++) {
    const t = toks[j];
    if (t.t !== 'id') continue;
    if (t.v === 'throw') throws = true;
    if (t.v === 'return') { anyReturn = true; const n = toks[j + 1]; if (n && !(isP(n, ';') || isP(n, '}') || (n.t === 'id' && n.v === 'undefined'))) valueReturn = true; }
  }
  if (!isP(toks[s - 1], '{')) { // an expression body: a value, not a statement list
    return literalFault ? literalFault(s, e) : false;
  }
  if (throws && !valueReturn) return true;
  if (!valueReturn && !throws) return true; // nothing returned: undefined
  return literalFault ? literalFault(s, e) : false;
}
// the parameter names of the function whose parameter list opens at j, by position (a destructured parameter holds several names)
function paramNames(toks, match, j) {
  const out = [[]]; const end = match[j];
  for (let q = j + 1; q < end; q++) {
    const t = toks[q];
    if (isP(t, ',')) { out.push([]); continue; }
    if (t.t === 'p' && OPEN.includes(t.v) && match[q] > 0) { for (let r = q + 1; r < match[q]; r++) if (toks[r].t === 'id') out[out.length - 1].push(toks[r].v); q = match[q]; continue; }
    if (t.t === 'id') out[out.length - 1].push(t.v);
    if (isP(t, '=')) { while (q + 1 < end && !isP(toks[q + 1], ',')) { q++; const u = toks[q]; if (u.t === 'p' && OPEN.includes(u.v) && match[q] > 0) q = match[q]; } }
  }
  return out;
}
// where the function text of the declaration whose name is at k starts (`function` or `async` before the name, or the token after `=`)
function declFnStart(toks, k) {
  const p = toks[k - 1];
  if (p && p.t === 'id' && p.v === 'function') return toks[k - 2] && toks[k - 2].v === 'async' ? k - 2 : k - 1;
  return k + 2;
}
// the parameter list opening of the function declared with its name at k (`function f(`, `const f = (`, `const f = async x =>`), as { open, params } or null
function declParams(toks, match, k) {
  const p = toks[k - 1];
  if (!p || p.t !== 'id') return null;
  if (p.v === 'function' || (p.v === 'async' && toks[k - 2] && toks[k - 2].v === 'function')) return isP(toks[k + 1], '(') && match[k + 1] > 0 ? { open: k + 1, params: paramNames(toks, match, k + 1) } : null;
  if (!/^(const|let|var)$/.test(p.v) || !isP(toks[k + 1], '=')) return null;
  let j = k + 2;
  if (toks[j] && toks[j].t === 'id' && toks[j].v === 'async' && !arrowAt(toks, j + 1)) j++;
  if (toks[j] && toks[j].t === 'id' && toks[j].v === 'function') { j++; if (toks[j] && toks[j].t === 'id') j++; return isP(toks[j], '(') && match[j] > 0 ? { open: j, params: paramNames(toks, match, j) } : null; }
  if (isP(toks[j], '(') && match[j] > 0 && arrowAt(toks, match[j] + 1)) return { open: j, params: paramNames(toks, match, j) };
  if (toks[j] && toks[j].t === 'id' && arrowAt(toks, j + 1)) return { open: -1, params: [[toks[j].v]] };
  return null;
}

// K5044 (3b): the op names a product source declares. Method: the top-level keys of the object `DECLARED_OPS = Object.freeze({..})` holds,
// and the top-level keys of the object literal an ops-map function (a function or arrow named `<x>Ops`, e.g. `answersOps(a, url, body)`,
// not `...DeclaredOps`) returns, at its own body's top level (`return {..}` or `=> ({..})`), never keys of a nested arrow's reply.
function collectOps(text, module, opMods) {
  let toks;
  try { toks = scan(text); } catch { return; }
  const { match, parent } = brackets(toks);
  const add = (k) => { for (const name of objectKeys(toks, match, k).keys()) { let st = opMods.get(name); if (!st) opMods.set(name, (st = new Set())); st.add(module); } };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'id') continue;
    if (t.v === 'DECLARED_OPS' && isP(toks[k + 1], '=')) {
      for (let j = k + 2; j < k + 8 && j < toks.length; j++) if (isP(toks[j], '{')) { if (match[j] > 0) add(j); break; }
    } else if (/[a-z]Ops$/.test(t.v) && !/DeclaredOps$/.test(t.v) && !isP(toks[k - 1], '.')) {
      const dp = declParams(toks, match, k);
      if (!dp) continue;
      const body = fnBody(toks, match, declFnStart(toks, k), k + 2);
      if (!body) continue;
      const [s, e] = body;
      if (!isP(toks[s - 1], '{')) { if (isP(toks[s], '(') && isP(toks[s + 1], '{') && match[s + 1] > 0) add(s + 1); continue; }
      for (let j = s; j <= e; j++) if (toks[j].t === 'id' && toks[j].v === 'return' && isP(toks[j + 1], '{') && parent[j] === s - 1 && match[j + 1] > 0) add(j + 1);
    }
  }
}

// ---- the check -----------------------------------------------------------------------------------------------------
export function checkFixtures(root, only = []) {
  const S = snapshot(root);
  const state = readModules(S);
  const owner = ownerIndex(state);
  const outside = notProduct(state);
  const order = new Map(state.modules.map((m, i) => [m.id, i]));
  const files = S.files;
  const fileSet = new Set(files);
  const read = (f) => S.read(f) ?? '';

  // 1. product source: refusal codes and interface definitions by module
  const codeMods = new Map(); // code -> Set(module)
  const defMods = new Map(); // interface name -> Set(module)
  const exportMods = new Map(); // exported name (6+ characters) -> Set(module) of product source
  const prefixMods = new Map(); // K5044: PREFIX_ of a template `PREFIX_${..}` -> Set(module): matches any code with that prefix
  const opMods = new Map(); // K5044 (3b): op name -> Set(module) whose source declares it (DECLARED_OPS keys and the object an `...Ops` function returns)
  const ownersOf = (code) => { // the modules whose source gives a code, literally or by a template prefix
    let out = codeMods.get(code);
    for (const [pre, set] of prefixMods) if (code.startsWith(pre) && code.length > pre.length) { out = new Set([...(out || []), ...set]); }
    return out;
  };
  const defRes = INTERFACE_NAMES.map((n) => [n, new RegExp(`(?:function\\*?\\s+${n}\\b|(?:const|let|var|class)\\s+${n}\\b|(?<![.\\w])${n}\\s*[:=](?!=)\\s*(?:async\\b|function\\b|\\()|^\\s*(?:async\\s+)?${n}\\s*\\([^)]*\\)\\s*\\{)`, 'm')]);
  for (const f of files) {
    if (!TEXT_EXT.test(f) || SKIP_DIR.test(f) || outside(f)) continue;
    const o = owner(f);
    if (!o || o.role !== 'code' || o.module === 'test-support') continue;
    const text = read(f);
    if (text.length > MAX_BYTES) continue;
    for (const m of text.matchAll(TEMPLATE_PREFIX_RE)) if (m[1].length >= 4) { let s2 = prefixMods.get(m[1]); if (!s2) prefixMods.set(m[1], (s2 = new Set())); s2.add(o.module); }
    if (CODE_EXT.test(f) && /DECLARED_OPS|[a-z]Ops\b/.test(text)) collectOps(text, o.module, opMods);
    for (const c of text.match(CODE_IN_TEXT) || []) { let s = codeMods.get(c); if (!s) codeMods.set(c, (s = new Set())); s.add(o.module); }
    if (CODE_EXT.test(f)) {
      const names = [...text.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
      for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const nm = part.split(/\s+as\s+/).pop().trim(); if (nm) names.push(nm); }
      for (const nm of names) if (nm.length >= 6) { let st = exportMods.get(nm); if (!st) exportMods.set(nm, (st = new Set())); st.add(o.module); }
    }
    if (CODE_EXT.test(f)) for (const [n, re] of defRes) if (text.includes(n) && re.test(text)) { let s = defMods.get(n); if (!s) defMods.set(n, (s = new Set())); s.add(o.module); }
  }

  // 2. the test files
  const testFiles = [];
  for (const f of files) {
    if (!CODE_EXT.test(f) || SKIP_DIR.test(f) || outside(f)) continue;
    const o = owner(f);
    if (!o) continue;
    if (o.role === 'tests' || o.module === 'test-support') testFiles.push({ f, module: o.module, role: o.role });
  }
  const fileOwnerModule = (f) => { const o = owner(f); return o ? o.module : null; };
  const resolveImport = (from, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = posix.normalize(posix.join(posix.dirname(from), spec));
    for (const c of [base, `${base}.mjs`, `${base}.js`, `${base}.ts`, `${base}/index.mjs`, `${base}/index.js`]) if (fileSet.has(c)) return c;
    return null;
  };

  const parsed = []; // { f, module, src, lines, toks, match, parent, imports: Map(name -> module), importMods: Set }
  const declMods = new Map(); // name (stub-like) -> Set(module) declaring it anywhere in the scanned files
  const contracts = []; // { user, file, line, provider, id }
  const runs = []; // { provider, file, line, user, id }
  const generics = []; // { user, file, line, code } K5044 (2): `// fixtures-generic: CODE`
  const owns = []; // { user, file, line, kind, note } V3: `// fixtures-own: <kind> <why>`
  for (const { f, module, role } of testFiles) {
    const src = read(f);
    if (src.length > MAX_BYTES) continue;
    let toks;
    try { toks = scan(src); } catch { continue; }
    const { match, parent } = brackets(toks);
    const lines = src.split('\n');
    const imports = new Map(); const importMods = new Set(); const importOwn = new Set(); // importOwn: names imported from the user's own product source
    const importFile = new Map(); const importTest = new Set(); // file each name is imported from; names imported from the user's own test files (K5044)
    const dynOwn = new Set(); // V3: names this file binds to the module's own source by a dynamic import
    const dynMixed = new Set(); // ... to the module's own source together with another module's
    let lastOwnSrc = false, lastFile = null, lastOwnTest = false;
    const importMod = (spec) => { const r = resolveImport(f, spec); const o = r ? owner(r) : null; const m = o ? o.module : null; lastFile = r; lastOwnTest = !!o && m === module && o.role === 'tests'; lastOwnSrc = !!o && m === module && o.role === 'code'; if (m && m !== module) importMods.add(m); return m; };
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === 'id' && t.v === 'from' && toks[k + 1] && toks[k + 1].t === 'str') {
        const m = importMod(toks[k + 1].v);
        // the names between `import` and `from`
        for (let j = k - 1; j >= 0 && !(toks[j].t === 'id' && toks[j].v === 'import'); j--) if (toks[j].t === 'id' && m) { imports.set(toks[j].v, m); importFile.set(toks[j].v, lastFile); if (lastOwnSrc) importOwn.add(toks[j].v); if (lastOwnTest) importTest.add(toks[j].v); }
      } else if (t.t === 'id' && (t.v === 'import' || t.v === 'require') && isP(toks[k + 1], '(') && toks[k + 2] && toks[k + 2].t === 'str') {
        const dm = importMod(toks[k + 2].v);
        { // V3: `const { f } = await import(spec)` binds names like a static import does
          let q = k - 1; while (q >= 0 && !(toks[q].t === 'id' && /^(const|let|var)$/.test(toks[q].v)) && !isP(toks[q], ';') && k - q < 40) q--;
          if (dm && q >= 0 && toks[q].t === 'id' && /^(const|let|var)$/.test(toks[q].v)) for (let j = q + 1; j < k && !isP(toks[j], '='); j++) if (toks[j].t === 'id') { imports.set(toks[j].v, dm); if (lastOwnSrc) importOwn.add(toks[j].v); }
        }
        if (lastOwnSrc) { // V3: `export const M = await import(<the module's own source>)`: the module under test, named for the tests that import it from this file
          let q = k - 1; while (q >= 0 && !(toks[q].t === 'id' && /^(const|let|var)$/.test(toks[q].v)) && !isP(toks[q], ';') && k - q < 40) q--;
          if (q >= 0 && toks[q].t === 'id' && /^(const|let|var)$/.test(toks[q].v)) {
            let end = k; while (end < toks.length && !isP(toks[end], ';') && end - k < 80 && !(toks[end].line > t.line + 1 && end > k + 8)) end++;
            let allOwn = true; // a name bound to the module's own source and another's (`{ ...(await import(a)), ...(await import(b)) }`) is not the module under test
            for (let j = q; j < end; j++) if (toks[j].t === 'id' && toks[j].v === 'import' && isP(toks[j + 1], '(') && toks[j + 2] && toks[j + 2].t === 'str') { const r = resolveImport(f, toks[j + 2].v); const o = r ? owner(r) : null; if (!(o && o.module === module && o.role === 'code')) allOwn = false; }
            if (allOwn) for (let j = q + 1; j < k && !isP(toks[j], '='); j++) if (toks[j].t === 'id') dynOwn.add(toks[j].v);
            if (!allOwn) for (let j = q + 1; j < k && !isP(toks[j], '='); j++) if (toks[j].t === 'id') dynMixed.add(toks[j].v);
          }
        }
      }
      else if (t.t === 'id' && t.v === 'import' && toks[k + 1] && toks[k + 1].t === 'str') importMod(toks[k + 1].v);
      if (t.t === 'id' && STUB_WORD.test(t.v)) {
        const p = toks[k - 1];
        const decl = (p && p.t === 'id' && /^(function|const|let|var|class)$/.test(p.v)) || (isP(toks[k + 1], ':') && p && p.t === 'p' && '{,'.includes(p.v));
        if (decl) { let s = declMods.get(t.v); if (!s) declMods.set(t.v, (s = new Set())); s.add(module); }
      }
    }
    lines.forEach((ln, i) => {
      let m = CONTRACT_RE.exec(ln); if (m) contracts.push({ user: module, file: f, line: i + 1, provider: m[1], id: m[2] });
      m = RUN_RE.exec(ln); if (m) runs.push({ provider: module, file: f, line: i + 1, user: m[1], id: m[2] });
      m = GENERIC_RE.exec(ln); if (m) generics.push({ user: module, file: f, line: i + 1, code: m[1] });
      m = OWN_RE.exec(ln); if (m) owns.push({ user: module, file: f, line: i + 1, kind: m[1], note: m[2] });
    });
    // K5044 (4): a marker in a harness file covers the whole value (declaration) that follows it, not only MARK_SPAN lines
    if (module === 'test-support' && role === 'code') for (const c of contracts) {
      if (c.file !== f || c.end) continue;
      let i = toks.findIndex((t) => t.line > c.line);
      if (i >= 0 && toks[i].t === 'id' && toks[i].v === 'export') i++;
      if (i >= 0 && toks[i] && toks[i].t === 'id' && /^(function|const|let|class|async)$/.test(toks[i].v)) {
        let nm = i + 1; if (toks[i].v === 'async') nm++;
        const r = toks[nm] ? regionFrom(toks, match, nm) : null;
        if (r) c.end = toks[r[1]].line;
      }
    }
    parsed.push({ f, module, role, src, lines, toks, match, parent, imports, importMods, importOwn, importFile, importTest, dynOwn, dynMixed });
  }
  { // V3: a name a test imports from a file of its own module's tests that binds it to the module's own source is the module under test
    const byFile = new Map(parsed.map((pf) => [pf.f, pf]));
    for (const pf of parsed) pf.mixedNs = new Set();
    for (const pf of parsed) for (const [name, file] of pf.importFile) { const h = file && byFile.get(file); if (h && h.module === pf.module && h.dynOwn.has(name)) pf.importOwn.add(name); if (h && h.module === pf.module && h.dynMixed.has(name)) pf.mixedNs.add(name); }
  }

  // K5044 (1): a named stub whose value has a `fetch` member is a Durable Object / store double: the platform's, never another module's
  const fetchMember = (toks, a, b) => {
    for (let j = a; j <= b; j++) {
      const t = toks[j];
      if (t.t !== 'id' || t.v !== 'fetch') continue;
      const p = toks[j - 1], nx = toks[j + 1];
      if ((isP(nx, ':') && p && p.t === 'p' && '{,'.includes(p.v)) || (isP(nx, '(') && p && ((p.t === 'p' && '{,'.includes(p.v)) || (p.t === 'id' && p.v === 'async'))) || (isP(p, '.') && isP(nx, '=') && !isP(toks[j + 2], '='))) return true;
    }
    return false;
  };
  const platNames = new Set(PLATFORM_NAMES);
  for (let pass = 0; pass < 2; pass++) for (const pf of parsed) {
    const { toks, match } = pf;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t !== 'id' || !STUB_WORD.test(t.v) || platNames.has(t.v)) continue;
      const r = regionFrom(toks, match, k);
      if (!r) continue;
      let plat = fetchMember(toks, r[0], r[1]);
      for (let j = r[0]; j <= r[1] && !plat; j++) if (toks[j].t === 'id' && toks[j].v === 'idFromName') plat = true; // V3: a Durable Object stub got from a namespace (`ns.get(ns.idFromName(..))`)
      if (!plat && toks[r[0]] && toks[r[0]].t === 'id' && platNames.has(toks[r[0]].v) && isP(toks[r[0] + 1], '(')) plat = true; // V3: a stub-named value made by a platform double's factory (`stub0: stubFor(0)`)
      if (plat) platNames.add(t.v);
    }
  }
  const isStubName = (v) => STUB_WORD.test(v) && !PLATFORM_DOUBLE.test(v) && !PLATFORM_EXTRA.test(v) && !SNAKE_DATA.test(v) && !platNames.has(v);
  const isPlatformName = (v) => PLATFORM_DOUBLE.test(v) || PLATFORM_EXTRA.test(v) || platNames.has(v) || IDB_NAME.test(v);

  // 3. candidates
  const cands = []; // { cls, user, file, line, tag, text, providers: [], imports: [], codes: [], note }
  const excerpt = (lines, line) => { const s = (lines[line - 1] || '').trim().replace(/\s+/g, ' '); return s.length > 100 ? `${s.slice(0, 97)}...` : s; };
  const mkProviders = (set, user) => [...(set || [])].filter((m) => m !== user).sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  const NAMELESS_KEYS = ['reason', 'code', 'failure_class', 'refusal'];
  for (const pf of parsed) {
    const { f, module: user, role, lines, toks, match, parent, imports, importMods, importOwn, importFile, importTest, mixedNs } = pf;
    if (only.length && !only.includes(user)) continue;
    ASSERT_HELPERS = new Map(); // a local function taking both what came out and what was expected is an assertion: its expected argument is an expectation
    for (let k = 0; k < toks.length; k++) { if (toks[k].t !== 'id') continue; const dp = declParams(toks, match, k); if (!dp) continue; const wi = dp.params.findIndex((a) => a.includes('want') || a.includes('expected')); if (wi >= 0 && dp.params.some((a) => a.includes('got') || a.includes('actual'))) ASSERT_HELPERS.set(toks[k].v, wi); }
    if (user === 'test-support' && (role === 'tests' || GENERATOR_FILE.test(f))) continue; // K5044 harness-own: test-support's own tests, and its generators' vocabulary
    const imp = [...importMods].sort();
    const add = (cls, line, tag, providers, extra = {}) => cands.push({ cls, user, file: f, line, tag, text: excerpt(lines, line), providers, imports: imp, codes: [], ...extra });
    const keyCache = new Map();
    const keysOf = (k) => { let v = keyCache.get(k); if (!v) keyCache.set(k, (v = objectKeys(toks, match, k))); return v; };
    const sectionsOf = (open) => { // the top-level comma sections of the bracket at open: [[from, to], ..]
      const out = []; let from = open + 1;
      for (let j = open + 1; j < match[open]; j++) { const u = toks[j]; if (u.t === 'p' && OPEN.includes(u.v) && match[j] > 0) { j = match[j]; continue; } if (isP(u, ',')) { out.push([from, j - 1]); from = j + 1; } }
      if (from < match[open]) out.push([from, match[open] - 1]);
      return out;
    };
    const idsIn = (a, b) => { const out = []; for (let j = a; j <= b; j++) if (toks[j].t === 'id' && !isP(toks[j - 1], '.')) out.push(toks[j].v); return out; };
    const codesIn = (a, b) => { const out = []; for (let j = a; j <= b; j++) if (toks[j].t === 'str' && CODE_RE.test(toks[j].v) && !out.includes(toks[j].v)) out.push(toks[j].v); return out; };
    const isNameless = (keys) => !NAMELESS_KEYS.some((x) => keys.has(x)) && !(keys.has('error') && keys.get('error') > 0 && toks[keys.get('error')].t === 'str' && CODE_RE.test(toks[keys.get('error')].v));
    // regions of stubs and doubles (their bodies and values), and where each refusal-code literal sits (assertion or not)
    const regions = [];
    const platRegions = []; // K5044 (1): platform doubles, whose literals are the platform's replies
    const faultNames = new Set(); // names of stand-ins that are fault injections
    const literalFault = (s, e) => { // a body that returns a nameless {ok:false} and no coded answer
      let nameless = 0, coded = 0;
      for (let j = s; j <= e; j++) if (isP(toks[j], '{') && match[j] > 0 && isObjectStart(toks, j)) { const ks = keysOf(j); if (ks.has('ok') && ks.get('ok') > 0 && /^(true|false)$/.test(toks[ks.get('ok')].v)) { if (toks[ks.get('ok')].v === 'false' && isNameless(ks)) nameless++; else coded++; } }
      return nameless > 0 && coded === 0;
    };
    const regionIsFault = (r) => {
      const [a, b] = r;
      if (a === b && toks[a].t === 'id' && /^(undefined|null)$/.test(toks[a].v)) return true; // V3: the service is absent (`x.owedLater = undefined`)
      if (isP(toks[a], '[') && match[a] === b) { // V3: a list of stand-ins (`for (const keepLater of [undefined, async () => { throw }])`): every one a fault
        const secs = sectionsOf(a); if (!secs.length) return false;
        return secs.every(([x, y]) => (x === y && toks[x].t === 'id' && /^(undefined|null)$/.test(toks[x].v)) || isFaultFn(toks, match, parent, x, y, literalFault));
      }
      if (isP(toks[a], '{') && match[a] === b) { // an object of stand-ins: every function member a fault
        const ks = keysOf(a); let fns = 0;
        for (const [, v] of ks) { if (v < 0) continue; const vb = isP(toks[v], '(') ? [v - 1, valueEnd(toks, match, v)] : [v, valueEnd(toks, match, v)]; const body = fnBody(toks, match, vb[0], vb[1]); if (!body) continue; fns++; if (!isFaultFn(toks, match, parent, vb[0], vb[1], literalFault)) return false; }
        return fns > 0;
      }
      return isFaultFn(toks, match, parent, a, b, literalFault);
    };
    const hasOk = (a, b) => { for (let j = a; j <= b; j++) if (isP(toks[j], '{') && match[j] > 0 && isObjectStart(toks, j) && keysOf(j).has('ok')) return true; return false; };
    const recvOf = (j) => { // the receiver before the dot at j+1: a name, or `callee()` for a call's result
      const u = toks[j];
      if (u && u.t === 'id') return u.v;
      if (isP(u, ')')) { for (let q = j; q >= 0; q--) if (isP(toks[q], '(') && match[q] === j) return toks[q - 1] && toks[q - 1].t === 'id' ? `${toks[q - 1].v}()` : '()'; }
      return null;
    };
    const productCall = (a, b) => { for (let j = a; j <= b; j++) if (toks[j].t === 'id' && imports.has(toks[j].v) && !importTest.has(toks[j].v) && imports.get(toks[j].v) !== 'test-support' && !isP(toks[j - 1], '.') && isP(toks[j + 1], '(')) return true; return false; };
    // V3: the stand-in forwards to the real thing: it calls product code imported by the test (and builds no answer of its own), or an alias of the
    // original it took from the same object (`const real = ex.readHeld.bind(ex)`), as a spy does
    const forwardsToReal = (name, r, recv) => {
      if (hasOk(r[0], r[1])) return false;
      if (productCall(r[0], r[1])) return true;
      for (let j = 1; j < toks.length; j++) { // aliases of the original: `X = <recv>.name...` read, not assigned
        if (!(toks[j].t === 'id' && toks[j].v === name && isP(toks[j - 1], '.') && recvOf(j - 2) === recv && !(isP(toks[j + 1], '=') && !isP(toks[j + 2], '=')) && !isP(toks[j + 1], '('))) continue;
        let q = j - 2; while (q > 0 && !isP(toks[q], '=') && !isP(toks[q], ';') && !isP(toks[q], '{') && j - q < 14) q--;
        const alias = isP(toks[q], '=') && toks[q - 1] && toks[q - 1].t === 'id' ? toks[q - 1].v : null;
        if (alias) for (let u = r[0]; u <= r[1]; u++) if (toks[u].t === 'id' && toks[u].v === alias && isP(toks[u + 1], '(')) return true;
      }
      return false;
    };
    const restores = (name, r, recv) => { // `x.name = saved` where the file read the original from the same receiver: a restore, no stand-in
      let plain = r[1] >= r[0]; for (let j = r[0]; j <= r[1]; j++) { const u = toks[j]; if (!(u.t === 'id' || (u.t === 'p' && (u.v === '.' || u.v === '#')))) plain = false; }
      if (!plain) return false;
      for (let j = 1; j < toks.length; j++) if (toks[j].t === 'id' && toks[j].v === name && isP(toks[j - 1], '.') && recvOf(j - 2) === recv && (j < r[0] - 4 || j > r[1]) && !(isP(toks[j + 1], '=') && !isP(toks[j + 2], '=')) && !isP(toks[j + 1], '(')) return true;
      if (r[0] === r[1] && toks[r[0]].t === 'id') { // a name bound to a fault elsewhere (`const boom = () => { throw }`, a loop over faults)
        for (let d = 1; d < toks.length; d++) if (toks[d].t === 'id' && toks[d].v === toks[r[0]].v && d !== r[0]) { const r2 = regionFrom(toks, match, d); if (r2 && toks[d - 1] && toks[d - 1].t === 'id' && /^(const|let|var|function)$/.test(toks[d - 1].v) && regionIsFault(r2)) return true; if (r2 && isP(toks[d - 1], 'const') ) break; }
      }
      return false;
    };
    const delegates = (name, r) => { for (let j = r[0]; j <= r[1]; j++) if (toks[j].t === 'id' && toks[j].v === name && isP(toks[j - 1], '.') && isP(toks[j + 1], '(')) return true; return false; }; // calls the same-named function of another object
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t !== 'id') continue;
      const named = isStubName(t.v);
      const iface = INTERFACE_NAMES.includes(t.v) && !(defMods.get(t.v) || new Set()).has(user);
      const plat = isPlatformName(t.v) || (t.v === 'fetch' && fetchMember(toks, k, k));
      if (!named && !iface && !plat) continue;
      const r = regionFrom(toks, match, k);
      if (!r) continue;
      if (plat) platRegions.push(r);
      if (named || iface) { regions.push(r); if (regionIsFault(r)) { platRegions.push(r); faultNames.add(t.v); } }
    }
    for (let k = 0; k < toks.length; k++) { // doubles that are a shape: a bucket (head, get, put), a binding ({calls, binding}), an IndexedDB store
      if (!isP(toks[k], '{') || match[k] < 0 || !isObjectStart(toks, k)) continue;
      const ks = keysOf(k);
      if ((ks.has('head') && ks.has('get') && ks.has('put')) || (ks.has('calls') && ks.has('binding')) || ks.has('objectStore')) platRegions.push([k, match[k]]);
    }
    const inRegion = (k) => regions.some(([a, b]) => k >= a && k <= b);
    const inPlat = (k) => platRegions.some(([a, b]) => k >= a && k <= b);
    const calledStub = (k) => { // inside the arguments of a call of a stub, double or listed seam: answered by one
      for (let q = parent[k]; q >= 0; q = parent[q]) if (isP(toks[q], '(')) { const c = calleeOf(toks, q); if (c && c.split('.').some((x) => isStubName(x) || platNames.has(x) || INTERFACE_NAMES.includes(x))) return true; }
      return false;
    };
    const pluginCall = (k) => { // inside the arguments of a call of a registrar such as registerStep or onAlarm
      for (let q = parent[k]; q >= 0; q = parent[q]) if (isP(toks[q], '(')) { const c = calleeOf(toks, q); const last = c && c.split('.').pop(); if (last && PLUGIN_CALLEE.test(last) && !INTERFACE_NAMES.includes(last)) return true; }
      return false;
    };
    const underCheckKey = (k) => { // a literal under a `check` / `validate` key: the user's own seam
      for (let p = parent[k]; p >= 0; p = parent[p]) {
        if (!isP(toks[p], '{') || !isObjectStart(toks, p)) continue;
        for (const [name, v] of keysOf(p)) if (CHECK_KEYS.has(name) && v > 0 && k >= v && k <= valueEnd(toks, match, v)) return true;
      }
      return false;
    };
    const objectish = (p) => p >= 0 && (isP(toks[p], '[') || (isP(toks[p], '{') && isObjectStart(toks, p)));
    const testShell = (k, e) => { // an object naming `test-shell` is a test's own shell
      const shell = (a, b) => { for (let j = a; j <= b; j++) if (toks[j].t === 'str' && /test-shell/.test(toks[j].v)) return true; return false; };
      if (shell(k, e)) return true;
      for (let p = parent[k]; objectish(p); p = parent[p]) if (shell(p, match[p])) return true;
      return false;
    };
    const expectedOnly = (k) => { // held in `const X = <literal>` and X used only inside assertions
      let o = k; while (objectish(parent[o])) o = parent[o];
      const p = toks[o - 1], q = toks[o - 2], r = toks[o - 3];
      if (!isP(p, '=') || !q || q.t !== 'id' || !r || r.t !== 'id' || !/^(const|let|var)$/.test(r.v)) return false;
      let uses = 0;
      const blk = parent[o], lo = blk >= 0 ? blk : 0, hi = blk >= 0 && match[blk] > 0 ? match[blk] : toks.length - 1; // V3: the uses in the scope of the declaration, not a namesake in another test
      for (let j = lo; j <= hi; j++) if (j !== o - 2 && toks[j].t === 'id' && toks[j].v === q.v && !isP(toks[j - 1], '.')) { uses++; if (!insideExpectation(toks, parent, j, match)) return false; }
      return uses > 0;
    };
    const firstSeg = (c) => c.split('.')[0];
    const ownCall = (c) => !!c && (importOwn.has(c) || importOwn.has(firstSeg(c))); // V3: a member of a namespace import of the user's own source counts
    const wrappers = new Set(); // local functions that call a function the user imports from its own source (V3: or a member of a namespace import of it)
    for (let k = 0; k < toks.length; k++) {
      const p = toks[k - 1];
      if (toks[k].t !== 'id' || !p || p.t !== 'id' || !/^(function|const|let|var)$/.test(p.v)) continue;
      const r = regionFrom(toks, match, k);
      if (r) for (let j = r[0]; j <= r[1]; j++) if (toks[j].t === 'id' && importOwn.has(toks[j].v) && (isP(toks[j + 1], '(') || (isP(toks[j + 1], '.') && toks[j + 2] && toks[j + 2].t === 'id' && isP(toks[j + 3], '(')))) { wrappers.add(toks[k].v); break; }
    }
    const occ = new Map(); // string literal (word-like) -> { inside, outside } (V3: any shape, not only a code)
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === 'id' && CODE_RE.test(t.v) && (isP(toks[k + 1], ':') || isP(toks[k + 1], ',') || isP(toks[k + 1], '}'))) { const o = occ.get(t.v) || { inside: 0, outside: 0 }; o.outside++; occ.set(t.v, o); continue; } // V3: a code fed in as an object key
      if (t.t !== 'str' || t.interp || !CODE_RE.test(t.v)) continue;
      const o = occ.get(t.v) || { inside: 0, outside: 0 };
      if (insideExpectation(toks, parent, k, match)) o.inside++; else o.outside++;
      occ.set(t.v, o);
    }
    const passThrough = (code) => { const o = occ.get(code); return !!o && o.inside >= 1 && o.outside >= 1; }; // fed in, and its coming out asserted
    // V3: a case table (`for (const [a, b] of [[..], ..])`, or of a `const T = [..]`) feeds its rows through the loop's names; a literal in a row
    // is handed on if a name it binds reaches the user's own code (or a real provider's) in the loop body, and is asserted back if one is used in an assertion
    const forOfs = [];
    for (let k = 0; k < toks.length; k++) {
      if (!(toks[k].t === 'id' && toks[k].v === 'for')) continue;
      let o = k + 1; if (toks[o] && toks[o].t === 'id' && toks[o].v === 'await') o++;
      if (!isP(toks[o], '(') || match[o] < 0) continue;
      const close = match[o]; let ofAt = -1;
      for (let j = o + 1; j < close; j++) { const u = toks[j]; if (u.t === 'p' && OPEN.includes(u.v) && match[j] > 0) { j = match[j]; continue; } if (u.t === 'id' && u.v === 'of') { ofAt = j; break; } }
      if (ofAt < 0) continue;
      let ps = o + 1; if (toks[ps] && toks[ps].t === 'id' && /^(const|let|var)$/.test(toks[ps].v)) ps++;
      const b0 = close + 1, b1 = isP(toks[b0], '{') && match[b0] > 0 ? match[b0] : valueEnd(toks, match, b0);
      forOfs.push({ at: k, ps, pe: ofAt - 1, it: [ofAt + 1, close - 1], body: [b0, b1] });
    }
    const TRANSPARENT = /^(JSON\.parse|JSON\.stringify|structuredClone|clone|String)$/; // calls that hand their argument on as it is
    const assertedOperand = (u) => { // V3: the name at u is itself an operand of an assertion (argument 0 or 1; only 0 of `ok`), not just compared (`x === ".."`) or computed over (`relay(x)`)
      if ((isP(toks[u + 1], '=') && isP(toks[u + 2], '=')) || (isP(toks[u + 1], '!') && isP(toks[u + 2], '=')) || (isP(toks[u - 1], '=') && (isP(toks[u - 2], '=') || isP(toks[u - 2], '!')))) return false;
      for (let q = parent[u]; q >= 0; q = parent[q]) {
        if (!isP(toks[q], '(')) continue;
        const c = calleeOf(toks, q);
        if (c && (TRANSPARENT.test(c) || ownCall(c))) continue; // handed on as it is, or run through the module's own function to make the expected value
        if (c && !isExpect(c)) return false; // an argument of a call that computes something from it
        if (!c) continue; // a grouping
        const arg = argIndex(toks, match, parent, q, u);
        return arg <= (/(^|\.)(ok|assert)$/.test(c) ? 0 : 1);
      }
      return false;
    };
    const tableOf = (F) => { // the table's `[` token: the iterable itself, or the `const NAME = [..]` it names; -1 when it is neither
      const [x, y] = F.it;
      if (isP(toks[x], '[') && match[x] === y) return x;
      if (x === y && toks[x].t === 'id') for (let j = 0; j + 2 < toks.length; j++) if (toks[j].t === 'id' && toks[j].v === toks[x].v && j !== x && isP(toks[j + 1], '=') && isP(toks[j + 2], '[') && match[j + 2] > 0 && toks[j - 1] && /^(const|let|var)$/.test(toks[j - 1].v)) return j + 2;
      return -1;
    };
    const loopOwn = (c, k) => { // V3: the callee is a name a `for (const [fn, ..] of [[ownExport, ..], ..])` binds: a call of the user's own exports
      if (!c || c.includes('.')) return false;
      for (const F of forOfs) {
        if (k < F.body[0] || k > F.body[1] || !idsIn(F.ps, F.pe).includes(c)) continue;
        const T = tableOf(F); if (T < 0) continue;
        for (let j = T + 1; j < match[T]; j++) if (toks[j].t === 'id' && importOwn.has(toks[j].v)) return true;
      }
      return false;
    };
    const tableCache = new Map();
    const tableFlow = (k) => { // 'pass' when a name the row binds is asserted back in the loop body, else null
      if (tableCache.has(k)) return tableCache.get(k);
      let res = null;
      if (isP(toks[k], '{') && match[k] > 0) { const ks = keysOf(k); if (ks.has('check') || ks.has('translation')) { tableCache.set(k, null); return null; } } // a copy of a module's whole answer (its C-number, its sentence), not an opaque payload
      for (const F of forOfs) {
        const T = tableOf(F);
        if (T < 0 || !(k > T && k < match[T])) continue;
        if (T !== F.it[0] && parent[T] >= 0 && !(F.at > parent[T] && F.at < match[parent[T]])) continue; // a named table is the one in scope of the loop, not a namesake in another test
        { let later = false; // a table holding a code only LATER modules give is a contract table (K4995), not data the loop passes through
          for (let j = T + 1; j < match[T] && !later; j++) if (toks[j].t === 'str' && CODE_RE.test(toks[j].v)) { const own = [...(ownersOf(toks[j].v) || [])].filter((m) => m !== user); if (own.length && own.every((m) => order.get(m) > order.get(user))) later = true; }
          if (later) continue; }
        { let pure = true; for (let q = parent[k]; q >= 0 && q !== T; q = parent[q]) if (!(isP(toks[q], '[') || isP(toks[q], '{') || (isP(toks[q], '(') && calleeOf(toks, q) === 'JSON.stringify'))) { pure = false; break; } if (!pure) continue; } // the row is data: a chain of list and object literals, no call between the literal and the table
        let elem = k; while (parent[elem] !== T && parent[elem] >= 0) elem = parent[elem];
        let names = idsIn(F.ps, F.pe).filter((x) => !/^(const|let|var)$/.test(x));
        if (isP(toks[F.ps], '[') && match[F.ps] === F.pe && isP(toks[elem], '[') && elem !== k) { // a row list against a list pattern: the name at the literal's position
          const secs = sectionsOf(elem); const at = secs.findIndex(([x, y]) => k >= x && k <= y); const psecs = sectionsOf(F.ps);
          if (at >= 0 && psecs[at]) names = idsIn(psecs[at][0], psecs[at][1]);
        }
        if (!names.length) continue;
        const [b0, b1] = F.body;
        for (let u = b0; u <= b1 && !res; u++) {
          if (toks[u].t !== 'id' || !names.includes(toks[u].v) || isP(toks[u - 1], '.') || isP(toks[u + 1], ':')) continue;
          const mem = isP(toks[u + 1], '.') && toks[u + 2] && toks[u + 2].t === 'id' ? toks[u + 2].v : null; // `row.translation` asserts a sentence, not the code
          if ((mem === null || /^(reason|code|error|ok|result|body|json)$/.test(mem)) && assertedOperand(u)) { res = 'pass'; break; }
          if (mem === null) for (let q = parent[u]; q >= 0 && !res; q = parent[q]) { // ... or the name is handed to the user's own code (through a helper that builds the Response from it)
            if (!isP(toks[q], '(')) continue;
            const c = calleeOf(toks, q);
            if (c && !isExpect(c) && (ownCall(c) || loopOwn(c, u) || mixedNs.has(firstSeg(c)))) { res = 'pass'; break; }
          }
        }
        if (res) break;
      }
      tableCache.set(k, res);
      return res;
    };
    // the skips every hand-built answer shares (K5044 (1)); `noHost`: not the user's-own-function exemption (an extent, an op table)
    // `info` = { lits: the reason/code/error string values (any shape), ids: the names they are held in }
    const commonSkip = (k, end, info, noHost) => {
      if (inPlat(k) || testShell(k, end) || expectedOnly(k) || insideExpectation(toks, parent, k, match) || pluginCall(k) || underCheckKey(k)) return true;
      if (info.primary !== undefined && passThrough(info.primary)) return true; // an answer whose code the same test asserts unchanged
      if (tableFlow(k) !== null) return true; // V3: a row of a case table whose name is asserted, or handed to the user's own code
      if (noHost) return false;
      if (heldFlow(k)) return true;
      for (let q = parent[k]; q >= 0; q = parent[q]) { // a callback handed to the user's own seam (`.transact(`, its own export or a local wrapper of it)
        if (!isP(toks[q], '(')) continue;
        const c = calleeOf(toks, q);
        if (c && (c.split('.').pop() === 'transact' || ownCall(c) || wrappers.has(c) || loopOwn(c, k))) return true;
      }
      let host = parent[k]; // the call this literal is an argument of, directly or nested in an object or list that is
      while (host >= 0 && (isP(toks[host], '{') || isP(toks[host], '['))) host = parent[host];
      if (host >= 0 && isP(toks[host], '(')) {
        const c = calleeOf(toks, host);
        if (c && c.split('.').pop() === 'transact') return true; // the user's own transaction seam
        if (c && loopOwn(c, k)) return true;
        const stubby = c && (c.split('.').some((x) => isStubName(x) || INTERFACE_NAMES.includes(x)) || HAND_BUILDER.test(c));
        if (c && !stubby && (c.includes('.') || wrappers.has(c) || (imports.has(c) && (imports.get(c) !== user || importOwn.has(c))))) return true; // an input handed to the real provider, a harness helper or the module's own function under test (or a local wrapper of it)
      }
      return false;
    };
    // V3: a literal held in a `const NAME = ..` that the test then hands to the user's own code (`run(h)`, `{ ...h }`, `{ hooks }`) is an input, not an answer
    let heldDecls = null, heldUses = null;
    const heldFlow = (k) => {
      if (!heldDecls) {
        heldDecls = []; heldUses = new Map();
        for (let d = 1; d < toks.length; d++) {
          const t = toks[d];
          if (t.t !== 'id') continue;
          if (toks[d - 1].t === 'id' && /^(const|let|var)$/.test(toks[d - 1].v) && isP(toks[d + 1], '=')) { const r = regionFrom(toks, match, d); if (r) heldDecls.push({ name: t.v, d, r }); }
          let u = heldUses.get(t.v); if (!u) heldUses.set(t.v, (u = [])); u.push(d);
        }
      }
      for (const { name, d, r } of heldDecls) {
        if (k < r[0] || k > r[1]) continue;
        { let fn = false; for (let j = r[0]; j <= r[1] && !fn; j++) if ((toks[j].t === 'id' && toks[j].v === 'function') || arrowAt(toks, j) || isP(toks[j], '(')) fn = true; if (fn) continue; } // plain data only: no function and no call in it (a held service is a dependency, a built value is judged where it is built)
        for (const u of heldUses.get(name) || []) {
          if (u === d || (isP(toks[u - 1], '.') && !(isP(toks[u - 2], '.') && isP(toks[u - 3], '.')))) continue; // a property of something else is not it; a spread is
          let host = parent[u], inFn = false; while (host >= 0 && (isP(toks[host], '{') || isP(toks[host], '['))) { if (isP(toks[host], '{') && (isP(toks[host - 1], ')') || (isP(toks[host - 1], '>') && isP(toks[host - 2], '=')))) inFn = true; host = parent[host]; } // a use inside a function body is read by a callback, not handed over
          if (!inFn && host >= 0 && isP(toks[host], '(')) { const c = calleeOf(toks, host); if (c && !isExpect(c) && ownCall(c)) return true; }
        }
      }
      return false;
    };
    // V3: a name whose value is read from a real module's own data (`const [code, row] = Object.entries(CHECKS).find(..)`, a loop over such rows) holds that module's code:
    // an answer built with it is built from the provider, not typed
    const derivedCache = new Map();
    const derived = (name, at, depth = 0) => {
      if (depth > 3) return false;
      const key = name + ':' + at + ':' + depth; if (derivedCache.has(key)) return derivedCache.get(key);
      derivedCache.set(key, false);
      let res = false;
      for (let d = 1; d < toks.length && !res; d++) {
        if (toks[d].t !== 'id' || toks[d].v !== name) continue;
        // `const <pattern holding name> = <expr>;` or `for (const <pattern holding name> of <expr>)`
        let q = d - 1, depthB = 0; while (q > 0 && !(toks[q].t === 'id' && /^(const|let|var)$/.test(toks[q].v))) { if (isP(toks[q], ';') || isP(toks[q], '{') && q < d - 12 || d - q > 14) { q = -1; break; } q--; }
        if (q <= 0) continue;
        { // the declaration must be in scope at `at`: in a block that holds it, or in the head of a `for` whose body does
          let inScope = parent[q] < 0;
          for (let a = parent[at]; a >= 0 && !inScope; a = parent[a]) if (a === parent[q]) inScope = true;
          if (!inScope && isP(toks[parent[q]], '(') && toks[parent[q] - 1] && toks[parent[q] - 1].v === 'for') { const body = match[parent[q]] + 1; if (at >= body && at <= (isP(toks[body], '{') && match[body] > 0 ? match[body] : valueEnd(toks, match, body))) inScope = true; }
          if (!inScope) continue; }
        let e = d; while (e < toks.length && !(isP(toks[e], '=') && !isP(toks[e + 1], '=')) && !(toks[e].t === 'id' && toks[e].v === 'of') && !isP(toks[e], ';') && e - d < 14) e++;
        { let pat = true; for (let j = q + 1; j < e; j++) { const u = toks[j]; if (!(u.t === 'id' || (u.t === 'p' && ',[]{}:.'.includes(u.v)))) { pat = false; break; } } if (!pat) continue; } // only a pattern between the keyword and `=` / `of`
        const ofLoop = toks[e] && toks[e].t === 'id' && toks[e].v === 'of';
        if (!(ofLoop || isP(toks[e], '='))) continue;
        const end = ofLoop ? (isP(toks[q - 1], '(') && match[q - 1] > 0 ? match[q - 1] - 1 : e) : (() => { let x = e + 1; while (x < toks.length && !isP(toks[x], ';') && x - e < 60) { const u = toks[x]; if (u.t === 'p' && OPEN.includes(u.v) && match[x] > 0) { x = match[x] + 1; continue; } x++; } return x - 1; })();
        for (let j = e + 1; j <= end && !res; j++) {
          if (toks[j].t !== 'id' || isP(toks[j - 1], '.')) continue;
          if (imports.has(toks[j].v) && !importTest.has(toks[j].v) && imports.get(toks[j].v) !== 'test-support') { res = true; }
          else if (toks[j].v !== name && derived(toks[j].v, d, depth + 1)) res = true;
        }
      }
      derivedCache.set(key, res);
      return res;
    };
    const litInfo = (keys) => { // V3: the reason/code/error values of an answer literal: the strings of any shape, and the names holding the rest
      const lits = [], ids = []; let opaque = false, fromProvider = false;
      for (const name of ['reason', 'code', 'error']) {
        const v = keys.get(name); if (v === undefined) continue;
        if (v === -1) { ids.push(name); opaque = true; continue; } // shorthand `{ reason }`
        const vt = toks[v];
        if (vt.t === 'str') { if (vt.interp || vt.v === '') opaque = true; else if (WORDLIKE.test(vt.v)) lits.push(vt.v); }
        else if (vt.t === 'id' && valueEnd(toks, match, v) === v && !/^(true|false|null|undefined)$/.test(vt.v)) { ids.push(vt.v); opaque = true; }
        else { opaque = true; if (vt.t === 'id' && (isP(toks[v + 1], '(') || (isP(toks[v + 1], '.') && toks[v + 2] && toks[v + 2].t === 'id' && isP(toks[v + 3], '('))) && imports.has(vt.v) && !importTest.has(vt.v) && imports.get(vt.v) !== 'test-support') fromProvider = true; } // the code is what a provider's own function answers: the provider's fixture, not a hand-built code
      }
      const primary = lits.find((x) => CODE_RE.test(x)); // the code a pass-through is judged on
      return { lits, ids, opaque, primary, fromProvider };
    };
    const litsIn = (a, b) => { // the same over every `ok` literal inside a token range (an op-table entry's value)
      const out = { lits: [], ids: [], opaque: false, primary: undefined };
      for (let j = a; j <= b; j++) if (isP(toks[j], '{') && match[j] > 0 && match[j] <= b) { const ks = keysOf(j); if (ks.has('ok')) { const i = litInfo(ks); out.lits.push(...i.lits); out.ids.push(...i.ids); out.opaque = out.opaque || i.opaque; if (out.primary === undefined) out.primary = i.primary; } }
      return out;
    };
    const flagged = []; // [from, to] token ranges of flagged literals
    // K5044 (3b): scripted op tables: an object literal keyed by product op names whose values build answers
    for (let k = 0; k < toks.length; k++) {
      if (!isP(toks[k], '{') || match[k] < 0 || !isObjectStart(toks, k) || flagged.some(([a, b]) => k > a && k < b)) continue;
      for (const [name, v] of keysOf(k)) {
        if (v < 0 || !opMods.has(name) || opMods.get(name).has(user)) continue;
        const end = valueEnd(toks, match, v), kt = isP(toks[v - 1], ':') ? v - 2 : v - 1;
        if (flagged.some(([a, b]) => kt > a && kt < b)) continue;
        let builds = false;
        for (let j = v; j <= end && !builds; j++) if (isP(toks[j], '{') && match[j] > 0 && j < end && keysOf(j).has('ok')) builds = true;
        let inner = false; // a value that holds a further op table is judged at its own entries
        for (let j = v; j < end && !inner; j++) if (isP(toks[j], "{") && match[j] > 0 && j < end) for (const [nm, nv] of keysOf(j)) if (nv > 0 && opMods.has(nm)) { inner = true; break; }
        const li = litsIn(v, end);
        if (!builds || inner || commonSkip(kt, end, li, true)) continue;
        flagged.push([kt, end + 1]);
        add('answer', toks[kt].line, `op-table ${name}`, mkProviders(opMods.get(name), user), { codes: codesIn(v, end), lits: li.lits.filter((x) => !CODE_RE.test(x)), opaque: li.opaque });
      }
    }
    // K5044 (3a): local builders: a function whose body builds a refusal or owed literal with its code a parameter
    const builders = new Map(); // name -> { idx: the code parameter's position, lits: Set(literal index), calls: [token index] }
    for (let k = 0; k < toks.length; k++) {
      if (toks[k].t !== 'id') continue;
      const dp = declParams(toks, match, k);
      if (!dp) continue;
      const r = regionFrom(toks, match, k);
      if (!r) continue;
      const flat = new Set(dp.params.flat());
      for (let j = r[0]; j <= r[1]; j++) {
        if (!isP(toks[j], '{') || match[j] < 0 || !isObjectStart(toks, j)) continue;
        const ks = keysOf(j);
        const okLit = ks.has('ok') && ks.get('ok') > 0 && /^(true|false)$/.test(toks[ks.get('ok')].v);
        if (!okLit || !(REFUSAL_KEYS.some((x) => ks.has(x)) || OWED_KEYS.some((x) => ks.has(x)))) continue;
        let pname = null;
        for (const key of ['reason', 'code', 'error']) {
          const v = ks.get(key);
          if (v === -1 && flat.has(key)) { pname = key; break; }
          if (v > 0 && toks[v].t === 'id' && valueEnd(toks, match, v) === v && flat.has(toks[v].v)) { pname = toks[v].v; break; }
        }
        if (!pname) continue;
        let b = builders.get(toks[k].v); if (!b) builders.set(toks[k].v, (b = { idx: dp.params.findIndex((a) => a.includes(pname)), lits: new Set(), calls: [] }));
        b.lits.add(j);
      }
    }
    for (let k = 0; k < toks.length; k++) {
      const b = toks[k].t === 'id' ? builders.get(toks[k].v) : null;
      if (!b || !isP(toks[k + 1], '(') || match[k + 1] < 0 || isP(toks[k - 1], '.') || declParams(toks, match, k)) continue;
      b.calls.push(k);
    }
    const builderLits = new Set();
    for (const b of builders.values()) if (b.calls.length) for (const j of b.lits) builderLits.add(j);
    // answer
    for (let k = 0; k < toks.length; k++) {
      if (!isP(toks[k], '{') || match[k] < 0 || !isObjectStart(toks, k)) continue;
      if (flagged.some(([a, b]) => k > a && k < b)) continue;
      if (builderLits.has(k)) continue; // reported at its builder's call sites
      const keys = keysOf(k);
      if (!keys.size) continue;
      let shape = null;
      const okLit = keys.has('ok') && keys.get('ok') > 0 && toks[keys.get('ok')].t === 'id' && /^(true|false)$/.test(toks[keys.get('ok')].v); // `ok` written as true or false
      if (okLit && REFUSAL_KEYS.some((x) => keys.has(x))) shape = 'refusal';
      else if (okLit && OWED_KEYS.some((x) => keys.has(x))) shape = 'owed';
      else if (keys.has('extent')) { const v = keys.get('extent'); if (v > 0 && isP(toks[v], '{') && toks[v + 1] && (toks[v + 1].v === 'kind') && isP(toks[v + 2], ':')) shape = 'extent'; }
      if (!shape) continue;
      if (shape === 'extent' && !(inRegion(k) || calledStub(k))) continue; // extent data passed in, not an answer: only inside a stub or double, or given to one
      if (shape !== 'extent' && keys.has('why') && !keys.has('reason')) continue; // `why` is not the refusal key of any module's answer: the module's own data
      if (shape === 'refusal') {
        const rv = keys.get('reason');
        if (rv > 0 && toks[rv].t === 'str' && LOWER_SNAKE.test(toks[rv].v)) continue; // an external provider's vocabulary (`overloaded_error`)
        const ev = keys.get('error');
        if (!keys.has('reason') && !keys.has('code') && ev > 0) { let raw = false; for (let j = ev; j <= valueEnd(toks, match, ev); j++) if (toks[j].t === 'id' && /^(stack|message)$/.test(toks[j].v)) raw = true;
          if (toks[ev].t === 'str' && STACK_TEXT.test(toks[ev].v)) raw = true; // V3: a stack written out
          if (toks[ev].t === 'id' && valueEnd(toks, match, ev) === ev) for (let d = 0; d < toks.length; d++) if (d !== ev && toks[d].t === 'id' && toks[d].v === toks[ev].v && toks[d - 1] && /^(const|let|var)$/.test(toks[d - 1].v) && isP(toks[d + 1], '=') && toks[d + 2] && toks[d + 2].t === 'str' && STACK_TEXT.test(toks[d + 2].v)) raw = true; // ... or held in a name
          if (raw) continue; } // a raw platform error reply
        if (isNameless(keys) && (inRegion(k) || calledStub(k))) continue; // a fault injection's nameless refusal
      }
      // the code it names, and whom it belongs to
      let code = null;
      for (const name of ['reason', 'code', 'error']) { const v = keys.get(name); if (v > 0 && toks[v] && toks[v].t === 'str' && CODE_RE.test(toks[v].v)) { code = toks[v].v; break; } }
      if (!code) for (let j = k + 1; j < match[k]; j++) if (toks[j].t === 'str' && CODE_RE.test(toks[j].v) && isP(toks[j - 1], ':') && CODE_KEYS.has(toks[j - 2] && toks[j - 2].v)) { code = toks[j].v; break; }
      const codes = codesIn(k, match[k]);
      const info = litInfo(keys);
      if (code && !info.lits.includes(code)) { info.lits.push(code); if (info.primary === undefined) info.primary = code; } // a code found under a nested key (`waiting_on: { code }`)
      if (info.fromProvider && !info.lits.length) continue; // V3: its code comes from a provider's fixture call
      if (!info.lits.length && info.ids.length && info.ids.every((x) => derived(x, k))) continue; // V3: ... or from a provider's own data
      if (commonSkip(k, match[k], info, shape === 'extent')) continue;
      let providers = [], tag = shape;
      if (code) {
        const owners = ownersOf(code);
        if (owners && owners.has(user)) continue; // the user's own shape
        if (!owners) tag = `${shape} invented ${code}`; else providers = mkProviders(owners, user);
      }
      flagged.push([k, match[k]]);
      add('answer', toks[k].line, tag, providers, { invented: !!code && !ownersOf(code), codes, lits: info.lits.filter((x) => !CODE_RE.test(x)), opaque: info.opaque });
    }
    // answer: each call site of a local builder, with the code argument
    for (const [name, b] of builders) {
      for (const k of b.calls) {
        if (flagged.some(([a, z]) => k > a && k < z)) continue;
        const open = k + 1;
        const args = [[]];
        for (let j = open + 1; j < match[open]; j++) {
          const u = toks[j];
          if (isP(u, ',')) { args.push([]); continue; }
          args[args.length - 1].push(j);
          if (u.t === 'p' && OPEN.includes(u.v) && match[j] > 0) { for (let q = j + 1; q <= match[j]; q++) args[args.length - 1].push(q); j = match[j]; }
        }
        const arg = args[b.idx] || [];
        const code = arg.length === 1 && toks[arg[0]].t === 'str' && CODE_RE.test(toks[arg[0]].v) ? toks[arg[0]].v : null;
        if (arg.length === 1 && toks[arg[0]].t === 'str' && LOWER_SNAKE.test(toks[arg[0]].v)) continue;
        const bl = arg.length === 1 && toks[arg[0]].t === 'str' && WORDLIKE.test(toks[arg[0]].v) ? { lits: [toks[arg[0]].v], ids: [], opaque: false, primary: CODE_RE.test(toks[arg[0]].v) ? toks[arg[0]].v : undefined }
          : arg.length === 1 && toks[arg[0]].t === 'id' ? { lits: [], ids: [toks[arg[0]].v], opaque: true, primary: undefined } : { lits: [], ids: [], opaque: true, primary: undefined };
        if (commonSkip(k, match[open], bl, false)) continue;
        let providers = [], tag = `builder ${name}`;
        if (code) {
          const owners = ownersOf(code);
          if (owners && owners.has(user)) continue;
          if (!owners) tag = `${tag} invented ${code}`; else providers = mkProviders(owners, user);
        }
        add('answer', toks[k].line, tag, providers, { invented: !!code && !ownersOf(code), codes: code ? [code] : [], lits: bl.lits.filter((x) => !CODE_RE.test(x)), opaque: bl.opaque });
      }
    }
    // stub: named doubles, once per file and name
    const seen = new Set();
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t !== 'id') continue;
      if (isStubName(t.v) && !seen.has(t.v)) {
        if (importOwn.has(t.v) || importTest.has(t.v)) continue; // imported from the user's own product source or test files: its own double
        if (faultNames.has(t.v)) continue; // a fault injection: throws, never settles, answers nothing
        if (isP(toks[k - 1], '.') ) continue; // a member of something else
        const p = toks[k - 1];
        const decl = (p && p.t === 'id' && /^(function|const|let|var|class)$/.test(p.v)) || (isP(toks[k + 1], ':') && p && p.t === 'p' && '{,'.includes(p.v));
        if (BARE_SPY.test(t.v)) { // a local spy: only where it stands in for another module's exported name
          if (!decl) continue;
          const touched = new Map(); // name -> the token index of its definition
          const r = regionFrom(toks, match, k);
          if (r) for (let j = r[0]; j <= r[1]; j++) if (toks[j].t === 'id' && ((isP(toks[j + 1], ':') && toks[j - 1] && toks[j - 1].t === 'p' && '{,'.includes(toks[j - 1].v)) || (isP(toks[j - 1], '.') && isP(toks[j + 1], '=')))) touched.set(toks[j].v, j);
          for (let j = 0; j < toks.length; j++) if (toks[j].t === 'id' && toks[j].v === t.v && isP(toks[j + 1], '.') && toks[j + 2] && toks[j + 2].t === 'id' && isP(toks[j + 3], '=')) touched.set(toks[j + 2].v, j + 2);
          const hit = [...touched.keys()].find((nm) => { // not a delegating wrapper or a fault
            if (GENERIC_EXPORT.test(nm) || !mkProviders(exportMods.get(nm), user).length) return false;
            const rr = regionFrom(toks, match, touched.get(nm));
            return !(rr && (delegates(nm, rr) || regionIsFault(rr)));
          });
          if (!hit) continue;
          seen.add(t.v);
          add('stub', t.line, `spy standing in ${hit}`, mkProviders(exportMods.get(hit), user), { name: t.v });
          continue;
        }
        seen.add(t.v);
        let tag = decl ? 'decl' : imports.has(t.v) ? 'import' : 'use';
        let provSet;
        if (STAND_FOR[t.v]) provSet = defMods.get(STAND_FOR[t.v]);
        if (!provSet && imports.has(t.v) && imports.get(t.v) !== user) provSet = new Set([imports.get(t.v)]);
        if (!provSet && !decl) provSet = declMods.get(t.v);
        if (!provSet) { // the interface the name stands for, by its name without the Stub/Fake/Double word
          const bare = t.v.replace(/^(fake|stub|double)(?=[A-Z0-9_])/, '').replace(/(Stub|Fake|Double)$/, '');
          const cand = bare ? bare[0].toLowerCase() + bare.slice(1) : '';
          provSet = defMods.get(cand);
        }
        add('stub', t.line, tag, mkProviders(provSet, user), { name: t.v, srcFile: importFile.get(t.v) || null });
      }
      // stub: a function standing in for an interface the user does not define
      if (INTERFACE_NAMES.includes(t.v) && !(defMods.get(t.v) || new Set()).has(user)) {
        const p = toks[k - 1], nx = toks[k + 1];
        let stand = false, declForm = false;
        if (isP(p, '.')) stand = isP(nx, '=') && !isP(toks[k + 2], '=');
        else if (p && p.t === 'id' && /^(function|const|let|var)$/.test(p.v)) stand = declForm = true;
        else if (p && p.t === 'id' && p.v === 'async' && toks[k - 2] && toks[k - 2].v === 'function') stand = declForm = true;
        else if (isP(nx, ':') && p && p.t === 'p' && '{,'.includes(p.v)) {
          const v = toks[k + 2]; stand = !!v && ((v.t === 'id' && (v.v === 'async' || v.v === 'function')) || isP(v, '(') || (v.t === 'id' && isP(toks[k + 3], '=') && isP(toks[k + 4], '>')));
        } else if (isP(nx, '(') && p && p.t === 'p' && '{,'.includes(p.v) && match[k + 1] > 0 && isP(toks[match[k + 1] + 1], '{') && parent[k] >= 0 && isP(toks[parent[k]], '{')) stand = true;
        else if (isP(p, '=') ) stand = false;
        if (stand) { // K5044 (1): a delegating wrapper, a fault injection, or a local helper that only shares the name is no stand-in
          const r = regionFrom(toks, match, k);
          if (r && (delegates(t.v, r) || regionIsFault(r))) stand = false;
          if (stand && r) { const recv = isP(p, '.') ? recvOf(k - 2) : null; if (forwardsToReal(t.v, r, recv) || (recv && restores(t.v, r, recv))) stand = false; } // V3: a spy that forwards to the real thing, a restore of the original, a name bound to a fault
          if (stand && declForm) {
            let handed = false;
            for (let j = 0; j < toks.length && !handed; j++) if (j !== k && toks[j].t === 'id' && toks[j].v === t.v && !isP(toks[j + 1], '(') && !isP(toks[j + 1], ':') && !isP(toks[j - 1], '.') && !(toks[j - 1] && toks[j - 1].t === 'id' && /^(function|const|let|var)$/.test(toks[j - 1].v))) handed = true;
            if (!handed) stand = false;
          }
        }
        if (stand) { const r3 = regionFrom(toks, match, k); add('stub', t.line, `stand-in ${t.v}`, mkProviders(defMods.get(t.v), user), { name: t.v, codes: r3 ? codesIn(r3[0], r3[1]) : [] }); }
      }
    }
    // code: a refusal-shaped literal no source gives
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t !== 'str' || !CODE_RE.test(t.v) || ownersOf(t.v)) continue;
      let at = false;
      for (let j = k - 1; j >= 0 && j >= k - 6; j--) { const u = toks[j]; if (u.t === 'p' && ';{}'.includes(u.v)) break; if (u.t === 'id' && CODE_KEYS.has(u.v)) { at = true; break; } }
      if (!at) for (let j = k + 1; j < toks.length && j <= k + 5; j++) { const u = toks[j]; if (u.t === 'p' && ';{}'.includes(u.v)) break; if (u.t === 'id' && CODE_KEYS.has(u.v) && isP(toks[j - 1], '.')) { at = true; break; } }
      if (!at) continue;
      if (/^ERR_[A-Z0-9_]+$/.test(t.v)) continue; // V3: a platform error code (Node's `ERR_SQLITE_ERROR`), the platform's own vocabulary
      { const q = parent[k], h = q >= 0 ? parent[q] : -1; if (q >= 0 && isP(toks[q], '{') && h >= 0 && isP(toks[h], '(') && /^(push|unshift|add|concat)$/.test((calleeOf(toks, h) || '').split('.').pop())) continue; } // a finding the module builds into its own list
      { const q = parent[k]; if (q >= 0 && isP(toks[q], '{') && isP(toks[q - 1], ':') && toks[q - 2] && DATA_KEYS.has(toks[q - 2].v)) continue; } // a field of a data object (`why: { code }`)
      if (passThrough(t.v)) continue; // fed in and asserted to come out: the test's own pass-through data
      if ((testShell(k, k) || expectedOnly(k) || underCheckKey(k) || tableFlow(k) !== null)) continue; // V3: the K5044 (1) seams apply to a bare code too: a platform double, a test shell, a check/validate key, a case-table row
      { let seam = false; { // ... and a code handed to the user's own code as data (directly, or nested in the object or list given), or returned from the callback of its transaction
          for (let q = parent[k]; q >= 0 && !seam; q = parent[q]) if (isP(toks[q], '(')) { const c = calleeOf(toks, q); if (c && c.split('.').pop() === 'transact') seam = true; }
          let host = parent[k]; while (host >= 0 && (isP(toks[host], '{') || isP(toks[host], '['))) host = parent[host];
          if (!seam && host >= 0 && isP(toks[host], '(')) { const c = calleeOf(toks, host); if (c && !isExpect(c) && (ownCall(c) || wrappers.has(c))) seam = true; } }
        if (!seam && heldFlow(k)) seam = true;
        if (seam) continue; }
      if (cands.some((c) => c.cls === 'answer' && c.file === f && c.line === t.line && c.invented)) continue; // carried by the answer's tag
      if (flagged.some(([a, b]) => k > a && k < b)) continue;
      add('code', t.line, '', [], { codes: [t.v] });
    }
    // answer: an object literal with `ok` written as true or false that an explicit `fixtures-contract` marker reaches (its line, MARK_SPAN below), classed or not; a marker that already covers a candidate needs none
    for (const mk of contracts) {
      if (mk.file !== f) continue;
      const nearest = (c) => contracts.filter((x) => x.file === f && x.line <= c.line && c.line <= (x.end || x.line + MARK_SPAN)).sort((a, b) => b.line - a.line)[0];
      if (cands.some((c) => c.file === f && c.cls !== 'code' && nearest(c) === mk)) continue;
      for (let k = 0; k < toks.length; k++) {
        if (toks[k].line < mk.line || toks[k].line > mk.line + MARK_SPAN) continue;
        if (!isP(toks[k], '{') || match[k] < 0 || !isObjectStart(toks, k)) continue;
        const ok = keysOf(k).get('ok');
        if (!(ok > 0 && toks[ok].t === 'id' && /^(true|false)$/.test(toks[ok].v))) continue;
        if (flagged.some(([a, b]) => (k >= a && k <= b) || (a >= k && b <= match[k]))) continue; // already an answer, or holds one
        flagged.push([k, match[k]]);
        add('answer', toks[k].line, 'marked', [], { codes: [], lits: [] });
      }
    }
  }

  // 4. contracts: acceptance and the markers' own failures
  const contractUsed = new Set();
  const runKey = (provider, user, id) => `${provider}\0${user}\0${id}`;
  const runSet = new Set(runs.map((r) => runKey(r.provider, r.user, r.id)));
  const genUsed = new Set();
  const ownUsed = new Set();
  for (const c of cands) {
    c.status = 'fail'; c.relation = relationOf(c, order);
    { // K5044 (2): `// fixtures-generic: CODE` accepts a code made up on purpose; a code the markers do not name stays a finding
      // V3: the code may be any word (`X`, `busy`), and an answer whose code is built or held in a name (no literal) is covered by any marker within reach
      const cover = generics.filter((x) => x.file === c.file && x.line <= c.line && c.line <= x.line + MARK_SPAN);
      const names = [...(c.codes || []), ...(c.lits || [])];
      if (cover.length && names.length) {
        for (const x of cover) if (names.includes(x.code)) genUsed.add(x);
        if (names.every((cd) => cover.some((x) => x.code === cd))) { c.status = 'accepted'; c.contract = 'generic'; continue; }
      } else if (cover.length && c.opaque) { for (const x of cover) genUsed.add(x); c.status = 'accepted'; c.contract = 'generic'; continue; }
    }
    if (c.cls !== 'contract') { // V3: `// fixtures-own: <platform|input|harness|synthetic> <why>` accepts whatever it covers: a platform double, an input the module reads opaquely, its own harness, a synthetic plug-in
      const oc = owns.filter((x) => x.file === c.file && x.line <= c.line && c.line <= x.line + MARK_SPAN);
      if (oc.length) { for (const x of oc) ownUsed.add(x); c.status = 'accepted'; c.contract = 'own'; continue; }
    }
    if (c.cls === 'code') continue;
    const mk = contracts.filter((x) => x.file === c.file && x.line <= c.line && c.line <= (x.end || x.line + MARK_SPAN)).sort((a, b) => b.line - a.line)[0]; // the nearest marker above
    if (!mk) continue;
    contractUsed.add(mk);
    if (!order.has(mk.provider)) { c.tag = `${c.tag} contract-unknown-provider`.trim(); continue; }
    if (!(order.get(mk.provider) > order.get(c.user))) { c.tag = `${c.tag} contract-not-later`.trim(); c.providers = [mk.provider]; c.relation = relationOf(c, order); continue; }
    if (!runSet.has(runKey(mk.provider, c.user, mk.id))) { c.tag = `${c.tag} contract-no-run`.trim(); c.providers = [mk.provider]; c.relation = relationOf(c, order); continue; }
    c.status = 'accepted'; c.providers = [mk.provider]; c.relation = 'later'; c.contract = mk.id;
  }
  // K5044 (4): a contract on a harness value (a test-support file) also covers every import of it in other modules' tests
  const harness = new Map(); // `file\0name` -> contract id of an accepted harness stub
  for (const c of cands) if (c.status === 'accepted' && c.cls === 'stub' && c.name && c.user === 'test-support' && c.contract !== 'generic') harness.set(`${c.file}\0${c.name}`, c);
  for (const c of cands) {
    if (c.status === 'accepted' || c.cls !== 'stub' || !c.name || !c.srcFile) continue;
    const h = harness.get(`${c.srcFile}\0${c.name}`);
    if (h) { c.status = 'accepted'; c.contract = h.contract; c.providers = h.providers; c.relation = 'later'; }
  }
  const extra = []; // class contract: markers that hold nothing
  for (const mk of contracts) if (!contractUsed.has(mk) && (!only.length || only.includes(mk.user))) extra.push({ cls: 'contract', user: mk.user, file: mk.file, line: mk.line, tag: 'idle', text: `fixtures-contract: ${mk.provider} ${mk.id}`, providers: [mk.provider], imports: [], status: 'fail', relation: '' });
  for (const x of generics) if (!genUsed.has(x) && (!only.length || only.includes(x.user))) extra.push({ cls: 'contract', user: x.user, file: x.file, line: x.line, tag: 'idle-generic', text: `fixtures-generic: ${x.code}`, providers: [], imports: [], status: 'fail', relation: '' });
  for (const x of owns) if (!ownUsed.has(x) && (!only.length || only.includes(x.user))) extra.push({ cls: 'contract', user: x.user, file: x.file, line: x.line, tag: 'idle-own', text: `fixtures-own: ${x.kind} ${x.note}`, providers: [], imports: [], status: 'fail', relation: '' });
  const marked = new Set(contracts.map((c) => runKey(c.provider, c.user, c.id)));
  for (const r of runs) if (!marked.has(runKey(r.provider, r.user, r.id)) && (!only.length || only.includes(r.user) || only.includes(r.provider))) extra.push({ cls: 'contract', user: r.user, file: r.file, line: r.line, tag: 'orphan-run', text: `fixtures-run: ${r.user} ${r.id}`, providers: [r.provider], imports: [], status: 'fail', relation: '' });
  const all = [...cands, ...extra].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));

  const fmtProv = (c) => (c.providers.length ? `${c.providers.join(',')} (${c.relation})` : '?');
  const failing = all.filter((c) => c.status === 'fail');
  const findings = failing.map((c) => ({ check: 'fixtures', key: c.cls, module: c.user, file: c.file, line: c.line, tag: c.tag || null, providers: c.providers, finding: `${c.cls} ${c.user} ${c.file}:${c.line} ${c.tag ? `[${c.tag}] ` : ''}${c.text} -> ${fmtProv(c)}` }))
    .sort((a, b) => (a.finding < b.finding ? -1 : a.finding > b.finding ? 1 : 0));
  const failures = findings.map((f) => f.finding);
  const listing = all.map((c) => `${c.cls} ${c.user} ${c.file}:${c.line} ${c.status === 'accepted' ? `accepted(${c.contract})` : 'fail'} ${c.tag ? `[${c.tag}] ` : ''}-> ${fmtProv(c)} imports:${c.imports.join(',') || '-'} | ${c.text}`);
  const n = (cls) => failing.filter((c) => c.cls === cls).length;
  const byUser = {};
  for (const c of failing) { const u = (byUser[c.user] ??= { answer: 0, stub: 0, code: 0, contract: 0, total: 0 }); u[c.cls]++; u.total++; }
  const tagged = (w) => failing.filter((c) => c.cls === 'answer' && c.tag.startsWith(w)).length;
  const invented = failing.filter((c) => c.invented).length;
  const accepted = all.filter((c) => c.status === 'accepted').length;
  const summary = `${parsed.length} test files read, ${state.modules.length} modules; answer ${n('answer')} (${invented} with an invented code, ${tagged('builder')} builder, ${tagged('op-table')} op-table), stub ${n('stub')}, code ${n('code')}, contract ${n('contract')}, accepted ${accepted}`;
  return { findings, failures, summary, listing, byUser, items: all, totals: { answer: n('answer'), stub: n('stub'), code: n('code'), contract: n('contract'), accepted, invented } };
}

function relationOf(c, order) {
  if (!c.providers.length) return '?';
  const me = order.get(c.user);
  const rel = c.providers.map((p) => (order.get(p) > me ? 'later' : 'earlier'));
  return rel.every((r) => r === rel[0]) ? rel[0] : 'mixed';
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const pos = args.filter((a) => !a.startsWith('--'));
  const r = checkFixtures(pos[0] || '.', pos.slice(1));
  if (args.includes('--list')) {
    for (const l of r.listing) console.log(l);
    console.log(`fixtures: ${r.summary}; ${r.failures.length} failure${r.failures.length === 1 ? '' : 's'}`);
    process.exitCode = 0;
  } else process.exitCode = report('fixtures', r.failures, r.summary);
}
