# Required passes

Read this before step 1 when the repo declares, in `docs/agents/pr-loop.md`, the review passes a PR needs before merge, one unindented line each:

```markdown
- pass: standards
- pass: spec, reads the PR body
- pass: fable
- pass: codexloop
```

Step 1 runs `standards` and `spec`, step 2 `codexloop`, step 5 `fable`; a declaration naming any other pass hands back `Merge-ready: no: unknown required pass <name>` at the first check. The file can also declare facts-block sections (format: top of `~/.claude/skills/recap-pr/facts.py`).

A `fable` line **stands**, as the user's standing request for Fable passes, once it is on the default branch or they have approved it. Until it stands, record Fable `not-reviewed` on each head it does not run on (no single-pass approval, or step 5's skip), and ask in the hand-back for the line's approval (Fable on every head of this PR); once approved, run it on the current head.

- **The pass sequence** here runs the passes `log.sh --check <head>` names, in this order: step 1's axes (`/code-review` runs only the axis the check names), then step 5's Fable, then `/codexloop --until-converged --base <base>`.
  - It repeats until the check exits 0, or exits 3 with every pass it names recorded `not-reviewed` by this run (a record newer than the run's first decision-log row); a pass an earlier run left `not-reviewed` is tried again in its place in the order. An exit 2 (the check could not run) stops it and hands back `Merge-ready: no: check could not run: <its message>`.
  - Any new commit (a base merge, rebase or restack too) sends the passes round again; a pass already clean on the head is not rerun.
  - A head reaches the remote only once the check exits 0 or 3 (step 2's draft-PR pushes for CI aside; `/codexloop`'s step 4 holds its push), and the sequence ends with that push: `git push -u origin HEAD` when the remote lacks the head, never forced; a diverged remote hands back `Merge-ready: no: remote diverged`.
