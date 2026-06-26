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
// Evidence backends (resolved by this precedence — FIRST match wins):
//
//   1. (env NOMISTAKES_EVIDENCE_UPLOAD_CMD SET) EXTERNAL-CMD INLINE — power-user override:
//     For each PNG, runs $NOMISTAKES_EVIDENCE_UPLOAD_CMD via `sh -c` with two env
//     vars provided to it:
//       NM_FILE = absolute local path to the PNG
//       NM_NAME = dest object name, `<pr>/<run>/<basename>`
//     The command's stdout (trimmed) is used as the image URL. Because that host
//     serves the image publicly/signed-fetchably, GitHub renders it INLINE as a
//     real ![](url) thumbnail (no click-through-only note). The orphan-branch git
//     push is SKIPPED entirely in this mode.
//
//   2. (config file ${HOME}/.no-mistakes/evidence.json present) NATIVE S3 INLINE — the
//     default once `scripts/s3-evidence-setup.sh` has been run once (NO env var needed):
//     Config shape: {"backend":"s3","bucket":"...","region":"...","prefix":"...","expiresIn":604800}
//     For each PNG, key = `<prefix>/<pr|'no-pr'>/<run>/<basename>`, then via the aws
//     CLI directly (execFileSync, no shell):
//       aws s3 cp <file> s3://<bucket>/<key> --content-type image/png [--region <region>]
//       aws s3 presign s3://<bucket>/<key> --expires-in <expiresIn|604800> [--region <region>]
//     The presign stdout (trimmed) is the inline ![](url) image URL; the orphan-branch
//     push is SKIPPED. Malformed/missing config => silently skip to backend 3.
//
//   3. (else) ORPHAN-BRANCH CLICK-THROUGH — zero-infra default:
//     Pushes run screenshots to an orphan `no-mistakes-evidence` branch WITHOUT
//     checking it out (git plumbing + temp index, never touches the PR working
//     tree), embeds raw.githubusercontent.com URLs. For PRIVATE repos these do
//     NOT render inline (GitHub's camo image proxy fetches anonymously => 404 for
//     both raw.githubusercontent.com and github.com/.../raw forms), so the images
//     are posted as click-through links (resolve for any repo-authed viewer) plus
//     a limitation note. No external host; trust boundary = the private repo.
//
//   FAIL-CLOSED (backends 1 & 2): if any upload/aws call errors OR yields an empty URL
//     for ANY screenshot, that inline mode is abandoned for the whole run and we FALL
//     BACK to the orphan-branch click-through path (log the failure, note it) so the
//     verdict still posts — the run is never lost over an upload hiccup.
//   CONFIDENTIALITY: the upload target must be one the org trusts at the SAME data
//     classification as the private repo (dev/test screenshots only) — never a
//     public/anonymous host for customer data. See DESIGN.md "Evidence delivery".
//
// Usage:
//   node post-evidence.mjs --pr <N> --run-dir <dir> --results <results.json> [--repo owner/name]
//
// results.json: { revision, intentSource, cases:[{name,pass,evidence}], findings:[{severity,screen,viewport,issue}] }
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

// Local checkout to run git from: explicit override, else the repo's ~/PromptArmor
// checkout (portable — no hardcoded machine path), else current cwd.
const repoCwd = process.env.NOMISTAKES_REPO_DIR
  || (repo && process.env.HOME ? join(process.env.HOME, 'PromptArmor', repo.split('/')[1]) : process.cwd());
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

let s3FailureDetail = null;
function isAwsAuthError(s) {
  return /expired|reauthenticate|InvalidClientTokenId|ExpiredToken|sso[\s_-]?login|credential|Unable to locate credentials|AccessDenied/i.test(s || '');
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
        s3FailureDetail = 'aws presign printed an empty URL';
        console.error(`[post-evidence] ${s3FailureDetail} for ${png}`);
        return null;
      }
      urls[png] = url;
    } catch (e) {
      s3FailureDetail = (e.stderr || e.message || '').toString().trim();
      console.error(`[post-evidence] aws upload/presign failed for ${png}: ${s3FailureDetail.split('\n')[0]}`);
      return null;
    }
  }
  return urls;
}

// Loud, actionable banner when a CONFIGURED inline backend fails. Inline is MANDATORY
// once configured, so we REFUSE to downgrade to the orphan-branch (non-inline) path —
// nothing is posted; the verdict is kept locally and the user must re-auth + re-run.
function noteInlineRequiredFailure() {
  const authExpired = isAwsAuthError(s3FailureDetail);
  console.error('========================================================================');
  if (authExpired) {
    console.error('[post-evidence] AWS SESSION EXPIRED — inline S3 evidence is configured and');
    console.error('  REQUIRED, but the upload failed auth. REFUSING to downgrade to the orphan-');
    console.error('  branch (non-inline) path. No images posted; verdict kept locally only.');
    console.error('  FIX: run `aws login` (or `aws sso login`), then re-run no-mistakes-frontend.');
  } else {
    console.error('[post-evidence] inline evidence upload FAILED and is REQUIRED (configured');
    console.error(`  backend). reason: ${(s3FailureDetail || 'unknown').split('\n')[0]}`);
    console.error('  REFUSING to downgrade to the orphan-branch path. Resolve + re-run.');
  }
  console.error('========================================================================');
}

const s3Config = process.env.NOMISTAKES_EVIDENCE_UPLOAD_CMD ? null : readS3Config();
const inlineConfigured = !!process.env.NOMISTAKES_EVIDENCE_UPLOAD_CMD || !!s3Config;
let externalUrls = null;
if (process.env.NOMISTAKES_EVIDENCE_UPLOAD_CMD) {
  externalUrls = uploadExternal();
} else if (s3Config) {
  externalUrls = uploadS3(s3Config);
}

// Inline backend configured but upload failed → inline is REQUIRED. Do NOT downgrade
// to the orphan-branch path; hard-stop (handled after persistAndExit is defined).
const inlineRequiredFailed = inlineConfigured && !externalUrls && pngs.length > 0;
if (inlineRequiredFailed) noteInlineRequiredFailure();

let pushResult;
if (externalUrls) {
  pushResult = { pushed: false, reason: 'inline-host (orphan push skipped)' };
} else if (inlineRequiredFailed) {
  pushResult = { pushed: false, reason: 'inline-required: upload failed, orphan downgrade refused' };
} else {
  try { pushResult = pushEvidence(); }
  catch (e) { pushResult = { pushed: false, reason: e.message.split('\n')[0] }; }
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
    // Inline host (native S3 or external cmd): signed-fetchable => GitHub renders inline.
    return { urlFor: (name) => externalUrls[name], inline: true, note: null, mode: 'inline-host' };
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

// Inline S3 is mandatory once configured: never post a degraded (non-inline) result.
// Keep the verdict locally and fail — the user re-auths and re-runs for inline S3.
if (inlineRequiredFailed) persistAndExit('failed');

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
