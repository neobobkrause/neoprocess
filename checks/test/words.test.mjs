// Tests of the words check (checks/words.mjs) against a fake product built in a temporary directory: one module with
// each kind of violation and a clean control for each arm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkWords, isSentence, isPlainSentence, scan, foldLiteralChains } from '../words.mjs';

const WORDS = {
  words: [
    { key: 'refusal.NO_ACCESS', en: 'You cannot see that project here.' },
    { key: 'screen.home.greeting', en: 'Welcome back, {name}. Your team has {count} open items.' },
    { key: 'screen.home.title', en: 'Home' },
    { key: 'refusal.NOT_FOUND', en: 'Nothing by that name is held here.' },
    { key: 'refusal.TOO_LONG', en: 'That is longer than the limit.' },
    { key: 'refusal.TOO_SHORT', en: 'That is shorter than the limit.' },
    { key: 'refusal.BAD_DATE', en: 'That date is not one we can read.' },
    { key: 'refusal.NO_REASON', en: 'A reason is needed for this act.' },
  ],
};

function product(files) {
  const root = mkdtempSync(join(tmpdir(), 'words-'));
  const all = {
    'build/modules.json': JSON.stringify({
      not_product: ['docs/', 'build/'],
      modules: [
        { id: 'setup-words', layer: 1, paths: ['src/setup-words/'], tests: ['test/setup-words/'], uses: [] },
        { id: 'op-declarations', layer: 1, paths: ['src/op-declarations/'], tests: ['test/op-declarations/'], uses: [] },
        { id: 'viol', layer: 2, paths: ['src/viol/'], tests: ['test/viol/'], uses: ['setup-words'] },
        { id: 'clean', layer: 2, paths: ['src/clean/'], tests: ['test/clean/'], uses: ['setup-words'] },
        { id: 'owner', layer: 2, paths: ['src/owner/'], tests: ['test/owner/'], uses: [] },
      ],
    }),
    'build/ops.json': JSON.stringify({ alpha: 'owner', beta: 'owner', gamma: 'owner', delta: 'owner', epsilon: 'owner', zeta: 'owner' }),
    'docs/development/ux-substrate/screens/words.json': JSON.stringify(WORDS),
    // the product's words configuration (checks/words.mjs): the process names none of these paths or modules itself
    'build/words.json': JSON.stringify({ table: 'docs/development/ux-substrate/screens/words.json', reads: 'docs/development/ux-substrate/screens/words-reads.json', rows: 'bio-plane/src/setup-words/rows.mjs', unreviewed: 'bio-plane/src/setup-words/words-unreviewed.json', baseline: 'build/tests-english-baseline.json', opDeclarations: 'bio-plane/src/op-declarations/index.mjs', marker: 'localize', wordsModule: 'setup-words', declModules: ['op-declarations', 'op-capabilities'], drawnPrefix: 'screens-', drawnModules: ['interface-shell', 'wizard-scripts', 'site', 'installer', 'installer-steps'] }),
    'src/setup-words/index.mjs': 'export const x = "This module holds all the English there is.";\n',
    'src/viol/index.mjs': [
      'import { word } from "../setup-words/index.mjs";',
      '// This comment is a sentence in a comment.',
      'export const a = "Your project could not be found here.";',            // line 3: inline sentence
      'export const b = `Hello ${name}, we could not save this.`;',            // line 4: template sentence
      'export const c = "You cannot see that project here.";',                  // line 5: copy
      'export function f() { throw new Error("The store is not open yet."); }', // line 6: a built-in Error: developer text, counted as dev
      'export const ok1 = word("screen.home.title");',
      'export const ok2 = "SELECT id FROM things WHERE name = ? AND kind = ?";',
      'export const ok3 = "a.b.c.d";',
      'console.log("This is only a log line for people.");',
      'export const ok4 = "./some/path/to/a/module.mjs";',
      'export const ok5 = "https://example.org/a/long/page/here";',
      'export const ok6 = /Your project could not be found/;',
      'export const ok7 = "not a sentence";',
      'export const bad = word("screen.gone.away");',                     // line 15: missingkey
    ].join('\n') + '\n',
    'src/clean/index.mjs': [
      'import { word } from "../setup-words/index.mjs";',
      'export const t = word("screen.home.greeting", { name: "A", count: 3 });',
      '// a comment saying Your project could not be found here.',
      'export const css = "color: red; margin: 0 auto; padding: 4px 8px;";',
      'export const ok = "ok";',
    ].join('\n') + '\n',
    'src/owner/index.mjs': 'export const ops = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];\n',
    'test/viol/a.test.mjs': [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { hasWord } from "../../src/setup-words/index.mjs";',
      'test("You cannot see that project here.", () => {',                      // a title: not a copy
      '  assert.equal(out.says, "You cannot see that project here.");',        // line 5: testcopy exact
      '  assert.ok(out.says.includes("Nothing by that"));',        // short substring: fine
      '  assert.match(out.text, "Welcome back, {name}. Your team has");',       // line 7: 25+ substring
      '  assert.equal(hasWord("screen.home.title"), true);',
      '  assert.equal(hasWord("screen.no.such.key"), false);',                  // negative test: fine
      '  assert.equal(out.code, "NOT_FOUND");',
      '  assert.equal(hasWord("screen.home.missing"), true);',                  // line 11: missingkey
      '});',
      'const ALL = ["alpha", "beta", "gamma", "delta", "epsilon"];',            // line 13: handlist ops
      'const CODES = ["NO_ACCESS", "NOT_FOUND", "TOO_LONG", "TOO_SHORT", "BAD_DATE"];', // line 14: handlist codes
      'const KEYS = ["refusal.NO_ACCESS", "refusal.NOT_FOUND", "refusal.TOO_LONG", "refusal.TOO_SHORT", "refusal.BAD_DATE"];', // line 15
      'const small = ["alpha", "beta", "gamma"];',
      'const mixed = ["alpha", "x1", "x2", "x3", "x4", "x5"];',
    ].join('\n') + '\n',
    'test/clean/a.test.mjs': [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { word, hasWord } from "../../src/setup-words/index.mjs";',
      'test("shows the greeting", () => {',
      '  assert.equal(out.says, word("screen.home.greeting", { name: "A", count: 3 }));',
      '  assert.equal(hasWord("screen.home.title"), true);',
      '  assert.equal(out.code, "NOT_FOUND");',
      '});',
    ].join('\n') + '\n',
    'test/owner/a.test.mjs': 'const OWN = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];\n', // its own ops: not a hand-list
    'src/viol/words.generated.mjs': '/* GENERATED: do not edit by hand. */\nexport const g = "Your project could not be found here.";\n',
    'src/viol/fixtures/data.mjs': 'export const d = "Your project could not be found here.";\n',
  };
  Object.assign(all, files);
  for (const [p, c] of Object.entries(all)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), c); }
  const g = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  return root;
}

// Findings by their key (the arm) and fields, never by the sentence the check prints (R11).
const at = (findings, arm, mod, file, line) => findings.filter((f) => f.key === arm && (mod === undefined || f.module === mod) && (file === undefined || f.file === file) && (line === undefined || f.line === line));
const has = (findings, arm, mod, file, line, tag) =>
  at(findings, arm, mod, file, line).some((f) => tag === undefined || (tag === '' ? f.tag === null : f.tag === tag));
const show = (findings) => findings.map((f) => `${f.key} ${f.module} ${f.file}:${f.line} [${f.tag}]`).join('\n');

test('inline: sentences, templates, copies and error messages are found; code-like strings, comments and logs are not', async () => {
  const { findings } = await checkWords(product({}));
  const F = 'src/viol/index.mjs';
  assert.ok(has(findings, 'inline', 'viol', F, 3, ''), show(findings));
  assert.ok(has(findings, 'inline', 'viol', F, 4, ''));
  assert.ok(has(findings, 'inline', 'viol', F, 5, 'copy'));
  for (const line of [2, 6, 7, 8, 9, 10, 11, 12, 13, 14]) assert.equal(at(findings, 'inline', 'viol', F, line).length, 0, `line ${line}: ${show(findings)}`);
});

test('inline: the clean module, setup-words, generated files and fixtures are never reported', async () => {
  const { findings } = await checkWords(product({}));
  assert.ok(!findings.some((f) => f.module === 'clean'), show(findings));
  assert.equal(at(findings, 'inline', 'setup-words').length, 0);
  assert.ok(!findings.some((f) => f.file.includes('words.generated.mjs') || f.file.includes('fixtures/')));
});

test('inline: a literal in a hand-written word table is tagged table', async () => {
  const root = product({ 'src/clean/words.mjs': 'export const W = { a: "Everyone who looks gets the same answer." };\n' });
  const { findings } = await checkWords(root);
  assert.ok(has(findings, 'inline', 'clean', 'src/clean/words.mjs', 1, 'table'), show(findings));
});

test('testcopy: an exact copy and a 25+ character substring are found; titles, short pieces and keys are not', async () => {
  const { findings } = await checkWords(product({}));
  const T = 'test/viol/a.test.mjs';
  assert.ok(has(findings, 'testcopy', 'viol', T, 5), show(findings));
  assert.ok(has(findings, 'testcopy', 'viol', T, 7, 'part'));
  for (const line of [4, 6, 8, 9, 10]) assert.equal(at(findings, 'testcopy', 'viol', T, line).length, 0, `line ${line}`);
});

test('missingkey: a literal key words.json lacks is found; a held key and a test of the refusal are not', async () => {
  const { findings } = await checkWords(product({}));
  assert.ok(has(findings, 'missingkey', 'viol', 'src/viol/index.mjs', 15), show(findings));
  assert.ok(has(findings, 'missingkey', 'viol', 'test/viol/a.test.mjs', 11));
  assert.equal(at(findings, 'missingkey', 'viol', 'test/viol/a.test.mjs', 9).length, 0);
  assert.equal(at(findings, 'missingkey', 'clean').length, 0);
});

test('missingkey: a key the generated word rows hold (a sentence written first in code) is not missing; one they lack is (bio K5579)', async () => {
  const rows = '/* GENERATED: do not edit by hand. */\nexport const WORD_ROWS = Object.freeze([\n  ["screen.home.title", "Home", null, null, false, "design"],\n  ["viol.code.first", "Written first in code.", null, null, false, "code"],\n]);\n';
  const t = ['import { word } from "../../src/setup-words/index.mjs";', 'export const held = word("viol.code.first");', 'export const gone = word("viol.code.never");', ''].join('\n');
  const { findings } = await checkWords(product({ 'bio-plane/src/setup-words/rows.mjs': rows, 'test/viol/rows.test.mjs': t }));
  assert.equal(at(findings, 'missingkey', 'viol', 'test/viol/rows.test.mjs', 2).length, 0, show(findings));
  assert.ok(has(findings, 'missingkey', 'viol', 'test/viol/rows.test.mjs', 3), show(findings));
});

test('missingkey: a key declared by a localize call in product source is not missing before the rows are regenerated (bio K5583)', async () => {
  const src = 'import { localize } from "../setup-words/index.mjs";\nexport const s = () => localize("viol.declared.here", "Declared in code first.");\n';
  const t = ['import { word } from "../../src/setup-words/index.mjs";', 'export const a = word("viol.declared.here");', 'export const b = word("viol.declared.nowhere");', ''].join('\n');
  const { findings } = await checkWords(product({ 'src/viol/declared.mjs': src, 'test/viol/declared.test.mjs': t }));
  assert.equal(at(findings, 'missingkey', 'viol', 'test/viol/declared.test.mjs', 2).length, 0, show(findings));
  assert.ok(has(findings, 'missingkey', 'viol', 'test/viol/declared.test.mjs', 3), show(findings));
});

test('missingkey: a key listed in words-reads.json that words.json lacks is found', async () => {
  const reads = { modules: { viol: { reads: ['screen.home.title', 'screen.gone.away'], unkeyed: [] }, clean: { reads: ['screen.home.title'], unkeyed: [] } } };
  const { findings } = await checkWords(product({ 'docs/development/ux-substrate/screens/words-reads.json': JSON.stringify(reads, null, 1) }));
  const R = 'docs/development/ux-substrate/screens/words-reads.json';
  assert.ok(at(findings, 'missingkey', 'viol', R).some((f) => f.raw === 'screen.gone.away' && Number.isInteger(f.line)), show(findings));
  assert.ok(!at(findings, 'missingkey', undefined, R).some((f) => f.raw === 'screen.home.title'));
});

test('handlist: 5+ foreign ops, refusal codes and word keys are found; short lists, mixed lists and a module\'s own ops are not', async () => {
  const { findings } = await checkWords(product({}));
  const T = 'test/viol/a.test.mjs';
  const kind = (line) => at(findings, 'handlist', 'viol', T, line).map((f) => [f.tag, f.why]);
  assert.deepEqual(kind(13), [['?', 'ops']], show(findings));
  assert.deepEqual(kind(14), [['?', 'codes']]);
  assert.deepEqual(kind(15), [[null, 'keys']]);
  assert.deepEqual([...kind(16), ...kind(17)], []);
  assert.equal(at(findings, 'handlist', 'owner').length, 0);
});

test('a module argument limits the check to that module', async () => {
  const { findings } = await checkWords(product({}), ['clean']);
  assert.deepEqual(findings, []);
});

test('the scanner: comments, regexes and nested templates are skipped; lines are counted', () => {
  const toks = scan('// "no no no no"\nconst r = /"x y z w"/g; /* "a b c d" */\nconst t = `a ${`b ${1}`} c`;\nconst s = "done";\n');
  const strs = toks.filter((t) => t.t === 'str');
  assert.deepEqual(strs.map((s) => [s.v, s.line]), [['a {} c', 3], ['done', 4]]);
});

test('isSentence: the rule in brief', () => {
  assert.equal(isSentence('Your project could not be found here.'), true);
  assert.equal(isSentence('no such project here, sorry'), false); // lowercase, no stop, no placeholder
  assert.equal(isSentence('no such project here, sorry.'), true);
  assert.equal(isSentence('there are {count} items waiting'), true);
  assert.equal(isSentence('Three words here'), false);
  assert.equal(isSentence('SELECT a FROM b WHERE c = ?'), false);
  assert.equal(isSentence('screen.home.greeting.title.x'), false);
  assert.equal(isSentence('MAX_RETRIES_FOR_THE_STORE_NOW'), false);
});

// Stitched sentences and developer messages (D15; BOB's ruling, P17).
test('inline: a stitched + chain whose joined text is a sentence fails once, tagged stitched; built-in errors are dev, custom ones stay ?', async () => {
  const root = product({
    'src/clean/index.mjs': [
      "export function f(list, n, who, x) {",                                                           // 1
      "  const a = 'The mean of ' + list.length + ' numbers is ' + mean(list) + '.';",                  // 2: stitched
      "  const b = 'Total: ' + n;",                                                                     // 3: not a sentence
      "  const c = `Hello ${who}, we could not save this.`;",                                           // 4: template, as before
      "  if (!x) throw new TypeError(`${who}: not a finite number: ${x}`);",                            // 5: dev
      "  if (!list.length) throw new RefusalError('The list is empty, so nothing was saved.');",        // 6: ?
      "  const d = head + '## Session Log' + tail;",                                                    // 7: scaffolding: passes
      "  return [a, b, c, d];",
      "}",
    ].join('\n') + '\n',
  });
  const r = await checkWords(root);
  const F = 'src/clean/index.mjs';
  const mine = at(r.findings, 'inline', 'clean');
  assert.ok(has(r.findings, 'inline', 'clean', F, 2, 'stitched'), show(mine));
  assert.ok(mine.some((f) => f.raw === 'The mean of {} numbers is {}.'), show(mine));
  assert.equal(at(mine, 'inline', 'clean', F, 2).length, 1);
  assert.equal([7, 3, 5].flatMap((l) => at(mine, 'inline', 'clean', F, l)).length, 0);
  assert.ok(has(r.findings, 'inline', 'clean', F, 4, ''));
  assert.ok(has(r.findings, 'inline', 'clean', F, 6, '?'));
  assert.equal(mine.length, 3, show(mine));
  const only = await checkWords(root, ['clean']);
  assert.equal(only.totals.dev, 1);
  assert.equal(only.totals.unkeyed, 0);
});

// Words B (bio K3930; words-B-design §10): localize(id, en, vars) is a reading; the marker arm; --release.
const mk = (m, f, line, why) => (x) => x.key === 'marker' && x.module === m && x.file === f && x.line === line && (!why || x.why === why);
test('localize: its id and en are never inline or testcopy findings; its id needs no row', async () => {
  const root = product({
    'src/clean/index.mjs': "import { localize } from '../setup-words/index.mjs';\nexport const a = localize('clean.index.nothing', 'There is nothing to add up yet.');\nexport const b = localize('clean.index.total', `The total is {total}.`, { total: 3 });\n",
    'test/clean/t.test.mjs': "import { localize } from '../../src/setup-words/index.mjs';\nconst x = localize('clean.index.nothing', 'There is nothing to add up yet.');\n",
  });
  const r = await checkWords(root, ['clean']);
  assert.deepEqual(r.findings, [], show(r.findings));
  assert.equal(r.totals.marker, 0);
});

test('testcopy: an assertion\'s message argument is never a copy; the same text as the expected value still is (bio K4053)', async () => {
  const root = product({
    'src/clean/index.mjs': "import { localize } from '../setup-words/index.mjs';\nexport const a = localize('m.a.b', 'no member is named');\n",
    'test/clean/msg.test.mjs': [
      "import assert from 'node:assert/strict';",
      "assert.doesNotMatch(JSON.stringify(all), /m1|m2/, 'no member is named');", // 2: match family, third argument: a message
      "assert.ok(!seen, 'no member is named');",                                   // 3: ok, second argument: a message
      "assert(!seen, 'no member is named');",                                      // 4: assert, second argument: a message
      "assert.equal(out.detail, 'no member is named');",                           // 5: the expected value: a copy
      "assert.equal(out.detail, 'no member is named', 'Nothing by that name is held here.');", // 6: expected found, message not
    ].join('\n') + '\n',
  });
  const r = await checkWords(root, ['clean']);
  const T = 'test/clean/msg.test.mjs';
  const on = (line) => at(r.findings, 'testcopy', 'clean', T, line);
  for (const line of [2, 3, 4]) assert.equal(on(line).length, 0, `line ${line}: ${show(on(line))}`);
  assert.equal(on(5).length, 1, show(r.findings));
  assert.equal(on(6).length, 1, show(r.findings));
  assert.equal(r.totals.testcopy, 2);
});

test('testcopy [code]: a test copying the en of a product localize call is found (bio K3962); controls are not', async () => {
  const root = product({
    'src/clean/index.mjs': "import { localize } from '../setup-words/index.mjs';\nexport const a = localize('m.a.b', 'the source could not be read today');\nexport const b = localize('m.a.c', 'Sent to {name} on time');\nexport const c = localize('m.a.d', 'Grade {UNREACHABLE_CAPTURE_GRADE} is not reachable');\n",
    'test/clean/code.test.mjs': [
      "import { localize } from '../../src/setup-words/index.mjs';",
      "import assert from 'node:assert/strict';",
      "assert.ok(out.includes('source could not be read today'));",                       // 3: a 25+ character substring (a regex literal is not read): found
      "assert.equal(out.says, 'Sent to {name} on time');",                                  // 4: exact copy, 2+ words, placeholder as it stands: found
      "assert.equal(out.says, localize('m.a.b', 'the source could not be read today'));", // 5: compares with localize: not a finding
      "assert.equal(out.n, 'source');",                                                     // 6: one word
      "assert.equal(out.says, 'could not be read');",                                       // 7: shares under 25 characters
      "assert.deepEqual(names, ['UNREACHABLE_CAPTURE_GRADE']);",                           // 8: an identifier inside a sentence: not a copy (bio K3967)
    ].join('\n') + '\n',
  });
  const r = await checkWords(root, ['clean']);
  const T = 'test/clean/code.test.mjs';
  assert.ok(has(r.findings, 'testcopy', 'clean', T, 3, 'code'), show(r.findings));
  assert.ok(has(r.findings, 'testcopy', 'clean', T, 4, 'code'), show(r.findings));
  for (const line of [5, 6, 7, 8]) assert.equal(at(r.findings, 'testcopy', 'clean', T, line).length, 0, `line ${line}`);
  // N2-10: each names the key the sentence lives under, the id of the localize call that holds it
  assert.deepEqual([3, 4].map((l) => at(r.findings, 'testcopy', 'clean', T, l)[0].wordKey), ['m.a.b', 'm.a.c']);
  assert.equal(r.totals.testcopy, 2);
});

test('localize: a localize bound to node:test (or any module but setup-words) is not the marker', async () => {
  const root = product({
    'test/clean/t.test.mjs': "import { test as localize } from 'node:test';\nlocalize('R1: The list is empty, so there is no total to show.', () => {});\nlocalize(label, fn);\n",
    'test/clean/u.test.mjs': "import localize from 'node:test';\nlocalize(label, fn);\n",
    'test/clean/v.test.mjs': "const localize = (a, b, c) => a;\nlocalize(label, 1, 2);\n",
    'test/clean/w.test.mjs': "import test from 'node:test';\ntest('R2: a t bound to node:test is plain code', () => {});\n",
  });
  const r = await checkWords(root, ['clean']);
  assert.deepEqual(r.findings, [], show(r.findings));
});

test('marker: a non-literal id or en, a malformed id, one id with two en, and a marker call in a drawn-screen module fail', async () => {
  const root = product({
    'build/modules.json': JSON.stringify({
      not_product: ['docs/', 'build/'],
      modules: [
        { id: 'setup-words', layer: 1, paths: ['src/setup-words/'], tests: ['test/setup-words/'], uses: [] },
        { id: 'clean', layer: 2, paths: ['src/clean/'], tests: ['test/clean/'], uses: [] },
        { id: 'screens-x', layer: 2, paths: ['src/screens-x/'], tests: [], uses: [] },
      ],
    }),
    'src/clean/index.mjs': [
      "import { localize } from '../setup-words/index.mjs';",
      "export const a = localize('clean.index.one', 'One thing is held here.');",   // 1
      "export const b = localize('clean.index.one', 'A different thing is here.');", // 2: two en
      "export const c = localize('clean.index.one', 'One thing is held here.');",   // 3: same en, fine
      "export const d = localize(id, 'Some sentence is given here.');",              // 4: id not literal
      "export const e = localize('clean.index.two', en);",                           // 5: en not literal
      "export const f = localize('Bad Id', 'Some other sentence here.');",          // 6: malformed id
      "export const g = localize('clean.index.three', 'Part ' + x);",               // 7: en not plain
    ].join('\n') + '\n',
    'src/screens-x/index.mjs': "import { localize } from '../setup-words/index.mjs';\nexport const h = localize('screens-x.index.title', 'A drawn screen title.');\n", // 1: drawn
    'src/viol/index.mjs': 'export const ok = 1;\n', 'test/viol/a.test.mjs': 'export const ok = 1;\n',
    'src/owner/index.mjs': 'export const ok = 1;\n', 'test/owner/a.test.mjs': 'export const ok = 1;\n',
  });
  const { findings } = await checkWords(root, ['clean', 'screens-x']);
  const m = at(findings, 'marker');
  const F = 'src/clean/index.mjs';
  assert.equal(m.filter(mk('clean', F, 3, 'two-en')).length, 1, show(m));
  assert.ok(!m.some(mk('clean', F, 2)) && !m.some(mk('clean', F, 4)));
  for (const [line, why] of [[5, 'id-not-literal'], [6, 'en-not-literal'], [7, 'id-malformed'], [8, 'en-not-literal']]) assert.ok(m.some(mk('clean', F, line, why)), `line ${line}: ${show(m)}`);
  assert.ok(m.some(mk('screens-x', 'src/screens-x/index.mjs', 2, 'drawn')), show(m));
  assert.equal(m.length, 6, show(m));
});

test('--release: each row of words-unreviewed.json fails; without the flag none does', async () => {
  const U = { unreviewed: [{ id: 'clean.index.a', en: 'x', module: 'clean', file: 'src/clean/index.mjs', line: 4 }, { id: 'viol.index.b', en: 'y', module: 'viol', file: 'src/viol/index.mjs', line: 9 }] };
  const root = product({ 'bio-plane/src/setup-words/words-unreviewed.json': JSON.stringify(U) });
  const plain = await checkWords(root, ['clean']);
  assert.equal(at(plain.findings, 'unreviewed').length, 0);
  const all = await checkWords(root, [], { release: true });
  assert.deepEqual(at(all.findings, 'unreviewed').map((f) => [f.module, f.file, f.line, f.raw]), [['clean', 'src/clean/index.mjs', 4, 'clean.index.a'], ['viol', 'src/viol/index.mjs', 9, 'viol.index.b']]);
  assert.equal(all.totals.unreviewed, 2);
});

test('marker: the word list\'s own module (setup-words) may hold malformed marker calls in its tests', async () => {
  const root = product({ 'test/setup-words/x.test.mjs': "import { localize } from '../../src/setup-words/index.mjs';\nt(id, en);\nt('Bad', 'x');\n" });
  const r = await checkWords(root, ['setup-words']);
  assert.deepEqual(at(r.findings, 'marker'), []);
});

test('inline: a sentence on the design\'s unkeyed list (words-reads.json) is not counted, unless it copies a row (bio K3944)', async () => {
  const reads = { modules: { clean: { reads: [], unkeyed: [{ file: 'clean/index.mjs', line: 1, text: 'A builder reads this rationale about the rung, never a member.', why: 'builders' }] } } };
  const root = product({
    'docs/development/ux-substrate/screens/words-reads.json': JSON.stringify(reads),
    'src/clean/index.mjs': "export const a = 'A builder reads this rationale about the rung, never a member.';\nexport const b = 'A member reads this sentence on the screen today.';\n",
  });
  const r = await checkWords(root, ['clean']);
  const inl = at(r.findings, 'inline');
  assert.equal(inl.length, 1, show(inl));
  assert.equal(inl[0].line, 2);
  assert.equal(r.totals.unkeyed, 1);
});

test('inline: a stitched chain whose joined text is on the design\'s unkeyed list is not counted; another still fails (UX-DESIGN U376)', async () => {
  const reads = { modules: { clean: { reads: [], unkeyed: [{ file: 'clean/index.mjs', line: 1, text: '{}\n## Session Log entry for the builders\n\n{}\n', why: 'log grammar' }] } } };
  const root = product({
    'docs/development/ux-substrate/screens/words-reads.json': JSON.stringify(reads),
    'src/clean/index.mjs': "export const a = (t, e) => t + '\\n## Session Log entry for the builders\\n\\n' + e + '\\n';\nexport const b = (n) => 'The record could not be read, so ' + n + ' items were not shown.';\n",
  });
  const r = await checkWords(root, ['clean']);
  const inl = at(r.findings, 'inline');
  assert.equal(inl.length, 1, show(inl));
  assert.deepEqual([inl[0].line, inl[0].tag], [2, 'stitched']);
  assert.equal(r.totals.unkeyed, 1);
});

test('inline: a row copy the design\'s unkeyed list names is not counted; an unlisted copy still is (bio K4038; UX-DESIGN U380)', async () => {
  const reads = { modules: { clean: { reads: [], unkeyed: [{ file: 'clean/index.mjs', line: 1, text: 'Nothing by that name is held here.', why: 'signed text (K1333)' }] } } };
  const root = product({
    'docs/development/ux-substrate/screens/words-reads.json': JSON.stringify(reads),
    'src/clean/index.mjs': "export const a = 'Nothing by that name is held here.';\nexport const b = 'That date is not one we can read.';\n",
  });
  const r = await checkWords(root, ['clean']);
  const inl = at(r.findings, 'inline');
  assert.equal(inl.length, 1, show(inl));
  assert.deepEqual([inl[0].line, inl[0].tag], [2, 'copy']);
  assert.equal(r.totals.unkeyed, 1);
});

// The plain arm (bio K3957): lowercase, unpunctuated prose of 5+ words is an inline finding tagged plain.
test('inline: a lowercase unpunctuated reason of 5+ words is tagged plain; controls are not findings (bio K3957)', async () => {
  const reads = { modules: { clean: { reads: [], unkeyed: [{ file: 'clean/index.mjs', line: 1, text: 'the builder alone reads this note about rungs', why: 'builders' }] } } };
  const root = product({
    'docs/development/ux-substrate/screens/words-reads.json': JSON.stringify(reads),
    'src/setup-words/index.mjs': 'export const x = "This module holds all the English there is.";\n',
    'src/clean/index.mjs': [
      'import { localize } from "../setup-words/index.mjs";',
      'export const a = { why: "no active profile states how long minutes take" };',                     // 2: plain
      'export const b = localize("clean.a.b", "no active profile states how long minutes take");',        // 3: marker reading
      'export const c = { why: "no profile states minutes" };',                                           // 4: 4 words
      'export const d = { why: "no profile states how LONG minutes take" };',                             // 5: ALL-CAPS
      'export const e = { why: "no profile states how R12 minutes take" };',                              // 6: requirement ref
      'export const f = { why: "no profile states how `long` minutes take" };',                           // 7: backtick
      'export const g = { why: " no profile states how long minutes take" };',                            // 8: leading space
      'export const h = { why: "no profile states how snake_case minutes take" };',                       // 9: identifier
      'export const i = { why: "the builder alone reads this note about rungs" };',                       // 10: unkeyed
      'export function j() { throw new Error("no profile states how long minutes take"); }',              // 11: dev text
    ].join('\n') + '\n',
    'test/clean/b.test.mjs': 'export const k = { why: "no profile states how long minutes take" };\n',   // a test file
  });
  const r = await checkWords(root, ['clean']);
  const inl = at(r.findings, 'inline');
  assert.equal(inl.length, 1, show(inl));
  assert.deepEqual([inl[0].file, inl[0].line, inl[0].tag], ['src/clean/index.mjs', 2, 'plain']);
  assert.equal(r.totals.inline, 1);
  assert.equal(r.totals.plain, 1);
});

test('isPlainSentence: the rule in brief; isSentence is unchanged', () => {
  assert.equal(isPlainSentence('no line of the document reads as a roster row'), true);
  assert.equal(isPlainSentence('No line of the document reads as a roster row'), false); // isSentence already takes it
  assert.equal(isPlainSentence('no line reads as a row.'), false);
  assert.equal(isSentence('no line of the document reads as a roster row'), false);
  assert.equal(isPlainSentence('no line of the document reads K3957 as a row'), false);
  assert.equal(isPlainSentence('no line of the document reads N4 as a row'), false);
  assert.equal(isPlainSentence('no line of the document reads DEC-83 as a row'), false);
  assert.equal(isPlainSentence('a line of the document reads as a row '), false);
});

// Literal chains: `"a" + "b"` of pure literals is judged as one literal at its first line.
test('inline: a + chain of pure literals is one literal at its first line; chains with a non-literal operand are unchanged', async () => {
  const root = product({
    'src/clean/index.mjs': [
      "import { localize } from '../setup-words/index.mjs';",
      "export const a = 'The record could not be read, ' +",                      // 2: one finding, at line 2
      "  // a comment between",
      "  `so nothing was shown.`;",
      "export const b = localize('clean.index.x', 'There is nothing ' + 'to add up yet.');", // 5: a reading, as for one literal
      "export const c = 'The record could not be ' + why + ' so nothing was shown.';",       // 6: stitched, as today
      "export const d = 'Save' + ' now';",                                        // 7: two short labels: not a sentence
      "export const e = 'The record could not be read, ' + 'so nothing was shown.' + tail;", // 8: a non-literal operand: stitched as today
      "export const f = 'The record could not be ' + 'read'.trim();",              // 9: left as today
    ].join('\n') + '\n',
  });
  const r = await checkWords(root, ['clean']);
  const F = 'src/clean/index.mjs';
  const mine = at(r.findings, 'inline', 'clean');
  assert.ok(has(r.findings, 'inline', 'clean', F, 2, ''), show(mine));
  assert.ok(mine.some((x) => x.raw === 'The record could not be read, so nothing was shown.'), show(mine));
  assert.ok(!at(r.findings, 'marker').length && !at(mine, 'inline', 'clean', F, 5).length, show(r.findings));
  assert.ok(has(r.findings, 'inline', 'clean', F, 6, 'stitched'));
  assert.equal(at(mine, 'inline', 'clean', F, 7).length, 0);
  assert.ok(has(r.findings, 'inline', 'clean', F, 8, 'stitched'));
  assert.ok(at(mine, 'inline', 'clean', F, 9).every((x) => !x.raw.includes('so nothing')), show(mine)); // as today (git stash to compare)
  assert.equal(at(mine, 'inline', 'clean', F, 2).length, 1);
});

test('foldLiteralChains: quotes and templates join; interpolated, mixed and member operands do not', () => {
  const v = (src) => foldLiteralChains(scan(src)).filter((t) => t.t === 'str').map((t) => [t.v, t.line]);
  assert.deepEqual(v('x("a" + \'b\' +\n `c`)'), [['abc', 1]]);
  assert.deepEqual(v('x(y + "a" + "b")'), [['a', 1], ['b', 1]]);
  assert.deepEqual(v('x("a" + `b${z}`)'), [['a', 1], ['b{}', 1]]);
  assert.deepEqual(v('x("a" + "b".length)'), [['a', 1], ['b', 1]]);
  assert.deepEqual(v('x("a" + "b" + y)'), [['a', 1], ['b', 1]]);
});

test('testenglish (bio K5426): off without a baseline; with one, English in a new or grown test file is refused and a shrunk one is not', async () => {
  const files = {
    'src/viol/index.mjs': 'export const says = "Your project could not be found here.";\n',
    'test/viol/old.test.mjs': [
      'import assert from "node:assert/strict";',
      'assert.ok(x.includes("Your project could not be found here."));',      // product text
      'assert.match(y, /not found/);',                                         // a fragment under 12 characters is not judged
      'assert.match(y, /Your project could not be found/);',                   // regex: product text
      'assert.equal(z, "Some words only the test knows about.");',            // in neither: test data
    ].join('\n') + '\n',
    'test/viol/fresh.test.mjs': 'import assert from "node:assert/strict";\nassert.ok(x.includes("You cannot see that project here."));\n',
  };
  const root = product(files);
  const off = await checkWords(root);
  assert.equal(off.totals.testenglish, 0, 'no baseline file: the arm is off');
  const rec = await checkWords(root, [], { record: true });
  assert.equal(rec.englishNow['test/viol/fresh.test.mjs'], 1);
  assert.equal(rec.englishNow['test/viol/old.test.mjs'], 2);
  // the check reads the commit (R10): each baseline is committed before the run
  const w = (obj) => { writeFileSync(join(root, 'build/tests-english-baseline.json'), JSON.stringify({ files: obj })); execFileSync('git', ['-C', root, 'add', '-A']); execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'baseline']); };
  w({ 'test/viol/old.test.mjs': 2, 'test/viol/a.test.mjs': 99 });
  let r = await checkWords(root);
  assert.deepEqual(at(r.findings, 'testenglish').map((x) => [x.file, x.tag]), [['test/viol/fresh.test.mjs', 'new']]);
  assert.equal(at(r.findings, 'testenglish')[0].wordKey, 'refusal.NO_ACCESS', 'it names the key the sentence lives under (N2-10)');
  w({ 'test/viol/old.test.mjs': 1, 'test/viol/fresh.test.mjs': 1, 'test/viol/a.test.mjs': 99 });
  r = await checkWords(root);
  assert.equal(at(r.findings, 'testenglish').length, 2, 'a file that grew past its baseline lists all its sites');
  assert.equal(at(r.findings, 'testenglish', 'viol', 'test/viol/old.test.mjs')[0].tag, 'grew 1 to 2');
  w({ 'test/viol/old.test.mjs': 5, 'test/viol/fresh.test.mjs': 1, 'test/viol/a.test.mjs': 99 });
  r = await checkWords(root);
  assert.equal(at(r.findings, 'testenglish').length, 0, 'under the baseline: no finding');
});

// N2-10 (ARC-3; build/requirements/architecture.md R7): a literal user-facing sentence in a test names the key it lives under.
test('testcopy (N2-10): an exact copy and a part copy name the key of the row that holds the sentence; the same test by key passes', async () => {
  const T = 'test/clean/key.test.mjs';
  const byWords = ['import assert from "node:assert/strict";', 'assert.equal(out.says, "Nothing by that name is held here.");', 'assert.match(out.text, "Welcome back, {name}. Your team has");'].join('\n') + '\n';
  const r = await checkWords(product({ [T]: byWords }), ['clean']);
  assert.deepEqual(at(r.findings, 'testcopy').map((f) => [f.line, f.tag, f.wordKey]), [[2, null, 'refusal.NOT_FOUND'], [3, 'part', 'screen.home.greeting']]);
  const byKey = ['import assert from "node:assert/strict";', 'import { word } from "../../src/setup-words/index.mjs";', 'assert.equal(out.says, word("refusal.NOT_FOUND"));', 'assert.equal(out.text, word("screen.home.greeting", { name: "A", count: 3 }));'].join('\n') + '\n';
  assert.deepEqual((await checkWords(product({ [T]: byKey }), ['clean'])).findings, []);
});
