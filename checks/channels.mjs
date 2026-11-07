// The channels check (mechanics: the cross-account channel; P15; bio K954): over each mail branch's history, an entry once
// pushed is never rewritten or removed, entry numbers rise by one, and a cursor never moves backwards.
// It reads the registry `build/channels.md` in the product's working tree; with none, there is nothing to check.
// For each row it fetches the mail branch from origin (when there is one), and fails if the branch's new tip does not
// descend from the tip last read in this clone (tools/mail.mjs's seenRef, which the x-commands share: a forced
// rewrite), then walks every commit that touched the outbox, oldest first, comparing it with its text in the commit before.
// R10 (build/requirements/architecture.md): the check reads commits only, the registry and outboxes at the refs the clone
// holds, so the same commits give the same findings. Fetching the mail branches and the forced-rewrite comparison (a fetched
// tip against the tip this clone read before) depend on the network and on what the clone saw, so they are a separate
// step, `refreshChannels`, which the runner (checks/run.mjs) and this file's command take before the check. Git is reached
// through record's repo (N2-12).
// Usage: node checks/channels.mjs <product-root>
import { pathToFileURL } from 'node:url';
import { parseRegistry, parseOutbox, REGISTRY, lastSeen, rewriteFault, markSeen } from '../tools/mail.mjs';
import { snapshot, finder, report } from './lib.mjs';

const rev = (S, ref) => S.q(['rev-parse', '-q', '--verify', `${ref}^{commit}`])?.trim() || null;
const registryOf = (S) => { const t = S.read(REGISTRY); return t === null ? null : parseRegistry(t); };

// The first break in an outbox's numbering, or null: each entry carries the writer's letter and numbers rise by one.
function sequenceFault(entries, letter) {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.letter !== letter) return { key: 'letter', entry: e.id, text: `entry ${e.id} does not carry the writer's letter ${letter}` };
    if (e.n !== i + 1) return { key: 'numbering', entry: e.id, text: `entry numbers do not rise by one: ${i ? entries[i - 1].id : 'the start'} then ${e.id}` };
  }
  return null;
}

// What one commit did to the outbox that the channel forbids: { key, entry, text } each.
export function compareOutbox(before, after, letter) {
  const out = [];
  const P = parseOutbox(before), N = parseOutbox(after);
  if (after === null && P.entries.length) return [{ key: 'outbox-removed', entry: null, text: `removes the outbox and its entries ${P.entries.map((e) => e.id).join(', ')}` }];
  const now = new Map();
  for (const e of N.entries) if (!now.has(e.id)) now.set(e.id, e);
  for (const e of P.entries) {
    const f = now.get(e.id);
    if (!f) out.push({ key: 'entry-removed', entry: e.id, text: `removes entry ${e.id}` });
    else if (f.text !== e.text) out.push({ key: 'entry-changed', entry: e.id, text: `changes entry ${e.id}` });
  }
  const was = sequenceFault(P.entries, letter), is = sequenceFault(N.entries, letter);
  if (is && is.text !== was?.text) out.push(is);
  for (const [name, c] of Object.entries(P.cursors)) {
    const d = N.cursors[name];
    if (!d) out.push({ key: 'cursor-removed', entry: `${c.letter}${c.n}`, over: name, text: `removes the cursor over ${name} (was ${c.letter}${c.n})` });
    else if (d.n < c.n) out.push({ key: 'cursor-back', entry: `${d.letter}${d.n}`, over: name, text: `moves the cursor over ${name} back from ${c.letter}${c.n} to ${d.letter}${d.n}` });
  }
  return out;
}

// The network half: fetch each mail branch and judge its new tip against the tip this clone read before (a forced
// rewrite is invisible in the new history). Findings keyed `rewritten`.
export function refreshChannels(root, { fetch = true } = {}) {
  const S = snapshot(root);
  const { findings, add } = finder('channels');
  let rows; try { rows = registryOf(S); } catch { rows = null; }
  if (!rows) return { findings, failures: [] };
  const hasOrigin = (S.q(['remote']) || '').split('\n').includes('origin');
  for (const p of rows) {
    const remote = `refs/remotes/origin/${p.branch}`;
    const before = lastSeen(S.R.dir, p.branch);
    if (fetch && hasOrigin) S.q(['fetch', '-q', 'origin', `+refs/heads/${p.branch}:${remote}`]);
    const tip = rev(S, remote) || rev(S, `refs/heads/${p.branch}`);
    if (!tip) continue;
    const fault = rewriteFault(S.R.dir, p.branch, before, tip);
    if (fault) add('rewritten', { file: p.outbox, participant: p.name, branch: p.branch }, `${p.name} ${fault}`); else markSeen(S.R.dir, p.branch, tip);
  }
  return { findings, failures: findings.map((f) => f.finding) };
}

export function checkChannels(root) {
  const S = snapshot(root);
  const { findings, add } = finder('channels');
  let rows;
  try { rows = registryOf(S); } catch (e) { add('registry', { file: REGISTRY }, e.message); return { findings, failures: [e.message], summary: 'registry unreadable' }; }
  if (!rows) return { findings, failures: [], counts: { participants: 0, commits: 0 }, absent: [], summary: `no ${REGISTRY}: nothing to check` };
  const absent = [];
  let commits = 0;
  for (const p of rows) {
    const tip = rev(S, `refs/remotes/origin/${p.branch}`) || rev(S, `refs/heads/${p.branch}`);
    if (!tip) { absent.push(p.name); continue; }
    const list = (S.q(['rev-list', '--reverse', '--parents', tip, '--', S.at(p.outbox)]) || '').trim().split('\n').filter(Boolean);
    for (const line of list) {
      const [c, ...parents] = line.split(' ');
      commits++;
      const after = S.q(['show', `${c}:${S.at(p.outbox)}`]);
      for (const par of parents.length ? parents : [null]) {
        const before = par ? S.q(['show', `${par}:${S.at(p.outbox)}`]) : null;
        for (const f of compareOutbox(before, after, p.letter)) add(f.key, { file: p.outbox, participant: p.name, branch: p.branch, commit: c.slice(0, 7), entry: f.entry ?? null, over: f.over ?? null }, `${p.name} ${p.branch} ${c.slice(0, 7)}: ${f.text}`);
      }
    }
  }
  const summary = `${rows.length} participant${rows.length === 1 ? '' : 's'}, ${commits} outbox commit${commits === 1 ? '' : 's'} read${absent.length ? `; no mail branch yet: ${absent.join(', ')}` : ''}`;
  return { findings, failures: findings.map((f) => f.finding), counts: { participants: rows.length, commits }, absent, summary };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = process.argv[2] || '.';
  const fresh = refreshChannels(root);
  const { failures, summary } = checkChannels(root);
  process.exitCode = report('channels', [...fresh.failures, ...failures], summary);
}
