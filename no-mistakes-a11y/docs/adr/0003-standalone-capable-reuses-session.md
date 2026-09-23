# no-mistakes-a11y runs standalone in its own browser session

`no-mistakes-a11y` takes the same inputs as `no-mistakes-frontend` (base URL/app
name, intent/checklist, evidence dir, PR number) and runs on its own: it logs in to its
own per-run agent-browser session (`<browserProfile>-<run>`), does its own light recon of
the touched screens, and derives its "required controls" from the intent. When the
`no-mistakes` router runs it after `-frontend`, it opportunistically reuses
`-frontend`'s derived test cases and recon, but never depends on them.

## Considered Options

- **Standalone, own session (chosen).** Consistent with ADR-0001's
  "separate skill, own cadence and status line." A `-frontend` failure or blocked
  recon never starves the a11y pass; a11y can be invoked directly on a branch.
- **Hard pipeline consuming `-frontend` output.** Rejected: zero duplicate recon,
  but couples a11y to a successful preceding `-frontend` run — it could not run
  alone, and an upstream block would starve it.
