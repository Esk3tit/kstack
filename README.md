# kstack — khai's agent setup

A snapshot of my **Claude Code / Codex** setup, plus the portable, user-authored config so it can be
recreated on any machine. I'm migrating toward a leaner, **Codex-centric** workflow and moving **off
Superpowers and most plugins** — this repo captures what's mine (instructions, skills, commands) and
documents what's third-party (so I know what I'm dropping vs. keeping).

> **No secrets in this repo.** `codex/config.toml.example` is redacted; real tokens live only in
> `~/.codex/config.toml`, Doppler, and the various CLI auth stores.

---

## Syncing kstack onto a local install — the human decides what is lost

This applies to every copy, overwrite, re-link, or `cp` from this repo onto a local install, even when
the user asks for it directly: `~/.claude/CLAUDE.md`, `~/.claude/skills/`, `~/.claude/commands/`,
`~/.agents/skills/`, `~/.agents/learning/`, `~/.codex/`. Local copies can hold changes kstack lacks (added sections, edited
skills, extra files), and a blind overwrite deletes them silently.

Before writing anything:

1. **Diff** each target against its kstack source.
2. **Show the user what would be lost.** List it file by file: the lines, sections, or files that
   exist only locally.
3. **Let the user decide** for each item:
   - **Upstream it:** merge the local change into kstack in a PR, so every install gets it.
   - **Keep it local:** bring the kstack changes into the local copy and keep the local change. Tell
     the user their local behavior now differs from kstack.
   - **Overwrite:** discard the local change.
4. **Back up** everything you replace into a dated folder outside this repo, then write.

A target that already matches kstack, is a symlink into this checkout, or does not exist yet has
nothing to lose and needs no prompt.

---

## What lives here (portable, mine)

| Path | What it is |
|------|------------|
| `CLAUDE.md` | Global instructions for Claude Code. **Shared with Codex** via a symlink (below). |
| `cleanup/` | Shared session cleanup and archive-time resource ownership checks. |
| `pr-loop/` | Canonical merge-ready skill; the slash command is an alias. |
| `commands/` | Custom slash commands (Codex-driven review loops + PR hygiene). |
| `no-mistakes/` · `no-mistakes-frontend/` · `no-mistakes-backend/` · `no-mistakes-a11y/` · `no-mistakes-setup/` | The verification skill family (router + three specialists: frontend, backend, deep-a11y) plus the onboarding skill that generates a project's `.no-mistakes.json`. See each `SKILL.md`. |
| `wide-event-logging/` | Skill — canonical-log-line / wide-event logging for Python/FastAPI (with reference modules). |
| `recap-pr/` | Skill — `/recap-pr`: the pre-merge recap of a ticket's PRs from its **decision log** (`LEDGER.md`, `log.sh`): every decision made during hands-off work, a master-vs-branch parity sweep for unintended behavior changes, and anything nobody asked for. `log.sh` also records review passes and checks them against a repo's required passes; `facts.py` writes a PR's facts block from its sources; `session_summary.py` counts what a Claude Code session executed, for retros. Tests: `bash test-*.sh` beside them. |
| `update-mattpocock-skills/` | Skill — `/update-mattpocock-skills`: update the mattpocock skills installed with `npx skills`, check upstream commits and releases for breaking changes, and reapply the local patches you pick (`PATCHES.md`, `patches/`). |
| `explain-code-change/` | Skill — turn a branch, PR, or diff into a layered interactive HTML page: a dense plain-language summary of what and why on top, then diagrams, stepped animations, and a pseudocode diff of every changed function below. |
| `learning/` | Shared learning guide, templates, state/reset tools, and tests used by Matt Pocock's existing skills. Installed as `~/.agents/learning`; it has no independent skill entry point. |
| `codex/config.toml.example` | My Codex CLI config, **token redacted**. |
| `codex/bin/` | `claude-review` (one Claude Opus review round for `/codexloop` in Codex) and `claude-read` (one read-only Claude call), the only Claude entry points Codex runs outside the sandbox. |
| `legacy/` | Retired commands and skills kept for reference, not installed: `/review-spec`, `/review-implementation-plan`, and the `codex-cli` recipe they used. |

---

## 1. Global instructions — one source for both agents

- **Claude Code** reads `~/.claude/CLAUDE.md` (the `CLAUDE.md` in this repo).
- **Codex** reads `~/.codex/AGENTS.md`, which is a **symlink to the same file** — so both agents share
  one instruction set and edits to `CLAUDE.md` apply everywhere:
  ```bash
  ln -s ~/.claude/CLAUDE.md ~/.codex/AGENTS.md
  ```
- This repo's `CLAUDE.md` is the **source of truth**. `~/.claude/CLAUDE.md` is a **copy** that may carry
  machine-local additions that stay out of the repo (e.g. pointers to private local guidance). Make
  shared changes here, then sync them per
  [Syncing kstack onto a local install](#syncing-kstack-onto-a-local-install--the-human-decides-what-is-lost).
- Contents (12 sections): **Writing to me** (plain English for a reader who hasn't seen the code),
  **Acting on your own** (reversible steps without asking; production changes, money and taste calls
  come to me), **Technical decisions** (quality over dev-cost), **Operational work**
  (simplest direct path; no machinery until it's justified), **Bug fixes** (reproduce E2E first),
  **Decision log** (hands-off work logs each decision and user-visible change for `/recap-pr`),
  **Quality bar** (fix what's broken, even if it's not yours; pixel-perfection), **Auto-generated
  files** (never hand-edit; fix the generator), **Code comments** (sparse by default, no plan/ticket
  refs), **Picking the right models** (per-model cost/intelligence/taste table + routing), **Large
  subagent fan-outs** (explain tradeoffs and get approval before swarming), **Browser automation**
  (`agent-browser`: open → `snapshot -i` → act on `@eN` refs → re-snapshot).

## 2. Custom slash commands (`commands/`)

All user-authored, and the same files serve Claude Code and Codex. Reviews come from the other model family: from Claude Code, `/codexloop` drives Codex through the openai-codex plugin; from Codex, it calls Claude Opus 5.5 through `claude -p`. `/address-pr-comments` uses `gh-axi`.

| Command | Purpose |
|---------|---------|
| `/codexloop` | Run an adversarial review from the other model family on the current PR/branch, fix **real** findings, loop until clean, push on CLEAN (under `/pr-loop`, once the repo's required passes allow). One round runs at a time (`log.sh --rounds`), and rejected findings keep their IDs into later rounds. The running agent is the human-in-the-loop reviewing the review. Every finding becomes a decision-log row and the user's settled decisions go to the reviewer as focus. `--until-converged` drops the cap: after a fix the next round reviews only the fix, and the loop ends on a clean round followed by a clean whole-PR round at the same head. |
| `/address-pr-comments` | Resolve open PR review-bot findings, both unresolved threads and review-body items such as CodeRabbit's nitpick and outside-diff sections, through bounded isolated fixers or serial parent edits. **Loops by default** (`--once` for a single pass), gating on **reviewers** — code-review bots + lint/test — never CI/CD deploys. A bot counts as green only once it has reviewed the head. |
| `/pr-loop` | Take a finished branch to merge-ready without check-ins: `/code-review`, `/codexloop` to convergence (cross-family), open the PR(s) on that converged head, bot and CI findings back through the required passes and `/codexloop` with one push per fix cycle, a Fable pass (on every head when the repo's `fable` line stands, else optional), `log.sh --check` gating merge-ready on the repo's required passes, a facts block in each PR description, `/no-mistakes` evidence when the diff changes what renders, affected tests, then `/recap-pr` and a per-PR merge-readiness block. Never merges; once you say it merged, it cleans up, closes the finished issues and reports the deployed commit. |
| `/trim-code-comments` | Clean up over-commenting in code just written, per the `CLAUDE.md` comment rules. |

## 3. Custom skills (mine)

- **`cleanup/`**: inventory session resources, shut down authorized leftovers, preserve worktree artifacts and produce an archive verdict.
- **`pr-loop/`**: the shared finishing workflow; `commands/pr-loop.md` is its alias. `HANDOFF.md` is the common child-brief contract.
- **`update-mattpocock-skills/`** — the only supported way to update the mattpocock skills (`npx skills check -g` applies updates and wipes local edits). `PATCHES.md` lists each local patch in plain words; the skill reads upstream history for breaking changes, judges each patch against the new version (reapply, rewrite or drop), asks which to apply, then rebuilds the patch set. `/pr-loop` and the decision log depend on patches 03 (`/implement` logs decisions) and 04 (`/pr` gains "Behavior changes vs master"); on a new machine, first link the shared `learning/` module from a permanent kstack clone as shown below, then install the mattpocock skills and apply `patches/` in number order.

  Patches **08–10** add project learning to Matt's existing `grilling`, `implement`, and
  `implement-spec` skills. `grill-with-docs` already calls `grilling`, so it uses the same guide.
  Learning starts **off**. Ask to turn it on in ordinary language, for example
  “Use learning mode for this project,” or add that request to `/grill-with-docs` in Claude Code
  (`$grill-with-docs` in Codex). The saved choice survives tasks and new conversations in the same
  checkout; ask to turn it off to return to ordinary development.

  The small entry guide at `~/.agents/learning/LEARNING.md` checks the saved mode. Off-mode
  work loads no other learning references and leaves notes untouched. Active mode loads
  teaching and task-restoration guidance; explicit control and reset requests load their own
  management guide. Privacy instructions load before learning-note writes. Project notes live in **`.learning/`**: `profile.md` stores
  preferences, `progress.md` records demonstrated reasoning and task-specific pending decisions,
  and `project-map.md` links to canonical design documents. New checkouts have separate notes.
  The skills load state when invoked; no automatic startup hook is registered. For untracked notes, a local ignore
  file excludes them from ordinary Git staging. Already tracked private notes must be removed from
  the index or explicitly allowed for tracking before learning can write them.

  Ask grilling to reset learning for a preview and explicit confirmation. The helper backs up
  the three notes and preserves the saved on/off and tracking choices. The adapted Vibe Wise
  helpers, MIT notice, source revision, and regression tests live directly in `learning/`.
  Verify the installed helpers with:

  ```bash
  python3 -B -m unittest discover -s ~/.agents/learning/tests -v
  ```

  Claude Code's `~/.claude/skills/<name>` links point at these same shared skill directories;
  both agents use the same implementation and learning store. From the permanent kstack clone, not a temporary worktree, install
  the shared module before applying its skill patches:

  ```bash
  mkdir -p ~/.agents
  ln -s "$PWD/learning" ~/.agents/learning
  ```

  On a fresh Matt skill installation, apply patches in number order using each patch's named
  target skill. For this extension, apply 08 to `grilling`, 09 to `implement` after 01/03/05,
  and 10 to `implement-spec` after 02. The command form is listed in `PATCHES.md`.
  `update-mattpocock-skills` preserves those installed patches during subsequent updates;
  it does not apply missing patches to a fresh install that already matches upstream.
- **`recap-pr/`** — `/recap-pr`, the pre-merge audit of hands-off work. `LEDGER.md` defines the **decision log** every hands-off step writes (one TSV per ticket in `~/.local/share/recap/`, never committed) and the mechanism rule; `log.sh` appends rows, prints the user's settled decisions for the reviewer, records review passes and checks them against a repo's required passes, and keeps `/codexloop`'s rounds in order; `facts.py` writes a PR's facts block, and `session_summary.py` counts a session's executed calls for retros. `/recap-pr` backfills the log from commits, findings and transcripts, compares master and the branch on the same real inputs to catch behavior changes nobody decided, gets a second opinion from another model family, and renders the recap as a calm HTML page: `render.py` puts `recap.json` (fields in `RECAP-DATA.md`) into the `recap.html` template.
- **`no-mistakes/` (router) + `no-mistakes-frontend/` + `no-mistakes-backend/` + `no-mistakes-a11y/`** — agentic verification
  for app changes against a running app + its database. The router classifies a request and runs
  frontend-only / backend-only / **fullstack round-trip** (drive a UI action → assert the UI → read the
  preview DB to prove the write persisted), and offers the opt-in **deep-a11y** pass (keyboard
  operability / focus / 320px reflow, emitting its own `NOMISTAKES_A11Y_STATUS`). Composes the
  specialists' harnesses; posts results to the PR(s). Report-only, ephemeral. **Platform-agnostic:** the
  skill is the *method*; all *targets* (apps, org, BaaS/DB, auth, preview platform) come from a
  per-project **`.no-mistakes.json`** resolved at runtime (`harness/load-config.mjs` — walk up from CWD,
  else `~/.no-mistakes/<project>.json`); no config → `BLOCKED reason=needs-config`. Schema, docs, and
  examples live in `no-mistakes/config/` — `examples/promptarmor.no-mistakes.json` reproduces the
  original PromptArmor setup (Neon project `round-unit-34763685`, Porter project 8417 / cluster 3429,
  PropelAuth/MOFFITT), `examples/supabase.no-mistakes.json` proves multi-BaaS generality.
  Each `SKILL.md` is the runtime playbook; `scripts/setup.sh` checks tooling. Each poster
  (`post-evidence.mjs`, `post-results.mjs`, `post-fullstack.mjs`) takes a run id and, with
  `--print-command`, prints the plain command that posts that run plus the allow rule that approves
  it, e.g. `Bash(node /Users/<you>/.claude/skills/no-mistakes-frontend/harness/post-evidence.mjs:*)`.
  Add those rules to `~/.claude/settings.json` so a hands-off run posts without a prompt; Claude Code
  matches rules against the command as text and never approves one holding a shell variable. A rule
  approves the poster with any arguments, so an agent can then post content it chose to any PR your
  `gh` login reaches, without asking. A plugin install's path changes with each version, so its rule
  needs redoing after an update. The backend poster posts only once it has loaded the project's
  config, which names the API-key header to redact; otherwise it keeps `summary.md` locally. After
  changing a poster, the loader or a skill's loader line, run
  `node --test no-mistakes/harness/test-posters.mjs`.

- **`wide-event-logging/`** — implement wide event logging (canonical log lines) in Python/FastAPI:
  `SKILL.md` + reference modules (`config.py`, `context.py`, `middleware.py`, `security.py`, `usage.py`)
  for TPRM-API observability.
- **`explain-code-change/`** — explain a code change as a layered standalone HTML report (own light/dark design, opened in the browser). Layer 1
  fits one screen: what the change does, why, the approach, the alternatives it beat, the risk, and
  the merge status, in plain words with real examples and no analogies. Layers 2 and 3 open on
  demand: the system before the change, the smallest real example animated through the old and new
  paths, edge cases, a per-symbol walkthrough, and test evidence with local-vs-external merge gates.
  Bar: the first screen alone is enough to judge whether the approach is sound.

Install shared skills once under `~/.agents/skills/<name>/`, then link them into Claude Code:

```bash
mkdir -p ~/.agents/skills ~/.claude/skills
ln -s /path/to/kstack/explain-code-change ~/.agents/skills/explain-code-change
ln -s ../../.agents/skills/explain-code-change ~/.claude/skills/explain-code-change
```

Codex in this setup discovers `~/.agents/skills` directly. For Codex installations that only scan
`~/.codex/skills`, link the same source there:

```bash
mkdir -p ~/.codex/skills
ln -s ../../.agents/skills/explain-code-change ~/.codex/skills/explain-code-change
```

For the no-mistakes family, generate each target project's `.no-mistakes.json` with the onboarding
wizard — run the **`no-mistakes-setup`** skill in Claude Code, or
`node ~/.claude/skills/no-mistakes/harness/setup.mjs` (interactive) /
`… setup.mjs --yes --preset <neon|supabase|convex|…>` (CI). It autodetects the stack (DB/BaaS, framework,
package manager, git remote), picks the right ground-truth adapter (`sql`/`convex`/`firestore`), and
writes a validated starter; verify with `… load-config.mjs --export` from inside the project.

## 4. Codex CLI setup (`codex/config.toml.example`)

`~/.codex/config.toml` — no `model` line, so Codex always runs its newest default model;
`model_reasoning_effort = "xhigh"`, `[features] multi_agent`.
MCP servers wired into Codex: **Linear** (`mcp.linear.app`), **Neon** (`mcp.neon.tech`, token redacted
in the example), and Codex.app's `node_repl` (computer-use). Auth is ChatGPT-mode (`~/.codex/auth.json`).
Copy `config.toml.example` → `~/.codex/config.toml` and fill in your own tokens.

## 5. Third-party skills (installed in `~/.claude/skills/`, NOT vendored here)

Documented so I know what each provides when deciding keep/drop. Reinstall from their sources.

| Skill | What it does | Keep? |
|-------|--------------|-------|
| `gh-axi` | GitHub via the `gh-axi` CLI (issues, PRs, runs, releases, raw API). | keep — commands lean on it |
| `lavish` | Rich reviewable HTML artifacts via `lavish-axi` CLI (annotate + send feedback). | keep |
| `agent-browser` | Discovery stub from [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser/tree/main/skills/agent-browser); points agents at `agent-browser skills get core`. The only browser driver. | keep — required by no-mistakes |
| `browser-use` | Browser-Use SDK / library reference. | optional |
| `excalidraw-diagram-generator` | Excalidraw diagrams from NL. | optional |
| `find-skills` | Discover/install agent skills. | optional |
| `langfuse` | Langfuse CLI + docs (traces, prompts, datasets). | keep if using Langfuse |

(`wide-event-logging` was moved into this repo — see **Custom skills** above.)

## 6. Plugins & marketplaces — what I'm migrating OFF

Installed (`~/.claude/plugins/installed_plugins.json`). Only **`context-mode`** is in `enabledPlugins`;
the rest are default-on when installed.

| Plugin (marketplace) | Provides | Migration note |
|----------------------|----------|----------------|
| **superpowers-extended-cc** (6.0.4-dev) | `brainstorming`, `writing-plans`, `subagent-driven-development`, `finishing-a-development-branch`, `using-git-worktrees`, `requesting-code-review`, … | **The big drop.** Losing it means losing the brainstorm→spec→plan→subagent pipeline — replicate only the parts I want as plain skills/commands. |
| **context-mode** (1.0.168) | Context-window protection (`ctx_*` tools), session memory, SessionStart guidance. | **Keep** — context-window protection + session memory across compaction. |
| **claude-code-builder** | `/create-skill`, `/create-plugin` (how the no-mistakes skills were scaffolded). | Keep for authoring skills. |
| **claude-code-warp** | `warp`. | Optional. |
| **claude-plugins-official** | `context7` (live docs), `playwright` (MCP browser), `pyright-lsp`, `typescript-lsp`, `sentry`, `linear`. | Keep LSPs + context7 + linear/sentry MCP; playwright is superseded by agent-browser for my use. |

Marketplaces: `superpowers-marketplace`, `superpowers-extended-cc-marketplace`, `claude-code-builder`,
`claude-code-warp`, `claude-plugins-official`, `context-mode`.

## 7. MCP servers

- **Claude Code:** Linear, Neon, Slack, claude_design, context7, playwright, sentry, context-mode.
- **Codex:** Linear + Neon (in `config.toml`) + `node_repl`.

## 8. Tooling (CLIs)

`codex`, `gh` >= 2.99 (+ `gh-axi`; `--attach` posts no-mistakes screenshots and clips), `lavish-axi` (npx),
`agent-browser` (drives no-mistakes; `agent-browser install` for its Chrome) + `ffmpeg` (clips), `doppler` (secrets
for all repos), `porter` (preview envs), `neonctl`/`neon` (Neon branches), `aws` (report gen), `psql`.

## 9. Hooks

`~/.claude/hooks/context-mode-cache-heal.mjs`, plus SessionStart / PreCompact hooks contributed by
context-mode and superpowers. (Dropping those plugins drops their hooks too.)

## 10. Recreate from scratch

1. `git clone` this repo.
2. `cp CLAUDE.md ~/.claude/CLAUDE.md` and `ln -s ~/.claude/CLAUDE.md ~/.codex/AGENTS.md`.
3. Link each command into both agents (`mkdir -p ~/.claude/commands ~/.codex/prompts`, then `ln -s "$PWD"/commands/<name>.md` into each), applying the sync rule above to any target that already exists. For Codex's cross-family reviews, copy `codex/bin/claude-review` and `codex/bin/claude-read` into `~/.codex/bin/` and allow only those two outside the sandbox: `mkdir -p ~/.codex/bin ~/.codex/rules ~/.local/share/recap && install -m 755 codex/bin/claude-review codex/bin/claude-read ~/.codex/bin/ && for s in claude-review claude-read; do printf 'prefix_rule(pattern=["%s/.codex/bin/%s"], decision="allow")\n' "$HOME" $s; done >> ~/.codex/rules/default.rules` (skip a rule the file already has). Copies, never links: a link into this checkout would let a Codex edit in the checkout run unsandboxed; re-copy under the sync rule after changing them. A rule on bare `claude -p` would let any Claude call, with any tools, run unsandboxed. Codex's sandbox keeps `.git` read-only, so a hands-off `/codexloop` in Codex also needs `git fetch`, `git add`, `git commit`, `git push` and `gh pr` allowed the same way (`for c in fetch add commit push; do printf 'prefix_rule(pattern=["git", "%s"], decision="allow")\n' $c; done >> ~/.codex/rules/default.rules`; `/pr-loop` adds `gh api graphql` and `gh-axi`). Keep those rules to the subcommands: a bare `gh` rule also runs aliases and extensions. An allowed `git commit`/`git push` runs the repo's tracked hooks (pre-commit, husky, lefthook) unsandboxed, which the sandboxed agent can edit; that is the price of a hands-off loop; without those rules Codex asks before each commit and push. The wrappers' guarantees also assume no Codex workspace or writable root contains `$HOME`, since the sandbox could then edit `~/.claude/settings.json`. The decision log also needs `~/.local/share/recap` in `[sandbox_workspace_write] writable_roots` (see `codex/config.toml.example`). Link each shared skill dir into
   `~/.agents/skills/` and then into `~/.claude/skills/` (plus `~/.codex/skills/` when that Codex
   installation does not scan `~/.agents/skills/`).
4. From the permanent kstack clone (not a temporary worktree), link `learning/` into `~/.agents/learning` with the command above before applying Matt skill patches 08–10. Verify with `python3 -B -m unittest discover -s ~/.agents/learning/tests -v`. This shared module is a plain reference directory, so it is not covered by the skill-directory links in step 3.
5. `cp codex/config.toml.example ~/.codex/config.toml` → fill in tokens; `codex login` (ChatGPT mode).
6. Install CLIs: `codex`, `gh` + the `gh-axi`/`lavish-axi` tooling, `agent-browser`, `ffmpeg`, `doppler`, `porter`,
   `neonctl`, `aws`. Authenticate each (`gh auth`, `doppler login`, `porter auth login`, `aws login`,
   `neonctl auth`).
7. Wire MCP servers (Linear, Neon, …) into Claude Code and `~/.codex/config.toml`.
8. (Optional, being phased out) reinstall plugins from their marketplaces.
