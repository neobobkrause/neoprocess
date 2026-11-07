// RETIRED IN PART by the process redesign (lane-process-redesign/DESIGN.md §2.3): BOB and
// the jobs now talk by `send_message` and keep state through tools/proc.mjs. Once the redesign is adopted, only the
// cross-account channel (the x-commands, which the mechanics' cross-account channel entry describes) and the size functions proc.mjs reads (SESSIONS §6.3) are in use; the rest stays
// for the running tranche until its close, and is then removed.
//
// The mailboxes between BOB and a module job (bio K168). A message is a numbered entry in its
// writer's own file in git; each side keeps a cursor, the last entry of the other side it has processed; a routine
// carries no content, only "check your mailbox". So a late, duplicated, reordered or lost routine changes nothing: the
// reader always reads everything past its cursor. This tool writes and reads the mailboxes and the addresses, so no
// session hand-writes protocol.
//
//   job → BOB   the job's record `build/jobs/<T>/<module>.md` on `job/<T>/<module>`: entries `## J<n> · <KIND>`;
//               its cursor over BOB's entries in its Status line (`handled B<n>`).
//   BOB → job   `build/jobs/<T>/<module>.bob.md` on `tranche/<T>`: entries `## B<n> · <KIND>`; BOB's cursor over the
//               job's entries in its `**Read** · handled J<n>` line.
//   addresses   the plan's Status line (BOB's session) and `**Jobs**` line (each job's session), `build/plan/current.md`.
//   accounts    each participant's outbox on its own mail branch, listed in `build/channels.md` (§13.1; the x-commands).
//
// Usage: node tools/mail.mjs <command> [--product <dir>] --tranche <T> [--module <m>] [options]
//   BOB:  bob --name "BOB #n" --session <id> --depth <d> [--state OPEN]   write the plan's Status line, and, when the
//         product has a registry, BOB's Writer line in its outbox (as xwriter --as BOB, account from the registry;
//         bio K3361); a failed channel step keeps the Status line and warns with the xwriter command to run by hand
//         addjob --module <m> --name "<M> #k" --session <id>             add or replace a job's address
//         jobbranch --module <m>           create job/<T>/<m> at the tranche tip, or fast-forward it there (§5.3 (1));
//                                          a job branch holding commits the tranche lacks is refused, never forced
//         post --as bob --module <m> --kind <KIND> [--re J<n>] (--body <text> | --body-file <f>)
//         inbox --as bob --module <m>      done --as bob --module <m> --through J<n>
//         check                            the backstop: every job's state and what each needs
//   job:  start --module <m> --session <id> --depth <d>                   create the record's Status line
//         post --as job …   inbox --as job --module <m>   done --as job --module <m> --through B<n>
//         state --module <m> (--set <STATE> | --running <minutes> --what <command>)
//   any:  addr (--bob | --module <m>)      print a session id to ring
//         ring-text --to <name>            print the doorbell's text
//
// The size gate (§5.1, §17; P20, P13, bio K5015, K5123): the documents a session must read whole are measured first, and a
// command that would take, post, read or ring is refused, naming each document, its size and its limit, until it is
// pruned. A gate protects a session's own reading set, never another's: a job is measured only against its reading set,
// every text file (.md .txt .tsv .csv .json .html) under `build/plan/` but `build/plan/archive/**` (51,200 bytes); BOB
// is measured against all three kinds, those and BOB's takeover set, `build/rulings-active.md` (80 lines, 25,600 bytes)
// and `build/handoff.md` (25,600 bytes), so BOB prunes at once. Images and other binaries are never measured. Exempt from
// the gate, so a session can always move its cursor, set its state and report the refusal: done, state, addr, ring-text,
// xdone, and `post --as job --kind BLOCKED`. `check` is not refused; it lists each oversized document as
// `SIZE <path> <bytes> > <limit>`, and each of BOB's two documents above 95 % of its limit as
// `NEAR <path> <bytes> / <limit>`, so BOB prunes before a limit is crossed. `build/plan/size-exempt.txt` (one path per
// line, its reason after ` · `) exempts a named document. There is no bypass flag.
//
// Across accounts (§13.1; bio K954): no tranche and no doorbell; the registry `build/channels.md` names each participant.
// Run from any branch: these commands read and write only the mail branches on origin, never the working tree.
//   xwriter --as <NAME> --session <id> [--account <a>]   the Writer line, first in my outbox, at takeover
//   xpost   --as <NAME> --kind <KIND> [--re <L><n>] (--body <text> | --body-file <f>)   append to my outbox, push
//           KIND: NOTICE, QUESTION, ANSWER, DEFER, HANDOFF, MERGE, ACK (ANSWER and ACK name their entry with --re)
//   xinbox  --as <NAME> --from <NAME>                    their entries past my cursor
//   xdone   --as <NAME> --from <NAME> --through <L><n>   move my cursor over theirs (never back)
//   xcheck  --as <NAME>                                  for each correspondent: what I have not read, and they of mine;
//           as BOB, with --tranche or a plan in the working tree, a WARNING when my Writer is not the plan's BOB
import { repo as recordRepo } from './record.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, resolve } from 'node:path';

export const KINDS = { job: ['QUESTION', 'REPORT', 'COMPLETE', 'BLOCKED'], bob: ['START', 'ANSWER', 'CHANGE', 'RESUME'] };
const QUIET_MS = 20 * 60e3;
// (bio K4976): a RUNNING window is at most this far ahead; a longer run is split into pieces, each pushed as it ends.
export const RUNNING_MAX_MIN = 30;
// PROTOCOL §7 (bio K4976): QUIET is a job WORKING with no push for QUIET_MS, or RUNNING past its window (capped at
// RUNNING_MAX_MIN from its last push, so a window set longer by an older tool cannot hide a dropped container).
export function quietOf(state, idleMs, now) {
  if (idleMs < QUIET_MS) return false;
  if (state === 'WORKING') return true;
  const until = runningUntil(state);
  if (Number.isNaN(until)) return false;
  return until < now || idleMs >= RUNNING_MAX_MIN * 60e3;
}
const ENTRY = /^## ([JB])(\d+) · ([A-Z]+)(?: · re ([JB]\d+))?[^\n]*$/gm;
const STATUS = /^\*\*Status\*\* · (session_[0-9A-Za-z]+) · depth (\d+) · (.+?) · handled B(\d+)$/m;
const READ = /^\*\*Read\*\* · handled J(\d+)$/m;

// ---- files ----

export const recordPath = (T, m) => `build/jobs/${T}/${m}.md`;
export const outboxPath = (T, m) => `build/jobs/${T}/${m}.bob.md`;
export const PLAN = 'build/plan/current.md';
export const branchOf = (as, T, m) => (as === 'job' ? `job/${T}/${m}` : `tranche/${T}`);

export function parseEntries(text) {
  const out = [];
  const heads = [...(text || '').matchAll(ENTRY)];
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    out.push({ side: h[1], n: Number(h[2]), kind: h[3], re: h[4] || null, text: text.slice(h.index, end).trimEnd() });
  });
  return out;
}
export const lastId = (text) => Math.max(0, ...parseEntries(text).map((e) => e.n));
export function parseStatus(text) {
  const m = (text || '').match(STATUS);
  return m ? { session: m[1], depth: Number(m[2]), state: m[3], handled: Number(m[4]) } : null;
}
export const readCursor = (text) => Number((text || '').match(READ)?.[1] ?? 0);
export const runningUntil = (state) => { const m = /^RUNNING until (\S+)/.exec(state || ''); return m ? Date.parse(m[1]) : NaN; };

// ---- git ----

function repo(product) {
  // git only through the record's repo (record R1); `g` keeps this tool's untrimmed output
  const dir = resolve(product || '.'), RR = recordRepo(dir), root = RR.root;
  const g = (args) => RR.raw(args);
  const inRepo = (p) => relative(root, join(dir, p));
  return { dir, root, g, inRepo, RR };
}
function fetchBranch(R, branch) {
  try { R.g(['fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { quiet: true }); return true; } catch { return false; }
}
function showRemote(R, branch, path) {
  try { return R.g(['show', `origin/${branch}:${R.inRepo(path)}`], { quiet: true }); } catch { return null; }
}
function lastPushMs(R, branch) {
  try { return Number(R.g(['log', '-1', '--format=%ct', `origin/${branch}`], { quiet: true }).trim()) * 1000; } catch { return NaN; }
}
function onBranch(R, branch) {
  const cur = R.g(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (cur !== branch) throw new Error(`check out ${branch} first (on ${cur})`);
}
// Commit one file and push it; on a rejected push, rebase on the remote once and push again.
function commitPush(R, branch, path, message) {
  R.g(['add', R.inRepo(path)]);
  // A write that changes nothing (a state or address already as asked) is a success with nothing to push.
  try { R.g(['diff', '--cached', '--quiet', '--', R.inRepo(path)], { quiet: true }); return R.g(['rev-parse', '--short', 'HEAD']).trim(); } catch { /* staged change: commit it */ }
  R.g(['commit', '-q', '-m', message, '--', R.inRepo(path)]); // this file only, never other staged work (bio N420)
  try { R.g(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], { quiet: true }); }
  catch { R.g(['pull', '-q', '--rebase', 'origin', branch]); R.g(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]); }
  return R.g(['rev-parse', '--short', 'HEAD']).trim();
}
const readLocal = (R, p) => { const f = join(R.dir, p); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
const writeLocal = (R, p, text) => { const f = join(R.dir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };


// ---- the size gate (§5.1, §17; P20, P13, P19; bio K5015) ----

export const SIZE_LIMITS = { rulingsLines: 80, rulingsBytes: 25600, handoffBytes: 25600, planBytes: 51200 };
export const SIZE_EXEMPT = 'build/plan/size-exempt.txt';
const lineCount = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
// The exempt list: one product-relative path per line, its reason after " · "; a line with no reason exempts nothing.
function sizeExempt(dir) {
  const f = join(dir, SIZE_EXEMPT);
  if (!existsSync(f)) return new Set();
  return new Set(readFileSync(f, 'utf8').split('\n').map((l) => l.split(' · ')).filter((p) => p.length >= 2 && p[0].trim() && p.slice(1).join(' · ').trim()).map((p) => p[0].trim()));
}
// Only text a session reads is measured; images and other binaries under build/plan/ never are.
export const TEXT_EXT = /\.(?:md|txt|tsv|csv|json|html)$/i;
function planFiles(dir, rel = 'build/plan') {
  const d = join(dir, rel);
  if (!existsSync(d)) return [];
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = `${rel}/${e.name}`;
    if (p === 'build/plan/archive') return [];
    return e.isDirectory() ? planFiles(dir, p) : e.isFile() && TEXT_EXT.test(e.name) ? [p] : [];
  }).sort();
}
// Every document over its limit: { path, n, limit, unit } (unit "bytes" or "lines"), in a fixed order.
// For a job, the documents are measured as they stand on the tranche branch's remote tip, which BOB prunes: a job
// whose own branch still holds the pruned document is not kept refused, and learns of the prune by its inbox
// (bio K5028, dry run D17's finding 2). `ref` is that tip; without it the working tree is measured.
function treeAt(product, ref) {
  const R = repo(product), pre = R.inRepo('.') === '' ? '' : R.inRepo('.') + '/';
  let ls = '';
  try { ls = R.g(['ls-tree', '-r', '-l', ref, '--', `${pre}build`], { quiet: true }); } catch { return null; }
  const size = new Map();
  for (const line of ls.split('\n')) { const m = line.match(/^\S+ blob \S+\s+(\d+)\t(.*)$/); if (m && m[2].startsWith(pre)) size.set(m[2].slice(pre.length), Number(m[1])); }
  const text = (p) => { try { return R.g(['show', `${ref}:${pre}${p}`], { quiet: true }); } catch { return ''; } };
  return { size, text };
}
// `who` is 'job' (the plan files only: a job's reading set) or 'bob' (the default: those and BOB's two documents).
export function oversize(product, ref, who = 'bob') {
  const dir = resolve(product || '.'), out = [];
  const t = ref ? treeAt(product, ref) : null;
  const has = (p) => (t ? t.size.has(p) : existsSync(join(dir, p)));
  const bytes = (p) => (t ? t.size.get(p) : readFileSync(join(dir, p)).length);
  const read = (p) => (t ? t.text(p) : readFileSync(join(dir, p), 'utf8'));
  const exempt = t ? new Set(read(SIZE_EXEMPT).split('\n').map((l) => l.split(' · ')).filter((q) => q.length >= 2 && q[0].trim() && q.slice(1).join(' · ').trim()).map((q) => q[0].trim())) : sizeExempt(dir);
  const files = t ? [...t.size.keys()].filter((p) => p.startsWith('build/plan/') && !p.startsWith('build/plan/archive/') && TEXT_EXT.test(p)).sort() : planFiles(dir);
  const add = (path, n, limit, unit) => { if (n > limit && !exempt.has(path)) out.push({ path, n, limit, unit }); };
  const rulings = 'build/rulings-active.md', handoff = 'build/handoff.md';
  // a lane's HANDOFF.md (build/plan/<lane>/HANDOFF.md) is read whole at every takeover, as BOB's handoff is (bio K5418)
  const capOf = (p) => (/^build\/plan\/[^/]+\/HANDOFF\.md$/.test(p) ? SIZE_LIMITS.handoffBytes : SIZE_LIMITS.planBytes);
  if (who === 'job') { for (const p of files) add(p, bytes(p), capOf(p), 'bytes'); return out; }   // BOB's takeover set is never a job's
  if (has(rulings)) {
    add(rulings, lineCount(read(rulings)), SIZE_LIMITS.rulingsLines, 'lines');
    add(rulings, bytes(rulings), SIZE_LIMITS.rulingsBytes, 'bytes');
  }
  if (has(handoff)) add(handoff, bytes(handoff), SIZE_LIMITS.handoffBytes, 'bytes');
  for (const p of files) add(p, bytes(p), capOf(p), 'bytes');
  return out;
}
// BOB's two documents above NEAR_PCT of a limit but not over it: { path, n, limit, unit }.
export const NEAR_PCT = 95;
export function nearLimit(product) {
  const dir = resolve(product || '.'), exempt = sizeExempt(dir), out = [];
  const near = (path, n, limit, unit) => { if (n <= limit && n * 100 > limit * NEAR_PCT && !exempt.has(path)) out.push({ path, n, limit, unit }); };
  const rulings = join(dir, 'build/rulings-active.md'), handoff = join(dir, 'build/handoff.md');
  if (existsSync(rulings)) { near('build/rulings-active.md', lineCount(readFileSync(rulings, 'utf8')), SIZE_LIMITS.rulingsLines, 'lines'); near('build/rulings-active.md', readFileSync(rulings).length, SIZE_LIMITS.rulingsBytes, 'bytes'); }
  if (existsSync(handoff)) near('build/handoff.md', readFileSync(handoff).length, SIZE_LIMITS.handoffBytes, 'bytes');
  return out;
}
const sizeText = (v) => `${v.path} ${v.n} ${v.unit} > ${v.limit} ${v.unit}`;
// The lines `check` prints: `SIZE <path> <bytes> > <limit>` (a line count reads `<n> lines > <limit> lines`).
// Then `NEAR <path> <bytes> / <limit>` for each of BOB's documents above 95 % of its limit (a line count reads `<n> lines / <limit> lines`).
export const sizeLines = (product) => [
  ...oversize(product).map((v) => (v.unit === 'bytes' ? `SIZE ${v.path} ${v.n} > ${v.limit}` : `SIZE ${sizeText(v)}`)),
  ...nearLimit(product).map((v) => `NEAR ${v.path} ${v.n}${v.unit === 'bytes' ? '' : ' lines'} / ${v.limit}${v.unit === 'bytes' ? '' : ' lines'}`),
];
// The gate: throws, naming each document, its size and its limit, before a command reads or writes anything.
export function sizeGate(product, who, T) {
  let ref;
  if (who === 'job' && T) { const R = repo(product); if (fetchBranch(R, `tranche/${T}`)) ref = `origin/tranche/${T}`; }
  const over = oversize(product, ref, who === 'job' ? 'job' : 'bob');
  if (!over.length) return;
  const tail = who === 'job' ? 'BOB prunes them; post BLOCKED with cause reading.' : 'prune them now (SESSIONS §6.3).';
  throw new Error(`refused, documents over their limits: ${over.map(sizeText).join('; ')}; ${tail}`);
}

// ---- commands ----

export function post(o) {
  const { as, tranche: T, module: m, kind, re } = o;
  if (!(as === 'job' && kind === 'BLOCKED')) sizeGate(o.product, as, T);   // a job can always report the refusal
  if (!KINDS[as]?.includes(kind)) throw new Error(`${as} sends one of ${KINDS[as]?.join(', ')}, not ${kind}`);
  if (re && !/^[JB]\d+$/.test(re)) throw new Error(`--re ${re}: not J<n> or B<n>`);
  const body = (o.bodyFile ? readFileSync(o.bodyFile, 'utf8') : o.body || '').trim();
  if (!body) throw new Error('a message has a body (--body or --body-file)');
  const R = repo(o.product), branch = branchOf(as, T, m);
  onBranch(R, branch);
  const path = as === 'job' ? recordPath(T, m) : outboxPath(T, m);
  let text = readLocal(R, path);
  if (as === 'job' && !parseStatus(text)) throw new Error(`${path} has no Status line: run "start" first`);
  if (as === 'bob' && text === null) text = `# BOB to ${m} (${T})\n\n**Read** · handled J0\n`;
  const side = as === 'job' ? 'J' : 'B', n = lastId(text) + 1;
  text = `${text.trimEnd()}\n\n## ${side}${n} · ${kind}${re ? ` · re ${re}` : ''}\n\n${body}\n`;
  writeLocal(R, path, text);
  const commit = commitPush(R, branch, path, `mail ${T} ${m}: ${side}${n} ${kind}${re ? ` re ${re}` : ''}`);
  return { id: `${side}${n}`, commit };
}

export function inbox(o) {
  const { as, tranche: T, module: m } = o;
  sizeGate(o.product, as, o.tranche);
  const R = repo(o.product), other = as === 'job' ? 'bob' : 'job', branch = branchOf(other, T, m);
  fetchBranch(R, branch);
  const theirs = showRemote(R, branch, other === 'job' ? recordPath(T, m) : outboxPath(T, m));
  const mine = readLocal(R, as === 'job' ? recordPath(T, m) : outboxPath(T, m));
  const cursor = as === 'job' ? parseStatus(mine)?.handled ?? 0 : readCursor(mine);
  return { cursor, entries: parseEntries(theirs).filter((e) => e.n > cursor) };
}

export function done(o) {
  const { as, tranche: T, module: m, through } = o;
  const want = as === 'job' ? 'B' : 'J';
  const k = new RegExp(`^${want}(\\d+)$`).exec(through || '');
  if (!k) throw new Error(`--through ${want}<n>`);
  const R = repo(o.product), branch = branchOf(as, T, m);
  onBranch(R, branch);
  const path = as === 'job' ? recordPath(T, m) : outboxPath(T, m);
  let text = readLocal(R, path);
  if (as === 'bob' && text === null) text = `# BOB to ${m} (${T})\n\n**Read** · handled J0\n`;
  const cur = as === 'job' ? parseStatus(text)?.handled : readCursor(text);
  if (cur === undefined) throw new Error(`${path} has no Status line`);
  const n = Number(k[1]);
  if (n <= cur) return { cursor: cur, moved: false };           // at or below the cursor: nothing to do
  text = as === 'job' ? text.replace(/handled B\d+$/m, `handled B${n}`) : text.replace(READ, `**Read** · handled J${n}`);
  writeLocal(R, path, text);
  return { cursor: n, moved: true, commit: commitPush(R, branch, path, `mail ${T} ${m}: ${as} read through ${want}${n}`) };
}

export function start(o) {
  const { tranche: T, module: m, session, depth } = o;
  // not gated: the job's record must exist before it can post BLOCKED with cause reading (bio K5025, dry run D17)
  if (!/^session_[0-9A-Za-z]+$/.test(session || '')) throw new Error('--session <session id>');
  const R = repo(o.product), branch = branchOf('job', T, m);
  onBranch(R, branch);
  const path = recordPath(T, m);
  let text = readLocal(R, path);
  const st = parseStatus(text);
  const line = `**Status** · ${session} · depth ${Number(depth)} · WORKING · handled B${st ? st.handled : 0}`;
  text = st ? text.replace(STATUS, line) : `# ${m} (${T})\n\n${line}\n`;
  writeLocal(R, path, text);
  return { commit: commitPush(R, branch, path, `mail ${T} ${m}: ${session} starts`) };
}

export function state(o) {
  const { tranche: T, module: m } = o;
  let s = o.set;
  if (o.running !== undefined && !(Number(o.running) > 0 && Number(o.running) <= RUNNING_MAX_MIN))
    throw new Error(`--running takes 1 to ${RUNNING_MAX_MIN} minutes: split a longer run into pieces and push each as it ends`);
  if (o.set && /^RUNNING\b/.test(o.set)) throw new Error('RUNNING is set only by --running <minutes> --what <command>');
  if (o.running) s = `RUNNING until ${new Date(Date.now() + Number(o.running) * 60e3).toISOString().replace(/\.\d+Z$/, 'Z')} (${o.what || 'command'})`;
  if (!s || /·/.test(s)) throw new Error('--set <STATE> (no "·"), or --running <minutes> --what <command>');
  const R = repo(o.product), branch = branchOf('job', T, m);
  onBranch(R, branch);
  const path = recordPath(T, m), text = readLocal(R, path), st = parseStatus(text);
  if (!st) throw new Error(`${path} has no Status line: run "start" first`);
  writeLocal(R, path, text.replace(STATUS, `**Status** · ${st.session} · depth ${st.depth} · ${s} · handled B${st.handled}`));
  return { state: s, commit: commitPush(R, branch, path, `mail ${T} ${m}: state ${s}`) };
}

// The plan's Status line names exactly one session, BOB's (§13); the Jobs line names each job's.
export function bob(o) {
  const { tranche: T, name, session, depth } = o;
  sizeGate(o.product, 'bob');
  if (!/^(?:[A-Z0-9]+-)?BOB #\d+$/.test(name || '') || !/^session_[0-9A-Za-z]+$/.test(session || '')) throw new Error('--name "BOB #<n>" --session <id> --depth <d>');
  const R = repo(o.product), branch = branchOf('bob', T);
  onBranch(R, branch);
  let text = readLocal(R, PLAN) || `# Plan ${T}\n`;
  const old = text.match(/^\*\*Status\*\* · ([A-Z]+)/m)?.[1];
  const line = `**Status** · ${o.state || old || 'OPEN'} · ${name} · ${session} · depth ${Number(depth)}`;
  text = /^\*\*Status\*\*.*$/m.test(text) ? text.replace(/^\*\*Status\*\*.*$/m, line) : text.replace(/^(# .*\n)/, `$1\n${line}\n`);
  writeLocal(R, PLAN, text);
  const commit = commitPush(R, branch, PLAN, `plan ${T}: ${name} ${session} · depth ${depth}`);
  return { commit, channel: bobWriter(R, o) };
}
// The channel half of `bob` (§13.1 (1); bio K3361): BOB's Writer line, exactly as `xwriter --as BOB` writes it. Never
// throws: the Status line is already pushed, so a failure is returned for the caller to warn about.
function bobWriter(R, o) {
  fetchBranch(R, 'main');
  if ((showRemote(R, 'main', REGISTRY) ?? readLocal(R, REGISTRY)) === null) return { status: 'skipped' };
  try {
    const r = xwriter({ product: o.product, as: 'BOB', session: o.session, date: o.date });
    return { status: r.changed ? 'written' : 'current', commit: r.commit };
  } catch (e) { return { status: 'failed', error: e.message }; }
}
export function addjob(o) {
  const { tranche: T, module: m, name, session } = o;
  sizeGate(o.product, 'bob');
  if (!/^[A-Z][A-Z0-9-]* #\d+$/.test(name || '') || !/^session_[0-9A-Za-z]+$/.test(session || '')) throw new Error('--module <m> --name "<M> #k" --session <id>');
  const R = repo(o.product), branch = branchOf('bob', T);
  onBranch(R, branch);
  let text = readLocal(R, PLAN);
  const jobs = parseJobs(text).filter((j) => j.module !== m);
  jobs.push({ module: m, name, session });
  const line = `**Jobs** · ${jobs.map((j) => `${j.module}: ${j.name} ${j.session}`).join('; ')}`;
  text = /^\*\*Jobs\*\*.*$/m.test(text) ? text.replace(/^\*\*Jobs\*\*.*$/m, line) : text.replace(/^(\*\*Status\*\*.*\n)/m, `$1\n${line}\n`);
  writeLocal(R, PLAN, text);
  return { commit: commitPush(R, branch, PLAN, `plan ${T}: ${name} ${session} for ${m}`) };
}
// §5.3 (1); bio K3969, K4385: a job's branch is created at the tranche's tip, or fast-forwarded to it, by a plain push
// only. A branch that is not an ancestor of the tranche holds work the tranche lacks: it is refused, with the remedy
// (the job merges the tranche into its branch), and never rewritten. The one way a session moves a job branch.
export function jobbranch(o) {
  const { tranche: T, module: m } = o;
  if (!/^[a-z][a-z0-9-]*$/.test(m || '')) throw new Error('--module <m>');
  const R = repo(o.product), tb = branchOf('bob', T), jb = branchOf('job', T, m);
  if (!fetchBranch(R, tb)) throw new Error(`no ${tb} on origin`);
  const tip = R.g(['rev-parse', `origin/${tb}`]).trim();
  if (!fetchBranch(R, jb)) {
    R.g(['push', '-q', 'origin', `${tip}:refs/heads/${jb}`]);
    return { action: 'created', branch: jb, commit: tip.slice(0, 10) };
  }
  const head = R.g(['rev-parse', `origin/${jb}`]).trim();
  if (head === tip) return { action: 'current', branch: jb, commit: tip.slice(0, 10) };
  try { R.g(['merge-base', '--is-ancestor', head, tip], { quiet: true }); }
  catch { throw new Error(`${jb} holds commits ${tb} lacks: not moved (never forced). Its job merges ${tb} into it; a finished job's branch is merged into ${tb} first`); }
  R.g(['push', '-q', 'origin', `${tip}:refs/heads/${jb}`]);
  return { action: 'fast-forwarded', branch: jb, from: head.slice(0, 10), commit: tip.slice(0, 10) };
}
const planBob = (plan) => plan?.match(/^\*\*Status\*\* · [A-Z]+ · \S+(?: \S+)? #\d+ · (session_[0-9A-Za-z]+) · depth \d+/m)?.[1] ?? null;
export function parseJobs(text) {
  const line = (text || '').match(/^\*\*Jobs\*\* · (.*)$/m)?.[1] || '';
  return [...line.matchAll(/([a-z][a-z0-9-]*): ([A-Z][A-Z0-9-]* #\d+) (session_[0-9A-Za-z]+)/g)].map((x) => ({ module: x[1], name: x[2], session: x[3] }));
}
// Addresses are read from the remote tranche branch, where a successor BOB writes its own (§2, §13).
export function addr(o) {
  const R = repo(o.product), branch = branchOf('bob', o.tranche);
  fetchBranch(R, branch);
  const plan = showRemote(R, branch, PLAN) ?? readLocal(R, PLAN);
  if (o.bob) { const s = planBob(plan); if (!s) throw new Error('no BOB in the plan\'s Status line'); return s; }
  const j = parseJobs(plan).find((x) => x.module === o.module);
  if (!j) throw new Error(`no job for ${o.module} in the plan's Jobs line`);
  return j.session;
}
export const ringText = (T, to) => `MAIL (${T}) for ${to}: check your mailbox (node tools/mail.mjs inbox).`;

// The backstop (§5): for each job, its state and what it needs, from git alone.
export function check(o) {
  const R = repo(o.product), T = o.tranche, tb = branchOf('bob', T), now = o.now ?? Date.now();
  fetchBranch(R, tb);
  const plan = showRemote(R, tb, PLAN) ?? readLocal(R, PLAN);
  return parseJobs(plan).map((j) => {
    const jb = branchOf('job', T, j.module);
    fetchBranch(R, jb);
    const rec = showRemote(R, jb, recordPath(T, j.module));
    const out = readLocal(R, outboxPath(T, j.module)) ?? showRemote(R, tb, outboxPath(T, j.module));
    const st = parseStatus(rec);
    const r = { ...j, state: st?.state ?? 'NOT STARTED', lastJ: lastId(rec), read: readCursor(out), lastB: lastId(out), handled: st?.handled ?? 0, pushedAgoMin: Math.round((now - lastPushMs(R, jb)) / 60e3), needs: [] };
    if (!st) r.needs.push('UNCONFIRMED');
    if (r.lastJ > r.read) r.needs.push(`READ J${r.read + 1}..J${r.lastJ}`);
    // A COMPLETE job that has not read all of BOB's entries is open, never merely complete (§5.5; bio K5171): a START or
    // a CHANGE it never read is waiting for it.
    if (st && r.handled < r.lastB && /^COMPLETE/.test(r.state)) r.needs.push(`OPEN (unread B${r.handled + 1}..B${r.lastB})`);
    if (st && r.handled < r.lastB) r.needs.push('RING');
    if (/^NEEDS BOB/.test(r.state)) r.needs.push('BOB: relay to Bob');
    if (st && quietOf(r.state, now - lastPushMs(R, jb), now)) r.needs.push('QUIET');
    return r;
  });
}

// ---- across accounts (§13.1; bio K954) ----
// Each participant's outbox is one file on its own mail branch (`mail/<NAME>`), which holds nothing else and is never
// merged. The registry `build/channels.md` (read from the product's origin/main, else the working tree) gives each row's
// name, account, branch and outbox, and optionally its letter (else the name's first). An outbox reads:
//   **Writer** · <name> · <session id> · <account> · since <date>       the first line; a successor rewrites it
//   **Read** · handled <NAME> <L><n>                                    one cursor per correspondent
//   ## <L><n> · <KIND>[ · re <L><n>] · <date> · <session id> · <account>   numbered, append-only entries
// Writes never touch the working tree: the new outbox is committed with plumbing onto the remote tip and pushed.

export const XKINDS = ['NOTICE', 'QUESTION', 'ANSWER', 'DEFER', 'HANDOFF', 'MERGE', 'ACK'];
const XNEEDS_RE = ['ANSWER', 'ACK'];
export const REGISTRY = 'build/channels.md';
const XHEAD = /^## ([A-Z])(\d+) · ([^\n]*)$/gm;
const WRITER = /^\*\*Writer\*\* · (\S+) · (\S+) · (\S+) · since (\S+)[ \t]*$/;
const XREAD = /^\*\*Read\*\* · handled (\S+) ([A-Z])(\d+)[ \t]*$/gm;
const SESSION = /^session_[0-9A-Za-z]+$/;
const today = () => new Date().toISOString().slice(0, 10);

export function parseRegistry(text) {
  const rows = (text || '').split('\n').filter((l) => /^\s*\|/.test(l))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/`/g, '')));
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.toLowerCase().replace(/^mail /, ''));
  const col = (n) => head.indexOf(n);
  for (const n of ['name', 'account', 'branch', 'outbox']) if (col(n) < 0) throw new Error(`${REGISTRY}: no "${n}" column`);
  const out = rows.slice(1).filter((r) => !r.every((c) => /^:?-+:?$/.test(c))).map((r) => {
    const name = r[col('name')];
    const letter = ((col('letter') >= 0 && r[col('letter')]) || name[0] || '').toUpperCase();
    return { name, account: r[col('account')], branch: r[col('branch')], outbox: r[col('outbox')], letter };
  });
  const seen = new Set();
  for (const p of out) {
    if (!/^[A-Z][A-Z0-9-]*$/.test(p.name)) throw new Error(`${REGISTRY}: name "${p.name}" is not in capitals`);
    if (!/^[A-Z]$/.test(p.letter)) throw new Error(`${REGISTRY}: ${p.name}'s letter "${p.letter}" is not one capital`);
    for (const k of [`n:${p.name}`, `l:${p.letter}`, `b:${p.branch}`]) { if (seen.has(k)) throw new Error(`${REGISTRY}: ${k.slice(2)} given twice`); seen.add(k); }
  }
  return out;
}

export function parseOutbox(text) {
  const t = text || '';
  const heads = [...t.matchAll(XHEAD)];
  const head = heads.length ? t.slice(0, heads[0].index) : t;
  const w = t.split('\n')[0].match(WRITER);
  const cursors = {};
  for (const m of head.matchAll(XREAD)) cursors[m[1]] = { letter: m[2], n: Number(m[3]) };
  const entries = heads.map((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : t.length;
    const parts = h[3].split(' · ');
    const kind = parts.shift();
    const re = /^re ([A-Z]\d+)$/.exec(parts[0] || '')?.[1] || null;
    if (re) parts.shift();
    return { letter: h[1], n: Number(h[2]), id: `${h[1]}${h[2]}`, kind, re, date: parts[0] || null, session: parts[1] || null, account: parts[2] || null, text: t.slice(h.index, end).trimEnd() };
  });
  return { writer: w ? { name: w[1], session: w[2], account: w[3], since: w[4] } : null, cursors, entries, head };
}

function participant(reg, name, flag) {
  const p = reg.find((r) => r.name === name);
  if (!p) throw new Error(`${flag} ${name}: not in ${REGISTRY} (${reg.map((r) => r.name).join(', ') || 'empty'})`);
  return p;
}
function registry(R) {
  fetchBranch(R, 'main');
  const text = showRemote(R, 'main', REGISTRY) ?? readLocal(R, REGISTRY);
  if (text === null) throw new Error(`no ${REGISTRY} on origin/main or in the working tree`);
  return parseRegistry(text);
}
function remoteHas(R, branch) {
  try { R.g(['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`], { quiet: true }); return true; }
  catch (e) { if (e.status === 2) return false; throw new Error(`cannot reach origin to read ${branch}`); }
}
// The tip of a mail branch last read in this clone: a private ref that only a read moves (a plain or forced fetch of
// origin/<branch> does not), else, before the first read, the remote-tracking ref. A tip that does not descend from it
// is a forced rewrite (§13.1 cl.1): every reader refuses it, and the ref stays put, so each later read refuses too.
export const seenRef = (branch) => `refs/mail-seen/${branch}`;
const revq = (root, ref) => { try { return recordRepo(root).g(['rev-parse', '-q', '--verify', `${ref}^{commit}`]) || null; } catch { return null; } };
export const lastSeen = (root, branch) => revq(root, seenRef(branch)) || revq(root, `refs/remotes/origin/${branch}`);
export function rewriteFault(root, branch, before, tip) {
  if (!before || !tip || before === tip) return null;
  try { recordRepo(root).g(['merge-base', '--is-ancestor', before, tip]); return null; }
  catch { return `${branch}: history rewritten: ${before.slice(0, 7)}, read before, is not in ${tip.slice(0, 7)}`; }
}
export const markSeen = (root, branch, tip) => recordRepo(root).g(['update-ref', seenRef(branch), tip]);
// A participant's outbox as pushed: its text (null before the branch exists) and the branch's tip.
function readMail(R, p) {
  if (!remoteHas(R, p.branch)) return { text: null, tip: null };
  const before = lastSeen(R.root, p.branch);
  if (!fetchBranch(R, p.branch)) throw new Error(`cannot fetch ${p.branch}`);
  const tip = R.g(['rev-parse', `origin/${p.branch}`]).trim();
  const fault = rewriteFault(R.root, p.branch, before, tip);
  if (fault) throw new Error(`${fault} (a forced push): refusing to read ${p.name}'s outbox; settle it with its writer`);
  markSeen(R.root, p.branch, tip);
  return { text: showRemote(R, p.branch, p.outbox), tip };
}
// Commit the edited outbox onto the remote tip of its own mail branch (an orphan holding only the outbox when the
// branch is absent) and push; never a force, never another participant's branch. A push that loses a race re-reads once.
function writeMail(R, p, edit, message) {
  const git = (args, opts = {}) => R.RR.g(args, opts.env, opts.input);
  for (let attempt = 1; ; attempt++) {
    const { text, tip } = readMail(R, p);
    const next = edit(text);
    if (next === text) return { commit: tip ? tip.slice(0, 7) : null, changed: false };
    const blob = git(['hash-object', '-w', '--stdin'], { input: next });
    const tmp = mkdtempSync(join(tmpdir(), 'mail-index-'));
    let tree;
    try {
      const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') };
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${R.inRepo(p.outbox)}`], { env });
      tree = git(['write-tree'], { env });
    } finally { rmSync(tmp, { recursive: true, force: true }); }
    const commit = git(['commit-tree', tree, ...(tip ? ['-p', tip] : []), '-m', message()]);
    try { git(['push', '-q', 'origin', `${commit}:refs/heads/${p.branch}`]); }
    catch (e) { if (attempt >= 2) throw new Error(`push to ${p.branch} refused: ${(e.stderr || e.message).toString().trim()}`); continue; }
    fetchBranch(R, p.branch);
    return { commit: commit.slice(0, 7), changed: true };
  }
}
const writerLine = (p, session, account, since) => `**Writer** · ${p.name} · ${session} · ${account} · since ${since}`;
function setWriter(text, line) {
  const t = text || '';
  return WRITER.test(t.split('\n')[0]) ? t.replace(/^[^\n]*/, line) : `${line}\n${t ? `\n${t.replace(/^\n+/, '')}` : ''}`;
}
function setCursor(text, name, id) {
  const { head } = parseOutbox(text), rest = text.slice(head.length);
  const line = `**Read** · handled ${name} ${id}`;
  const own = new RegExp(`^\\*\\*Read\\*\\* · handled ${name} [A-Z]\\d+[ \\t]*$`, 'm');
  let h;
  if (own.test(head)) h = head.replace(own, line);
  else {
    const lines = head.replace(/\n+$/, '').split('\n');
    let at = 0; lines.forEach((l, i) => { if (i === 0 || /^\*\*Read\*\* · /.test(l)) at = i; });
    lines.splice(at + 1, 0, line);
    h = `${lines.join('\n')}\n`;
  }
  return rest ? `${h.replace(/\n+$/, '')}\n\n${rest}` : h;
}
function idOf(p, id, flag) {
  const m = /^([A-Z])(\d+)$/.exec(id || '');
  if (!m || m[1] !== p.letter) throw new Error(`${flag} ${id}: not one of ${p.name}'s entries (${p.letter}<n>)`);
  return Number(m[2]);
}

export function xwriter(o) {
  sizeGate(o.product, 'bob');
  const R = repo(o.product), reg = registry(R), me = participant(reg, o.as, '--as');
  if (!SESSION.test(o.session || '')) throw new Error('--session <session id>');
  const account = o.account || me.account;
  if (me.account && account !== me.account) throw new Error(`--account ${account}: ${me.name} is on the ${me.account} account in ${REGISTRY}`);
  const r = writeMail(R, me, (text) => {
    const w = parseOutbox(text).writer;
    if (w && w.session === o.session && w.account === account) return text;   // already the writer: nothing to do
    return setWriter(text, writerLine(me, o.session, account, o.date || today()));
  }, () => `mail ${me.name}: writer ${o.session}`);
  return r;
}

export function xpost(o) {
  sizeGate(o.product, 'bob');
  const R = repo(o.product), reg = registry(R), me = participant(reg, o.as, '--as');
  const kind = o.kind;
  if (!XKINDS.includes(kind)) throw new Error(`--kind is one of ${XKINDS.join(', ')}, not ${kind}`);
  if (o.re) {
    const other = reg.find((p) => p.letter === o.re[0] && p.name !== me.name);
    if (!other) throw new Error(`--re ${o.re}: names no correspondent's entry`);
    idOf(other, o.re, '--re');
  } else if (XNEEDS_RE.includes(kind)) throw new Error(`${kind} names the entry it answers (--re <L><n>)`);
  const body = (o.bodyFile ? readFileSync(o.bodyFile, 'utf8') : o.body || '').trim();
  if (!body) throw new Error('an entry has a body (--body or --body-file)');
  if (/^## [A-Z]\d+ · /m.test(body) || /^\*\*(Writer|Read)\*\* · /m.test(body)) throw new Error('the body may not contain an entry heading, a Writer line or a cursor line');
  const date = o.date || today();
  let id;
  const r = writeMail(R, me, (text) => {
    let t = text || '';
    let p = parseOutbox(t);
    if (!p.writer) {
      if (!SESSION.test(o.session || '')) throw new Error(`${me.outbox} has no Writer line: run xwriter first (or give --session and --account)`);
      t = setWriter(t, writerLine(me, o.session, o.account || me.account, date));
      p = parseOutbox(t);
    }
    id = `${me.letter}${Math.max(0, ...p.entries.map((e) => e.n)) + 1}`;
    return `${t.trimEnd()}\n\n## ${id} · ${kind}${o.re ? ` · re ${o.re}` : ''} · ${date} · ${p.writer.session} · ${p.writer.account}\n${body}\n`;
  }, () => `mail ${me.name}: ${id} ${kind}${o.re ? ` re ${o.re}` : ''}`);
  return { id, ...r };
}

export function xinbox(o) {
  sizeGate(o.product, 'bob');
  const R = repo(o.product), reg = registry(R), me = participant(reg, o.as, '--as'), them = participant(reg, o.from, '--from');
  const mine = parseOutbox(readMail(R, me).text), theirs = parseOutbox(readMail(R, them).text);
  const cursor = mine.cursors[them.name]?.n ?? 0;
  return { cursor: `${them.letter}${cursor}`, writer: theirs.writer, entries: theirs.entries.filter((e) => e.n > cursor) };
}

export function xdone(o) {
  const R = repo(o.product), reg = registry(R), me = participant(reg, o.as, '--as'), them = participant(reg, o.from, '--from');
  const n = idOf(them, o.through, '--through');
  const last = Math.max(0, ...parseOutbox(readMail(R, them).text).entries.map((e) => e.n));
  if (n > last) throw new Error(`--through ${o.through}: ${them.name} has posted only through ${them.letter}${last}`);
  let cur = 0;
  const r = writeMail(R, me, (text) => {
    const p = parseOutbox(text);
    if (!p.writer) throw new Error(`${me.outbox} has no Writer line: run xwriter first`);
    cur = p.cursors[them.name]?.n ?? 0;
    return n <= cur ? text : setCursor(text, them.name, `${them.letter}${n}`);   // a cursor never moves back
  }, () => `mail ${me.name}: read ${them.name} through ${them.letter}${n}`);
  return { cursor: `${them.letter}${Math.max(n, cur)}`, moved: r.changed, commit: r.commit };
}

// For each correspondent: what I have not read of theirs, and what they have not read of mine.
export function xcheck(o) {
  sizeGate(o.product, 'bob');
  const R = repo(o.product), reg = registry(R), me = participant(reg, o.as, '--as');
  const mine = parseOutbox(readMail(R, me).text);
  const myLast = Math.max(0, ...mine.entries.map((e) => e.n));
  return reg.filter((p) => p.name !== me.name).map((p) => {
    const theirs = parseOutbox(readMail(R, p).text);
    const cur = mine.cursors[p.name]?.n ?? 0, theirRead = theirs.cursors[me.name]?.n ?? 0;
    return {
      name: p.name, account: p.account, writer: theirs.writer,
      unread: theirs.entries.filter((e) => e.n > cur).map((e) => `${e.id} ${e.kind}`),
      read: `${p.letter}${cur}`, theyRead: `${me.letter}${theirRead}`, myLast: `${me.letter}${myLast}`,
      theyOwe: myLast > theirRead ? `${me.letter}${theirRead + 1}..${me.letter}${myLast}` : null,
    };
  });
}

// As BOB: a WARNING when my outbox's Writer is not the session the plan's Status line names (bio K3361), so a successor
// that wrote its Status line but not its Writer line is seen. The plan is the tranche branch's with --tranche, else the
// working tree's; with neither, or as anyone else, nothing is checked.
export function xcheckWarnings(o) {
  if (o.as !== 'BOB') return [];
  const R = repo(o.product);
  let plan = null;
  if (o.tranche && typeof o.tranche === 'string') { const tb = branchOf('bob', o.tranche); fetchBranch(R, tb); plan = showRemote(R, tb, PLAN); }
  plan ??= readLocal(R, PLAN);
  const want = planBob(plan);
  if (!want) return [];
  const me = participant(registry(R), 'BOB', '--as');
  const w = parseOutbox(readMail(R, me).text).writer;
  if (w?.session === want) return [];
  return [`WARNING: BOB's Writer line names ${w ? w.session : 'no session'} but the plan's Status line names ${want}: run node tools/mail.mjs xwriter --as BOB --session ${want}`];
}

// ---- command line ----

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o[k] = argv[++i]; else o[k] = true;
  }
  return o;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  try {
    if (!o.tranche && cmd !== 'help' && !/^x/.test(cmd || '')) throw new Error('--tranche <T>');
    switch (cmd) {
      case 'post': { const r = post(o); console.log(`posted ${r.id} (${r.commit}); now ring: ${ringText(o.tranche, o.as === 'job' ? 'BOB' : o.module)}`); break; }
      case 'inbox': { const r = inbox(o); if (!r.entries.length) console.log(`empty (read through ${o.as === 'job' ? 'B' : 'J'}${r.cursor})`); else for (const e of r.entries) console.log(`${e.text}\n`); break; }
      case 'done': { const r = done(o); console.log(r.moved ? `read through ${o.through} (${r.commit})` : `already read through ${o.as === 'job' ? 'B' : 'J'}${r.cursor}: nothing to do`); break; }
      case 'start': console.log(`started (${start(o).commit})`); break;
      case 'state': { const r = state(o); console.log(`state ${r.state} (${r.commit})`); break; }
      case 'bob': {
        const r = bob(o), c = r.channel;
        console.log(`plan Status written (${r.commit})`);
        if (c.status === 'written') console.log(`BOB's Writer line written (${c.commit})`);
        else if (c.status === 'current') console.log(`BOB's Writer line already names ${o.session}: nothing to do`);
        else if (c.status === 'failed') console.log(`WARNING: BOB's Writer line not written (${c.error}); run by hand: node tools/mail.mjs xwriter${o.product ? ` --product ${o.product}` : ''} --as BOB --session ${o.session}`);
        break;
      }
      case 'addjob': console.log(`job address written (${addjob(o).commit})`); break;
      case 'jobbranch': { const r = jobbranch(o); console.log(`${r.branch} ${r.action}${r.from ? ` from ${r.from}` : ''} at ${r.commit}`); break; }
      case 'addr': console.log(addr(o)); break;
      case 'ring-text': console.log(ringText(o.tranche, o.to || 'BOB')); break;
      case 'check': for (const r of check(o)) console.log(`${r.module} ${r.name} ${r.session} · ${r.state} · J${r.lastJ} read J${r.read} · B${r.lastB} handled B${r.handled} · pushed ${r.pushedAgoMin} min ago → ${r.needs.join(', ') || 'nothing'}`); for (const l of sizeLines(o.product)) console.log(l); break;
      case 'xwriter': { const r = xwriter(o); console.log(r.changed ? `writer line written (${r.commit})` : `already the writer: nothing to do`); break; }
      case 'xpost': { const r = xpost(o); console.log(`posted ${r.id} (${r.commit}) on its mail branch`); break; }
      case 'xinbox': { const r = xinbox(o); if (!r.entries.length) console.log(`empty (read through ${r.cursor})`); else for (const e of r.entries) console.log(`${e.text}\n`); break; }
      case 'xdone': { const r = xdone(o); console.log(r.moved ? `read through ${r.cursor} (${r.commit})` : `already read through ${r.cursor}: nothing to do`); break; }
      case 'xcheck': for (const r of xcheck(o)) console.log(`${r.name} (${r.account}) · ${r.writer ? `writer ${r.writer.session} since ${r.writer.since}` : 'no outbox yet'} · read ${r.read} · unread: ${r.unread.join(', ') || 'none'} · they read ${r.theyRead} of ${r.myLast}${r.theyOwe ? ` (unread by them: ${r.theyOwe})` : ''}`); for (const x of xcheckWarnings(o)) console.log(x); break;
      default: throw new Error(`unknown command "${cmd}"; see the header of tools/mail.mjs`);
    }
  } catch (e) { console.error(`mail: ${e.message}`); process.exitCode = 1; }
}
