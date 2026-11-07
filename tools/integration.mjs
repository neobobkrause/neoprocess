// integration (layer 3; build/requirements/integration.md): work counts only when it is merged and proven. The review
// decision and its worker (R1), the merge of a green current tip and its record (R2), the layer's close with its tests
// (R3), the close pull request as the one thing that moves `main` (R4), retirement, a BOB's release and a defect as
// record lines and rows (R5; a job's retirement is jobs' command, named here at a layer's close). Nothing here archives,
// re-arms, deletes or interrupts a session, or prints one as owed (R6); every act it prints is the architecture session's,
// never Bob's (R7).
//
// K24: integration imports planning, jobs and gate, each merged before it (planning 021a6ff, jobs 2065a39, gate 7337ea3).
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TRANCHE, jobBranch, stateBranch, refuse, repo, ghRepo, readRole, unpushed, commitPush, pruneRef, needEpoch, stateRead, stateWrite, parsePlan, planEdit, jobFiles, METRICS_HEAD, metricsFile } from './record.mjs';
import { constraints } from './platform.mjs';
// architecture (K25): the module map, the manifest's artifact rows, and the checks' one machine-readable result.
import { modules as moduleMap } from '../checks/architecture.mjs';
import { artifactRows } from '../checks/lib.mjs';
import { readResult } from '../checks/run.mjs';
// planning (K24; merged at 021a6ff): the running plan, its tranche and round, its entries.
import { PLAN, tranche, trancheId, entries, roundNumber } from './planning.mjs';
// gate (K25): a green tip behind the tranche only by records the gate does not read for the module (gate R5).
import { gateNeutral } from './gate.mjs';
// jobs (K24; merged at 2065a39): the job line, what a job owes, a report's evidence, the reviewer's brief (one text with
// the job's own review, K14), and a job's retirement (its R7), which this module names at a layer's close.
import { parseJob, fmtJob, jobOf, owedByJob, evidenceItems, reviewBrief, MODEL, LIMIT } from './jobs.mjs';
export { MODEL, LIMIT };
// requirements (K25): the rule every review brief carries (requirements R4; REQ-3).
import { MEASUREMENT_RULE } from './requirements.mjs';
export { MEASUREMENT_RULE };

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const SHA = /^[0-9a-f]{7,40}$/;
export const REVIEW_REASONS = ['new module', 'provided service changed', 'sensitive path', 'large diff', 'thin evidence', 'third completion'];
export const LARGE_DIFF = 400;                               // changed lines over which a diff is a reason to review
export const STALE_DAYS = 7;                                 // a constraint row not confirmed for a week is listed at a layer's close
// R6: the acts the classifier decides case by case (platform R4); nothing here prints one.
export const NEVER = ['archive_session', 'update_trigger', 'delete_trigger', 'interrupt_session'];

const jobPath = (m) => `jobs/${m}.md`;
const loadJob = (R, m) => jobOf(R, m) ?? refuse(`no job for ${m} on the state branch`);
const saveJob = (R, m, j, msg) => stateWrite(R, { [jobPath(m)]: fmtJob(m, j) }, msg);
// A job whose work is on the tranche: MERGED, or a merge on its Merges line (a job retired after its merge keeps it);
// a line that reads ARCHIVED with no merge is no merge (a session archived before its job merged).
export const hasMerged = (j) => !!j && (j.state === 'MERGED' || (j.merges || []).length > 0);
const done = (R, m) => hasMerged(jobOf(R, m));
const modules = (R) => moduleMap(R).modules;
const mod = (R, m) => modules(R).find((x) => x.id === m) ?? refuse(`no module ${m} in build/modules.json`);
const artifacts = (R) => artifactRows(R.read('build/manifest.md') || '').map((r) => ({ ...r, path: r.paths.join(', ') }));
// The checks whole over the product (architecture R2), run as their command so this stays one synchronous step, and read
// back from their one result file (architecture R3), never from the log; a finding is compared without its line numbers.
const CHECKS = join(new URL('..', import.meta.url).pathname, 'checks/run.mjs');
function allChecks(R) {
  const r = spawnSync('node', [CHECKS, R.dir, '--no-fetch'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const res = readResult(R);
  if (!res) return { fails: new Set([`check: no result written (${`${r.stdout}${r.stderr}`.trim().split('\n').pop()})`]) };
  return { fails: new Set(res.findings.map((f) => `${f.check}: ${String(f.finding).replace(/:\d+(?::\d+)?\b/g, '').trim()}`)) };
}

const on = (R, want) => { const b = R.branch(); if (b !== want) refuse(`check out ${want} first (on ${b})`); };
const fileText = (f, what) => (typeof f === 'string' && existsSync(f) ? readFileSync(f, 'utf8').trim() : refuse(`${what}: no such file`));
const owe = (p, acts) => ({ ...p, owed: [...new Set([...p.owed, ...acts])] });
const clear = (p, act) => ({ ...p, owed: p.owed.filter((x) => x !== act) });
const is = (R, a, b) => { try { R.g(['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; } };

// ---- R1: the review, decided by judgment and done once by a fresh worker ----

// The listed reasons (rulebook INT 4) found in the job's change, each named so the decision is written from them.
export function reviewConcerns(R, m, j) {
  const out = [], x = mod(R, m), range = `origin/${TRANCHE}...origin/${jobBranch(m)}`;
  R.fetch('main');
  if (!(JSON.parse(R.remote('main', 'build/modules.json') || '{"modules":[]}').modules || []).some((y) => y.id === m)) out.push('new module (not on main)');
  const stat = R.g(['diff', '--numstat', range]).split('\n').filter(Boolean).map((l) => l.split('\t'));
  const changed = stat.reduce((n, [a, d]) => n + (Number(a) || 0) + (Number(d) || 0), 0);
  if (changed > LARGE_DIFF) out.push(`large diff (${changed} lines, over ${LARGE_DIFF})`);
  const exp = (x.paths || []).length ? R.g(['diff', range, '--', ...(x.paths || []).map(R.rel)]).split('\n').filter((l) => /^[+-]\s*export\b/.test(l)) : [];
  if (exp.length) out.push(`provided service changed (${exp.length} export line(s) differ)`);
  const sensitive = JSON.parse(R.read('build/modules.json') || '{}').sensitive || [];
  const hit = stat.map((s) => s[2]).filter((f) => sensitive.some((p) => f === p || f.startsWith(p)));
  if (hit.length) out.push(`sensitive path: ${hit.join(', ')}`);
  const entries = ((stateRead(R, `jobs/${m}/start.md`) || '').match(/^- /gm) || []).length;
  const ev = evidenceItems(stateRead(R, `jobs/${m}/report.md`) || '') || [];
  if (ev.length < entries) out.push(`thin evidence (${ev.length} item(s) for ${entries} entries)`);
  if (j.runs >= 3) out.push(`third completion (completion ${j.runs})`);
  return out;
}
const reviewed = (j) => /^review · .* · approved · /.test(j.review || '') || /^no review · /.test(j.review || '');

// One decision per completion, written on the job line with the concerns found: `--review --reason` (the fresh worker's
// brief printed, the head it reviews recorded), or `--no-review --reason`. After the one independent review found gaps
// (K15) no second review runs: `--no-review` then names the fix commits the architecture session verified against the
// named gaps (`--commits <sha,…>`), each on the job's branch after the reviewed head, and is refused without them.
export function reviewDecide(o) {
  const R = repo(o.product), m = o.module;
  if (!m || !o.reason || !o.review === !o.noReview) refuse('--module <m> (--review | --no-review [--commits <sha,…>]) --reason "<…>"');
  const j = loadJob(R, m);
  if (j.state !== 'COMPLETE') refuse(`${m} reads ${j.state}: a review is decided on COMPLETE`);
  if (owedByJob(j).length) refuse(`${m} still owes: ${owedByJob(j).join('; ')}`);
  if (j.review) refuse(`${m}'s review is decided: ${j.review}`);
  R.fetch(TRANCHE, jobBranch(m));
  const concerns = reviewConcerns(R, m, j), note = `concerns: ${concerns.join('; ') || 'none'}`;
  const last = stateRead(R, `jobs/${m}/review.md`) || '';
  const reviewedHead = last.match(/^\*\*Reviewed head\*\* · ([0-9a-f]{7,40})$/m)?.[1] ?? null;
  const gaps = /^VERDICT · gaps$/m.test(last) ? last.split('\n').filter((l) => /^- R\d+ · /.test(l)) : [];
  if (o.noReview && j.reviews && gaps.length) {
    const shas = String(o.commits || '').split(/[,\s]+/).filter(Boolean);
    if (!shas.length || !shas.every((x) => SHA.test(x))) refuse(`${m}'s one independent review found ${gaps.length} gap(s) (K15): --no-review names the fix commit(s) you verified against them, --commits <sha,…>`);
    if (!reviewedHead) refuse(`jobs/${m}/review.md records no reviewed head: the fix commits cannot be placed after it`);
    const head = R.g(['rev-parse', `origin/${jobBranch(m)}`]);
    const bad = shas.filter((x) => { try { const c = R.g(['rev-parse', '--verify', `${x}^{commit}`]); return !is(R, c, head) || is(R, c, reviewedHead) || is(R, c, `origin/${TRANCHE}`); } catch { return true; } });
    if (bad.length) refuse(`not commits of ${jobBranch(m)} after the reviewed head ${reviewedHead.slice(0, 7)}: ${bad.join(', ')}`);
    return { commit: saveJob(R, m, { ...j, review: `no review · fix ${shas.map((x) => x.slice(0, 7)).join(',')} verified against ${gaps.length} gap(s) · ${o.reason} · ${note}` }, `${m}: gap fixes verified, no second review`), concerns, gaps: gaps.length };
  }
  if (o.noReview) return { commit: saveJob(R, m, { ...j, review: `no review · ${o.reason} · ${note}` }, `${m}: no review`), concerns };
  if (j.reviews >= 1) refuse(`${m} has had its one independent review (K15): verify the fix commits against its gaps and decide --no-review --commits <sha,…>`);
  const reviewing = R.g(['rev-parse', `origin/${jobBranch(m)}`]);
  const model = concerns.some((c) => /^new module|^provided service|^sensitive/.test(c)) ? 'opus' : 'sonnet';
  const result = join(R.root, '.git', `proc-review-${m}.md`), { id: T } = tranche(R);
  const brief = reviewBrief(R, m, { by: parsePlan(stateRead(R, 'plan.md') || '').bob?.name ?? 'BOB', pr: j.pr, T, why: `${o.reason}; ${note}`, diff: `git -C ${R.root} diff origin/${TRANCHE}...origin/${jobBranch(m)}`, report: `git -C ${R.root} show origin/${stateBranch(needEpoch(R))}:jobs/${m}/report.md`, result, model });
  const commit = stateWrite(R, { [jobPath(m)]: fmtJob(m, { ...j, reviews: (j.reviews || 0) + 1, review: `review · ${o.reason} · ${note} · head ${reviewing.slice(0, 12)} · working since ${now()}` }), [`jobs/${m}/review-brief.md`]: brief }, `${m}: review dispatched`);
  return { commit, concerns, agent: { description: `review ${m}`, prompt: brief, run_in_background: true, model: MODEL[model], effort: 'high' }, then: `proc review result --module ${m} --result-file ${result}` };
}
// The worker's verdict recorded, the review posted on the pull request, and on gaps the CHANGE to the job.
export function reviewResult(o) {
  const R = repo(o.product), m = o.module; if (!m) refuse('--module <m> --result-file <f>');
  const j = loadJob(R, m);
  if (!/^review · .* · working since /.test(j.review || '')) refuse(`${m} has no review out (${j.review ?? 'none decided'})`);
  const text = fileText(o.resultFile, '--result-file');
  const verdict = text.match(/^VERDICT · (approve|gaps)$/m)?.[1] ?? refuse('the result\'s first line is `VERDICT · approve` or `VERDICT · gaps`');
  if (!new RegExp(`^DONE review-${m} · `, 'm').test(text)) refuse(`the result lacks its DONE line: the worker failed; re-dispatch it from jobs/${m}/review-brief.md (SESSIONS §4)`);
  const gaps = text.split('\n').filter((l) => /^- R\d+ · /.test(l));
  if (verdict === 'gaps' && !gaps.length) refuse('VERDICT · gaps with no `- R<id> · …` line');
  const loose = gaps.filter((l) => !/^- R\d+ · [^·]*\S:\d+\b/.test(l));
  if (loose.length) refuse(`a gap names its file and line (\`- R<id> · <file>:<line> · …\`): ${loose.join(' | ')}`);
  const head = j.review.match(/ · head ([0-9a-f]{7,40}) · working since /)?.[1] ?? null;
  const review = j.review.replace(/ · working since .*$/, ` · ${verdict === 'approve' ? 'approved' : `gaps: ${gaps.length}`} · ${today()}`);
  const commit = stateWrite(R, { [jobPath(m)]: fmtJob(m, { ...j, review }), [`jobs/${m}/review.md`]: `${text}${head ? `\n**Reviewed head** · ${head}` : ''}\n` }, `${m}: review ${verdict}`);
  // A COMMENT review carrying the verdict: GitHub refuses REQUEST_CHANGES and APPROVE on one's own pull request (BOB #1's
  // R-BOB-1-3, 29 Oct); the approval the merge reads is the Review line.
  const out = { commit, verdict, post: { tool: 'pull_request_review_write', ...ghRepo(R), pullNumber: j.pr, method: 'create', event: 'COMMENT', body: `${verdict === 'approve' ? 'APPROVED by the review' : 'CHANGES REQUESTED by the review'} (${review.split(' · ')[1]})\n\n${text}` } };
  if (verdict === 'gaps') out.send = { session_id: j.session, message: `CHANGE: the review found ${gaps.length} gap(s) against your requirements; fix each, then complete again. This is your one independent review (K15): the architecture session verifies your fix commits against these gaps and merges, with no second review round.\n${gaps.join('\n')}` };
  return out;
}

// ---- R2: the merge of a green, current tip, and its record from GitHub ----

// Refuses unless COMPLETE with nothing owed, the review decided (approved or verified where one ran), and the plan's
// order met; then, from the check event (`--head`, `--gate`): the gate green on the pull request's tip, and the tip holding
// the tranche, or behind it only by records the gate does not read for the module (gateNeutral); a tip behind otherwise
// is updated first. A green, current tip is merged by the printed call, owed until `merged` records it.
export function merge(o) {
  const R = repo(o.product), m = o.module; if (!m) refuse('--module <m> --head <sha> --gate <conclusion> (both from the check event)');
  const j = loadJob(R, m);
  if (j.state !== 'COMPLETE') refuse(`${m} reads ${j.state}: a merge follows COMPLETE`);
  if (j.owed.length) refuse(`${m} still owes: ${j.owed.join('; ')}`);
  if (!j.review) refuse(`decide the review first (proc review decide --module ${m})`);
  if (!reviewed(j)) refuse(`${m}'s review is not approved: ${j.review}`);
  if (/^(merging|merged)/.test(j.merge || '')) refuse(`${m} is already ${j.merge}`);
  const waits = j.after.filter((a) => !done(R, a));
  if (waits.length) refuse(`${m} merges after ${waits.join(', ')} (the plan's order)`);
  if (!SHA.test(String(o.head || '')) || !o.gate) refuse('--head <sha the check ran on> --gate <its conclusion>, from the check event (JOB-LIFE §6)');
  R.fetch(TRANCHE, jobBranch(m));
  let head; try { head = R.g(['rev-parse', `origin/${jobBranch(m)}`]); } catch { refuse(`${jobBranch(m)} is not on origin`); }
  if (!head.startsWith(String(o.head))) refuse(`${jobBranch(m)} is at ${head.slice(0, 7)}, not ${String(o.head).slice(0, 7)}: that result is for an older commit; wait for the run on the tip`);
  if (o.gate !== 'success') refuse(`the gate concluded "${o.gate}" on ${head.slice(0, 7)}: nothing merges red; send the job a CHANGE naming the failing check (JOB-LIFE §6)`);
  const behind = !is(R, `origin/${TRANCHE}`, head);
  const passed = behind ? gateNeutral(R, m, head) : null;
  if (behind && passed.held.length) {
    const commit = saveJob(R, m, { ...j, merge: `updating ${now()}` }, `${m}: behind ${TRANCHE}, branch updated`);
    return { commit, update: { tool: 'update_pull_request_branch', ...ghRepo(R), pullNumber: j.pr }, held: passed.held, then: `the gate runs on the updated tip; on its success event, proc merge --module ${m} again with the new head` };
  }
  const commit = saveJob(R, m, { ...j, merge: `merging ${head.slice(0, 7)} ${now()}` }, `${m}: merging ${head.slice(0, 7)}${behind ? `, over ${passed.files.length} record file(s) on ${TRANCHE} (JOB-LIFE §6)` : ''}`);
  planEdit(R, (p) => owe(p, [`merge ${m}`]), `owed: merge ${m}`);
  return { commit, merge: { tool: 'merge_pull_request', ...ghRepo(R), pullNumber: j.pr, merge_method: 'merge' }, ...(behind ? { over: passed.files } : {}), then: `proc merged --module ${m} --sha <merge commit> (on the pull_request.closed event)` };
}
// The merge recorded from GitHub's result, never from a report: the commit is on the tranche and holds the job's tip;
// MERGED; the merged branch pruned (JOB-LIFE §1); the job told; the pull requests waiting on this module marked ready.
export function merged(o) {
  const R = repo(o.product), m = o.module, sha = String(o.sha || ''); if (!m || !SHA.test(sha)) refuse('--module <m> --sha <merge commit>');
  const j = loadJob(R, m);
  if (!/^merging/.test(j.merge || '')) refuse(`${m} is not merging (${j.merge ?? 'no merge'}): run proc merge first`);
  R.fetch(TRANCHE, jobBranch(m));
  let full; try { full = R.g(['rev-parse', '--verify', `${sha}^{commit}`]); } catch { refuse(`${sha}: not a commit this clone sees after fetching ${TRANCHE}`); }
  if (!is(R, full, `origin/${TRANCHE}`)) refuse(`${sha} is not on ${TRANCHE}`);
  let head = null; try { head = R.g(['rev-parse', `origin/${jobBranch(m)}`]); } catch { /* already gone */ }
  if (head && !is(R, head, full)) refuse(`${jobBranch(m)}'s tip ${head.slice(0, 7)} is not in ${sha}: not this job's merge`);
  // the tip the merge was printed for, on the `merging <sha>` line: held by the merge commit even once the branch is gone
  const printed = j.merge.match(/^merging ([0-9a-f]{7,40})\b/)?.[1];
  let tip = null; try { tip = printed && R.g(['rev-parse', '--verify', `${printed}^{commit}`]); } catch { /* unknown here */ }
  if (!tip) refuse(`the tip ${printed ?? '(none)'} that ${m}'s merge was printed for is not a commit this clone sees: not provable as this job's merge`);
  if (!is(R, tip, full)) refuse(`${sha} does not hold ${tip.slice(0, 7)}, the tip ${m}'s merge was printed for: not this job's merge`);
  const commit = saveJob(R, m, { ...j, state: 'MERGED', merge: `merged ${full.slice(0, 7)} ${today()}`, merges: [...(j.merges || []), `${full.slice(0, 7)} ${today()} reviews:${j.reviews || 0}`] }, `${m}: MERGED ${full.slice(0, 7)}`);
  planEdit(R, (p) => clear(p, `merge ${m}`), `${m} merged`);
  const prune = head ? pruneRef(R, jobBranch(m)) : null;
  const ready = [];
  for (const p of jobFiles(R)) {
    const om = p.slice(5, -3), other = parseJob(stateRead(R, p) || ''), w = other?.owed.find((x) => /^ready after /.test(x));
    if (!w || !other.pr) continue;
    const rest = w.slice('ready after '.length).split(/,\s*/).filter((a) => a !== m && !done(R, a));
    if (!rest.length) ready.push({ module: om, mark: { tool: 'update_pull_request', ...ghRepo(R), pullNumber: other.pr, draft: false }, then: `proc job posted --module ${om} --ready` });
  }
  return { commit, prune, send: j.session ? { session_id: j.session, message: `MERGED: ${m} is on ${TRANCHE} at ${full.slice(0, 7)} (PR #${j.pr}).` } : null, ready };
}

// ---- R3: the layer's close, with its tests ----

// The layer's tests the manifest names: a line `Layer <n> tests: \`<path>\`[, \`<path>\`…]` (or the same words in a table
// row); none named is none to run. The paths are from the product's root and may be globs node --test takes.
export function layerTests(R, L) {
  const out = [];
  for (const line of (R.read('build/manifest.md') || '').split('\n')) for (const x of line.matchAll(/\blayer (\d+)(?:'s)? tests?\b[^`|]*?((?:`[^`]+`[,;\s]*(?:and\s+)?)+)/gi)) if (Number(x[1]) === L) out.push(...[...x[2].matchAll(/`([^`]+)`/g)].map((y) => y[1]));
  return [...new Set(out)];
}
// The layer's test files: each manifest path, a glob included, as the files git tracks under it (product-relative).
function layerFiles(R, L) {
  const out = [];
  for (const p of layerTests(R, L)) for (const f of R.g(['ls-files', '--', R.rel(p)]).split('\n').filter(Boolean)) out.push(relative(R.dir, join(R.root, f)));
  return [...new Set(out)];
}
// Each layer test file run on its own, so a red is known by its file, and the file by its owner in the module map.
function runLayerTests(R, L, files) {
  const mods = modules(R), under = (f, p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`);
  const owner = (f) => mods.find((x) => [...(x.paths || []), ...(x.tests || [])].some((p) => under(f, p)))?.id ?? 'unplaced';
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const res = { tests: 0, pass: 0, fail: 0, failed: [], by: {} };
  for (const f of files) {
    const r = spawnSync('node', ['--test', '--test-reporter=tap', f], { cwd: R.dir, env, encoding: 'utf8', maxBuffer: 1 << 28 });
    const n = (k) => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)$`, 'm')) || [])[1] ?? 0);
    res.tests += n('tests'); res.pass += n('pass'); res.fail += n('fail');
    const failed = [...new Set([...r.stdout.matchAll(/^\s*not ok \d+ - (.+?)(?: # .*)?$/gm)].map((x) => x[1].trim()))].map((t) => `${f}: ${t}`);
    if (r.status && !failed.length) failed.push(`${f}: ${`${r.stdout}${r.stderr}`.trim().split('\n').pop()}`);
    if (failed.length) { res.failed.push(...failed); (res.by[owner(f)] ??= []).push(...failed); }
  }
  return res;
}
// Every pull request of the layer merged; the layer's tests once over the merged layer (a red goes back to its module's
// job as a CHANGE, the jobs live until the close); the artifacts regenerated and committed once; the checks whole over the
// product, judged against the tranche as it opened; platform's stale constraint rows listed; each merged job's retirement
// named (jobs' record line, its R7; nothing owed, no session archived); the layer CLOSED and the next layer's start printed. The proof row and the offer of a stop for a newer
// process version are maintenance's (its R3, R5; K24), wired in by its job.
export function layerClose(o) {
  const R = repo(o.product), L = Number(o.layer); if (!L) refuse('--layer <n>');
  on(R, TRANCHE);
  const plan = parsePlan(stateRead(R, 'plan.md') || '');
  if (plan.layers[L] !== 'STARTED') refuse(`layer ${L} is ${plan.layers[L] || 'not started'}`);
  const { text } = tranche(R);
  const inLayer = new Set(entries(text).filter((e) => e.layer === L && e.module).map((e) => e.module));
  const jobs = modules(R).filter((x) => x.layer === L && inLayer.has(x.id)).map((x) => [x.id, jobOf(R, x.id)]);
  const open = jobs.filter(([, j]) => !hasMerged(j));
  if (open.length) refuse(`layer ${L}: ${open.map(([x, j]) => `${x} ${j ? j.state : 'no job'}`).join('; ')}`);
  R.fetch(TRANCHE);
  if (!is(R, `origin/${TRANCHE}`, 'HEAD')) refuse(`the checkout is behind origin/${TRANCHE}: pull first`);
  if (unpushed(R).length) refuse(`the tranche checkout is not pushed: ${unpushed(R).join('; ')}`);
  const files = layerFiles(R, L), tests = runLayerTests(R, L, files);
  if (tests.failed.length) {
    const by = new Map(Object.entries(tests.by));
    const changes = [...by].map(([x, ts]) => { const j = jobs.find(([y]) => y === x)?.[1]; return { module: x, session: j?.session ?? null, message: `CHANGE: layer ${L}'s tests fail at the close for ${x}; fix them, then complete again:\n${ts.map((t) => `- ${t}`).join('\n')}`, then: x === 'unplaced' ? 'name the module these tests prove, then send it the CHANGE' : j?.state === 'MERGED' ? `proc job reopen --module ${x} --change-file <this message>, then send it` : `${x}'s job is retired: start a new one on this CHANGE (proc layer start --layer ${L} --modules ${x})` }; });
    refuse(`layer ${L}'s tests: ${tests.failed.length} red over the merged layer (${[...by.keys()].join(', ')}); the layer stays open:\n${JSON.stringify(changes, null, 2)}`);
  }
  const sh = (c) => spawnSync('sh', ['-c', c], { cwd: R.dir, encoding: 'utf8' }), list = artifacts(R), stale = [];
  for (const a of list) { sh(a.regen); if (sh(a.verify).status !== 0) stale.push(a.path); }
  if (stale.length) refuse(`artifacts stale after regenerating: ${stale.join(', ')}`);
  const changed = list.flatMap((a) => a.paths.filter((p) => { try { R.g(['diff', '--quiet', '--', R.rel(p)]); return false; } catch { return true; } }));
  const commit = changed.length ? commitPush(R, TRANCHE, changed, `artifacts regenerated at layer ${L}'s close: ${changed.join(', ')}`) : null;
  const found = allChecks(R);
  if (found.fails.size) {
    R.fetch('main');
    let start = null; try { start = R.g(['merge-base', 'origin/main', 'HEAD']); } catch { refuse('the tranche shares no history with main'); }
    const old = at(R, start, () => allChecks(R)).fails, added = [...found.fails].filter((x) => !old.has(x));
    if (added.length) refuse(`checks: ${added.length} finding(s) new since the tranche opened: ${added.slice(0, 10).join('; ')}`);
  }
  const since = o.olderThan || new Date(Date.now() - STALE_DAYS * 864e5).toISOString().slice(0, 10);
  const staleRows = constraints({ olderThan: since }).map((r) => ({ id: r.id, date: r.date }));
  const live = jobs.filter(([, j]) => j.state === 'MERGED');
  const nextL = Object.keys(plan.layers).map(Number).includes(L + 1) || new RegExp(`^## Layer ${L + 1}\\b`, 'm').test(text) ? L + 1 : null;
  const pc = planEdit(R, (p) => ({ ...p, layers: { ...p.layers, [L]: 'CLOSED' } }), `layer ${L} closes`);
  delete tests.by;
  return { layer: L, commit: commit ?? pc, tests, stale: staleRows, retire: live.map(([x, j]) => ({ module: x, session: j.session, then: `proc job retire --module ${x} [--usage '<usage read by a route the platform allows>' | --unmeasured "<why none could be read>"]` })), next: nextL ? `proc layer start --layer ${nextL}` : `proc round open (the completion round), or proc round close when nothing remains` };
}
function at(R, ref, fn) { const back = R.branch(), head = R.g(['rev-parse', 'HEAD']); R.g(['checkout', '-q', '--detach', ref]); try { return fn(); } finally { R.g(['checkout', '-q', back === 'HEAD' ? head : back]); } }

// ---- R4: `main` moves only by the close pull request, at CLOSING ----

// The close pull request's merge call, printed only while the plan reads CLOSING and the tranche's tip is the head GitHub
// is told to expect, so nothing else moves `main`. The tranche close itself is planning's (its R2).
export function closeMerge(o) {
  const R = repo(o.product), pr = Number(o.pr); if (!pr) refuse('--pr <the close pull request\'s number>');
  const plan = parsePlan(stateRead(R, 'plan.md') || '');
  if (plan.state !== 'CLOSING') refuse(`the plan reads ${plan.state ?? 'nothing'}, not CLOSING: main moves only by the close pull request once the tranche close has run (rulebook INT 9)`);
  R.fetch(TRANCHE);
  const tip = R.g(['rev-parse', `origin/${TRANCHE}`]);
  return { merge: { tool: 'merge_pull_request', ...ghRepo(R), pullNumber: pr, merge_method: 'merge', expectedHeadSha: tip }, then: 'proc tranche merged --sha <merge commit>' };
}

// ---- R5: retirement, a BOB's release and a defect, each a record line or row ----

// A retiring BOB released on the record once none of its workers runs (BOB, its own), or one whose session failed
// (ROOT, from get_session). Its session is left idle, never archived from here; its usage row comes from a route the
// platform allows, or is named unmeasured (rulebook SES 10).
export const WORKERS_FILE = 'proc-workers.json';
export const runningWorkers = (root, session) => { try { const w = JSON.parse(readFileSync(join(root, '.git', WORKERS_FILE), 'utf8')); return w.session === session ? w.running : null; } catch { return null; } };
export function bobRelease(o) {
  const R = repo(o.product), me = readRole(R.root), p = parsePlan(stateRead(R, 'plan.md') || '');
  const who = me?.role === 'root' ? o.session : me?.role === 'bob' ? me.session : refuse('a retiring BOB releases itself; ROOT releases one only when get_session reads it failed or archived');
  if (me?.role === 'root' && !o.failed) refuse('--session <the BOB> --failed "<what get_session reads>": ROOT releases only a BOB whose workers died with it');
  const r = (p.retiring || []).find((x) => x.session === who) ?? refuse(`${who} is not retiring: \`proc handoff\` records a BOB retiring`);
  if (r.state === 'released') return { released: r.name, already: true };
  if (me.role === 'bob') {
    const run = runningWorkers(R.root, who);
    if (run === null) refuse('your background tasks are not recorded yet: end this turn, then run this again');
    if (run.length) refuse(`${run.length} of your workers still run (${run.map((t) => t.description || t.id).join('; ')}): record each result as it arrives; your session stays until none runs`);
  }
  const commit = planEdit(R, (q) => ({ ...q, retiring: q.retiring.map((x) => (x.session === who ? { ...x, state: 'released' } : x)) }), `${r.name} released${o.failed ? ` (${String(o.failed).slice(0, 60)})` : ''}`);
  const row = `proc bob archived --name "${r.name}" --session ${who} --usage '<usage read by a route the platform allows>', or its row named unmeasured`;
  return { released: r.name, commit, next: me.role === 'bob' ? `send ROOT the line "RELEASED ${r.name}"; your session is left idle (an idle session costs nothing), and its row is written by your successor: ${row}` : `${r.name} is released on the record and its session left idle; send its successor the line for its row: ${row}` };
}

// A defect found in a merged module: a metrics row naming the module, the round's tranche and whether its merge was
// reviewed, so the review decision is tuned by evidence (rulebook INT 10).
export function defect(o) {
  const R = repo(o.product), m = o.module; if (!m || !o.what) refuse('--module <m> --what "<the defect, one line>"');
  on(R, TRANCHE);
  mod(R, m);
  const T = trancheId(R, o.tranche), csv = metricsFile(T), cur = R.read(csv) ?? METRICS_HEAD;
  const round = o.round || `R${roundNumber(R, T)}`;   // the running round, or after the last one the next (planning)
  const last = cur.split('\n').map((l) => l.split(',')).filter((c) => c[1] === 'job' && c[3] === m).pop();
  const j = jobOf(R, m);
  const rev = last?.[10] || (j ? (/^review · .* · approved/.test(j.review || '') || (j.merges || []).some((x) => !/reviews:0$/.test(x)) ? 'yes' : j.review ? 'no' : 'unknown') : 'unknown');
  R.write(csv, `${cur}${['', 'defect', last?.[2] || j?.name || '', m, '', '', '', '', '', '', rev, `${T} ${round}: ${String(o.what).replace(/[,\n]/g, ' ')}`].join(',')}\n`);
  return { commit: commitPush(R, TRANCHE, [csv], `metrics ${T}: defect in ${m} (merge reviewed: ${rev})`), reviewed: rev, tranche: T, round };
}
