// no-mistakes-backend harness: make ONE authenticated request to the backend API under
// test and emit a REDACTED request/response capture for PR evidence + an optional status
// assertion.
//
// The Bearer is read from the env (NMB_BEARER) — NEVER from argv (argv shows in `ps`).
// The captured request/response have the Authorization header value, the configured
// API-key header ($NM_API_KEY_HEADER), and the bearer string itself scrubbed before they
// are printed, so the evidence is safe to post. See SKILL.md §8.
//
// Usage:
//   NMB_BEARER="$(… api-token.mjs)" node http-client.mjs \
//     --method POST --url "$BASE/api/.../resource" \
//     --body '{"name":"nmb-<run>-acme"}'  [--body-file payload.json] \
//     [--header 'X-Foo: bar']  [--expect-status 201]  [--json]
//
// Output (default): human-readable redacted request + response blocks.
//   --json: {ok, status, expectStatus, requestText, responseText, body}
//     ok = (expectStatus unset) ? status<400 : status===expectStatus
//     body = parsed JSON response when parseable, else the raw text (redacted).
// Exit: 0 when ok, 2 when the status assertion fails, 1 on a transport/usage error.

const argv = process.argv.slice(2);
function flag(name) { return argv.includes(`--${name}`); }
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}
function allOpts(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}` && argv[i + 1]) out.push(argv[i + 1]);
  return out;
}
function die(msg) { console.error(`[http-client] ${msg}`); process.exit(1); }

const method = (opt('method', 'GET')).toUpperCase();
const url = opt('url');
if (!url) die('required: --url <full url>');
const expectStatus = opt('expect-status') ? Number(opt('expect-status')) : null;
const asJson = flag('json');

const bearer = process.env.NMB_BEARER || '';
const headers = {};
if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
for (const h of allOpts('header')) {
  const idx = h.indexOf(':');
  if (idx === -1) die(`bad --header (want 'Name: value'): ${h}`);
  headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
}

let bodyText;
const bodyFile = opt('body-file');
const bodyArg = opt('body');
if (bodyFile) {
  const { readFileSync } = await import('node:fs');
  bodyText = readFileSync(bodyFile, 'utf8');
} else if (bodyArg !== undefined) {
  bodyText = bodyArg;
}
if (bodyText !== undefined && !('Content-Type' in headers) && !('content-type' in headers)) {
  headers['Content-Type'] = 'application/json';
}

// --- Redaction: scrub the bearer string + known sensitive headers everywhere. ---
// One sensitive-name set drives the request-header-key check, the header-line text
// redaction, AND the JSON-key redaction below — so they can never drift apart. The
// project's custom API-key header ($NM_API_KEY_HEADER) is folded in dynamically.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const apiKeyHeader = (process.env.NM_API_KEY_HEADER || '').toLowerCase().trim();
const SENSITIVE_NAMES = [
  'authorization', 'cookie', 'set-cookie', 'x-api-key',
  ...(apiKeyHeader ? [escapeRe(apiKeyHeader)] : []),
  'access[_-]?token', 'refresh[_-]?token', 'id[_-]?token', 'token',
  'api[_-]?key', 'client[_-]?secret', 'secret', 'password', 'private[_-]?key',
].join('|');
const SENSITIVE_HEADER = new RegExp(`^(?:${SENSITIVE_NAMES})$`, 'i');
function redact(text) {
  if (!text) return text;
  let out = String(text);
  if (bearer) out = out.split(bearer).join('«redacted-token»');
  return out
    .replace(new RegExp(`^(${SENSITIVE_NAMES})\\s*:.*$`, 'gim'), '$1: «redacted»')
    .replace(new RegExp(`("(?:${SENSITIVE_NAMES})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi'), '$1"«redacted»"')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]{12,}/g, 'Bearer «redacted»')
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgres://«redacted»');
}
function redactedHeaderLines(h) {
  return Object.entries(h).map(([k, v]) =>
    `${k}: ${SENSITIVE_HEADER.test(k) ? '«redacted»' : redact(v)}`);
}

const requestText = [
  `${method} ${url}`,
  ...redactedHeaderLines(headers),
  ...(bodyText !== undefined ? ['', redact(bodyText)] : []),
].join('\n');

let res, rawText;
try {
  res = await fetch(url, { method, headers, body: bodyText });
  rawText = await res.text();
} catch (e) {
  die(`request failed: ${(e.message || e).toString().split('\n')[0]}`);
}

const redactedBody = redact(rawText);
// Parse the REDACTED text so the emitted `body` can never carry a secret the response
// echoed back (the capture is advertised as safe to post).
let parsed;
try { parsed = JSON.parse(redactedBody); } catch { parsed = undefined; }

const responseText = [
  `${res.status} ${res.statusText}`,
  `content-type: ${res.headers.get('content-type') || ''}`,
  '',
  redactedBody,
].join('\n');

const ok = expectStatus === null ? res.status < 400 : res.status === expectStatus;

if (asJson) {
  process.stdout.write(JSON.stringify({
    ok, status: res.status, expectStatus,
    requestText, responseText,
    body: parsed !== undefined ? parsed : redactedBody,
  }) + '\n');
} else {
  process.stdout.write(`--- request ---\n${requestText}\n\n--- response ---\n${responseText}\n`);
  process.stdout.write(`\nassert: ${ok ? 'PASS' : 'FAIL'}${expectStatus !== null ? ` (expected ${expectStatus}, got ${res.status})` : ''}\n`);
}

process.exit(ok ? 0 : 2);
