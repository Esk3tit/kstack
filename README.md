# kstack — khai's agent setup

A snapshot of my **Claude Code / Codex** setup, plus the portable, user-authored config so it can be
recreated on any machine. I'm migrating toward a leaner, **Codex-centric** workflow and moving **off
Superpowers and most plugins** — this repo captures what's mine (instructions, skills, commands) and
documents what's third-party (so I know what I'm dropping vs. keeping).

> **No secrets in this repo.** `codex/config.toml.example` is redacted; real tokens live only in
> `~/.codex/config.toml`, Doppler, and the various CLI auth stores.

---

## What lives here (portable, mine)

| Path | What it is |
|------|------------|
| `CLAUDE.md` | Global instructions for Claude Code. **Shared with Codex** via a symlink (below). |
| `commands/` | Custom slash commands (Codex-driven review loops + PR hygiene). |
| `codex-cli/` | The `codex-cli` skill — the reliable `codex exec` recipe these commands depend on. |
| `no-mistakes/` · `no-mistakes-frontend/` · `no-mistakes-backend/` | The verification skill family (router + two specialists). See each `SKILL.md`. |
| `codex/config.toml.example` | My Codex CLI config, **token redacted**. |

---

## 1. Global instructions — one source for both agents

- **Claude Code** reads `~/.claude/CLAUDE.md` (the `CLAUDE.md` in this repo).
- **Codex** reads `~/.codex/AGENTS.md`, which is a **symlink to the same file** — so both agents share
  one instruction set and edits to `CLAUDE.md` apply everywhere:
  ```bash
  ln -s ~/.claude/CLAUDE.md ~/.codex/AGENTS.md
  ```
- Contents (4 sections): **Technical decisions** (quality over dev-cost), **Bug fixes** (reproduce E2E
  first), **Quality bar** (fix what's broken, even if it's not yours; pixel-perfection), **Code
  comments** (sparse by default, no plan/ticket refs).

## 2. Custom slash commands (`commands/`)

All user-authored, plugin-independent (they shell out to `codex` / `gh-axi`, not Superpowers).

| Command | Purpose |
|---------|---------|
| `/codexloop` | Run `codex exec review` on the current PR/branch, fix **real** findings, loop until clean, push on CLEAN. Claude is the human-in-the-loop reviewing Codex's review. |
| `/review-spec` | Iterative Codex⇄Claude review loop over a high-level **spec** markdown; edits in place until it converges. |
| `/review-implementation-plan` | Same loop, for an **implementation plan** markdown. |
| `/address-pr-comments` | Resolve unresolved PR review-bot comments via parallel subagents. `--loop` gates on **code-review bots + lint/test only** — never CI/CD deploys. |
| `/trim-code-comments` | Clean up over-commenting in code just written, per the `CLAUDE.md` comment rules. |

> `/codexloop`, `/review-spec`, `/review-implementation-plan` all defer to the **`codex-cli`** skill
> for the reliable invocation recipe (see below). Key gotcha baked in: `codex exec review` takes **no
> custom prompt** and **ignores `--output-schema`** (emits prose) — only plain `codex exec` honors a
> schema.

## 3. Custom skills (mine)

- **`codex-cli/`** — the source-of-truth recipe for calling `codex exec` reliably (consults, code
  review, web-search research) and avoiding the common failure modes (hangs, empty output, JSONL
  parsing, diff-piping killed by MCP churn). Every command/skill that shells out to Codex follows it.
- **`no-mistakes/` (router) + `no-mistakes-frontend/` + `no-mistakes-backend/`** — agentic verification
  for PromptArmor changes against a running app + Neon DB. The router classifies a request and runs
  frontend-only / backend-only / **fullstack round-trip** (drive a UI action → assert the UI → read the
  Neon preview DB to prove the write persisted). Composes the two specialists' harnesses; posts results
  to the PR(s). Report-only, ephemeral. Built around Porter previews (project 8417 / cluster 3429,
  `ai-arg`/`ai-tprm-v2` frontends + `tprm-api-tprm-api`, Neon `preview-pr-<N>`). Each `SKILL.md` is the
  runtime playbook; `scripts/setup.sh` checks tooling.

Install: copy each dir into `~/.claude/skills/<name>/`.

## 4. Codex CLI setup (`codex/config.toml.example`)

`~/.codex/config.toml` — model `gpt-5.5`, `model_reasoning_effort = "xhigh"`, `[features] multi_agent`.
MCP servers wired into Codex: **Linear** (`mcp.linear.app`), **Neon** (`mcp.neon.tech`, token redacted
in the example), and Codex.app's `node_repl` (computer-use). Auth is ChatGPT-mode (`~/.codex/auth.json`).
Copy `config.toml.example` → `~/.codex/config.toml` and fill in your own tokens.

## 5. Third-party skills (installed in `~/.claude/skills/`, NOT vendored here)

Documented so I know what each provides when deciding keep/drop. Reinstall from their sources.

| Skill | What it does | Keep? |
|-------|--------------|-------|
| `gh-axi` | GitHub via the `gh-axi` CLI (issues, PRs, runs, releases, raw API). | keep — commands lean on it |
| `lavish` | Rich reviewable HTML artifacts via `lavish-axi` CLI (annotate + send feedback). | keep — used for spec review |
| `dev-browser` | Persistent-state browser automation. **Powers the no-mistakes UI driving.** | keep — required by no-mistakes |
| `browser-use` | Browser-Use SDK / library reference. | optional |
| `excalidraw-diagram-generator` | Excalidraw diagrams from NL. | optional |
| `find-skills` | Discover/install agent skills. | optional |
| `langfuse` | Langfuse CLI + docs (traces, prompts, datasets). | keep if using Langfuse |
| `wide-event-logging` | Canonical-log-line / wide-event logging for Python/FastAPI. | reference |

## 6. Plugins & marketplaces — what I'm migrating OFF

Installed (`~/.claude/plugins/installed_plugins.json`). Only **`context-mode`** is in `enabledPlugins`;
the rest are default-on when installed.

| Plugin (marketplace) | Provides | Migration note |
|----------------------|----------|----------------|
| **superpowers-extended-cc** (6.0.4-dev) | `brainstorming`, `writing-plans`, `subagent-driven-development`, `finishing-a-development-branch`, `using-git-worktrees`, `requesting-code-review`, … | **The big drop.** Losing it means losing the brainstorm→spec→plan→subagent pipeline — replicate only the parts I want as plain skills/commands. |
| **context-mode** (1.0.168) | Context-window protection (`ctx_*` tools), session memory, SessionStart guidance. | **Keep** — context-window protection + session memory across compaction. |
| **claude-code-builder** | `/create-skill`, `/create-plugin` (how the no-mistakes skills were scaffolded). | Keep for authoring skills. |
| **claude-code-warp** | `warp`. | Optional. |
| **claude-plugins-official** | `context7` (live docs), `playwright` (MCP browser), `pyright-lsp`, `typescript-lsp`, `sentry`, `linear`. | Keep LSPs + context7 + linear/sentry MCP; playwright is superseded by dev-browser for my use. |

Marketplaces: `superpowers-marketplace`, `superpowers-extended-cc-marketplace`, `claude-code-builder`,
`claude-code-warp`, `claude-plugins-official`, `context-mode`.

## 7. MCP servers

- **Claude Code:** Linear, Neon, Slack, claude_design, context7, playwright, sentry, context-mode.
- **Codex:** Linear + Neon (in `config.toml`) + `node_repl`.

## 8. Tooling (CLIs)

`codex`, `gh` (+ `gh-axi`), `lavish-axi` (npx), `dev-browser` (nvm node v24.10.0), `doppler` (secrets
for all repos), `porter` (preview envs), `neonctl`/`neon` (Neon branches), `aws` (S3 evidence + report
gen), `psql`.

## 9. Hooks

`~/.claude/hooks/context-mode-cache-heal.mjs`, plus SessionStart / PreCompact hooks contributed by
context-mode and superpowers. (Dropping those plugins drops their hooks too.)

## 10. Recreate from scratch

1. `git clone` this repo.
2. `cp CLAUDE.md ~/.claude/CLAUDE.md` and `ln -s ~/.claude/CLAUDE.md ~/.codex/AGENTS.md`.
3. `cp -R commands/* ~/.claude/commands/` and each skill dir → `~/.claude/skills/`.
4. `cp codex/config.toml.example ~/.codex/config.toml` → fill in tokens; `codex login` (ChatGPT mode).
5. Install CLIs: `codex`, `gh` + the `gh-axi`/`lavish-axi` tooling, `dev-browser`, `doppler`, `porter`,
   `neonctl`, `aws`. Authenticate each (`gh auth`, `doppler login`, `porter auth login`, `aws login`,
   `neonctl auth`).
6. Wire MCP servers (Linear, Neon, …) into Claude Code and `~/.codex/config.toml`.
7. (Optional, being phased out) reinstall plugins from their marketplaces.
