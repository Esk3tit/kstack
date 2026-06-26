// no-mistakes-frontend harness: mint a real PropelAuth access token (Bearer) for the test
// user — no browser, no password — so the skill can call TPRM-API directly for
// ground-truth value checks. Uses the PropelAuth integration key + create_access_token.
// Run where those secrets resolve, e.g.:  doppler run -- node api-token.mjs --json
//
// Output: (default) bearer to stdout | --org org_id | --json {access_token,user_id,org_id,org_name,auth_url}
// Env: PROPEL_AUTH_TEST_AUTH_URL + PROPEL_AUTH_TEST_API_KEY (or the non-TEST pair).
//      Email = UI_VERIFY_EMAIL | PLAYWRIGHT_USER_EMAIL | first arg with '@' | test@test.com
//      Minutes = NOMISTAKES_TOKEN_MINUTES | 30
// NEVER extract or replay the browser's refresh_token cookie against backend endpoints.

const argv = process.argv.slice(2);
const mode = argv.includes('--json') ? 'json' : argv.includes('--org') ? 'org' : 'token';
const authUrl = (process.env.PROPEL_AUTH_TEST_AUTH_URL || process.env.PROPEL_AUTH_AUTH_URL || '').replace(/\/$/, '');
const apiKey = process.env.PROPEL_AUTH_TEST_API_KEY || process.env.PROPEL_AUTH_API_KEY || '';
const email = process.env.UI_VERIFY_EMAIL || process.env.PLAYWRIGHT_USER_EMAIL
  || argv.find((a) => a.includes('@')) || 'test@test.com';
const minutes = Number(process.env.NOMISTAKES_TOKEN_MINUTES || 30);

function die(msg) { console.error(`[api-token] ${msg}`); process.exit(1); }
if (!authUrl || !apiKey) {
  die('missing PROPEL_AUTH_TEST_AUTH_URL / PROPEL_AUTH_TEST_API_KEY — run under: doppler run -p tprm-api --');
}
const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(authUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) die(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const user = await api('GET', `/api/backend/v1/user/email?email=${encodeURIComponent(email)}&include_orgs=true`);
const userId = user.user_id;
if (!userId) die(`no PropelAuth user for ${email}`);
const orgs = user.org_id_to_org_info || {};
const orgId = Object.keys(orgs)[0] || '';
const orgName = (orgs[orgId] || {}).org_name || '';

const tok = await api('POST', '/api/backend/v1/access_token', { user_id: userId, duration_in_minutes: minutes });
const accessToken = tok.access_token;
if (!accessToken) die('create_access_token returned no access_token (is it enabled in the PropelAuth test env?)');

if (mode === 'json') process.stdout.write(JSON.stringify({ access_token: accessToken, user_id: userId, org_id: orgId, org_name: orgName, auth_url: authUrl }) + '\n');
else if (mode === 'org') process.stdout.write(orgId + '\n');
else process.stdout.write(accessToken + '\n');
