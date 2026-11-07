// tools/proc.mjs against a real remote: a bare origin seeded with the dry run's toy product on the fixed `tranche` branch,
// one clone as BOB. The state branch by plumbing, an epoch, the ask's whole life through a lane, the lane's life, the
// queue and the generated handoff, and each refusal the protocol names (PROTOCOL §3–§8, SESSIONS §6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as N from '../proc.mjs';
import { versionCommand, processHead } from '../platform.mjs';
import { MEASUREMENT_RULE, budgetOf } from '../requirements.mjs';
import * as P from '../planning.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), TOY = join(HERE, '..', '..', 'dryrun');
const B1 = 'session_01BBBBBBBBBBBBBBBBBBBBBBBB', B2 = 'session_01BBBBBBBBBBBBBBBBBBBBBBB2', J1 = 'session_01AAAAAAAAAAAAAAAAAAAAAAAA', L1 = 'session_01LLLLLLLLLLLLLLLLLLLLLLLL';
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ident = (d, n) => { for (const [k, v] of [['user.name', n], ['user.email', `${n}@t`], ['commit.gpgsign', 'false']]) g(d, 'config', k, v); };
const f = (dir, name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

function world(opts = {}) {
  const base = mkdtempSync(join(tmpdir(), 'proc-'));
  const origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const seed = join(base, 'seed');
  execFileSync('git', ['clone', '-q', origin, seed], { stdio: 'ignore' }); ident(seed, 'seed');
  cpSync(TOY, join(seed, 'toy'), { recursive: true });
  g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'seed'); g(seed, 'branch', '-M', 'main'); g(seed, 'push', '-q', 'origin', 'main');
  if (!opts.noTranche) g(seed, 'push', '-q', 'origin', `main:refs/heads/${N.TRANCHE}`);
  const clone = (name) => { const d = join(base, name); execFileSync('git', ['clone', '-q', '-b', opts.noTranche ? 'main' : N.TRANCHE, origin, d], { stdio: 'ignore' }); ident(d, name); return { dir: join(d, 'toy'), root: d }; };
  return { base, origin, bob: clone('bob'), clone };
}
const O = (w, extra = {}) => ({ product: w.bob.dir, ...extra });
// the grants proven held now (PERMISSIONS §10.3), as `proc grants check` records them
const heldGrants = (root, at = new Date()) => writeFileSync(join(root, '.git', N.GRANTS_FILE), JSON.stringify({ at: at.toISOString(), ok: true, rows: [] }));

test('an epoch, an ask through a dormant lane, the lane\'s life, the queue, the handoff, the epoch closed', () => {
  const w = world(), o = (x) => O(w, x);
  // no epoch: everything that needs the state branch refuses; takeover before an epoch too
  assert.throws(() => N.status(o()), /no epoch is open/);
  const e1 = N.epochOpen(o());
  assert.equal(e1.epoch, 'E1');
  assert.deepEqual(w.bob.root && N.repo(w.bob.dir).heads('refs/heads/state/*'), ['state/E1']);
  assert.throws(() => N.epochOpen(o()), /E1 is still open/);
  // the state branch is an orphan: one root commit, no parent, sharing nothing with the tranche
  assert.equal(g(w.bob.root, 'rev-list', '--max-parents=0', '--count', 'origin/state/E1'), '1');
  assert.throws(() => g(w.bob.root, 'merge-base', 'origin/state/E1', `origin/${N.TRANCHE}`));
  assert.match(readFileSync(join(w.bob.dir, 'build/epochs.md'), 'utf8'), /^- E1 · opened \d{4}/m);

  // takeover: the Status line on the state branch, the role file, an empty queue
  const tk = N.takeover(o({ name: 'BOB #1', session: B1 }));
  assert.equal(N.readRole(w.bob.root).role, 'bob');
  // issue 74: the takeover names the rest of BOB's set, each file with its size; what the product lacks is named absent
  assert.deepEqual(tk.read.whole.map((x) => x.file), ['build/plan/current.md', 'build/manifest.md']); assert.ok(tk.read.whole.every((x) => x.bytes > 0));
  assert.deepEqual(tk.read.absent, ['build/areas.md', 'build/lanes.md']);
  assert.deepEqual(tk.queue, []);
  assert.equal(N.addr(o({ bob: true })), B1);
  assert.equal(N.status(o()).bob.session, B1);
  assert.deepEqual(tk.check, { ok: true, problems: [] });   // the start self-check (PERMISSIONS §2.6)
  // the tranche checkout is untouched by state writes: no commit, nothing unpushed
  assert.deepEqual(N.unpushed(N.repo(w.bob.dir)), []);
  // a refused act is recorded, listed, routed and counted (PERMISSIONS §2.5); predicted when the act table has the row
  assert.throws(() => N.refused(o({ act: 'x', kind: 'nope', reason: 'y' })), /--kind hook\|classifier\|scope\|platform/);
  const r1 = N.refused(o({ act: 'archive_session(child)', kind: 'classifier', reason: 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Interfere With Workloads].' }));
  assert.deepEqual([r1.refusal, r1.predicted], ['R-BOB-1-1', true]);
  const r2 = N.refused(o({ act: 'git push --tags', kind: 'platform', reason: 'the proxy refused the tag', by: 'ALPHA #1' }));
  assert.deepEqual([r2.refusal, r2.predicted], ['R-ALPHA-1-1', false]);
  let stq = N.status(o());
  assert.match(stq.queue.map((q) => q.item).join(';'), /REFUSED ALPHA #1 git push --tags;REFUSED BOB #1 archive_session\(child\)/);
  assert.match(stq.queue.find((q) => q.item.startsWith('REFUSED ALPHA')).detail, /UNPREDICTED, R-ALPHA-1-1/);
  assert.match(stq.gate.join(';'), /R-BOB-1-1 \(BOB #1: archive_session\(child\)\) is an open refusal/);
  assert.throws(() => N.refusedRouted(o({ id: 'R-NONE-1', route: 'x' })), /no refusal R-NONE-1/);
  assert.equal(N.refusedRouted(o({ id: 'R-BOB-1-1', route: 'ROOT archives it: the parent' })).flaw, null);
  assert.match(N.refusedRouted(o({ id: 'R-ALPHA-1-1', route: 'Bob prunes it' })).flaw, /unpredicted refusal/);
  assert.throws(() => N.refusedRouted(o({ id: 'R-BOB-1-1', route: 'again' })), /already routed/);
  stq = N.status(o());
  assert.deepEqual(stq.queue.filter((q) => q.item.startsWith('REFUSED')), []); assert.deepEqual(stq.gate, []);
  assert.deepEqual(stq.refusals.map((r) => [r.id, r.status, r.route]), [['R-ALPHA-1-1', 'ROUTED', 'Bob prunes it'], ['R-BOB-1-1', 'ROUTED', 'ROOT archives it: the parent']]);
  const mcsv = readFileSync(join(w.bob.dir, 'build/metrics/D3.csv'), 'utf8');
  assert.match(mcsv, /^,refusal,BOB #1,bob,,,,,,,classifier,archive_session\(child\) · predicted · ROOT archives it: the parent$/m);
  assert.match(mcsv, /^,refusal,ALPHA #1,alpha,,,,,,,platform,git push --tags · unpredicted · Bob prunes it$/m);
  // a job's transient line (the job commands come with the job's life): alpha is live
  N.stateWrite(N.repo(w.bob.dir), { 'jobs/alpha.md': `**Status** · ALPHA #1 · ${J1} · WORKING\n` }, 'alpha working');
  assert.equal(N.addr(o({ module: 'alpha' })), J1);

  // a lane opened: the register and the charter on the tranche, DORMANT on the state branch, its start owed
  const charter = f(w.base, 'charter.md', 'Area: the toy\'s arithmetic. You decide what sum means.\n');
  assert.throws(() => N.laneOpen(o({ id: 'ARITH', area: 'arithmetic', charterFile: charter, canon: 'no/such.md' })), /no such file/);
  const lo = N.laneOpen(o({ id: 'ARITH', area: 'arithmetic', charterFile: charter, canon: 'build/requirements/alpha.md' }));
  assert.equal(lo.start.title, 'ARITH #1');
  assert.match(lo.start.prompt, /^\/goal Every ask routed to you reads DECIDED \(none open counts as met\)/);
  assert.equal(lo.start.model, 'claude-opus-5-5');
  assert.throws(() => N.laneOpen(o({ id: 'ARITH2', area: 'arithmetic', charterFile: charter })), /one lane, one area/);
  assert.throws(() => N.laneOpen(o({ id: 'STATS', area: 'statistics', charterFile: charter })), /module stats's name/);   // one namespace of session names
  // a lane opened dormant owes no start: its first ask starts it (PROTOCOL §7c)
  const ld = N.laneOpen(o({ id: 'STATISTICS', area: 'statistics', charterFile: charter, dormant: true }));
  assert.equal(ld.dormant, true);
  assert.deepEqual(N.status(o()).owed, ['start lane ARITH']);
  assert.equal(N.status(o()).lanes.find((l) => l.id === 'STATISTICS').live, false);
  N.laneClose(o({ id: 'STATISTICS', why: 'the test is done with it' }));
  // a lane closed with its start still owed: the owed line goes with it (and a stale one is dropped at any plan write)
  const lx = N.laneOpen(o({ id: 'EXTRA', area: 'extra', charterFile: charter }));
  assert.ok(lx.start); assert.deepEqual(N.status(o()).owed, ['start lane ARITH', 'start lane EXTRA']);
  N.laneClose(o({ id: 'EXTRA', why: 'never started' }));
  assert.deepEqual(N.status(o()).owed, ['start lane ARITH']);
  assert.deepEqual(N.lanes(N.repo(w.bob.dir)).map((l) => [l.id, l.status]), [['ARITH', 'OPEN'], ['STATISTICS', 'CLOSED'], ['EXTRA', 'CLOSED']]);
  assert.deepEqual(N.status(o()).owed, ['start lane ARITH']);
  assert.match(N.status(o()).gate.join(';'), /owed: start lane ARITH/);
  // a charter over 4 KB is refused (SESSIONS §6)
  assert.throws(() => N.laneOpen(o({ id: 'BIG', area: 'big', charterFile: f(w.base, 'big.md', 'x'.repeat(5000)) })), /limit is 4096/);

  // an ask: opened verbatim, numbered; a repeat refused; routed to the lane; asked (the lane is dormant: create_session first)
  const msg = f(w.base, 'q.md', 'QUESTION #1: may sum([]) be 0, or must it refuse an empty list? My reading: 0 (R3 says left to right).\n');
  assert.throws(() => N.askRoute(o({ ask: 'A1', answer: true, reason: 'x' })), /no ask A1/);
  const a1 = N.askOpen(o({ from: 'ALPHA #1', session: J1, number: 1, messageFile: msg }));
  assert.equal(a1.ask, 'A1');
  assert.throws(() => N.askOpen(o({ from: 'ALPHA #1', session: J1, number: 1, messageFile: msg })), /already recorded as A1/);
  assert.throws(() => N.askOpen(o({ from: 'ALPHA #1', session: J1, number: 2, messageFile: f(w.base, 'bad.md', 'hello\n') })), /begins QUESTION or REPORT/);
  // an unrouted RECEIVED ask stops the turn
  assert.match(N.status(o()).gate.join(';'), /A1 reads RECEIVED with nothing dispatched/);
  assert.throws(() => N.askRoute(o({ ask: 'A1', lane: 'NOPE', reason: 'x' })), /no open lane NOPE/);
  assert.throws(() => N.askRoute(o({ ask: 'A1', lane: 'ARITH', answer: true, reason: 'x' })), /exactly one/);
  N.askRoute(o({ ask: 'A1', lane: 'ARITH', reason: 'what sum means is the area\'s design' }));
  assert.throws(() => N.askRoute(o({ ask: 'A1', answer: true, reason: 'x' })), /already routed/);
  // a decision before a question is refused; a dispatch needs a brief in the template; the Working line is write-ahead
  assert.throws(() => N.askDecided(o({ ask: 'A1', answerFile: f(w.base, 'd.md', 'DECISION: 0\n') })), /reads RECEIVED/);
  assert.throws(() => N.askDispatch(o({ ask: 'A1', stage: 'question', briefFile: f(w.base, 'b0.md', 'read stuff\n'), due: 30 })), /template/);
  const brief = f(w.base, 'b1.md', 'Brief A1 · for BOB #1 · today\nTask: write the question in the area\'s terms.\nRead whole, and nothing else: build/requirements/alpha.md\nWrite your result to: asks/A1/question.md\nForm of the result: one question\nIf you need something not listed above, stop and write what it is in the result; do not search for it.\nEnd with the line: DONE A1 · question\nModel: Sonnet · Effort: medium · Due: 30\n');
  const d1 = N.askDispatch(o({ ask: 'A1', stage: 'question', briefFile: brief, due: 30, by: 'BOB #1' }));
  assert.equal(d1.agent.run_in_background, true);
  assert.throws(() => N.askDispatch(o({ ask: 'A1', stage: 'question', briefFile: brief, due: 30 })), /already has work out.*--again/);
  const R = N.repo(w.bob.dir);
  assert.match(N.stateRead(R, 'asks/A1/brief-question.md'), /^Brief A1/);
  // re-dispatched from the same brief (a worker killed): the replaced line kept under the new one (PROTOCOL §7, row P10)
  const first = N.parseAsk(N.stateRead(R, 'asks/A1.md')).Working.head;
  assert.throws(() => N.askDispatch(o({ ask: 'A1', stage: 'reply', again: true })), /work out is its question/);
  const d2 = N.askDispatch(o({ ask: 'A1', stage: 'question', again: true, why: 'the worker was killed', due: 30, by: 'BOB #1' }));
  assert.equal(d2.agent.prompt, d1.agent.prompt);
  const w1 = N.parseAsk(N.stateRead(R, 'asks/A1.md')).Working;
  assert.notEqual(w1.head, first); assert.equal(w1.body, `replaced · ${first} · the worker was killed`);
  let st = N.status(o());
  assert.equal(st.working.length, 1); assert.equal(st.working[0].late, false);
  assert.match(st.queue.map((q) => q.item).join(';'), /RECEIVED A1 WORKING/);
  assert.doesNotMatch(st.gate.join(';'), /A1 reads/);
  // past its due the backstop lists it LATE
  assert.equal(N.status(o({ now: Date.now() + 31 * 60e3 })).working[0].late, true);
  assert.match(N.status(o({ now: Date.now() + 31 * 60e3 })).queue.map((q) => q.item).join(';'), /A1 LATE/);
  // the question recorded, Working cleared; the lane is dormant, so the create_session is printed first and the start owed
  const aa = N.askAsk(o({ ask: 'A1', questionFile: f(w.base, 'q1.md', 'Does the arithmetic area define sum([]) as 0 or as a refusal? Alpha needs it for R3.\n') }));
  assert.equal(aa.start.title, 'ARITH #1');
  assert.equal(aa.send.session_id, '<the new session>');
  assert.ok(N.status(o()).owed.includes('start lane ARITH'), 'the dormant lane\'s start is owed, so the hook passes the printed create_session (R-BOB-1-5)');
  assert.throws(() => N.askAsk(o({ ask: 'A1', questionFile: brief })), /already asked/);
  st = N.status(o());
  assert.equal(st.working.length, 0);
  assert.match(st.queue.map((q) => q.item).join(';'), /^ASKED A1$/);
  // the lane's session recorded live; its own start command reads the charter and the ask; a wrong session is refused
  N.laneStarted(o({ id: 'ARITH', name: 'ARITH #1', session: L1 }));
  assert.deepEqual(N.status(o()).owed, []);
  assert.equal(N.addr(o({ lane: 'ARITH' })), L1);
  assert.throws(() => N.laneStart(o({ id: 'ARITH', session: J1 })), /names session_01LL/);
  const lane = w.clone('lane');
  const ls = N.laneStart({ product: lane.dir, id: 'ARITH', session: L1 });
  assert.match(ls.charter, /You decide what sum means/);
  assert.deepEqual(ls.asks.map((a) => a.id), ['A1']);
  assert.equal(N.readRole(lane.root).role, 'lane');
  // the lane's own wait, recorded before it sends (PROTOCOL §2); BOB's queue lists it; cleared by WORKING
  assert.equal(N.laneState({ product: lane.dir }).line, 'WORKING');
  assert.throws(() => N.laneState({ product: lane.dir, set: 'DONE' }), /--set WORKING/);
  N.laneState({ product: lane.dir, set: 'WAITING: does Statistics halve by alpha.sum?' });
  assert.match(N.stateRead(R, 'lanes/ARITH.md'), /^\*\*Status\*\* · LIVE ARITH #1 session_01LL\S+ · WAITING: does Statistics/m);
  assert.match(N.status(o()).queue.map((q) => q.item).join(';'), /ANSWER lane ARITH/);
  assert.equal(N.addr(o({ lane: 'ARITH' })), L1);
  N.laneState({ product: lane.dir, id: 'ARITH', set: 'WORKING' });
  assert.doesNotMatch(N.status(o()).queue.map((q) => q.item).join(';'), /ANSWER lane/);
  assert.throws(() => N.laneState(o({ id: 'NOPE' })), /no live session/);
  // the decision, from the lane's clone (one writer per file: the ask is BOB's, but the decision stage is recorded by BOB
  // from the lane's message; here BOB records it)
  assert.throws(() => N.askDecided(o({ ask: 'A1', answerFile: f(w.base, 'd0.md', 'I think 0.\n') })), /DECISION/);
  N.askDecided(o({ ask: 'A1', answerFile: f(w.base, 'd1.md', 'DECISION: sum([]) is 0.\nRationale: the identity of addition.\nChanges: alpha R3\'s meaning: none (it already says 0 for an empty list).\nBob\'s: nothing.\n') }));
  assert.throws(() => N.askDecided(o({ ask: 'A1', answerFile: f(w.base, 'd1.md', 'DECISION: x\n') })), /already has its decision/);
  st = N.status(o());
  assert.match(st.queue.map((q) => q.item).join(';'), /^DECIDED A1$/);
  assert.match(st.gate.join(';'), /A1 reads DECIDED with nothing dispatched/);
  // the close: a CHANGE names files; the fold and the decision line go to the tranche in one commit; then the reply
  assert.throws(() => N.askClose(o({ ask: 'A1', replyFile: f(w.base, 'r0.md', 'CHANGE: R3 now reads …\n') })), /names the files/);
  const req = join(w.bob.dir, 'build/requirements/alpha.md');
  writeFileSync(req, `${readFileSync(req, 'utf8')}\n(ARITH: sum([]) is 0, L-ARITH-1.)\n`);
  const before = g(w.bob.root, 'rev-parse', 'HEAD');
  const cl = N.askClose(o({ ask: 'A1', replyFile: f(w.base, 'r1.md', 'CHANGE: R3 as it now reads: sum([]) is 0 (the identity of addition). Merge tranche.\n'), files: 'build/requirements/alpha.md' }));
  assert.equal(cl.send.session_id, J1);
  assert.match(cl.send.message, /^CHANGE: R3/);
  assert.equal(g(w.bob.root, 'rev-list', '--count', `${before}..HEAD`), '1');
  assert.match(g(w.bob.root, 'show', '--stat', '--format=', 'HEAD'), /build\/lanes\/ARITH\/decisions\.md[\s\S]*build\/requirements\/alpha\.md|build\/requirements\/alpha\.md[\s\S]*build\/lanes\/ARITH\/decisions\.md/);
  assert.match(readFileSync(join(w.bob.dir, 'build/lanes/ARITH/decisions.md'), 'utf8'), /^- L-ARITH-1 · \d{4}-\d{2}-\d{2} · A1 · sum\(\[\]\) is 0\. · build\/requirements\/alpha\.md$/m);
  assert.deepEqual(N.unpushed(R), []);
  assert.throws(() => N.askClose(o({ ask: 'A1', replyFile: f(w.base, 'r1.md', 'ANSWER: x\n') })), /is closed/);
  st = N.status(o());
  assert.deepEqual(st.queue, []); assert.deepEqual(st.gate, []);
  const a = N.parseAsk(N.stateRead(R, 'asks/A1.md'));
  assert.equal(a.status, 'CLOSED'); assert.equal(a.from.number, 1); assert.equal(a.lane, 'ARITH');
  assert.match(a.Replied.head, /^\d{4}-\d{2}-\d{2} · [0-9a-f]{7}$/);

  // an ask BOB answers itself closes without a lane; one that needs Bob takes his decision only
  N.askOpen(o({ from: 'ALPHA #1', session: J1, number: 2, messageFile: f(w.base, 'q2.md', 'QUESTION #2: wording of R1?\n') }));
  N.askRoute(o({ ask: 'A2', answer: true, reason: 'wording only (DES 7)' }));
  assert.equal(N.askClose(o({ ask: 'A2', replyFile: f(w.base, 'r2.md', 'ANSWER: R1 means a + b.\n') })).send.session_id, J1);
  // a requester named like a CLOSED lane is the module's job (lane STATISTICS is closed; a job STATISTICS would be module statistics): routed by module
  assert.throws(() => N.askRoute(o({ ask: 'A2', lane: 'STATISTICS', reason: 'x' })), /already routed/);
  N.askOpen(o({ from: 'ARITH #1', session: L1, number: 1, messageFile: f(w.base, 'q3.md', 'QUESTION #1: may sum refuse a list over 1e6 elements? That changes R3\'s meaning.\n') }));
  assert.throws(() => N.askRoute(o({ ask: 'A3', bob: true, reason: 'a change to what R3 means (P5)' })), /decide it yourself/);   // DES 1's test, by code (Bob, 29 Oct)
  N.askRoute(o({ ask: 'A3', bob: true, reason: 'a change to what R3 means (P5)', users: 'a list over 1e6 elements would be refused at the product\'s edge', canonSilent: 'the canon names no size limit anywhere' }));
  assert.match(N.parseAsk(N.stateRead(R, 'asks/A3.md')).Route.head, /^needs Bob · .* · users: a list over .* · canon silent: the canon names no size/);
  assert.match(N.status(o()).queue.map((q) => q.item).join(';'), /NEEDS BOB A3/);
  assert.throws(() => N.askDecided(o({ ask: 'A3', answerFile: f(w.base, 'd3.md', 'DECISION: no\n') })), /Bob's decision \(--bob\)/);
  assert.throws(() => N.askDecided(o({ ask: 'A2', bob: true, answerFile: f(w.base, 'd3.md', 'x\n') })), /only an ask that NEEDS BOB/);
  N.askDecided(o({ ask: 'A3', bob: true, answerFile: f(w.base, 'd3b.md', 'Bob, 29 Oct: no limit; a list is a list.\n') }));
  assert.equal(N.askClose(o({ ask: 'A3', replyFile: f(w.base, 'r3.md', 'ANSWER: Bob decided: no limit (his, P5).\n') })).send.session_id, L1);

  // a ruling of BOB's: one numbered line in the product's log, committed with the files it owes
  assert.throws(() => N.ruling(o({ text: 'x', why: 'y', files: 'no/such.md' })), /no such file/);
  assert.equal(N.ruling(o({ text: 'sum([]) is 0, per ARITH', why: 'the identity of addition', module: 'alpha' })).ruling, 'K1');
  assert.match(readFileSync(join(w.bob.dir, 'build/rulings.md'), 'utf8'), /^- K1 · \d{4}-\d{2}-\d{2} · alpha · sum\(\[\]\) is 0, per ARITH · the identity of addition$/m);
  assert.equal(N.ruling(o({ text: 'second', why: 'z' })).ruling, 'K2');
  // the handoff is generated, under 4 KB, and refuses at an unclean point
  const h = N.handoff(o({ next: 'close the lane' }));
  assert.match(h.text, /^HANDOFF for BOB #2 · /); assert.match(h.text, /Lanes: ARITH ARITH #1/);
  assert.ok(Buffer.byteLength(h.text) < 4096);
  assert.throws(() => N.handoff(o({ noteFile: f(w.base, 'n.md', 'a\n'.repeat(12)) })), /ten lines/);
  N.askOpen(o({ from: 'ALPHA #1', session: J1, number: 3, messageFile: f(w.base, 'q4.md', 'REPORT #3: beta\'s bundle is stale.\n') }));
  assert.throws(() => N.handoff(o()), /A4 reads RECEIVED/);
  N.askRoute(o({ ask: 'A4', answer: true, reason: 'routed to beta' })); N.askClose(o({ ask: 'A4', replyFile: f(w.base, 'r4.md', 'ANSWER: noted; beta regenerates it.\n') }));

  // a successor BOB: the Status line moves, the predecessor's archive is owed in its acts
  const tk2 = N.takeover(o({ name: 'BOB #2', session: B2 }));
  assert.deepEqual(tk2.previous, { name: 'BOB #1', session: B1 });
  assert.match(tk2.acts.join(';'), /ROOT archives BOB #1 \S+ once it is released/);
  assert.equal(N.addr(o({ bob: true })), B2);

  // the lane's life ends: re-chartered, routed (live), archived with its usage, closed; the epoch closes and the branch is gone
  N.laneCharter(o({ id: 'ARITH', charterFile: f(w.base, 'c2.md', 'Area: arithmetic, now including statistics.\n'), why: 'Bob suggested statistics join it' }));
  assert.match(readFileSync(join(w.bob.dir, 'build/lanes/ARITH/charter.md'), 'utf8'), /^\*\*Sessions\*\* · 1$[\s\S]*statistics/m);
  assert.deepEqual(N.laneRoute(o({ id: 'ARITH' })), { action: 'message', session: L1 });
  assert.equal(N.laneRoute(o({ id: 'ARITH', contextPct: 60 })).action, 'create_session');
  assert.deepEqual(N.status(o()).owed, ['start lane ARITH']);
  assert.throws(() => N.epochClose(o()), /sessions still live on the state branch: jobs\/alpha\.md, lanes\/ARITH\.md/);
  N.laneStarted(o({ id: 'ARITH', name: 'ARITH #2', session: L1.replace('L', 'M') }));
  assert.throws(() => N.laneClose(o({ id: 'ARITH', why: 'done' })), /live session/);
  N.laneArchived(o({ id: 'ARITH', session: L1.replace('L', 'M'), usage: JSON.stringify({ cache_read_tokens: 10, cache_write_tokens: 2, input_tokens: 1, output_tokens: 3 }) }));
  assert.match(readFileSync(join(w.bob.dir, 'build/metrics/lanes.csv'), 'utf8'), /,lane,ARITH,10,2,1,3$/m);
  assert.equal(N.status(o()).lanes[0].live, false);
  N.laneClose(o({ id: 'ARITH', why: 'the area folded into the product\'s' }));
  assert.deepEqual(N.lanes(R).map((l) => l.status), ['CLOSED', 'CLOSED', 'CLOSED']);
  // nothing open, nothing live, nothing owed: the epoch closes and the branch is gone
  assert.throws(() => N.epochClose(o()), /sessions still live on the state branch: jobs\/alpha\.md/);
  N.stateWrite(R, { 'jobs/alpha.md': `**Status** · ALPHA #1 · ${J1} · ARCHIVED\n` }, 'alpha archived');
  assert.equal(N.epochClose(o()).epoch, 'E1');
  assert.deepEqual(R.heads('refs/heads/state/*'), []);
});

test('the epoch closes only when nothing is open, and the state branch is really gone; a lost push is re-applied', () => {
  const w = world(), o = (x) => O(w, x);
  N.epochOpen(o());
  N.takeover(o({ name: 'BOB #1', session: B1 }));
  const R = N.repo(w.bob.dir), other = w.clone('other'), R2 = N.repo(other.dir);
  // two writers, different files, racing: the second push is rejected once and re-applied on the new tip, nothing lost
  N.stateWrite(R, { 'jobs/alpha.md': '**Status** · ALPHA #1 · session_01AAAAAAAAAAAAAAAAAAAAAAAA · WORKING\n' }, 'alpha working');
  R2.fetch('state/E1');
  N.stateWrite(R, { 'jobs/beta.md': '**Status** · BETA #1 · session_01AAAAAAAAAAAAAAAAAAAAAAA2 · WORKING\n' }, 'beta working');
  N.stateWrite(R2, { 'lanes/X.md': '**Status** · DORMANT\n' }, 'x dormant');   // R2's tip was stale: re-fetched and re-applied
  assert.deepEqual(N.stateList(R, 'jobs').sort(), ['jobs/alpha.md', 'jobs/beta.md']);
  assert.equal(N.stateRead(R, 'lanes/X.md'), '**Status** · DORMANT');
  // removal, and an unchanged write that makes no commit
  const tip = g(w.bob.root, 'rev-parse', 'origin/state/E1');
  assert.equal(N.stateWrite(R, { 'lanes/X.md': '**Status** · DORMANT\n' }, 'no change'), tip.slice(0, 7));
  N.stateWrite(R, { 'jobs/beta.md': null }, 'beta gone');
  assert.deepEqual(N.stateList(R, 'jobs'), ['jobs/alpha.md']);
  assert.throws(() => N.epochClose(o()), /sessions still live on the state branch: jobs\/alpha\.md/);
  N.stateWrite(R, { 'jobs/alpha.md': '**Status** · ALPHA #1 · session_01AAAAAAAAAAAAAAAAAAAAAAAA · ARCHIVED\n' }, 'alpha archived');
  const rfo = N.refused(o({ act: 'x', kind: 'platform', reason: 'y' }));   // an open refusal holds the epoch (DRYRUN §4.21)
  assert.throws(() => N.epochClose(o()), /refusals still open: R-BOB-1-1/);
  N.refusedRouted(o({ id: rfo.refusal, route: 'z' }));
  const ec = N.epochClose(o());
  assert.equal(ec.epoch, 'E1'); assert.equal(ec.prune.deleted, true);
  assert.deepEqual(R.heads('refs/heads/state/*'), []);
  // a closed epoch's branch left behind (the proxy's refusal) does not count as open: its epoch.md is marked closed
  g(w.bob.root, 'push', '-q', 'origin', `${ec.marked}:refs/heads/state/E1`);   // the tip the close marked, as the proxy would leave it
  assert.deepEqual(R.heads('refs/heads/state/*'), ['state/E1']);
  assert.throws(() => N.status(o()), /no epoch is open/);
  assert.match(readFileSync(join(w.bob.dir, 'build/epochs.md'), 'utf8'), /^- E1 · opened \S+ · closed \S+$/m);
  assert.throws(() => N.status(o()), /no epoch is open/);
  assert.equal(N.epochOpen(o()).epoch, 'E2');
  // nothing durable points into a state branch: the tranche's files hold no state commit hash
  const hashes = g(w.bob.root, 'rev-list', '--all').split('\n');
  let durable = ''; try { durable = g(w.bob.root, 'grep', '-l', '-E', '[0-9a-f]{40}', `origin/${N.TRANCHE}`, '--', 'toy/build'); } catch { /* no match: exit 1 */ }
  assert.equal(durable, '');
  assert.ok(hashes.length > 0);
});

const J2 = 'session_01AAAAAAAAAAAAAAAAAAAAAAA2', J3 = 'session_01AAAAAAAAAAAAAAAAAAAAAAA3';
test('a set over its budget is recorded and its job not started: layer start and job start both refuse (requirements R5; SES-6)', () => {
  const w = world(), o = (x) => O(w, x), R = N.repo(w.bob.dir), req = join(w.bob.dir, 'build/requirements/alpha.md'), small = readFileSync(req, 'utf8');
  const big = `${small}\n${'- a long private note, kept for the test.\n'.repeat(Math.ceil(budgetOf(N.SET_TABLE) / 40))}`;
  const overrunOf = () => g(w.bob.root, 'show', 'origin/state/E1:jobs/alpha/overrun.md');
  writeFileSync(join(w.bob.dir, 'build/plan/current.md'), '# Plan: test T1\n\n**Status** · OPEN.\n\n## Layer 1\n\n**alpha**\n- N1 · Add `twice(a) → number` (R6).\n');
  writeFileSync(req, big);
  N.commitPush(R, N.TRANCHE, ['build/plan/current.md', 'build/requirements/alpha.md'], 'plan T1, alpha too large');
  N.epochOpen(o()); N.takeover(o({ name: 'BOB #1', session: B1 }));
  assert.throws(() => N.layerStart(o({ layer: 1 })), /alpha: its own set is \d+ bytes, over its budget of \d+ .*BLOCKED: reading/);
  assert.match(overrunOf(), /^- size: \d+ bytes, budget \d+/m); assert.match(overrunOf(), /^- module: alpha$/m);
  assert.deepEqual(N.status(o()).jobs, []);
  // brought under, started; then the set grows past the budget before the job's start: refused, still STARTING
  writeFileSync(req, small); N.commitPush(R, N.TRANCHE, ['build/requirements/alpha.md'], 'alpha trimmed');
  N.layerStart(o({ layer: 1 })); N.jobPr(o({ module: 'alpha', number: 11 })); N.jobStarted(o({ module: 'alpha', name: 'ALPHA #1', session: J1 }));
  writeFileSync(req, big); N.commitPush(R, N.TRANCHE, ['build/requirements/alpha.md'], 'alpha grew');
  const alpha = w.clone('alpha'); g(alpha.root, 'checkout', '-q', '--detach', 'origin/job/alpha');
  assert.throws(() => N.jobStart({ product: alpha.dir, module: 'alpha', session: J1 }), /alpha: its own set is \d+ bytes, over its budget .*the job is not started/);
  assert.deepEqual(N.status(o()).jobs.map((j) => [j.module, j.state]), [['alpha', 'STARTING']]);
  assert.match(overrunOf(), /^- trimmed: build\/layers\.md to its head/m);
});

test('the job\'s life (JOB-LIFE): layer start, the job\'s turn, the gate with the marks struck, review, the queue\'s merge, re-open, retire, layer close, metrics', () => {
  const w = world(), o = (x) => O(w, x), R = N.repo(w.bob.dir), g2 = (...a) => g(w.bob.root, ...a);
  // the running plan and a requirement written ahead (not yet met), on the tranche
  writeFileSync(join(w.bob.dir, 'build/plan/current.md'), '# Plan: test T1\n\n**Status** · OPEN.\n\n## Layer 1\n\n**alpha**\n- N1 · Add `twice(a) → number` (R6).\n\n**beta**\n- N2 · Say in a comment that total builds on alpha.sum. *(after alpha)*\n\n## Layer 2\n\n**stats**\n- N3 · Nothing yet.\n');
  const req = join(w.bob.dir, 'build/requirements/alpha.md');
  writeFileSync(req, readFileSync(req, 'utf8').replace('**sum(list) → number**', '**twice(a) → number**\n- **R6** Returns `add(a, a)`. *(not yet met: T1)*\n\n**sum(list) → number**'));
  N.commitPush(R, N.TRANCHE, ['build/plan/current.md', 'build/requirements/alpha.md'], 'plan T1');
  N.epochOpen(o()); N.takeover(o({ name: 'BOB #1', session: B1 }));

  // layer start: lowest first; each job's branch at the tip, its START (the PR body), its session; everything owed
  assert.throws(() => N.layerStart(o({ layer: 2 })), /layer 1 is OPEN/);
  assert.throws(() => N.layerStart(o({ layer: 3 })), /no section/);
  const ls = N.layerStart(o({ layer: 1 }));
  assert.equal(ls.tranche, 'T1');
  assert.deepEqual(ls.jobs.map((j) => [j.module, j.action]), [['alpha', 'create'], ['beta', 'create']]);
  const a = ls.jobs[0];
  assert.match(a.pr.body, /^START ALPHA #1 · T1 · layer 1 · module alpha\nEntries:\n- N1/);
  assert.match(a.pr.body, /Read whole, by path: build\/requirements\/alpha\.md; build\/layers\.md \(the head and layer 1's row\); alpha\/src\/; alpha\/test\/\./);   // issue 71: the layer's contract, not the whole file
  assert.match(a.pr.body, /Messages from BOB's address[\s\S]*Push before you send; nothing to any branch but job\/alpha/);
  assert.deepEqual([a.pr.draft, a.pr.base, a.pr.head, a.pr.title], [true, 'tranche', 'job/alpha', 'alpha T1 (ALPHA #1)']);
  assert.match(a.session.prompt, /^\/goal `proc job state --module alpha/);
  assert.deepEqual([a.session.model, a.session.effort, a.session.source_revision], ['claude-opus-5-5', 'high', 'job/alpha']);
  assert.match(ls.jobs[1].pr.body, /build\/requirements\/alpha\.md \(Public: Purpose; add, sum\)/);   // beta uses alpha: the services its Uses names (issue 71)
  assert.deepEqual(R.heads('refs/heads/job/*').sort(), ['job/alpha', 'job/beta']);
  assert.equal(g2('rev-parse', 'origin/job/alpha~1'), g2('rev-parse', 'HEAD'));   // one opening commit past the tip: GitHub refuses an empty PR
  assert.equal(g2('log', '-1', '--format=%s', 'origin/job/alpha'), 'ALPHA #1 opens: T1 layer 1, module alpha');
  assert.equal(g2('rev-parse', 'origin/job/alpha^{tree}'), g2('rev-parse', 'HEAD^{tree}'));
  // a START made and not yet opened is remade by the same call (the name kept), never refused as a second job
  const again = N.layerStart(o({ layer: 1, modules: 'alpha' }));
  assert.deepEqual([again.jobs[0].action, again.jobs[0].pr.title], ['create', 'alpha T1 (ALPHA #1)']);
  assert.equal(g2('rev-parse', 'origin/job/alpha~1'), g2('rev-parse', 'HEAD'));
  let st = N.status(o());
  assert.deepEqual(st.owed, ['open PR alpha', 'start alpha', 'open PR beta', 'start beta']);
  assert.deepEqual(st.jobs.map((j) => [j.module, j.state, j.after]), [['alpha', 'STARTING', []], ['beta', 'STARTING', ['alpha']]]);
  assert.throws(() => N.layerStart(o({ layer: 1 })), /name the modules/);
  assert.equal(N.jobPr(o({ module: 'alpha', number: 11 })).subscribe.pullNumber, 11);
  assert.throws(() => N.layerStart(o({ layer: 1, modules: 'alpha' })), /one job per module/);   // opened: a second start is refused
  N.jobPr(o({ module: 'beta', number: 12 }));
  assert.throws(() => N.jobPr(o({ module: 'alpha', number: 13 })), /already has PR #11/);
  assert.throws(() => N.jobStarted(o({ module: 'alpha', name: 'BETA #1', session: J1 })), /is ALPHA #1/);
  N.jobStarted(o({ module: 'alpha', name: 'ALPHA #1', session: J1 }));
  N.jobStarted(o({ module: 'beta', name: 'BETA #1', session: J2 }));
  assert.deepEqual(N.status(o()).owed, []);
  assert.equal(N.addr(o({ module: 'alpha' })), J1);

  // the job's turn, from its own clone on job/alpha: start (the session must be recorded), a wait, the change
  const alpha = w.clone('alpha'); g(alpha.root, 'checkout', '-q', '--detach', 'origin/job/alpha');   // a cloud clone may start detached at the tip (R-STATS-2-1)
  const jo = (x) => ({ product: alpha.dir, module: 'alpha', ...x });
  assert.throws(() => N.jobStart(jo({ session: J2 })), /names session_01AAAAAAAAAAAAAAAAAAAAAAAA for alpha, not/);
  const js = N.jobStart(jo({ session: J1 }));
  assert.equal(g(alpha.root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'job/alpha');   // the start made the branch there
  assert.match(js.start, /^START ALPHA #1/); assert.deepEqual([js.pr, js.state, js.size], [11, 'WORKING', null]);
  assert.deepEqual([N.readRole(alpha.root).role, N.readRole(alpha.root).module], ['job', 'alpha']);
  assert.equal(N.jobState(jo({})).line, 'WORKING');
  assert.throws(() => N.jobState(jo({ set: 'COMPLETE' })), /only by job complete/);
  N.jobState(jo({ set: 'WAITING: may twice(Infinity) throw?' }));
  assert.match(N.status(o()).queue.map((q) => q.item).join(';'), /^ANSWER alpha$/);
  N.jobState(jo({ set: 'WORKING' }));
  const src = join(alpha.dir, 'alpha/src/index.mjs');
  writeFileSync(src, `${readFileSync(src, 'utf8')}\n// R6: add(a, a).\nexport function twice(a) {\n  return add(a, a);\n}\n`);
  writeFileSync(join(alpha.dir, 'alpha/test/twice.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { twice } from '../src/index.mjs';\n\ntest('R6 twice(a) is add(a, a)', () => { assert.equal(twice(2), 4); assert.throws(() => twice('1'), TypeError); });\n");
  const report = f(w.base, 'report.md', '**Met** · R6\n**Evidence**\n- `node --test alpha/test/*.test.mjs` → tests 4, pass 4\n- alpha/src/index.mjs:22\n');
  assert.throws(() => N.jobComplete(jo({ reportFile: report })), /commit your module/);
  g(alpha.root, 'add', '-A'); g(alpha.root, 'commit', '-q', '-m', 'alpha: twice');
  assert.throws(() => N.jobComplete(jo({ reportFile: f(w.base, 'r-no.md', '**Met** · R9\n**Evidence**\n- x.mjs:1\n') })), /R9 is not in/);
  assert.throws(() => N.jobComplete(jo({ reportFile: f(w.base, 'r-ev.md', '**Met** · none\nno evidence\n') })), /no `\*\*Evidence\*\*` section/);
  // complete: R6's mark struck in the job's own commit, the gate green, the branch pushed, the comment and ready owed
  const jc = N.jobComplete(jo({ reportFile: report }));
  assert.ok(jc.tests.pass >= 4 && jc.tests.pass === jc.tests.tests, JSON.stringify(jc.tests));
  assert.deepEqual(jc.acts.map((x) => x.tool), ['add_issue_comment', 'update_pull_request']);
  assert.deepEqual([jc.acts[0].issue_number, jc.acts[1].pullNumber, jc.acts[1].draft], [11, 11, false]);
  assert.match(jc.acts[0].body, /^\*\*Met\*\* · R6[\s\S]*\nTests: \d+\/\d+\. Checks: format, architecture, coverage, fixtures, ownership: no new finding\.\nSize: test runs 1, module lines \d+\. Head [0-9a-f]{7}\.$/);
  assert.equal(g(alpha.root, 'log', '-1', '--format=%s'), 'alpha T1: met R6');
  assert.equal(g(alpha.root, 'status', '--porcelain'), '');   // the bundles read alpha's source, were regenerated for the run, and are not the job's to commit
  assert.doesNotMatch(g(alpha.root, 'show', 'HEAD:toy/build/requirements/alpha.md'), /not yet met: T1/);
  assert.match(g(alpha.root, 'show', 'HEAD:toy/build/requirements/alpha.md'), /^- \*\*R6\*\* Returns `add\(a, a\)`\.$/m);
  assert.equal(g(alpha.root, 'rev-parse', 'origin/job/alpha'), g(alpha.root, 'rev-parse', 'HEAD'));
  assert.deepEqual(N.status(jo({})).gate, ['alpha owes: comment', 'alpha owes: ready']);   // the job's own gate
  assert.equal(N.jobState(jo({})).line, 'COMPLETE (owed: comment; ready)');
  assert.deepEqual(N.status(o()).queue, []);   // BOB: nothing yet, the job owes its acts
  assert.throws(() => N.reviewDecide(o({ module: 'alpha', noReview: true, reason: 'x' })), /still owes/);
  assert.equal(N.jobPosted(jo({ comment: 777 })).send, null);
  const jp = N.jobPosted(jo({ ready: true }));
  assert.equal(jp.send.session_id, B1); assert.match(jp.send.message, /^COMPLETE #1: alpha \(PR #11\)/);
  assert.throws(() => N.jobPosted(jo({ ready: true })), /nothing cleared/);
  assert.deepEqual(N.status(jo({})).gate, []);
  assert.match(N.status(o()).queue.map((q) => q.item).join(';'), /^DECIDE REVIEW alpha$/);

  // beta completes meanwhile: its PR stays a draft until alpha merges (the plan's order)
  const beta = w.clone('beta'); g(beta.root, 'checkout', '-q', 'job/beta');
  const bo = (x) => ({ product: beta.dir, module: 'beta', ...x });
  N.jobStart(bo({ session: J2 }));
  const bsrc = join(beta.dir, 'beta/src/index.mjs');
  writeFileSync(bsrc, readFileSync(bsrc, 'utf8').replace('// beta: totals', '// beta (N2: built on alpha.sum): totals'));
  g(beta.root, 'add', '-A'); g(beta.root, 'commit', '-q', '-m', 'beta: N2');
  const bc = N.jobComplete(bo({ reportFile: f(w.base, 'rb.md', '**Met** · none\n**Evidence**\n- beta/src/index.mjs:1\n') }));
  assert.deepEqual(bc.acts.map((x) => x.tool), ['add_issue_comment']);
  assert.match(bc.then, /ready is owed after alpha/);
  const bp = N.jobPosted(bo({ comment: 778 }));
  assert.deepEqual(N.jobState(bo({})).owed, ['ready after alpha']);
  assert.deepEqual(N.status(bo({})).gate, []);   // `ready after` is BOB's act, not the job's: beta's turn may end
  assert.match(bp.send.message, /^COMPLETE #1: beta \(PR #12\); the report is its comment; ready after alpha merges/);
  assert.match(N.status(o()).queue.map((q) => q.item).join(';'), /DECIDE REVIEW beta/);

  // alpha: no review, the concerns listed; the merge printed and owed; the queue's merge recorded from its event
  assert.throws(() => N.merge(o({ module: 'alpha' })), /decide the review first/);
  const rd = N.reviewDecide(o({ module: 'alpha', noReview: true, reason: 'one small function, tested at the interface' }));
  assert.deepEqual(rd.concerns, ['provided service changed (1 export line(s) differ)']);
  assert.throws(() => N.reviewDecide(o({ module: 'alpha', review: true, reason: 'x' })), /is decided/);
  assert.match(N.status(o()).queue.map((q) => q.item).join(';'), /^MERGE alpha;DECIDE REVIEW beta$/);   // beta's review may be decided while it waits on alpha
  const ahead = g2('rev-parse', 'origin/job/alpha');
  assert.throws(() => N.merge(o({ module: 'alpha' })), /--head <sha the check ran on> --gate/);
  assert.throws(() => N.merge(o({ module: 'alpha', head: 'deadbeef', gate: 'success' })), /that result is for an older commit/);
  assert.throws(() => N.merge(o({ module: 'alpha', head: ahead, gate: 'failure' })), /nothing merges red/);
  assert.throws(() => N.merged(o({ module: 'alpha', sha: g2('rev-parse', 'HEAD') })), /is not merging/);
  const mg = N.merge(o({ module: 'alpha', head: ahead, gate: 'success' }));
  assert.deepEqual([mg.merge.tool, mg.merge.pullNumber, mg.merge.merge_method], ['merge_pull_request', 11, 'merge']);
  assert.deepEqual(N.status(o()).owed, ['merge alpha']); assert.deepEqual(N.status(o()).queue.map((q) => q.item), ['DECIDE REVIEW beta']);
  assert.throws(() => N.merge(o({ module: 'alpha', head: ahead, gate: 'success' })), /already merging/);
  assert.throws(() => N.merged(o({ module: 'alpha', sha: g2('rev-parse', 'HEAD') })), /tip [0-9a-f]{7} is not in/);
  g2('fetch', '-q', 'origin'); g2('merge', '-q', '--no-ff', '-m', 'alpha T1 (#11)', 'origin/job/alpha'); g2('push', '-q', 'origin', 'HEAD:tranche');   // GitHub's merge of the PR
  const md = N.merged(o({ module: 'alpha', sha: g2('rev-parse', 'HEAD') }));
  assert.deepEqual(md.prune, { ref: 'job/alpha', deleted: true });   // a bare origin allows the delete; the proxy prints the prune dispatch instead
  assert.equal(md.send.session_id, J1); assert.match(md.send.message, /^MERGED: alpha is on tranche at [0-9a-f]{7} \(PR #11\)/);
  assert.deepEqual(md.ready.map((r) => [r.module, r.mark.pullNumber, r.mark.draft]), [['beta', 12, false]]);
  assert.deepEqual(R.heads('refs/heads/job/*'), ['job/beta']);   // the merged branch is gone
  assert.deepEqual(N.status(o()).owed, []);
  assert.equal(N.jobState(o({ module: 'alpha' })).state, 'MERGED');
  N.jobPosted(o({ module: 'beta', ready: true }));   // BOB marks it ready: the job is idle

  // beta: a review dispatched, a gap found, the job fixes it and completes again (with the tranche merged in first)
  const rv = N.reviewDecide(o({ module: 'beta', review: true, reason: 'the first user of alpha' }));
  assert.deepEqual([rv.agent.run_in_background, rv.agent.model, rv.agent.effort], [true, 'claude-sonnet-5-5', 'high']);
  assert.match(rv.agent.prompt, /^Brief review-beta · for BOB #1/); assert.match(rv.agent.prompt, /^Write your result to: .*proc-review-beta\.md$/m);
  assert.match(rv.agent.prompt, /git -C \S+ show origin\/state\/E1:jobs\/beta\/report\.md/);
  assert.ok(rv.agent.prompt.includes(MEASUREMENT_RULE));   // the brief carries the measurement rule (requirements R4; REQ-3)
  assert.match(N.status(o()).queue.map((q) => q.item).join(';'), /^REVIEWING beta$/);
  assert.throws(() => N.merge(o({ module: 'beta' })), /not approved/);
  assert.throws(() => N.reviewResult(o({ module: 'beta', resultFile: f(w.base, 'rr0.md', 'VERDICT · gaps\n- R1 · beta/src/index.mjs:5 · x · y\n') })), /DONE line/);
  const rr = N.reviewResult(o({ module: 'beta', resultFile: f(w.base, 'rr1.md', 'VERDICT · gaps\n- R1 · beta/src/index.mjs:1 · the comment names N2, not the requirement · read it\nDONE review-beta · verdict\n') }));
  assert.deepEqual([rr.post.event, rr.post.pullNumber, rr.send.session_id], ['COMMENT', 12, J2]);   // one's own PR takes neither REQUEST_CHANGES nor APPROVE
  assert.match(rr.post.body, /^CHANGES REQUESTED by the review \(the first user of alpha\)\n\nVERDICT · gaps/);
  assert.match(rr.send.message, /^CHANGE: the review found 1 gap/);
  assert.deepEqual(N.status(o()).queue, []);
  N.jobState(bo({ set: 'WORKING' }));
  writeFileSync(bsrc, readFileSync(bsrc, 'utf8').replace('(N2: built on alpha.sum)', '(R1: built on alpha.sum)'));
  g(beta.root, 'add', '-A'); g(beta.root, 'commit', '-q', '-m', 'beta: the gap');
  const rb2 = f(w.base, 'rb2.md', '**Met** · none\n**Evidence**\n- beta/src/index.mjs:1\n');
  assert.throws(() => N.jobComplete(bo({ reportFile: rb2 })), /merge tranche into your branch first: BOB has changed alpha\/src\/index\.mjs \(a module's code or tests\)/);   // alpha's merge: held (issue 88)
  g(beta.root, 'fetch', '-q', 'origin'); g(beta.root, 'merge', '-q', '--no-edit', 'origin/tranche');
  const bc2 = N.jobComplete(bo({ reportFile: rb2 }));
  assert.deepEqual(bc2.acts.map((x) => x.tool), ['add_issue_comment', 'update_pull_request']);   // alpha is merged: ready at once
  N.jobPosted(bo({ comment: 779, ready: true }));
  assert.deepEqual([N.jobState(bo({})).runs, N.jobState(bo({})).review], [2, null]);
  N.reviewDecide(o({ module: 'beta', noReview: true, reason: 'the gap is closed; re-reviewed for it only' }));
  N.merge(o({ module: 'beta', head: g(beta.root, 'rev-parse', 'HEAD'), gate: 'success' }));
  g2('fetch', '-q', 'origin'); g2('merge', '-q', '--no-ff', '-m', 'beta T1 (#12)', 'origin/job/beta'); g2('push', '-q', 'origin', 'HEAD:tranche');
  N.merged(o({ module: 'beta', sha: g2('rev-parse', 'HEAD') }));
  // a job's session replaced (JOB-LIFE §9): routed to a fresh one, recorded under the next number
  assert.deepEqual(N.jobRoute(o({ module: 'beta' })), { action: 'message', session: J2 });
  const jr = N.jobRoute(o({ module: 'beta', contextPct: 60 }));
  assert.deepEqual([jr.action, jr.title, jr.archive, jr.model], ['create_session', 'BETA #2', J2, 'claude-opus-5-5']);
  N.jobStarted(o({ module: 'beta', name: 'BETA #2', session: J3 }));
  assert.deepEqual(N.status(o()).owed, []);

  // a CHANGE after the merge re-opens alpha on a fresh branch and PR, in its session
  assert.throws(() => N.jobReopen(o({ module: 'beta', changeFile: f(w.base, 'c0.md', 'x\n') })), /begins CHANGE/);
  g2('push', '-q', 'origin', `${g2('rev-parse', 'HEAD^2')}:refs/heads/job/alpha`);   // as if the proxy had refused the merged branch's delete (R-BOB-1-2)
  const ro = N.jobReopen(o({ module: 'alpha', changeFile: f(w.base, 'c1.md', 'CHANGE: R6 now also says twice(-0) is -0; prove it.\n') }));
  assert.equal(g2('rev-parse', 'origin/job/alpha^1'), g2('rev-parse', 'HEAD^2')); assert.equal(g2('rev-parse', 'origin/job/alpha^2'), g2('rev-parse', 'HEAD'));
  assert.equal(g2('rev-parse', 'origin/job/alpha^{tree}'), g2('rev-parse', 'HEAD^{tree}'));
  assert.equal(g2('diff', '--stat', 'origin/tranche...origin/job/alpha'), '');
  assert.equal(ro.send.session_id, J1); assert.match(ro.pr.body, /^START ALPHA #1 · T1 · re-opened after its merge · module alpha\nEntries:\nCHANGE: R6/);
  assert.deepEqual(R.heads('refs/heads/job/*'), ['job/alpha']);
  assert.equal(g2('log', '-1', '--format=%s', 'origin/job/alpha'), 'ALPHA #1 re-opens: T1, module alpha');
  assert.deepEqual(N.status(o()).owed, ['open PR alpha']);
  assert.equal(N.jobState(o({ module: 'alpha' })).state, 'REOPENED');
  assert.throws(() => N.jobState(jo({ set: 'WORKING' })), /start it first/);
  N.jobPr(o({ module: 'alpha', number: 13 }));
  g(alpha.root, 'pull', '-q', '--no-rebase', 'origin', 'job/alpha');
  assert.match(N.jobStart(jo({ session: J1 })).start, /^START ALPHA #1 · T1 · re-opened/);
  const tfile = join(alpha.dir, 'alpha/test/twice.test.mjs');
  writeFileSync(tfile, readFileSync(tfile, 'utf8').replace('assert.equal(twice(2), 4);', 'assert.equal(twice(2), 4); assert.ok(Object.is(twice(-0), -0));'));
  g(alpha.root, 'add', '-A'); g(alpha.root, 'commit', '-q', '-m', 'alpha: -0');
  // issue 88: BOB recorded a plan note meanwhile, a record the gate does not read for alpha: the job completes without merging it
  g2('fetch', '-q', 'origin'); g2('merge', '-q', '--ff-only', 'origin/tranche');
  writeFileSync(join(w.bob.dir, 'build/plan/notes-T2.md'), '# T2, prepared ahead (P18)\n'); N.commitPush(R, N.TRANCHE, ['build/plan/notes-T2.md'], 'prepared ahead (P18): a note');
  const jc2 = N.jobComplete(jo({ reportFile: f(w.base, 'r2.md', '**Met** · none\n**Evidence**\n- alpha/test/twice.test.mjs:5\n') }));
  assert.throws(() => g(alpha.root, 'merge-base', '--is-ancestor', 'origin/tranche', 'HEAD'));   // completed behind the tranche, by the note only
  assert.equal(jc2.acts[0].issue_number, 13);
  N.jobPosted(jo({ comment: 780, ready: true }));
  N.reviewDecide(o({ module: 'alpha', noReview: true, reason: 'a test line' }));
  g2('fetch', '-q', 'origin'); g2('merge', '-q', '--ff-only', 'origin/tranche');
  writeFileSync(join(w.bob.dir, 'build/layers.md'), `${readFileSync(join(w.bob.dir, 'build/layers.md'), 'utf8')}\nPrepared ahead (P18): nothing yet.\n`);
  N.commitPush(R, N.TRANCHE, ['build/layers.md'], 'prepared ahead (P18)');   // the tranche moved: alpha's tip is behind it
  const up = N.merge(o({ module: 'alpha', head: g(alpha.root, 'rev-parse', 'HEAD'), gate: 'success' }));
  assert.deepEqual([up.update.tool, up.update.pullNumber, up.merge], ['update_pull_request_branch', 13, undefined]);
  assert.deepEqual(up.held, [{ file: 'build/layers.md', why: 'read by the gate for alpha' }]);   // issue 86: a file the gate reads, so the gate runs again
  assert.match(N.jobState(o({ module: 'alpha' })).merge, /^updating /);
  assert.deepEqual(N.status(o()).owed, []);
  g(alpha.root, 'fetch', '-q', 'origin'); g(alpha.root, 'merge', '-q', '--no-edit', 'origin/tranche'); g(alpha.root, 'push', '-q', 'origin', 'HEAD:job/alpha');   // GitHub's update of the branch
  assert.throws(() => N.merge(o({ module: 'alpha', head: 'deadbeef', gate: 'success' })), /older commit/);
  // issue 86: while that gate ran, BOB recorded a ruling and a summary for another module's task: records the gate does not
  // read for alpha, so the green tip merges without another update; a change to alpha's own summary would not
  g2('fetch', '-q', 'origin'); g2('merge', '-q', '--ff-only', 'origin/tranche');
  mkdirSync(join(w.bob.dir, 'build/summaries/T1'), { recursive: true });
  writeFileSync(join(w.bob.dir, 'build/summaries/T1/beta.md'), '# beta\n- R1 · totals (build/requirements/beta.md R1)\n');
  writeFileSync(join(w.bob.dir, 'build/rulings.md'), '- K1 · 2026-10-30 · beta · a ruling · P15\n');
  N.commitPush(R, N.TRANCHE, ['build/summaries/T1/beta.md', 'build/rulings.md'], 'prepared ahead (P18): a summary');
  assert.deepEqual(N.gateNeutral(N.repo(w.bob.dir), 'alpha', g(alpha.root, 'rev-parse', 'HEAD')).held, []);
  writeFileSync(join(w.bob.dir, 'build/summaries/T1/alpha.md'), '# alpha\n');
  g2('add', '-A'); g2('commit', '-qm', 'not pushed: alpha\'s own summary');
  g2('update-ref', 'refs/remotes/origin/tranche', 'HEAD');   // as the tranche would read with it pushed
  assert.deepEqual(N.gateNeutral(N.repo(w.bob.dir), 'alpha', g(alpha.root, 'rev-parse', 'HEAD')).held, [{ file: 'build/summaries/T1/alpha.md', why: "alpha's task summary" }]);
  g2('reset', '-q', '--hard', 'HEAD~1'); g2('fetch', '-q', 'origin');
  const mg2 = N.merge(o({ module: 'alpha', head: g(alpha.root, 'rev-parse', 'HEAD'), gate: 'success' }));
  assert.equal(mg2.merge.pullNumber, 13);
  assert.deepEqual(mg2.over.sort(), ['build/rulings.md', 'build/summaries/T1/beta.md']);
  g2('fetch', '-q', 'origin'); g2('merge', '-q', '--no-ff', '-m', 'alpha T1 (#13)', 'origin/job/alpha'); g2('push', '-q', 'origin', 'HEAD:tranche');
  N.merged(o({ module: 'alpha', sha: g2('rev-parse', 'HEAD') }));

  // retirement: alpha early (beta, its user, is merged), with its usage row; the layer closes with beta's archive owed
  const rt = N.jobRetire(o({ module: 'alpha' }));
  assert.equal(rt.archive.session_id, J1);
  assert.deepEqual(N.status(o()).owed, ['archive alpha']);
  assert.throws(() => N.epochClose(o()), /sessions still live/);
  N.jobArchived(o({ module: 'alpha', session: J1, usage: JSON.stringify({ cache_read_tokens: 100, cache_write_tokens: 20, input_tokens: 3, output_tokens: 9 }) }));
  assert.throws(() => N.jobArchived(o({ module: 'alpha', session: J1, usage: '{}' })), /already has its row/);
  assert.equal(N.jobState(o({ module: 'alpha' })).state, 'ARCHIVED');
  assert.throws(() => N.jobRetire(o({ module: 'alpha' })), /reads ARCHIVED/);
  const lc = N.layerClose(o({ layer: 1 }));
  assert.ok(lc.commit, 'the regenerated bundle is committed at the close');
  assert.deepEqual(lc.archive.map((x) => [x.module, x.session]), [['beta', J3]]);
  assert.throws(() => N.layerClose(o({ layer: 1 })), /is CLOSED/);
  assert.deepEqual(N.status(o()).owed, ['archive beta']);
  // issue 95: the archive refused (a session no live BOB created), so the job ends on the record unmeasured, its session left idle
  assert.throws(() => N.jobArchived(o({ module: 'beta', session: J3 })), /either --usage <json> or --unmeasured/);
  assert.throws(() => N.jobArchived(o({ module: 'beta', session: J3, usage: '{}', unmeasured: 'x' })), /either --usage <json> or --unmeasured/);
  assert.throws(() => N.jobArchived(o({ module: 'beta', session: J3, unmeasured: ' ' })), /name the refusal/);
  N.jobArchived(o({ module: 'beta', session: J3, unmeasured: 'archive_session refused, Interfere With Workloads' }));
  N.jobArchived(o({ module: 'beta', session: J2, name: 'BETA #1', usage: JSON.stringify({ cache_read_tokens: 40, cache_write_tokens: 4, input_tokens: 1, output_tokens: 1 }) }));   // the replaced session's row
  assert.deepEqual(N.status(o()).owed, []);

  // the next layer starts now (a mechanical job on Sonnet); a defect is a row naming its merge's review; BOB's own row
  const l2 = N.layerStart(o({ layer: 2, mechanical: 'stats' }));
  assert.deepEqual(l2.jobs.map((j) => [j.module, j.session.model, j.session.effort]), [['stats', 'claude-sonnet-5-5', 'medium']]);
  assert.equal(N.defect(o({ module: 'beta', what: 'total([]) documented wrong' })).reviewed, '1/1');   // beta's one merge followed a review (gaps, fixed)
  N.bobArchived(o({ name: 'BOB #0', session: B2, usage: JSON.stringify({ cache_read_tokens: 1, cache_write_tokens: 1, input_tokens: 1, output_tokens: 1 }) }));
  const csv = readFileSync(join(w.bob.dir, 'build/metrics/T1.csv'), 'utf8');
  assert.match(csv, /^session,role,name,module,cache-read,cache-write,input,output,test runs,module lines,reviewed,note\n/);
  assert.match(csv, new RegExp(`^${J1},job,ALPHA #1,alpha,100,20,3,9,2,\\d+,0/2,$`, 'm'));   // two merges (one re-open), neither reviewed
  assert.match(csv, new RegExp(`^${J3},job,BETA #2,beta,,,,,2,\\d+,1/1,unmeasured: archive_session refused  Interfere With Workloads$`, 'm'));
  assert.match(csv, new RegExp(`^${J2},job,BETA #1,beta,40,4,1,1,2,\\d+,1/1,replaced$`, 'm'));
  assert.match(csv, /^,defect,BETA #1,beta,,,,,,,1\/1,total\(\[\]\) documented wrong$/m);
  assert.match(csv, new RegExp(`^${B2},BOB-final,BOB #0,,1,1,1,1,,,,$`, 'm'));
  assert.throws(() => N.handoff(o()), /owed: open PR stats/);
  // issue 101: a job archived before its merge is started again on its branch; one the tranche holds is done
  assert.throws(() => N.jobRoute(o({ module: 'alpha' })), /alpha reads ARCHIVED and (tranche holds its branch|its branch job\/alpha is gone \(deleted once merged\)): it is done/);
  const S1 = 'session_01STATS1aaaaaaaaaaaaaaaaa'; N.jobStarted(o({ module: 'stats', name: 'STATS #1', session: S1 }));
  N.jobArchived(o({ module: 'stats', session: S1, unmeasured: 'retired on a stale process' }));
  const reopened = N.jobRoute(o({ module: 'stats' }));
  assert.deepEqual([reopened.action, reopened.title, reopened.archive], ['create_session', 'STATS #2', S1]);
  assert.ok(reopened.prompt.includes(`Your first act, before anything else: run \`${versionCommand(processHead(N.PROCESS))}\`.`));
  assert.equal(N.jobState(o({ module: 'stats' })).state, 'REOPENED');
});

test('the one skill\'s reading, the shims written and checked for drift, the gate as CI runs it (JOB-LIFE §4, SESSIONS §6, PRODUCT-SUPPLIES)', () => {
  const w = world(), R = N.repo(w.bob.dir);
  // reading: the principles and the role's rulebooks whole, measured against the role's budget; the start command last
  const rj = N.reading({ role: 'job', product: 'toy' });
  assert.deepEqual(rj.files.map((f) => f.book ?? 'principles'), ['principles', 'building', 'integration', 'sessions']);
  assert.match(rj.text, /^=== PROCESS-DESIGN\.md \(\d+ bytes\) ===\n# The process principles/);
  assert.doesNotMatch(rj.text, /\(not yet written\)/);   // the ten rulebooks exist; a missing one would print so
  assert.equal(N.reading({ role: 'bob' }).files.length, 11);   // the principles and all ten
  assert.match(rj.text, /\nNext: read everything above whole \(P20\), then run `proc job start --module <m> --session <your session id> --product toy`/);
  assert.deepEqual(rj.over, []); assert.equal(rj.budget, 26 * 1024);
  assert.equal(N.reading({ role: 'bob' }).budget, 55 * 1024);
  assert.throws(() => N.reading({ role: 'worker' }), /--role/);
  assert.deepEqual(N.sizes(R, ['alpha', 'nope']), []);
  // shims: the three files written from here; a hand edit is drift; CLAUDE.md under thirty lines
  const sh = N.shims({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane' });
  assert.deepEqual(sh.written.sort(), ['.claude/settings.json', '.claude/skills/neoprocess-reader/SKILL.md', '.claude/skills/neoprocess/SKILL.md', '.github/workflows/gate.yml', '.github/workflows/prune.yml', 'CLAUDE.md']);
  assert.equal(JSON.parse(readFileSync(join(w.bob.root, '.claude/settings.json'), 'utf8')).hooks, undefined);   // Bob, 30 Oct: no hook in any settings the process writes (PLT-4, SHM-1)
  assert.match(readFileSync(join(w.bob.root, '.github/workflows/prune.yml'), 'utf8'), /workflow_dispatch:[\s\S]*git push origin --delete "\$r"/);
  const standing = JSON.parse(readFileSync(join(HERE, '..', '..', 'permissions.json'), 'utf8')), written = JSON.parse(readFileSync(join(w.bob.root, '.claude/settings.json'), 'utf8')).permissions;
  assert.deepEqual([written.allow, written.deny], [standing.allow, standing.deny]);
  assert.equal(JSON.parse(readFileSync(join(w.bob.root, '.claude/settings.json'), 'utf8')).env, undefined);   // no turn-end hook, so no cap for it (PLT-4)   // the standing list, allow and deny, applied (PERMISSIONS §2.4, §8.2)
  assert.ok(standing.deny.some((r) => /force/.test(r)) && !standing.allow.some((r) => /^Bash\(\*\)|^Agent$/.test(r)));   // the safety rules denied; no broad rule Auto would drop
  const skill = readFileSync(join(w.bob.root, '.claude/skills/neoprocess/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: neoprocess\n/); assert.equal(JSON.parse(readFileSync(join(w.bob.root, '.claude/settings.json'), 'utf8')).hooks, undefined);   // Bob, 30 Oct: no hook wired (PLT-4)
  assert.match(skill, /!`node "\/p\/neoProcess\/tools\/proc\.mjs" reading --role "\$ARGUMENTS" --product "toy"/);
  const claude = readFileSync(join(w.bob.root, 'CLAUDE.md'), 'utf8');
  assert.ok(claude.split('\n').length <= 30); assert.match(claude, /`o\/neoProcess`, attached at `\/p\/neoProcess` on its branch `lane`/);
  const yml = readFileSync(join(w.bob.root, '.github/workflows/gate.yml'), 'utf8');
  assert.match(yml, /^name: gate\non:\n  pull_request:\n    branches: \[tranche\]\njobs:\n/);   // no merge queue: the tool merges (JOB-LIFE §6)
  assert.match(yml, /repository: o\/neoProcess\n          ref: lane\n          path: \.neoprocess\n      - uses: actions\/setup-node/);   // public: no key, no secret; the process branch the product follows
  assert.match(yml, /run: node \.neoprocess\/tools\/proc\.mjs gate --product "toy" --process "\/p\/neoProcess" --repo "o\/neoProcess" --ref "lane" --base HEAD\^1/);   // the merge ref's own base, never the event's sha (stale once the base moved)   // the same inputs in CI: no drift
  assert.deepEqual(N.shims({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane', check: true }).drift, []);
  assert.match(yml, /setup-node@v4\n        with:\n          node-version: 22\n      - name: the gate/);   // no version file, no lock: the default, no install
  // issue 69 (5): every product session clones the process read-only where the shims name it, when it is missing
  const P = '/p/neoProcess', CLONE = { type: 'command', command: `if [ -d "${P}/.git" ]; then { [ "$(git -C "${P}" rev-parse --abbrev-ref HEAD)" = lane ] && [ -z "$(git -C "${P}" status --porcelain --untracked-files=no)" ] && git -C "${P}" fetch -q origin +refs/heads/lane:refs/remotes/origin/lane && git -C "${P}" merge -q --ff-only origin/lane; } || echo "neoProcess: could not bring ${P} to the tip of lane" >&2; else git clone -q --branch lane https://github.com/o/neoProcess "${P}" || echo "neoProcess: could not clone o/neoProcess to ${P}" >&2; fi` };
  assert.equal(written.hooks, undefined); void CLONE; assert.equal(JSON.parse(readFileSync(join(w.bob.root, '.claude/settings.json'), 'utf8')).hooks, undefined);   // Bob, 30 Oct: no hook in the settings (PLT-4, SHM-1)
  assert.match(claude, /clones it there read-only when it is missing; if it is still missing, run `git clone --branch lane https:\/\/github\.com\/o\/neoProcess \/p\/neoProcess`/);
  // issue 62: a product's own session setup is registered by the shims, and the gate takes the product's Node version and its lock
  mkdirSync(join(w.bob.root, '.claude/hooks'), { recursive: true }); writeFileSync(join(w.bob.root, '.claude/hooks/session-start.sh'), '#!/bin/bash\nnpm ci\n');
  writeFileSync(join(w.bob.root, '.nvmrc'), '26.10.0\n'); writeFileSync(join(w.bob.root, 'package-lock.json'), '{}\n');
  // issue 81: a lock per member, none or one at the root: each installed where it sits (node_modules' own locks never)
  for (const d of ['site', 'worker/inner', 'site/node_modules/dep']) { mkdirSync(join(w.bob.root, d), { recursive: true }); writeFileSync(join(w.bob.root, d, 'package-lock.json'), '{}\n'); }
  assert.deepEqual(N.shims({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane', check: true }).drift.sort(), ['.github/workflows/gate.yml: differs']);   // the setup script is no longer a hook (SHM-5): only the gate's install step changes
  N.shims({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane' });
  assert.equal(JSON.parse(readFileSync(join(w.bob.root, '.claude/settings.json'), 'utf8')).hooks, undefined); assert.equal(JSON.parse(readFileSync(join(w.bob.root, '.claude/settings.json'), 'utf8')).env, undefined);
  // issue 111: the skills the shims write carry no hooks (nothing runs twice); the hooks name every event the process uses
  assert.doesNotMatch(readFileSync(join(w.bob.root, '.claude/skills/neoprocess/SKILL.md'), 'utf8'), /^hooks:/m); assert.doesNotMatch(readFileSync(join(w.bob.root, '.claude/skills/neoprocess-reader/SKILL.md'), 'utf8'), /^hooks:/m);
  assert.deepEqual(N.hookSettings('/p'), {});   // Bob, 30 Oct: every hook unwired
  assert.match(readFileSync(join(w.bob.root, '.github/workflows/gate.yml'), 'utf8'), /setup-node@v4\n        with:\n          node-version-file: \.nvmrc\n      - name: the product's locked dependencies, each where its lock sits\n        run: \|\n          set -euo pipefail\n          \(cd "\." && npm ci --no-audit --no-fund --loglevel=error\)\n          \(cd "site" && npm ci --no-audit --no-fund --loglevel=error\)\n          \(cd "worker\/inner" && npm ci --no-audit --no-fund --loglevel=error\)\n      - name: the gate/);
  assert.deepEqual(N.shims({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane', check: true }).drift, []);
  for (const f of ['.claude/hooks/session-start.sh', '.nvmrc', 'package-lock.json', 'site', 'worker']) rmSync(join(w.bob.root, f), { recursive: true, force: true });
  N.shims({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane' });
  writeFileSync(join(w.bob.root, 'CLAUDE.md'), `${claude}\nMy own rule.\n`);
  assert.deepEqual(N.shims({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane', check: true }).drift, ['CLAUDE.md: differs']);
  assert.deepEqual(N.shims({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane' }).written, ['CLAUDE.md']);   // rewritten
  g(w.bob.root, 'add', '-A'); g(w.bob.root, 'commit', '-q', '-m', 'shims'); g(w.bob.root, 'push', '-q', 'origin', 'HEAD:tranche');
  // the gate on a job branch: the module from the diff; green with the artifacts regenerated for the run; another module's file and a hand-edited shim each fail
  const base = g(w.bob.root, 'rev-parse', 'HEAD');
  g(w.bob.root, 'checkout', '-q', '-b', 'job/alpha');
  g(w.bob.root, 'commit', '-q', '--allow-empty', '-m', 'ALPHA #1 opens');
  const g0 = N.gateCmd({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane', base });   // the opening commit: nothing to check yet
  assert.deepEqual([g0.ok, g0.module, g0.fails], [true, null, []]);
  const src = join(w.bob.dir, 'alpha/src/index.mjs');
  writeFileSync(src, `${readFileSync(src, 'utf8')}// a line\n`);
  g(w.bob.root, 'add', '-A'); g(w.bob.root, 'commit', '-q', '-m', 'alpha: a line');
  const g1 = N.gateCmd({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane', base });
  assert.equal(g(w.bob.root, 'status', '--porcelain'), '');   // the bundles (which read alpha's source) were regenerated for the run and put back
  assert.deepEqual([g1.ok, g1.module, g1.fails, g1.checks], [true, 'alpha', [], ['format', 'architecture', 'coverage', 'fixtures']]);
  assert.ok(g1.tests.pass > 0 && g1.tests.pass === g1.tests.tests);
  assert.deepEqual(g1.users, {});   // issue 93: a comment changes nothing alpha provides, so beta's and stats' tests are not run (P11)
  writeFileSync(join(w.bob.dir, 'beta/src/index.mjs'), `${readFileSync(join(w.bob.dir, 'beta/src/index.mjs'), 'utf8')}// not alpha's\n`);
  g(w.bob.root, 'add', '-A'); g(w.bob.root, 'commit', '-q', '-m', 'alpha: touches beta');
  assert.throws(() => N.gateCmd({ product: w.bob.dir, base }), /several modules: alpha, beta/);
  const g2 = N.gateCmd({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane', base, module: 'alpha' });
  assert.match(g2.fails.join(';'), /ownership: .*beta\/src\/index\.mjs: outside alpha's paths/);
  g(w.bob.root, 'reset', '-q', '--hard', 'HEAD~1');
  writeFileSync(join(w.bob.root, 'CLAUDE.md'), 'mine\n'); g(w.bob.root, 'add', '-A'); g(w.bob.root, 'commit', '-q', '-m', 'alpha: edits the shim');
  const g3 = N.gateCmd({ product: w.bob.dir, process: '/p/neoProcess', repo: 'o/neoProcess', ref: 'lane', base, module: 'alpha' });
  assert.deepEqual(g3.fails.filter((x) => x.startsWith('shims')), ['shims: CLAUDE.md: differs']);
  assert.throws(() => N.gateCmd({ product: w.bob.dir, base: 'nope' }), /not a commit/);
});

test('a tranche opened from main, a round opened and closed, the tranche closed by its one PR and its branch gone (JOB-LIFE §1, §10)', () => {
  const w = world({ noTranche: true }), R = N.repo(w.bob.dir), o = (x) => ({ product: w.bob.dir, ...x }), g2 = (...a) => g(w.bob.root, ...a);
  // the next tranche's plan on main, opened by planning (its R1) with the grant check as the dispatcher gives it
  const D = { grants: N.grantsHeld, words: () => [] }, next = (T, line) => `# Plan: test ${T}\n\n**Status** · OPEN · the process pinned at \`abc1234\`.\n\n**The legacy census** · none.\n\n## Layer 1\n\n**alpha**\n- ${line}\n`;
  g2('rm', '-q', '-r', 'toy/build/plan'); mkdirSync(join(w.bob.dir, 'build/plan')); writeFileSync(join(w.bob.dir, P.NEXT), next('T2', 'N1 · A line. · hard reason: a measurement')); g2('add', '-A'); g2('commit', '-q', '-m', 'no plan but the next'); g2('push', '-q', 'origin', 'HEAD:main');   // the toy's old plans are not this test's
  assert.throws(() => P.trancheOpen(o(), D), /grants are not proven held/);   // PERMISSIONS §10.3
  heldGrants(w.bob.root);
  const to = P.trancheOpen(o(), D);
  assert.deepEqual([to.tranche, to.round, to.layers, R.branch()], ['T2', 1, [1], 'tranche']);
  assert.equal(g2('rev-parse', 'origin/tranche'), g2('rev-parse', 'HEAD'));
  assert.match(readFileSync(join(w.bob.dir, 'build/plan/current.md'), 'utf8'), /^# Plan: test T2/);
  assert.throws(() => P.trancheOpen(o(), D), /holds work not on main/);
  N.epochOpen(o()); N.takeover(o({ name: 'BOB #1', session: B1 }));
  assert.throws(() => N.roundOpen(o({ planFile: P.PLAN })), /a round is running: layer\(s\) 1/);
  assert.throws(() => N.trancheClose(o()), /a round is open/);
  // the layer run (its jobs' lives are the other test's): the state written as the commands leave it
  N.layerStart(o({ layer: 1 }));
  assert.throws(() => N.roundClose(o()), /layer\(s\) 1 not closed/);
  N.stateWrite(R, { 'jobs/alpha.md': `**Status** · ALPHA #1 · ${J1} · ARCHIVED\n`, 'plan.md': `# Plan (transient)\n\n**Status** · OPEN · BOB #1 · ${B1}\n**Owed** · none\n**Layers** · 1 CLOSED\n` }, 'layer 1 run');
  writeFileSync(join(w.bob.dir, 'build/plan/next.md'), '# Plan: test T2\n\n**Status** · OPEN.\n\n## Layer 1\n\n**alpha**\n- N2 · Another line.\n');
  N.commitPush(R, N.TRANCHE, ['build/plan/next.md'], 'the next plan');
  const rc = N.roundClose(o());
  assert.deepEqual([rc.round, rc.archived, rc.next], [1, 'build/plan/archive/T2-R1.md', 'build/plan/next.md']);   // next.md names this tranche
  assert.match(readFileSync(join(w.bob.dir, 'build/plan/current.md'), 'utf8'), /N2 · Another line/);
  assert.equal(existsSync(join(w.bob.dir, 'build/plan/next.md')), false);
  assert.deepEqual(N.status(o()).owed, []);
  // issue 73: the tranche's completion round wins over a next.md that is the next tranche's list, which stays where it is
  writeFileSync(join(w.bob.dir, 'build/plan/next.md'), '# Plan: test T9\n\n## Layer 1\n\n**alpha**\n- N9 · next tranche\n');
  writeFileSync(join(w.bob.dir, 'build/plan/T2-completion.md'), '# Plan: test T2\n\n## Layer 1\n\n**alpha**\n- N4 · the completion round\n');
  N.commitPush(R, N.TRANCHE, ['build/plan/next.md', 'build/plan/T2-completion.md'], 'the completion round; the next tranche');
  N.stateWrite(R, { 'plan.md': `# Plan (transient)\n\n**Status** · OPEN · BOB #1 · ${B1}\n**Owed** · none\n**Layers** · 1 CLOSED\n` }, 'round 2 run');
  assert.equal(N.roundClose(o()).next, 'build/plan/T2-completion.md');
  assert.match(readFileSync(join(w.bob.dir, 'build/plan/current.md'), 'utf8'), /N4 · the completion round/);
  assert.equal(existsSync(join(w.bob.dir, 'build/plan/T2-completion.md')), false);
  // the last round, closed: the next tranche's list is not this tranche's, so no plan runs and next.md stays
  N.stateWrite(R, { 'plan.md': `# Plan (transient)\n\n**Status** · OPEN · BOB #1 · ${B1}\n**Owed** · none\n**Layers** · 1 CLOSED\n` }, 'round 3 run');
  const last = N.roundClose(o());
  assert.deepEqual([last.round, last.next, existsSync(join(w.bob.dir, 'build/plan/current.md')), existsSync(join(w.bob.dir, 'build/plan/next.md'))], [3, null, false, true]);
  writeFileSync(join(w.bob.dir, P.NEXT), next('T3', 'N3 · x · hard reason: a measurement')); N.commitPush(R, N.TRANCHE, [P.NEXT], 'the next tranche\'s plan, carried to main by the close (planning R1)');
  // after the last round no plan runs: a refusal is still routed and counted under the tranche (DRYRUN §4.19)
  const rf = N.refused(o({ act: 'archive_session(child)', kind: 'classifier', reason: 'Interfere With Workloads', by: 'NEOPROCESS #6' }));
  // issue 76: a report filed under the archive after the plans does not hide the last archived plan
  writeFileSync(join(w.bob.dir, 'build/plan/archive/words-report.txt'), 'a report\n'); N.commitPush(R, N.TRANCHE, ['build/plan/archive/words-report.txt'], 'a report in the archive');
  assert.equal(N.trancheId(R), 'T2'); assert.equal(N.trancheId(R, 'T7'), 'T7');
  assert.equal(N.refusedRouted(o({ id: rf.refusal, route: 'Bob archives it' })).refusal, 'R-NEOPROCESS-6-1');
  assert.match(readFileSync(join(w.bob.dir, 'build/metrics/T2.csv'), 'utf8'), /^,refusal,NEOPROCESS #6,neoprocess,.*archive_session\(child\) · predicted · Bob archives it$/m);
  const fp = N.footprint(o());
  assert.ok(fp.commits > 0); assert.equal(fp.kinds.product, 0);   // only build state moved: bookkeeping
  const tc = N.trancheClose(o());
  assert.deepEqual([tc.tranche, tc.pr.head, tc.pr.base, tc.pr.title, tc.pr.draft], ['T2', 'tranche', 'main', 'T2: close', false]);
  assert.equal(N.status(o()).bob.session, B1); assert.deepEqual(N.status(o()).owed, ['merge tranche']);
  assert.equal(N.parsePlan(N.stateRead(R, 'plan.md')).state, 'CLOSING');
  assert.deepEqual([tc.merge.tool, tc.merge.merge_method, tc.merge.expectedHeadSha], ['merge_pull_request', 'merge', g2('rev-parse', 'origin/tranche')]);
  assert.throws(() => N.trancheClose(o()), /acts still owed/);
  assert.throws(() => N.trancheMerged(o({ sha: g2('rev-parse', 'origin/main') })), /is not in/);   // main's tip does not hold the tranche yet
  // the close PR merged (here: the merge made on main by hand) and recorded; the branch is gone; the epoch can close
  g2('checkout', '-q', 'main'); g2('merge', '-q', '--no-ff', '-m', 'T2: close (#1)', 'origin/tranche'); g2('push', '-q', 'origin', 'HEAD:main');
  g2('checkout', '-q', 'tranche');
  const tm = N.trancheMerged(o({ sha: g2('rev-parse', 'origin/main') }));
  assert.equal(tm.merged, g2('rev-parse', '--short', 'origin/main'));
  assert.deepEqual(R.heads('refs/heads/tranche'), ['tranche']);   // the branch stays (the ruleset refuses its deletion)
  assert.equal(N.parsePlan(N.stateRead(R, 'plan.md')).state, 'CLOSED');
  assert.deepEqual(N.status(o()).owed, []);
  assert.equal(N.epochClose(o()).epoch, 'E1');
  assert.throws(() => N.trancheMerged(o({ sha: g2('rev-parse', 'origin/main') })), /no epoch is open/);
  assert.equal(g2('rev-parse', 'origin/tranche'), g2('rev-parse', 'origin/main^2'));   // nothing pushed to the tranche after its merge: the epoch's end rode the close PR
  assert.match(g2('show', 'origin/main:toy/build/epochs.md'), /^- E1 · opened \S+ · closed \S+ with T2$/m);
  // the tranche's last BOB, archived by ROOT after the merge: nothing may be pushed to the closed tranche (DRYRUN §4.16)
  const lastBob = { name: 'BOB #1', session: B1, usage: JSON.stringify({ cache_read_tokens: 7, cache_write_tokens: 6, input_tokens: 5, output_tokens: 4 }) };
  assert.throws(() => N.bobArchived(o({ ...lastBob, tranche: 'T2' })), /tranche is closed \(on main whole\)/);
  // the next tranche: the branch fast-forwarded to main (a merged tranche is on main whole), the new plan current
  const t3 = P.trancheOpen(o(), D);
  assert.deepEqual([t3.tranche, t3.round, t3.from], ['T3', 1, g2('rev-parse', '--short', 'origin/main')]);
  assert.equal(g2('rev-parse', 'origin/tranche~1'), g2('rev-parse', 'origin/main'));
  assert.match(readFileSync(join(w.bob.dir, 'build/plan/current.md'), 'utf8'), /^# Plan: test T3/);
  // ...so the next tranche's BOB writes it, under the tranche it worked in, once
  assert.throws(() => N.bobArchived(o({ ...lastBob, tranche: 'nope' })), /a tranche id/);
  N.bobArchived(o({ ...lastBob, tranche: 'T2' }));
  assert.match(readFileSync(join(w.bob.dir, 'build/metrics/T2.csv'), 'utf8'), new RegExp(`^${B1},BOB-final,BOB #1,,7,6,5,4,,,,$`, 'm'));
  assert.equal(existsSync(join(w.bob.dir, 'build/metrics/T3.csv')), false);
  assert.throws(() => N.bobArchived(o({ ...lastBob, tranche: 'T2' })), /already has its row/);
});

test('repo setup makes a development repository and its two rulesets, idempotently, and reads them back; from a session the proxy refuses the writes and the workflow\'s dispatch is printed (PERMISSIONS §9)', async () => {
  const log = [], made = { repo: false, rulesets: [] };
  let auth = null;
  const fetch = async (url, init) => {
    const path = url.replace('https://api.github.com', ''), method = init.method; log.push(`${method} ${path}`); auth = init.headers.Authorization ?? null;
    const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
    if (path === '/user') return reply(200, { login: 'bob' });
    if (method === 'GET' && path === '/repos/bob/toy') return made.repo ? reply(200, { name: 'toy' }) : reply(404, { message: 'Not Found' });
    if (method === 'POST' && path === '/user/repos') { made.repo = true; return reply(201, { html_url: 'https://github.com/bob/toy' }); }
    if (method === 'GET' && path === '/repos/bob/toy/rulesets') return reply(200, made.rulesets.map((r) => ({ name: r.name, enforcement: r.enforcement })));
    if (method === 'POST' && path === '/repos/bob/toy/rulesets') { made.rulesets.push(JSON.parse(init.body)); return reply(201, {}); }
    return reply(500, { message: `unexpected ${method} ${path}` });
  };
  await assert.rejects(N.repoSetup({ repo: 'nope' }), /--repo <owner\/name>/);
  const dry = await N.repoSetup({ repo: 'bob/toy', dryRun: true });
  assert.deepEqual(dry.calls.map((c) => `${c[0]} ${c[1]}`), ['POST /user/repos', 'POST /repos/bob/toy/rulesets', 'POST /repos/bob/toy/rulesets']);
  assert.deepEqual(dry.calls[0][2], { name: 'toy', description: 'built by neoProcess (PRODUCT-SUPPLIES.md)', private: false, auto_init: true });
  await assert.rejects(N.repoSetup({ repo: 'alice/toy', fetch, env: {} }), /the token is bob's/);
  // on GitHub's runner, the process's own token read by name (never in a session): created, the rulesets made, read back active
  const r1 = await N.repoSetup({ repo: 'bob/toy', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } });
  assert.equal(auth, 'Bearer ghp_x');
  assert.deepEqual(r1.steps, ['repository created: https://github.com/bob/toy', 'ruleset tranche created', 'ruleset main created']);
  assert.deepEqual([r1.ok, r1.rulesets, r1.token, r1.dispatch], [true, ['tranche active', 'main active'], 'the repository owner\'s (NEOPROCESS_GITHUB_TOKEN)', undefined]);
  assert.deepEqual(made.rulesets.map((r) => [r.name, r.conditions.ref_name.include[0], r.rules.map((x) => x.type)]), [['tranche', 'refs/heads/tranche', ['deletion', 'non_fast_forward']], ['main', 'refs/heads/main', ['deletion', 'non_fast_forward', 'pull_request']]]);
  assert.equal(made.rulesets[1].rules[2].parameters.required_approving_review_count, 0);
  // again, from a session (no token of its own: the proxy's): nothing remade, everything read back
  const r2 = await N.repoSetup({ repo: 'bob/toy', fetch, env: {} });
  assert.equal(auth, null);
  assert.deepEqual([r2.steps, r2.ok, r2.token, r2.dispatch], [['repository exists', 'ruleset tranche exists', 'ruleset main exists'], true, 'the proxy\'s', undefined]);
  assert.equal(log.filter((l) => l.startsWith('POST')).length, 3);
  // from a session the proxy refuses the writes (29 Oct #8: the creation bound to the session's repositories, the
  // rulesets as settings writes): nothing is worked around; the workflow's dispatch and Bob's hand steps are printed
  const proxy = async (url, init) => (init.method === 'POST' ? { status: 403, text: async () => JSON.stringify({ message: url.endsWith('/user/repos') ? 'This GitHub API path is not available: sessions are bound to their configured repositories.' : 'Repository settings writes are not permitted through this proxy' }) } : fetch(url, init));
  made.rulesets = [];
  const r3 = await N.repoSetup({ repo: 'bob/toy', fetch: proxy, env: {} });
  assert.deepEqual([r3.ok, r3.steps, r3.rulesets], [false, ['repository exists'], []]);
  assert.match(r3.refused.join(';'), /^POST rulesets tranche 403: Repository settings writes.*;POST rulesets main 403/);
  assert.deepEqual(r3.bob, ['ruleset tranche (SETUP-STEPS steps 2–3)', 'ruleset main (SETUP-STEPS step 4)']);
  assert.deepEqual([r3.dispatch.tool, r3.dispatch.workflow_id, r3.dispatch.ref, r3.dispatch.inputs], ['actions_run_trigger', N.REPO_SETUP_WORKFLOW, 'main', { repo: 'bob/toy', private: 'false' }]);
  assert.ok(r3.dispatch.owner && r3.dispatch.repo, 'the process repository, read from its remote');
  assert.match(r3.then, /NEOPROCESS_GITHUB_TOKEN.*add_repo.*SETUP-STEPS/);
  made.repo = false;
  const r4 = await N.repoSetup({ repo: 'bob/toy', fetch: proxy, env: {}, private: true });
  assert.match(r4.refused.join(';'), /^POST \/user\/repos 403: This GitHub API path is not available/);
  assert.deepEqual([r4.bob, r4.rulesets, r4.dispatch.inputs.private], [['the repository bob/toy (SETUP-STEPS step 1)', 'the two rulesets (SETUP-STEPS steps 2–4)'], undefined, 'true']);
  // a repository this session may not read (not configured for it): no write is tried; the dispatch and the attach are named
  const bound = async (url, init) => (/\/repos\/bob\/toy/.test(url) ? { status: 403, text: async () => JSON.stringify({ message: 'sessions are bound to their configured repositories' }) } : fetch(url, init));
  const r5 = await N.repoSetup({ repo: 'bob/toy', fetch: bound, env: {} });
  assert.match(r5.refused.join(';'), /^GET \/repos\/bob\/toy 403/); assert.match(r5.bob[0], /add_repo/); assert.equal(r5.ok, false);
  // on the runner a refusal is a refusal, named for the record
  await assert.rejects(N.repoSetup({ repo: 'bob/toy', fetch: proxy, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } }), /with the process's token: POST \/user\/repos 403/);
  // the workflow that runs it on GitHub's runner is in the process repository: dispatchable, the secret by name, the command
  const wf = readFileSync(join(HERE, '..', '..', '.github', 'workflows', N.REPO_SETUP_WORKFLOW), 'utf8');
  assert.match(wf, /^on:\n  workflow_dispatch:\n    inputs:\n      repo:/m); assert.match(wf, /NEOPROCESS_GITHUB_TOKEN: \$\{\{ secrets\[steps\.secret\.outputs\.name\] \}\}/); assert.match(wf, /node tools\/proc\.mjs repo setup --repo "\$REPO"/);
  assert.ok(!wf.split(/\n(?=      - )/).flatMap((st) => st.split(/\n        run: \|\n/).slice(1)).some((b) => b.includes('${{ inputs.')), 'an input spliced into a script');   // inputs reach the script through env, never spliced into it
});

test('one secret per owner: the process\'s owner keeps NEOPROCESS_GITHUB_TOKEN, another owner\'s is named by its login, and every runner workflow picks it the same way (PERMISSIONS §9.9)', () => {
  assert.equal(N.ownerSecret('neobobkrause', 'neobobkrause'), 'NEOPROCESS_GITHUB_TOKEN');
  assert.equal(N.ownerSecret('NeoBobKrause', 'neobobkrause'), 'NEOPROCESS_GITHUB_TOKEN');
  assert.equal(N.ownerSecret('civicsmith', 'neobobkrause'), 'NEOPROCESS_GITHUB_TOKEN_CIVICSMITH');
  assert.equal(N.ownerSecret('my-org', 'neobobkrause'), 'NEOPROCESS_GITHUB_TOKEN_MY_ORG');
  assert.throws(() => N.ownerSecret('a/b', 'x'), /not an account login/);
  for (const f of [N.REPO_SETUP_WORKFLOW, N.REPO_RENAME_WORKFLOW, N.REPO_TRANSFER_WORKFLOW, N.REPO_SHIMS_WORKFLOW]) {
    const wf = readFileSync(join(HERE, '..', '..', '.github', 'workflows', f), 'utf8');
    assert.match(wf, /id: secret\n[\s\S]*if \[ "\$owner" = "\$GITHUB_REPOSITORY_OWNER" \]; then name=NEOPROCESS_GITHUB_TOKEN\n[\s\S]*name="NEOPROCESS_GITHUB_TOKEN_\$\(printf '%s' "\$owner" \| tr 'a-z-' 'A-Z_'\)"/, f);
    assert.match(wf, /NEOPROCESS_GITHUB_TOKEN: \$\{\{ secrets\[steps\.secret\.outputs\.name\] \}\}/, f);
    assert.doesNotMatch(wf, /secrets\.NEOPROCESS_GITHUB_TOKEN\b/, f);
    assert.ok(wf.indexOf('id: secret') < wf.indexOf('actions/checkout'), f);
    // an unquoted value holding ': ' is a YAML mapping, and GitHub then drops the workflow's dispatch (#12, PR #57)
    for (const l of wf.split('\n')) assert.doesNotMatch(l, /^\s*(?:- )?[\w-]+: (?!["'|>])[^#]*: /, `${f}: ${l}`);
    // the shell rule and the tool's rule agree
    for (const [owner, proc] of [['civicsmith', 'neobobkrause'], ['my-org', 'neobobkrause'], ['neobobkrause', 'neobobkrause']]) {
      const out = execFileSync('bash', ['-c', `REPO=${owner}/x; GITHUB_REPOSITORY_OWNER=${proc}; owner="\${REPO%%/*}"; if [ "$owner" = "$GITHUB_REPOSITORY_OWNER" ]; then name=NEOPROCESS_GITHUB_TOKEN; else name="NEOPROCESS_GITHUB_TOKEN_$(printf '%s' "$owner" | tr 'a-z-' 'A-Z_')"; fi; printf '%s' "$name"`], { encoding: 'utf8' });
      assert.equal(out, N.ownerSecret(owner, proc), `${f}: ${owner}`);
    }
  }
});

test('repo rename renames a repository on the runner with the process\'s token and reads it back; from a session the dispatch is printed (PERMISSIONS §9)', async () => {
  let name = 'civicos-process', auth = null;
  const fetch = async (url, init) => {
    const path = url.replace('https://api.github.com', ''), method = init.method; auth = init.headers.Authorization ?? null;
    const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
    if (path === '/user') return reply(200, { login: 'bob' });
    const m = path.match(/^\/repos\/bob\/([\w.-]+)$/);
    if (m && method === 'GET') return m[1] === name ? reply(200, { name, html_url: `https://github.com/bob/${name}` }) : reply(404, { message: 'Not Found' });
    if (m && method === 'PATCH') { if (!auth) return reply(403, { message: 'Repository settings writes are not permitted through this proxy' }); name = JSON.parse(init.body).name; return reply(200, { name, html_url: `https://github.com/bob/${name}` }); }
    return reply(500, { message: `unexpected ${method} ${path}` });
  };
  await assert.rejects(N.repoRename({ repo: 'nope', name: 'x' }), /--repo <owner\/old> --name <new>/);
  await assert.rejects(N.repoRename({ repo: 'alice/civicos-process', name: 'neoprocess', fetch, env: {} }), /the token is bob's/);
  // from a session: the proxy refuses the settings write; the dispatch and what follows are printed
  const r1 = await N.repoRename({ repo: 'bob/civicos-process', name: 'neoprocess', fetch, env: {} });
  assert.deepEqual([r1.ok, r1.steps, r1.token], [false, [], 'the proxy\'s']);
  assert.match(r1.refused.join(';'), /^PATCH \/repos\/bob\/civicos-process 403: Repository settings writes/);
  assert.deepEqual([r1.dispatch.tool, r1.dispatch.workflow_id, r1.dispatch.ref, r1.dispatch.inputs], ['actions_run_trigger', N.REPO_RENAME_WORKFLOW, 'main', { repo: 'bob/civicos-process', name: 'neoprocess' }]);
  assert.match(r1.then, /git remote set-url origin.*proc shims/);
  // on the runner, with the token: renamed and read back under the new name; again: already named
  const r2 = await N.repoRename({ repo: 'bob/civicos-process', name: 'neoprocess', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } });
  assert.equal(auth, 'Bearer ghp_x');
  assert.deepEqual([r2.ok, r2.steps, r2.dispatch], [true, ['renamed: https://github.com/bob/neoprocess', 'read back: bob/neoprocess'], undefined]);
  const r3 = await N.repoRename({ repo: 'bob/neoprocess', name: 'neoprocess', fetch, env: {} });
  assert.deepEqual([r3.ok, r3.steps], [true, ['already named neoprocess']]);
  // on the runner a refusal is a refusal
  name = 'other';
  await assert.rejects(N.repoRename({ repo: 'bob/civicos-process', name: 'neoprocess', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } }), /with the process's token: GET \/repos\/bob\/civicos-process 404/);
  const wf = readFileSync(join(HERE, '..', '..', '.github', 'workflows', N.REPO_RENAME_WORKFLOW), 'utf8');
  assert.match(wf, /^on:\n  workflow_dispatch:\n    inputs:\n      repo:/m); assert.match(wf, /NEOPROCESS_GITHUB_TOKEN: \$\{\{ secrets\[steps\.secret\.outputs\.name\] \}\}/); assert.match(wf, /node tools\/proc\.mjs repo rename --repo "\$REPO" --name "\$NAME"/);
  assert.ok(!wf.split(/\n(?=      - )/).flatMap((st) => st.split(/\n        run: \|\n/).slice(1)).some((b) => b.includes('${{ inputs.')), 'an input spliced into a script');
});

test('repo transfer moves a repository to another account on the runner with the process\'s token; the new owner accepts; from a session the dispatch is printed (PERMISSIONS §9)', async () => {
  let owner = 'bob', pending = false, auth = null;
  const fetch = async (url, init) => {
    const path = url.replace('https://api.github.com', ''), method = init.method; auth = init.headers.Authorization ?? null;
    const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
    if (path === '/user') return reply(200, { login: 'bob' });
    const m = path.match(/^\/repos\/([\w.-]+)\/neoprocess$/);
    if (m && method === 'GET') return m[1] === owner ? reply(200, { name: 'neoprocess', owner: { login: owner }, html_url: `https://github.com/${owner}/neoprocess` }) : reply(404, { message: 'Not Found' });
    if (path === '/repos/bob/neoprocess/transfer' && method === 'POST') { if (!auth) return reply(403, { message: 'Repository settings writes are not permitted through this proxy' }); pending = JSON.parse(init.body).new_owner; return reply(202, { name: 'neoprocess' }); }
    return reply(500, { message: `unexpected ${method} ${path}` });
  };
  await assert.rejects(N.repoTransfer({ repo: 'nope', to: 'x' }), /--repo <owner\/name> --to <new owner>/);
  // after the move the new owner's token reads it back (#10's note, 29 Oct): already owned, before any refusal
  const r0 = await N.repoTransfer({ repo: 'alice/neoprocess', to: 'bob', fetch, env: {} });
  assert.deepEqual([r0.ok, r0.moved, r0.steps], [true, true, ['already owned by bob: https://github.com/bob/neoprocess']]);
  owner = 'other';
  await assert.rejects(N.repoTransfer({ repo: 'bob/neoprocess', to: 'bob', fetch, env: {} }), /the token is bob's already/);
  owner = 'bob';
  await assert.rejects(N.repoTransfer({ repo: 'alice/neoprocess', to: 'robert', fetch, env: {} }), /the token is bob's, and --repo names alice/);
  // from a session: the proxy refuses the settings write; the dispatch and what follows are printed
  const r1 = await N.repoTransfer({ repo: 'bob/neoprocess', to: 'robert', fetch, env: {} });
  assert.deepEqual([r1.ok, r1.steps, r1.token, pending], [false, [], 'the proxy\'s', false]);
  assert.match(r1.refused.join(';'), /^POST \/repos\/bob\/neoprocess\/transfer 403: Repository settings writes/);
  assert.deepEqual([r1.dispatch.tool, r1.dispatch.workflow_id, r1.dispatch.ref, r1.dispatch.inputs], ['actions_run_trigger', N.REPO_TRANSFER_WORKFLOW, 'main', { repo: 'bob/neoprocess', to: 'robert' }]);
  assert.match(r1.then, /accepts GitHub's email within a day.*add_repo.*git remote set-url origin.*proc shims.*issues the process's token anew/);
  // on the runner, with the token: the transfer requested (202), pending the new owner's acceptance; nothing read back yet
  const r2 = await N.repoTransfer({ repo: 'bob/neoprocess', to: 'robert', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } });
  assert.equal(auth, 'Bearer ghp_x');
  assert.deepEqual([r2.ok, r2.pending, r2.moved, pending, r2.dispatch], [true, true, undefined, 'robert', undefined]);
  assert.match(r2.steps[0], /^transfer requested: robert accepts GitHub's email within a day/);
  // accepted: read back under the new owner, from the runner or a session, whichever token
  owner = 'robert';
  const r3 = await N.repoTransfer({ repo: 'bob/neoprocess', to: 'robert', fetch, env: {} });
  assert.deepEqual([r3.ok, r3.moved, r3.steps], [true, true, ['already owned by robert: https://github.com/robert/neoprocess']]);
  // on the runner a refusal is a refusal
  owner = 'other';
  await assert.rejects(N.repoTransfer({ repo: 'bob/neoprocess', to: 'robert', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } }), /with the process's token: GET \/repos\/bob\/neoprocess 404/);
  const wf = readFileSync(join(HERE, '..', '..', '.github', 'workflows', N.REPO_TRANSFER_WORKFLOW), 'utf8');
  assert.match(wf, /^on:\n  workflow_dispatch:\n    inputs:\n      repo:/m); assert.match(wf, /NEOPROCESS_GITHUB_TOKEN: \$\{\{ secrets\[steps\.secret\.outputs\.name\] \}\}/); assert.match(wf, /node tools\/proc\.mjs repo transfer --repo "\$REPO" --to "\$TO"/);
  assert.ok(!wf.split(/\n(?=      - )/).flatMap((st) => st.split(/\n        run: \|\n/).slice(1)).some((b) => b.includes('${{ inputs.')), 'an input spliced into a script');
});

test('repo shims regenerates a product\'s shims on the runner with the process\'s token: pushed to its branch shims, the pull request to its main merged and read back; from a session the dispatch is printed (PERMISSIONS §9)', async () => {
  const w = world({ noTranche: true }), runner = w.clone('runner');
  let auth = null, posted = null, merged = false;
  const fetch = async (url, init) => {
    const path = url.replace('https://api.github.com', ''), method = init.method; auth = init.headers.Authorization ?? null;
    const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
    if (path === '/user') return reply(200, { login: 'bob' });
    if (path.startsWith('/repos/bob/toy/pulls?') && method === 'GET') return reply(200, []);
    if (path === '/repos/bob/toy/pulls' && method === 'POST') { posted = JSON.parse(init.body); return reply(201, { number: 7, html_url: 'https://github.com/bob/toy/pull/7' }); }
    if (path === '/repos/bob/toy/pulls/7/merge' && method === 'PUT') { merged = true; return reply(200, { merged: true, sha: 'abc1234' }); }
    if (path === '/repos/bob/toy/pulls/7' && method === 'GET') return reply(200, { number: 7, merged });
    return reply(500, { message: `unexpected ${method} ${path}` });
  };
  await assert.rejects(N.repoShims({ repo: 'nope' }), /--repo <owner\/name>/);
  // from a session: the dispatch and what follows are printed; nothing is written
  const r1 = await N.repoShims({ repo: 'bob/toy', fetch, env: {} });
  assert.deepEqual([r1.ok, r1.steps, r1.token, auth], [false, [], 'the proxy\'s', null]);
  assert.deepEqual([r1.dispatch.tool, r1.dispatch.workflow_id, r1.dispatch.ref, r1.dispatch.inputs], ['actions_run_trigger', N.REPO_SHIMS_WORKFLOW, 'main', { repo: 'bob/toy' }]);
  assert.match(r1.then, /a second repository costs it its standing list.*proc shims.*branch shims.*merges it/);
  // on the runner, with the token: the product's checkout is named; the shims written, pushed, the pull request merged and read back
  await assert.rejects(N.repoShims({ repo: 'bob/toy', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } }), /--checkout <dir>/);
  const r2 = await N.repoShims({ repo: 'bob/toy', checkout: runner.root, process: '/home/user/neoprocess', ref: 'main', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } });
  assert.equal(auth, 'Bearer ghp_x');
  assert.deepEqual([r2.ok, merged, posted.head, posted.base], [true, true, N.SHIMS_BRANCH, 'main']);
  assert.match(r2.steps[0], /^pushed shims: \.claude\/settings\.json, CLAUDE\.md, /);
  assert.match(r2.steps[1], /^pull request #7: /); assert.equal(r2.steps[2], 'merged: abc1234'); assert.equal(r2.steps[3], 'no tranche: nothing to carry there');
  assert.equal(g(w.origin, 'rev-parse', '--verify', `refs/heads/${N.SHIMS_BRANCH}`).length, 40);
  assert.match(g(w.origin, 'show', `refs/heads/${N.SHIMS_BRANCH}:CLAUDE.md`), /attached at `\/home\/user\/neoprocess` on its branch `main`/);
  assert.equal(g(w.origin, 'log', '-1', '--format=%an', `refs/heads/${N.SHIMS_BRANCH}`), 'neoProcess');
  // the product already holding them: already current, nothing pushed
  const r3 = await N.repoShims({ repo: 'bob/toy', checkout: runner.root, process: '/home/user/neoprocess', ref: 'main', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } });
  assert.deepEqual([r3.ok, r3.steps], [true, ['already current', 'no tranche: nothing to carry there']]);
  // a push the product refuses: the refusal carries git's own words (run 40958218527, 29 Oct #12, said nothing)
  const other = w.clone('other');
  g(w.origin, 'update-ref', '-d', `refs/heads/${N.SHIMS_BRANCH}`);   // else the same commit, made in the same second, is nothing to send
  writeFileSync(join(w.origin, 'hooks', 'pre-receive'), '#!/bin/sh\necho "no: the test refuses the push"; exit 1\n', { mode: 0o755 });
  await assert.rejects(N.repoShims({ repo: 'bob/toy', checkout: other.root, process: '/home/user/neoprocess', ref: 'main', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } }), /the push to shims was refused: .*no: the test refuses the push/);
  // issue 98: a running tranche gets the same files by a direct commit on its tip, since every job branch opens from it
  const t = world(), tr = t.clone('runner'), before = g(t.origin, 'rev-parse', `refs/heads/${N.TRANCHE}`);
  merged = false; const r4 = await N.repoShims({ repo: 'bob/toy', checkout: tr.root, process: '/home/user/neoprocess', ref: 'main', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } });
  assert.match(r4.steps.at(-1), new RegExp(`^${N.TRANCHE}: \\.claude/settings\\.json.* at [0-9a-f]{7}$`));
  assert.equal(g(t.origin, 'rev-parse', `refs/heads/${N.TRANCHE}^`), before);   // one commit on the tip, nothing else moved
  assert.match(g(t.origin, 'show', `refs/heads/${N.TRANCHE}:CLAUDE.md`), /attached at `\/home\/user\/neoprocess` on its branch `main`/);
  assert.doesNotMatch(g(t.origin, 'show', `refs/heads/${N.TRANCHE}:.claude/settings.json`), /hooks/);   // Bob, 30 Oct: the tranche's settings carry no hook; the clone command is CLAUDE.md's (SHM-1)
  const r5 = await N.repoShims({ repo: 'bob/toy', checkout: tr.root, process: '/home/user/neoprocess', ref: 'main', fetch, env: { NEOPROCESS_GITHUB_TOKEN: 'ghp_x' } });
  assert.equal(r5.steps.at(-1), `${N.TRANCHE} already current`);
  const wf = readFileSync(join(HERE, '..', '..', '.github', 'workflows', N.REPO_SHIMS_WORKFLOW), 'utf8');
  assert.match(wf, /^on:\n  workflow_dispatch:\n    inputs:\n      repo:/m); assert.match(wf, /NEOPROCESS_GITHUB_TOKEN: \$\{\{ secrets\[steps\.secret\.outputs\.name\] \}\}/); assert.match(wf, /node tools\/proc\.mjs repo shims --repo "\$REPO" --checkout product/);
  assert.ok(!wf.split(/\n(?=      - )/).flatMap((st) => st.split(/\n        run: \|\n/).slice(1)).some((b) => b.includes('${{ inputs.')), 'an input spliced into a script');
});

test('onboarding: a new project seeded from nothing, an existing one converted, and where each stands (ONBOARDING §2, §3)', () => {
  const mk = (files) => {
    const base = mkdtempSync(join(tmpdir(), 'onboard-')), origin = join(base, 'origin.git'), dir = join(base, 'p');
    execFileSync('git', ['init', '-q', '--bare', origin]); execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' }); ident(dir, 'p');
    for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); }
    g(dir, 'add', '-A'); g(dir, 'commit', '-q', '--allow-empty', '-m', 'start'); g(dir, 'branch', '-M', 'main'); g(dir, 'push', '-q', 'origin', 'main');
    return dir;
  };
  // a new project: the skeleton and the shims written; intake open until the owner's vision, audiences and requirements are in
  const n = mk({ 'README.md': '# A new idea\n' });
  const r = N.init({ product: n, mode: 'new', name: 'Idea', repo: 'o/proc', ref: 'main' });
  assert.ok(['requirements/README.md', 'build/manifest.md', 'build/modules.json', 'build/GRANTS.md', 'build/grants.json'].every((p) => r.written.includes(p)));
  assert.ok(r.shims.includes('CLAUDE.md') && r.shims.includes('.claude/settings.json'));
  const st = (c) => Object.fromEntries(c.map((x) => [x.name, x.status]));
  assert.deepEqual(st(r.check), { intake: 'OPEN', seed: 'DONE', grants: 'OPEN', repository: 'CHECK', architecture: 'OPEN', requirements: 'OPEN', 'first tranche': 'OPEN', handover: 'OPEN' });
  assert.match(readFileSync(join(n, 'requirements/README.md'), 'utf8'), /## Vision\n\n<!-- onboarding:/);
  assert.deepEqual(JSON.parse(readFileSync(join(n, 'build/modules.json'), 'utf8')).not_product, N.NOT_PRODUCT);   // the shims are not product files (DRYRUN §4.28)
  assert.ok(N.NOT_PRODUCT.includes('.claude/') && N.NOT_PRODUCT.includes('.github/') && N.NOT_PRODUCT.includes('CLAUDE.md'));
  // the owner's words written: intake done; a module and its requirements: architecture and requirements done; nothing overwritten on a second run
  writeFileSync(join(n, 'requirements/README.md'), '# Idea\n\n## Vision\n\nA place to meet.\n\n## Audiences\n\nNeighbours.\n\n## Initial requirements\n\n1. A list of meetings.\n');
  writeFileSync(join(n, 'build/modules.json'), JSON.stringify({ modules: [{ id: 'meetings', layer: 1, paths: ['meetings/'], tests: ['meetings/test/'], uses: [] }] }));
  writeFileSync(join(n, 'build/layers.md'), '# The layers\n\n| layer | name | contract | modules |\n| --- | --- | --- | --- |\n| 1 | Core | x | meetings |\n');
  mkdirSync(join(n, 'build/requirements')); writeFileSync(join(n, 'build/requirements/meetings.md'), '# meetings\n');
  const again = N.init({ product: n, mode: 'new', name: 'Idea', repo: 'o/proc', ref: 'main' });
  assert.ok(again.kept.includes('requirements/README.md') && !again.written.includes('build/modules.json'));
  assert.deepEqual([st(again.check).intake, st(again.check).architecture, st(again.check).requirements], ['DONE', 'DONE', 'DONE']);
  // the check reads the process branch the project follows from its own CLAUDE.md, whatever branch this checkout is on
  const ck = N.initCheck(N.repo(n), { repo: 'o/proc' }); assert.equal(st(ck).seed, 'DONE', JSON.stringify(ck[1]));
  // a new project that already holds code is refused: it is converted instead
  assert.throws(() => N.init({ product: mk({ 'app/main.py': 'print(1)\n' }), mode: 'new', repo: 'o/proc', ref: 'main' }), /--mode convert/);
  // an existing project: surveyed, one legacy module per code directory, its old CLAUDE.md kept, its files never overwritten
  const c = mk({ 'CLAUDE.md': '# Old rules\n', 'api/server.js': 'x\n', 'api/test/server.test.js': 'x\n', 'web/app.tsx': 'x\n', 'docs/intro.md': 'x\n', 'tool.py': 'x\n', 'package.json': '{}\n', '.github/workflows/ci.yml': 'x\n' });
  const cv = N.init({ product: c, mode: 'convert', repo: 'o/proc', ref: 'main' });
  assert.deepEqual(JSON.parse(readFileSync(join(c, 'build/modules.json'), 'utf8')).modules.map((m) => [m.id, m.legacy, m.paths[0]]), [['api', true, 'api/'], ['web', true, 'web/']]);
  assert.equal(readFileSync(join(c, 'build/onboarding/CLAUDE-before.md'), 'utf8'), '# Old rules\n');
  const sv = readFileSync(join(c, 'build/onboarding/survey.md'), 'utf8');
  assert.match(sv, /`package\.json`/); assert.match(sv, /`api\/test\/`/); assert.match(sv, /`\.github\/workflows\/ci\.yml`/); assert.match(sv, /owned by no module yet[^\n]*`tool\.py`/);
  assert.equal(st(cv.check).architecture, 'DONE'); assert.equal(st(cv.check).requirements, 'DONE');   // a legacy module carries none until it is extracted
  assert.throws(() => N.init({ product: c, mode: 'x' }), /--mode new \| convert/);
  // the onboarding session's start refuses the process repository itself
  assert.throws(() => N.onboardStart({ product: N.PROCESS, session: L1 }), /not the process repository/);
  assert.match(N.reading({ role: 'onboard' }).next, /proc onboard start --product/);
});

test('issue 84: a job takes in its own module\'s branch from an earlier round, and nothing else', async () => {
  const w = world(), R = w.bob.root, src = 'toy/alpha/src/index.mjs';
  // the earlier round's branches, as a process before the carry left them: alpha's (two commits) and beta's
  g(R, 'checkout', '-q', '-b', 'old', `origin/${N.TRANCHE}`);
  writeFileSync(join(R, src), `${readFileSync(join(R, src), 'utf8')}\n// from the earlier round\n`); g(R, 'commit', '-qam', 'alpha: earlier round');
  writeFileSync(join(R, 'toy/alpha/NOTE.md'), 'earlier\n'); g(R, 'add', '.'); g(R, 'commit', '-qm', 'alpha: earlier round, 2');
  g(R, 'push', '-q', 'origin', 'HEAD:refs/heads/job/T0/alpha');
  const oldTip = g(R, 'rev-parse', 'HEAD');
  g(R, 'checkout', '-q', '-b', 'oldb', `origin/${N.TRANCHE}`); writeFileSync(join(R, 'toy/beta/NOTE.md'), 'b\n'); g(R, 'add', '.'); g(R, 'commit', '-qm', 'beta'); g(R, 'push', '-q', 'origin', 'HEAD:refs/heads/job/T0/beta');
  g(R, 'push', '-q', 'origin', `origin/${N.TRANCHE}:refs/heads/job/alpha`);
  const a = w.clone('alpha'); g(a.root, 'checkout', '-q', '-b', 'job/alpha', '--track', 'origin/job/alpha');
  const t = (x) => N.jobTakein({ product: a.dir, ...x });
  assert.throws(() => t({ branch: 'job/T0/alpha' }), /after `proc job start`/);   // no role recorded
  writeFileSync(join(a.root, '.git', N.ROLE_FILE), JSON.stringify({ role: 'job', module: 'alpha', session: J1, name: 'ALPHA #1' }));
  assert.throws(() => t({ branch: 'job/T0/beta' }), /only its own module's branch/);
  assert.throws(() => t({ branch: 'job/alpha' }), /only its own module's branch/);
  assert.throws(() => t({ branch: 'job/T9/alpha' }), /not on the product's remote/);
  assert.throws(() => t({ branch: 'job/T0/alpha', sha: 'deadbeef' }), /not deadbeef: the plan's entry names another commit/);
  writeFileSync(join(a.root, src), 'dirty\n');
  assert.throws(() => t({ branch: 'job/T0/alpha' }), /commit your module's changes first/);
  g(a.root, 'checkout', '-q', '--', src);
  const r = t({ branch: 'job/T0/alpha', sha: oldTip.slice(0, 8) });
  assert.deepEqual([r.merged, r.tip], [true, oldTip.slice(0, 8)]);
  g(a.root, 'fetch', '-q', 'origin');
  assert.equal(g(a.root, 'rev-parse', 'origin/job/alpha'), g(a.root, 'rev-parse', 'HEAD'));   // pushed
  assert.equal(g(a.root, 'rev-list', '--parents', '-n1', 'HEAD').split(' ').length, 3);   // a merge, never a copy: the history keeps it
  assert.match(g(a.root, 'log', '-1', '--format=%s'), /^alpha: job\/T0\/alpha \([0-9a-f]{8}\) taken in from an earlier round/);
  assert.equal(t({ branch: 'job/T0/alpha' }).already, true);
  // a conflict is left to the job: its line and the earlier round's differ
  g(R, 'checkout', '-q', 'old'); writeFileSync(join(R, 'toy/alpha/NOTE.md'), 'theirs\n'); g(R, 'commit', '-qam', 'alpha: later'); g(R, 'push', '-q', 'origin', 'HEAD:refs/heads/job/T1/alpha');
  writeFileSync(join(a.root, 'toy/alpha/NOTE.md'), 'ours\n'); g(a.root, 'commit', '-qam', 'alpha: ours');
  const c = t({ branch: 'job/T1/alpha' });
  assert.deepEqual([c.merged, c.conflicts], [false, ['toy/alpha/NOTE.md']]);
  assert.match(c.next, /resolve each file[\s\S]*git push origin HEAD:job\/alpha/);
  // the hook's refusal of a hand merge names the command to a job, and only to a job
  const { preReason } = await import('../hooks.mjs');
  const merge = { tool_name: 'Bash', tool_input: { command: 'git merge --no-ff origin/job/T53/money' } };
  assert.match(preReason('job', merge, { module: 'money', root: a.root }), /merged only by the queue[\s\S]*proc job takein --branch job\/<tranche>\/<module>/);
  assert.doesNotMatch(preReason('bob', merge, { root: R }), /takein/);
  assert.equal(preReason('job', { tool_name: 'Bash', tool_input: { command: 'node /home/user/neoprocess/tools/proc.mjs job takein --branch job/T53/money --sha 996730f4' } }, { module: 'money', root: a.root }), null);
});

test('issue 90: a retiring BOB keeps its session until its workers have finished, and ROOT archives it only then', async () => {
  const w = world(), o = (x) => O(w, x), root = w.bob.root;
  const { preReason, stopReason } = await import('../hooks.mjs');
  N.epochOpen(o()); N.takeover(o({ name: 'BOB #1', session: B1 }));
  const workers = (running) => writeFileSync(join(root, '.git', N.WORKERS_FILE), JSON.stringify({ session: B1, at: new Date().toISOString(), running }));
  assert.throws(() => N.bobRelease(o()), /is not retiring: `proc handoff` records/);
  const h = N.handoff(o());
  assert.match(h.then, /`proc bob release`/);
  const plan = () => N.parsePlan(N.stateRead(N.repo(w.bob.dir), 'plan.md'));
  assert.deepEqual(plan().retiring, [{ name: 'BOB #1', session: B1, state: 'running' }]);
  N.handoff(o());   // a second handoff of the same BOB records it once
  assert.equal(plan().retiring.length, 1);
  // ROOT: the archive is refused while BOB #1 is retiring; its own session's role file in another clone
  const r = w.clone('root'); writeFileSync(join(r.root, '.git', N.ROLE_FILE), JSON.stringify({ role: 'root', product: 'toy', session: 'session_01RRRRRRRRRRRRRRRRRRRRRRRR', name: 'ROOT' }));
  const archive = { tool_name: 'mcp__claude-code-remote__archive_session', tool_input: { session_id: B1 } };
  assert.match(preReason('root', archive, { root: r.root, product: 'toy' }), /BOB #1 is retiring and may still be finishing its workers: archive it once it sends "RELEASED BOB #1"/);
  // BOB #1: nothing recorded yet, then a worker running, then none
  assert.throws(() => N.bobRelease(o()), /not recorded yet: end this turn/);
  workers([{ id: 'a1', type: 'subagent', description: 'summary of money' }]);
  assert.throws(() => N.bobRelease(o()), /1 of your workers still run \(summary of money\)/);
  assert.doesNotMatch(stopReason('bob', { ...N.readRole(root), root }) || '', /you are retiring/);   // its turn may end while they run
  workers([]);
  assert.match(stopReason('bob', { ...N.readRole(root), root }) || '', /you are retiring and none of your workers runs: .*`proc bob release`/);
  // the successor takes over meanwhile: ROOT archives BOB #1 once released, and nothing out under it is re-dispatched
  const b2 = w.clone('bob2'), t2 = N.takeover({ product: b2.dir, name: 'BOB #2', session: B2 });   // its own container
  assert.match(t2.acts[0], /^ROOT archives BOB #1 \S+ once it is released/);
  const rl = N.bobRelease(o());
  assert.match(rl.next, /"RELEASED BOB #1"/);
  assert.deepEqual(plan().retiring, [{ name: 'BOB #1', session: B1, state: 'released' }]);
  assert.equal(plan().bob.name, 'BOB #2');
  assert.equal(preReason('root', archive, { root: r.root, product: 'toy' }), null);
  // issue 104 (Bob, 30 Oct): the new BOB reports its takeover to ROOT by message, owed by its Stop hook; ROOT archives the
  // old one only once it is released AND the takeover is on the record
  assert.match(t2.tell.message, /^TOOK OVER BOB #2 from BOB #1 \(session_\w+\); archive it once it has sent RELEASED BOB #1$/);
  assert.match(stopReason('bob', { ...N.readRole(b2.root), root: b2.root }) || '', /your takeover is not reported to ROOT: send_message/);
  writeFileSync(join(b2.root, '.git', N.TOOKOVER_FILE), JSON.stringify({ session: B2, message: t2.tell.message, sent: 'x' }));
  assert.doesNotMatch(stopReason('bob', { ...N.readRole(b2.root), root: b2.root }) || '', /not reported to ROOT/);
  const R0 = N.repo(w.bob.dir);
  N.planEdit(R0, (p) => ({ ...p, bob: { name: 'BOB #1', session: B1 } }), 'test: no takeover yet');
  assert.match(preReason('root', archive, { root: r.root, product: 'toy' }), /BOB #1 is released, but no successor has taken over on the record: archive it once the new BOB has sent "TOOK OVER BOB #<n>"/);
  N.planEdit(R0, (p) => ({ ...p, bob: { name: 'BOB #2', session: B2 } }), 'test: takeover back');
  assert.equal(preReason('root', archive, { root: r.root, product: 'toy' }), null);
  assert.equal(N.bobRelease(o()).already, true);
  // ROOT releases a retiring BOB only as failed, read from get_session
  writeFileSync(join(root, '.git', N.ROLE_FILE), JSON.stringify({ ...N.readRole(root), session: B2, name: 'BOB #2' }));
  N.handoff(o());
  assert.deepEqual(plan().retiring.map((x) => [x.name, x.state]), [['BOB #2', 'running']]);   // a released one is dropped at the next handoff
  assert.throws(() => N.bobRelease({ product: r.dir, session: B2 }), /--failed/);
  assert.equal(N.bobRelease({ product: r.dir, session: B2, failed: 'SESSION_STATUS_FAILED' }).released, 'BOB #2');
});

test('issue 93: the gate runs a user\'s tests only when the job changes what its module provides, and only the users of the change (P11)', () => {
  const w = world(), R = N.repo(w.bob.dir), d = w.bob.dir, base = g(w.bob.root, 'rev-parse', 'HEAD');
  const req = join(d, 'build/requirements/alpha.md'), src = join(d, 'alpha/src/index.mjs'), r0 = readFileSync(req, 'utf8'), s0 = readFileSync(src, 'utf8');
  const step = (fn) => { writeFileSync(req, r0); writeFileSync(src, s0); fn(); g(w.bob.root, 'commit', '-qam', 'step', '--allow-empty'); return N.usersOfChange(R, 'alpha', base); };
  assert.deepEqual(step(() => writeFileSync(src, s0.replace('return finite(a, \'add\') + finite(b, \'add\');', 'const x = finite(a, \'add\');\n  return x + finite(b, \'add\');'))), { all: false, changed: [], users: [] });   // the body only
  assert.deepEqual(step(() => writeFileSync(req, r0.replace('**R1** Returns', '**R1** *(not yet met: T1)* Returns'))), { all: false, changed: [], users: [] });   // a mark only
  assert.deepEqual(step(() => writeFileSync(req, `${r0}\n- **R9** Private, not provided.\n`)), { all: false, changed: [], users: [] });   // the Private part
  assert.deepEqual(step(() => writeFileSync(src, `${s0}\nexport function twice(a) { return add(a, a); }\n`)), { all: false, changed: [], users: [] });   // issue 113: a name only added has no user yet
  assert.deepEqual(step(() => writeFileSync(src, s0.replace('export function add(a, b)', 'export function add(a, b = 0)'))), { all: false, changed: ['add'], users: ['beta'] });   // redefined: its old line gone
  assert.deepEqual(step(() => writeFileSync(src, s0.replace('export function sum(list)', 'function sum(list)'))), { all: false, changed: ['sum'], users: ['beta', 'stats'] });   // dropped
  assert.deepEqual(step(() => writeFileSync(req, r0.replace('## Private', '**neg(a) → number**\n- **R9** Returns `-a`.\n\n## Private'))), { all: false, changed: [], users: [] });   // a new Provides block: nobody uses it yet
  assert.deepEqual(step(() => writeFileSync(req, r0.replace(/\*\*sum\(list\) → number\*\*[\s\S]*?(?=## Private)/, ''))), { all: false, changed: ['sum'], users: ['beta', 'stats'] });   // a block dropped
  assert.deepEqual(step(() => writeFileSync(req, r0.replace('and `0` for an empty list', 'and `0` for an empty array'))), { all: false, changed: ['sum'], users: ['beta', 'stats'] });
  assert.deepEqual(step(() => writeFileSync(req, r0.replace('Returns `a + b` for two finite numbers.', 'Returns `a + b` for two finite numbers, as a number.'))), { all: false, changed: ['add'], users: ['beta'] });   // stats names sum only
  assert.deepEqual(step(() => writeFileSync(req, r0.replace('Arithmetic on numbers.', 'Arithmetic on finite numbers.'))).users, ['beta', 'stats']);   // the Purpose: every user
  assert.equal(step(() => writeFileSync(src, `${s0}\nexport default add;\n`)).all, true);
});

test('K2 (N2 layer 1, 30 Oct): an extraction\'s diff touches the legacy modules its module names in `from`; the gate reads the one module (REQ 9, P8)', () => {
  const w = world(), R = N.repo(w.bob.dir), d = w.bob.dir, root = w.bob.root, base = g(root, 'rev-parse', 'HEAD');
  const step = (files) => { g(root, 'checkout', '-q', base); for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), t); } g(root, 'add', '-A'); g(root, 'commit', '-qm', 'step'); return N.moduleOfDiff(R, base); };
  assert.equal(step({ 'stats/src/k2.mjs': 'export const k2 = 1;\n', 'legacy/k2.mjs': '// moved out\n', 'catalog/k2.md': 'moved out\n' }), 'stats');   // the extraction and both its sources: one module
  assert.equal(step({ 'legacy/k2.mjs': '// a change in the legacy module alone\n' }), 'legacy');
  assert.throws(() => step({ 'stats/src/k2.mjs': 'x', 'alpha/src/k2.mjs': 'y' }), /several modules: alpha, stats/);
  assert.throws(() => step({ 'alpha/src/k2.mjs': 'y', 'legacy/k2.mjs': 'z' }), /several modules: alpha, legacy/);   // alpha names no legacy source
});
