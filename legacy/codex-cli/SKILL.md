---
name: codex-cli
user-invocable: true
description: Invoke the OpenAI Codex CLI (`codex exec`) reliably for non-interactive consults, second opinions, code review, and web-search-backed research. ALWAYS use this skill whenever Codex or the Codex CLI is mentioned or about to be shelled out to — and whenever any other skill or command that drives Codex is invoked (e.g. `/codexloop`, `/review-spec`, `/review-implementation-plan`, or anything calling `codex exec`/`codex exec review`). It is the source of truth for the reliable invocation recipe and avoids the common failure modes (hangs, empty output, JSONL parsing, diff-piping killed by MCP churn). Triggers: "consult codex", "ask codex", "codex review", "codex CLI", "second opinion from codex", any `codex exec` invocation.
metadata:
  category: tooling
---

# Codex CLI

## Overview

`codex exec` runs the Codex CLI non-interactively: pass a prompt, it runs to completion and prints the final answer. This skill encodes the **reliable** way to call it and the gotchas that cause hangs / empty output / flaky parsing.

## When to Use

- Getting a second opinion or design critique from Codex from the shell.
- Codex-driven code review or spec/plan review loops.
- Research where Codex should use its web-search tool.
- Any time a slash command or script shells out to `codex`.

The point is **model diversity** — Codex (a GPT model) shares none of Claude's blind spots, so it catches a different class of issues and produces genuinely different ideas. Let Codex use its **own configured default model** (the latest state-of-the-art GPT) and ChatGPT-mode auth — **never pin a version or pass `--model` unless the caller explicitly asks.**

## Preflight & availability

1. `command -v codex` must succeed — else report unavailable and stop.
2. If a codex call errors on auth/network, treat it as **unavailable, not a hard failure**: callers should skip the Codex voice and note it (e.g. emit `CODEX_STATUS=UNAVAILABLE reason=<short>`) rather than aborting the whole task.
3. **Review mode is read-only** — `codex exec review` reports findings; it never edits, commits, or pushes. Acting on findings is the caller's job.

## The canonical recipe

```bash
codex exec --skip-git-repo-check \
  -o /tmp/codex-answer.md \
  "YOUR PROMPT HERE" \
  < /dev/null 2>/dev/null
# then read /tmp/codex-answer.md  → just the final agent message, clean
```

That's the safe default. Add flags from the table below as needed.

## Flag reference

| Need | Flag |
|---|---|
| **Review code changes in a repo** | `codex exec review --base <branch>` / `--uncommitted` / `--commit <sha>` — gathers the diff from git **itself**; pass NO diff. Reliable (piping big diffs via stdin gets killed by MCP churn). **Caveats (verified 0.142.0):** the target selectors are mutually exclusive with a custom PROMPT — passing both hard-errors (`'--base' cannot be used with '[PROMPT]'`); and `review` **ignores `--output-schema`/`--json`**, writing a **prose** review to `-o`. So: no steering prompt, and parse the prose (don't `JSON.parse`). For structured JSON, use plain `codex exec` + piped doc instead. |
| Run outside a trusted git repo | `--skip-git-repo-check` (else hard error) |
| **Clean final answer to a file** | `-o <file>` / `--output-last-message <file>` |
| **Structured JSON findings (plain `exec` + piped doc)** | `--output-schema <schema.json>` **+** `-o <file>` — the `-o` file is then valid schema-conforming JSON, no fences, no JSONL. Right for the **piped-document** review loops (`/review-spec`, `/review-implementation-plan`). **Honored only by plain `codex exec`, NOT by `codex exec review`** (which emits prose) — so `/codexloop`, which uses the `review` subcommand, reads prose, not JSON. |
| Live event stream (rarely needed) | `--json` (JSONL: `thread.started`, `item.completed` agent_message, `turn.completed`…). Only when you need *progress events*; NOT for getting the final answer — see Gotcha 2. |
| **Web search tool** | `-c tools.web_search=true` |
| **Fast mode** | `--enable fast_mode` (== `-c features.fast_mode=true`; there is no `--fast`). Works as a **global flag** (`codex --enable fast_mode exec …`) *or* an `exec` flag (`codex exec --enable fast_mode …`) — both valid. |
| Pick model | `-m <model>` / `--model` |
| Don't load `~/.codex/config.toml` | `--ignore-user-config` |
| Don't load `.rules` execpolicy | `--ignore-rules` |
| Don't persist session files | `--ephemeral` |
| Set working dir | `-C <dir>` / `--cd <dir>` |
| Allow writes (default read-only) | `--sandbox workspace-write` (or `danger-full-access` in isolated envs) |
| Prompt from stdin explicitly | `codex exec -` |

Confirm flags on this machine with `codex exec --help` and feature names with `codex features list`.

## Gotchas (these caused real failures)

1. **Always `< /dev/null`.** If you neither pass a prompt arg nor close stdin, Codex prints `Reading additional input from stdin…` and **blocks forever** waiting for EOF (especially when launched in the background). Closing stdin fixes it. If you *want* to pipe context, use `cmd | codex exec "instruction"` (the arg is the instruction, stdin is appended as a `<stdin>` block) or `codex exec -`.

2. **Don't parse stdout, and don't use `--json` to get the answer.** By default Codex streams progress to **stderr** and prints **only the final agent message to stdout**. So `codex exec "…" 2>/dev/null` gives a clean answer; no need for `sed`/JSONL extraction. For scripts prefer `-o <file>`.
   - **For structured JSON findings (the review-loop commands), use `--output-schema <schema.json>` + `-o <file>` — NEVER `--json`.** The `-o` file then contains JSON that already conforms to the schema: read it and `JSON.parse` directly. No fence-stripping, no double-parse.
   - **Anti-pattern that caused real flakiness:** `codex … --json "…" > out.json` then hand-extracting the last `item.completed` → `agent_message.text` event, stripping markdown fences, and parsing the escaped JSON string inside. This is fragile (escaping, multi-line, interleaved events) and floods context. `--json` is *only* for when you genuinely want the progress event stream — not the final answer.

3. **Foreground vs background / cwd reset.** A long `codex` call may be auto-backgrounded by the harness, and a `cd /tmp && codex …` resets the shell's cwd to the repo root afterward. **`cd` back into your worktree** before subsequent `git`/`pytest`, or you'll operate on the wrong tree. Verify the branch (`git rev-parse --abbrev-ref HEAD`) before committing.

4. **Skill auto-read is benign.** `--ignore-rules`/`--ignore-user-config` do **not** stop the Codex superpowers plugin from auto-reading skill files at session start (you'll see "reading the Superpowers instruction first"). It still answers correctly. To fully suppress it you'd disable that plugin in `~/.codex`. Using `-o` means you only see the clean final message regardless.

5. **Reasoning is slow.** Default reasoning effort is high (`xhigh`); big inputs + web search can take minutes. Set a generous timeout. `--enable fast_mode` trades fidelity for speed.

## Patterns

**Prose consult / second opinion:**
```bash
codex exec --skip-git-repo-check -o /tmp/ans.md \
  "Design question, answer in prose: <context + question>" < /dev/null 2>/dev/null
```

**Review / review-loop returning strict JSON findings (piped document, plain `exec`)** — the recipe `/review-spec` and `/review-implementation-plan` should use (they review a *document* via stdin). NOT `/codexloop`, which reviews a repo *branch* via `codex exec review` and so reads prose, not JSON (see that subcommand's caveats above). Write a JSON Schema once, pass `--output-schema` + `-o`, then read the `-o` file as plain JSON. Pipe the document under review via stdin (Codex appends it as a `<stdin>` block; piping closes stdin so no hang):
```bash
# 1. Write the schema once (additionalProperties:false makes Codex fill every field)
cat > /tmp/review-schema.json <<'EOF'
{
  "type": "object",
  "additionalProperties": false,
  "required": ["findings", "summary"],
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["severity", "file", "line", "issue", "suggested_fix"],
        "properties": {
          "severity": {"type": "string", "enum": ["high", "medium", "low"]},
          "file": {"type": "string"},
          "line": {"type": "integer"},
          "issue": {"type": "string"},
          "suggested_fix": {"type": "string"}
        }
      }
    },
    "summary": {"type": "string"}
  }
}
EOF

# 2. Invoke: --output-schema + -o, NOT --json. Document piped on stdin.
codex exec --skip-git-repo-check ${MODEL:+--model "$MODEL"} \
  --output-schema /tmp/review-schema.json \
  -o /tmp/review.json \
  "Review the document in the <stdin> block. Return findings per the enforced schema; empty findings array if clean." \
  < /tmp/diff.patch 2>/dev/null

# 3. /tmp/review.json is schema-conforming JSON — read and JSON.parse directly. No fences, no JSONL.
```
Fast variant: add `--enable fast_mode`. Fail closed if `/tmp/review.json` is missing or unparseable (treat as a Codex error, not "clean").

**Code review of a repo change (reliable — no diff piping)** — `codex exec review` builds the diff from git itself, so it survives MCP-reconnect churn that kills large piped diffs. It takes **no custom prompt** (the target selector is mutually exclusive with `[PROMPT]`) and **ignores `--output-schema`** — it writes a **prose** review to `-o`. So capture the prose and read it (don't `JSON.parse`); apply your own review scope when filtering findings:
```bash
codex exec review --base origin/master -o /tmp/review.txt < /dev/null 2>/tmp/review.err
# swap --base origin/master for --uncommitted (working-tree changes) or --commit <sha>
# /tmp/review.txt is human-readable: a summary + a `Full review comments:` list of
# `- [P1|P2|P3] <title> — <file>:<line>` bullets. No prompt, no schema-JSON on this subcommand.
# Need strict JSON instead? Use plain `codex exec` + a piped diff + --output-schema (above).
```

**Web-search-backed research:**
```bash
codex exec --skip-git-repo-check -c tools.web_search=true -o /tmp/research.md \
  "Use web_search to research <topic>; answer ~400 words and cite the URLs you used." \
  < /dev/null 2>/dev/null
```

**Fast iteration (lower fidelity):**
```bash
codex exec --enable fast_mode --skip-git-repo-check -o /tmp/ans.md "<prompt>" < /dev/null 2>/dev/null
```

**Structured output to JSON:**
```bash
codex exec --skip-git-repo-check --output-schema /tmp/schema.json -o /tmp/out.json "<extract task>" < /dev/null 2>/dev/null
```
