# FAIL bar is operability blockers only; everything else is a finding

`no-mistakes-a11y` emits its own `NOMISTAKES_A11Y_STATUS` line and mirrors
`no-mistakes-frontend`'s "findings + one tight FAIL bar" model. Only **operability
blockers** flip the verdict to FAIL: a keyboard trap, a control required by the
flow-under-test that is unreachable by keyboard, content lost/clipped at 320px
reflow, or the total absence of any visible focus indicator on the keyboard path.

Everything else — a single out-of-order focus stop, a low-contrast (but present)
focus ring, missing landmarks, heading-order nits, and **all `axe-core` static
rule violations including WCAG 2.1 Level A** — stays a severity-tagged finding and
never blocks a merge.

## Consequences

- Deliberately *not* a conformance gate. We do **not** FAIL on axe criticals,
  because axe carries a real false-positive rate and a blocking verdict must stay
  trustworthy (consistent with the frontend skill keeping contrast/tap-target as
  findings, not auto-FAIL). A future reader tempted to promote axe criticals to
  FAIL should weigh that false-positive cost first.
- The FAIL set is intentionally about *usability on the assistive path*, not
  standards conformance. The human reads findings for the rest.
