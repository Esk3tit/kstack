# no-mistakes-backend snippets

Copy the matching block. Resolve `H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"`
and load the project config first (`eval "$(node "$H/harness/load-config.mjs" --export)"`), so the
`$NM_*` / `$PORTER_*` targets below are populated. The Bearer/connection-string always travel via
**env vars**, never argv — argv shows in `ps`. Pick `BASE` per target: the backend app's local
`devUrl`, or the PR preview API base URL. Routes/tables/columns shown are **illustrative examples**
(PromptArmor's `vendor_management` API) — substitute the app under test.

---

## A — propelauth profile request + assert

For an auth profile of `kind: propelauth`, mint a real Bearer with no browser, then drive the
endpoint. Token stays in the env var. Run from the profile's `secretsScopeDir` under its `secretsTool`.

```bash
H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"
eval "$(node "$H/harness/load-config.mjs" --export)"
BASE="<backend app devUrl>"   # e.g. http://localhost:8090

# Resolve the test email the minter requires from the profile's testEmailEnv, then mint once
# and reuse for the whole run. cd into the profile's secretsScopeDir for the right secrets scope.
cd "<profile secretsScopeDir>"            # e.g. the backend app's repoPath
export UI_VERIFY_EMAIL="<value of the profile's testEmailEnv>"
# when secretsTool=doppler:
export NMB_BEARER="$(doppler run -- node "$H/harness/api-token.mjs")"   # bare token to stdout
ORG_ID="$(doppler run -- node "$H/harness/api-token.mjs" --org)"        # org for ground-truth scoping

# Drive an endpoint (run-scoped unique id keeps mutations self-cleaning):
node "$H/harness/http-client.mjs" --json \
  --method POST --url "$BASE/api/vendor_management/vendors" \
  --body '{"name":"nmb-'"$RUN"'-acme"}' \
  --expect-status 201
# → {ok, status, requestText, responseText, body}  (Authorization redacted in the capture)
```

422 validation case — assert the backend app's **custom error envelope** (`errorEnvelope` from
config; the PromptArmor example is `{status_code, message, data}`, not the framework's bare `{detail}`):

```bash
node "$H/harness/http-client.mjs" --json --method POST --url "$BASE/api/vendor_management/vendors" \
  --body '{"name":""}' --expect-status 422
# then check the body matches the app's errorEnvelope (e.g. body.status_code / body.message / body.data)
```

---

## B — bearer-env profile request + assert

For an auth profile of `kind: bearer-env` (a static key used directly as the Bearer; no login). Read
the profile's `keyEnv` from its secrets scope straight into the env var.

```bash
H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"
eval "$(node "$H/harness/load-config.mjs" --export)"
BASE="<backend app devUrl>"   # e.g. http://localhost:8090
# when secretsTool=doppler:
export NMB_BEARER="$(cd "<profile secretsScopeDir>" && doppler run -- printenv <profile keyEnv>)"

node "$H/harness/http-client.mjs" --json \
  --method GET --url "$BASE/api/admin/<endpoint>" --expect-status 200
```

`printenv` keeps the key off the command line; `http-client.mjs` redacts it from the capture.

---

## C — DB read-after-write (ground-truth) — (SQL adapter), via the DB MCP

> Pick the snippet for `$NM_DB_ADAPTER`: **sql** → this block; **convex** → C-Convex; **firestore** →
> C-Firestore. The discipline is the same — a 2xx with no/incorrect persisted row **or document** is a
> FAIL.

The core check: the endpoint returned 2xx, but did the row **persist**? Query the resolved branch
(§1.4 — `$NM_DB_LOCAL_BRANCH` for localhost, `$NM_DB_PREVIEW_PATTERN` with `{pr}` for preview) with
the configured DB MCP **run-sql** tool (`$NM_DB_MCP_RUN_SQL`; no connection string handled here).
Scope to the same org the request acted as.

Pattern (agent calls the MCP tool, not a shell command; tool name is `$NM_DB_MCP_RUN_SQL` on the
`$NM_DB_PLATFORM` MCP server — e.g. `mcp__Neon__run_sql` for Neon):

```
<DB MCP run-sql tool>(
  projectId: "$NM_DB_PROJECT_ID",             # the configured DB project/instance id
  branchId:  "<resolved branch id>",          # $NM_DB_LOCAL_BRANCH, or the preview branch's id
  sql: "SELECT id, name, org_id, created_at
        FROM vendors                           -- example table
        WHERE name = 'nmb-<RUN>-acme' AND org_id = '<ORG_ID>'"
)
```

Assert: exactly the expected row(s), expected column values, and any **FK/join rows** the write should
produce (e.g. a child `vendor_*` row referencing the new id, in the example schema). A green 2xx with
no/incorrect row is a **FAIL** — that mismatch is what this skill exists to catch. Capture the query +
result as `dbCheck`.

Migration gate (§1.5) — **skip entirely when `$NM_DB_MIGRATIONS=none`**. Otherwise confirm the branch
is at the PR's head revision before testing:

```
<DB MCP run-sql tool>(projectId: "$NM_DB_PROJECT_ID", branchId: "<id>",
  sql: "SELECT version_num FROM $NM_DB_MIGRATIONS_TABLE")
# compare to the revision the PR's migration adds (column name varies by migration tool)
```

---

## C-Convex — DB read-after-write (ground-truth) — (Convex adapter)

Convex has **no SQL** — prove persistence by reading **documents** from the resolved deployment (§1.4),
then assert on the returned document(s), not on rows. Target the per-PR preview deployment with
`--preview-name <pr>` (or the deployment-scoped deploy key in `$NM_CONVEX_DEPLOY_KEY_ENV`).

Priority (a) — a query function via the Convex CLI (`$NM_CONVEX_RUN_CMD`, e.g. `npx convex run`):

```bash
H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"
eval "$(node "$H/harness/load-config.mjs" --export)"
# Deploy-key auth stays in the env var; never echo it. PR number drives the preview deployment name.
export CONVEX_DEPLOY_KEY="$(cd "<secretsScopeDir>" && doppler run -- printenv "$NM_CONVEX_DEPLOY_KEY_ENV")"

# Run a query fn against the resolved deployment; assert on the returned document(s):
$NM_CONVEX_RUN_CMD vendors:getByName '{"name":"nmb-'"$RUN"'-acme","orgId":"'"$ORG_ID"'"}' \
  --preview-name "pr-<N>"
# → JSON document(s). Assert: present + field values (name, orgId, …) + any referenced docs.
```

Priority (b) — the Convex MCP `$NM_CONVEX_MCP_ONEOFF` (e.g. `runOneoffQuery` — sandboxed read-only JS
over the data; agent calls the MCP tool, not a shell command):

```
<Convex MCP runOneoffQuery tool>(
  deploymentSelector: "<resolved deployment / preview pr-<N>>",
  query: "const docs = await ctx.db
            .query('vendors')
            .filter(q => q.eq(q.field('name'), 'nmb-<RUN>-acme'))
            .collect();
          return docs;"
)
# Assert on the returned docs (presence + field values + referenced docs). Read-only; no mutation.
```

Priority (c) — dump the table tail via `$NM_CONVEX_DATA_CMD` (e.g. `npx convex data`) and find the doc:

```bash
$NM_CONVEX_DATA_CMD vendors --order desc --limit 5 --preview-name "pr-<N>"
# Assert the just-written document appears with the expected fields.
```

A 2xx with no/incorrect document is a **FAIL**. Capture the command/tool call + returned doc(s) as
`dbCheck`. (No SQL migration table — Convex schema is code-deployed with the function push; the
deployment/revision mismatch is covered by the revision gate, §1.5.)

---

## C-Firestore — DB read-after-write (ground-truth) — (Firestore adapter)

Firestore has **no SQL and no DB branching** — read the document **by path** against the isolated
project/emulator resolved in §1.4 (`$NM_FIRESTORE_ISOLATION` = `separate-project` | `emulator`).
Admin/MCP creds (service account in `$NM_FIRESTORE_CREDS_ENV`, ADC) **bypass Security Rules** and give a
**strong-consistency** read — true persisted state.

Priority (a) — the Firebase MCP `$NM_FIRESTORE_MCP_GET_DOC` (e.g. `firestore_get_document`) by path:

```
<Firebase MCP firestore_get_document tool>(
  path: "vendors/<docId>"            # the doc the write should have created
)
# Assert: document exists + field values (name, orgId, …) + any referenced docs (read those by path too).
```

Priority (b) — the Admin SDK by path (creds from `$NM_FIRESTORE_CREDS_ENV`; for the emulator,
`$NM_FIRESTORE_EMULATOR_HOST_ENV` must be set):

```bash
# GOOGLE_APPLICATION_CREDENTIALS (=$NM_FIRESTORE_CREDS_ENV) points at the service-account JSON (ADC).
# For emulator isolation: export FIRESTORE_EMULATOR_HOST (=$NM_FIRESTORE_EMULATOR_HOST_ENV) first.
node -e '
  const admin = require("firebase-admin");
  admin.initializeApp();
  const db = admin.firestore();
  (async () => {
    const snap = await db.doc("vendors/" + process.argv[1]).get();
    console.log(JSON.stringify({ exists: snap.exists, data: snap.data() ?? null }));
  })();
' "<docId>"
# Assert: exists === true + data() field values + any referenced docs.
```

A 2xx with no/incorrect document (`exists: false` or wrong fields) is a **FAIL**. Capture the path +
returned document as `dbCheck`. There is no per-PR DB branch — you asserted against the isolated
project/emulator from §1.4; if `$NM_FIRESTORE_ISOLATION=none`, note reads may hit shared data.

---

## D — Async (background workflow) bounded poll

For a case flagged `asyncTimeout` (the real effect lands via a background workflow/job runner). Get a
connection string for the resolved branch from the configured DB MCP **get-connection-string** tool
(`$NM_DB_MCP_GET_CONN`), export it, then poll. A worker must be running against the target env for the
state to appear.

```bash
H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"
# NMB_DATABASE_URL from the DB MCP get-connection-string tool (projectId, branchId) — never echo it:
export NMB_DATABASE_URL="<connection string from the DB MCP>"

node "$H/harness/poll-until.mjs" \
  --sql "SELECT id FROM generated_reports WHERE vendor_id = '<id>' AND status = 'complete'" \
  --expect-rows 1 --timeout 60 --interval 3
# exit 0 = state reached (POLL_OK); 2 = POLL_TIMEOUT (mark needs-async-state, capture partial state);
# exit 3 = psql unavailable → poll via the DB MCP run-sql tool in a bounded loop instead.
```

If `psql` is unavailable (exit 3), fall back to calling the DB MCP run-sql tool (snippet C) in a
bounded loop yourself instead of this helper.

---

## E — Post results to the PR

```bash
H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"
node "$H/harness/post-results.mjs" \
  --pr <N> --repo <owner/name> \
  --run-dir ~/.no-mistakes-backend/"$RUN" \
  --results ~/.no-mistakes-backend/"$RUN"/results.json
# pr_post=posted | no-pr | failed   (verdict never lost; summary.md written on no-pr/failed)
```
