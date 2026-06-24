# no-mistakes-backend snippets

Copy the matching block. Resolve `H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"`
first. The Bearer/connection-string always travel via **env vars**, never argv — argv shows in `ps`.
Pick `BASE` per target: localhost `http://localhost:8090`, or the PR preview API base URL.

---

## A — AI-TPRM (PropelAuth) request + assert

Mint a real Bearer with no browser, then drive the endpoint. Token stays in the env var.

```bash
H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"
BASE="http://localhost:8090"

# Mint once; reuse for the whole run. Run from the TPRM-API checkout (Doppler scope).
cd ~/PromptArmor/TPRM-API
export NMB_BEARER="$(doppler run -- node "$H/harness/api-token.mjs")"   # bare token to stdout
# org for ground-truth scoping:
ORG_ID="$(cd ~/PromptArmor/TPRM-API && doppler run -- node "$H/harness/api-token.mjs" --org)"

# Drive an endpoint (run-scoped unique id keeps mutations self-cleaning):
node "$H/harness/http-client.mjs" --json \
  --method POST --url "$BASE/api/vendor_management/vendors" \
  --body '{"name":"nmb-'"$RUN"'-acme"}' \
  --expect-status 201
# → {ok, status, requestText, responseText, body}  (Authorization redacted in the capture)
```

422 validation case — assert the **custom envelope** `{status_code, message, data}` (not `{detail}`):

```bash
node "$H/harness/http-client.mjs" --json --method POST --url "$BASE/api/vendor_management/vendors" \
  --body '{"name":""}' --expect-status 422
# then check body.status_code / body.message / body.data exist (custom TPRM-API envelope)
```

---

## B — AI-ARG (MOFFITT) request + assert

Single static bearer; no login. Read it from AI-ARG Doppler straight into the env var.

```bash
H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"
BASE="http://localhost:8090"
export NMB_BEARER="$(cd ~/PromptArmor/AI-ARG && doppler run -- printenv VITE_PROMPTARMOR_MOFFITT_KEY)"

node "$H/harness/http-client.mjs" --json \
  --method GET --url "$BASE/api/admin/<endpoint>" --expect-status 200
```

`printenv` keeps the key off the command line; `http-client.mjs` redacts it from the capture.

---

## C — Neon DB read-after-write (ground-truth) — via Neon MCP

The core check: the endpoint returned 2xx, but did the row **persist**? Query the resolved branch
(§1.4 — dev_personal for localhost, `preview-pr-<N>` for preview) with the **Neon MCP `run_sql`**
tool (no connection string handled here). Scope to the same org the request acted as.

Pattern (agent calls the MCP tool, not a shell command):

```
mcp__Neon__run_sql(
  projectId: "round-unit-34763685",          # TPRM-API dev project
  branchId:  "<resolved branch id>",          # dev_personal, or preview-pr-<N>'s id
  sql: "SELECT id, name, org_id, created_at
        FROM vendors
        WHERE name = 'nmb-<RUN>-acme' AND org_id = '<ORG_ID>'"
)
```

Assert: exactly the expected row(s), expected column values, and any **FK/join rows** the write should
produce (e.g. a child `vendor_*` row referencing the new id). A green 2xx with no/incorrect row is a
**FAIL** — that mismatch is what this skill exists to catch. Capture the query + result as `dbCheck`.

Migration gate (§1.5) — confirm the branch is at the PR's head revision before testing:

```
mcp__Neon__run_sql(projectId: "round-unit-34763685", branchId: "<id>",
  sql: "SELECT version_num FROM alembic_version")
# compare to the revision the PR's migration adds
```

---

## D — Async (Hatchet) bounded poll

For a case flagged `asyncTimeout` (the real effect lands via a Hatchet workflow). Get a connection
string for the resolved branch from Neon MCP `get_connection_string`, export it, then poll. A worker
must be running against the target env for the state to appear.

```bash
H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes-backend}"
# NMB_DATABASE_URL from mcp__Neon__get_connection_string(projectId, branchId) — never echo it:
export NMB_DATABASE_URL="<connection string from Neon MCP>"

node "$H/harness/poll-until.mjs" \
  --sql "SELECT id FROM generated_reports WHERE vendor_id = '<id>' AND status = 'complete'" \
  --expect-rows 1 --timeout 60 --interval 3
# exit 0 = state reached (POLL_OK); 2 = POLL_TIMEOUT (mark needs-async-state, capture partial state);
# exit 3 = psql unavailable → poll via Neon MCP run_sql in a bounded loop instead.
```

If `psql` is unavailable (exit 3), fall back to calling Neon MCP `run_sql` (snippet C) in a bounded
loop yourself instead of this helper.

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
