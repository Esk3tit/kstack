# Global instructions

## Technical decisions

When making technical decisions, give no weight to development cost or engineering effort by default. **Quality, simplicity, robustness, scalability, and long-term maintainability are the decisive factors** in any technical decision. Give cost/effort weight only when the user signals urgency, and even then very little — never more than that urgency clearly warrants.

## Operational work — simplest direct path first

For one-off or infrequent operational work, start with the **simplest direct end-to-end path**. Do not build wrappers, control planes, policy layers, custom verifiers, or automation unless the direct path exposes a concrete blocker or a repeated need that justifies the added machinery.

This is not a cost argument and does not soften the section above — effort is still not a factor. Unneeded machinery is *worse* on the axes that decide: it adds surface to maintain, more places to be wrong, and indirection between you and the thing you were actually asked to do. Build it when the direct path proves it's needed, not in anticipation.

## Bug fixes

When doing bug fixes, always start with reproducing the bug in an E2E setting as closely aligned with how an end user would experience it as possible. This makes sure you find the real problem so your fix will actually solve it.

## Decision log

Work you do while the user is not watching (implementation, review loops, PR comments, E2E fixes) logs each decision, and each change to what users see compared with master, in the ticket's decision log: format in `~/.claude/skills/recap-pr/LEDGER.md`. The user audits it with `/recap-pr` before merge.

## Quality bar — fix what's broken, even if it's not yours

When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel perfection. If something clearly looks off, even if it is not directly related to what you are doing, try to get it fixed along the way.

Apply that same high standard to engineering excellence: lint, test failures, and test flakiness. If you see one, even if it is not caused by what you are working on right now, still get it fixed.

## Auto-generated files — never hand-edit

Never manually modify `CHANGELOG.md` files, or any file marked as auto-generated. If the content is wrong, fix the generator or the source it reads, then regenerate — a hand-edit is silently reverted on the next run and shows up as noise in the diff.

Look for the signals before editing any file you did not write: a `@generated` / "DO NOT EDIT" header, a `.lock` extension, or the file being listed as generated output in the repo's docs or build config.

## Code comments — sparse by default

Default to **NO comments**. Well-named identifiers explain WHAT. Only add a comment when WHY is non-obvious from reading the code: a hidden constraint, subtle invariant, workaround for a specific bug, surprising behavior.

When a comment IS needed:
- Inline and block comments beside code should be **1 concise line** when possible,
  with a **maximum of 2 lines**.
- Module and function docstrings may exceed 2 lines when needed to document their
  interface, behavior, invariants, or failure modes.
- No narrative comment blocks or comment section headers.
- No explaining what the code already shows ("// loop through users", "// set the value").
- **NEVER reference phases, tasks, plan steps, Linear issues, ticket IDs, PR numbers, iteration numbers, or code-review findings in comments.** Examples to avoid: `// Phase 2`, `// Step 4`, `// PRO-1158`, `// PR #1234`, `// per code review`, `// addressed in iteration 3`, `// fix for issue X`. These belong in the commit message and rot fast — they look dirty in the codebase.
- No "// removed X" or "// changed Y" markers — git diff already shows that.

If removing the comment wouldn't confuse a future reader, don't write it.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI has really generous limits), not list price. Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model | cost | intelligence | taste |
|---|---|---|---|
| gpt-6.1-sol (high reasoning) | 10 | 8 | 6 |
| sonnet-5 | 3 | 5 | 7 |
| opus-5.5 | 6 | 7 | 8 |
| fable-5.1 | 3 | 9 | 9 |

How to apply:
- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost should never block using the right model for the job. Lean on the cheaper and faster options to explore widely — gather information, prototype, spike, and run competing hypotheses in parallel — then, once you've settled on the best approach empirically and through a data-driven read of the results, move the finalized work onto the stronger, more expensive model. When the axes genuinely conflict for anything that ships, intelligence > taste > cost.
- Bulk/mechanical work (clear-spec implementation, data analysis, migrations): gpt-6.1-sol (high reasoning) - it's very cheap and token efficent.
- Anything user-facing (UI, copy, API design) needs taste ≥ 7.
- Reviews of plans/implementations: opus-5.5, optionally gpt-6.1-sol (high reasoning) as an extra independent perspective.
- Never spawn fable-5.1 subagents unless I ask for them or approve it first; Fable reviews happen when I request them.
- Never use Haiku.
- Mechanics: gpt-6.1-sol (high reasoning) is handled natively via the `openai/codex-plugin-cc` plugin inside Claude Code, which reads your user-level `~/.codex/config.toml`. That config sets no default model, so pass `--model gpt-6.1-sol` on every Codex call (`/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, or the companion's `review` / `adversarial-review` / `task`); without it Codex runs its own default model. Avoid writing custom bash scripts; instead, utilize the plugin's built-in tools and skills:
    - `/codex:review` - Run non-destructive, read-only code quality assessments. Supports `--base <ref>` for branch analysis.
    - `/codex:adversarial-review` - Perform a skeptical design review to pressure-test tradeoffs, auth, and reliability. Append custom focus text at the end of the command to steer the focus.
    - `/codex:rescue` - Subcontract active debugging, multi-file refactoring, or implementation loops to Codex when a second pass is required.
    - `/codex:status` / `/codex:result` / `/codex:cancel` - Use these to check, fetch, or abort asynchronous jobs when using the `--background` flag on heavy tasks.
- Claude models (sonnet-5, opus-5.5, fable-5.1) run via the Agent/Workflow model parameter.

Using gpt-6.1-sol (high reasoning) inside workflows and subagents:
- Subagents and automated workflows should call the plugin's native slash commands or its exposed `codex-cli-runtime` skills to delegate tasks directly, omitting the need for raw terminal wrappers.
- **Always run long Codex work in the background.** Any Codex job that could plausibly run more than a few minutes must use the plugin's background path (`/codex:review --background`, `/codex:adversarial-review --background`, or `task --background` behind `/codex:rescue`), which spawns a detached worker that survives past Bash's ~10-minute timeout. A synchronous run that trips that timeout tears the call down and we lose all output — never risk that. Launch in the background, then poll `/codex:status` and collect the result with `/codex:result` (or `--wait` only when the work is genuinely small).
- **Isolate parallel write-capable Codex agents in their own git worktrees.** The Codex plugin runs in the shared checkout — verified: it does NOT create its own worktrees (it resolves to the repo root/cwd and edits in place). So when fanning out multiple `--write` implementation agents over GPT in parallel, give each one an isolated worktree (e.g. Workflow's `isolation: 'worktree'`) so their edits don't collide in the shared tree. Serial single-agent runs don't need this. Re-verify the plugin's behavior if its version changes, in case it starts managing worktrees itself.
- For closed-loop quality assurance, keep the review gate turned on via `/codex:setup --enable-review-gate`. This ensures a stop hook automatically challenges Claude's outputs using Codex before finalizing, preventing broken code or weak design assumptions from reaching the main session unvetted.

## Large subagent fan-outs — ask before spawning

Before using dynamic workflows, ultracode, or any harness feature that immediately spawns a large swarm of subagents, **explain the tradeoffs and get explicit approval first.** Never infer the opt-in from a task that would merely benefit from parallelism.

State three things and then wait: what the fan-out would do, roughly what it costs (agent count and token order-of-magnitude), and what the serial alternative is. Approval for one fan-out does not carry to the next one.

A handful of targeted background subagents for independent work is not a swarm and does not need this — the gate is for the features that spawn dozens at once.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
