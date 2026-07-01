// no-mistakes: splice ONE combined full-stack verdict header into BOTH PRs
// (the frontend repo's PR and the backend repo's PR), idempotently. Each sub-skill's
// per-repo DETAIL (screenshots / request-response-SQL) is posted separately by the
// sibling skills' own posters; this only writes the shared top-of-PR summary so a
// reviewer on either PR sees the whole-stack status.
//
// Usage:
//   node post-fullstack.mjs --results <results.json>
//
// results.json:
// {
//   "overall": "PASS|FAIL|BLOCKED",
//   "preview": { "namespace": "...", "apiHost": "...", "dbBranch": "<preview branch>", "feUrl": "<preview frontend URL>" },
//   "frontend": { "name": "<frontend app>", "repo": "owner/name", "pr": N, "status": "PASS|FAIL|BLOCKED", "detailUrl": "..." },
//   "backend":  { "name": "<backend app>", "repo": "owner/name", "pr": M, "status": "PASS|FAIL|BLOCKED", "detailUrl": "..." },
//   "roundtrip": [ { "name": "...", "pass": true } ]
// }
//
// Posts the same header to frontend.pr and backend.pr (whichever are present). A PR with
// no number is skipped. On gh failure for a target, writes summary.md and reports
// pr_post=<repo>:failed; the verdict is never lost.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MARK_START = '<!-- no-mistakes:start -->';
const MARK_END = '<!-- no-mistakes:end -->';
const MARK_REGION = /<!-- no-mistakes:start -->[\s\S]*?<!-- no-mistakes:end -->/;

function die(m) { console.error(`[post-fullstack] ${m}`); process.exit(1); }
function arg(name) { const i = process.argv.indexOf(`--${name}`); return i !== -1 ? process.argv[i + 1] : undefined; }

const resultsPath = arg('results');
if (!resultsPath || !existsSync(resultsPath)) die('required: --results <results.json>');
let r;
try { r = JSON.parse(readFileSync(resultsPath, 'utf8')); } catch (e) { die(`bad results json: ${e.message}`); }

const badge = (s) => (s === 'PASS' ? '✅ PASS' : s === 'FAIL' ? '❌ FAIL' : s === 'BLOCKED' ? '⚠️ BLOCKED' : (s || '—'));
const mark = (s) => (s === 'PASS' ? '✅' : s === 'FAIL' ? '❌' : s === 'BLOCKED' ? '⚠️' : '—');
// Escape the backslash FIRST, then the pipe — else a literal `\|` in input leaves
// the pipe unescaped and breaks the markdown table cell.
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

const fe = r.frontend || {};
const be = r.backend || {};
const pv = r.preview || {};
const rt = Array.isArray(r.roundtrip) ? r.roundtrip : [];
const rtPass = rt.filter((c) => c.pass).length;
const overall = r.overall || ((fe.status === 'PASS' && be.status === 'PASS' && rtPass === rt.length) ? 'PASS' : 'FAIL');
const rtBadge = rt.length === 0 ? '—' : (rtPass === rt.length ? '✅' : '❌');

function detailCell(side) {
  if (side.detailUrl) return `[detail](${side.detailUrl})`;
  if (side.repo && side.pr) return `${side.repo}#${side.pr}`;
  return '—';
}

function buildHeader() {
  const lines = [];
  lines.push(MARK_START);
  lines.push(`### no-mistakes: ${badge(overall)}  (FE ${mark(fe.status)} · BE ${mark(be.status)} · round-trip ${rtBadge})`);
  lines.push(`**Preview:** \`${pv.namespace ?? '?'}\`  ·  **API:** \`${pv.apiHost ?? '?'}\`  ·  **DB:** \`${pv.dbBranch ?? '?'}\``);
  if (pv.feUrl) lines.push(`**Open the preview UI →** ${pv.feUrl}  _(preview target; point-in-time)_`);
  lines.push('');
  lines.push('| Layer | PR | Result | Detail |');
  lines.push('| --- | --- | :---: | --- |');
  lines.push(`| Frontend (${esc(fe.name) || 'FE'}) | ${fe.pr ? '#' + fe.pr : '—'} | ${mark(fe.status)} | ${detailCell(fe)} |`);
  lines.push(`| Backend (${esc(be.name) || 'Backend'}) | ${be.pr ? '#' + be.pr : '—'} | ${mark(be.status)} | ${detailCell(be)} |`);
  if (rt.length) lines.push(`| Round-trip (UI→API→DB) | | ${rtBadge} | ${rtPass}/${rt.length} cases |`);
  lines.push('');
  if (rt.length) {
    for (const c of rt) lines.push(`- ${c.pass ? '✅' : '❌'} ${esc(c.name)}`);
    lines.push('');
  }
  lines.push(MARK_END);
  return lines.join('\n');
}

function spliceBody(body, block) {
  const b = body || '';
  if (MARK_REGION.test(b)) return b.replace(MARK_REGION, block);
  return b ? `${block}\n\n${b}` : block;
}

function gh(args) { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

const header = buildHeader();
const targets = [fe, be].filter((s) => s.repo && s.pr);
if (targets.length === 0) {
  const f = join(dirname(resultsPath), 'summary.md');
  writeFileSync(f, header);
  console.log('pr_post=no-pr');
  console.log(`summary_file=${f}`);
  process.exit(0);
}

let anyFail = false;
const seen = new Set();
for (const t of targets) {
  const key = `${t.repo}#${t.pr}`;
  if (seen.has(key)) continue;            // FE and BE could theoretically be the same PR
  seen.add(key);
  try {
    const cur = gh(['pr', 'view', String(t.pr), '--repo', t.repo, '--json', 'body', '-q', '.body']);
    const f = join(dirname(resultsPath), `pr-body-${t.pr}.md`);
    writeFileSync(f, spliceBody(cur, header));
    gh(['pr', 'edit', String(t.pr), '--repo', t.repo, '--body-file', f]);
    console.log(`pr_post=${key}:spliced`);
  } catch (e) {
    anyFail = true;
    console.error(`[post-fullstack] ${key} failed: ${e.message.split('\n')[0]}`);
    console.log(`pr_post=${key}:failed`);
  }
}
const sf = join(dirname(resultsPath), 'summary.md');
writeFileSync(sf, header);
console.log(`summary_file=${sf}`);
process.exit(anyFail ? 1 : 0);
