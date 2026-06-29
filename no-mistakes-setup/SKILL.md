---
name: no-mistakes-setup
description: >-
  Onboard the no-mistakes verification skills to a project by generating its .no-mistakes.json: detect
  the tech stack (DB/BaaS — Neon, Convex, Supabase, PlanetScale, Firebase, Postgres, MySQL — plus
  framework, package manager, monorepo, git remote), or let the user choose from a list, then write a
  validated starter config with the right ground-truth adapter (sql / convex / firestore). Idempotent.
  Use for "set up no-mistakes", "configure no-mistakes for this project", "onboard the verification
  skill", "create a .no-mistakes.json", "what stack does no-mistakes think this is".
user-invocable: true
---

# no-mistakes-setup — generate a project's `.no-mistakes.json`

The no-mistakes skills are project-agnostic: they read TARGETS from a per-project `.no-mistakes.json`
(see `no-mistakes/config/README.md`). This skill creates that file — by autodetecting the stack or
letting the user pick — so the verification skills can run.

Two ways to run, same scripts:
- **Human, in a terminal:** `node ~/.claude/skills/no-mistakes/harness/setup.mjs` — an interactive
  TTY wizard (detect → prompt → write).
- **Agent (you), in this skill:** you can't drive a TTY, so detect with `detect.mjs`, resolve choices
  with the user via questions, then generate non-interactively with `setup.mjs --yes` + flags.

## 0. Resolve the scripts

The setup scripts live in the **router** skill (installed as a family):

```bash
NM="$HOME/.claude/skills/no-mistakes/harness"   # detect.mjs, presets.mjs, setup.mjs, load-config.mjs
command -v node >/dev/null || { echo "needs node"; exit 1; }
[ -f "$NM/setup.mjs" ] || { echo "no-mistakes router skill not installed at $NM"; exit 1; }
```

## 1. Detect the stack

```bash
node "$NM/detect.mjs" --cwd "$PWD"
```

Read the JSON. Key fields: `db` (`{platform, level, why, confident}`), `candidates[]`, `framework`,
`packageManager`, `monorepo`, `git` (`{owner, repo, slug}`), `projectName`, `envKeysSeen`. Show the
user a 3–5 line summary of what was detected.

## 2. Resolve the platform (gate)

- **`db.confident === true`** (exactly one HIGH signal): confirm with the user ("Detected Neon —
  use it?"). On yes, proceed.
- **Ambiguous** (≥2 HIGH candidates, e.g. Supabase-auth + Neon-DB) **or low confidence**: present the
  candidates and the full list (Neon, Supabase, PlanetScale, Convex, Firebase, Postgres, MySQL) and ask
  the user to choose. Never guess silently.
- The platform decides the **ground-truth adapter**: `sql` (Neon/Supabase/PlanetScale/Postgres/MySQL)
  vs `convex` vs `firestore`. Convex and Firestore are **non-SQL** — flag that to the user (the backend
  verification reads documents/functions, not SQL rows).

## 3. Gather identity + apps

Prefill from detection (`projectName`, `git.owner` → org/repoOwner, `git.slug` → app `repo`, framework
→ a frontend app + `devUrl`). Ask the user only for what's missing or ambiguous: project id, whether
there's a **separate backend API** to verify (and its base URL), and the **preview platform** (Porter /
Vercel / none) if they use per-PR previews. In a monorepo, confirm which package(s) are the apps.

## 4. Generate

Run non-interactively with flags (pass `--force` only after the user okays overwriting an existing
file):

```bash
node "$NM/setup.mjs" --cwd "$PWD" --yes \
  --preset <platform> --project <id> [--org <o>] [--repo-owner <o>] [--checkout-base <dir>] \
  [--output <path> | --central] [--force]
```

`--central` writes `~/.no-mistakes/<project>.json` instead of `<cwd>/.no-mistakes.json` (use when the
config shouldn't live in the product repo). `setup.mjs` validates before writing and refuses to
clobber an existing file without `--force`.

## 5. Fill the placeholders (the part detection can't know)

`setup.mjs` writes a **starter**. Open the file and complete, with the user, what can't be detected:

- **`db.projectId`** (Neon project id, Supabase project ref, etc.) and, for SQL, the `localBranch` /
  `previewBranchPattern` if they differ from the preset.
- **`auth.profiles`**: the real secret env var names, `secretsTool` (doppler/dotenv/env),
  `secretsScopeDir`, and for SQL platforms how a token is minted. For **Supabase**, ensure ground-truth
  reads use the **service-role / direct-postgres** path — the anon key is RLS-gated and masks
  freshly-written rows (false negatives).
- **`apps[]`**: `repoPath` (or rely on `checkoutBase`), `previewService`/`previewSlug` for the preview
  platform, backend `errorEnvelope`.
- **Non-SQL** (`adapter: convex|firestore`): confirm the read recipe — Convex `convex.runCmd` /
  preview deployment name; Firestore `credsEnv` + `isolation` (separate-project vs emulator).

Edit the JSON with the normal file tools (it's a starter you co-own with the user), not by re-running
`setup.mjs` (that regenerates from scratch).

## 6. Validate

```bash
( cd "$PWD" && node "$NM/load-config.mjs" --export )   # must exit 0 and emit NM_* exports
```

Fix any reported errors. Then the project is ready — invoke the **`no-mistakes`** skill on a change/PR.

## Rules

- **Report + confirm, never silently pick** an ambiguous platform.
- **Idempotent:** detect an existing `.no-mistakes.json`; overwrite only with explicit user consent
  (`--force`), else leave it and offer to edit in place.
- **Starter, not final:** generated config has placeholders the user must fill; surface them, don't
  pretend the file is complete.
- **No secrets in the config** — only env var *names*, never values.
