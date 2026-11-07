// The cross-account channel (mechanics: the cross-account channel; bio K954): tools/mail.mjs's x-commands and checks/channels.mjs
// against a real remote. A bare origin holds `main` with the registry; one clone plays BOB, one UX-DESIGN, each
// writing only its own mail branch (`mail/BOB`, `mail/UX-DESIGN`). The check's failures are made by hand-written
// commits on a mail branch, each pushed as an ordinary fast-forward (and one forced, in a scratch remote only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { xwriter, xpost, xinbox, xdone, xcheck, parseRegistry, parseOutbox } from '../../tools/mail.mjs';
import { checkChannels, refreshChannels } from '../channels.mjs';

// The runner's order (checks/run.mjs): refresh the mail branches (fetch, and the forced-rewrite comparison against the tip
// read before), then the check over the commits now held (R10). Findings by key and fields (R11).
const channels = (dir) => { const fresh = refreshChannels(dir); const r = checkChannels(dir); return { ...r, findings: [...fresh.findings, ...r.findings] }; };
const keyed = (dir) => channels(dir).findings.map((f) => [f.key, f.participant, f.entry ?? null]);

const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const SB = 'session_01BBBBBBBBBBBBBBBBBBBBBBBB', SB2 = 'session_01CCCCCCCCCCCCCCCCCCCCCCCC', SU = 'session_01UUUUUUUUUUUUUUUUUUUUUUUU';
const REGISTRY = `# Channels (mechanics: the cross-account channel)

| name | account | mail branch | outbox | letter | writes |
| --- | --- | --- | --- | --- | --- |
| \`BOB\` | secondary | \`mail/BOB\` | \`mail/BOB.md\` | B | BOB and its successors |
| \`UX-DESIGN\` | primary | \`mail/UX-DESIGN\` | \`mail/UX-DESIGN.md\` | U | the UX design session and its successors |
`;

function world() {
  const base = mkdtempSync(join(tmpdir(), 'channel-'));
  const origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const clone = (name, branch) => {
    const d = join(base, name);
    execFileSync('git', ['clone', '-q', ...(branch ? ['-b', branch] : []), origin, d], { stdio: 'ignore' });
    for (const [k, v] of [['user.name', name], ['user.email', `${name}@t`], ['commit.gpgsign', 'false']]) g(d, 'config', k, v);
    return d;
  };
  const seed = clone('seed');
  mkdirSync(join(seed, 'build'), { recursive: true });
  writeFileSync(join(seed, 'build/channels.md'), REGISTRY);
  writeFileSync(join(seed, 'README.md'), 'product\n');
  g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'seed'); g(seed, 'branch', '-M', 'main'); g(seed, 'push', '-q', 'origin', 'main');
  g(seed, 'push', '-q', 'origin', 'main:refs/heads/tranche/T1');
  // BOB works from its tranche branch, UX-DESIGN from main: the x-commands never touch either working tree.
  return { base, origin, bob: clone('bob', 'tranche/T1'), ux: clone('ux', 'main'), clone };
}
const remoteText = (w, branch, path) => execFileSync('git', ['--git-dir', w.origin, 'show', `${branch}:${path}`], { encoding: 'utf8' });

// Both participants joined, BOB has posted B1 and B2, UX-DESIGN has read through B1 and posted U1.
function exchanged() {
  const w = world();
  xwriter({ product: w.bob, as: 'BOB', session: SB, account: 'secondary', date: '2026-10-01' });
  xwriter({ product: w.ux, as: 'UX-DESIGN', session: SU, date: '2026-10-01' });
  xpost({ product: w.bob, as: 'BOB', kind: 'NOTICE', body: 'K904 (Bob): a project\'s stage is computed.\nFolded: R35, R56 (T21).' });
  xpost({ product: w.bob, as: 'BOB', kind: 'DEFER', body: 'The retraction question (N470, its question 36).' });
  xdone({ product: w.ux, as: 'UX-DESIGN', from: 'BOB', through: 'B1' });
  xpost({ product: w.ux, as: 'UX-DESIGN', kind: 'ACK', re: 'B1', body: 'K904 cited in DEC-100.' });
  return w;
}
// A hand-made commit on a mail branch, as a session writing by hand would make it.
function handEdit(w, branch, path, edit, { force = false } = {}) {
  const d = w.clone(`hand-${Math.random().toString(36).slice(2, 8)}`, branch);
  const f = join(d, path);
  if (force) { g(d, 'reset', '-q', '--hard', 'HEAD~1'); }
  const text = readFileSync(f, 'utf8');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, edit(text));
  g(d, 'commit', '-q', '-am', 'by hand');
  g(d, 'push', '-q', ...(force ? ['-f'] : []), 'origin', `HEAD:refs/heads/${branch}`);
}

test('channels: the registry gives each participant its account, branch, outbox and letter', () => {
  const reg = parseRegistry(REGISTRY);
  assert.deepEqual(reg.map((p) => [p.name, p.account, p.branch, p.outbox, p.letter]), [
    ['BOB', 'secondary', 'mail/BOB', 'mail/BOB.md', 'B'], ['UX-DESIGN', 'primary', 'mail/UX-DESIGN', 'mail/UX-DESIGN.md', 'U']]);
  // Without a letter column, the letter is the name's first.
  const bare = parseRegistry('| name | account | branch | outbox |\n|---|---|---|---|\n| BOB | s | mail/BOB | mail/BOB.md |\n| UX-DESIGN | p | mail/UX-DESIGN | mail/UX-DESIGN.md |\n');
  assert.deepEqual(bare.map((p) => p.letter), ['B', 'U']);
  assert.throws(() => parseRegistry('| name | account | branch | outbox |\n|---|---|---|---|\n| BOB | s | mail/BOB | a |\n| BEE | p | mail/BEE | b |\n'), /B given twice/);
});

test('channels: xwriter creates the writer\'s own mail branch as an orphan holding only its outbox, Writer line first', () => {
  const w = world();
  const r = xwriter({ product: w.bob, as: 'BOB', session: SB, account: 'secondary', date: '2026-10-01' });
  assert.equal(r.changed, true);
  assert.equal(g(w.bob, 'ls-tree', '-r', '--name-only', 'origin/mail/BOB').trim(), 'mail/BOB.md');
  assert.equal(g(w.bob, 'rev-list', '--count', 'origin/mail/BOB').trim(), '1');
  assert.equal(remoteText(w, 'mail/BOB', 'mail/BOB.md'), `**Writer** · BOB · ${SB} · secondary · since 2026-10-01\n`);
  assert.equal(g(w.bob, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'tranche/T1');      // the working branch is untouched
  assert.equal(g(w.bob, 'status', '--porcelain'), '');
  assert.equal(xwriter({ product: w.bob, as: 'BOB', session: SB, account: 'secondary' }).changed, false);  // idempotent
  assert.throws(() => xwriter({ product: w.bob, as: 'BOB', session: SB, account: 'primary' }), /secondary account/);
  assert.throws(() => xwriter({ product: w.bob, as: 'NOBODY', session: SB }), /not in build\/channels.md/);
});

test('channels: post, read past the cursor, move it; each side writes only its own branch', () => {
  const w = exchanged();
  const bobBox = remoteText(w, 'mail/BOB', 'mail/BOB.md');
  assert.match(bobBox, /^\*\*Writer\*\* · BOB · session_01B+ · secondary · since 2026-10-01\n/);
  assert.match(bobBox, /^## B1 · NOTICE · \d{4}-\d{2}-\d{2} · session_01B+ · secondary\nK904 \(Bob\)/m);
  assert.match(bobBox, /^## B2 · DEFER · /m);
  const uxBox = remoteText(w, 'mail/UX-DESIGN', 'mail/UX-DESIGN.md');
  assert.match(uxBox, /^\*\*Writer\*\* · UX-DESIGN · session_01U+ · primary · since 2026-10-01\n\*\*Read\*\* · handled BOB B1\n\n## U1 · ACK · re B1 · /);
  // Every commit on a mail branch touches only its own outbox.
  for (const [branch, file] of [['mail/BOB', 'mail/BOB.md'], ['mail/UX-DESIGN', 'mail/UX-DESIGN.md']]) {
    assert.deepEqual([...new Set(execFileSync('git', ['--git-dir', w.origin, 'log', '--format=', '--name-only', branch], { encoding: 'utf8' }).split('\n').filter(Boolean))], [file]);
  }
  // UX-DESIGN read through B1: only B2 is past its cursor.
  let box = xinbox({ product: w.ux, as: 'UX-DESIGN', from: 'BOB' });
  assert.equal(box.cursor, 'B1');
  assert.deepEqual(box.entries.map((e) => `${e.id} ${e.kind}`), ['B2 DEFER']);
  // BOB has read nothing yet: U1, which names B1.
  box = xinbox({ product: w.bob, as: 'BOB', from: 'UX-DESIGN' });
  assert.deepEqual(box.entries.map((e) => [e.id, e.kind, e.re, e.session, e.account]), [['U1', 'ACK', 'B1', SU, 'primary']]);
  const d = xdone({ product: w.bob, as: 'BOB', from: 'UX-DESIGN', through: 'U1' });
  assert.equal(d.moved, true);
  assert.equal(xinbox({ product: w.bob, as: 'BOB', from: 'UX-DESIGN' }).entries.length, 0);
  // A stale or repeated done changes nothing; a done past what was posted, or of the wrong letter, is refused.
  assert.equal(xdone({ product: w.bob, as: 'BOB', from: 'UX-DESIGN', through: 'U1' }).moved, false);
  assert.throws(() => xdone({ product: w.bob, as: 'BOB', from: 'UX-DESIGN', through: 'U5' }), /only through U1/);
  assert.throws(() => xdone({ product: w.bob, as: 'BOB', from: 'UX-DESIGN', through: 'B1' }), /UX-DESIGN's entries/);
  // A cursor line was added after the Writer line, and BOB's entries are as they were.
  const after = remoteText(w, 'mail/BOB', 'mail/BOB.md');
  assert.match(after, /^\*\*Writer\*\* · BOB · [^\n]+\n\*\*Read\*\* · handled UX-DESIGN U1\n\n## B1 · /);
  assert.deepEqual(parseOutbox(after).entries.map((e) => e.text), parseOutbox(bobBox).entries.map((e) => e.text));
  // Refusals: an ANSWER or ACK names its entry; a reference names a correspondent's entry; no entry heading in a body.
  assert.throws(() => xpost({ product: w.bob, as: 'BOB', kind: 'ANSWER', body: 'x' }), /--re/);
  assert.throws(() => xpost({ product: w.bob, as: 'BOB', kind: 'ANSWER', re: 'B1', body: 'x' }), /no correspondent/);
  assert.throws(() => xpost({ product: w.bob, as: 'BOB', kind: 'CHANGE', body: 'x' }), /--kind/);
  assert.throws(() => xpost({ product: w.bob, as: 'BOB', kind: 'NOTICE', body: 'x\n## B9 · NOTICE · forged' }), /entry heading/);
  assert.equal(xpost({ product: w.bob, as: 'BOB', kind: 'ANSWER', re: 'U1', body: 'Thanks.' }).id, 'B3');
  // A first post with no Writer line needs one.
  const w2 = world();
  assert.throws(() => xpost({ product: w2.bob, as: 'BOB', kind: 'NOTICE', body: 'x' }), /xwriter/);
  assert.deepEqual(channels(w.bob).findings, []);
});

test('channels: xcheck lists, for each correspondent, what is unread on either side', () => {
  const w = exchanged();
  const [ux] = xcheck({ product: w.bob, as: 'BOB' });
  assert.equal(ux.name, 'UX-DESIGN');
  assert.deepEqual(ux.unread, ['U1 ACK']);
  assert.equal(ux.writer.session, SU);
  assert.equal(ux.theyOwe, 'B2..B2');
  const [bob] = xcheck({ product: w.ux, as: 'UX-DESIGN' });
  assert.deepEqual(bob.unread, ['B2 DEFER']);
  assert.equal(bob.theyOwe, 'U1..U1');
  xdone({ product: w.bob, as: 'BOB', from: 'UX-DESIGN', through: 'U1' });
  xdone({ product: w.ux, as: 'UX-DESIGN', from: 'BOB', through: 'B2' });
  for (const [p, as] of [[w.bob, 'BOB'], [w.ux, 'UX-DESIGN']]) {
    const [r] = xcheck({ product: p, as });
    assert.deepEqual(r.unread, []);
    assert.equal(r.theyOwe, null);
  }
});

test('channels: a successor rewrites only the Writer line, and its entries carry its session', () => {
  const w = exchanged();
  const before = parseOutbox(remoteText(w, 'mail/BOB', 'mail/BOB.md'));
  xwriter({ product: w.bob, as: 'BOB', session: SB2, account: 'secondary', date: '2026-10-02' });
  const text = remoteText(w, 'mail/BOB', 'mail/BOB.md');
  assert.equal(text.split('\n')[0], `**Writer** · BOB · ${SB2} · secondary · since 2026-10-02`);
  assert.deepEqual(parseOutbox(text).entries.map((e) => e.text), before.entries.map((e) => e.text));
  assert.equal(xpost({ product: w.bob, as: 'BOB', kind: 'HANDOFF', body: 'DEC-96 owed: requirements.' }).id, 'B3');
  const b3 = parseOutbox(remoteText(w, 'mail/BOB', 'mail/BOB.md')).entries.at(-1);
  assert.equal(b3.session, SB2);
  assert.deepEqual(channels(w.bob).findings, []);
});

test('channels check: a clean history passes; no registry means nothing to check', () => {
  const w = exchanged();
  xdone({ product: w.bob, as: 'BOB', from: 'UX-DESIGN', through: 'U1' });
  const r = channels(w.bob);
  assert.deepEqual(r.findings, []);
  assert.equal(r.counts.participants, 2);
  assert.ok(r.counts.commits > 0);
  const bare = mkdtempSync(join(tmpdir(), 'nochannel-'));
  g(bare, 'init', '-q');
  const none = checkChannels(bare);
  assert.deepEqual([none.findings, none.counts, none.absent], [[], { participants: 0, commits: 0 }, []]);
  // A participant that has not joined yet is named, not failed.
  const w2 = world();
  xwriter({ product: w2.bob, as: 'BOB', session: SB });
  const r2 = channels(w2.bob);
  assert.deepEqual([r2.findings, r2.absent], [[], ['UX-DESIGN']]);
});

test('channels check: an entry rewritten after it was pushed fails', () => {
  const w = exchanged();
  handEdit(w, 'mail/BOB', 'mail/BOB.md', (t) => t.replace('is computed', 'is written'));
  const f = channels(w.ux).findings;
  assert.deepEqual(f.map((x) => [x.key, x.participant, x.branch, x.file, x.entry]), [['entry-changed', 'BOB', 'mail/BOB', 'mail/BOB.md', 'B1']]);
  assert.match(f[0].commit, /^[0-9a-f]{7}$/);
});

test('channels check: a removed entry fails', () => {
  const w = exchanged();
  handEdit(w, 'mail/BOB', 'mail/BOB.md', (t) => t.replace(/\n## B2 · [\s\S]*$/, '\n'));
  assert.deepEqual(keyed(w.ux), [['entry-removed', 'BOB', 'B2']]);
});

test('channels check: a skipped number, or another\'s letter, fails', () => {
  const w = exchanged();
  handEdit(w, 'mail/BOB', 'mail/BOB.md', (t) => `${t.trimEnd()}\n\n## B4 · NOTICE · 2026-10-01 · ${SB} · secondary\nskipped B3\n`);
  assert.deepEqual(keyed(w.ux), [['numbering', 'BOB', 'B4']]);
  const w2 = exchanged();
  handEdit(w2, 'mail/BOB', 'mail/BOB.md', (t) => `${t.trimEnd()}\n\n## U3 · NOTICE · 2026-10-01 · ${SB} · secondary\nwrong letter\n`);
  assert.deepEqual(keyed(w2.ux), [['letter', 'BOB', 'U3']]);
});

test('channels check: a cursor moved backwards, or removed, fails', () => {
  const w = exchanged();
  xdone({ product: w.ux, as: 'UX-DESIGN', from: 'BOB', through: 'B2' });
  handEdit(w, 'mail/UX-DESIGN', 'mail/UX-DESIGN.md', (t) => t.replace('handled BOB B2', 'handled BOB B1'));
  assert.deepEqual(channels(w.bob).findings.map((f) => [f.key, f.participant, f.over, f.entry]), [['cursor-back', 'UX-DESIGN', 'BOB', 'B1']]);
  const w2 = exchanged();
  handEdit(w2, 'mail/UX-DESIGN', 'mail/UX-DESIGN.md', (t) => t.replace(/^\*\*Read\*\* · handled BOB B1\n/m, ''));
  assert.deepEqual(channels(w2.bob).findings.map((f) => [f.key, f.participant, f.over, f.entry]), [['cursor-removed', 'UX-DESIGN', 'BOB', 'B1']]);
});

test('channels check: a forced rewrite of a mail branch, invisible in the new history, fails against the tip read before', () => {
  const w = exchanged();
  assert.deepEqual(channels(w.ux).findings, []);           // the reader has seen the tip
  handEdit(w, 'mail/BOB', 'mail/BOB.md', (t) => `${t.trimEnd()}\n\n## B2 · NOTICE · 2026-10-01 · ${SB} · secondary\na different B2\n`, { force: true });  // B2 replaced by a forced push, scratch remote only
  const f = channels(w.ux).findings;
  assert.ok(f.some((x) => x.key === 'rewritten' && x.participant === 'BOB' && x.branch === 'mail/BOB'), JSON.stringify(f));
  // the check alone reads the commits the clone holds and never fetches (R10): the rewrite is the refresh's finding
  assert.ok(!checkChannels(w.ux).findings.some((x) => x.key === 'rewritten'));
});

// The same rewrite, met first by an x-command: the reader refuses it, names the branch and both tips, and keeps refusing
// (the forced fetch moves origin/<branch>, not the tip last read), and so does the check run after it.
const rewriteB2 = (w) => handEdit(w, 'mail/BOB', 'mail/BOB.md', (t) => `${t.trimEnd()}\n\n## B2 · NOTICE · 2026-10-01 · ${SB} · secondary\na different B2\n`, { force: true });
const REWRITTEN = /mail\/BOB: history rewritten: [0-9a-f]{7}, read before, is not in [0-9a-f]{7}/;

test('channels: xinbox first after a forced rewrite refuses, and so do later reads and the check', () => {
  const w = exchanged();
  xinbox({ product: w.ux, as: 'UX-DESIGN', from: 'BOB' });       // the reader has seen the tip
  const seen = g(w.ux, 'rev-parse', 'origin/mail/BOB').trim();
  rewriteB2(w);
  const fresh = execFileSync('git', ['--git-dir', w.origin, 'rev-parse', 'mail/BOB'], { encoding: 'utf8' }).trim();
  assert.throws(() => xinbox({ product: w.ux, as: 'UX-DESIGN', from: 'BOB' }), (e) => REWRITTEN.test(e.message) && e.message.includes(seen.slice(0, 7)) && e.message.includes(fresh.slice(0, 7)));
  assert.throws(() => xinbox({ product: w.ux, as: 'UX-DESIGN', from: 'BOB' }), REWRITTEN);
  assert.throws(() => xcheck({ product: w.ux, as: 'UX-DESIGN' }), REWRITTEN);
  assert.ok(channels(w.ux).findings.some((x) => x.key === 'rewritten' && x.branch === 'mail/BOB'));
});

test('channels: xcheck first after a forced rewrite refuses, and the check still fails', () => {
  const w = exchanged();
  xcheck({ product: w.ux, as: 'UX-DESIGN' });
  rewriteB2(w);
  assert.throws(() => xcheck({ product: w.ux, as: 'UX-DESIGN' }), REWRITTEN);
  assert.ok(channels(w.ux).findings.some((x) => x.key === 'rewritten' && x.branch === 'mail/BOB'));
  assert.ok(channels(w.ux).findings.some((x) => x.key === 'rewritten' && x.branch === 'mail/BOB'));   // and on its second run
});

test('channels: a plain fetch after a forced rewrite does not hide it from the reader', () => {
  const w = exchanged();
  xinbox({ product: w.ux, as: 'UX-DESIGN', from: 'BOB' });
  rewriteB2(w);
  g(w.ux, 'fetch', '-q', 'origin');                               // moves origin/mail/BOB by force
  assert.throws(() => xinbox({ product: w.ux, as: 'UX-DESIGN', from: 'BOB' }), REWRITTEN);
});

test('channels: an ordinary append after a read passes the readers and the check', () => {
  const w = exchanged();
  xinbox({ product: w.ux, as: 'UX-DESIGN', from: 'BOB' });
  assert.deepEqual(channels(w.ux).findings, []);
  xpost({ product: w.bob, as: 'BOB', kind: 'NOTICE', body: 'K905 (Bob): a later ruling.' });
  assert.deepEqual(xinbox({ product: w.ux, as: 'UX-DESIGN', from: 'BOB' }).entries.map((e) => e.id), ['B2', 'B3']);
  assert.deepEqual(xcheck({ product: w.ux, as: 'UX-DESIGN' })[0].unread, ['B2 DEFER', 'B3 NOTICE']);
  assert.deepEqual(channels(w.ux).findings, []);
});
