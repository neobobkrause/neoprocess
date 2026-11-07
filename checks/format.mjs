// Check 4, format (rulebooks PLN 1-2, REQ 3; P4, P5, P15): the build state's files parse, every id they
// reference exists, and every module's `paths` and `tests` entry names a file or directory in the product tree.
// Also (retired by PERMISSIONS §2.4; P15, P17): every ruling numbered after APPROVALS_LAST_EXEMPT that records Bob's approval of a
// refused act states its standing-list decision.
// Also (N656, bio K1763; P15, P17; a proposed revision until certified, rulebook GOV 5): where the product keeps a register of
// Anthropic's terms, every statement of a limit on Anthropic's accounts, plans or terms cites a register id or a ruling of Bob's.
// Also (P19, rulebook PLN 2; bio K3923): every entry of `build/plan/next.md` names one of P19's hard reasons.
// Also (P19, rulebook PLN 1; bio K5015): in `build/plan/current.md`, the running fix round's plan file(s) it names
// (`build/plan/fix-round-*.md` that exist, so not the archived ones) and `build/handoff.md`, a line that defers work
// ("next fix round", "next round", "a later round", "later tranche", "deferred to") fails unless it cites `next.md`:
// work that waits is an entry of `next.md` only, and plan text names dependencies, never "later".
// Also (P20; Bob, K5326): in each lane HANDOFF file (`build/plan/beta/*/HANDOFF.md`,
// `docs/development/investigation-design/HANDOFF.md`) every line that starts a dated report (`**P-<n>`, `**H<n>`, `**R<n>`,
// `**L<n>`, `**U<n>` or `**B<n>`) and holds a date of EVIDENCE_FROM or later has `Evidence:` within the entry (up to the
// next line that starts a report, or a heading). Earlier entries are exempt.
// Also (N2-45; build/requirements/architecture.md R6): a module's `paths` or `tests` entry that names no committed file is
// pending, not failed, while that module's job is live on the epoch's state branch (its line STARTING, WORKING, REOPENED
// or a recorded wait) and its layer is not CLOSED in the state branch's plan; it fails once the layer has closed, or
// with no live job. The state branch is read at the commit the local `origin/state/<epoch>` ref names (R10: never
// fetched by the check; the runner refreshes it, checks/run.mjs).
// The module order (layers, `uses`, `from`) is the architecture check's (R1, checks/architecture.mjs `modules`).
// Usage: node checks/format.mjs <product-root>
import { pathToFileURL } from 'node:url';
import { snapshot, requirementFiles, finder, report } from './lib.mjs';
// R6: requirement files are read by the one parser (requirements R1) and Test lines judged by its measurement line (R4).
import { parse, isMeasurement } from '../tools/requirements.mjs';


// N440 (P3): an unresolved merge leaves conflict markers; a build-state file holding one is refused.
function conflictMarkers(S, add) {
  const files = ['build/modules.json', 'build/layers.md', 'build/plan/current.md', 'build/plan/next.md', 'build/rulings.md',
    ...requirementFiles(S).map((id) => `build/requirements/${id}.md`)];
  for (const f of files) {
    const text = S.read(f);
    if (text === null) continue;
    text.split('\n').forEach((l, i) => {
      if (l.startsWith('<<<<<<< ') || l.replace(/\r$/, '') === '=======' || l.startsWith('>>>>>>> ')) add('conflict-marker', { file: f, line: i + 1 }, `${f}:${i + 1}: merge-conflict marker`);
    });
  }
}

// N2-45: the record of the epoch, read at the local ref of its state branch (record's layout: `epoch.md`, `plan.md`,
// `jobs/<module>.md`). None, or more than one open, reads as no record: no entry is pending.
const JOB_LINE = /^\*\*Status\*\* · ([A-Z][A-Z0-9-]* #\d+) · (session_[0-9A-Za-z]+|-) · (.+?)(?: · PR #(\d+))?$/m;
export const LIVE_JOB = /^(?:STARTING|WORKING|REOPENED|WAITING: |BLOCKED: |NEEDS BOB: )/;
export function stateRecord(S) {
  const refs = (S.q(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/state/']) || '').split('\n').filter(Boolean);
  const open = refs.filter((r) => { const e = S.q(['show', `${r}:epoch.md`]); return e !== null && !/^closed /m.test(e); });
  if (open.length !== 1) return null;
  const ref = open[0];
  const layers = {};
  for (const part of ((S.q(['show', `${ref}:plan.md`]) || '').match(/^\*\*Layers\*\* · (.*)$/m)?.[1] || '').split(';')) { const m = part.trim().match(/^(\d+) (\S+)/); if (m) layers[m[1]] = m[2]; }
  const job = (m) => { const t = S.q(['show', `${ref}:jobs/${m}.md`]); const x = t && t.match(JOB_LINE); return x ? x[3] : null; };
  return { ref, layers, job };
}

// The approvals revision (bio K1177, `next.md` P1; P15, P17): a ruling records Bob's approval of a refused act
// when it says `approved` and cites §16 or names the permission check (`permission`, `auto-mode` or `safety check`).
// It must state `standing list: added <rule>` (the settings.json rule in backticks) or `standing list: not added (<why>)`. The rulings up to and including
// K1181 predate the rule and are exempt.
export const APPROVALS_LAST_EXEMPT = 1181;
// Ruling ids given twice before this check existed, kept as written because later rulings cite them (bio K5349: the
// action-plans merge and T51b R1's close, 2026-10-27; lane HANDOFF R17).
export const RULING_DUPS_EXEMPT = ['K5349'];
const RULING = /^- K(\d+) · /;
const STANDING = /standing list: (?:added\s+`[^`]+`|not added\s*\(\s*[^\s)])/i;
export function isApprovalRuling(line) {
  return /\bapproved\b/i.test(line) && (/§16(?!\d)/.test(line) || /\b(?:permission|auto-mode|safety) check\b/i.test(line));
}
function approvalRulings(S, add, lastExempt) {
  const text = S.read('build/rulings.md');
  if (text === null) return;
  text.split('\n').forEach((line, i) => {
    const m = line.match(RULING);
    if (!m || Number(m[1]) <= lastExempt || !isApprovalRuling(line) || STANDING.test(line)) return;
    add('approval-standing', { file: 'build/rulings.md', line: i + 1, ruling: `K${m[1]}` }, `build/rulings.md:${i + 1}: K${m[1]} records Bob's approval of a refused act but states no standing-list decision ("standing list: added \`<rule>\`" or "standing list: not added (<why>)", §16)`);
  });
}

// N656 (bio K1763 (5), K1762 (2); P15, P17; a proposed revision until certified, rulebook GOV 5): every statement of a limit on
// Anthropic's accounts, plans or terms cites the register (`AT-n`, `U-n`) or a ruling of Bob's (a K id with "Bob's").
// The register's path is read from `build/manifest.md` (a row naming Anthropic and a backticked `build/….md`), else
// `build/terms/anthropic.md`; a product with no register skips the arm. Scope: `build/requirements/*.md`, the plan's
// `current.md`, `next.md` and `draft-*.md`, `build/manifest.md`, rulings from TERMS_FIRST_RULING on, and
// `docs/architecture/*.md`. A sentence is read with its code spans removed; fenced code blocks are skipped.
export const TERMS_FIRST_RULING = 1764;

// P19, rulebook PLN 2 (bio K3923): "An entry added to `next.md` while a tranche runs names one of P19's three reasons
// (Bob's pending decision, a deployment or measurement outside the tranche, something outside the product not yet
// existing); any other reason fails." Each entry line of `build/plan/next.md` (one line each) carries `hard reason: `
// and the text after it begins with one of NEXT_REASONS. No other plan file is judged.
export const NEXT_REASONS = /^(?:Bob's|a deployment|a measurement|outside the product)/i;
const ENTRY = /^- ((?:N|T\d+[a-z]?-)\d+|[A-Z]+-\d+) · /;
function nextReasons(S, add) {
  const text = S.read('build/plan/next.md');
  if (text === null) return;
  text.split('\n').forEach((line, i) => {
    const m = line.match(ENTRY);
    if (!m) return;
    const at = line.indexOf('hard reason: ');
    const reason = at < 0 ? null : line.slice(at + 'hard reason: '.length).replace(/^[*_\s]+/, '');
    if (reason !== null && NEXT_REASONS.test(reason)) return;
    add('next-reason', { file: 'build/plan/next.md', line: i + 1, entry: m[1] }, `build/plan/next.md:${i + 1}: ${m[1]} names no P19 hard reason (Bob's, a deployment, a measurement, outside the product)${reason ? ` : "${reason.slice(0, 60)}"` : ''}`);
  });
}
// P19, rulebook PLN 1 (bio K5015): a line that defers work, outside `next.md`, cites `next.md`.
export const DEFERRAL = /\b(?:next fix round|next round|a later round|later tranche|deferred to)\b/i;
export function deferralFiles(root) {
  const S = snapshot(root);
  const files = ['build/plan/current.md', 'build/handoff.md'];
  for (const m of (S.read('build/plan/current.md') || '').matchAll(/build\/plan\/(fix-round-[A-Za-z0-9._-]*?\.md)/g)) {
    const f = `build/plan/${m[1]}`;
    if (!files.includes(f) && S.has(f)) files.push(f);
  }
  return files.filter((f) => S.read(f) !== null);
}
function deferrals(S, add) {
  for (const f of deferralFiles(S)) {
    S.read(f).split('\n').forEach((line, i) => {
      const m = line.match(DEFERRAL);
      if (m && !/next\.md/.test(line)) add('deferral', { file: f, line: i + 1 }, `${f}:${i + 1}: defers work ("${m[0]}") without citing next.md; work that waits is an entry of next.md only, with its P19 reason (P19)`);
    });
  }
}
// A limit: a word or phrase that restricts; an Anthropic subject must also stand near it (statesLimit).
export const TERMS_LIMIT = new RegExp([
  String.raw`\b(?:may not|must not|cannot|can't|can ?not|forbids?|forbidden|forbidding|bars?|barred|not permitted|not allowed|prohibit(?:s|ed)?|member-only|no group-wide)\b`,
  // `never` of the product's own handling of a secret (never stored, shown, a binding) is not a limit on the terms.
  String.raw`\bnever\b(?!\s+(?:stored|shown|logged|echoed|exported|kept|written|a binding|into|fails?|as a password)\b)`,
  // `only` that opens a condition of the product's own (only by, through, with, when, where, until, from, if) is not.
  String.raw`\bonly\b(?!\s+(?:by|through|with|when|where|until|from|if)\b)`,
  String.raw`\bown\s+(?:[\w'’-]+\s+){0,2}only\b`,
].join('|'), 'i');
// An Anthropic subject. Free, Pro and Max count only as plan names: capitalised and beside another plan name,
// "plan", "subscription", "user" or "tier".
export const TERMS_SUBJECT = new RegExp([
  String.raw`\bsubscriptions?\b`, // The group's own API key is the product's credential (Bob's K1755; permitted, AT-9): how the product handles it is
  // product text. An "API-key path" is the product's route, not the terms'.
  String.raw`(?<!group(?:'s|’s) (?:Anthropic |one |own )?)\bAPI[- ]keys?\b(?![- ]path)`, String.raw`\bClaude(?:\.ai)? accounts?\b`,
  String.raw`\b(?:Consumer|Commercial) Terms\b`, String.raw`\bTeam plans?\b`, String.raw`\bEnterprise\b`,
  String.raw`\bsetup-token\b`, String.raw`\bOAuth\b(?!\s+(?:client|app)s?\b)`, String.raw`\bAnthropic(?:'s|’s)? (?:terms|plans?|accounts?|policies|policy|rules?)\b`,
  String.raw`\b(?:Free|Pro|Max)\b(?=\s*(?:,|/|\bor\b|\band\b|plans?\b|subscriptions?\b|users?\b|tiers?\b))`,
  String.raw`(?:,\s*|/|\bor |\band )(?:Free|Pro|Max)\b`,
].join('|'));
const TERMS_ID = /\b(?:AT|U)-\d+\b/g;
// A sentence states a limit when a limit word and a subject stand within TERMS_NEAR characters of each other: a long
// sentence about the product's own behaviour that only mentions an account in passing is not a claim about the terms.
export const TERMS_NEAR = 40;
const all = (re, s) => [...s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))];
// Returns the limit word's index, or -1.
export function statesLimit(s) {
  const subjects = all(TERMS_SUBJECT, s);
  if (!subjects.length) return -1;
  const hit = all(TERMS_LIMIT, s).find((l) => subjects.some((m) => {
    const gap = l.index < m.index ? m.index - (l.index + l[0].length) : l.index - (m.index + m[0].length);
    return gap <= TERMS_NEAR;
  }));
  return hit ? hit.index : -1;
}

export function registerPath(root) {
  const manifest = snapshot(root).read('build/manifest.md');
  if (manifest !== null) {
    for (const line of manifest.split('\n')) {
      if (!/Anthropic/.test(line)) continue;
      const m = line.match(/`(build\/[^`\s]+\.md)`/);
      if (m) return m[1];
    }
  }
  return 'build/terms/anthropic.md';
}

// The ids a register defines: an `AT-n` or `U-n` that opens a heading or is written in bold.
export function registerIds(text) {
  const ids = new Set();
  for (const line of text.split('\n')) {
    const h = line.match(/^#+\s+((?:AT|U)-\d+)\b/);
    if (h) ids.add(h[1]);
    for (const m of line.matchAll(/\*\*((?:AT|U)-\d+)\b/g)) ids.add(m[1]);
  }
  return ids;
}

function termsScope(S, register) {
  const files = ['build/manifest.md', 'build/plan/current.md', 'build/plan/next.md'];
  const md = (dir, keep = () => true) => S.list(dir).filter((f) => !f.slice(dir.length + 1).includes('/') && f.endsWith('.md') && keep(f.slice(dir.length + 1))).sort();
  files.push(...md('build/requirements'), ...md('build/plan', (n) => n.startsWith('draft-')), ...md('docs/architecture'));
  return files.filter((f) => f !== register && S.read(f) !== null);
}

// A line's sentences: split after . ! ? or ; before a new clause, and at the ` · ` field separator.
function sentences(line) {
  return line.split(/(?<=[.!?;][*"”)]*)\s+(?=[A-Z*"“(\[`_])|\s+·\s+/).filter((s) => s.trim());
}

export function termsClaims(root) {
  const S = snapshot(root);
  const register = registerPath(S);
  const { findings, add } = finder('format');
  if (S.read(register) === null) return { findings, failures: [], skipped: true };
  const ids = registerIds(S.read(register));
  const files = [...termsScope(S, register), ...(S.read('build/rulings.md') !== null && register !== 'build/rulings.md' ? ['build/rulings.md'] : [])];
  let lines = 0;
  for (const f of files) {
    let fence = false;
    S.read(f).split('\n').forEach((raw, i) => {
      if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; return; }
      if (fence) return;
      if (f === 'build/manifest.md' && raw.includes(`\`${register}\``)) return; // the row that names the register describes it
      if (f === 'build/rulings.md') { const k = raw.match(RULING); if (!k || Number(k[1]) < TERMS_FIRST_RULING) return; }
      lines++;
      const line = raw.replace(/`[^`]*`/g, ' ');
      for (const s of sentences(line)) {
        const named = s.match(TERMS_ID) || [];
        const unknown = named.filter((id) => !ids.has(id));
        const at = statesLimit(s);
        const from = s.length <= 120 || at < 60 ? 0 : Math.min(at - 60, s.length - 120);
        const excerpt = `${from ? '…' : ''}${s.slice(from).replace(/\s+/g, ' ').trim().replace(/^[-*#>\s|]+/, '').slice(0, 120)}`;
        if (unknown.length) { add('terms-unknown-id', { file: f, line: i + 1, ids: [...new Set(unknown)] }, `${f}:${i + 1}: uncited limit on Anthropic's terms ("${excerpt}"): ${[...new Set(unknown)].join(', ')} not in ${register}`); continue; }
        if (at < 0) continue;
        if (named.length) continue;
        if (/\bK\d+\b/.test(s) && /\bBob(?:'s|’s)?\b/.test(s)) continue;
        add('terms-uncited', { file: f, line: i + 1 }, `${f}:${i + 1}: uncited limit on Anthropic's terms ("${excerpt}")`);
      }
    });
  }
  return { findings, failures: findings.map((x) => x.finding), skipped: false, register, lines };
}

// Each ruling id once (P15: a ruling is cited by its id). `proc ruling` and `proc merge` number from the file as it
// stands; an id written by hand could repeat one (lane R17), and this finds it.
function rulingIds(S, add, exempt = RULING_DUPS_EXEMPT) {
  const text = S.read('build/rulings.md');
  if (text === null) return;
  const first = new Map();
  text.split('\n').forEach((l, i) => {
    const k = l.match(RULING)?.[1]; if (!k) return;
    if (first.has(k) && !exempt.includes(`K${k}`)) add('ruling-twice', { file: 'build/rulings.md', line: i + 1, ruling: `K${k}` }, `build/rulings.md:${i + 1}: K${k} given twice (first at line ${first.get(k)}); number rulings by \`proc ruling\``);
    if (!first.has(k)) first.set(k, i + 1);
  });
}

// P20: a lane's dated report carries its evidence.
export const EVIDENCE_FROM = '2026-10-29'; // the day after P20's adoption (bio K5763): earlier entries predate it
const REPORT_START = /^\*\*(?:P-|H|R|L|U|B)\d+/;
export function handoffFiles(root) {
  const S = snapshot(root);
  const lanes = [...new Set(S.list('build/plan/beta').map((f) => f.split('/')[3]).filter((d, _, a) => S.files.some((f) => f.startsWith(`build/plan/beta/${d}/`))))].map((d) => `build/plan/beta/${d}/HANDOFF.md`).sort();
  return [...lanes, 'docs/development/investigation-design/HANDOFF.md'].filter((f) => S.read(f) !== null);
}
function laneEvidence(S, add, from = EVIDENCE_FROM) {
  for (const f of handoffFiles(S)) {
    const lines = S.read(f).split('\n');
    lines.forEach((line, i) => {
      if (!REPORT_START.test(line) || !(line.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).some((d) => d >= from)) return;
      let end = i + 1;
      while (end < lines.length && !REPORT_START.test(lines[end]) && !/^#/.test(lines[end])) end++;
      if (!lines.slice(i, end).some((l) => l.includes('Evidence:'))) add('lane-evidence', { file: f, line: i + 1 }, `${f}:${i + 1}: the report "${line.slice(0, 40)}" dated ${from} or later has no "Evidence:" in its entry (a command run with its result, a file:line, or a test run with its totals; P20)`);
    });
  }
}

// N656 (K1763) is opt-in until certified by its dry run (P3; dryrun/CERTIFICATION.md TC1): PROC_TERMS_CHECK=1.
export function checkFormat(root, { approvalsLastExempt = APPROVALS_LAST_EXEMPT, terms: withTerms = process.env.PROC_TERMS_CHECK === '1' } = {}) {
  const S = snapshot(root);
  const { findings, add } = finder('format');
  const pending = [];
  let terms = { findings: [], skipped: true };
  const done = (summary) => ({ findings, failures: findings.map((f) => f.finding), pending, register: terms.skipped ? null : terms.register, summary });
  conflictMarkers(S, add); rulingIds(S, add); approvalRulings(S, add, approvalsLastExempt); nextReasons(S, add); deferrals(S, add); laneEvidence(S, add);
  if (withTerms) terms = termsClaims(S);
  findings.push(...terms.findings);
  let state;
  try { state = JSON.parse(S.read('build/modules.json')); }
  catch (e) { add('modules-unreadable', { file: 'build/modules.json' }, `build/modules.json: does not parse (${e.message})`); return done('stopped'); }
  const mods = Array.isArray(state.modules) ? state.modules : [];
  if (!mods.length) add('no-modules', { file: 'build/modules.json' }, 'build/modules.json: no modules');
  const seen = new Map();
  const claimed = new Map();
  let record;   // the epoch's state branch, read once and only when a map entry names no committed file (N2-45)
  mods.forEach((m, i) => {
    const at = `build/modules.json: ${m && m.id ? m.id : `module ${i}`}`;
    const where = { module: m && typeof m.id === 'string' ? m.id : null, file: 'build/modules.json' };
    if (!m || typeof m.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(m.id)) { add('id-invalid', where, `${at}: id missing or invalid`); return; }
    if (seen.has(m.id)) add('id-twice', where, `${at}: id given twice`);
    if (!Number.isInteger(m.layer) || m.layer < 1) add('layer-invalid', where, `${at}: layer is not a positive integer`);
    for (const k of ['paths', 'tests', 'uses']) if (!Array.isArray(m[k])) add('not-a-list', { ...where, field: k }, `${at}: ${k} is not a list`);
    for (const p of [...(m.paths || []), ...(m.tests || [])]) {
      if (claimed.has(p) && claimed.get(p) !== m.id) add('path-twice', { ...where, path: p, other: claimed.get(p) }, `${at}: path ${p} is also claimed by ${claimed.get(p)}`);
      claimed.set(p, m.id);
    }
    for (const k of ['paths', 'tests']) for (const p of Array.isArray(m[k]) ? m[k] : []) {
      if (S.has(p)) continue;
      if (record === undefined) record = stateRecord(S);
      const job = record ? record.job(m.id) : null;
      if (job && LIVE_JOB.test(job) && record.layers[m.layer] !== 'CLOSED') { pending.push({ check: 'format', key: 'path-pending', ...where, field: k, path: p, job, finding: `${at}: ${k} entry ${p} names no file yet; pending while ${m.id}'s job reads ${job.split(':')[0]}` }); continue; }
      add('path-missing', { ...where, field: k, path: p }, `${at}: ${k} entry ${p} names no file or directory in the product`);
    }
    seen.set(m.id, m);
  });
  for (const p of state.not_product || []) if (claimed.has(p)) add('not-product-owned', { module: claimed.get(p), file: 'build/modules.json', path: p }, `build/modules.json: ${p} is both not_product and owned by ${claimed.get(p)}`);

  // layers.md: each layer row lists exactly that layer's modules, in order.
  const layersText = S.read('build/layers.md');
  if (layersText !== null) {
    const lines = layersText.split('\n');
    const layers = new Set(mods.map((m) => m.layer));
    lines.forEach((row, i) => {
      if (!/^\|\s*\d+\s*\|/.test(row)) return;
      const cells = row.split('|').slice(1, -1).map((c) => c.trim());
      const n = Number(cells[0]);
      if (!layers.has(n)) return; // a table of another kind (the legacy modules' line counts has no layer number first)
      const listed = cells[cells.length - 1].split(',').map((x) => x.trim()).filter(Boolean);
      const actual = mods.filter((m) => m.layer === n).map((m) => m.id);
      if (listed.join(',') !== actual.join(',')) add('layer-row', { file: 'build/layers.md', line: i + 1, layer: n }, `build/layers.md: layer ${n} lists ${listed.join(', ')}, but modules.json has ${actual.join(', ')}`);
      layers.delete(n);
    });
    for (const n of layers) add('layer-no-row', { file: 'build/layers.md', layer: n }, `build/layers.md: layer ${n} has no row`);
  } else add('layers-missing', { file: 'build/layers.md' }, 'build/layers.md: missing');

  // Requirements files: one per module, each parsing by requirements.parse with no finding (its sections in order, every
  // statement under an id, each id once), and no Test line that requirements.isMeasurement names (R6; REQ-3).
  const manifest = S.read('build/manifest.md') || '';
  let reqFiles = 0;
  for (const id of requirementFiles(S)) {
    reqFiles++;
    const at = `build/requirements/${id}.md`;
    const where = { module: id, file: at };
    if (!seen.has(id)) add('req-no-module', where, `${at}: names no module of build/modules.json`);
    const text = S.read(at) || '';
    const lines = text.split('\n');
    for (const p of parse(text).findings) {
      const sec = p.match(/^section "([^"]+)"/), dup = p.match(/^ids given twice: (.*)$/);
      if (sec) add('req-section', { ...where, section: sec[1] }, `${at}: section "${sec[1]}" missing or out of order`);
      else if (dup) { const ids = dup[1].split(' '); add('req-ids-twice', { ...where, line: lines.findIndex((l) => l.includes(`**${ids[0]}**`)) + 1 || null, ids }, `${at}: ids given twice: ${ids.join(' ')}`); }
      else add('req-statement', where, `${at}: ${p}`);
    }
    lines.forEach((l, i) => {
      const t = l.match(/\bTest:\s*(.*)$/);
      if (t && isMeasurement(t[1], manifest)) add('test-measurement', { ...where, line: i + 1 }, `${at}:${i + 1}: a Test line names a measurement (a fixture above the product's size, or a figure on a deployed copy): it belongs in the plan under its own id`);
    });
  }

  // The plan: an entry id once per module. An entry shared by two modules (a provided service and its
  // user) is listed under each; a module heading is a line that is only a bold module id, or several.
  for (const plan of ['build/plan/current.md', 'build/plan/next.md']) {
    const text = S.read(plan);
    if (text === null) continue;
    let under = '';
    const keys = [];
    for (const line of text.split('\n')) {
      if (/^\*\*[a-z][a-z0-9-]*\*\*(,\s*\*\*[a-z][a-z0-9-]*\*\*)*(\s*\(.*\))?\s*$/.test(line) || /^#/.test(line)) { under = line; continue; }
      const m = line.match(/^- ((?:N|T\d+[a-z]?-)\d+|[A-Z]+-\d+) · /);
      if (m) keys.push(`${m[1]}\u0000${under}`);
    }
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i).map((k) => k.split('\u0000')[0]);
    if (dup.length) add('entry-twice', { file: plan, entries: [...new Set(dup)] }, `${plan}: entry ids given twice under one module: ${[...new Set(dup)].join(' ')}`);
  }
  return done(`${mods.length} modules, ${reqFiles} requirements files${pending.length ? `, ${pending.length} map entr${pending.length === 1 ? 'y' : 'ies'} pending a live job` : ''}${terms.skipped ? '' : `, terms register ${terms.register}`}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { failures, summary } = checkFormat(process.argv[2] || '.');
  process.exitCode = report('format', failures, summary);
}
