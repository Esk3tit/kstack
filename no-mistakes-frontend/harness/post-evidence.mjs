// no-mistakes harness: publish UI-verification evidence to a GitHub PR on TWO surfaces.
//
//   1. A single idempotent GALLERY COMMENT (marker <!-- no-mistakes-frontend:gallery -->) holding
//      the inline screenshot gallery + visual-findings detail. Updated in place on re-run.
//   2. A COMPACT BODY BLOCK (markers <!-- no-mistakes-frontend:start -->…<!-- no-mistakes-frontend:end -->)
//      spliced at the TOP of the PR description: status header + test-case table whose
//      Evidence cells link to the gallery comment. NO inline images, NO presigned URLs —
//      so the body stays commit-clean (squash-merge messages pre-fill from the body).
//   The author's existing body is preserved.
//
// Evidence hosting: a PRIMARY host (from config) with a FALLBACK. Evidence is NEVER committed to
// the PR branch / merged diff — external hosts live off-repo; git-branch uses a SEPARATE orphan branch.
//
//   PRIMARY — config `evidence.backend`, exported as $NM_EVIDENCE_BACKEND:
//     cmd    — runs $NOMISTAKES_EVIDENCE_UPLOAD_CMD per PNG (NM_FILE/NM_NAME in env); stdout = URL.
//     s3     — aws s3 cp + presign (from $NM_EVIDENCE_{BUCKET,PREFIX,EXPIRES_IN}/$AWS_REGION, else
//              legacy ~/.no-mistakes/evidence.json). Presigned URL.
//     gdrive — rclone copy to $NM_EVIDENCE_GDRIVE_REMOTE:$NM_EVIDENCE_GDRIVE_FOLDER, share
//              anyone-with-link, embed the direct https://lh3.googleusercontent.com/d/<id> URL.
//     imgur  — anonymous upload (curl, Client-ID from $NM_EVIDENCE_IMGUR_CLIENT_ID_ENV); direct
//              i.imgur.com link (renders inline reliably).
//   A successful host serves public/signed bytes, so GitHub renders ![](url) INLINE even on PRIVATE
//   repos, and the orphan-branch push is skipped.
//
//   FALLBACK — $NM_EVIDENCE_FALLBACK (default git-branch) — used when the primary fails or is local/unset:
//     git-branch — pushes PNGs to an orphan `no-mistakes-evidence` branch via git plumbing (temp
//       index — NEVER touches the PR working tree or PR branch; evidence is never in the merged diff).
//       raw.githubusercontent URLs render inline on PUBLIC repos, click-through on private. Reclaim
//       with evidence-cleanup.mjs (per-PR on merge / age prune).
//     local | none — no upload; the gallery is still written to <run-dir>/summary.md.
//
//   CONFIDENTIALITY: gdrive (anyone-with-link) and imgur (anonymous) are PUBLIC hosts — use ONLY for
//     non-production dev/test screenshots, never customer data. For private customer data use s3/cmd
//     (org-trusted) or git-branch (stays in the private repo).
//
// Usage:
//   node post-evidence.mjs --pr <N> --run-dir <dir> --results <results.json> [--repo owner/name]
//
// results.json: { revision, intentSource, previewUrl?, cases:[{name,pass,evidence}], findings:[{severity,screen,viewport,issue}] }
//   previewUrl (optional): the resolved preview frontend URL; rendered as a clickable "Open the preview UI →" line so a reviewer can open the running app without re-running.
//   evidence = PNG basename present in --run-dir, or null.
//
// On no-PR / gh failure: writes the assembled markdown to <run-dir>/summary.md,
// prints pr_post=no-pr | pr_post=failed, exits non-zero — the verdict is never lost.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const MARKER_START = '<!-- no-mistakes-frontend:start -->';
const MARKER_END = '<!-- no-mistakes-frontend:end -->';
const MARKER_REGION = /<!-- no-mistakes-frontend:start -->[\s\S]*?<!-- no-mistakes-frontend:end -->/;
const MARKER_GALLERY = '<!-- no-mistakes-frontend:gallery -->';
const BRANCH = 'no-mistakes-evidence';

function die(msg) { console.error(`[post-evidence] ${msg}`); process.exit(1); }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const pr = arg('pr');
const runDir = arg('run-dir');
const resultsPath = arg('results');
let repo = arg('repo');

if (!runDir || !resultsPath) die('required: --run-dir <dir> --results <results.json>');
if (!existsSync(runDir)) die(`run-dir not found: ${runDir}`);
if (!existsSync(resultsPath)) die(`results not found: ${resultsPath}`);

let results;
try { results = JSON.parse(readFileSync(resultsPath, 'utf8')); }
catch (e) { die(`could not parse results json: ${e.message}`); }

const runId = basename(runDir.replace(/\/+$/, '')) || 'run';
const prefix = `${pr || 'no-pr'}/${runId}`;

// Local checkout to run git from: explicit override (NOMISTAKES_REPO_DIR), else
// the repo under the configured checkout base (NM_CHECKOUT_BASE), else under HOME,
// else current cwd. No hardcoded org dir.
const repoBase = repo ? repo.split('/')[1] : '';
const repoCwd = process.env.NOMISTAKES_REPO_DIR
  || (repoBase && process.env.NM_CHECKOUT_BASE ? join(process.env.NM_CHECKOUT_BASE, repoBase) : '')
  || (repoBase && process.env.HOME ? join(process.env.HOME, repoBase) : '')
  || process.cwd();
const gitCwd = existsSync(join(repoCwd, '.git')) ? repoCwd : process.cwd();

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: gitCwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts,
  }).trim();
}
function gitQuiet(args, opts = {}) {
  try { return git(args, opts); } catch { return ''; }
}

if (!repo) {
  const url = gitQuiet(['remote', 'get-url', 'origin']);
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (m) repo = m[1];
}
if (!repo) die('could not determine --repo (owner/name) from origin remote');

// Discover the PNG screenshots in the run dir.
const pngs = readdirSync(runDir).filter((f) => f.toLowerCase().endsWith('.png')).sort();

// --- 1. Push PNGs to the orphan branch via plumbing (no checkout). ---------
function pushEvidence() {
  if (pngs.length === 0) return { pushed: false, reason: 'no png screenshots in run-dir' };
  const tmpIndex = join(mkdtempSync(join(tmpdir(), 'nm-idx-')), 'index');
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };

  gitQuiet(['fetch', 'origin', BRANCH], { env }); // ignore failure if branch absent

  const parent = gitQuiet(['rev-parse', `origin/${BRANCH}`], { env });
  if (parent) git(['read-tree', `${parent}^{tree}`], { env });

  for (const png of pngs) {
    const oid = git(['hash-object', '-w', join(runDir, png)], { env });
    git(['update-index', '--add', '--cacheinfo', '100644', oid, `${prefix}/${png}`], { env });
  }

  const tree = git(['write-tree'], { env });
  const commitArgs = ['commit-tree', tree];
  if (parent) commitArgs.push('-p', parent);
  commitArgs.push('-m', `no-mistakes evidence PR#${pr || 'none'} run ${runId}`);
  const commit = git(commitArgs, { env });

  git(['push', 'origin', `${commit}:refs/heads/${BRANCH}`], { env });
  return { pushed: true, commit };
}

// --- 1b. External-host upload path (NOMISTAKES_EVIDENCE_UPLOAD_CMD). ---------
// Runs the user-supplied command once per PNG with NM_FILE/NM_NAME in env,
// using its trimmed stdout as the image URL. Fails closed: any non-zero exit or
// empty URL abandons this mode for the whole run (caller falls back to orphan
// branch). Returns a name->url map on full success, else null.
function uploadExternal() {
  if (pngs.length === 0) return null;
  const urls = {};
  for (const png of pngs) {
    const name = `${prefix}/${png}`;
    let out;
    try {
      out = execFileSync('sh', ['-c', process.env.NOMISTAKES_EVIDENCE_UPLOAD_CMD], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        env: { ...process.env, NM_FILE: join(runDir, png), NM_NAME: name },
      }).trim();
    } catch (e) {
      console.error(`[post-evidence] upload command failed for ${png}: ${(e.message || '').split('\n')[0]}`);
      return null;
    }
    if (!out) {
      console.error(`[post-evidence] upload command printed empty URL for ${png}`);
      return null;
    }
    urls[png] = out;
  }
  return urls;
}

// --- 1c. Native S3 upload path (config file, no shell). ---------------------
// Reads ${HOME}/.no-mistakes/evidence.json; if it declares backend "s3", uploads
// each PNG with the aws CLI directly (execFileSync) and presigns it. Same
// fail-closed contract as uploadExternal: any aws error or empty URL abandons the
// mode (caller falls back to orphan branch). Returns a name->url map, else null.
function readS3Config() {
  try {
    if (!process.env.HOME) return null;
    const cfgPath = join(process.env.HOME, '.no-mistakes', 'evidence.json');
    if (!existsSync(cfgPath)) return null;
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (!cfg || cfg.backend !== 's3' || !cfg.bucket) return null;
    return cfg;
  } catch { return null; }
}

function uploadS3(cfg) {
  if (pngs.length === 0) return null;
  const s3Prefix = (cfg.prefix || 'no-mistakes').replace(/\/+$/, '');
  const expiresIn = String(cfg.expiresIn || 604800);
  const regionArgs = cfg.region ? ['--region', cfg.region] : [];
  const urls = {};
  for (const png of pngs) {
    const key = `${s3Prefix}/${prefix}/${png}`;
    const uri = `s3://${cfg.bucket}/${key}`;
    try {
      execFileSync('aws', ['s3', 'cp', join(runDir, png), uri, '--content-type', 'image/png', ...regionArgs],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const url = execFileSync('aws', ['s3', 'presign', uri, '--expires-in', expiresIn, ...regionArgs],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      if (!url) {
        console.error(`[post-evidence] aws presign printed an empty URL for ${png}`);
        return null;
      }
      urls[png] = url;
    } catch (e) {
      const detail = (e.stderr || e.message || '').toString().trim();
      console.error(`[post-evidence] aws upload/presign failed for ${png}: ${detail.split('\n')[0]}`);
      return null;
    }
  }
  return urls;
}

// --- 1d. Google Drive upload (rclone). --------------------------------------
// Copies each PNG to the Drive remote/folder, shares anyone-with-link, and builds the direct
// lh3.googleusercontent.com/d/<id> URL (Camo-fetchable for small images). Fail-closed → null.
function uploadGdrive() {
  if (pngs.length === 0) return null;
  const remote = process.env.NM_EVIDENCE_GDRIVE_REMOTE || 'gdrive';
  const folder = (process.env.NM_EVIDENCE_GDRIVE_FOLDER || 'no-mistakes-evidence').replace(/\/+$/, '');
  const urls = {};
  for (const png of pngs) {
    const dest = `${remote}:${folder}/${prefix}/${png}`;
    try {
      execFileSync('rclone', ['copyto', join(runDir, png), dest], { stdio: ['ignore', 'pipe', 'pipe'] });
      const link = execFileSync('rclone', ['link', dest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const id = (link.match(/[?&]id=([-\w]+)/) || link.match(/\/d\/([-\w]+)/) || [])[1] || (link.match(/[-\w]{28,}/) || [])[0];
      if (!id) { console.error(`[post-evidence] rclone link gave no file id for ${png}: ${link}`); return null; }
      urls[png] = `https://lh3.googleusercontent.com/d/${id}`;
    } catch (e) {
      console.error(`[post-evidence] rclone upload failed for ${png}: ${(e.stderr || e.message || '').toString().split('\n')[0]}`);
      return null;
    }
  }
  return urls;
}

// --- 1e. imgur anonymous upload (curl). -------------------------------------
function uploadImgur() {
  if (pngs.length === 0) return null;
  const clientId = process.env[process.env.NM_EVIDENCE_IMGUR_CLIENT_ID_ENV || 'IMGUR_CLIENT_ID'];
  if (!clientId) { console.error('[post-evidence] imgur backend selected but no Client-ID env set'); return null; }
  const urls = {};
  for (const png of pngs) {
    try {
      const out = execFileSync('curl', ['-s', '-H', `Authorization: Client-ID ${clientId}`,
        '-F', `image=@${join(runDir, png)}`, 'https://api.imgur.com/3/image'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const link = JSON.parse(out)?.data?.link;
      if (!link) { console.error(`[post-evidence] imgur upload gave no link for ${png}`); return null; }
      urls[png] = link;
    } catch (e) {
      console.error(`[post-evidence] imgur upload failed for ${png}: ${(e.message || '').split('\n')[0]}`);
      return null;
    }
  }
  return urls;
}

// s3 config from the loader's env exports, else the legacy ~/.no-mistakes/evidence.json.
function s3ConfigFromEnv() {
  if (process.env.NM_EVIDENCE_BACKEND === 's3' && process.env.NM_EVIDENCE_BUCKET) {
    return { backend: 's3', bucket: process.env.NM_EVIDENCE_BUCKET, region: process.env.AWS_REGION,
      prefix: process.env.NM_EVIDENCE_PREFIX, expiresIn: Number(process.env.NM_EVIDENCE_EXPIRES_IN) || 604800 };
  }
  return readS3Config();
}

// --- Resolve the PRIMARY host, attempt it, then fall back. -------------------
const EXTERNAL = ['cmd', 's3', 'gdrive', 'imgur'];
function resolvePrimary() {
  const b = process.env.NM_EVIDENCE_BACKEND;
  if (b && EXTERNAL.includes(b)) return b;
  if (process.env.NOMISTAKES_EVIDENCE_UPLOAD_CMD) return 'cmd';   // legacy override
  if ((b === undefined || b === '' || b === 'local') && readS3Config()) return 's3'; // legacy evidence.json
  return b || 'local';
}
function uploadVia(backend) {
  switch (backend) {
    case 'cmd': return uploadExternal();
    case 's3': return uploadS3(s3ConfigFromEnv());
    case 'gdrive': return uploadGdrive();
    case 'imgur': return uploadImgur();
    default: return null;
  }
}

const primaryBackend = resolvePrimary();
const fallbackBackend = process.env.NM_EVIDENCE_FALLBACK || 'git-branch';
if (primaryBackend === 'gdrive' || primaryBackend === 'imgur') {
  console.error(`[post-evidence] NOTE: '${primaryBackend}' is a PUBLIC host — dev/test screenshots only, never customer data.`);
}

let externalUrls = null;
let usedBackend = null;
if (EXTERNAL.includes(primaryBackend)) {
  externalUrls = uploadVia(primaryBackend);
  if (externalUrls) usedBackend = primaryBackend;
  else console.error(`[post-evidence] primary evidence host '${primaryBackend}' failed; falling back to '${fallbackBackend}'.`);
}

// Push to the orphan branch when no external URL and the effective host is git-branch
// (primary git-branch, or primary external-failed/local with git-branch fallback).
const wantOrphan = !externalUrls && (primaryBackend === 'git-branch' || fallbackBackend === 'git-branch');
let pushResult;
if (externalUrls) {
  pushResult = { pushed: false, reason: `inline-host:${usedBackend}` };
} else if (wantOrphan) {
  try { pushResult = pushEvidence(); }
  catch (e) { pushResult = { pushed: false, reason: e.message.split('\n')[0] }; }
} else {
  pushResult = { pushed: false, reason: primaryBackend === 'local' ? 'local (no host)' : `no host (fallback=${fallbackBackend})` };
}

// --- 2. URL resolution + render-validation (unchanged backends). ------------
function rawUrl(name) {
  return `https://raw.githubusercontent.com/${repo}/${BRANCH}/${prefix}/${encodeURIComponent(name)}`;
}

function firstImageRenders() {
  if (pngs.length === 0 || !pushResult.pushed) return false;
  const url = rawUrl(pngs[0]);
  try {
    const code = execFileSync('curl', ['-sf', '-o', '/dev/null', '-w', '%{http_code}', url],
      { encoding: 'utf8' }).trim();
    return code === '200';
  } catch { return false; }
}

// Resolve a name->url function + the inline flag + a render mode, from the
// already-resolved backend (externalUrls / orphan push). Does NOT change upload logic.
function resolveImages() {
  if (externalUrls) {
    // External host (s3/gdrive/imgur/cmd): public/signed-fetchable => GitHub renders inline.
    return { urlFor: (name) => externalUrls[name], inline: true, note: null, mode: usedBackend };
  }
  if (firstImageRenders()) {
    return { urlFor: rawUrl, inline: false, note: null, mode: 'raw-public' };
  }
  const note = pushResult.pushed
    ? `Screenshots pushed to the \`${BRANCH}\` branch (private repo — inline images may need repo auth to render; click any thumbnail for the full-size image).`
    : `Screenshot push unavailable (${pushResult.reason || 'unknown'}); evidence links may not resolve.`;
  return { urlFor: rawUrl, inline: false, note, mode: pushResult.pushed ? 'raw-private-fallback' : 'no-images' };
}

const images = resolveImages();
const hasScreenshots = pngs.length > 0;

// --- 3. Build the two surfaces. ---------------------------------------------
function overallStatus() {
  if (results.status) return String(results.status).toUpperCase();
  const cases = Array.isArray(results.cases) ? results.cases : [];
  return cases.some((c) => c.pass === false) ? 'FAIL' : 'PASS';
}

function findingsLines() {
  const findings = Array.isArray(results.findings) ? results.findings : [];
  if (findings.length === 0) return ['_clean_'];
  return findings.map((f) => {
    const sev = f.severity ?? 'info';
    const where = [f.screen, f.viewport].filter(Boolean).join(' / ');
    return `- **${sev}**${where ? ` (${where})` : ''}: ${f.issue ?? ''}`;
  });
}

// GALLERY COMMENT: inline screenshots + visual-findings detail. The full bulky
// evidence lives here so it never pollutes the PR body / squash-merge message.
function buildGallery({ urlFor, inline, note }) {
  const img = (alt, u) => (inline ? `![${alt}](${u})` : `[![${alt}](${u})](${u})`);
  const lines = [];
  lines.push(MARKER_GALLERY);
  lines.push('### no-mistakes — screenshots');
  if (note) lines.push(`> ${note}`);
  lines.push('');
  for (const p of pngs) {
    lines.push(`**${p}**`);
    lines.push('');
    lines.push(img(p, urlFor(p)));
    lines.push('');
  }
  lines.push('**Visual findings:**');
  lines.push(...findingsLines());
  lines.push('');
  return lines.join('\n');
}

// COMPACT BODY BLOCK: status + table only. Evidence cells are SHORT LINKS to the
// gallery comment — no inline images, no presigned/S3 URLs => commit-clean.
function buildBodyBlock(galleryUrl) {
  const revision = results.revision ?? 'unknown';
  const intent = results.intentSource ?? 'unknown';
  const cases = Array.isArray(results.cases) ? results.cases : [];
  const findings = Array.isArray(results.findings) ? results.findings : [];
  const status = overallStatus();
  const badge = status === 'PASS' ? '✅ PASS' : status === 'FAIL' ? '❌ FAIL' : status;

  const lines = [];
  lines.push(MARKER_START);
  lines.push(`### no-mistakes-frontend: ${badge}`);
  lines.push(`**Revision:** \`${revision}\`  ·  **Intent:** ${intent}`);
  if (results.previewUrl) {
    lines.push('');
    lines.push(`**Open the preview UI →** ${results.previewUrl}  _(preview target; point-in-time)_`);
  }
  lines.push('');
  lines.push('| Test case | Result | Evidence |');
  lines.push('| --- | :---: | --- |');
  for (const c of cases) {
    const res = c.pass ? '✅' : '❌';
    let ev = '—';
    if (c.evidence && pngs.includes(c.evidence) && galleryUrl) {
      ev = `[📸 ${c.evidence}](${galleryUrl})`;
    }
    const name = String(c.name ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
    lines.push(`| ${name} | ${res} | ${ev} |`);
  }
  lines.push('');
  lines.push(findings.length === 0
    ? '**Visual:** clean'
    : `**Visual:** ${findings.length} finding(s) — see gallery ↓`);
  if (galleryUrl) {
    lines.push('');
    lines.push(`🖼 **Full screenshot gallery →** ${galleryUrl}`);
  }
  lines.push(MARKER_END);
  return lines.join('\n');
}

// Splice the marked block into the PR body: replace an existing start…end region
// in place (preserving its position), else prepend to the top. Author content is
// never dropped or reordered.
function spliceIntoBody(currentBody, block) {
  const body = currentBody || '';
  if (MARKER_REGION.test(body)) return body.replace(MARKER_REGION, block);
  return body ? `${block}\n\n${body}` : block;
}

const galleryBody = hasScreenshots ? buildGallery(images) : null;

// --- 4. No-PR path: persist BOTH surfaces, never lose the verdict. -----------
const summaryFile = join(runDir, 'summary.md');
function fullSummary(galleryUrl) {
  const parts = [buildBodyBlock(galleryUrl)];
  if (galleryBody) parts.push(galleryBody);
  return parts.join('\n\n');
}
function persistAndExit(status, galleryUrl = null) {
  try { writeFileSync(summaryFile, fullSummary(galleryUrl)); }
  catch (e) { console.error(`[post-evidence] could not write ${summaryFile}: ${e.message}`); }
  console.log(`pr_post=${status}`);
  console.log(`summary_file=${summaryFile}`);
  process.exit(status === 'ok' ? 0 : 1);
}

if (!pr) persistAndExit('no-pr');

// --- 5. Idempotent post: gallery comment first, then compact body block. -----
function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

// Find an existing no-mistakes gallery comment; PATCH it in place, else CREATE.
// Returns the comment's html_url (for the body to link to), or null on no-comment.
function postGallery() {
  if (!galleryBody) return { url: null, action: 'skipped-no-screenshots' };
  const galleryFile = join(runDir, 'nm-gallery.md');
  writeFileSync(galleryFile, galleryBody);

  let existingUrl = null;
  try {
    const raw = gh(['pr', 'view', pr, '--repo', repo, '--json', 'comments']);
    const comments = (JSON.parse(raw).comments || []);
    const hit = comments.find((c) => (c.body || '').startsWith(MARKER_GALLERY));
    if (hit) existingUrl = hit.url;
  } catch (e) {
    console.error(`[post-evidence] could not list PR comments: ${e.message.split('\n')[0]}`);
  }

  if (existingUrl) {
    const m = existingUrl.match(/issuecomment-(\d+)/);
    if (m) {
      const patched = gh(['api', '--method', 'PATCH', `/repos/${repo}/issues/comments/${m[1]}`,
        '-F', `body=@${galleryFile}`, '-q', '.html_url']);
      return { url: patched || existingUrl, action: 'updated' };
    }
  }
  const created = gh(['pr', 'comment', pr, '--repo', repo, '--body-file', galleryFile]);
  return { url: created || null, action: 'created' };
}

// Splice the compact block into the PR body, preserving the author's content.
function postBody(galleryUrl) {
  const currentBody = gh(['pr', 'view', pr, '--repo', repo, '--json', 'body', '-q', '.body']);
  const newBody = spliceIntoBody(currentBody, buildBodyBlock(galleryUrl));
  const bodyFile = join(runDir, 'pr-body.md');
  writeFileSync(bodyFile, newBody);
  gh(['pr', 'edit', pr, '--repo', repo, '--body-file', bodyFile]);
}

// Attempt BOTH surfaces independently; a failure on one must not skip the other.
let galleryUrl = null;
let galleryOk = false;
let galleryAction = 'skipped-no-screenshots';
try {
  const g = postGallery();
  galleryUrl = g.url;
  galleryAction = g.action;
  galleryOk = true;
} catch (e) {
  console.error(`[post-evidence] gallery comment failed: ${e.message.split('\n')[0]}`);
}

let bodyOk = false;
try {
  postBody(galleryUrl);
  bodyOk = true;
} catch (e) {
  console.error(`[post-evidence] gh pr edit failed: ${e.message.split('\n')[0]}`);
}

if (bodyOk && galleryOk) {
  console.log('pr_post=spliced');
  console.log(`pr=${pr} repo=${repo} render=${images.mode} screenshots=${pngs.length} branch_push=${pushResult.pushed} gallery=${galleryAction}`);
  process.exit(0);
}

console.error(`[post-evidence] surfaces: body=${bodyOk ? 'ok' : 'failed'} gallery=${galleryOk ? galleryAction : 'failed'}`);
persistAndExit('failed', galleryUrl);
