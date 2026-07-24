---
name: explain-code-change
user-invocable: true
description: Storyboard a code change as a reviewable, ELI5 HTML merge artifact that traces behavior end-to-end and accounts for every changed file and production symbol. Use when the user asks for an HTML or visual walkthrough of a branch, PR, diff, implementation, or merge decision.
---

# Explain Code Change

Build a **storyboard** that lets a reviewer understand the change, its safety
boundaries, and its remaining uncertainty without reading the raw diff.

Use the installed `lavish` skill for HTML design and the browser review loop.
This skill owns the content and evidence contract; `lavish` owns presentation.

## 1. Fix the review boundary

Read the repository instructions. Resolve the fixed point from the user's
explicit ref, the PR base, or the tracked default branch, in that order. Include
both committed changes and working-tree changes:

```bash
git diff --name-status <base>...HEAD
git diff --name-status HEAD
git log <base>..HEAD --oneline
```

Record the branch, dirty state, and whether reported checks are local or
external.

When no Git repository exists, treat the user-provided patch or files as the
fixed boundary and inventory them directly.

**Complete when:** every path in both name-status inventories is either covered
in the storyboard or explicitly excluded with a reason.

## 2. Trace the actual behavior

Read the complete diff and enough surrounding code to follow the changed path
end-to-end. Inspect callers, trust boundaries, failure paths, and changed tests.

Inventory every added or materially changed production function, method, class,
and shared constant. For declarative changes, inventory the equivalent
behavioral units: prompt sections, schema fields, config keys, migrations, or UI
copy. For each, capture:

- its plain-English job;
- why the change needs it;
- what calls it or consumes its output;
- its safe-failure behavior, when relevant.

Keep the original feature distinct from later review fixes and uncommitted work.
Group tests by file and user-visible promise; enumerate individual test
functions only when the user requests that granularity.

**Complete when:** every changed production file and runtime-relevant behavioral
unit has a role, purpose, and place in the end-to-end flow.

## 3. Write the change story

Draft the storyboard content before styling it:

1. **One-sentence ELI5 summary** — describe the behavior, not the implementation.
2. **Concrete before/after** — use the smallest example that exposes the bug or
   improvement.
3. **End-to-end flow** — show inputs, trust boundaries, transformations,
   outputs, and failure branches.
4. **Accuracy and safety rules** — explain how false positives, ambiguity,
   unavailable dependencies, security, and resource ceilings behave.
5. **Scope guardrails** — put “changed” and “intentionally untouched” side by
   side.
6. **Production file walkthrough** — one expandable section per file and one
   row per inventoried production symbol.
7. **Test file walkthrough** — connect test groups to user-facing promises.
8. **Validation evidence** — report only checks backed by an observed command
   result or clearly attributed prior evidence.
9. **Honest limit and verdict** — separate local readiness from CI, review bots,
   deployments, and other external gates.

Use plain words first and code names second. Define a necessary technical term
once, then reuse it.

**Complete when:** the reviewer can answer what changed, why it changed, how the
pieces connect, what happens on failure, what stayed untouched, what was tested,
and what still gates merging.

## 4. Build the HTML review surface

Read and follow the installed `lavish` skill before creating the artifact. Open
every matching Lavish playbook; change explainers normally need `diagram`,
`table`, and `comparison`, plus `code` only when source snippets or diffs appear.

Follow Lavish's design-source priority. Match the product's own design system
when one exists. Create `.lavish/<change-slug>-explainer.html`.

Use:

- a status-led hero;
- before/after cards;
- Mermaid for the core flow;
- compact accuracy and scope cards;
- semantic tables inside expandable file sections;
- a final readiness card with external gates visible.

Keep the page usable at 320px and desktop widths. Contain long paths, symbols,
tables, and diagrams within their sections. If the artifact includes source
code, use the code renderer required by the Lavish `code` playbook.

**Complete when:** every item from the change story is present in the HTML and
every inventoried file and production symbol is findable by name.

## 5. Open, audit, and hand off

Follow the installed `lavish` skill's browser audit and feedback loop through
handoff.

When Lavish is unavailable, still create a standalone portable HTML file and
state that collaborative annotations are unavailable.

Deliver the review URL or local artifact link and name the design source used.

**Complete when:** the browser reports no severe layout warnings and the user
has a working review link.

## Evidence language

- Say `N tests passed` only from an observed result covering those tests.
- Say `locally merge-ready` only when the relevant local checks passed.
- List uncommitted files when the artifact includes working-tree changes.
- State external gates explicitly instead of folding them into a green local
  verdict.
- Describe uncertainty through its actual fallback. Prefer “ambiguous evidence
  produces no highlight” over an absolute promise of zero future errors.
