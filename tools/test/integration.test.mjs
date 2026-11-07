// tools/integration.mjs at its interface, against a real remote: a bare origin seeded with the dry run's toy product on
// the fixed `tranche` branch, one clone as the architecture session. The job lines are written on the state branch as
// jobs' commands leave them, through jobs' own job-line writer (K24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as I from '../integration.mjs';
import { repo, epochOpen, stateWrite, stateRead, fmtPlan, parsePlan, commitPush, TRANCHE } from '../record.mjs';
import { constraints } from '../platform.mjs';
import { trancheClose, trancheMerged } from '../planning.mjs';
import { regenerate } from '../gate.mjs';
import { parseJob, fmtJob, jobRetire, wire } from '../jobs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), TOY = join(HERE, '..', '..', 'dryrun');
const B1 = 'session_01BBBBBBBBBBBBBBBBBBBBBBBB', J1 = 'session_01AAAAAAAAAAAAAAAAAAAAAAAA', J2 = 'session_01AAAAAAAAAAAAAAAAAAAAAAA2';
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ident = (d, n) => { for (const [k, v] of [['user.name', n], ['user.email', `${n}@t`], ['commit.gpgsign', 'false']]) g(d, 'config', k, v); };
const f = (dir, name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

// Every output a test takes from integration, so R6 and R7 are checked over all of them.
const seen = [], owedSeen = [];
const out = (x) => { seen.push(x); return x; };
// Every version of the plan's owed acts on a world's state branch, read from its history.
const owedHistory = (w) => { for (const c of w.g2('log', '--format=%H', 'origin/state/E1', '--', 'plan.md').split('\n').filter(Boolean)) owedSeen.push(parsePlan(w.g2('show', `${c}:plan.md`)).owed); };

const PLAN = '# Plan: test T1\n\n**Status** · OPEN · round R1.\n\n## Layer 1\n\n**alpha**\n- N1 · Add `twice(a)` (R6).\n\n**beta**\n- N2 · A comment on total. *(after alpha)*\n\n## Layer 2\n\n**stats**\n- N3 · Nothing yet.\n';
function world() {
  const base = mkdtempSync(join(tmpdir(), 'integration-'));
  const origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const seed = join(base, 'seed');
  execFileSync('git', ['clone', '-q', origin, seed], { stdio: 'ignore' }); ident(seed, 'seed');
  cpSync(TOY, join(seed, 'toy'), { recursive: true });
  g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'seed'); g(seed, 'branch', '-M', 'main'); g(seed, 'push', '-q', 'origin', 'main');
  g(seed, 'push', '-q', 'origin', `main:refs/heads/${TRANCHE}`);
  const clone = (name, branch = TRANCHE) => { const d = join(base, name); execFileSync('git', ['clone', '-q', '-b', branch, origin, d], { stdio: 'ignore' }); ident(d, name); return { dir: join(d, 'toy'), root: d }; };
  const bob = clone('bob'), R = repo(bob.dir);
  writeFileSync(join(bob.dir, 'build/plan/current.md'), PLAN);
  commitPush(R, TRANCHE, ['build/plan/current.md'], 'plan T1');
  epochOpen({ product: bob.dir });
  stateWrite(R, { 'plan.md': fmtPlan({ state: 'OPEN', bob: { name: 'BOB #1', session: B1 }, owed: [], layers: { 1: 'STARTED' } }) }, 'BOB #1 takes over');
  const o = (x = {}) => ({ product: bob.dir, ...x });
  return { base, origin, bob, R, clone, o, g2: (...a) => g(bob.root, ...a) };
}
// A job as jobs' commands leave it at COMPLETE: its branch one commit past the tranche with the change, its START and
// report on the state branch, its line COMPLETE with nothing owed.
function complete(w, m, { name, session, pr, change, report = '**Met** · R1\n**Evidence**\n- `node --test` → tests 3, pass 3\n', after = [], runs = 1, reviews = 0 }) {
  const c = w.clone(`${m}-${Math.random().toString(36).slice(2, 7)}`);
  g(c.root, 'checkout', '-q', '-b', `job/${m}`);
  change(c.dir);
  g(c.root, 'add', '-A'); g(c.root, 'commit', '-q', '-m', `${m}: the change`); g(c.root, 'push', '-q', '-f', 'origin', `HEAD:refs/heads/job/${m}`);
  stateWrite(w.R, { [`jobs/${m}.md`]: fmtJob(m, { name, session, state: 'COMPLETE', pr, runs, owed: [], after, model: 'opus', reviews }), [`jobs/${m}/start.md`]: `START ${name} · T1 · layer 1 · module ${m}\nEntries:\n- N1 · x\n`, [`jobs/${m}/report.md`]: report }, `${m}: COMPLETE`);
  return c;
}
const append = (p, text) => (dir) => writeFileSync(join(dir, p), `${readFileSync(join(dir, p), 'utf8')}${text}`);
const line = (w, m) => parseJob(stateRead(w.R, `jobs/${m}.md`));
// GitHub's update of a job's branch: the tranche merged in; the tip the gate then runs on.
const ghUpdate = (w, m) => { const c = w.clone(`up-${m}-${Math.random().toString(36).slice(2, 7)}`, `job/${m}`); g(c.root, 'merge', '-q', '--no-edit', 'origin/tranche'); g(c.root, 'push', '-q', 'origin', `HEAD:job/${m}`); w.g2('fetch', '-q', 'origin'); return g(c.root, 'rev-parse', 'HEAD'); };
// GitHub's merge of a job's pull request into the tranche, as the printed call makes it.
const ghMerge = (w, m, pr) => { w.g2('fetch', '-q', 'origin'); w.g2('merge', '-q', '--ff-only', 'origin/tranche'); w.g2('merge', '-q', '--no-ff', '-m', `${m} T1 (#${pr})`, `origin/job/${m}`); w.g2('push', '-q', 'origin', 'HEAD:tranche'); return w.g2('rev-parse', 'HEAD'); };

test('R1 the review: decided by judgment from the listed reasons and written; a fresh worker reads only the requirements, the diff and the report; gaps with file and line, posted, and sent as a CHANGE; one independent review, then the fixes verified (K15)', () => {
  const w = world(), o = w.o;
  complete(w, 'alpha', { name: 'ALPHA #1', session: J1, pr: 11, change: append('alpha/src/index.mjs', '\nexport function twice(a) { return add(a, a); }\n'), report: '**Met** · R6\n**Evidence**\n', runs: 3 });
  assert.throws(() => I.reviewDecide(o({ module: 'alpha', reason: 'x' })), /--review \| --no-review \| --verified/);
  assert.throws(() => I.reviewDecide(o({ module: 'alpha', review: true, noReview: true, reason: 'x' })), /--review \| --no-review/);
  // the reasons are found in the change and written with the decision
  const rv = out(I.reviewDecide(o({ module: 'alpha', review: true, reason: 'a provided service changed' })));
  assert.deepEqual(rv.concerns, ['provided service changed (1 export line(s) differ)', 'thin evidence (0 item(s) for 1 entries)', 'third completion (completion 3)']);
  assert.match(line(w, 'alpha').review, /^review · a provided service changed · concerns: provided service changed .*; thin evidence .*; third completion .* · working since /);
  assert.throws(() => I.reviewDecide(o({ module: 'alpha', noReview: true, reason: 'x' })), /is decided/);
  // the worker: fresh, in the background, reading the three things only, with the measurement rule; Opus for a changed service
  assert.deepEqual([rv.agent.run_in_background, rv.agent.model, rv.agent.effort], [true, 'claude-opus-5-5', 'high']);
  assert.match(rv.agent.prompt, /^Read whole, and nothing else: toy\/build\/requirements\/alpha\.md \(the requirements\); the diff, by `git -C \S+ diff origin\/tranche\.\.\.origin\/job\/alpha`; the job's report, by `git -C \S+ show origin\/state\/E1:jobs\/alpha\/report\.md`\.$/m);
  assert.ok(rv.agent.prompt.includes(I.MEASUREMENT_RULE) && /a measurement not yet taken is not a gap/.test(I.MEASUREMENT_RULE));
  assert.match(rv.agent.prompt, /each with the requirement id, file:line/);
  assert.ok(Buffer.byteLength(rv.agent.prompt) <= I.LIMIT);
  assert.equal(stateRead(w.R, 'jobs/alpha/review-brief.md'), rv.agent.prompt.trim());
  // the verdict: a gap names its file and line; posted on the pull request; the gaps reach the job as a CHANGE
  assert.throws(() => I.reviewResult(o({ module: 'alpha', resultFile: f(w.base, 'r0.md', 'VERDICT · gaps\n- R6 · twice is wrong · run it\nDONE review-alpha · verdict\n') })), /names its file and line/);
  assert.throws(() => I.reviewResult(o({ module: 'alpha', resultFile: f(w.base, 'r1.md', 'VERDICT · gaps\n- R6 · alpha/src/index.mjs:9 · x · y\n') })), /DONE line/);
  const rr = out(I.reviewResult(o({ module: 'alpha', resultFile: f(w.base, 'r2.md', 'VERDICT · gaps\n- R6 · alpha/src/index.mjs:9 · twice(-0) is 0 · node -e\nDONE review-alpha · verdict\n') })));
  assert.deepEqual([rr.verdict, rr.post.tool, rr.post.event, rr.post.pullNumber], ['gaps', 'pull_request_review_write', 'COMMENT', 11]);
  assert.match(rr.post.body, /^CHANGES REQUESTED by the review \(a provided service changed\)\n\nVERDICT · gaps/);
  assert.equal(rr.send.session_id, J1); assert.match(rr.send.message, /^CHANGE: the review found 1 gap[\s\S]*one independent review \(K15\)[\s\S]*\n- R6 · alpha\/src\/index\.mjs:9/);
  assert.match(line(w, 'alpha').review, / · gaps: 1 · \d{4}-\d\d-\d\d$/);
  assert.throws(() => I.merge(o({ module: 'alpha', head: 'abcdef1', gate: 'success' })), /not approved/);
  // the job fixes the gap and completes again (jobs' completion clears the decision and keeps the count): no second review
  const c = complete(w, 'alpha', { name: 'ALPHA #1', session: J1, pr: 11, change: append('alpha/src/index.mjs', '\nexport function twice(a) { return Object.is(a, -0) ? -0 : add(a, a); }\n'), reviews: 1 });
  const fix = g(c.root, 'rev-parse', 'HEAD');
  assert.throws(() => I.reviewDecide(o({ module: 'alpha', review: true, reason: 'again' })), /has had its one independent review \(K15\)/);
  assert.throws(() => I.reviewDecide(o({ module: 'alpha', verified: true, commits: w.g2('rev-parse', 'HEAD'), reason: 'x' })), /not commits of job\/alpha beyond tranche/);
  const vd = out(I.reviewDecide(o({ module: 'alpha', verified: true, commits: fix.slice(0, 9), reason: 'the -0 case is fixed and tested' })));
  assert.equal(vd.gaps, 1); assert.match(line(w, 'alpha').review, new RegExp(`^verified · ${fix.slice(0, 7)} against 1 gap\\(s\\) · the -0 case is fixed and tested · concerns: `));
  // a job with no review behind it has nothing to verify; an approved review is the other way to merge
  complete(w, 'beta', { name: 'BETA #1', session: J2, pr: 12, change: append('beta/src/index.mjs', '// R1\n') });
  assert.throws(() => I.reviewDecide(o({ module: 'beta', verified: true, commits: 'abcdef1', reason: 'x' })), /no review with gaps to verify against/);
  out(I.reviewDecide(o({ module: 'beta', review: true, reason: 'first user of alpha' })));
  const ra = out(I.reviewResult(o({ module: 'beta', resultFile: f(w.base, 'r3.md', 'VERDICT · approve\nDONE review-beta · verdict\n') })));
  assert.equal(ra.send, undefined); assert.match(ra.post.body, /^APPROVED by the review/);
  assert.match(line(w, 'beta').review, / · approved · /);
  // a decision with no reason found is still written, naming none
  complete(w, 'stats', { name: 'STATS #1', session: J2, pr: 13, change: append('stats/src/index.mjs', '// N3\n'), report: '**Met** · none\n**Evidence**\n- stats/src/index.mjs:1\n' });
  assert.deepEqual(out(I.reviewDecide(o({ module: 'stats', noReview: true, reason: 'a comment' }))).concerns, []);
  assert.equal(line(w, 'stats').review, 'no review · a comment · concerns: none');
});

test('R2 the merge: only a green, current, COMPLETE, decided tip in the plan\'s order, by the printed call; behind only by records it merges over them, else it is updated first; recorded from GitHub\'s result', () => {
  const w = world(), o = w.o;
  const a = complete(w, 'alpha', { name: 'ALPHA #1', session: J1, pr: 11, change: append('alpha/src/index.mjs', '// R1\n') });
  const b = complete(w, 'beta', { name: 'BETA #1', session: J2, pr: 12, change: append('beta/src/index.mjs', '// R1\n'), after: ['alpha'] });
  stateWrite(w.R, { 'jobs/beta.md': fmtJob('beta', { ...line(w, 'beta'), owed: ['ready after alpha'] }) }, 'beta waits');
  const ha = g(a.root, 'rev-parse', 'HEAD');
  assert.throws(() => I.merge(o({ module: 'alpha', head: ha, gate: 'success' })), /decide the review first/);
  out(I.reviewDecide(o({ module: 'alpha', noReview: true, reason: 'a comment' })));
  assert.throws(() => I.merge(o({ module: 'alpha' })), /--head <sha the check ran on> --gate/);
  assert.throws(() => I.merge(o({ module: 'alpha', head: 'deadbeef', gate: 'success' })), /older commit/);
  assert.throws(() => I.merge(o({ module: 'alpha', head: ha, gate: 'failure' })), /nothing merges red/);
  assert.throws(() => I.merged(o({ module: 'alpha', sha: w.g2('rev-parse', 'HEAD') })), /is not merging/);
  // beta: owes its ready (a draft until alpha merges), and merges after alpha
  stateWrite(w.R, { 'jobs/beta.md': fmtJob('beta', { ...line(w, 'beta'), owed: [], review: 'no review · x · concerns: none' }) }, 'beta ready');
  assert.throws(() => I.merge(o({ module: 'beta', head: g(b.root, 'rev-parse', 'HEAD'), gate: 'success' })), /merges after alpha \(the plan's order\)/);
  stateWrite(w.R, { 'jobs/beta.md': fmtJob('beta', { ...line(w, 'beta'), owed: ['ready after alpha'] }) }, 'beta waits');
  // the tranche moved by a record the gate does not read for alpha: the green tip merges over it
  w.g2('pull', '-q', 'origin', 'tranche');
  writeFileSync(join(w.bob.dir, 'build/plan/notes-T2.md'), '# T2, prepared ahead\n'); commitPush(w.R, TRANCHE, ['build/plan/notes-T2.md'], 'prepared ahead (P18)');
  const mg = out(I.merge(o({ module: 'alpha', head: ha, gate: 'success' })));
  assert.deepEqual([mg.merge.tool, mg.merge.pullNumber, mg.merge.merge_method, mg.over], ['merge_pull_request', 11, 'merge', ['build/plan/notes-T2.md']]);
  assert.deepEqual(parsePlan(stateRead(w.R, 'plan.md')).owed, ['merge alpha']);
  assert.throws(() => I.merge(o({ module: 'alpha', head: ha, gate: 'success' })), /already merging/);
  // recorded from GitHub's result: a commit on the tranche that holds the job's tip, never a report's word
  assert.throws(() => I.merged(o({ module: 'alpha', sha: 'abc' })), /--sha <merge commit>/);
  assert.throws(() => I.merged(o({ module: 'alpha', sha: w.g2('rev-parse', 'HEAD') })), /tip [0-9a-f]{7} is not in/);
  assert.throws(() => I.merged(o({ module: 'alpha', sha: ha })), /is not on tranche/);
  const sha = ghMerge(w, 'alpha', 11);
  const md = out(I.merged(o({ module: 'alpha', sha })));
  assert.equal(line(w, 'alpha').state, 'MERGED'); assert.match(line(w, 'alpha').merges[0], /^[0-9a-f]{7} \d{4}-\d\d-\d\d reviews:0$/);
  assert.deepEqual(md.prune, { ref: 'job/alpha', deleted: true });
  assert.equal(md.send.session_id, J1); assert.match(md.send.message, /^MERGED: alpha is on tranche at [0-9a-f]{7} \(PR #11\)/);
  assert.deepEqual(md.ready.map((r) => [r.module, r.mark.tool, r.mark.pullNumber, r.mark.draft]), [['beta', 'update_pull_request', 12, false]]);
  assert.deepEqual(parsePlan(stateRead(w.R, 'plan.md')).owed, []);
  // beta, now behind the tranche by alpha's code: the gate must run again, so the branch is updated first
  stateWrite(w.R, { 'jobs/beta.md': fmtJob('beta', { ...line(w, 'beta'), owed: [] }) }, 'beta ready');
  const up = out(I.merge(o({ module: 'beta', head: g(b.root, 'rev-parse', 'HEAD'), gate: 'success' })));
  assert.deepEqual([up.update.tool, up.update.pullNumber, up.merge], ['update_pull_request_branch', 12, undefined]);
  assert.deepEqual(up.held, [{ file: 'alpha/src/index.mjs', why: "a module's code or tests" }]);
  assert.match(line(w, 'beta').merge, /^updating /);
  // nothing in a merge or its record depends on archiving a session (INT-6): the job's session is still named on its line
  assert.equal(line(w, 'alpha').session, J1);
  owedHistory(w);
});

test('R3 the layer\'s close: every pull request merged, the layer\'s tests once over the merged layer (a red back to its module\'s job as a CHANGE), the artifacts once, the checks whole, the stale constraint rows listed, the next layer\'s start printed', () => {
  const w = world(), o = w.o;
  const a = complete(w, 'alpha', { name: 'ALPHA #1', session: J1, pr: 11, change: append('alpha/src/index.mjs', '// R1\n') });
  complete(w, 'beta', { name: 'BETA #1', session: J2, pr: 12, change: append('beta/src/index.mjs', '// R1\n') });
  assert.throws(() => I.layerClose(o({})), /--layer <n>/);
  assert.throws(() => I.layerClose(o({ layer: 2 })), /layer 2 is not started/);
  assert.throws(() => I.layerClose(o({ layer: 1 })), /layer 1: alpha COMPLETE; beta COMPLETE/);
  for (const [m, pr] of [['alpha', 11], ['beta', 12]]) {
    out(I.reviewDecide(o({ module: m, noReview: true, reason: 'a comment' })));
    out(I.merge(o({ module: m, head: ghUpdate(w, m), gate: 'success' })));
    out(I.merged(o({ module: m, sha: ghMerge(w, m, pr) })));
  }
  void a;
  // the manifest names layer 1's tests; one fails for alpha over the merged layer: the layer stays open, the CHANGE named
  mkdirSync(join(w.bob.dir, 'alpha/test/layer'), { recursive: true });
  writeFileSync(join(w.bob.dir, 'alpha/test/layer/l1.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../../src/index.mjs';\ntest('alpha and beta agree on a total', () => { assert.equal(sum([1, 2]), 4); });\n");
  writeFileSync(join(w.bob.dir, 'build/manifest.md'), `${readFileSync(join(w.bob.dir, 'build/manifest.md'), 'utf8')}\nLayer 1 tests: \`alpha/test/layer/*.test.mjs\`\n`);
  commitPush(w.R, TRANCHE, ['alpha/test/layer/l1.test.mjs', 'build/manifest.md'], 'layer 1 tests');
  assert.deepEqual(I.layerTests(w.R, 1), ['alpha/test/layer/*.test.mjs']); assert.deepEqual(I.layerTests(w.R, 2), []);
  let refusal = ''; try { I.layerClose(o({ layer: 1 })); } catch (e) { refusal = e.message; }
  assert.match(refusal, /^layer 1's tests: 1 red over the merged layer \(alpha\); the layer stays open/);
  const changes = JSON.parse(refusal.slice(refusal.indexOf('\n') + 1));
  assert.deepEqual(changes.map((c) => [c.module, c.session]), [['alpha', J1]]);
  assert.match(changes[0].message, /^CHANGE: layer 1's tests fail at the close for alpha; fix them, then complete again:\n- alpha and beta agree on a total$/);
  assert.match(changes[0].then, /^proc job reopen --module alpha --change-file/);
  assert.equal(line(w, 'alpha').state, 'MERGED');   // the jobs stay live until the close
  // a job retired before the close (jobs' early retirement) cannot be re-opened: its CHANGE starts a new job instead
  const merged = line(w, 'alpha');
  stateWrite(w.R, { 'jobs/alpha.md': fmtJob('alpha', { ...merged, state: 'ARCHIVED' }) }, 'alpha retired early');
  let r2 = ''; try { I.layerClose(o({ layer: 1 })); } catch (e) { r2 = e.message; }
  assert.match(JSON.parse(r2.slice(r2.indexOf('\n') + 1))[0].then, /^alpha's job is retired: start a new one on this CHANGE \(proc layer start --layer 1 --modules alpha\)$/);
  stateWrite(w.R, { 'jobs/alpha.md': fmtJob('alpha', merged) }, 'alpha merged again (the fixture)');
  // the fix is merged: the layer closes; the stale rows of platform's table listed; each job retired on the record
  writeFileSync(join(w.bob.dir, 'alpha/test/layer/l1.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../../src/index.mjs';\ntest('alpha and beta agree on a total', () => { assert.equal(sum([1, 2]), 3); });\n");
  commitPush(w.R, TRANCHE, ['alpha/test/layer/l1.test.mjs'], 'layer 1 tests fixed');
  // a check finding the tranche did not have when it opened (a file no module owns) refuses the close; removed, it closes
  writeFileSync(join(w.bob.dir, 'stray.mjs'), 'export const x = 1;\n'); commitPush(w.R, TRANCHE, ['stray.mjs'], 'a stray file');
  assert.throws(() => I.layerClose(o({ layer: 1 })), /checks: 1 finding\(s\) new since the tranche opened: architecture: stray\.mjs: owned by no module/);
  w.g2('rm', '-q', 'toy/stray.mjs'); w.g2('commit', '-q', '-m', 'the stray file removed'); w.g2('push', '-q', 'origin', 'HEAD:tranche');
  const lc = out(I.layerClose(o({ layer: 1, olderThan: '2999-01-01' })));
  assert.equal(lc.layer, 1); assert.deepEqual([lc.tests.tests, lc.tests.pass, lc.tests.failed], [1, 1, []]);
  assert.equal(lc.stale.length, constraints().length); assert.ok(lc.stale.every((r) => r.id && r.date));
  assert.deepEqual(lc.retire.map((r) => [r.module, r.session]), [['alpha', J1], ['beta', J2]]);   // each retirement named: jobs' record line (its R7)
  assert.match(lc.retire[0].then, /^proc job retire --module alpha \[--usage '<usage read by a route the platform allows>' \| --unmeasured/);
  assert.deepEqual([line(w, 'alpha').state, line(w, 'beta').state], ['MERGED', 'MERGED']);   // no session archived, nothing owed
  assert.equal(lc.next, 'proc layer start --layer 2');
  assert.deepEqual(parsePlan(stateRead(w.R, 'plan.md')).layers, { 1: 'CLOSED' });
  assert.deepEqual(parsePlan(stateRead(w.R, 'plan.md')).owed, []);
  assert.throws(() => I.layerClose(o({ layer: 1 })), /is CLOSED/);
  // the default reach: rows not confirmed in the last week only
  assert.ok(I.STALE_DAYS > 0);
  owedHistory(w);
});

test('R4 main moves only by the close pull request, at CLOSING: the merge call is printed only then, expecting the tranche\'s tip; a job\'s merge never targets main', () => {
  const w = world(), o = w.o;
  assert.throws(() => I.closeMerge(o({})), /--pr <the close pull request's number>/);
  assert.throws(() => I.closeMerge(o({ pr: 40 })), /reads OPEN, not CLOSING: main moves only by the close pull request/);
  stateWrite(w.R, { 'plan.md': fmtPlan({ ...parsePlan(stateRead(w.R, 'plan.md')), state: 'CLOSING' }) }, 'T1: CLOSING');
  const cm = out(I.closeMerge(o({ pr: 40 })));
  assert.deepEqual([cm.merge.tool, cm.merge.pullNumber, cm.merge.merge_method, cm.merge.expectedHeadSha], ['merge_pull_request', 40, 'merge', w.g2('rev-parse', 'origin/tranche')]);
  assert.match(cm.then, /^proc tranche merged --sha/);
  // a job's merge is of its own pull request into the tranche, never of a pull request into main
  stateWrite(w.R, { 'plan.md': fmtPlan({ ...parsePlan(stateRead(w.R, 'plan.md')), state: 'OPEN' }) }, 'T1: OPEN');
  const a = complete(w, 'alpha', { name: 'ALPHA #1', session: J1, pr: 11, change: append('alpha/src/index.mjs', '// R1\n') });
  out(I.reviewDecide(o({ module: 'alpha', noReview: true, reason: 'a comment' })));
  const main0 = w.g2('rev-parse', 'origin/main');
  const mg = out(I.merge(o({ module: 'alpha', head: g(a.root, 'rev-parse', 'HEAD'), gate: 'success' })));
  assert.equal(mg.merge.pullNumber, 11);
  out(I.merged(o({ module: 'alpha', sha: ghMerge(w, 'alpha', 11) })));
  w.g2('fetch', '-q', 'origin'); assert.equal(w.g2('rev-parse', 'origin/main'), main0);
  owedHistory(w);
});

test('R4 the close and merge commands as they stand: planning\'s tranche close sets CLOSING and prints the one close pull request; only then is its merge printed, expecting the tranche\'s tip; main moves by that merge alone, recorded by tranche merged', async () => {
  const w = world(), o = w.o;
  // the round closed: its plan archived (its entries' jobs all merged, so none left in it here), none running; nothing owed
  w.g2('rm', '-q', 'toy/build/plan/current.md');
  mkdirSync(join(w.bob.dir, 'build/plan/archive'), { recursive: true });
  writeFileSync(join(w.bob.dir, 'build/plan/archive/T1-R1.md'), '# Plan: test T1\n\n**Status** · OPEN · round R1.\n\n## Layer 1\n');
  w.g2('add', 'toy/build/plan/archive/T1-R1.md'); w.g2('commit', '-q', '-m', 'round R1 of T1 archived'); w.g2('push', '-q', 'origin', 'HEAD:tranche');
  const main0 = w.g2('rev-parse', 'origin/main');
  assert.throws(() => I.closeMerge(o({ pr: 40 })), /not CLOSING: main moves only by the close pull request/);
  assert.throws(() => trancheMerged(o({ sha: main0 })), /not CLOSING/);
  // the close (planning R2), with the later modules' parts its caller gives: no ask open, gate's regeneration
  const tc = await trancheClose(o(), { asks: () => [], regenerate });
  assert.equal(tc.tranche, 'T1'); assert.deepEqual([tc.pr.base, tc.pr.head], ['main', 'tranche']);
  assert.equal(parsePlan(stateRead(w.R, 'plan.md')).state, 'CLOSING');
  w.g2('fetch', '-q', 'origin'); assert.equal(w.g2('rev-parse', 'origin/main'), main0);   // the close itself never moves main
  // the close pull request's merge, printed only now, expecting the tranche's tip
  const cm = out(I.closeMerge(o({ pr: 41 })));
  const tip = w.g2('rev-parse', 'origin/tranche');
  assert.deepEqual([cm.merge.tool, cm.merge.pullNumber, cm.merge.expectedHeadSha], ['merge_pull_request', 41, tip]);
  // GitHub's merge of the close pull request; recorded from main, never from a report
  const m = w.clone('main', 'main');
  g(m.root, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #41 from o/tranche', 'origin/tranche'); g(m.root, 'push', '-q', 'origin', 'HEAD:main');
  const sha = g(m.root, 'rev-parse', 'HEAD');
  assert.throws(() => trancheMerged(o({ sha: tip.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) })), /not a commit|is not on main/);
  const tm = trancheMerged(o({ sha }));
  assert.equal(tm.merged, sha.slice(0, 7)); assert.equal(parsePlan(stateRead(w.R, 'plan.md')).state, 'CLOSED');
  assert.throws(() => I.closeMerge(o({ pr: 41 })), /reads CLOSED, not CLOSING/);
  owedHistory(w);
});

test('R5 retirement and a BOB\'s release are record lines; a defect is a metrics row naming the module, the round and whether its merge was reviewed', () => {
  const w = world(), o = w.o;
  complete(w, 'alpha', { name: 'ALPHA #1', session: J1, pr: 11, change: append('alpha/src/index.mjs', '// R1\n') });
  complete(w, 'beta', { name: 'BETA #1', session: J2, pr: 12, change: append('beta/src/index.mjs', '// R1\n') });
  out(I.reviewDecide(o({ module: 'alpha', review: true, reason: 'new' })));
  out(I.reviewResult(o({ module: 'alpha', resultFile: f(w.base, 'ra.md', 'VERDICT · approve\nDONE review-alpha · verdict\n') })));
  w.g2('fetch', '-q', 'origin');
  out(I.merge(o({ module: 'alpha', head: w.g2('rev-parse', 'origin/job/alpha'), gate: 'success' })));
  out(I.merged(o({ module: 'alpha', sha: ghMerge(w, 'alpha', 11) })));
  // the retirement layer close names (jobs' command, its R7): a record line and the attempt's row, no session archived;
  // the open asks are read by the reader its caller wires (the legacy tool's, until messages is extracted)
  wire({ openAsks: () => [] });
  stateWrite(w.R, { 'jobs/beta.md': fmtJob('beta', { ...line(w, 'beta'), state: 'MERGED' }) }, 'beta merged');
  const rt = out(jobRetire(o({ module: 'alpha' })));
  assert.deepEqual([rt.retired, rt.session, rt.measured], ['ALPHA #1', J1, false]);
  assert.equal(line(w, 'alpha').state, 'ARCHIVED'); assert.match(line(w, 'alpha').retired, /session left idle/);
  assert.match(readFileSync(join(w.bob.dir, 'build/metrics/T1.csv'), 'utf8'), new RegExp(`^${J1},job,ALPHA #1,alpha,`, 'm'));
  // a retired job's work is on the tranche: a module the plan orders after it may merge
  assert.deepEqual(I.DONE, ['MERGED', 'ARCHIVED']);
  complete(w, 'beta', { name: 'BETA #1', session: J2, pr: 12, change: append('beta/src/index.mjs', '// R1 again\n'), after: ['alpha'] });
  out(I.reviewDecide(o({ module: 'beta', noReview: true, reason: 'a comment' })));
  assert.equal(out(I.merge(o({ module: 'beta', head: ghUpdate(w, 'beta'), gate: 'success' }))).merge.pullNumber, 12);
  // a BOB's release: a record line in the plan; its session left idle
  const p = parsePlan(stateRead(w.R, 'plan.md'));
  stateWrite(w.R, { 'plan.md': fmtPlan({ ...p, retiring: [{ name: 'BOB #1', session: B1, state: 'running' }] }) }, 'BOB #1 retiring');
  assert.throws(() => I.bobRelease(o({})), /a retiring BOB releases itself/);
  writeFileSync(join(w.bob.root, '.git', 'proc-role.json'), JSON.stringify({ role: 'bob', session: B1, branch: TRANCHE }));
  assert.throws(() => I.bobRelease(o({})), /background tasks are not recorded yet/);
  writeFileSync(join(w.bob.root, '.git', I.WORKERS_FILE), JSON.stringify({ session: B1, running: [{ id: 't1', description: 'a review' }] }));
  assert.throws(() => I.bobRelease(o({})), /1 of your workers still run \(a review\)/);
  writeFileSync(join(w.bob.root, '.git', I.WORKERS_FILE), JSON.stringify({ session: B1, running: [] }));
  const br = out(I.bobRelease(o({})));
  assert.equal(br.released, 'BOB #1'); assert.deepEqual(parsePlan(stateRead(w.R, 'plan.md')).retiring, [{ name: 'BOB #1', session: B1, state: 'released' }]);
  assert.match(br.next, /^send ROOT the line "RELEASED BOB #1"; your session is left idle/);
  assert.deepEqual(out(I.bobRelease(o({}))), { released: 'BOB #1', already: true });
  writeFileSync(join(w.bob.root, '.git', 'proc-role.json'), JSON.stringify({ role: 'root', session: 'session_01ROOT', branch: TRANCHE }));
  stateWrite(w.R, { 'plan.md': fmtPlan({ ...parsePlan(stateRead(w.R, 'plan.md')), retiring: [{ name: 'BOB #2', session: J2, state: 'running' }] }) }, 'BOB #2 retiring');
  assert.throws(() => I.bobRelease(o({ session: J2 })), /--failed/);
  assert.match(out(I.bobRelease(o({ session: J2, failed: 'status: failed' }))).next, /^BOB #2 is released on the record and its session left idle/);
  rmSync(join(w.bob.root, '.git', 'proc-role.json'));
  // a defect: one row naming the module, the round and whether its merge was reviewed
  assert.throws(() => I.defect(o({ module: 'alpha' })), /--what/);
  assert.throws(() => I.defect(o({ module: 'nope', what: 'x' })), /no module nope/);
  const d1 = out(I.defect(o({ module: 'alpha', what: 'twice(NaN), wrong' })));
  assert.deepEqual([d1.reviewed, d1.tranche, d1.round], ['1/1', 'T1', 'R1']);   // from alpha's row its retirement wrote: one merge, reviewed
  const csv = readFileSync(join(w.bob.dir, 'build/metrics/T1.csv'), 'utf8');
  assert.match(csv, /^,defect,ALPHA #1,alpha,,,,,,,1\/1,T1 R1: twice\(NaN\)  wrong$/m);
  // a job's earlier row carries its merge's review count, which the defect takes
  writeFileSync(join(w.bob.dir, 'build/metrics/T1.csv'), `${csv}${J2},job,BETA #1,beta,1,1,1,1,1,9,0/1,\n`);
  commitPush(w.R, TRANCHE, ['build/metrics/T1.csv'], 'beta row');
  assert.equal(out(I.defect(o({ module: 'beta', what: 'total' }))).reviewed, '0/1');
  owedHistory(w);
});

test('R6 nothing here calls archive_session, update_trigger, delete_trigger or interrupt_session, or prints one as owed; R7 every act printed is the architecture session\'s, never asked of Bob', () => {
  // every output the tests above took (the review, the merge and its record, the layer's close, the close merge, the
  // retirement, the releases, the defects): no such act in any call printed, in any step, or owed on the plan
  assert.ok(seen.length >= 30, `${seen.length} outputs`);
  // (platform's stale constraint rows, which a layer's close lists as data, may name such an act: a row is no call)
  const calls = [], steps = [];
  const walk = (x) => { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (k === 'stale') continue; if (k === 'tool' && typeof v === 'string') calls.push(v); else if (['then', 'next', 'message', 'prompt'].includes(k) && typeof v === 'string') steps.push(v); else walk(v); } };
  walk(seen);
  assert.ok(calls.length >= 10 && steps.length >= 10, `${calls.length} calls, ${steps.length} steps`);
  assert.deepEqual([...new Set(calls)].sort(), ['merge_pull_request', 'pull_request_review_write', 'update_pull_request', 'update_pull_request_branch']);
  for (const s of steps) for (const act of I.NEVER) assert.doesNotMatch(s, new RegExp(act), `${act} in: ${s}`);
  // nothing owed on the plan at any point is such an act: every version of the plan on each test's state branch
  assert.ok(owedSeen.length >= 4);
  for (const x of owedSeen.flat()) for (const act of [...I.NEVER, 'archive']) assert.doesNotMatch(x, new RegExp(act), x);
  assert.ok(owedSeen.flat().includes('merge alpha'));
  // R7: no step names Bob as the one to take it
  for (const s of steps) assert.doesNotMatch(s, /\bBob\b/, s);
});
