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
//     findings:[{severity,screen,viewport,issue,evidence?}], howToTest?:[{action, expect}] }
//   evidence/before = media basenames (png/jpg/gif/webp/mp4/webm/mov) in --run-dir; only these are
//   published, and a missing one aborts before anything is posted.
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
const cases = Array.isArray(results.cases) ? results.cases : [];
const declaredStatus = results.status ? String(results.status).toUpperCase() : null;
if (declaredStatus && !['PASS', 'FAIL', 'BLOCKED'].includes(declaredStatus)) die('results.status must be PASS, FAIL, or BLOCKED');
if ((!cases.length && declaredStatus !== 'BLOCKED') || cases.some((c) => typeof c.pass !== 'boolean'))
  die('results.cases must be non-empty (unless status is BLOCKED), each with a boolean "pass"');
if (declaredStatus === 'PASS' && cases.some((c) => !c.pass)) die('results.status is PASS but a case failed');
const passing = declaredStatus ? declaredStatus === 'PASS' : cases.every((c) => c.pass);
if (passing && !/^[0-9a-f]{7,40}\b/i.test(String(results.revision ?? ''))) die('a PASS needs results.revision to start with the tested commit SHA');
const findings = Array.isArray(results.findings) ? results.findings : [];
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
// Only captures a case or finding names are published; anything else in the run dir stays local.
const media = [...new Set([...cases.flatMap((c) => [...list(c.before), ...list(c.evidence)]),
  ...findings.flatMap((f) => list(f.evidence))])];
const present = new Set(readdirSync(runDir));
const unusable = media.filter((f) => !present.has(f) || !(IMAGE.test(f) || VIDEO.test(f)));
if (unusable.length) die(`evidence not found in --run-dir or not an image/video: ${unusable.join(', ')}`);
const cell = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function overallStatus() {
  if (results.status) return String(results.status).toUpperCase();
  return cases.some((c) => c.pass === false) ? 'FAIL' : 'PASS';
}

function findingsLines() {
  if (findings.length === 0) return ['_clean_'];
  return findings.flatMap((f) => {
    const where = [f.screen, f.viewport].filter(Boolean).join(' / ');
    const line = `- **${f.severity ?? 'info'}**${where ? ` (${where})` : ''}: ${f.issue ?? ''}`;
    return list(f.evidence).length ? [line, '', ...mediaBlock(list(f.evidence))] : [line];
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
  }
  lines.push('**Findings:**', ...findingsLines(), '');
  return lines.join('\n');
}

function buildBodyBlock({ galleryUrl, headSha }) {
  const revision = String(results.revision ?? 'unknown');
  const status = overallStatus();
  const badge = status === 'PASS' ? '✅ PASS' : status === 'FAIL' ? '❌ FAIL' : status;
  const gaps = Array.isArray(results.gaps) ? results.gaps : [];
  const howTo = Array.isArray(results.howToTest) ? results.howToTest : [];

  const lines = [`### ${marker}: ${badge}`];
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
  // Escaped so no result text can forge the end marker the next splice looks for.
  return `${MARKER_START}\n${lines.join('\n').replace(/<!--/g, '&lt;!--')}\n${MARKER_END}`;
}

function spliceIntoBody(currentBody, block) {
  const body = currentBody || '';
  if (MARKER_REGION.test(body)) return body.replace(MARKER_REGION, () => block);
  return body ? `${block}\n\n${body}` : block;
}

const galleryBody = media.length || findings.length ? buildGallery() : null;

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

// Returns the ids it could not delete.
function deleteComments(ids) {
  return ids.filter((id) => {
    try { gh(['api', '--method', 'DELETE', `/repos/${repo}/issues/comments/${id}`]); return false; }
    catch (e) { console.error(`[post-evidence] could not delete gallery comment ${id}: ${e.message.split('\n')[0]}`); return true; }
  });
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

let gallery;
try {
  gallery = postGallery();
} catch (e) {
  console.error(`[post-evidence] gallery comment failed: ${e.message.split('\n')[0]}`);
  persistAndExit('failed');
}

let mediaOk = !gallery.uploadError;
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
// The PR only ever shows fully uploaded evidence: an incomplete gallery is removed and the PR left as it was.
if (!mediaOk) {
  const left = gallery.id ? deleteComments([gallery.id]) : [];
  console.error(left.length
    ? `[post-evidence] media did not all upload, and the incomplete gallery could not be removed: ${gallery.url}`
    : '[post-evidence] media did not all upload; the PR is unchanged. Re-run to post.');
  persistAndExit('partial-media');
}

// Read the body at the last moment: the upload can take a while and the author may edit meanwhile.
let headSha = null;
try {
  const view = JSON.parse(gh(['pr', 'view', pr, '--repo', repo, '--json', 'body,headRefOid']));
  headSha = view.headRefOid;
  const bodyFile = join(runDir, 'pr-body.md');
  writeFileSync(bodyFile, spliceIntoBody(view.body, buildBodyBlock({ galleryUrl: gallery.url, headSha })));
  gh(['pr', 'edit', pr, '--repo', repo, '--body-file', bodyFile]);
} catch (e) {
  console.error(`[post-evidence] updating the PR description failed: ${e.message.split('\n')[0]}`);
  if (gallery.id) deleteComments([gallery.id]);
  persistAndExit('failed', { headSha });
}

// A concurrent run may have linked one of the snapshotted galleries since; never delete the linked one.
let linked = gallery.id;
try {
  const block = (gh(['pr', 'view', pr, '--repo', repo, '--json', 'body', '-q', '.body']).match(MARKER_REGION) || [''])[0];
  linked = (block.match(/Screenshots and clips →\*\* \S*issuecomment-(\d+)/) || [])[1] || linked;
} catch {}
const stale = deleteComments(gallery.previous.filter((old) => old !== gallery.id && old !== linked));
if (stale.length) console.error(`[post-evidence] old galleries left on the PR: ${stale.join(', ')}; re-run to remove them`);
console.log(`pr_post=${stale.length ? 'partial-cleanup' : 'spliced'}`);
console.log(`pr=${pr} repo=${repo} media=${media.length} gallery_url=${gallery.url ?? '-'} replaced=${gallery.previous.length - stale.length}`);
process.exit(stale.length ? 1 : 0);
