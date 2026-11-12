// no-mistakes-backend harness: publish API-verification results to a GitHub PR on TWO
// idempotent surfaces (uniform with no-mistakes-frontend, so a fullstack router gets one shape):
//
//   1. A COMPACT BODY BLOCK (markers <!-- no-mistakes-backend:start -->…:end -->)
//      spliced at the TOP of the PR description: status header + endpoint-case table.
//      NO bulky content => the body stays commit-clean (squash-merge messages pre-fill
//      from the body). The author's existing body is preserved.
//   2. An EVIDENCE COMMENT (marker <!-- no-mistakes-backend:evidence --> on line 1):
//      per-case captured request + response + SQL read-after-write, in collapsible
//      <details>. Updated in place on re-run (PATCH), else created — never duplicated.
//
// Unlike no-mistakes-frontend there is no media — backend evidence is
// all text, so it goes straight into the comment. The request/response/dbCheck strings
// are expected to be ALREADY REDACTED by the harness (no Authorization, no secrets).
//
// Usage:
//   node post-results.mjs --pr <N> --run <id> --repo owner/name [--config <.no-mistakes.json>]
//   node post-results.mjs --pr <N> --run-dir <dir> --results <results.json> [--repo owner/name] [--config <.no-mistakes.json>]
//   --print-command (with --pr, --run, --repo) checks the run and prints the plain command to post it,
//   naming the config the run selected ($NM_CONFIG_PATH, else discovery from here or --project).
//
// results.json: {
//   revision, dbTarget, intentSource, status?,
//   cases: [{ name, pass, request, response, dbCheck }]
// }
//
// On no-PR / gh failure: writes <run-dir>/summary.md, prints pr_post=no-pr | pr_post=failed,
// exits non-zero — the verdict is never lost.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig, expandHome } from './load-config.mjs';

const MARKER_START = '<!-- no-mistakes-backend:start -->';
const MARKER_END = '<!-- no-mistakes-backend:end -->';
const MARKER_REGION = /<!-- no-mistakes-backend:start -->[\s\S]*?<!-- no-mistakes-backend:end -->/;
const MARKER_EVIDENCE = '<!-- no-mistakes-backend:evidence -->';

function die(msg) { console.error(`[post-results] ${msg}`); process.exit(1); }

// --run <id> names a run dir under this poster's root, so the post command holds no path but its own.
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function runDirFor(id, root) {
  if (!RUN_ID.test(id)) die(`--run takes a run id such as 20261112-010700-4242, not: ${id}`);
  return join(homedir(), root, id);
}
// Allow rules match the command as text, so each word is bare unless the shell would read it otherwise.
const shellWord = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
function printCommand(words) {
  console.log(['node', process.argv[1], ...words].map(shellWord).join(' '));
  console.error(`allow rule: Bash(node ${shellWord(process.argv[1])}:*)`);
  process.exit(0);
}
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const pr = arg('pr');
const run = arg('run');
const runDir = arg('run-dir') ?? (run && runDirFor(run, '.no-mistakes-backend'));
const resultsPath = arg('results') ?? (runDir && join(runDir, 'results.json'));
let repo = arg('repo');

if (!runDir || !resultsPath) die('required: --run <id>, or --run-dir <dir> --results <results.json>');
if (!existsSync(runDir)) die(`run-dir not found: ${runDir}`);
if (!existsSync(resultsPath)) die(`results not found: ${resultsPath}`);
if (process.argv.includes('--print-command')) {
  if (!/^\d+$/.test(pr ?? '') || !run || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) die('--print-command needs --pr <N> --run <id> --repo owner/name');
  const selected = arg('config') || process.env.NM_CONFIG_PATH || loadConfig({ project: arg('project') }).path;
  if (selected && !loadConfig({ configPath: selected }).cfg) die(`config ${selected} does not load`);
  if (!selected) console.error('[post-results] no .no-mistakes.json found; the post will run without its API-key header');
  printCommand(['--pr', pr, '--run', run, '--repo', repo, ...(selected ? ['--config', selected] : [])]);
}

let results;
try { results = JSON.parse(readFileSync(resultsPath, 'utf8')); }
catch (e) { die(`could not parse results json: ${e.message}`); }

// A plain-command post runs without load-config's exports, so read the config itself: the file the
// run selected (--config, or the exported path), which must load, else whatever discovery finds here.
const configPath = arg('config') || process.env.NM_CONFIG_PATH;
let cfg = null;
if (configPath) {
  const loaded = loadConfig({ configPath });
  if (!loaded.cfg) die(`config ${configPath}: ${loaded.errors.join('; ')}`);
  cfg = loaded.cfg;
} else {
  try { ({ cfg } = loadConfig()); } catch {}
  if (!cfg) console.error('[post-results] no .no-mistakes.json found; posting without its API-key header or checkout base');
}
const checkoutBase = process.env.NM_CHECKOUT_BASE || expandHome(cfg?.checkoutBase);

const repoBase = repo ? repo.split('/')[1] : null;
const repoCwd = process.env.NOMISTAKESBACKEND_REPO_DIR
  || (repoBase && checkoutBase ? join(checkoutBase, repoBase) : null)
  || (repoBase && process.env.HOME ? join(process.env.HOME, repoBase) : process.cwd());
const gitCwd = existsSync(join(repoCwd, '.git')) ? repoCwd : process.cwd();

function gitQuiet(args) {
  try { return execFileSync('git', args, { cwd: gitCwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return ''; }
}
if (!repo) {
  const m = gitQuiet(['remote', 'get-url', 'origin']).match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (m) repo = m[1];
}
if (!repo) die('could not determine --repo (owner/name) from origin remote');

// --- Build the two surfaces. ------------------------------------------------
function overallStatus() {
  if (results.status) return String(results.status).toUpperCase();
  const cases = Array.isArray(results.cases) ? results.cases : [];
  return cases.some((c) => c.pass === false) ? 'FAIL' : 'PASS';
}

const cases = Array.isArray(results.cases) ? results.cases : [];
// Escape the backslash FIRST, then the pipe — else a literal `\|` in input leaves
// the pipe unescaped and breaks the markdown table cell.
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

// Defense-in-depth: captures SHOULD already be redacted by http-client.mjs, but never
// post a secret. Final safety net over every evidence string before it leaves the host.
// One sensitive-name set drives BOTH header-line and JSON-key redaction so they can't
// drift; the project's custom API-key header ($NM_API_KEY_HEADER) is folded in dynamically.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const apiKeyHeader = (process.env.NM_API_KEY_HEADER || cfg?.auth?.apiKeyHeader || '').toLowerCase().trim();
const NAMES = [
  'authorization', 'cookie', 'set-cookie', 'x-api-key',
  ...(apiKeyHeader ? [escapeRe(apiKeyHeader)] : []),
  'access[_-]?token', 'refresh[_-]?token', 'id[_-]?token', 'token',
  'api[_-]?key', 'client[_-]?secret', 'secret', 'password', 'private[_-]?key',
].join('|');
function redact(text) {
  if (!text) return text;
  return String(text)
    .replace(new RegExp(`^(${NAMES})\\s*:.*$`, 'gim'), '$1: «redacted»')
    .replace(new RegExp(`("(?:${NAMES})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi'), '$1"«redacted»"')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]{12,}/g, 'Bearer «redacted»')
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgres://«redacted»');
}

function dbCell(c) {
  if (!c.dbCheck) return '—';
  return c.pass ? '✓' : '✗';
}

// COMPACT BODY BLOCK: status + endpoint-case table only.
function buildBodyBlock(evidenceUrl) {
  const status = overallStatus();
  const badge = status === 'PASS' ? '✅ PASS' : status === 'FAIL' ? '❌ FAIL' : status;
  const lines = [];
  lines.push(MARKER_START);
  lines.push(`### no-mistakes-backend: ${badge}`);
  lines.push(`**Revision:** \`${results.revision ?? 'unknown'}\`  ·  **DB target:** \`${results.dbTarget ?? 'unknown'}\`  ·  **Intent:** ${results.intentSource ?? 'unknown'}`);
  lines.push('');
  lines.push('| Endpoint case | Result | DB check |');
  lines.push('| --- | :---: | :---: |');
  for (const c of cases) {
    lines.push(`| ${esc(c.name)} | ${c.pass ? '✅' : '❌'} | ${dbCell(c)} |`);
  }
  lines.push('');
  if (evidenceUrl) lines.push(`🧾 **Full request / response / SQL evidence →** ${evidenceUrl}`);
  lines.push(MARKER_END);
  return lines.join('\n');
}

// EVIDENCE COMMENT: per-case request + response + DB read-after-write in <details>.
function fence(label, text) {
  if (!text) return [];
  return [`**${label}**`, '```', String(text).replace(/```/g, '`​``'), '```', ''];
}
function buildEvidence() {
  const lines = [];
  lines.push(MARKER_EVIDENCE);
  lines.push('### no-mistakes-backend — evidence');
  lines.push(`**Revision:** \`${results.revision ?? 'unknown'}\`  ·  **DB target:** \`${results.dbTarget ?? 'unknown'}\``);
  lines.push('');
  for (const c of cases) {
    lines.push(`<details><summary>${c.pass ? '✅' : '❌'} ${esc(c.name)}</summary>`);
    lines.push('');
    lines.push(...fence('Request', redact(c.request)));
    lines.push(...fence('Response', redact(c.response)));
    lines.push(...fence('DB read-after-write', redact(c.dbCheck)));
    lines.push('</details>');
    lines.push('');
  }
  return lines.join('\n');
}

function spliceIntoBody(currentBody, block) {
  const body = currentBody || '';
  if (MARKER_REGION.test(body)) return body.replace(MARKER_REGION, block);
  return body ? `${block}\n\n${body}` : block;
}

const evidenceBody = buildEvidence();

// --- No-PR path: persist both surfaces locally. -----------------------------
const summaryFile = join(runDir, 'summary.md');
function persistAndExit(status, evidenceUrl = null) {
  try { writeFileSync(summaryFile, `${buildBodyBlock(evidenceUrl)}\n\n${evidenceBody}`); }
  catch (e) { console.error(`[post-results] could not write ${summaryFile}: ${e.message}`); }
  console.log(`pr_post=${status}`);
  console.log(`summary_file=${summaryFile}`);
  process.exit(status === 'ok' ? 0 : 1);
}

if (!pr) persistAndExit('no-pr');

// --- Idempotent post: evidence comment first (for its URL), then body block. -
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function postEvidence() {
  const file = join(runDir, 'nmb-evidence.md');
  writeFileSync(file, evidenceBody);
  let existingUrl = null;
  try {
    const comments = JSON.parse(gh(['pr', 'view', pr, '--repo', repo, '--json', 'comments'])).comments || [];
    const hit = comments.find((c) => (c.body || '').startsWith(MARKER_EVIDENCE));
    if (hit) existingUrl = hit.url;
  } catch (e) {
    console.error(`[post-results] could not list PR comments: ${e.message.split('\n')[0]}`);
  }
  if (existingUrl) {
    const m = existingUrl.match(/issuecomment-(\d+)/);
    if (m) {
      const patched = gh(['api', '--method', 'PATCH', `/repos/${repo}/issues/comments/${m[1]}`,
        '-F', `body=@${file}`, '-q', '.html_url']);
      return { url: patched || existingUrl, action: 'updated' };
    }
  }
  const created = gh(['pr', 'comment', pr, '--repo', repo, '--body-file', file]);
  return { url: created || null, action: 'created' };
}

function postBody(evidenceUrl) {
  const currentBody = gh(['pr', 'view', pr, '--repo', repo, '--json', 'body', '-q', '.body']);
  const bodyFile = join(runDir, 'pr-body.md');
  writeFileSync(bodyFile, spliceIntoBody(currentBody, buildBodyBlock(evidenceUrl)));
  gh(['pr', 'edit', pr, '--repo', repo, '--body-file', bodyFile]);
}

let evidenceUrl = null, evidenceOk = false, evidenceAction = 'none';
try { const e = postEvidence(); evidenceUrl = e.url; evidenceAction = e.action; evidenceOk = true; }
catch (e) { console.error(`[post-results] evidence comment failed: ${e.message.split('\n')[0]}`); }

let bodyOk = false;
try { postBody(evidenceUrl); bodyOk = true; }
catch (e) { console.error(`[post-results] gh pr edit failed: ${e.message.split('\n')[0]}`); }

if (bodyOk && evidenceOk) {
  console.log('pr_post=posted');
  console.log(`pr=${pr} repo=${repo} cases=${cases.length} evidence=${evidenceAction}`);
  process.exit(0);
}
console.error(`[post-results] surfaces: body=${bodyOk ? 'ok' : 'failed'} evidence=${evidenceOk ? evidenceAction : 'failed'}`);
persistAndExit('failed', evidenceUrl);
