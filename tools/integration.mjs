// integration (layer 3; build/requirements/integration.md): work counts only when it is merged and proven. The review
// decision and its worker (R1), the merge of a green current tip and its record (R2), the layer's close with its tests
// (R3), the close pull request as the one thing that moves `main` (R4), retirement, a BOB's release and a defect as
// record lines and rows (R5). Nothing here archives, re-arms, deletes or interrupts a session, or prints one as owed
// (R6); every act it prints is the architecture session's, never Bob's (R7).
//
// K24: integration imports planning, jobs and gate once each has merged, and merges after them. Until then the few
// record-level helpers it needs from them sit in the block marked BORROWED below, written to their requirements files;
// each is replaced by the provider's import as it merges, in this job, so no later job rewires anything.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TRANCHE, jobBranch, stateBranch, refuse, repo, ghRepo, readRole, unpushed, commitPush, pruneRef, needEpoch, stateRead, stateWrite, parsePlan, planEdit, jobFiles, METRICS_HEAD, metricsFile } from './record.mjs';
import { constraints } from './platform.mjs';

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const SHA = /^[0-9a-f]{7,40}$/;
export const LIMIT = 4096;                                   // a brief is one screen (SESSIONS §6)
export const MODEL = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' };
export const REVIEW_REASONS = ['new module', 'provided service changed', 'sensitive path', 'large diff', 'thin evidence', 'third completion'];
export const LARGE_DIFF = 400;                               // changed lines over which a diff is a reason to review
export const STALE_DAYS = 7;                                 // a constraint row not confirmed for a week is listed at a layer's close
// R6: the acts the classifier decides case by case (platform R4); nothing here prints one.
export const NEVER = ['archive_session', 'update_trigger', 'delete_trigger', 'interrupt_session'];

// ---- BORROWED until planning, jobs and gate merge (K24) ----
// jobs: the job line on the state branch (jobs' "job lines"; JOB-LIFE §2).
const JOB = /^\*\*Status\*\* · ([A-Z][A-Z0-9-]* #\d+) · (session_[0-9A-Za-z]+|-) · (.+?)(?: · PR #(\d+))?$/m;
export function parseJob(text) {
  const t = text || '', m = t.match(JOB); if (!m) return null;
  const line = (k) => t.match(new RegExp(`^\\*\\*${k}\\*\\* · (.*)$`, 'm'))?.[1] ?? null;
  return { name: m[1], session: m[2] === '-' ? null : m[2], state: m[3], pr: m[4] ? Number(m[4]) : null, runs: Number(line('Runs') || 0), owed: (line('Owed') || '').split('; ').map((x) => x.trim()).filter((x) => x && x !== 'none'), after: (line('After') || '').split(/,\s*/).filter(Boolean), model: line('Model'), review: line('Review'), merge: line('Merge'), reviews: Number(line('Reviews') || 0), merges: (line('Merges') || '').split('; ').filter(Boolean) };
}
export function fmtJob(m, j) {
  let t = `# ${m} (transient)\n\n**Status** · ${j.name} · ${j.session || '-'} · ${j.state}${j.pr ? ` · PR #${j.pr}` : ''}\n**Runs** · ${j.runs || 0}\n**Owed** · ${j.owed?.length ? j.owed.join('; ') : 'none'}\n`;
  if (j.after?.length) t += `**After** · ${j.after.join(', ')}\n`;
  if (j.model) t += `**Model** · ${j.model}\n`;
  if (j.review) t += `**Review** · ${j.review}\n`;
  if (j.merge) t += `**Merge** · ${j.merge}\n`;
  if (j.reviews) t += `**Reviews** · ${j.reviews}\n`;
  if (j.merges?.length) t += `**Merges** · ${j.merges.join('; ')}\n`;
  return t;
}
const jobPath = (m) => `jobs/${m}.md`;
const jobOf = (R, m) => parseJob(stateRead(R, jobPath(m)) || '');
const loadJob = (R, m) => jobOf(R, m) ?? refuse(`no job for ${m} on the state branch`);
const saveJob = (R, m, j, msg) => stateWrite(R, { [jobPath(m)]: fmtJob(m, j) }, msg);
// A job whose work is on the tranche: merged, or retired after its merge (R5).
const DONE = ['MERGED', 'RETIRED', 'ARCHIVED'];
const done = (R, m) => DONE.includes(jobOf(R, m)?.state);
// planning: the running plan and its tranche id (planning R1).
const PLAN = 'build/plan/current.md';
function tranche(R) {
  const text = R.read(PLAN) ?? refuse(`${PLAN}: no running plan on this checkout`);
  return { id: text.match(/^# Plan: .*?\b([A-Z]+\d+[a-z]?)\s*$/m)?.[1] ?? refuse(`${PLAN}: the title names no tranche id (\`# Plan: … T<n>\`)`), text };
}
const archivedTranche = (R) => R.g(['ls-files', '--', R.rel('build/plan/archive')]).split('\n').map((f) => f.match(/\/([A-Z]+)(\d+)([a-z]?)-R(\d+)\.md$/)).filter(Boolean).sort((a, b) => Number(a[2]) - Number(b[2]) || a[3].localeCompare(b[3]) || Number(a[4]) - Number(b[4])).pop()?.slice(1, 4).join('') ?? null;
const trancheId = (R, given) => given || (R.read(PLAN) ? tranche(R).id : archivedTranche(R) ?? refuse(`${PLAN}: no running plan and no archived one: --tranche <T>`));
function entriesOf(planText, layer, m) {
  const sec = planText.split(/^## /m).find((s) => s.startsWith(`Layer ${layer}`)) || '';
  const block = sec.split(/^\*\*/m).find((b) => b.startsWith(`${m}**`));
  return block ? block.slice(m.length + 2).trim() : '';
}
// architecture (Q4, asked): the module map and the checks over the whole product.
function modules(R) { const all = JSON.parse(R.read('build/modules.json') || '[]'); return Array.isArray(all) ? all : all.modules || []; }
const mod = (R, m) => modules(R).find((x) => x.id === m) ?? refuse(`no module ${m} in build/modules.json`);
function artifacts(R) {
  const rows = [];
  for (const l of (R.read('build/manifest.md') || '').split('\n')) {
    const c = l.split('|').map((x) => x.trim());
    if (c.length < 6 || !/^`[^`]+`/.test(c[1]) || !/^`.+`$/.test(c[3]) || !/^`.+`$/.test(c[4])) continue;
    const paths = [...c[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    rows.push({ paths, path: paths.join(', '), regen: c[3].slice(1, -1), verify: c[4].slice(1, -1) });
  }
  return rows;
}
const CHECKS = join(new URL('..', import.meta.url).pathname, 'checks/run.mjs');
const norm = (l) => `check: ${l.replace(/^FAIL\s+/, '').replace(/:\d+(?::\d+)?\b/g, '').trim()}`;
function allChecks(R) {
  const r = spawnSync('node', [CHECKS, R.dir], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const fails = new Set(`${r.stdout}`.split('\n').filter((l) => l.startsWith('FAIL')).map(norm));
  if (r.status && !fails.size) fails.add(`check: ${`${r.stdout}${r.stderr}`.trim().split('\n').pop()}`);
  return { fails };
}
// requirements (Q4, asked): the rule every review brief carries (requirements R4; REQ-3).
export const MEASUREMENT_RULE = 'A figure at a scale beyond the suite, or on a deployed copy, is a measurement with its own id in the plan, never a Test line; a measurement not yet taken is not a gap.';
// jobs: the report's evidence items (rulebook BLD 8).
function evidenceItems(report) {
  const lines = String(report || '').split('\n'), i = lines.findIndex((l) => /^\*\*Evidence\*\*/.test(l));
  if (i < 0) return null;
  const items = [], first = lines[i].replace(/^\*\*Evidence\*\*\s*[·:]?\s*/, '').trim();
  if (first) items.push(first);
  for (const l of lines.slice(i + 1)) { if (/^(\*\*|#)/.test(l)) break; const t = l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim(); if (t) items.push(t); }
  return items;
}
// gate (Q5, asked: gate R5's gateNeutral): a green tip behind the tranche only by records the gate does not read for m.
export function gateNeutral(R, m, head) {
  const x = mod(R, m), mods = modules(R), base = R.g(['merge-base', head, `origin/${TRANCHE}`]);
  const near = [m, ...(x.uses || []).filter((u) => !u.startsWith('*')), ...mods.filter((y) => (y.uses || []).includes(m)).map((y) => y.id)];
  const read = new Set(['build/modules.json', 'build/layers.md', 'build/manifest.md', 'build/words.json', 'build/ops.json', 'build/requirements/README.md', ...near.map((k) => `build/requirements/${k}.md`)]);
  const code = mods.flatMap((y) => [...(y.paths || []), ...(y.tests || [])]), gen = artifacts(R).flatMap((a) => a.paths);
  const under = (f, p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`);
  const why = (f) => (code.some((p) => under(f, p)) ? "a module's code or tests" : gen.includes(f) ? 'a generated artifact' : read.has(f) ? `read by the gate for ${m}` : f.split('/')[1] === 'summaries' && f.endsWith(`/${m}.md`) ? `${m}'s task summary` : !f.startsWith('build/') ? 'outside build/' : null);
  const files = R.g(['diff', '--name-only', base, `origin/${TRANCHE}`]).split('\n').filter(Boolean).map((f) => relative(R.rel('.'), f));
  return { files, held: files.map((f) => ({ file: f, why: why(f) })).filter((h) => h.why) };
}
// ---- end of BORROWED ----

const on = (R, want) => { const b = R.branch(); if (b !== want) refuse(`check out ${want} first (on ${b})`); };
const sized = (text, what) => { const n = Buffer.byteLength(text, 'utf8'); if (n > LIMIT) refuse(`${what} is ${n} bytes; the limit is ${LIMIT} (SESSIONS §6)`); return text; };
const fileText = (f, what) => (typeof f === 'string' && existsSync(f) ? readFileSync(f, 'utf8').trim() : refuse(`${what}: no such file`));
const owe = (p, acts) => ({ ...p, owed: [...new Set([...p.owed, ...acts])] });
const clear = (p, act) => ({ ...p, owed: p.owed.filter((x) => x !== act) });
const owedByJob = (j) => (j?.owed || []).filter((x) => !/^ready after /.test(x));
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
const reviewed = (j) => /^review · .* · approved · /.test(j.review || '') || /^(no review|verified) · /.test(j.review || '');

// One decision per completion, written on the job line with the concerns found: `--no-review --reason`, or `--review
// --reason` (the fresh worker's brief printed), or, after the one independent review found gaps and the job fixed them,
// `--verified --commits <sha,…> --reason` (K15): the architecture session has checked those commits against the named
// gaps itself, and no second review round runs.
export function reviewDecide(o) {
  const R = repo(o.product), m = o.module, kinds = [o.review, o.noReview, o.verified].filter(Boolean).length;
  if (!m || !o.reason || kinds !== 1) refuse('--module <m> (--review | --no-review | --verified --commits <sha,…>) --reason "<…>"');
  const j = loadJob(R, m);
  if (j.state !== 'COMPLETE') refuse(`${m} reads ${j.state}: a review is decided on COMPLETE`);
  if (owedByJob(j).length) refuse(`${m} still owes: ${owedByJob(j).join('; ')}`);
  if (j.review) refuse(`${m}'s review is decided: ${j.review}`);
  R.fetch(TRANCHE, jobBranch(m));
  const concerns = reviewConcerns(R, m, j), note = `concerns: ${concerns.join('; ') || 'none'}`;
  const last = stateRead(R, `jobs/${m}/review.md`) || '';
  if (o.verified) {
    const gaps = last.split('\n').filter((l) => /^- R\d+ · /.test(l));
    if (!j.reviews || !/^VERDICT · gaps$/m.test(last) || !gaps.length) refuse(`${m} has no review with gaps to verify against: --verified follows the one independent review's gaps (K15)`);
    const shas = String(o.commits || '').split(/[,\s]+/).filter(Boolean);
    if (!shas.length || !shas.every((s) => SHA.test(s))) refuse('--commits <sha,…>: the commits that fix the named gaps');
    const head = R.g(['rev-parse', `origin/${jobBranch(m)}`]);
    const bad = shas.filter((s) => { try { const c = R.g(['rev-parse', '--verify', `${s}^{commit}`]); return !is(R, c, head) || is(R, c, `origin/${TRANCHE}`); } catch { return true; } });
    if (bad.length) refuse(`not commits of ${jobBranch(m)} beyond ${TRANCHE}: ${bad.join(', ')}`);
    return { commit: saveJob(R, m, { ...j, review: `verified · ${shas.map((s) => s.slice(0, 7)).join(',')} against ${gaps.length} gap(s) · ${o.reason} · ${note}` }, `${m}: gap fixes verified`), concerns, gaps: gaps.length };
  }
  if (o.noReview) return { commit: saveJob(R, m, { ...j, review: `no review · ${o.reason} · ${note}` }, `${m}: no review`), concerns };
  if (j.reviews >= 1) refuse(`${m} has had its one independent review (K15): verify the fix commits against its gaps (--verified --commits <sha,…>) or decide --no-review`);
  const model = concerns.some((c) => /^new module|^provided service|^sensitive/.test(c)) ? 'opus' : 'sonnet';
  const result = join(R.root, '.git', `proc-review-${m}.md`), { id: T } = tranche(R);
  const brief = sized(`Brief review-${m} · for ${parsePlan(stateRead(R, 'plan.md') || '').bob?.name ?? 'BOB'} · ${today()}
Task: Review pull request #${j.pr} of module ${m} (tranche ${T}) against the module's requirements. Report only correctness gaps against the requirements, each with the requirement id, file:line, and a way to show it (a command or a test). No style, no praise, no rewrite. ${MEASUREMENT_RULE} Why this review: ${o.reason}; ${note}.
Read whole, and nothing else: ${R.rel(`build/requirements/${m}.md`)} (the requirements); the diff, by \`git -C ${R.root} diff origin/${TRANCHE}...origin/${jobBranch(m)}\`; the job's report, by \`git -C ${R.root} show origin/${stateBranch(needEpoch(R))}:jobs/${m}/report.md\`.
Write your result to: ${result}
Form of the result: first line \`VERDICT · approve\` or \`VERDICT · gaps\`; then one line per gap: \`- R<id> · <file>:<line> · <what fails> · <how to show it>\`.
If you need something not listed above, stop and write what it is in the result; do not search for it.
End with the line: DONE review-${m} · verdict
Model: ${model === 'opus' ? 'Opus' : 'Sonnet'} · Effort: high · Due: 60
`, 'the review brief');
  const commit = stateWrite(R, { [jobPath(m)]: fmtJob(m, { ...j, reviews: (j.reviews || 0) + 1, review: `review · ${o.reason} · ${note} · working since ${now()}` }), [`jobs/${m}/review-brief.md`]: brief }, `${m}: review dispatched`);
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
  const review = j.review.replace(/ · working since .*$/, ` · ${verdict === 'approve' ? 'approved' : `gaps: ${gaps.length}`} · ${today()}`);
  const commit = stateWrite(R, { [jobPath(m)]: fmtJob(m, { ...j, review }), [`jobs/${m}/review.md`]: text }, `${m}: review ${verdict}`);
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
// The module a failing layer test belongs to: the owner of the test's file by the module map, else the module whose id
// the test's name carries, else none (the CHANGE then goes to the architecture session to place).
function ownerOf(R, L, name, files) {
  const mods = modules(R).filter((x) => x.layer === L);
  const under = (f, p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`);
  const file = files.find((f) => name.includes(f)) ?? files.find((f) => name.includes(f.split('/').pop()));
  return (file && mods.find((x) => [...(x.paths || []), ...(x.tests || [])].some((p) => under(file, p)))?.id) || mods.find((x) => new RegExp(`\\b${x.id}\\b`).test(name))?.id || null;
}
function runLayerTests(R, L, files) {
  if (!files.length) return { tests: 0, pass: 0, fail: 0, failed: [] };
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync('node', ['--test', '--test-reporter=tap', ...files], { cwd: R.dir, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const n = (k) => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)$`, 'm')) || [])[1] ?? 0);
  // a failing subtest and its file both read `not ok`; the innermost names are the tests, and a file whose process died names itself
  const failed = [...new Set([...r.stdout.matchAll(/^(\s*)not ok \d+ - (.+?)(?: # .*)?$/gm)].map((x) => x[2].trim()))];
  if (r.status && !failed.length) failed.push(`the layer's tests: ${`${r.stdout}${r.stderr}`.trim().split('\n').pop()}`);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), failed };
}
// Every pull request of the layer merged; the layer's tests once over the merged layer (a red goes back to its module's
// job as a CHANGE, the jobs live until the close); the artifacts regenerated and committed once; the checks whole over the
// product, judged against the tranche as it opened; platform's stale constraint rows listed; each merged job retired on
// the record (R5); the layer CLOSED and the next layer's start printed. The proof row and the offer of a stop for a newer
// process version are maintenance's (its R3, R5; K24), wired in by its job.
export function layerClose(o) {
  const R = repo(o.product), L = Number(o.layer); if (!L) refuse('--layer <n>');
  on(R, TRANCHE);
  const plan = parsePlan(stateRead(R, 'plan.md') || '');
  if (plan.layers[L] !== 'STARTED') refuse(`layer ${L} is ${plan.layers[L] || 'not started'}`);
  const { text } = tranche(R);
  const jobs = modules(R).filter((x) => x.layer === L && entriesOf(text, L, x.id)).map((x) => [x.id, jobOf(R, x.id)]);
  const open = jobs.filter(([, j]) => !j || !DONE.includes(j.state));
  if (open.length) refuse(`layer ${L}: ${open.map(([x, j]) => `${x} ${j ? j.state : 'no job'}`).join('; ')}`);
  R.fetch(TRANCHE);
  if (!is(R, `origin/${TRANCHE}`, 'HEAD')) refuse(`the checkout is behind origin/${TRANCHE}: pull first`);
  if (unpushed(R).length) refuse(`the tranche checkout is not pushed: ${unpushed(R).join('; ')}`);
  const files = layerTests(R, L), tests = runLayerTests(R, L, files);
  if (tests.failed.length) {
    const by = new Map();
    for (const t of tests.failed) { const x = ownerOf(R, L, t, files) ?? 'unplaced'; (by.get(x) ?? by.set(x, []).get(x)).push(t); }
    const changes = [...by].map(([x, ts]) => { const j = jobs.find(([y]) => y === x)?.[1]; return { module: x, session: j?.session ?? null, message: `CHANGE: layer ${L}'s tests fail at the close for ${x}; fix them, then complete again:\n${ts.map((t) => `- ${t}`).join('\n')}`, then: x === 'unplaced' ? 'name the module these tests prove, then send it the CHANGE' : `proc job reopen --module ${x} --change-file <this message>, then send it` }; });
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
  for (const [x, j] of live) saveJob(R, x, { ...j, state: 'RETIRED' }, `${x}: RETIRED at layer ${L}'s close`);
  const nextL = Object.keys(plan.layers).map(Number).includes(L + 1) || new RegExp(`^## Layer ${L + 1}\\b`, 'm').test(text) ? L + 1 : null;
  const pc = planEdit(R, (p) => ({ ...p, layers: { ...p.layers, [L]: 'CLOSED' } }), `layer ${L} closes`);
  return { layer: L, commit: commit ?? pc, tests, stale: staleRows, retired: live.map(([x, j]) => ({ module: x, session: j.session, then: j.session ? `proc job archived --module ${x} --session ${j.session} --usage '<usage read by a route the platform allows>', or --unmeasured "<why none could be read>"` : null })), next: nextL ? `proc layer start --layer ${nextL}` : `proc round open (the completion round), or proc round close when nothing remains` };
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

// A merged job retired early, before its layer's close, when nothing more can reach it this round: no open ask names it
// and no running job of its layer uses it. A record line; its usage row is written by `job archived` from a route the
// platform allows, or named unmeasured. No session is archived.
export function jobRetire(o) {
  const R = repo(o.product), m = o.module; if (!m) refuse('--module <m>');
  const j = loadJob(R, m);
  if (j.state !== 'MERGED') refuse(`${m} reads ${j.state}: a job retires merged (JOB-LIFE §8)`);
  const open = stateListAsks(R).filter((a) => a.status !== 'CLOSED' && (a.from.toLowerCase().startsWith(`${m} #`) || new RegExp(`\\b${m}\\b`).test(a.body)));
  if (open.length) refuse(`asks still name ${m}: ${open.map((a) => a.id).join(', ')}`);
  const x = mod(R, m);
  const users = modules(R).filter((y) => y.layer === x.layer && (y.uses || []).includes(m)).map((y) => [y.id, jobOf(R, y.id)]).filter(([, u]) => u && !DONE.includes(u.state));
  if (users.length) refuse(`running jobs of the layer use ${m}: ${users.map(([id, u]) => `${id} ${u.state}`).join(', ')} (a change to a provider re-opens a user mid-layer)`);
  const commit = saveJob(R, m, { ...j, state: 'RETIRED' }, `${m}: RETIRED`);
  return { commit, retired: m, then: j.session ? `proc job archived --module ${m} --session ${j.session} --usage '<usage read by a route the platform allows>', or --unmeasured "<why none could be read>"` : null };
}
function stateListAsks(R) {
  const e = needEpoch(R);
  let list = []; try { R.fetch(stateBranch(e)); list = R.g(['ls-tree', '-r', '--name-only', `origin/${stateBranch(e)}`, 'asks/']).split('\n').filter(Boolean); } catch { /* none */ }
  return list.map((p) => { const t = stateRead(R, p) || ''; return { id: p.match(/(A\d+)\.md$/)?.[1], status: t.match(/^\*\*Status\*\* · (\S+)/m)?.[1] ?? '', from: t.match(/^\*\*From\*\* · ([A-Z][A-Z0-9-]* #\d+)/m)?.[1] ?? '', body: t }; }).filter((a) => a.id);
}

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
  const round = o.round || (R.read(PLAN) || '').match(/^\*\*Status\*\*.*?\bround (R\d+)\b/m)?.[1] || `R${R.g(['ls-files', '--', R.rel('build/plan/archive')]).split('\n').filter((f) => new RegExp(`/${T}-R\\d+\\.md$`).test(f)).length + 1}`;
  const last = cur.split('\n').map((l) => l.split(',')).filter((c) => c[1] === 'job' && c[3] === m).pop();
  const j = jobOf(R, m);
  const rev = last?.[10] || (j ? (/^review · .* · approved/.test(j.review || '') || (j.merges || []).some((x) => !/reviews:0$/.test(x)) ? 'yes' : j.review ? 'no' : 'unknown') : 'unknown');
  R.write(csv, `${cur}${['', 'defect', last?.[2] || j?.name || '', m, '', '', '', '', '', '', rev, `${T} ${round}: ${String(o.what).replace(/[,\n]/g, ' ')}`].join(',')}\n`);
  return { commit: commitPush(R, TRANCHE, [csv], `metrics ${T}: defect in ${m} (merge reviewed: ${rev})`), reviewed: rev, tranche: T, round };
}
