# Required passes

Read this before step 1 when the repo declares, in `docs/agents/pr-loop.md`, the review passes a PR needs before merge, one unindented line each:

```markdown
- pass: standards
- pass: spec, reads the PR body
- pass: fable
- pass: codexloop
```

- `standards` and `spec` are step 1's axes, `codexloop` step 2's loop and `fable` step 5's pass, run in the order the pass sequence below sets.
- A required Spec that finds no spec is recorded `not-reviewed`.
- At the first check, read the declaration's `- pass:` lines where the check says it found them (`git show <that commit or branch>:docs/agents/pr-loop.md`): a line naming a pass other than these four, or giving `, reads the PR body` to any pass but `spec`, hands back `Merge-ready: no: unknown required pass <name>`.
- The file can also declare check deadlines (`- deadline: <check> = <minutes> min`, **Waits** in `/address-pr-comments`) and facts-block sections (format: top of `~/.claude/skills/recap-pr/facts.py`).

A `fable` line **stands**, as the user's standing request for Fable passes, once it is on the default branch (`git show <default branch>:docs/agents/pr-loop.md` shows it) or they have approved it (logged as a settled decision, which `log.sh --pins` shows later runs). Until it stands, record Fable `not-reviewed` on each head where the check does not list it clean and it does not run (no single-pass approval, or step 5's skip), and ask in the hand-back for the line's approval (Fable on every head of this PR); once approved, run it on the current head.

- **The pass sequence** here runs the passes `log.sh --check <head>` names on its closing `Not clean on` or `Not reviewed on` line, in this order: step 1's axes (`/code-review` runs only the axis the check names), then step 5's Fable, then `/codexloop --until-converged --base <base>`.
  - It repeats until the check exits 0, or exits 3 with every pass it names recorded `not-reviewed` by this run (after its start row); a pass an earlier run left `not-reviewed` is tried again in its place in the order. An exit 2 (the check could not run) stops it and hands back `Merge-ready: no: check could not run: <its message>`.
  - Any new commit (a base merge, rebase or restack too) sends the passes round again; a pass already clean on the head is not rerun.
  - A finding that would undo a change another pass's finding made in this run is logged `rejected`, plus an `open` row putting both findings to the user as one question.
  - A head reaches the remote only once the check exits 0 or 3 (step 2's draft-PR pushes for CI aside; `/codexloop`'s step 4 holds its push), and the sequence ends with a guarded push (SKILL.md, Required passes).
