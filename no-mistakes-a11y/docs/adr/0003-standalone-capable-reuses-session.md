# no-mistakes-a11y is standalone-capable and reuses the run's browser session

`no-mistakes-a11y` takes the same inputs as `no-mistakes-frontend` (base URL/app
name, intent/checklist, evidence dir, PR number) and can run on its own: inside a
composed run it reuses that run's agent-browser session (`<browserProfile>-<run>`) with
no re-login; standalone it logs in to its own run session. It does its own light recon of
the touched screens, and derives its "required controls" from the intent. When the
`no-mistakes` router runs it after `-frontend`, it opportunistically reuses
`-frontend`'s derived test cases and recon, but never depends on them.

## Considered Options

- **Standalone-capable, session-reuse (chosen).** Consistent with ADR-0001's
  "separate skill, own cadence and status line." A `-frontend` failure or blocked
  recon never starves the a11y pass; a11y can be invoked directly on a branch.
- **Hard pipeline consuming `-frontend` output.** Rejected: zero duplicate recon,
  but couples a11y to a successful preceding `-frontend` run — it could not run
  alone, and an upstream block would starve it.
