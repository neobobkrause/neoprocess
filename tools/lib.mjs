// The shared functions of the process tool (tools/proc.mjs), its hooks (tools/hooks.mjs) and the checks' gate (`proc gate`,
// run by CI on every pull request): the plan's entries, the history a merge needs, the module list, the generated
// artifacts, the test runs and their reds, the checks a module answers for, a report's Evidence section and the steps for
// Bob verified against their source (P20). Moved from the old tool and its hooks at the commit point
// (lane-neoprocess/COMMIT-POINT.md, step 1), each copied verbatim with the private helpers it needs and nothing else.
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, readdirSync, statSync } from 'node:fs';
import { totalmem, availableParallelism } from 'node:os';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactRows } from '../checks/lib.mjs';
const PROCESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PROCESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
class Refused extends Error {}
const refuse = (msg) => { throw new Refused(msg); };

// ---- git and files ----

export function repo(product) {
  const dir = resolve(product || '.');
  const root = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const g = (args, quiet = true) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'], maxBuffer: 64 << 20 }).trim();
  const rel = (p) => relative(root, join(dir, p)) || '.';
  const read = (p) => { const f = join(dir, p); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  const write = (p, text) => { const f = join(dir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
  const remote = (branch, p) => { try { return g(['show', `origin/${branch}:${rel(p)}`]); } catch { return null; } };
  const fetch = (...branches) => { for (const b of branches) { try { g(['fetch', '-q', 'origin', `+refs/heads/${b}:refs/remotes/origin/${b}`]); } catch { /* absent */ } } };
  const branch = () => g(['rev-parse', '--abbrev-ref', 'HEAD']);
  return { dir, root, g, rel, read, write, remote, fetch, branch };
}
// A cloud session starts on a shallow clone (its last 50 commits); older history stays on the remote and is fetched
// only when a step needs it: where two lines of work split (bio's full-history download at session start is retired,
// lane HANDOFF R8). Deepens the clone until `a` and `b` have a merge base, then returns it (null: no common history).
export function history(R, a, b) {
  const base = () => { try { return R.g(['merge-base', a, b]); } catch { return null; } };
  const named = [a, b].filter((x) => x.startsWith('origin/'));
  const refs = named.map((x) => `+refs/heads/${x.slice(7)}:refs/remotes/${x}`);
  // Deepening adds history; it never moves a ref the session already holds (D25: it had moved a pinned origin/main).
  const held = Object.fromEntries(named.map((x) => { try { return [x, R.g(['rev-parse', '--verify', '-q', `refs/remotes/${x}`])]; } catch { return [x, null]; } }));
  const keep = () => { for (const [x, sha] of Object.entries(held)) if (sha) R.g(['update-ref', `refs/remotes/${x}`, sha]); };
  for (let depth = 200; ; depth *= 5) {
    const found = base();
    if (found || R.g(['rev-parse', '--is-shallow-repository']) !== 'true') return found;
    if (depth > 125000) R.g(['fetch', '-q', '--unshallow', 'origin', ...refs]);
    else R.g(['fetch', '-q', `--deepen=${depth}`, 'origin', ...refs]);
    keep();
  }
}
export function modules(R) {
  const all = JSON.parse(R.read('build/modules.json') || '[]');
  return Array.isArray(all) ? all : all.modules;
}

// ---- the plan ----

// The entries of one module in one layer of the running round's plan.
export function entriesOf(planText, layer, m) {
  const sec = planText.split(/^## /m).find((s) => s.startsWith(`Layer ${layer}`)) || '';
  const block = sec.split(/^\*\*/m).find((b) => b.startsWith(`${m}**`));
  return block ? block.slice(m.length + 2).trim() : '';
}

// ---- generated artifacts ----

// The product's generated artifacts: rows of the manifest's table `| \`<path>\`[, \`<path>\`…] | <owner> | \`<regenerate>\` | \`<verify>\` |`,
// run in the table's order from the product's root. A manifest with a "Generated artifacts" section and no such row is
// refused, so a table in another form never passes as "nothing to regenerate".
export function artifacts(R) {
  const text = R.read('build/manifest.md') || '';
  const rows = artifactRows(text);
  if (!rows.length && /^## Generated artifacts/m.test(text)) refuse('build/manifest.md has a Generated artifacts section but no row `| `<path>` | <owner> | `<regenerate>` | `<verify>` |` (PRODUCT-SUPPLIES)');
  return rows.map((r) => ({ ...r, path: r.paths.join(', ') }));
}
// A job's own run (tests and checks) sees the generated artifacts as its merge will make them: each is regenerated in
// the working tree, the run made, and every artifact path put back to HEAD, so a job never commits one (JOB-LIFE §4;
// a new word key read by its test resolves before the merge regenerates the rows, bio K5583, BOB #327).
export function withArtifacts(R, fn) {
  const list = artifacts(R), paths = list.flatMap((a) => a.paths);
  for (const a of list) spawnSync('sh', ['-c', a.regen], { cwd: R.dir, encoding: 'utf8' });
  try { return fn(); } finally {
    // paths from the repository root, untrimmed (a porcelain line starts with its status columns)
    const moved = rawGit(R.root, ['status', '--porcelain', '--untracked-files=all', '--', ...paths.map(R.rel)]).split('\n').filter(Boolean).map((l) => l.slice(3));
    const tracked = moved.filter((f) => spawnSync('git', ['-C', R.root, 'cat-file', '-e', `HEAD:${f}`]).status === 0);
    if (tracked.length) R.g(['checkout', '-q', 'HEAD', '--', ...tracked]);
    for (const f of moved.filter((x) => !tracked.includes(x))) spawnSync('rm', ['-rf', '--', join(R.root, f)]);
  }
}
const rawGit = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout || '';
const run = (cmd, args, cwd) => spawnSync(cmd, args, { encoding: 'utf8', cwd, maxBuffer: 1 << 28 });
const lastLine = (r) => `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').pop();
// ---- test runs (lane HANDOFF R14: a run that gives no result says why; a runaway test fails itself) ----

// This process's memory cgroup (v2 or v1): the memory every process shares, and its count of OOM kills (null if unread).
export function memory() {
  const rd = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
  const cg = rd('/proc/self/cgroup') || '';
  const v1 = cg.match(/^\d+:(?:[^:\n]*,)?memory(?:,[^:\n]*)?:(\S*)$/m)?.[1], v2 = cg.match(/^0::(\S*)$/m)?.[1];
  const dir = v1 !== undefined && existsSync('/sys/fs/cgroup/memory') ? join('/sys/fs/cgroup/memory', v1) : v2 !== undefined ? join('/sys/fs/cgroup', v2) : null;
  const limits = [];
  for (let d = dir; d && d.startsWith('/sys/fs/cgroup'); d = dirname(d)) {
    const n = Number((rd(join(d, 'memory.max')) ?? rd(join(d, 'memory.limit_in_bytes')) ?? '').trim());
    if (n > 0) limits.push(n);
    if (d === '/sys/fs/cgroup' || d === '/sys/fs/cgroup/memory') break;
  }
  const limit = Math.min(totalmem(), ...limits);
  const ooms = () => { const t = dir && (rd(join(dir, 'memory.events')) ?? rd(join(dir, 'memory.oom_control'))); const n = t?.match(/^oom_kill (\d+)$/m)?.[1]; return n === undefined ? null : Number(n); };
  return { limit, ooms };
}
// One `node --test` run, its report written to a file (never a pipe), at a file concurrency the memory allows, each test
// process under a heap cap and, by tools/memwatch.mjs, a memory cap: a process over it is killed and named, so a runaway
// test fails by itself (lane R14: in bio, 3 files reached 12 GB outside the JS heap and starved their neighbours).
// Returns the summary, the failed tests, and the results it could not get, each with its cause:
// { tests, pass, fail, failed, noResult: [{ name, cause }], peaks, heavy, report }.
export function runSuite(R, files, o = {}) {
  const mem = memory(), MiB = 1 << 20, heap = Number(o.heapMb) || Math.min(4096, Math.floor(mem.limit / MiB / 4));
  const conc = Math.max(1, Math.min(availableParallelism() - 1, Math.floor((mem.limit * 0.6) / (heap * MiB))));
  const cap = Number(o.capMb) || Math.floor((mem.limit * 0.6) / MiB / conc);
  const dir = join(R.g(['rev-parse', '--absolute-git-dir']), 'proc-runs'); mkdirSync(dir, { recursive: true });
  const base = join(dir, `${o.label || 'run'}-${new Date().toISOString().replace(/[:.]/g, '-')}`), report = `${base}.tap`, watchLog = `${base}.mem`;
  // A clean environment: under a test runner, NODE_TEST_CONTEXT would send the child's report to the parent instead.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --max-old-space-size=${heap}`.trim();
  const min = Number(o.timeoutMin) || 30, oom0 = mem.ooms();
  const watch = spawn(process.execPath, [join(PROCESS, 'tools/memwatch.mjs'), String(process.pid), String(cap), watchLog], { stdio: 'ignore' });
  const out = openSync(report, 'w'), err = openSync(`${base}.err`, 'w');
  const r = spawnSync('node', ['--test', '--test-reporter=tap', `--test-concurrency=${conc}`, ...files], { cwd: R.dir, env, stdio: ['ignore', out, err], timeout: min * 60000 });
  closeSync(out); closeSync(err); watch.kill('SIGTERM');
  const ooms = oom0 === null ? null : mem.ooms() - oom0;
  const watched = (existsSync(watchLog) ? readFileSync(watchLog, 'utf8').match(/^\{.*\}$/gm) || [] : []).map((l) => JSON.parse(l)).sort((a, b) => b.mb - a.mb);
  const capped = new Set(watched.filter((x) => x.killed).map((x) => x.file));
  const text = readFileSync(report, 'utf8'), all = `${text}\n${readFileSync(`${base}.err`, 'utf8')}`;
  const n = (k) => Number((text.match(new RegExp(`^(?:ℹ|#) ${k} (\\d+)$`, 'm')) || [])[1] ?? NaN);
  const killedBy = (sig, file) => (file && capped.has(file) ? `over its ${cap} MB memory cap (killed by proc's memory watch)` : sig === 'SIGABRT' && /heap out of memory/.test(all) ? `out of heap (over its ${heap} MB cap)` : sig === 'SIGKILL' && ooms ? 'killed by the memory cgroup (OOM)' : `killed (${sig})`);
  // A test file whose process died is reported by node as `not ok - <file>` with its signal: not a red but no result.
  const noResult = [], dead = new Set();
  for (const x of text.matchAll(/^( *)not ok \d+ - (.+?)(?: # .*)?\n\1 {2}---\n([\s\S]*?)\n\1 {2}\.\.\.$/gm)) {
    const sig = x[3].match(/^ *signal: '(\w+)'$/m)?.[1];
    const name = x[2].trim();
    if (sig) { noResult.push({ name: name.startsWith('/') ? relative(R.root, name) : name, cause: killedBy(sig, name) }); dead.add(name); }
  }
  const failed = [...new Set([...text.matchAll(/^\s*not ok \d+ - (.+?)(?: # .*)?$/gm)].map((x) => x[1].trim()))].filter((x) => !dead.has(x));
  const plan = Number(text.match(/^1\.\.(\d+)$/m)?.[1] ?? NaN), seen = (text.match(/^(?:not )?ok \d+ /gm) || []).length;
  const res = { tests: n('tests'), pass: n('pass'), fail: n('fail'), failed, noResult, report };
  // The run as a whole: the runner itself killed, timed out, or its report cut short (no summary, or fewer results than planned).
  const oomNote = ooms ? `; the memory cgroup killed ${ooms} process(es) for memory during the run` : '';
  const tail = all.trim().split('\n').filter((l) => l.trim()).slice(-3).join(' | ').slice(0, 300);
  let whole = null;
  if (r.error?.code === 'ETIMEDOUT') whole = `timed out after ${min} min`;
  else if (r.signal) whole = `the runner was ${killedBy(r.signal, '(runner)')}${oomNote}`;
  else if (Number.isNaN(res.tests) || Number.isNaN(plan) || seen < plan) whole = `report incomplete: ${seen} of ${Number.isNaN(plan) ? '?' : plan} results, exit ${r.status}${oomNote}; its tail: ${tail}`;
  if (whole) res.noResult.push({ name: 'the whole suite', cause: whole });
  const show = (x) => `${x.file.startsWith('/') ? relative(R.root, x.file) : x.file} ${x.mb} MB`;
  res.peaks = watched.slice(0, 3).map(show);
  res.heavy = watched.filter((x) => x.mb > cap / 2).map(show);
  return res;
}
// A module's tests, every *.test.mjs under its `tests` paths. A report cut short with no kill and no timeout (seen once
// with --test-force-exit and a piped report, never reproduced; lane R14) is run once more, and says so.
export function runTests(R, m, o = {}) {
  const mod = modules(R).find((x) => x.id === m) ?? refuse(`no module ${m} in build/modules.json`);
  const files = (mod.tests || []).flatMap((p) => R.g(['ls-files', '--', R.rel(p)]).split('\n')).filter((f) => f.endsWith('.test.mjs')).map((f) => join(R.root, f));
  if (!files.length) return { tests: 0, pass: 0, fail: 0, failed: [], noResult: [], peaks: [], heavy: [] };
  const first = runSuite(R, files, { ...o, label: m });
  const cut = first.noResult.find((x) => x.name === 'the whole suite' && /^report incomplete/.test(x.cause) && !/memory cgroup/.test(x.cause));
  if (!cut) return first;
  return { ...runSuite(R, files, { ...o, label: `${m}-rerun` }), rerun: `the first run's ${cut.cause.split(';')[0]} (${first.report}); run once more` };
}
// What a run did not pass, by name: the failed tests and the results it could not get. Old ones are inherited (R10).
export const reds = (t) => [...(t.failed || []), ...(t.noResult || []).map((x) => `NO RESULT ${x.name}`)];
// Old debt never blocks new work, and new work never adds to it (lane HANDOFF R10; the old process's "no new finding in
// your files"). A failure is judged against the same measure taken on the tranche before the work: only a new one
// refuses. A check's finding is compared without its line numbers, so a finding that only moved is the same finding.
const norm = (c, l) => `${c}: ${l.replace(/^FAIL\s+/, '').replace(/:\d+(?::\d+)?\b/g, '').trim()}`;
const WORDS_TABLE = 'build/words.json';   // the product's own words configuration (checks/words.mjs): the words check runs where it exists
// The checks a module's work answers for (JOB-LIFE §4), scoped to the module where the check takes one.
export function moduleChecks(R, m) {
  const names = ['format', 'architecture', 'coverage', 'fixtures', ...(existsSync(join(R.dir, WORDS_TABLE)) ? ['words'] : [])];
  const fails = new Set();
  for (const c of names) {
    const r = run('node', [join(PROCESS, `checks/${c}.mjs`), R.dir, ...(c === 'format' ? [] : [m])]);
    const lines = `${r.stdout}`.split('\n').filter((l) => l.startsWith('FAIL'));
    for (const l of lines) fails.add(norm(c, l));
    if (r.status && !lines.length) fails.add(`${c}: ${lastLine(r)}`);
  }
  return { names, fails };
}
// Every check over the whole product (checks/run.mjs), once per layer close.
export function allChecks(R) {
  const r = run('node', [join(PROCESS, 'checks/run.mjs'), R.dir]);
  const fails = new Set(`${r.stdout}`.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => norm('check', l)));
  if (r.status && !fails.size) fails.add(`check: ${lastLine(r)}`);
  return { fails };
}

// ---- the report's evidence (P20) ----

// P20: a report states what it read or ran. Its `**Evidence**` section (a line starting `**Evidence**`, optionally with the
// first item after a `·` or `:`) runs to the next line that starts `**` or `#`; each line is an item (a bullet or number
// marker is dropped). An item counts when it is a command run with its result (a `command` followed by text), a file:line,
// or a test run with its totals (`3/3`, `pass 3`, `3 pass`, `tests 3`). Returns the items, or null with no section.
// The report's evidence forms are the jobs module's (tools/jobs.mjs, R5), read here by the legacy callers.
export { EVIDENCE_FORMS, EVIDENCE_ITEM, evidenceItems } from './jobs.mjs';

// ---- steps for Bob (P20) ----

// A step for Bob is written from the very thing he will use. Every label in the steps set in **bold** or in `backticks`
// must occur verbatim in at least one source file, after HTML entity decoding (of the source and of the label). A label
// the steps define themselves (a placeholder) is exempt only when wrapped as <<label>>: `**<<your name>>**`, `<<name>>`.
// Code spans are read first and masked, so a bold label never contains one. On success the steps text is printed
// followed by `verified: <n> labels in <sources>` (n = distinct labels checked, exempt ones not counted) and
// `.git/proc-steps-ok.json` {sha256, sources, at} is written; the BOB Stop hook (hooks.mjs) lets a numbered list
// with bold labels end a turn only when that file is under 30 minutes old and its sha256 matches `stepsHash` of the list.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', copy: '©', times: '×', rarr: '→', larr: '←', bull: '•' };
export function decodeEntities(t) {
  return String(t).replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z]+));/g, (m, d, h, n) => {
    if (n) return ENTITIES[n] ?? m;
    const c = d ? Number(d) : parseInt(h, 16);
    try { return String.fromCodePoint(c); } catch { return m; }
  });
}
// The labels of a steps text: [{ label, line, exempt }] in order of appearance.
export function stepLabels(text) {
  const out = [];
  String(text).split('\n').forEach((raw, i) => {
    const note = (label) => { const l = label.trim(); if (l) out.push({ label: l, line: i + 1, exempt: /^<<[\s\S]+>>$/.test(l) }); };
    let line = raw;
    for (const m of raw.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) { note(m[1]); line = line.replace(m[0], ' '.repeat(m[0].length)); }
    for (const m of line.matchAll(/\*\*([^*\n]+?)\*\*/g)) note(m[1]);
  });
  return out;
}
// The numbered list of a text, normalised: its item lines (`1.` or `1)` after optional indentation) and the indented
// lines that follow them, each with runs of whitespace collapsed to one space and trimmed, blank lines dropped, joined
// by "\n". Prose between items, and unindented lines, are not part of it. '' when there is no numbered item.
export function numberedList(text) {
  const out = []; let in_ = false;
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const item = /^\s*\d+[.)]\s+\S/.test(raw);
    if (item) in_ = true; else if (!in_ || !/^\s+\S/.test(raw)) { in_ = false; continue; }
    out.push(raw.replace(/\s+/g, ' ').trim());
  }
  return out.join('\n');
}
// A list is "steps for Bob" when it has at least two numbered items, the first numbered 1, and a **bold** label in it.
export function isStepsList(text) {
  const list = numberedList(text), items = list.split('\n').filter((l) => /^\d+[.)]\s/.test(l));
  return items.length >= 2 && /^1[.)]\s/.test(items[0]) && /\*\*[^*\n]+\*\*/.test(list);
}
export const stepsHash = (text) => createHash('sha256').update(numberedList(text) || String(text).replace(/\s+/g, ' ').trim()).digest('hex');
export const STEPS_OK = 'proc-steps-ok.json';
export function stepsCmd(o) {
  if (typeof o.file !== 'string' || typeof o.source !== 'string') refuse('--file <steps.md> --source <path1,path2,…>');
  const text = existsSync(o.file) ? readFileSync(o.file, 'utf8') : refuse(`${o.file}: no such steps file`);
  const sources = o.source.split(',').map((x) => x.trim()).filter(Boolean);
  if (!sources.length) refuse('--source names no file');
  const hay = sources.map((f) => (existsSync(f) ? decodeEntities(readFileSync(f, 'utf8')) : refuse(`${f}: no such source file`))).join('\n');
  const labels = stepLabels(text), missing = [], seen = new Set();
  for (const l of labels) {
    if (l.exempt) continue;
    seen.add(l.label);
    if (!hay.includes(decodeEntities(l.label))) missing.push(l);
  }
  if (missing.length) refuse(`${missing.length} label(s) in ${o.file} not found verbatim in ${sources.join(', ')}:\n${missing.map((l) => `  line ${l.line}: "${l.label}"`).join('\n')}\nwrite the step from the page's or screen's own words; a placeholder the steps define themselves is wrapped as <<label>>`);
  // the record is kept where the Stop hook reads it: the checkout the role is recorded in (#13's writer test, 30 Oct: run from
  // a folder outside any checkout, the command died on git's error and the steps never reached Bob)
  let R; try { R = repo(o.product || process.env.CLAUDE_PROJECT_DIR || '.'); } catch { R = null; }
  if (!R) { try { const P = repo(PROCESS_ROOT); if (existsSync(join(P.root, '.git', 'proc-role.json'))) R = P; } catch { /* none */ } }
  if (!R) refuse('--product <the checkout your role is recorded in>: this folder is not a git checkout, and none with a recorded role was found');
  writeFileSync(join(R.root, '.git', STEPS_OK), JSON.stringify({ sha256: stepsHash(text), sources, at: new Date().toISOString() }));
  return `${text.trimEnd()}\n\nverified: ${seen.size} labels in ${sources.join(', ')}`;
}

// ---- from the old hooks: BOB's last message, and its steps for Bob checked (P20) ----

// BOB's last assistant message (P20). The Stop hook input carries `last_assistant_message` (Claude Code hooks docs, Stop)
// and `transcript_path` (common field; the docs say the transcript "may lag the in-memory conversation"), so the message
// is taken from the first when it is a string, else from the transcript: the text blocks of the assistant entries after
// the last `user` entry. null when neither can be read.
export function lastAssistantText(input) {
  if (typeof input.last_assistant_message === 'string') return input.last_assistant_message;
  if (typeof input.transcript_path !== 'string') return null;
  let rows; try { rows = readFileSync(input.transcript_path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return null; }
  const text = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i], m = r.message;
    if (r.type === 'user' || m?.role === 'user') break;
    if (r.type !== 'assistant' && m?.role !== 'assistant') continue;
    const c = m?.content;
    const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
    if (t) text.unshift(t);
  }
  return text.length ? text.join('\n') : null;
}
// P20: a numbered list with **bold** labels in BOB's last message is a step for Bob; the turn ends only when
// `.git/proc-steps-ok.json` (written by `proc steps`) is under 30 minutes old and its sha256 matches the list.
export function stepsReason(message, root, now = Date.now()) {
  if (!message || !isStepsList(message)) return null;
  let ok = null; try { ok = JSON.parse(readFileSync(join(root, '.git', STEPS_OK), 'utf8')); } catch { /* none */ }
  const how = 'steps for Bob are sent only as `node tools/proc.mjs steps --file <steps.md> --source <the page or screen code,…>` printed them (P20): run it and send its output unchanged';
  if (!ok) return `your message has a numbered list with bold labels, but ${how} (no verified steps on record)`;
  if (!(now - Date.parse(ok.at) < 30 * 60e3)) return `your message has a numbered list with bold labels, but the steps last verified are over 30 minutes old: ${how}`;
  if (ok.sha256 !== stepsHash(message)) return `your message has a numbered list with bold labels that is not the list \`proc steps\` verified: ${how}`;
  return null;
}

// ---- plain words for Bob (rulebook SES 9; issue 61; Bob, 30 Oct: "speak to your audience in words they understand") ----
// Bob reads the last message of a BOB's, ROOT's, a lane's, the neoProcess lane's and an onboarding session's turn, and only
// that message: no tool output, no file, no other session's words. So a label he does not know, or a reference only
// those resolve, reaches him as noise. This check refuses the mechanical kinds of it, deterministically; the fresh reader
// (the skill `neoprocess-reader`, a model given only the message and who Bob is) judges the rest. Not judged: a fenced
// block (text given to him to paste), a link's address (its visible text is judged), and a numbered list `proc steps`
// verified (its labels are the page's own words, P20).
export const BOB_READS = new Set(['bob', 'root', 'lane', 'process', 'onboard']);
const RULEBOOK_IDS = 'P|SES|GOV|DES|REP|BLD|INT|PLN|REL|REQ|USE';
const PLAIN_EXEMPT = /^(Q[1-4]|H[12]|CO2|[AS]B\d+)$/;   // words of Bob's own field: a quarter, a half-year, a bill
const ACT_ASK = /\byour (?:one |next |only |first |last )?(?:step|act|job|task)s?\b|\b(?:you(?:'ll| will)? need to|you have to|you must|I need you to)\b|\bplease (?:open|click|start|paste|go|sign|log|create|set|add|approve|run|type|copy|visit|enter|install|connect|accept|choose|select|press|reply|answer|confirm)\b/i;
const ACT_DO = /(?:^|[.!?:]\s+|^\s*[-*]\s+)(?:Open|Click|Paste|Go to|Sign in|Log in|Start a|Start the|Approve|Visit|Type|Copy|Enter|Install|Connect|Accept|Choose|Select|Press|Navigate to)\b/m;
const actIn = (x) => x.match(ACT_ASK) || x.match(ACT_DO);
export function plainFaults(message) {
  const faults = [], seen = new Set();
  const add = (kind, word) => { const k = `${kind}: ${word}`; if (!seen.has(k)) { seen.add(k); faults.push({ kind, word }); } };
  let t = String(message || '').replace(/\r/g, '');
  t = t.replace(/^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, ' ');            // a fenced block: text to paste
  t = t.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1').replace(/<?https?:\/\/[^\s>)]+>?/g, ' ');   // links: their text only
  // a line that links a page is an act with its place: the page holds the steps (a setup page written from the screens)
  const linked = new Set(String(message || '').replace(/\r/g, '').split('\n').filter((l) => /\]\([^)\s]+\)|https?:\/\//.test(l)).map((l) => l.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1').replace(/<?https?:\/\/[^\s>)]+>?/g, ' ')));
  const list = new Set(numberedList(t).split('\n').filter(Boolean)), lines = t.split('\n');
  const prose = lines.filter((l) => !list.has(l.replace(/\s+/g, ' ').trim()) && !linked.has(l)).join('\n');
  for (const m of t.matchAll(/`([^`\n]+)`/g)) add('code in backticks', m[0]);
  const plain = t.replace(/`[^`\n]+`/g, ' ');
  for (const m of plain.matchAll(/\b(?:session|trig|env|ccpool|toolu|msg|file)_[0-9A-Za-z]{6,}\b/g)) add('a session, trigger or environment id', m[0]);
  for (const m of plain.matchAll(/(?<![\w&/])#\d+\b/g)) add('a bare number', m[0]);
  for (const m of plain.matchAll(/(?:§\s*\d+(?:\.\d+)*|\b(?:principle|rule|section)\s+\d+\b)/gi)) add('a principle, rule or section number', m[0]);
  for (const m of plain.matchAll(new RegExp(String.raw`\b(?:${RULEBOOK_IDS})\s?\d{1,2}(?:\.\d+)?\b`, 'g'))) add('a principle, rule or section number', m[0]);
  for (const m of plain.matchAll(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[a-z]?\b/g)) add('an entry or ruling id', m[0]);
  for (const m of plain.matchAll(/\b[A-Z]{1,3}\d{1,5}[a-z]?\b/g)) if (!PLAIN_EXEMPT.test(m[0]) && !new RegExp(String.raw`^(?:${RULEBOOK_IDS})\d{1,2}$`).test(m[0])) add('an entry or ruling id', m[0]);
  for (const m of plain.matchAll(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g)) add('a commit hash', m[0]);
  for (const m of plain.matchAll(/(?:^|[\s("'])((?:\.{1,2}|~)?\/?(?:[\w.-]+\/)*[\w-][\w.-]*\.(?:md|mjs|cjs|js|ts|tsx|jsx|json|ya?ml|sh|html|csv|txt|py|toml|lock|env))(?=$|[\s)"',;:!?]|\.(?:\s|$))/gim)) add('a file name', m[1]);
  for (const m of plain.matchAll(/(?:^|\s)((?:\.{1,2}|~)?\/?(?:build|tools|checks|rulebooks|dryrun|src|docs|\.claude|\.github|lane-[\w-]+)\/[\w./-]*[\w/-])/g)) add('a file name', m[1]);
  const act = actIn(prose.replace(/`[^`\n]+`/g, ' '));
  if (act) add('an act asked of Bob in prose (it goes in numbered steps `proc steps` verified)', act[0].trim());
  const items = [...list].filter((l) => /^\d+[.)]\s/.test(l));
  const step = items.find((l) => actIn(l.replace(/^\d+[.)]\s+/, '')));
  if (step && !isStepsList(t)) add('steps for Bob without the page\'s own labels in bold (they are written from the page and verified by `proc steps`)', step.slice(0, 60));
  return faults;
}
export function plainReason(message) {
  const f = plainFaults(message);
  if (!f.length) return null;
  const by = new Map(); for (const x of f) by.set(x.kind, [...(by.get(x.kind) || []), x.word]);
  return `Bob reads this message and nothing else (rulebook SES 9): ${[...by].map(([k, w]) => `${k} (${w.slice(0, 4).map((x) => `"${x}"`).join(', ')})`).join('; ')}. Rewrite it in words he knows: name the thing itself (the account, the page, the change and what it does for him), never its label; give a link for what he should look at; an act for him goes in numbered steps written from the page he will use and verified by \`proc steps\``;
}

// ---- the evidence check (rulebook SES 9; P20; issue 61): the message adds nothing the session did not read ----
// The fresh reader sees only the message, so it cannot see a claim the session added (#13's writer test, 30 Oct: 20 of 35
// finals fully accurate). This check gives a fresh model the message and what the session saw: every message to it and
// every tool call and tool result in the transcript, newest kept when over the limit; never its own words, which are not
// evidence (#14's round 1, 30 Oct: without its calls, "I tried to open that file" was refused).
// The model is the one a hook can run: `claude -p`, no tools, under the session's subscription (acts.md `claude -p`).
export const EVIDENCE_LIMIT = 160_000, EVIDENCE_MODEL = 'claude-sonnet-5-5';   // issue 115 follow-up (#19, 30 Oct): a long turn (888 rows, 419,000 characters) still cut at 120,000 with caps down to 1,500; the limit raised and the caps taken further down before the oldest is cut
const blockText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b?.type === 'text' ? b.text : b?.type === 'tool_result' ? blockText(b.content) : '')).filter(Boolean).join('\n') : '');
export function turnEvidence(rows, limit = EVIDENCE_LIMIT) {
  const parts = [];
  for (const r of rows) {
    const m = r?.message, c = m?.content;
    if (r?.isSidechain) continue;
    // what the session ran is evidence of what it did; its words are not
    if ((r?.type === 'assistant' || m?.role === 'assistant') && Array.isArray(c)) { for (const b of c) if (b?.type === 'tool_use') parts.push(`[the session ran ${b.name}]\n${JSON.stringify(b.input ?? {}).slice(0, 600)}`); continue; }
    if (!(r?.type === 'user' || m?.role === 'user')) continue;
    if (Array.isArray(c) && c.some((b) => b?.type === 'tool_result')) { const t = blockText(c); if (t.trim()) parts.push(`[a tool's output]\n${t}`); continue; }
    const t = blockText(c);
    if (!t.trim() || /^Stop hook feedback/.test(t)) continue;
    parts.push(`[a message to the session]\n${t}`);
  }
  // Issue 115 (the lane's turn of 30 Oct, #19): a whole session's evidence was 308,000 characters and the window held the newest
  // 120,000, so the turn's decisive acts (an archive refused, a message delivered) were cut and true claims about them
  // refused, ten judge runs for one message. Over the limit, every tool output is first shrunk to a head and a tail, in
  // steps, so what the session ran and the result lines survive across the whole session; the oldest is cut only when
  // the shrunk evidence is still over.
  let out = parts.join('\n\n');
  for (const cap of EVIDENCE_CAPS) { if (out.length <= limit) break; out = parts.map((p) => shrinkPart(p, cap)).join('\n\n'); }
  if (out.length > limit) out = `[earlier evidence cut: older than this is unknown to the judge]\n${out.slice(out.length - limit)}`;
  return out;
}
export const EVIDENCE_CAPS = [6000, 3000, 1500, 700, 300];
// A tool's output shrunk to its head and its tail (the result line is usually last), the cut named; acts and messages
// to the session are left whole (an act is already at most 600 characters).
export function shrinkPart(part, cap) {
  if (!part.startsWith("[a tool's output]") || part.length <= cap) return part;
  const head = Math.floor(cap * 2 / 3), tail = cap - head;
  return `${part.slice(0, head)}\n[… ${part.length - cap} characters of this output cut …]\n${part.slice(part.length - tail)}`;
}
export function evidencePrompt(message, evidence) {
  return `You check one message before it reaches Bob, the human who oversees AI sessions that build software under a process called neoProcess. Bob reads only this message. A session wrote it at the end of its turn. Rule (P20): the message says only what the session read or measured; it translates, never adds.

THE EVIDENCE: everything the session was told and every tool output it saw (its own words are left out; when the evidence is long, the oldest part is cut):
<<<EVIDENCE
${evidence}
EVIDENCE>>>

THE MESSAGE:
<<<MESSAGE
${message}
MESSAGE>>>

Find a claim in the message that the evidence does not support: a fact, number, date, state or result not in the evidence or contradicting it; a cause or consequence the evidence does not show; a reassurance ("nothing depends on it", "no work was lost", "safe to ignore", "ready to go in"); a time estimate or a prediction the evidence does not give; a small inference past the evidence: an order or sequence ("the first step", "one after another"), a word that implies earlier or further items ("more", "another", "again", "still"), what a value means ("no expiry" read from a null field), or what a named thing is when the evidence does not say it. Supported, and never a fault: a plain-words translation of what the evidence says (a label or id put into ordinary words, a figure restated); a short plain description of what a thing the evidence names is or does, when the evidence (the process text included) says so; a name of Bob or of his own accounts; leaving things out; saying something is unknown; saying what the session will do next or what nobody needs to do; telling Bob how to give his answer or where to act (for example, by replying in this conversation); the line "Nothing for Bob to do." (it says Bob has no act, never that a problem is harmless); ordinary knowledge of how the tools named work. When the evidence begins with a cut, a claim about older work is not a fault.

Answer with JSON only. No unsupported claim: {"ok": true}. Otherwise: {"ok": false, "reason": "Evidence check (P20, translate, never add): \\"<the exact words>\\" is not in what the session read: <say only what the evidence shows, or call it unknown>"}`;
}
// The model's verdict, read from `claude -p --output-format json`; anything unreadable passes (the check never blocks on its own failure).
export function evidenceVerdict(out) {
  let r; try { r = JSON.parse(out).result; } catch { return null; }
  const m = String(r || '').match(/\{[\s\S]*\}/); if (!m) return null;
  let v; try { v = JSON.parse(m[0]); } catch { return null; }
  return v && v.ok === false && typeof v.reason === 'string' ? v.reason : null;
}
// Issue 102 (Bob, 30 Oct: he sees every refused draft): a message judged before it is sent. `proc say --file` runs the
// turn-end checks on a draft and records the text it passed (its hash, by session); the Stop and evidence hooks then
// skip what was already judged, so a draft that fails never becomes a message, and a passing one is judged once.
export const SAID_FILE = 'proc-said.json';
export const saidKey = (text) => createHash('sha256').update(String(text ?? '').replace(/\r\n/g, '\n').trim()).digest('hex');
export function saidPassed(root, session, text) {
  try { const w = JSON.parse(readFileSync(join(root, '.git', SAID_FILE), 'utf8')); return !!session && w.session === session && w.ok === true && w.key === saidKey(text); } catch { return false; }
}
export const SAY_HINT = '; judge the rewrite before you send it: write it to a file and run `proc say --file <that file>` until it answers OK, then end the turn with exactly that text (issue 102)';
// The session's own transcript, where Claude Code keeps it: the newest transcript of the project directory's folder.
export function transcriptOf(root, home = process.env.HOME) {
  if (!home) return null;
  const dir = join(home, '.claude', 'projects', resolve(root).replace(/[^A-Za-z0-9]/g, '-'));
  let best = null; try { for (const f of readdirSync(dir)) { if (!f.endsWith('.jsonl')) continue; const m = statSync(join(dir, f)).mtimeMs; if (!best || m > best.m) best = { f: join(dir, f), m }; } } catch { return null; }
  return best?.f ?? null;
}
// The fresh reader (rulebook SES 9), one text for every product: run by the Stop hook for the roles Bob reads once the
// reader is on, and by `proc say` before a draft is sent (issue 102); it was the reader skill's prompt hook until issue 111.
export const FRESH_READER_PROMPT = "You are a fresh reader standing in for Bob, to check one message before it reaches him. Bob is a California energy-policy strategist and investor, not a software engineer. He decides policy, requirements, high-level architecture and UX for products built by many AI sessions under a process called neoProcess. He sees ONLY this one message: the last thing a session wrote at the end of its turn. He does not see the session's tool output, its files, other sessions' messages, or earlier turns.\n\nThe hook input is this JSON: $ARGUMENTS\nThe message is its field last_assistant_message.\n\nWords Bob uses himself and knows; never object to any of them: Bob, BOB (the architecture session), ROOT, session, sessions, lane, lanes, job, jobs, module, modules, layer, layers, tranche, tranches, requirement, requirements, architecture, UX, design, design stream, canon, ruling, rulings, plan, process, the new process, neoProcess, Civicsmith, product, development, test, tests, dry run, release, releases, deploy, deployment, walk, walker, installer, alpha, beta, legacy, admin, pull request, PR, merge, merged, main, branch, commit, repository, repo, GitHub, GitHub issue, issue, organization, Cloudflare, token, tokens, secret, workflow, Claude, Claude account, Opus, Sonnet, Haiku, model, context, refresh, handoff, successor, worker, workers, permission, permissions, approval, approvals, Auto mode, API, key, environment, weekly meter, weekly limit, page, link.\n\nJudge exactly three faults and nothing else. Never object to style, length, tone, formality, a technical word whose sentence is still clear, or any word on Bob's list.\n1. UNDEFINED LABEL: a name, code, number or abbreviation that stands for a thing (a ticket or ruling number, a session number such as \"#13\", an entry id, a file or command name, an internal nickname) that is neither on Bob's list nor explained in the message in words on it or in ordinary English.\n2. UNRESOLVABLE REFERENCE: a pointer to something this message does not itself identify, so Bob cannot tell what it means from this message alone: \"that account\", \"your page\", \"the block\", \"the other session\", \"as before\", \"the second one\", \"it\" with no thing named. A reference is resolved when the message names the thing in words Bob knows (\"your Civicsmith Claude account\", \"the page linked above\" with the link in the message).\n3. ACT WITHOUT PLACE AND STEPS: the message asks Bob to do something but gives neither numbered steps (in order, with the words he will see) nor a link to the page that holds those steps. A message that links that page (\"the steps are step 7 of your setup page\", with the link) has place and steps. A decision asked of Bob is an act too: it must say how he gives his answer (for example, by replying in this conversation). A message that says plainly it cannot give the steps, says why, and says what happens next, is not at fault: rewriting cannot fix what the session cannot see.\n\nNot faults: a link (judge only its visible text); a block in a code fence given to Bob to paste; the line \"Nothing for Bob to do.\"; a message that reports work done in plain words even if it is long.\n\nAnswer with JSON only. If none of the three faults is present: {\"ok\": true}. Otherwise: {\"ok\": false, \"reason\": \"Fresh reader (Bob sees only this message): <fault 1, 2 or 3>: \\\"<the exact words>\\\": <what Bob would need instead, in one sentence>\"}. If the message is empty: {\"ok\": true}.";
export function freshReaderReason(text, run, prompt = FRESH_READER_PROMPT) {
  return evidenceVerdict(run(prompt.replace('$ARGUMENTS', JSON.stringify({ last_assistant_message: text }))));
}
// The two model runs of a turn's end, the fresh reader first; nothing when the message was judged by `proc say`.
export function judgeReason(input, run) {
  const text = lastAssistantText(input); if (!text || !text.trim()) return null;
  return freshReaderReason(text, run) || evidenceReason(input, run);
}
export function evidenceReason(input, run) {
  const message = lastAssistantText(input);
  if (!message || !message.trim() || typeof input.transcript_path !== 'string') return null;
  let rows; try { rows = readFileSync(input.transcript_path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return null; }
  return evidenceVerdict(run(evidencePrompt(message, turnEvidence(rows))));
}
