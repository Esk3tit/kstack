# Deep a11y is a separate composable skill, not a step in no-mistakes-frontend

PRO-1420 deferred deep accessibility verification (keyboard operability, focus
order/visibility, zoom/reflow, broader WCAG) out of `no-mistakes-frontend` v1,
whose visual audit only emits the *static measurable* a11y facts a single DOM
snapshot can yield. We build it as a new sibling skill, `no-mistakes-a11y`,
composed by the existing `no-mistakes` router alongside `-frontend` / `-backend`,
emitting its own `NOMISTAKES_A11Y_STATUS` line — rather than as an opt-in step
inside `-frontend`.

## Considered Options

- **Sibling skill (chosen).** Matches the ticket's framing ("a separable build,
  likely its own dev-browser driving + assertions"), keeps `-frontend` lean, lets
  a11y evolve on its own cadence, and reuses the established router-composition
  pattern. The router offers it only when a UI change warrants the heavier run.
- **New `Step 6.5` inside `no-mistakes-frontend` behind a flag.** Rejected: folds
  a heavy interaction-driving pass into a skill already near its ~10min soft cap,
  conflates two verdicts into one status line, and contradicts the frontend
  contract that already names "deep a11y" as out-of-scope.
