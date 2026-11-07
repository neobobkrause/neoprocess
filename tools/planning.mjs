// planning (build/requirements/planning.md; REQUIREMENTS.md §6): tranches, rounds and layers as the only structure a build
// has; work found while a round runs placed at once; a stop and a resume as records; the tranche report with the process's
// own overhead measured. Extracted from proc-legacy (N2-16 to N2-18); tools/proc.mjs re-exports what it still calls.
//
// planning uses `platform` (the grant check), `record`, `requirements` and `architecture` (the words check, the whole-product
// checks), all earlier in the order, and imports them (K29). What a tranche's close needs from later modules (the open asks:
// sessions or messages; the artifacts' regeneration: gate) is given by the caller as `deps`; one not given is refused,
// never skipped (R2).
//
// Every path read or written is under the product's own repository (R9): a path a caller names is refused outside it.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { TRANCHE, refuse, repo, ghRepo, readRole, recordLocal, ROLE_FILE, unpushed, commitPush, pruneRef, epoch, needEpoch, stateRead, stateList, stateWrite, parsePlan, planEdit, jobFiles, jobLines, stop as recordStop, resume as recordResume, pinOf, PLAN_FILE, metricsFile, CHOICES } from './record.mjs';
import { parse } from './requirements.mjs';
import { grantsHeld } from './platform.mjs';
import { run as runChecks } from '../checks/run.mjs';
import { checkWords, WORDS_CONFIG } from '../checks/words.mjs';

const SESSION = /^session_[0-9A-Za-z]+$/;
const NAME = /^[A-Z][A-Z0-9-]* #\d+$/;
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const on = (R, want) => { const b = R.branch(); if (b !== want) refuse(`check out ${want} first (on ${b})`); };
const owe = (p, acts) => ({ ...p, owed: [...new Set([...p.owed, ...acts])] });
const clear = (p, act) => ({ ...p, owed: p.owed.filter((x) => x !== act) });
const one = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();

export const PLAN = PLAN_FILE, NEXT = 'build/plan/next.md', ARCHIVE = 'build/plan/archive';
export const PLAN_LIMIT = 51200;                   // a round's plan (SESSIONS §6.3)
export const completionFile = (T) => `build/plan/${T}-completion.md`;
export const reportFile = (T) => `${ARCHIVE}/${T}-report.md`;
// The stages INT-5 names, proven at their first real run: Bob is told when one runs for the first time under a version.
export const STAGES = ['completion round', 'tranche close', 'merge to main', 'release cut', 'deployment', 'release walk'];
// P19's three reasons, the only ones an entry leaves the tranche for (R6; PLN-2): an entry of the next tranche's list carries
// `hard reason: <reason>`, the reason beginning as the format check reads it (`checks/format.mjs` NEXT_REASONS, rulebook
// PLN 2; restated here, since planning does not use architecture).
export const DEFER_REASONS = Object.freeze({ bob: "Bob's decision, not yet made", deployment: 'a deployment that cannot happen inside the tranche', measurement: 'a measurement that cannot happen inside the tranche', outside: 'outside the product: something that does not yet exist' });
export const HARD_REASON = /^(?:Bob's|a deployment|a measurement|outside the product)/i;

// ---- the product's own paths (R9; PLN-7) ----

// A path a caller names, as the product-relative path it is; refused when it resolves outside the product's repository.
export function within(R, p, what = 'path') {
  if (typeof p !== 'string' || !p) refuse(`${what}: a path in the product`);
  const abs = isAbsolute(p) ? p : resolve(R.dir, p), r = relative(R.root, abs);
  if (r.startsWith('..') || isAbsolute(r)) refuse(`${what} ${p} is outside the product's repository (${R.root}): planning reads and writes the product's own paths only (PLN-7)`);
  return relative(R.dir, abs);
}

// ---- the plan's text ----

// The tranche's id lives in the plan's title (`# Plan: … D3`), never in a branch name (JOB-LIFE §1). R, or any { read }.
export function tranche(R) {
  const text = R.read(PLAN) ?? refuse(`${PLAN}: no running plan on this checkout`);
  return { id: titleId(text) ?? refuse(`${PLAN}: the title names no tranche id (\`# Plan: … T<n>\`)`), text };
}
const titleId = (text) => String(text || '').match(/^# Plan: .*?\b([A-Z]+\d+[a-z]?)\s*$/m)?.[1] ?? null;
export const planSections = (text) => [...new Set([...String(text).matchAll(/^## Layer (\d+)/gm)].map((x) => Number(x[1])))].sort((a, b) => a - b);
// The plan's entries, each under its layer and its module group (`## Layer <n>`, `**<module>**`, `- <id> · …`), with a
// deferral read beside it; lines outside a module group are findings of `planFindings`.
export function entries(text) {
  const out = [];
  let layer = null, mod = null;
  for (const l of String(text || '').split('\n')) {
    const h = l.match(/^## Layer (\d+)/);
    if (h) { layer = Number(h[1]); mod = null; continue; }
    if (/^#{1,2} /.test(l) || /^---\s*$/.test(l)) { layer = null; mod = null; continue; }
    if (layer === null) continue;
    const g = l.match(/^\*\*([a-z][a-z0-9-]*)\*\*\s*$/);
    if (g) { mod = g[1]; continue; }
    const e = l.match(/^- (\S+?) · (.*)$/);
    if (!e) continue;
    const at = e[2].indexOf('hard reason: ');
    out.push({ id: e[1], layer, module: mod, text: l, deferred: at < 0 ? null : e[2].slice(at + 'hard reason: '.length).replace(/^[*_\s]+|[*_\s]+$/g, ''), ids: canonIds(e[2]) });
  }
  return out;
}
// The canon ids an entry cites before its first colon (`PLN-2, PLN-4: …`).
const canonIds = (s) => [...new Set([...String(s).split(/:\s/)[0].matchAll(/\b([A-Z]{2,4}-\d+)\b/g)].map((x) => x[1]))];
// What is wrong with a plan's text, as findings (R3, R6; PLN-2): a title without a tranche id, no layer section, over the
// size limit, an entry outside a module group, a group naming no module of that layer, a deferral for a reason P19 does not
// give, and a cited canon id that the module's own requirements file does not cite (read with `requirements.parse`).
export function planFindings(R, text) {
  const f = [], t = String(text || '');
  if (!titleId(t)) f.push('the plan\'s title names the tranche: `# Plan: … T<n>`');
  if (!planSections(t).length) f.push('the plan has no `## Layer <n>` section');
  const size = Buffer.byteLength(t, 'utf8');
  if (size > PLAN_LIMIT) f.push(`the plan is ${size} bytes; the limit is ${PLAN_LIMIT} (SESSIONS §6): a larger set is two rounds`);
  const mods = R ? modulesOf(R) : null;
  for (const e of entries(t)) {
    if (!e.module) { f.push(`layer ${e.layer}: entry ${e.id} is under no module group (\`**<module>**\`)`); continue; }
    const m = mods?.find((x) => x.id === e.module);
    if (mods && mods.length && !m) f.push(`layer ${e.layer}: ${e.module} is no module of build/modules.json`);
    else if (m && m.layer !== e.layer) f.push(`${e.id}: ${e.module} is in layer ${m.layer}, not ${e.layer}`);
    if (e.deferred !== null && !HARD_REASON.test(e.deferred)) f.push(`${e.id}: its hard reason "${e.deferred.slice(0, 60)}" is none of P19's: Bob's decision, a deployment or a measurement that cannot happen inside the tranche, something outside the product`);
    const req = R && e.ids.length ? R.read(`build/requirements/${e.module}.md`) : null;
    if (req !== null && req !== undefined) {
      // every live statement's line, by the ids `parse` reads (a statement under a header parse does not read as a service
      // is still the module's requirement)
      const live = new Set(parse(req).ids.live), cited = req.split('\n').filter((l) => live.has(l.match(/^- \*\*(R\d+)\*\*/)?.[1])).join('\n');
      for (const id of e.ids) if (!new RegExp(`\\b${id}\\b`).test(cited)) f.push(`${e.id}: cites ${id}, which build/requirements/${e.module}.md does not`);
    }
  }
  return f;
}
const modulesOf = (R) => { try { const all = JSON.parse(R.read('build/modules.json') || '[]'); return Array.isArray(all) ? all : all.modules || []; } catch { return []; } };
const checked = (R, text, what) => { const f = planFindings(R, text); if (f.length) refuse(`${what}: ${f.join('; ')}`); return text; };
// The same, refusing only a finding the text before did not have (a plan's own earlier finding is BOB's, not this act's).
const checkedNew = (R, before, text, what) => { const had = new Set(before === null ? [] : planFindings(R, before)), f = planFindings(R, text).filter((x) => !had.has(x)); if (f.length) refuse(`${what}: ${f.join('; ')}`); return text; };

// ---- the archive ----

// The last archived plan by tranche number and round (issue 76: the last file in the folder was a report, so none was found).
export const archivedTranche = (R) => R.g(['ls-files', '--', R.rel(ARCHIVE)]).split('\n').map((f) => f.match(/\/([A-Z]+)(\d+)([a-z]?)-R(\d+)\.md$/)).filter(Boolean).sort((a, b) => Number(a[2]) - Number(b[2]) || a[3].localeCompare(b[3]) || Number(a[4]) - Number(b[4])).pop()?.slice(1, 4).join('') ?? null;
const roundFiles = (R, T) => R.g(['ls-files', '--', R.rel(ARCHIVE)]).split('\n').filter((f) => new RegExp(`/${T}-R\\d+\\.md$`).test(f)).map((f) => relative(R.dir, join(R.root, f)));
export const roundNumber = (R, T) => roundFiles(R, T).length + 1;
// The tranche's id for a metrics row: the running plan's, or between rounds and after the last one the archived plan's
// (BOB #3, 29 Oct: `refused routed` after the last round's close found no running plan; DRYRUN §4.19).
export const trancheId = (R, given) => given || (R.read(PLAN) ? tranche(R).id : archivedTranche(R) ?? refuse(`${PLAN}: no running plan and no archived one: --tranche <T>`));

// ---- rounds (R3; PLN-3, PLN-4): a round's plan becomes current whole, refused while another round runs ----

// `--plan-file` names the round's plan in the product; `--completion` opens the tranche's completion round file, which
// needs no approval and is distinct from the next tranche's list (`next.md`).
export function roundOpen(o) {
  const R = repo(o.product); on(R, TRANCHE);
  if (!o.completion) within(R, o.planFile, '--plan-file');
  const cur = R.read(PLAN), plan = epoch(R) ? parsePlan(stateRead(R, 'plan.md') || '') : { layers: {} };   // a tranche opens before its epoch
  if (cur) { const open = planSections(cur).filter((l) => plan.layers[l] !== 'CLOSED'); if (open.length) refuse(`a round is running: layer(s) ${open.join(', ')} of the current plan not closed (close the round first)`); }
  const curT = cur ? tranche(R).id : archivedTranche(R);   // between rounds the archive names the tranche
  const file = o.completion ? (curT ? completionFile(curT) : refuse('--completion: no tranche is running')) : within(R, o.planFile, '--plan-file');
  const text = R.read(file) ?? refuse(`${file}: no such file`);
  checked(R, text, file);
  const T = titleId(text);
  if (curT && curT !== T && !o.newTranche) refuse(`the current plan is ${curT}'s; a plan for ${T} opens with a new tranche`);
  R.write(PLAN, text);
  const paths = [PLAN];
  if (o.completion) { rmSync(join(R.dir, file)); paths.push(file); }   // the completion round's file moves into place
  const n = roundNumber(R, T), commit = commitPush(R, TRANCHE, paths, `plan ${T}: round R${n} opens${o.completion ? ' (the completion round)' : ''}`);
  if (epoch(R)) planEdit(R, (p) => ({ ...p, layers: {} }), 'round opens');
  return { tranche: T, round: n, commit, layers: planSections(text), from: file };
}
// Every layer closed, nothing owed, every job archived: the plan is archived whole. The next round's plan: `--next <file>`;
// else the tranche's completion round (issue 73, PLN-4); else `next.md` only when its title names this tranche. Any other
// `next.md` is the next tranche's and stays where it is.
export function roundClose(o) {
  const R = repo(o.product); on(R, TRANCHE);
  const { id: T, text } = tranche(R), plan = parsePlan(stateRead(R, 'plan.md') || '');
  const open = planSections(text).filter((l) => plan.layers[l] !== 'CLOSED');
  if (open.length) refuse(`layer(s) ${open.join(', ')} not closed`);
  if (plan.owed.length) refuse(`acts still owed: ${plan.owed.join('; ')}`);
  const live = jobLines(R, needEpoch(R)).filter((j) => j.state !== 'ARCHIVED');
  if (live.length) refuse(`jobs not archived: ${live.map((j) => `${j.module} ${j.state}`).join('; ')}`);
  const n = roundNumber(R, T), arch = `${ARCHIVE}/${T}-R${n}.md`;
  R.write(arch, text);
  const nextOf = (f) => { const t = R.read(f); return t === null ? null : { f, t }; };
  const cand = o.next ? (nextOf(within(R, o.next, '--next')) ?? refuse(`--next ${o.next}: no such file`)) : nextOf(completionFile(T)) ?? (() => { const c = nextOf(NEXT); return c && titleId(c.t) === T ? c : null; })();
  const paths = [arch, PLAN];
  if (cand) { checked(R, cand.t, cand.f); R.write(PLAN, cand.t); rmSync(join(R.dir, cand.f)); paths.push(cand.f); } else rmSync(join(R.dir, PLAN));
  const commit = commitPush(R, TRANCHE, paths, `plan ${T}: round R${n} closes${cand ? `; ${cand.f === completionFile(T) ? 'the completion round' : 'the next plan'} is current` : ''}`);
  planEdit(R, (p) => ({ ...p, layers: {} }), `round R${n} closed`);
  return { tranche: T, round: n, archived: arch, next: cand?.f ?? null, completion: cand?.f === completionFile(T), commit };
}

// ---- the tranche (R1, R2; PLN-1, PLN-2) ----

// A tranche opens from main's tip on the fixed branch `tranche` (JOB-LIFE §1): the branch, when it exists, is fast-forwarded
// to main (which holds it whole once the close PR has merged; a tip not on main is a running tranche), and the plan is
// copied whole from `next.md` to `current.md`: its title names the tranche, its Status line the pinned process commit
// (MNT-3), its legacy census comes before its first layer (PLN 8). Refused while an archived plan on main reads CLOSING,
// while the words check reports a finding (where the product configures it, `build/words.json`, as the checks' runner
// runs it), or while the grant check is missing, failed or older than a day (platform's `grantsHeld`).
export async function trancheOpen(o) {
  const R = repo(o.product);
  const held = grantsHeld(R); if (held) refuse(held);   // PERMISSIONS §10.3: a missing grant stops the opening, never a step
  if (R.read(WORDS_CONFIG) !== null) { const w = (await checkWords(R.dir)).failures.map((f) => (typeof f === 'string' ? f : f.finding)); if (w.length) refuse(`the words check reports ${w.length} finding(s): ${w.slice(0, 5).join('; ')}`); }
  R.fetch('main', TRANCHE);
  const tip = R.g(['rev-parse', 'origin/main']);
  if (R.heads(`refs/heads/${TRANCHE}`).length) { try { R.g(['merge-base', '--is-ancestor', `origin/${TRANCHE}`, tip]); } catch { refuse(`${TRANCHE} holds work not on main: the running tranche closes first (its close PR merged, recorded by \`proc tranche merged\`)`); } }
  const closing = R.g(['ls-tree', '-r', '--name-only', 'origin/main', '--', R.rel(ARCHIVE)]).split('\n').filter(Boolean).filter((f) => /\*\*Status\*\* · CLOSING/.test(R.g(['show', `origin/main:${f}`])));
  if (closing.length) refuse(`an archived plan still reads CLOSING on main: ${closing.join(', ')}`);
  let text; try { text = R.g(['show', `${tip}:${R.rel(NEXT)}`]) + '\n'; } catch { refuse(`${NEXT} is not on main: the next tranche's plan is written there first (P18)`); }
  checked(R, text, NEXT);
  const pin = text.match(/^\*\*Status\*\* · .*?pinned at `([0-9a-f]{7,40})`/m)?.[1] ?? refuse(`${NEXT}: its Status line names the pinned process commit (\`**Status** · … pinned at \`<commit>\`\`; MNT-3)`);
  const census = text.search(/^\*\*The legacy census\*\*/m), first = text.search(/^## Layer \d+/m);
  if (census < 0 || census > first) refuse(`${NEXT}: its legacy census (\`**The legacy census**\`, "none" when there is none) comes before its first layer (PLN 8)`);
  R.g(['push', '-q', 'origin', `${tip}:refs/heads/${TRANCHE}`]);   // a fast-forward, or the branch made
  R.fetch(TRANCHE);
  try { R.g(['checkout', '-q', '-B', TRANCHE, `origin/${TRANCHE}`]); } catch { refuse(`could not check out ${TRANCHE}: commit or stash the checkout first`); }
  const T = titleId(text);
  R.write(PLAN, text); rmSync(join(R.dir, NEXT));
  const n = roundNumber(R, T), commit = commitPush(R, TRANCHE, [PLAN, NEXT], `plan ${T}: the tranche opens, round R${n}, the process pinned at ${pin}`);
  if (epoch(R)) planEdit(R, (p) => ({ ...p, layers: {} }), 'round opens');
  return { tranche: T, from: tip.slice(0, 7), round: n, commit, layers: planSections(text), pin };
}

// A tranche already running when the product came under neoProcess (issue 69: Civicsmith's T53, on `tranche/T53`, paused by
// Bob; onboarding's record says it resumes under the new process) is carried onto the fixed branch `tranche` once, by the
// first BOB, before the first epoch: the branch is made from the running branch's tip, `main` is merged in (never a rebase,
// P12) with `main`'s text winning every conflict, and the old plan is archived, so the work that remains opens as the
// tranche's next round (`proc round open`, written from what remains, P19). The old process's sessions named in its record
// are listed: they are not this process's, get no message, and are Bob's to archive if he wants (GOV 9).
export function trancheCarry(o) {
  if (!NAME.test(o.name || '') || !/^BOB /.test(o.name) || !SESSION.test(o.session || '')) refuse('--from <the branch the running tranche is on> --name "BOB #<n>" --session <your session id>');
  const R = repo(o.product), from = o.from;
  if (typeof from !== 'string' || !from || from === TRANCHE || from === 'main') refuse('--from <the branch the running tranche is on>');
  if (epoch(R)) refuse(`epoch ${epoch(R)} is open: a tranche is carried only before the first epoch`);
  if (R.heads(`refs/heads/${TRANCHE}`).length) refuse(`${TRANCHE} exists on the remote: nothing to carry (open the epoch on it)`);
  if (R.g(['status', '--porcelain', '--untracked-files=no'])) refuse('the checkout has uncommitted changes: commit or drop them first');
  // the BOB's role, before any epoch: the carry's own acts (the prune dispatches, a message to ROOT) need one; takeover re-records it
  const me = readRole(R.root);
  if (me && me.session !== o.session) refuse(`this checkout's role is recorded for ${me.name ?? me.role} (${me.session})`);
  if (!me) recordLocal(R.root, ROLE_FILE, { role: 'bob', product: R.rel('.'), session: o.session, name: o.name });
  // git cannot hold `tranche` beside `tranche/*` (a ref is a file or a directory, never both; measured in the fixture, 30 Oct):
  // every `tranche/*` tip not on main is kept as `carried/<name>`, then the old names are pruned by the product's workflow,
  // which checks each tip is on main or a carried branch; then the command, run again, makes `tranche`
  const olds = R.heads('refs/heads/tranche/*'), keep = (h) => `carried/${h.slice('tranche/'.length)}`, kept = [];
  if (olds.length) {
    R.fetch('main', ...olds);
    const pruned = [];
    for (const h of olds) {
      let onMain = false; try { R.g(['merge-base', '--is-ancestor', `origin/${h}`, 'origin/main']); onMain = true; } catch { /* not provably */ }
      if (!onMain) { R.g(['push', '-q', 'origin', `origin/${h}:refs/heads/${keep(h)}`]); kept.push(keep(h)); }
      pruned.push(pruneRef(R, h));
    }
    const owed = pruned.filter((x) => !x.deleted);
    if (owed.length) return { phase: 'prune', kept, dispatches: owed.map((x) => x.dispatch), next: `make each dispatch above (the product's prune workflow deletes each old name after checking its tip is on main or on a carried branch); once every run has passed, run this command again, unchanged` };
  }
  const src = R.heads(`refs/heads/${from}`).length ? from : from.startsWith('tranche/') && R.heads(`refs/heads/${keep(from)}`).length ? keep(from) : refuse(`${from} is not on the product's remote (nor kept as ${from.startsWith('tranche/') ? keep(from) : 'a carried branch'})`);
  R.fetch('main', src);
  const tip = R.g(['rev-parse', `origin/${src}`]);
  const base = () => { try { return R.g(['merge-base', `origin/${src}`, 'origin/main']); } catch { return null; } };
  if (!base()) { try { R.g(['fetch', '-q', '--unshallow', 'origin', `+refs/heads/main:refs/remotes/origin/main`, `+refs/heads/${src}:refs/remotes/origin/${src}`]); } catch { /* not shallow */ } }
  if (!base()) refuse(`${src} and main share no history: a carry merges main into the running tranche, so they must`);
  const mainChanged = R.g(['diff', '--name-only', base(), 'origin/main']).split('\n').filter(Boolean);
  R.g(['checkout', '-q', '-B', TRANCHE, `origin/${src}`]);
  const m = spawnSync('git', ['-C', R.root, 'merge', '--no-ff', '--no-edit', '-m', `tranche carried from ${src}: main merged in, main's text wins every conflict`, 'origin/main'], { encoding: 'utf8' });
  const conflicts = m.status === 0 ? [] : R.g(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
  for (const f of conflicts) {
    let onMain = true; try { R.g(['cat-file', '-e', `origin/main:${f}`]); } catch { onMain = false; }
    if (onMain) { R.g(['checkout', '--theirs', '--', f]); R.g(['add', '--', f]); } else R.g(['rm', '-q', '--', f]);
  }
  if (m.status !== 0) {
    if (R.g(['diff', '--name-only', '--diff-filter=U'])) { spawnSync('git', ['-C', R.root, 'merge', '--abort']); refuse(`the merge of main could not be completed: ${(m.stderr || m.stdout || '').trim().split('\n').pop()}`); }
    R.g(['commit', '-q', '--no-edit']);
  }
  const old = R.read(PLAN), paths = [];
  let archived = null;
  if (old) {
    // an old process's title may lack the colon (`# Plan T53 · …`): its first tranche id is taken
    const T = old.match(/^# Plan:? .*?\b([A-Z]+\d+[a-z]?)\b/m)?.[1] ?? refuse(`${PLAN} on ${src}: its title names no tranche id`);
    archived = `${ARCHIVE}/${T}-R${roundNumber(R, T)}.md`;
    R.write(archived, old); rmSync(join(R.dir, PLAN)); paths.push(archived, PLAN);
  }
  const record = [old, R.read('build/handoff.md')].filter(Boolean).join('\n');
  const oldSessions = [...new Set([...record.matchAll(/\b([A-Z][A-Z0-9 -]*? #\d+)\b[^\n#]{0,12}?\b(session_[0-9A-Za-z]{10,})/g)].map((x) => `${x[1]} ${x[2]}`))];
  const lastBob = Math.max(0, ...[...record.matchAll(/\bBOB #(\d+)/g)].map((x) => Number(x[1])));
  const commit = paths.length ? commitPush(R, TRANCHE, paths, `tranche carried from ${src}: its plan archived; the work that remains opens as the next round`) : (R.g(['push', '-q', 'origin', `HEAD:refs/heads/${TRANCHE}`]), R.g(['rev-parse', '--short', 'HEAD']));
  // the old names' local tracking refs block `origin/tranche` (issue 72: "cannot lock ref"): dropped, nothing on the remote
  for (const ref of R.g(['for-each-ref', '--format=%(refname)', `refs/remotes/origin/${TRANCHE}/`]).split('\n').filter(Boolean)) R.g(['update-ref', '-d', ref]);
  R.fetch(TRANCHE); R.g(['branch', '-q', '--set-upstream-to', `origin/${TRANCHE}`]);
  return { phase: 'carried', tranche: TRANCHE, from: src, kept, tip: tip.slice(0, 7), commit, mainChanged: mainChanged.length, conflicts, archived, lastBob: lastBob || null, oldSessions,
    next: `run \`proc epoch open\`, then \`proc takeover\`; then write the work that remains of ${archived ?? 'the carried tranche'} as the next round's plan, from what remains (P19), and open it with \`proc round open\` (a module's branch the old process left unmerged, \`job/<tranche>/<module>\`, is taken in by that module's job: its entry names \`proc job takein --branch <it> --sha <its tip>\`, JOB-LIFE §1a). The old process's sessions listed are not this process's: send them nothing; they are Bob's to archive if he wants (GOV 9)` };
}

// The merge base of a and b, deepening a shallow clone until it is found (D25: deepening never moves a ref already held).
function base(R, a, b) {
  const mb = () => { try { return R.g(['merge-base', a, b]); } catch { return null; } };
  const named = [a, b].filter((x) => x.startsWith('origin/')), refs = named.map((x) => `+refs/heads/${x.slice(7)}:refs/remotes/${x}`);
  const held = Object.fromEntries(named.map((x) => { try { return [x, R.g(['rev-parse', '--verify', '-q', `refs/remotes/${x}`])]; } catch { return [x, null]; } }));
  for (let depth = 200; ; depth *= 5) {
    const found = mb();
    if (found || R.g(['rev-parse', '--is-shallow-repository']) !== 'true') return found;
    R.g(depth > 125000 ? ['fetch', '-q', '--unshallow', 'origin', ...refs] : ['fetch', '-q', `--deepen=${depth}`, 'origin', ...refs]);
    for (const [x, sha] of Object.entries(held)) if (sha) R.g(['update-ref', `refs/remotes/${x}`, sha]);
  }
}
// The whole-product checks' findings at a commit (architecture's `run`, never written to the result file here).
const findingsAt = async (R, ref, fetch = false) => new Set((await runChecks(R.dir, { ref, fetch, write: false })).findings.map((f) => f.finding));

// JOB-LIFE §1, §10; P12: every round archived, every job merged and archived, no ask open, nothing owed; main merged in
// (never a rebase); the artifacts and the whole-product checks once more, a finding the tranche's base had not this close's;
// the plan's archive written with each entry's outcome and the tranche's measured usage (the tranche report, R7); the plan
// CLOSING; the one close PR printed and owed.
// deps (later modules, K29): { asks(R) → open ask ids, regenerate(R) → { changed, stale } }, given by the caller.
export async function trancheClose(o, deps = {}) {
  for (const [k, what] of [['asks', 'the open asks'], ['regenerate', "the artifacts' regeneration"]]) if (typeof deps[k] !== 'function') refuse(`tranche close: ${what} (deps.${k}) not given: the tranche does not close`);
  const R = repo(o.product); on(R, TRANCHE);
  const e = needEpoch(R), plan = parsePlan(stateRead(R, 'plan.md') || '');
  if (R.read(PLAN)) refuse(`a round is open (${PLAN} exists): close it first`);
  if (plan.owed.length) refuse(`acts still owed: ${plan.owed.join('; ')}`);
  const open = deps.asks(R) || []; if (open.length) refuse(`asks still open: ${open.join(', ')}`);
  const live = [...jobFiles(R), ...stateList(R, 'lanes')].filter((p) => /· LIVE |· (STARTING|WORKING|WAITING|BLOCKED|NEEDS BOB|COMPLETE|REOPENED|MERGED)/.test(stateRead(R, p) || ''));
  if (live.length) refuse(`sessions still live: ${live.join(', ')} (retire and archive them first)`);
  const T = archivedTranche(R) ?? refuse(`no round of the tranche is archived under ${ARCHIVE}/`);
  const abandoned = Object.entries(plan.stop?.choices || {}).filter(([, c]) => c === 'abandoned').map(([m]) => m);
  const out = new Set(entries(R.read(NEXT) || '').filter((x) => x.deferred !== null).map((x) => x.id)), done = mergedModules(R, T, e);
  const unmerged = entries(roundFiles(R, T).map((f) => R.read(f) || '').join('\n')).filter((x) => x.module && !out.has(x.id) && !abandoned.includes(x.module) && !done.has(x.module));
  if (unmerged.length) refuse(`entries whose module's job is not merged: ${[...new Set(unmerged.map((x) => `${x.module} (${x.id})`))].join(', ')}`);
  if (unpushed(R).length) refuse(`the tranche checkout is not pushed: ${unpushed(R).join('; ')}`);
  R.fetch('main'); base(R, 'origin/main', 'HEAD');
  try { R.g(['merge', '-q', '--no-edit', 'origin/main']); } catch { spawnSync('git', ['-C', R.root, 'merge', '--abort']); refuse('merging main into the tranche conflicts: resolve it by hand on the tranche, then close again'); }
  const art = deps.regenerate(R);
  if (art.stale.length) refuse(`artifacts stale after regenerating: ${art.stale.join(', ')}`);
  if (art.changed.length) { R.g(['add', '--', ...art.changed.map(R.rel)]); R.g(['commit', '-q', '-m', `artifacts regenerated at the tranche's close: ${art.changed.join(', ')}`]); }
  const found = await findingsAt(R, 'HEAD', true);
  if (found.size) {
    const start = base(R, 'origin/main', 'HEAD') ?? refuse('no common history with main');
    const old = await findingsAt(R, start), added = [...found].filter((x) => !old.has(x));
    if (added.length) refuse(`checks: ${added.length} finding(s) new since the tranche opened: ${added.slice(0, 10).join('; ')}`);
  }
  // the tranche's report, the archive of its plan with each entry's outcome and its measured usage (R2, R7)
  const rep = report({ product: o.product, tranche: T, stages: ['tranche close'], epoch: e });
  R.write(reportFile(T), rep.text);
  R.g(['add', '--', R.rel(reportFile(T))]); R.g(['commit', '-q', '-m', `${T}: the tranche report, each entry's outcome and its usage`]);
  // The epoch ends with the tranche (PROTOCOL §7d): its closed line goes into the close PR, since nothing is pushed to
  // the tranche once main holds it whole (§1); `epoch close` then only deletes the state branch.
  const elog = R.read('build/epochs.md');
  if (elog && new RegExp(`^- ${e} · opened \\S+$`, 'm').test(elog)) {
    R.write('build/epochs.md', elog.replace(new RegExp(`^- ${e} · opened (\\S+)$`, 'm'), `- ${e} · opened $1 · closed ${today()} with ${T}`));
    R.g(['add', '--', R.rel('build/epochs.md')]); R.g(['commit', '-q', '-m', `epoch ${e} closes with ${T}`]);
  }
  R.g(['push', '-q', 'origin', `HEAD:refs/heads/${TRANCHE}`]);
  const commit = planEdit(R, (p) => ({ ...owe(p, [`merge ${TRANCHE}`]), state: 'CLOSING' }), `${T}: CLOSING`);
  const tip = R.g(['rev-parse', 'HEAD']);
  return { tranche: T, head: tip.slice(0, 7), commit, report: reportFile(T), pr: { ...ghRepo(R), title: `${T}: close`, head: TRANCHE, base: 'main', body: `The tranche ${T} closes: every round archived under ${ARCHIVE}/, every job merged and archived, the checks green over the whole product. Its report: ${reportFile(T)}.\n\n${rep.text}`.slice(0, 60000), draft: false }, merge: { tool: 'merge_pull_request', ...ghRepo(R), pullNumber: '<the PR\'s number>', merge_method: 'merge', expectedHeadSha: tip }, then: `create the PR, merge it by the printed call once it is mergeable (the hook passes it at CLOSING with expectedHeadSha the tranche's tip), then proc tranche merged --sha <merge commit>` };
}
// The close PR's merge recorded: the commit is on main and holds the tranche's tip; the plan CLOSED. The branch stays
// (the ruleset refuses its deletion) and the next `tranche open` fast-forwards it.
export function trancheMerged(o) {
  const R = repo(o.product), sha = String(o.sha || ''); if (!/^[0-9a-f]{7,40}$/.test(sha)) refuse('--sha <merge commit>');
  const plan = parsePlan(stateRead(R, 'plan.md') || '');
  if (plan.state !== 'CLOSING') refuse(`the plan reads ${plan.state ?? 'nothing'}, not CLOSING: run proc tranche close first`);
  R.fetch('main', TRANCHE);
  let full; try { full = R.g(['rev-parse', '--verify', `${sha}^{commit}`]); } catch { refuse(`${sha}: not a commit this clone sees after fetching main`); }
  try { R.g(['merge-base', '--is-ancestor', full, 'origin/main']); } catch { refuse(`${sha} is not on main`); }
  let head = null; try { head = R.g(['rev-parse', `origin/${TRANCHE}`]); } catch { /* gone */ }
  if (head) { try { R.g(['merge-base', '--is-ancestor', head, full]); } catch { refuse(`${TRANCHE}'s tip ${head.slice(0, 7)} is not in ${sha}`); } }
  const commit = planEdit(R, (p) => ({ ...clear(p, `merge ${TRANCHE}`), state: 'CLOSED' }), `tranche merged ${full.slice(0, 7)}`);
  return { commit, merged: full.slice(0, 7), then: 'proc epoch close (after the archives), then the next tranche opens from main (the branch is fast-forwarded)' };
}

// ---- a layer started in part (R4; PLN-8) ----

const PART = /^\*\*Started in part\*\* · (\S+) · ([a-z0-9-]+(?:, [a-z0-9-]+)*) · (.+)$/;
// The parts recorded under a layer's section: [{ date, modules, reason }].
export function partsOf(text, layer) {
  const sec = String(text || '').split(/^(?=## )/m).find((s) => new RegExp(`^## Layer ${layer}\\b`).test(s)) || '';
  return sec.split('\n').map((l) => l.match(PART)).filter(Boolean).map((m) => ({ date: m[1], modules: m[2].split(', '), reason: m[3] }));
}
// Refused unless the layer has a section, every module named has entries in it, and the reason is given.
export function partialCheck(text, layer, modules, reason) {
  const L = Number(layer), mods = [...new Set((Array.isArray(modules) ? modules : String(modules || '').split(',')).map((m) => m.trim()).filter(Boolean))];
  if (!planSections(text).includes(L)) refuse(`layer ${layer} has no section in ${PLAN}`);
  if (!mods.length) refuse('a part names its modules');
  if (!one(reason)) refuse(`a layer started in part names the architecture session's reason (--reason; PLN-8): ${mods.join(', ')}`);
  const inLayer = [...new Set(entries(text).filter((e) => e.layer === L && e.module).map((e) => e.module))];
  const bad = mods.filter((m) => !inLayer.includes(m));
  if (bad.length) refuse(`${bad.join(', ')}: no entries in layer ${L}`);
  return { layer: L, modules: mods, rest: inLayer.filter((m) => !mods.includes(m)), reason: one(reason).replace(/\s*·\s*/g, '; ') };
}
// The part written under the layer's heading in the durable plan, committed on the tranche: the subset is on the record, and
// the rest start once it has merged.
export function partial(R, layer, modules, reason) {
  on(R, TRANCHE);
  const text = R.read(PLAN) ?? refuse(`${PLAN}: no running plan on this checkout`);
  const p = partialCheck(text, layer, modules, reason);
  const line = `**Started in part** · ${today()} · ${p.modules.join(', ')} · ${p.reason}`;
  R.write(PLAN, text.replace(new RegExp(`^(## Layer ${p.layer}\\b.*\\n)`, 'm'), `$1\n${line}\n`));
  return { ...p, commit: commitPush(R, TRANCHE, [PLAN], `plan: layer ${p.layer} started in part (${p.modules.join(', ')})`) };
}

// ---- stop and resume (R5; PLN-5, MNT-3, MNT-4) ----

const architect = (R) => { const r = readRole(R.root); if (r?.role !== 'bob') refuse('a stop or a resume is the architecture session\'s (BOB\'s) act: run it from BOB\'s checkout'); return r; };
const durableStatus = (R) => (R.read(PLAN) || '').match(/^\*\*Status\*\* · .*$/m)?.[0] ?? null;
// The stop's choices: `planning complete-allowed, jobs abandoned` (or `planning:complete-allowed,…`).
export function choicesOf(s) {
  const out = {};
  for (const part of String(s || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^([a-z][a-z0-9-]*)[\s:=]+(\S+)$/) ?? refuse(`--choices: "${part}" is not <module> ${CHOICES.join('|')}`);
    out[m[1]] = m[2];
  }
  return out;
}
// A stop recorded once, at the pin, with each unmerged job's choice (record.stop refuses a second stop, a missing or an
// unknown choice); mirrored in the durable plan's Status line so it outlives the epoch.
export function stop(o) {
  const R = repo(o.product); architect(R); on(R, TRANCHE);
  const plan = parsePlan(stateRead(R, 'plan.md') || ''), version = pinOf(durableStatus(R), plan) ?? refuse(`no pin: ${PLAN}'s Status line names none (\`pinned at \`<commit>\`\`)`);
  const choices = choicesOf(o.choices), why = one(o.why);
  const stateCommit = recordStop(R, why, choices, version);
  const ch = Object.entries(choices).map(([m, c]) => `${m} ${c}`).join(', ');
  const text = R.read(PLAN);
  const commit = text ? (R.write(PLAN, text.replace(/^(\*\*Status\*\* · .*?)\s*$/m, `$1 STOPPED ${today()} by the architecture session: ${why.replace(/`/g, "'")} at \`${version}\`${ch ? ` (${ch})` : ''}.`)), commitPush(R, TRANCHE, [PLAN], `plan: STOPPED at ${version}`)) : null;
  return { stopped: why, version, choices, state: stateCommit, commit, then: 'every session reads the stop at its next status and takes no new step; the fix is certified, then `proc resume --version <commit>`' };
}
// A resume clears the stop and moves the pin once, to the version the build runs from then on.
export function resume(o) {
  const R = repo(o.product); architect(R); on(R, TRANCHE);
  const v = String(o.version || '');
  if (!/^[0-9a-f]{7,40}$/.test(v)) refuse('--version <the process commit the build runs from>');
  const stateCommit = recordResume(R, v);
  const text = R.read(PLAN);
  const commit = text ? (R.write(PLAN, text.replace(/^(\*\*Status\*\* · .*?)\s*$/m, `$1 RESUMED at \`${v}\` (${today()}; the pin moved once).`)), commitPush(R, TRANCHE, [PLAN], `plan: RESUMED at ${v}`)) : null;
  return { resumed: v, state: stateCommit, commit };
}

// ---- work found while a round runs, placed at once (R6; PLN-2, PLN-3) ----

const LIVE = /^(STARTING|WORKING|WAITING: |BLOCKED: |NEEDS BOB: |COMPLETE|REOPENED)/;
// The entry put under its layer's section and its module's group in a plan's text (both made when absent, in order).
export function withEntry(text, layer, module, line) {
  const lines = String(text).replace(/\n*$/, '\n').split('\n'); lines.pop();
  const secAt = (n) => lines.findIndex((l) => new RegExp(`^## Layer ${n}\\b`).test(l));
  let s = secAt(layer);
  if (s < 0) {
    const later = lines.findIndex((l) => { const m = l.match(/^## Layer (\d+)/); return m && Number(m[1]) > layer; });
    const at_ = later < 0 ? lines.length : later;
    lines.splice(at_, 0, `## Layer ${layer}`, '', ...(later < 0 ? [] : ['']));
    s = at_;
  }
  let end = lines.findIndex((l, i) => i > s && (/^## /.test(l) || /^---\s*$/.test(l)));
  if (end < 0) end = lines.length;
  let g = lines.findIndex((l, i) => i > s && i < end && l.trim() === `**${module}**`);
  if (g < 0) { let ins = end; while (ins > s + 1 && lines[ins - 1].trim() === '') ins--; lines.splice(ins, 0, '', `**${module}**`); g = ins + 1; end += 2; }
  let last = g; while (last + 1 < lines.length && /^- /.test(lines[last + 1])) last++;
  lines.splice(last + 1, 0, line);
  return `${lines.join('\n')}\n`;
}
// o: { product, module, entry (`- <id> · …`), defer (bob | measurement | outside) }. In the running job of its module as a
// CHANGE (its START appended, the message printed for BOB to send); else in the START of its module's job in a layer not
// yet started (the plan's entries); else in the tranche's completion round. Deferred only for P19's three reasons, named
// beside it, to the next tranche's list.
export function place(o) {
  const R = repo(o.product); on(R, TRANCHE);
  const entry = one(o.entry);
  if (!/^- \S+ · \S/.test(entry)) refuse('--entry "- <id> · <ids>: <what>" (one plan entry)');
  const m = modulesOf(R).find((x) => x.id === o.module) ?? refuse(`no module ${o.module} in build/modules.json`);
  const { id: T, text } = tranche(R);
  if (o.defer !== undefined) {
    const reason = DEFER_REASONS[o.defer] ?? refuse(`--defer ${o.defer}: an entry leaves the tranche only for ${Object.keys(DEFER_REASONS).join(', ')} (P19: ${Object.values(DEFER_REASONS).join('; ')})`);
    const nextT = T.replace(/^([A-Z]+)(\d+)[a-z]?$/, (_, p, n) => `${p}${Number(n) + 1}`);
    const cur = R.read(NEXT) ?? `# Plan: the next tranche · ${nextT}\n\n**Status** · DRAFT.\n\n**The legacy census** · to be written.\n`;
    R.write(NEXT, withEntry(cur, m.layer, m.id, `${entry} · hard reason: ${reason}`));
    return { where: 'next tranche', file: NEXT, reason, commit: commitPush(R, TRANCHE, [NEXT], `plan: ${entry.slice(2, 40)} deferred to the next tranche (${reason})`) };
  }
  const e = needEpoch(R), plan = parsePlan(stateRead(R, 'plan.md', e) || '');
  const job = jobLines(R, e).find((j) => j.module === m.id && j.session && LIVE.test(j.state));
  if (job) {
    const message = `CHANGE: an entry placed in your job (P10):\n${entry}`;
    const commit = stateWrite(R, { [`jobs/${m.id}/start.md`]: `${stateRead(R, `jobs/${m.id}/start.md`, e) || ''}\n${message}\n` }, `${m.id}: an entry placed in its running job`, e);
    return { where: 'running job', module: m.id, commit, send: { session_id: job.session, message } };
  }
  if (!plan.layers[m.layer]) {
    R.write(PLAN, checkedNew(R, text, withEntry(text, m.layer, m.id, entry), PLAN));
    return { where: 'start', layer: m.layer, file: PLAN, commit: commitPush(R, TRANCHE, [PLAN], `plan ${T}: ${entry.slice(2, 40)} placed in ${m.id}'s START (layer ${m.layer}, not started)`) };
  }
  const f = completionFile(T), had = R.read(f), cur = had ?? `# Plan: the completion round · ${T}\n\n**Status** · the completion round of ${T}: after the last layer, before the release; it needs no approval (P10).\n`;
  R.write(f, checkedNew(R, had, withEntry(cur, m.layer, m.id, entry), f));
  return { where: 'completion round', layer: m.layer, file: f, commit: commitPush(R, TRANCHE, [f], `plan ${T}: ${entry.slice(2, 40)} placed in the completion round (layer ${m.layer} started)`) };
}

// ---- the tranche report (R7; PLN-6, SES-12, INT-5) ----

const csvRows = (text) => String(text || '').split('\n').slice(1).filter(Boolean).map((l) => l.split(','));
const tokens = (c) => [4, 5, 6, 7].reduce((a, i) => a + (Number(c[i]) || 0), 0);
// The modules whose job merged in the tranche: a merge into the tranche of `job/<m>` (GitHub's "Merge pull request #n
// from <owner>/job/<m>", git's "Merge branch 'job/<m>'"), or the job's line reading MERGED, or ARCHIVED (a job is retired
// only once its work is merged, rulebook INT 8; one abandoned at a stop is named by the stop's choices).
function mergedModules(R, T, e) {
  const out = new Set();
  let since = null; try { since = base(R, 'origin/main', 'HEAD'); } catch { /* none */ }
  const log = R.g(['log', '--merges', '--format=%s', since ? `${since}..HEAD` : 'HEAD']);
  for (const m of log.matchAll(/\bjob\/([a-z0-9-]+)\b/g)) out.add(m[1]);
  if (e) for (const j of jobLines(R, e)) if (j.merged || j.state === 'ARCHIVED') out.add(j.module);
  return out;
}
// The commits of the tranche since main by purpose (P14): product (code or tests), build state (`build/`), docs; merges apart.
export function footprint(o) {
  const R = repo(o.product), ref = o.base || 'origin/main';
  if (ref.startsWith('origin/')) R.fetch(ref.slice(7));
  const b = base(R, ref, 'HEAD') ?? refuse(`${ref} shares no history with HEAD`);
  const pre = R.rel('.') === '.' ? '' : `${R.rel('.')}/`;
  const kinds = { product: 0, 'build state': 0, docs: 0 };
  let merges = 0;
  for (const block of R.g(['log', '--format=@@%P', '--name-only', `${b}..HEAD`]).split('@@').slice(1)) {
    const [parents, ...files] = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (parents.split(' ').length > 1) { merges++; continue; }
    const rel = files.map((f) => (f.startsWith(pre) ? f.slice(pre.length) : `../${f}`));
    if (!rel.length) continue;
    kinds[rel.every((f) => f.startsWith('build/')) ? 'build state' : rel.every((f) => f.startsWith('build/') || f.startsWith('docs/')) ? 'docs' : 'product']++;
  }
  const commits = Object.values(kinds).reduce((a, x) => a + x, 0);
  return { base: b.slice(0, 7), commits, merges, kinds, bookkeeping: commits ? `${Math.round((100 * (commits - kinds.product)) / commits)} %` : '0 %' };
}
// o: { product, tranche, stages (the stages run now, of STAGES), epoch }. Every figure is computed from git and the
// tranche's metrics file; a figure not there is named unknown, never estimated.
export function report(o) {
  const R = repo(o.product), T = o.tranche || trancheId(R);
  const e = o.epoch !== undefined ? o.epoch : epoch(R), plan = e ? parsePlan(stateRead(R, 'plan.md', e) || '') : { stop: null };
  R.fetch('main');
  let since = null; try { since = base(R, 'origin/main', 'HEAD'); } catch { /* none */ }
  const range = since ? `${since}..HEAD` : 'HEAD';
  // elapsed: from the tranche's first commit since main to its last
  const times = R.g(['log', '--format=%ct', range]).split('\n').filter(Boolean).map(Number);
  const elapsedH = times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 360) / 10 : 0;
  // entries: every archived round of the tranche, and the current plan's when one is open
  const texts = [...roundFiles(R, T).map((f) => R.read(f) || ''), ...(R.read(PLAN) && titleId(R.read(PLAN)) === T ? [R.read(PLAN)] : [])];
  const seen = new Map(); for (const x of entries(texts.join('\n'))) seen.set(x.id, x);
  const merged = mergedModules(R, T, e), abandoned = new Set(Object.entries(plan.stop?.choices || {}).filter(([, c]) => c === 'abandoned').map(([m]) => m));
  const completion = entries(R.read(completionFile(T)) || ''), next = entries(R.read(NEXT) || '');
  // deferred: an entry on the next tranche's list with its hard reason, left out of this tranche (R6); a reason an entry of
  // the tranche's own plan carries is why it waited before, not why it waits now
  const out = new Map(next.filter((x) => x.deferred !== null).map((x) => [x.id, x]));
  const all = [...seen.values()].map((x) => ({ ...x, deferred: out.get(x.id)?.deferred ?? null })).map((x) => ({ ...x, outcome: x.deferred !== null ? `deferred: ${x.deferred}` : abandoned.has(x.module) ? 'abandoned at the stop' : merged.has(x.module) ? 'applied' : 'not applied' }));
  const applied = all.filter((x) => x.outcome === 'applied'), notApplied = all.filter((x) => x.outcome !== 'applied' && x.deferred === null);
  const deferred = [...out.values()];
  // legacy lines removed: the net removal in the legacy modules' paths over the tranche
  const legacy = modulesOf(R).filter((m) => m.legacy).flatMap((m) => m.paths || []);
  let added = 0, removed = 0;
  if (legacy.length && since) for (const l of R.g(['diff', '--numstat', since, 'HEAD', '--', ...legacy.map(R.rel)]).split('\n').filter(Boolean)) { const [a, d] = l.split('\t'); added += Number(a) || 0; removed += Number(d) || 0; }
  // cost and overhead from the metrics: tokens by role; a job's sessions; restarts (a job's sessions beyond its first)
  const rows = csvRows(R.read(metricsFile(T))).filter((c) => /^session_/.test(c[0]));
  const byRole = {}; for (const c of rows) byRole[c[1]] = (byRole[c[1]] || 0) + tokens(c);
  const unmeasured = rows.filter((c) => /^unmeasured: /.test(c[11] || '')).map((c) => `${c[2]} (${c[0]})`);
  const total = Object.values(byRole).reduce((a, x) => a + x, 0), jobTokens = byRole.job || 0;
  const perJob = {}; for (const c of rows.filter((x) => x[1] === 'job')) perJob[c[3]] = (perJob[c[3]] || 0) + 1;
  const jobsRun = Object.keys(perJob).length, sessions = Object.values(perJob).reduce((a, x) => a + x, 0);
  const restarts = Object.values(perJob).reduce((a, x) => a + Math.max(0, x - 1), 0) + Math.max(0, rows.filter((c) => /^BOB/.test(c[1])).length - 1);
  // gate runs per merged job: the gate runs on every push of a job's branch; git holds the commits each merge brought in
  const gate = {};
  for (const l of R.g(['log', '--merges', '--format=%H %s', range]).split('\n').filter(Boolean)) {
    const [h, ...s] = l.split(' '), mm = s.join(' ').match(/\bjob\/([a-z0-9-]+)\b/);
    if (mm) gate[mm[1]] = (gate[mm[1]] || 0) + Number(R.g(['rev-list', '--count', '--no-merges', `${h}^1..${h}^2`]) || 0);
  }
  const fp = footprint({ product: o.product });
  const commitsByPurpose = { 'job code': fp.kinds.product, records: fp.kinds['build state'] + fp.kinds.docs, merges: fp.merges };
  // stages run for the first time under this version (INT-5): not named in an earlier report under the same pin
  const pin = pinOf(durableStatus(R) ?? (texts[0] || '').match(/^\*\*Status\*\* · .*$/m)?.[0], plan);
  const ran = [...new Set([...(o.stages || []), ...(texts.some((t) => /^# Plan: the completion round/m.test(t)) || R.g(['log', '--format=%s', range]).includes('(the completion round)') || /the completion round is current/.test(R.g(['log', '--format=%s', range])) ? ['completion round'] : [])])].filter((s) => STAGES.includes(s));
  const before = R.g(['ls-files', '--', R.rel(ARCHIVE)]).split('\n').filter((f) => /-report\.md$/.test(f) && !f.endsWith(`/${T}-report.md`)).map((f) => R.read(relative(R.dir, join(R.root, f))) || '').filter((t) => pin && t.includes(`**Pin** · ${pin}`));
  const firstRuns = ran.filter((s) => !before.some((t) => (t.match(/^\*\*Stages\*\* · (.*)$/m)?.[1] || '').split(', ').includes(s)));
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : 'unknown');
  const fields = {
    tranche: T, pin, elapsedHours: elapsedH,
    finished: { legacyLinesRemoved: removed - added, entriesApplied: applied.length },
    deferred: deferred.map((x) => ({ id: x.id, module: x.module, reason: x.deferred })),
    left: { notApplied: notApplied.map((x) => x.id), completion: completion.map((x) => x.id), nextTranche: next.length },
    cost: { tokens: total, byRole, unmeasured },
    overhead: { commitsByPurpose, sessionsPerJob: jobsRun ? Math.round((10 * sessions) / jobsRun) / 10 : null, gateRunsPerMergedJob: Object.keys(gate).length ? Math.round((10 * Object.values(gate).reduce((a, x) => a + x, 0)) / Object.keys(gate).length) / 10 : null, restarts, tokensByRole: byRole, share: pct(total - jobTokens, total) },
    stages: ran, firstRuns,
  };
  const text = [
    `# The tranche report · ${T}`, '',
    `**Pin** · ${pin ?? 'unknown'}`,
    `**Elapsed** · ${elapsedH} hours (the tranche's first commit since main to its last)`,
    `**Finished** · ${fields.finished.entriesApplied} entries applied; ${fields.finished.legacyLinesRemoved} legacy lines removed (net)`,
    `**Deferred** · ${fields.deferred.map((x) => `${x.id} (${x.module}): ${x.reason}`).join('; ') || 'none'}`,
    `**Left** · not applied: ${fields.left.notApplied.join(', ') || 'none'}; the completion round: ${fields.left.completion.join(', ') || 'none'}; the next tranche's list: ${fields.left.nextTranche} entries`,
    `**Cost** · ${total} tokens${Object.keys(byRole).length ? ` (${Object.entries(byRole).map(([r, t]) => `${r} ${t}`).join(', ')})` : ''}${unmeasured.length ? `; unmeasured: ${unmeasured.join(', ')}` : ''}`,
    `**Overhead** · ${fields.overhead.share} of the tokens outside job sessions; commits: ${commitsByPurpose['job code']} job code, ${commitsByPurpose.records} records, ${commitsByPurpose.merges} merges; ${fields.overhead.sessionsPerJob ?? 'unknown'} sessions per job; ${fields.overhead.gateRunsPerMergedJob ?? 'unknown'} gate runs per merged job (its branch's commits); ${restarts} restarts`,
    `**Stages** · ${ran.join(', ') || 'none'}`,
    `**First runs under this version** · ${firstRuns.join(', ') || 'none'}`,
    '', '## Entries', '', '| entry | layer | module | outcome |', '| --- | --- | --- | --- |',
    ...all.map((x) => `| ${x.id} | ${x.layer} | ${x.module ?? '?'} | ${x.outcome} |`), '',
  ].join('\n');
  return { ...fields, entries: all.map((x) => ({ id: x.id, layer: x.layer, module: x.module, outcome: x.outcome })), text };
}

// ---- a ruling (R8; GOV 7) ----

// A ruling of BOB's or Bob's: one line `K<n> · date · area · ruling · why` in the product's log, committed with the files it
// changes. A lane's decision is an `L-<ID>-<n>` line instead (DESIGN-STAGE §3).
export function ruling(o) {
  const R = repo(o.product); if (!o.text || !o.why) refuse('--text "<the ruling>" --why "<why>" [--module <m>] [--files <p1,p2>]');
  on(R, TRANCHE);
  const files = String(o.files || '').split(',').filter(Boolean).map((f) => within(R, f, '--files'));
  for (const f of files) if (R.read(f) === null) refuse(`${f}: no such file`);
  const log = 'build/rulings.md', cur = R.read(log) ?? '# Rulings\n';
  const k = Math.max(0, ...[...cur.matchAll(/^- K(\d+) · /gm)].map((x) => Number(x[1]))) + 1;
  R.write(log, `${cur.trimEnd()}\n- K${k} · ${today()} · ${o.module || 'process'} · ${one(o.text).replace(/ · /g, '; ')} · ${one(o.why).replace(/ · /g, '; ')}\n`);
  return { ruling: `K${k}`, commit: commitPush(R, TRANCHE, [log, ...files], `K${k}: ${one(o.text).slice(0, 60)}`) };
}
