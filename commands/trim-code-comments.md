---
description: Trim noisy comments and strip plan/spec/issue references (PRO-123, task 9, step 3, phase 2) from code changed in the current worktree/branch/PR
argument-hint: [path-or-pr-or-ref...]
---

# /trim-code-comments

## Purpose
Clean up comments in the code you just wrote. Two jobs:
1. **Strip implementation-process references** — comments that point at the plan/spec/ticket the coding agent was working from. These rot fast and look dirty in the codebase.
2. **Trim noise** — comments that restate what the code already says, narrate the diff, or pad with docstrings nobody needs.

Keep comments that explain a non-obvious **WHY**: a hidden constraint, subtle invariant, workaround for a specific bug, or surprising behavior.

## Contract
**Inputs:** `$ARGUMENTS` — optional scope. May be a path, glob, PR number (`#1234` / `1234`), or git ref/range. If empty, default to the current change set (see Step 1).
**Outputs:** `STATUS=<OK|FAIL> FILES=<n> EDITS=<n> [ERROR="..."]`

## What to REMOVE

### Always remove — process/plan references
Comments naming where the work came from, in any form:
- Linear/Jira issues: `// PRO-1158`, `# fixes JIRA-42`, `// per PRO-1269`
- Tasks / steps / phases: `// Task 9`, `# Step 3`, `// Phase 2`, `// step 4 of plan`
- Spec/plan pointers: `// per spec`, `# see spec section 3.2`, `// from the implementation plan`, `// F1`, `// T2.3`
- PR / commit / review refs: `// PR #1234`, `# addressed in iteration 3`, `// per code review`, `// review feedback`, `// CR comment`
- Iteration / changelog markers: `// removed X`, `// changed Y to Z`, `// was: ...`, `// TODO(iteration 2)` — git already shows the change

### Trim — redundant / low-value
- Inline comments that restate the code: `// loop through users`, `// set the value`, `// increment i`, `// return result`
- Section-header banners and decorative dividers added during scaffolding
- Commented-out code left behind from implementation
- Verbose docstrings/blocks — **condense, don't delete** (see KEEP below)

## What to KEEP
Keep a comment ONLY if it explains something a reader genuinely cannot get from reading the code itself:
- WHY a non-obvious decision was made (constraint, invariant, perf tradeoff, ordering requirement)
- A workaround tied to a specific upstream bug / library quirk (keep the link to the *external* cause, not the internal ticket)
- Domain context or a hidden assumption that isn't inferable from the code

**Docstrings and top-level comments are fine — leave them.** Module-, class-, and function-level docstrings (and similar leading summary comments) are useful and should be kept, just trimmed if they ramble. The target is *inline* noise and process refs, not every comment in the file. Don't strip docstrings down to nothing.

For an *inline* comment: if it only describes WHAT the code does, or a reader could understand it by reading the code, remove it.

**Condense whatever you keep.** A kept comment should be as short as possible — usually **one line, at most two**. Rewrite padded prose and rambling docstrings down to the non-obvious point (a docstring may stay a short docstring — just tighten it). Drop filler (`just`, `really`, `basically`), restated context, and anything the code already shows.

> Rule of thumb: if deleting the comment wouldn't confuse a future reader, delete it. If keeping it, cut it to one line (two only if truly unavoidable). When genuinely unsure whether a WHY is obvious from the code, keep it — but keep it short.

## Instructions

1. **Resolve scope** → the set of changed files to clean.
   - If `$ARGUMENTS` is a PR number: `gh pr diff <n> --name-only` (and `gh pr checkout <n>` if not already on it).
   - If `$ARGUMENTS` is a path/glob: use it directly.
   - If `$ARGUMENTS` is a git ref/range: `git diff --name-only <range>`.
   - If empty: combine uncommitted + branch changes against the default branch:
     ```bash
     base=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
     base=${base:-master}
     { git diff --name-only; git diff --name-only --cached; git diff --name-only "origin/$base...HEAD"; } | sort -u
     ```
   - Filter to source files (skip lockfiles, generated `schema.d.ts`, `*.snap`, vendored dirs, binaries).

2. **Read only the changed files.** Do NOT touch comments in unchanged files — scope the cleanup to this branch's work, not the whole repo.

3. **Edit conservatively.** For each file, apply the REMOVE/KEEP rules above with the Edit tool. Only delete or shorten comments — never alter executable code, strings, or behavior. Preserve indentation and surrounding blank-line style.

4. **Verify nothing broke.**
   - Re-read each edited region to confirm only comments changed.
   - If a fast syntax check exists, run it on edited files (e.g. `python -m py_compile <f>`, `node --check <f>`, or the repo linter on just those paths). Don't run the full test suite unless asked.

5. **Report.** Print one `STATUS` line: `STATUS=OK FILES=<files-touched> EDITS=<comments-removed-or-trimmed>`. Then a short bullet list of files with a one-line note each. Do NOT commit unless the user asks.

## Constraints
- Comments and whitespace only — zero behavior changes.
- Stay within the resolved scope; never sweep the whole repo.
- Idempotent: re-running on already-clean files makes no edits (`EDITS=0`).
- Never strip license headers, linter/type pragmas, or codegen markers.
- No network beyond `gh`/`git` needed to resolve scope.
