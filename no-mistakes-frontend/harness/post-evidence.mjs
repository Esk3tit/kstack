// no-mistakes harness: publish UI-verification evidence to a GitHub PR on TWO surfaces.
//
//   1. One idempotent GALLERY COMMENT (marker <!-- <marker>:gallery --> on its first line) holding the
//      screenshots + clips as native GitHub attachments (`gh pr comment --attach`) and the visual findings.
//   2. A COMPACT BODY BLOCK (<!-- <marker>:start --> … <!-- <marker>:end -->) spliced at the TOP of the
//      PR description: verdict, tested revision, coverage gaps, scenario table, how-to-test checklist.
//      No media URLs, so the squash-merge message (pre-filled from the body) stays clean.
//   The author's existing body is preserved.
//
// Usage:
//   node post-evidence.mjs --pr <N> --run-dir <dir> --results <results.json> [--repo owner/name] [--marker <name>]
//
// results.json:
//   { revision, intentSource, previewUrl?, gaps?:[string], setup?:markdown,
//     cases:[{name, pass, observed?, evidence?:file|[file], before?:file|[file]}],
//     findings:[{severity,screen,viewport,issue}], howToTest?:[{action, expect}] }
//   evidence/before = media basenames (png/jpg/gif/webp/mp4/webm/mov) present in --run-dir.
//
// On no-PR / gh failure: writes the assembled markdown (local media paths) to <run-dir>/summary.md,
// prints pr_post=no-pr | pr_post=failed, exits non-zero — the verdict is never lost.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function die(msg) { console.error(`[post-evidence] ${msg}`); process.exit(1); }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const pr = arg('pr');
const runDir = arg('run-dir');
const resultsPath = arg('results');
const marker = arg('marker', 'no-mistakes-frontend');
let repo = arg('repo');

if (!runDir || !resultsPath) die('required: --run-dir <dir> --results <results.json>');
if (!existsSync(runDir)) die(`run-dir not found: ${runDir}`);
if (!existsSync(resultsPath)) die(`results not found: ${resultsPath}`);

let results;
try { results = JSON.parse(readFileSync(resultsPath, 'utf8')); }
catch (e) { die(`could not parse results json: ${e.message}`); }

const MARKER_START = `<!-- ${marker}:start -->`;
const MARKER_END = `<!-- ${marker}:end -->`;
const MARKER_GALLERY = `<!-- ${marker}:gallery -->`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARKER_REGION = new RegExp(`${escapeRe(MARKER_START)}[\\s\\S]*?${escapeRe(MARKER_END)}`);

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

if (!repo) {
  try { repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']); } catch { /* resolved below */ }
}
if (pr && !repo) die('could not determine --repo (owner/name)');

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;
const media = readdirSync(runDir).filter((f) => IMAGE.test(f) || VIDEO.test(f)).sort();
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((f) => media.includes(f));
const cases = Array.isArray(results.cases) ? results.cases : [];
const findings = Array.isArray(results.findings) ? results.findings : [];
const cell = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function overallStatus() {
  if (results.status) return String(results.status).toUpperCase();
  return cases.some((c) => c.pass === false) ? 'FAIL' : 'PASS';
}

function findingsLines() {
  if (findings.length === 0) return ['_clean_'];
  return findings.map((f) => {
    const where = [f.screen, f.viewport].filter(Boolean).join(' / ');
    return `- **${f.severity ?? 'info'}**${where ? ` (${where})` : ''}: ${f.issue ?? ''}`;
  });
}

// gh rewrites each `./<file>` reference to its uploaded attachment URL. Video must sit in its own
// paragraph (never a table cell) to render as a player.
function mediaBlock(files) {
  const out = [];
  for (const f of files) out.push(VIDEO.test(f) ? `![](./${f})` : `![${f}](./${f})`, '');
  return out;
}

function buildGallery() {
  const lines = [MARKER_GALLERY, `### ${marker} — screenshots and clips`, ''];
  const shown = new Set();
  for (const c of cases) {
    const after = list(c.evidence);
    const before = list(c.before);
    if (after.length === 0 && before.length === 0) continue;
    lines.push(`#### ${c.pass ? '✅' : '❌'} ${c.name ?? ''}`, '');
    const beforeImgs = before.filter((f) => IMAGE.test(f));
    const afterImgs = after.filter((f) => IMAGE.test(f));
    if (beforeImgs.length && afterImgs.length) {
      lines.push('| Before | After |', '| --- | --- |');
      for (let i = 0; i < Math.max(beforeImgs.length, afterImgs.length); i++) {
        const b = beforeImgs[i] ? `![${beforeImgs[i]}](./${beforeImgs[i]})` : '';
        const a = afterImgs[i] ? `![${afterImgs[i]}](./${afterImgs[i]})` : '';
        lines.push(`| ${b} | ${a} |`);
      }
      lines.push('');
      for (const [label, files] of [['Before', before], ['After', after]]) {
        const clips = files.filter((f) => VIDEO.test(f));
        if (clips.length) lines.push(`**${label}**`, '', ...mediaBlock(clips));
      }
    } else {
      if (before.length) lines.push('**Before**', '', ...mediaBlock(before));
      if (before.length && after.length) lines.push('**After**', '');
      lines.push(...mediaBlock(after));
    }
    for (const f of [...before, ...after]) shown.add(f);
  }
  const rest = media.filter((f) => !shown.has(f));
  if (rest.length) lines.push('#### Other captures', '', ...mediaBlock(rest));
  lines.push('**Visual findings:**', ...findingsLines(), '');
  return lines.join('\n');
}

function buildBodyBlock({ galleryUrl, headSha }) {
  const revision = String(results.revision ?? 'unknown');
  const status = overallStatus();
  const badge = status === 'PASS' ? '✅ PASS' : status === 'FAIL' ? '❌ FAIL' : status;
  const gaps = Array.isArray(results.gaps) ? results.gaps : [];
  const howTo = Array.isArray(results.howToTest) ? results.howToTest : [];

  const lines = [MARKER_START, `### ${marker}: ${badge}`];
  lines.push(`**Verified at:** \`${revision}\`  ·  **Intent:** ${results.intentSource ?? 'unknown'}`);
  const testedSha = (revision.match(/^[0-9a-f]{7,40}/i) || [])[0];
  if (headSha && testedSha && !headSha.startsWith(testedSha.toLowerCase())) {
    lines.push('', '> [!WARNING]', `> The PR head is now \`${headSha.slice(0, 7)}\`. This verdict is for \`${testedSha.slice(0, 7)}\`. Re-run to refresh it.`);
  }
  if (gaps.length) lines.push('', '**Not covered:**', ...gaps.map((g) => `- ${g}`));
  if (results.previewUrl) lines.push('', `**Open the preview UI →** ${results.previewUrl}  _(preview target; point-in-time)_`);

  const hasObserved = cases.some((c) => c.observed);
  lines.push('', hasObserved ? '| Scenario | Result | Observed | Evidence |' : '| Scenario | Result | Evidence |');
  lines.push(hasObserved ? '| --- | :---: | --- | --- |' : '| --- | :---: | --- |');
  for (const c of cases) {
    const n = list(c.evidence).length + list(c.before).length;
    const ev = n && galleryUrl ? `[📸 ${n} capture${n > 1 ? 's' : ''}](${galleryUrl})` : '—';
    const row = [cell(c.name), c.pass ? '✅' : '❌', ...(hasObserved ? [cell(c.observed) || '—'] : []), ev];
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('', findings.length === 0 ? '**Visual:** clean' : `**Visual:** ${findings.length} finding(s) — see gallery ↓`);

  if (howTo.length) {
    lines.push('', '**How to test**');
    for (const t of howTo) lines.push(`- [ ] ${t.action ?? ''}${t.expect ? ` → ${t.expect}` : ''}`);
  }
  if (results.setup) lines.push('', '<details><summary>Setup and commands</summary>', '', String(results.setup), '', '</details>');
  if (galleryUrl) lines.push('', `🖼 **Screenshots and clips →** ${galleryUrl}`);
  lines.push(MARKER_END);
  return lines.join('\n');
}

function spliceIntoBody(currentBody, block) {
  const body = currentBody || '';
  if (MARKER_REGION.test(body)) return body.replace(MARKER_REGION, () => block);
  return body ? `${block}\n\n${body}` : block;
}

const galleryBody = media.length ? buildGallery() : null;

const summaryFile = join(runDir, 'summary.md');
function persistAndExit(status, ctx = {}) {
  const parts = [buildBodyBlock(ctx)];
  if (galleryBody) parts.push(galleryBody);
  try { writeFileSync(summaryFile, parts.join('\n\n')); }
  catch (e) { console.error(`[post-evidence] could not write ${summaryFile}: ${e.message}`); }
  console.log(`pr_post=${status}`);
  console.log(`summary_file=${summaryFile}`);
  process.exit(1);
}

if (!pr) persistAndExit('no-pr');

function galleryComments() {
  const raw = gh(['api', '--paginate', `/repos/${repo}/issues/${pr}/comments`, '-q',
    `.[] | select(.body | startswith("${MARKER_GALLERY}")) | .id`]);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

function deleteComments(ids) {
  for (const id of ids) {
    try { gh(['api', '--method', 'DELETE', `/repos/${repo}/issues/comments/${id}`]); }
    catch (e) { console.error(`[post-evidence] could not delete old gallery ${id}: ${e.message.split('\n')[0]}`); }
  }
}

// gh exits non-zero on a partial upload but still posts the comment and prints its URL.
function postGallery() {
  const previous = galleryComments();
  if (!galleryBody) return { url: null, id: null, previous, uploadError: null };
  writeFileSync(join(runDir, 'nm-gallery.md'), galleryBody);
  const attach = media.flatMap((f) => ['--attach', `./${f}`]);
  let url = null;
  let uploadError = null;
  try {
    url = gh(['pr', 'comment', pr, '--repo', repo, '--body-file', 'nm-gallery.md', ...attach], { cwd: runDir });
  } catch (e) {
    uploadError = (e.stderr || e.message || '').toString().split('\n')[0];
    url = ((e.stdout || '').toString().match(/https:\/\/github\.com\/\S+#issuecomment-\d+/) || [])[0] || null;
    if (!url) throw new Error(uploadError);
  }
  return { url, id: (url.match(/issuecomment-(\d+)/) || [])[1], previous, uploadError };
}

// Every ./<file> reference must have been rewritten to an uploaded attachment URL.
function unresolvedMedia(commentId) {
  const body = gh(['api', `/repos/${repo}/issues/comments/${commentId}`, '-q', '.body']);
  return media.filter((f) => body.includes(`(./${f})`));
}

let gallery = { url: null, id: null, previous: [], uploadError: null };
let galleryOk = false;
try {
  gallery = postGallery();
  galleryOk = true;
} catch (e) {
  console.error(`[post-evidence] gallery comment failed: ${e.message.split('\n')[0]}`);
}

let mediaOk = galleryOk && !gallery.uploadError;
if (mediaOk && gallery.id) {
  try {
    const missing = unresolvedMedia(gallery.id);
    if (missing.length) console.error(`[post-evidence] not uploaded: ${missing.join(', ')}`);
    mediaOk = missing.length === 0;
  } catch (e) {
    console.error(`[post-evidence] could not read back the gallery: ${e.message.split('\n')[0]}`);
    mediaOk = false;
  }
}
if (galleryOk && !mediaOk) console.error('[post-evidence] media not verified; the previous gallery is kept. Inspect the new one before retrying.');

// Read the body at the last moment: the upload can take a while and the author may edit meanwhile.
let bodyOk = false;
let headSha = null;
try {
  const view = JSON.parse(gh(['pr', 'view', pr, '--repo', repo, '--json', 'body,headRefOid']));
  headSha = view.headRefOid;
  const bodyFile = join(runDir, 'pr-body.md');
  writeFileSync(bodyFile, spliceIntoBody(view.body, buildBodyBlock({ galleryUrl: gallery.url, headSha })));
  gh(['pr', 'edit', pr, '--repo', repo, '--body-file', bodyFile]);
  bodyOk = true;
} catch (e) {
  console.error(`[post-evidence] updating the PR description failed: ${e.message.split('\n')[0]}`);
}

if (bodyOk && galleryOk) {
  if (mediaOk) deleteComments(gallery.previous.filter((old) => old !== gallery.id));
  console.log(`pr_post=${mediaOk ? 'spliced' : 'partial-media'}`);
  console.log(`pr=${pr} repo=${repo} media=${media.length} gallery_url=${gallery.url ?? '-'} replaced=${mediaOk ? gallery.previous.length : 0}`);
  process.exit(mediaOk ? 0 : 1);
}

console.error(`[post-evidence] surfaces: body=${bodyOk ? 'ok' : 'failed'} gallery=${galleryOk ? 'ok' : 'failed'}`);
persistAndExit('failed', { galleryUrl: gallery.url, headSha });
