# no-mistakes — per-project config

The no-mistakes skills supply the **method** (drive a change → assert behavior → prove ground-truth one
layer below: read-after-write against the DB). They do **not** hardcode which app, BaaS, auth, or
preview platform to target. Those **targets** live in a per-project config so the same globally
installed skills work across projects on different stacks (Neon, Supabase, PlanetScale, …).

## Where the config lives (resolution order)

1. **`.no-mistakes.json`** found by walking **up** from the current working directory (like `.git`).
   Commit it to the project repo. For a multi-repo product, one config lists every app.
2. Else **`~/.no-mistakes/<project>.json`** — central fallback, where `<project>` is `--project` /
   `$NO_MISTAKES_PROJECT` (default `config`). Use this to keep config out of product repos.

## How the skills consume it

Every skill's step 0 resolves config through the loader and sources the exported env vars the harness
scripts already read:

```bash
H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/<skill>}"
eval "$(node "$H/harness/load-config.mjs" --export)"   # NM_*, PORTER_*, NMF_*, AWS_REGION, …
```

Loader modes: `--export` (shell `export` lines, default), `--json` (normalized config), `--get
<dotpath>`, `--app <name>`, `--app-map` (`slug|service|auth|kind` per app, for preview detection),
`--path` (resolved file). Exits non-zero with a clear message when no config is found or it's invalid.

## Schema

`no-mistakes.schema.json` is the source of truth. Top-level keys:

| Key | Purpose |
|-----|---------|
| `project` / `org` / `repoOwner` / `checkoutBase` | identity + where repos are checked out |
| `db` | the BaaS/DB: `platform`, `projectId`, `localBranch`, `previewBranchPattern` (`{pr}`), `connStringEnv`, `migrations`, `mcp` tool names |
| `preview` | per-PR preview env: `platform`, `apiPort`, `fePort`, platform block (e.g. `porter.project/cluster`) |
| `evidence` | where screenshot/SQL evidence is uploaded (`s3` / `git-branch` / `local` / `cmd`) |
| `auth` | `apiKeyHeader` + named `profiles` (`propelauth` / `bearer-env` / `supabase-jwt` / …) |
| `apps[]` | the deployables: `name`, `kind`, `repo`, `repoPath`, `devUrl`, `devCommand`, `browserProfile`, `auth`, `previewService`, `previewSlug`, `errorEnvelope` |

## Ground-truth adapters (SQL vs non-SQL)

`db.adapter` decides how read-after-write ground-truth is read. It's derived from `db.platform` if
omitted:

| Adapter | Platforms | How the backend skill reads ground-truth |
|---------|-----------|-------------------------------------------|
| `sql` | neon, supabase, planetscale, postgres, mysql | a row via the DB MCP `run_sql` against the resolved branch |
| `convex` | convex | a query function / MCP `runOneoffQuery` / `npx convex data` — assert on returned **documents**, not rows |
| `firestore` | firebase | the document by path via Admin SDK `.doc().get()` / MCP `firestore_get_document` — no DB branching (isolate via separate project or emulator) |

For **Supabase**, read with the service-role / direct-postgres connection — the anon key is RLS-gated
and masks freshly-written rows (false negatives).

## Autodetect & generate (setup wizard)

Don't hand-write the config — generate it. Detection uses a tiered-confidence model (own SDK dep /
dedicated config file = HIGH; ORM dialect + driver or env+host = MED; env/host alone = LOW) and only
auto-picks when exactly one platform is HIGH.

```bash
node ~/.claude/skills/no-mistakes/harness/detect.mjs --cwd .   # see what it detects (JSON)
node ~/.claude/skills/no-mistakes/harness/setup.mjs            # interactive TTY wizard → writes .no-mistakes.json
node ~/.claude/skills/no-mistakes/harness/setup.mjs --yes --preset neon   # non-interactive / CI
```

Or run the **`no-mistakes-setup`** skill in Claude Code and it will detect, ask you about anything
ambiguous, generate the starter, and help fill the placeholders. `setup.mjs` validates before writing
and refuses to overwrite an existing config without `--force` (idempotent).

## Examples

- `examples/promptarmor.no-mistakes.json` — the original PromptArmor setup (Neon + Porter + PropelAuth/
  MOFFITT + S3 evidence), exactly reproducing prior behavior. Drop it in as `.no-mistakes.json` (or
  `~/.no-mistakes/promptarmor.json`) to run against PromptArmor.
- `examples/supabase.no-mistakes.json` — a Supabase + Vercel project (SQL adapter).
- `examples/convex.no-mistakes.json` — a Convex project (non-SQL `convex` adapter), proving the skills
  handle document DBs, not just SQL.

## Adding a new project

1. **Recommended:** run the setup wizard above (or the `no-mistakes-setup` skill) to generate a
   validated starter. Or copy the closest example to `.no-mistakes.json` at your repo root (or
   `~/.no-mistakes/<project>.json`).
2. Fill the placeholders the generator can't know: `db.projectId`, `auth.profiles` (real secret env var
   names + `secretsTool`/`secretsScopeDir`), `apps[].repoPath`/preview service, backend `errorEnvelope`.
3. Verify: `node ~/.claude/skills/no-mistakes/harness/load-config.mjs --export` from inside the project.
