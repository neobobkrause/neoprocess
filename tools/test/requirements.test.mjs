// The requirements module's tests (build/requirements/requirements.md R1-R8), at its interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Q from '../requirements.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = (provides, invariants = '- **R9** pure.', extra = '') => `# m — requirements\n\n## Public\n\n### Purpose\n\nWhat m is for.\n\n### Provides\n\n${provides}\n\n## Private\n\n### Uses\n\n- \`record\`: \`repo\`.\n- \`a\`, \`b\`: \`f\`, \`g\`.\n- \`c.h\` and nothing else.\n\n### Invariants\n\n${invariants}\n\n### Satisfies\n\n- REQUIREMENTS.md §5.\n${extra}`;
const PROVIDES = '**first(a) → number** · **other(b)**\n- **R1** one.\n- **R2** two *(not yet met: N2)*\n\n**last(b), alias(c) → list**\n- **R3** three *(not yet met: N1, N2)*\n- **R4** (retired) *(retired: moved to x R1)*';

test('R1 parse answers the public part (Purpose; Provides with each interface line and its ids) and the private part (Uses as module.service, Invariants, Satisfies, Suggestions)', () => {
  const p = Q.parse(FILE(PROVIDES, '- **R9** pure.', '\n### Suggestions\n\n- a map, perhaps.\n'));
  assert.equal(p.purpose, 'What m is for.');
  assert.deepEqual(p.provides.map((b) => [b.names, b.interface, b.ids]), [[['first'], '**first(a) → number** · **other(b)**', ['R1', 'R2']], [['last', 'alias'], '**last(b), alias(c) → list**', ['R3', 'R4']]]);
  assert.deepEqual(p.uses, [{ module: 'c', services: ['h'] }, { module: 'record', services: ['repo'] }, { module: 'a', services: ['f', 'g'] }, { module: 'b', services: ['f', 'g'] }]);
  assert.deepEqual(p.invariants, [{ ids: ['R9'], text: '**R9** pure.' }]);
  assert.deepEqual(p.satisfies, ['REQUIREMENTS.md §5.']);
  assert.deepEqual(p.suggestions, ['a map, perhaps.']);
  assert.deepEqual(p.ids, { all: ['R1', 'R2', 'R3', 'R4', 'R9'], live: ['R1', 'R2', 'R3', 'R9'], retired: ['R4'] });
  assert.deepEqual(p.findings, []);
  // Suggestions binds nothing and may be absent
  assert.deepEqual(Q.parse(FILE(PROVIDES)).findings, []);
});

test('R1 a duplicate id, a statement without an id, or a part missing or out of order is a finding', () => {
  assert.deepEqual(Q.parse(FILE(`${PROVIDES}\n- **R2** again.`)).findings, ['ids given twice: R2']);
  assert.deepEqual(Q.parse(FILE(`${PROVIDES}\n- a statement with no id.`)).findings, ['a statement in Provides has no id: a statement with no id.']);
  assert.deepEqual(Q.parse(FILE(`- loose.\n\n${PROVIDES}`)).findings, ['a statement in Provides (outside any service) has no id: loose.']);
  assert.deepEqual(Q.parse(FILE(PROVIDES, '- an invariant with no id.')).findings, ['a statement in Invariants has no id: an invariant with no id.']);
  for (const s of Q.SECTIONS) {
    const f = Q.parse(FILE(PROVIDES).replace(new RegExp(`^${s}\\n`, 'm'), '')).findings;
    assert.ok(f.includes(`section "${s}" missing or out of order`), `${s}: ${f}`);
  }
  // out of order: Private before Public
  const swapped = FILE(PROVIDES).replace('## Public', '## Xublic').replace('## Private', '## Public').replace('## Xublic', '## Private');
  assert.ok(Q.parse(swapped).findings.some((x) => /out of order/.test(x)));
});

test('R2 serviceBlocks answers each provided service with its names and text; a requirement after the first jump in numbering is a block\'s only if it names the service', () => {
  const pub = '## Public\n\n### Purpose\n\nP.\n\n### Provides\n\n**first(a)**\n- **R1** one.\n- **R2** two.\n\n**last(b)**\n- **R3** three.\n- **R4** four.\n- **R9** (later) `last` also does this.\n- **R7** (later) about `first` only.\n- **R8** (later) about nothing named.\n- **R10** (later) `last` again.\n\n## Private\n\n### Uses\n\n- **R11** private, never a block.\n';
  const { purpose, blocks } = Q.serviceBlocks(pub);
  assert.equal(purpose, '### Purpose\n\nP.\n\n');
  assert.deepEqual(blocks.map((b) => [b.names, b.text.match(/R\d+/g)]), [[['first'], ['R1', 'R2']], [['last'], ['R3', 'R4', 'R9', 'R10']]]);
  assert.equal(blocks[0].text, '**first(a)**\n- **R1** one.\n- **R2** two.\n\n');
  // a change to what is provided reads as the blocks whose text differs and the names a header adds or drops
  const after = Q.serviceBlocks(pub.replace('- **R2** two.', '- **R2** two, now three.').replace('**last(b)**', '**last(b), more(c)**'));
  assert.deepEqual(after.blocks.map((b) => b.names), [['first'], ['last', 'more']]);
  assert.notEqual(after.blocks[0].text, blocks[0].text);
  assert.deepEqual(Q.serviceBlocks('## Public\n\n### Purpose\n\nP.\n').blocks, []);
});

test('R3 marks reads the not-yet-met marks by id; strike removes a mark or one tranche of its list on the ids named and changes nothing else; a retired id reads retired', () => {
  const t = FILE(PROVIDES);
  assert.deepEqual(Q.marks(t), [{ id: 'R2', tranches: ['N2'] }, { id: 'R3', tranches: ['N1', 'N2'] }, { id: 'R4', retired: true, tranches: [] }]);
  const s = Q.strike(t, ['R2', 'R3'], 'N2');
  assert.match(s, /^- \*\*R2\*\* two$/m);
  assert.match(s, /^- \*\*R3\*\* three \*\(not yet met: N1\)\*$/m);
  assert.deepEqual(s.split('\n').filter((l, i) => l !== t.split('\n')[i]).length, 2);
  // only the ids named; a tranche the mark does not hold leaves it as it is
  assert.equal(Q.strike(t, ['R1'], 'N2'), t);
  assert.equal(Q.strike(t, ['R3'], 'N9'), t);
  assert.equal(Q.strike(Q.strike(t, ['R3'], 'N1'), ['R3'], 'N2').split('\n').find((l) => l.includes('**R3**')), '- **R3** three');
  assert.deepEqual(Q.marks('- **R5** gone *(moved to other R2)*'), [{ id: 'R5', retired: true, tranches: [] }]);
  assert.deepEqual(Q.parse(FILE(`${PROVIDES}\n- **R5** gone *(moved to other R2)*`)).ids.retired, ['R4', 'R5']);
});

test('R4 a Test line naming a fixture above the manifest\'s size, or a figure on a deployed copy, is a measurement; the review brief\'s sentence says an untaken measurement is not a gap', () => {
  const none = '# Manifest\n';
  for (const l of ['- **Test:** a 1,000,000-row fixture, under 2 s.', 'Test: 10⁶ elements.', 'Test: 10^6 records.', 'Test: 2M rows.', 'Test: a million rows.', 'Test: 100,001 rows.', 'Test: on the deployed copy, p95 under 200 ms.', 'Test: against production.'])
    assert.equal(Q.isMeasurement(l, none), true, l);
  for (const l of ['Test: 3 rows.', 'Test: 100,000 rows.', 'Test: R18 R19 R20 (N117), a corpus of 23 bundles of which a viewer sees 4.', 'Test: 2,000 ms timeout with 12 rows.', 'Test: returns 1000000 for a large sum.'])
    assert.equal(Q.isMeasurement(l, none), false, l);
  // the product's manifest sets the size; 100,000 rows when it sets none
  assert.equal(Q.fixtureLimit(none), 100000);
  const small = '| fixture limit | 5,000 rows |\n';
  assert.equal(Q.fixtureLimit(small), 5000);
  assert.equal(Q.isMeasurement('Test: 6,000 rows.', small), true);
  assert.equal(Q.isMeasurement('Test: 6,000 rows.', none), false);
  assert.match(Q.MEASUREMENT_RULE, /measurement with its own id in the plan, never a Test line/);
  assert.match(Q.MEASUREMENT_RULE, /a measurement not yet taken is not a gap/);
});

// A product checkout as record.repo answers it, reduced to its one read (R7): any other member throws.
function checkout(files) {
  const reads = [];
  const R = new Proxy({ read: (p) => { reads.push(p); return files[p] ?? null; } }, { get: (o, k) => { if (k in o) return o[k]; throw new Error(`R.${String(k)} touched`); } });
  return { R, reads };
}
const MODULES = { modules: [{ id: 'record', layer: 1, paths: ['tools/record.mjs'], tests: [], uses: [] }, { id: 'm', layer: 2, paths: ['tools/m.mjs'], tests: ['tools/test/m.test.mjs'], uses: ['record', 'quiet'] }, { id: 'quiet', layer: 1, paths: [], tests: [], uses: [] }] };
const LAYERS = '# Layers\n\n| layer | contract | modules |\n| --- | --- | --- |\n| 1 | below | record, quiet |\n| 2 | this one | m |\n| 3 | above | z |\n';
const USED = '# record\n\n## Public\n\n### Purpose\n\nThe record.\n\n### Provides\n\n**repo(root) → R**\n- **R1** opens it.\n\n**stateRead(R) → text**\n- **R2** reads.\n\n## Private\n\n### Uses\n\n- nothing\n';
const SET = (own) => ({ 'build/modules.json': JSON.stringify(MODULES), 'build/layers.md': LAYERS, 'build/requirements/m.md': own, 'build/requirements/record.md': USED, 'build/requirements/quiet.md': USED.replace('The record.', 'Quiet.') });

test('R5 readingSet measures a job\'s set in bytes against a fraction of the model\'s window from the table it is given, and marks a set over budget with what was trimmed', () => {
  const own = FILE(PROVIDES), { R } = checkout(SET(own));
  const rs = Q.readingSet(R, 'm', { window: 1000000, fraction: 0.15, bytesPerToken: 3 });
  const layerPart = Buffer.byteLength(LAYERS.split('\n').filter((l) => /^\|/.test(l)).filter((l, i) => i < 2 || /\| m \|/.test(l)).join('\n'));
  const recordPart = Buffer.byteLength('### Purpose\n\nThe record.\n\n') + Buffer.byteLength('**repo(root) → R**\n- **R1** opens it.\n\n');
  const quietPart = Buffer.byteLength('### Purpose\n\nQuiet.\n\n');
  assert.equal(rs.bytes, Buffer.byteLength(own) + layerPart + recordPart + quietPart);
  assert.equal(rs.budget, 450000);
  assert.equal(rs.over, false);
  assert.deepEqual(rs.files, ['build/requirements/m.md', 'build/layers.md (the head and layer 2\'s row)', 'build/requirements/record.md (Public: Purpose; repo)', 'build/requirements/quiet.md (Public: Purpose; no service named in its Uses line: read a service whole when the job touches it)']);
  assert.deepEqual(rs.code, ['tools/m.mjs', 'tools/test/m.test.mjs']);
  assert.deepEqual(rs.missing, []);
  assert.deepEqual(rs.trimmed, ['build/layers.md to its head and the module\'s row', 'build/requirements/record.md to its Purpose and repo', 'build/requirements/quiet.md to its Purpose']);
  // the budget follows the table: a smaller window or fraction, the same set over it
  const tight = Q.readingSet(R, 'm', { window: rs.bytes - 1, fraction: 1, bytesPerToken: 1 });
  assert.equal(tight.over, true); assert.equal(tight.budget, rs.bytes - 1);
  assert.equal(Q.readingSet(R, 'm', { window: rs.bytes, fraction: 1, bytesPerToken: 1 }).over, false);
  assert.equal(Q.readingSet(R, 'm', { window: rs.bytes, fraction: 0.5, bytesPerToken: 2 }).over, false);
  // no table, no budget: there is no byte figure to fall back on
  for (const t of [undefined, {}, { window: 1000000 }, { fraction: 0.15, bytesPerToken: 3 }, { window: 1000000, fraction: 0.15 }, { window: 0, fraction: 0.15, bytesPerToken: 3 }, { window: 1000000, fraction: 2, bytesPerToken: 3 }, { window: 1000000, fraction: 0.15, bytesPerToken: 0 }])
    assert.throws(() => Q.readingSet(R, 'm', t), /the Sessions table/);
  // the record of an overrun: its size, the module, what was trimmed; the job is not started
  const rec = Q.overrun('m', tight);
  assert.match(rec, new RegExp(`size: ${tight.bytes} bytes, budget ${tight.budget}`));
  assert.match(rec, /^- module: m$/m);
  assert.match(rec, /^- trimmed: build\/layers\.md to its head/m);
  assert.match(rec, /the job is not started/);
  // a file the set needs and the record lacks is named
  const gone = SET(own); delete gone['build/requirements/quiet.md'];
  assert.deepEqual(Q.readingSet(checkout(gone).R, 'm', { window: 1000000, fraction: 0.15, bytesPerToken: 3 }).missing, ['build/requirements/quiet.md']);
  assert.throws(() => Q.readingSet(R, 'nobody', { window: 1000000, fraction: 0.15, bytesPerToken: 3 }), /no module nobody/);
});

test('R6 a module\'s own requirements are never replaced by a summary: a set over budget is still its requirements whole, and a summary on record is never read', () => {
  const own = `${FILE(PROVIDES)}\n${'- a long private note.\n'.repeat(20000)}`, files = SET(own);
  files['build/plan/current.md'] = '# Plan: test N2\n';
  files['build/summaries/N2/m.md'] = '# m for N2\n\n- `first` adds (m R1).\n';
  const { R, reads } = checkout(files);
  const rs = Q.readingSet(R, 'm', { window: 1000000, fraction: 0.15, bytesPerToken: 3 });
  assert.equal(rs.over, true);
  assert.equal(rs.files[0], 'build/requirements/m.md');
  assert.ok(rs.bytes > Buffer.byteLength(own));
  assert.ok(!rs.files.some((f) => /summar/.test(f)));
  assert.ok(!reads.some((p) => /summar/.test(p)), reads.join(', '));
});

test('R7 parsing and measuring are pure: the only read is the checkout\'s file read; nothing else of the record is touched', () => {
  const own = FILE(PROVIDES), { R, reads } = checkout(SET(own));
  Q.readingSet(R, 'm', { window: 1000000, fraction: 0.15, bytesPerToken: 3 });
  assert.deepEqual([...new Set(reads)].sort(), ['build/layers.md', 'build/modules.json', 'build/requirements/m.md', 'build/requirements/quiet.md', 'build/requirements/record.md']);
  // the text functions take text and give text: the same input, the same answer, the input unchanged
  const t = FILE(PROVIDES);
  assert.deepEqual(Q.parse(t), Q.parse(t));
  assert.equal(Q.strike(t, ['R2'], 'N2'), Q.strike(t, ['R2'], 'N2'));
  assert.equal(t, FILE(PROVIDES));
});

test('R8 the parser accepts every requirements file on the tranche as it stands, and the dry run\'s', () => {
  let n = 0;
  for (const dir of ['build/requirements', 'dryrun/build/requirements']) for (const f of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.md') && x !== 'README.md')) {
    const p = Q.parse(readFileSync(join(ROOT, dir, f), 'utf8'));
    assert.deepEqual(p.findings, [], `${dir}/${f}`);
    assert.ok(p.ids.live.length > 0, `${dir}/${f}`);
    n++;
  }
  assert.ok(n >= 12);
});
