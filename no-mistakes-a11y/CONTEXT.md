# no-mistakes-a11y

Deep accessibility verification for the configured frontend app's UI changes — the interaction-driven
accessibility checks that `no-mistakes-frontend`'s single-snapshot visual audit
structurally cannot perform. A sibling harness to `no-mistakes-frontend` /
`no-mistakes-backend`, composed by the `no-mistakes` router.

## Language

**Deep a11y**:
Accessibility verification that requires *driving* the page (keyboard, zoom, focus
traversal) rather than measuring one rendered DOM snapshot. This skill's scope.
_Avoid_: full WCAG audit, a11y testing (too broad / ambiguous).

**Static measurable a11y facts**:
The accessibility signals already emitted by `no-mistakes-frontend`'s
`audit-metrics.js` from a single snapshot — contrast (WCAG 4.5/3), 44px tap
targets, viewport overflow. Explicitly *out of scope* here; deep a11y is the
complement, not a re-run.
_Avoid_: basic a11y, snapshot a11y.

**Interaction axis**:
One of the three deep-a11y dimensions that need real page interaction —
*keyboard operability*, *focus order/visibility*, *zoom/reflow*. The headline
deliverable.

**Operability blocker**:
An a11y defect that makes a screen *unusable* by the assistive path under test —
keyboard trap, an interactive control unreachable by keyboard, content lost or
clipped at reflow, or total absence of any visible focus indicator. The only
class that flips the verdict to FAIL.
_Avoid_: critical issue, violation.

**Finding**:
A reported a11y defect that is real but does not block operability (e.g. a single
poorly-ordered focus stop, a low-contrast focus ring). Severity-tagged; does not
flip the verdict. Mirrors `no-mistakes-frontend`'s findings-vs-FAIL model.

**Static WCAG layer**:
The `axe-core`-driven pass over rules that need no interaction (names, roles,
ARIA, landmarks, alt text). Rides along cheaply; never the headline. axe-core
*cannot* test the interaction axes.

## Keyboard navigation

**Focus path**:
The ordered sequence of elements that receive focus as Tab is pressed across a
screen, recorded by reading `document.activeElement` after each press. The
primary artifact of the keyboard walk; reachability and order are judged against
it.

**Keyboard trap**:
A state where focus enters a widget and cannot leave it by keyboard (Tab no
longer advances). An operability blocker → FAIL.

**Required control**:
An interactive control the flow-under-test depends on. If a required control
never appears in the focus path or can't be activated by Enter/Space, that's an
operability blocker → FAIL. A *non-required* control missing from the path is a
finding, not a blocker.

**Composite widget**:
A single-tab-stop ARIA widget — `role=menu`, `tablist`, `toolbar`, `grid` — that
uses roving `tabindex` plus arrow-key navigation. Exposing only one tab stop is
*correct*; its inner items are deliberately not required tab stops, so they are
never counted as unreachable.
_Avoid_: ARIA component, widget (too generic).

## Zoom / reflow

**Reflow check**:
The WCAG 1.4.10 test — render the screen at a 320px-wide viewport (the canonical
400%-zoom equivalent) and assert content reflows with no horizontal scrolling and
no required control pushed off-screen. v1's only zoom/reflow mechanic; 200% text
zoom (WCAG 1.4.4) is deferred.
_Avoid_: zoom test, responsive check.
