---
name: testing
description: Which tests to write, keep, trim, rewrite or delete, so each one guards observable behavior. Use when writing a test, when a test fails after a change, when a bug fix may leave a test behind, when reviewing tests, or when auditing a test suite.
---

# Testing

A test is a standing claim about **observable** behavior: what someone outside the code can see. That someone is a person using the product (by pointer, keyboard, touch or screen reader), a caller of a public interface, or an outside system that reads the product's output, such as a link preview, a search engine or an error report. Private helpers, internal call order, intermediate data, class names and markup structure are implementation.

Behavior is **important** when it is a security boundary, a business rule, data integrity, or one of the few core flows the product exists for.

The repo's coding standards hold the test gotchas of its own stack; read their test section beside this one.

## The bar

Judge every test, new or old, against two edits:

- **The break.** Make the behavior wrong: a wrong value, a skipped or doubled effect, the wrong person let in. The test must go **red**. A test that stays green is vacuous; the usual causes are a loose assertion, an expected value computed by the code under test, and an assertion on data the test built itself. An expected value taken from another part of the product is fair when the requirement is to agree with that part and that part has its own test.
- **The refactor.** Change the internals and keep every observable result. The test must stay **green**. A test that goes red is pinned to the implementation.

A test that passes both edits is **sound**; whether it stays depends on what the rest of the suite already guards (**Judging tests**). Prefer no new test to a bad one.

## Guarded or checked once

A lasting behavior is **guarded** by a committed test. A one-time truth is **checked once**, at the change, with its evidence (the commands and their output, the screenshots) in the PR description. These are checked once:

- **A one-time change to data:** a migration's effect on existing rows, a backfill, a one-off repair. Run it against rows in the old shape, count with a read-only query the production rows it will touch, and put both in the PR. Once it has run on every database it will touch, no input can reach it again; until then, as when customers upgrade their own installs from older releases, it is current behavior and stays guarded.
- **Internal backward compatibility:** an old data shape or function form that only our own code still sends. Move the callers to the new form and delete the old path with its tests. Stored data is a caller too, including what visitors' browsers keep: once no running copy of the old code can still write the old shape, count what is still in it (for rows, with a read-only query; what browsers keep, which no query reaches, counts as remaining until it expires), and while any remains, the old path is current behavior; guard it, or convert what remains and then delete it. A link or format someone outside still holds, such as a shared URL, a published file format or a public API, is observable behavior and stays guarded.
- **Looks:** alignment, font sizes, spacing, proportions, a focus ring's exact width. Look at them: screenshots of the change beside its closest sibling, or an image diff when the change should leave looks untouched. A measurement stays guarded only when its failure is there when the person acts and either:
  - **stops use:** a control off screen or covered, a phone page scrolling sideways, a control sliding out from under the pointer, a tap landing on a different control from the one drawn where the wrong action takes effect at once. A size floor alone is looks.
  - **hides what they need to act:** which option is chosen, whether focus is on screen, text cut short where the choices differ at the cut. Cut text whose whole is one step away is looks.

  A state that clears by itself within seconds, or shows for a frame or two, is looks when acting during it does no lasting harm. A setting the person chose, such as reduced motion, is behavior: guard that it is honoured, and leave how the motion looks to the eye.
- **Tools a person reads:** dev scripts, reports, CI and config files, test helpers. Guard a tool only when it acts with nobody reading its output and a wrong answer does lasting harm, such as the guard that stops a destructive migration or a command that must keep a password out of its logs.
- **Rules a compiler or linter can hold:** make them a type or a lint rule.
- **A dependency's own guarantees:** test our use of the library, and trust the library.

## Where a test lives

Pick the cheapest level that sees the behavior the way its user does.

- **Unit:** rules and calculations with their boundary cases (a ranking, a validation, a permission decision, a format), driven through the module's public interface with real neighbours wherever they are cheap.
- **Database:** queries, constraints, row-level policies and transactions, through the app's own read and write path against a real database engine.
- **Browser:** a few journeys that cross every layer (sign in, submit, see it saved), and what only a browser shows: focus, navigation, scrolling, layout that stops use. Repeat a case across engines, themes, widths or signed-in roles only where that dimension can change the outcome, as when it depends on how an engine paints, lays out or times.

A **failure** is one break of a lasting behavior as someone outside sees it: a signed-out visitor opening a private page, a total off by one. Each failure has one **guard**: of the tests CI runs that catch it, the cheapest that sees the outcome itself (the rendered words, a role, focus, the stored row) rather than a stand-in for it (a styling hook, a mock's payload, simulated layout); of equals, any one. What only a dearer level sees (wiring, persistence, permissions, the browser) is a failure of its own, guarded at that level.

## Writing a test

1. Decide guarded or checked once. For checked once, run the check, put the evidence in the PR, and stop.
2. Name the observable behavior and who would notice it break, then look for its guard among the tests CI runs. With nobody to name, or a guard already there, there is nothing to write, and the work ends here.
3. Pick the level.
4. Drive it the way its user does, through the public interface or the user-facing controls, with a concrete input and an expected value written out from the requirement. Keep real collaborators; substitute only what the product doesn't own: a third-party service, the clock, randomness.
5. Watch it go red on the break: revert the fix or mutate the guarded line, and confirm the mutation applied. Restore it and watch it go green. Done when you have seen red for the reason the test names.

While writing:

- Pair "this never happens" with a case where it does happen, so the assertion can see the thing at all.
- For an error a caller branches on, assert its type or code; for one a person reads, assert the words they see.
- Wait for the outcome with the runner's retrying assertions. Hold a clock or animation still (fake timers, a held frame loop) rather than racing it.

## Fixing a bug

1. Reproduce it on the surface where the user met it, and watch the reproduction go red.
2. Fix it, and watch the same reproduction go green on the same surface. A unit test shows how one branch behaves, not that the bug is gone.
3. Decide what stays. When the bug broke something important or stopped someone using the page, its failure needs a guard: the reproduction, or a cheaper test that catches it (**Where a test lives**). Judge the reproduction by **Judging tests** and carry out its verdict, then watch the guard in its final form go red without the fix and green with it, and commit a new or changed guard in its own commit ahead of the fix's, so the history shows red first. For any other bug, or a reproduction judged Delete, remove what the reproduction added and put its red-then-green output in the PR.

## A test that fails after a change

Ask first whether observable behavior changed:

- **Changed on purpose:** update the expected value, and say in the PR what changed for the user.
- **Changed by accident:** the test caught a bug. Fix the code and leave the assertion alone.
- **Unchanged:** if only its locator broke, re-point it at what its user finds (role, label, visible text); otherwise the test is pinned, and patching it to match the new internals keeps it alive for the next refactor to break. Either way, judge it by **Judging tests**.
- **Green on a rerun:** it is flaky. Find out whether the test races the app or the app holds the race. An app race is a bug; a test racing the app needs its wait fixed, which is upkeep, not a rewrite.

Weaken an assertion only when the behavior genuinely changed, and say why in the PR.

## Judging tests

Tests overlap in what they catch, so a verdict comes from the whole suite: settle each test's failures, then each failure's guard, then read off the verdicts.

1. **List each test's failures.** Run the two edits on it (in your head, or for real when unsure) and match it against the smells. List each failure it is for, marked **sound** where it passes the bar on that failure, or **unsound** where it fails the bar and the behavior is important. Every other check is for no failure and takes a smell. Done when every test in scope has its list, read from that test and the code it drives.
2. **Give each failure its guard.** Gather every test CI runs that lists the same failure, listing any outside the scope by step 1. Two tests list the same failure when they check the same outcome under the same conditions; read both bodies to confirm. Choose the guard by **Where a test lives** among the sound tests, or, when none is sound, the unsound test cheapest to rewrite; an unsound guard covers its failure only once its rewrite passes the bar. A test that skips unless a flag CI never sets gets a CI job or goes. Done when every listed failure names one guard.
3. **Read off each verdict.**
   - **Keep:** it guards only failures it is sound on, and every check serves one of them.
   - **Trim:** it guards only failures it is sound on, and other checks carry a smell or belong to a failure another test guards. Drop those, keeping any the test needs to reach an outcome it guards.
   - **Rewrite:** it guards a failure it is unsound on. Name the outcome it should assert; its sound checks on failures it guards stay.
   - **Delete:** it guards nothing.

   Done when every test in scope has a verdict, its smell and a one-line reason.

### Smells

- **Vacuous:** green on the break. It asserts a mock returns what it was told, asserts nothing that can fail, or sits in a callback the runner never awaits.
- **Pinned:** red on the refactor. Its outcome assertions read internal state, a private helper, an internal call count, a class name or markup structure. A selector that only finds the element, or a line that only confirms the setup (a request in flight, the hazard present), pins nothing. A label, role, accessible name or live region's text is observable, so a test of one is not pinned.
- **Change detector:** its expected value restates the code (a constant, a config shape, a workflow file, source text) with no separate requirement behind it. A fixed value is fair when an outside party requires it, as with a published format or a documented limit.
- **Self-test:** it fails only if a dependency breaks its own guarantee. Remove our wiring and it still passes.
- **Over-mocked:** our own logic never runs: the real authorization, persistence or integration is replaced, so the test fails only when the rehearsed calls change. Stubbing a response to force an error, standing in for a platform API the runner lacks, and asserting what our code hands a substituted third-party SDK are all fair. Mocking our own server function is fair only for a client rule the stored result can't show, such as whether it writes at all.
- **Duplicate:** every failure it is for has another test as its guard; the reason names each guard.
- **Snapshot sprawl:** it compares a large recorded output, and nobody can say which part of it is promised.
- **Time-bound:** it guards a one-time change that no input can reach again.
- **Looks-only:** a measurement the **Looks** rule leaves to the eye.
- **Flaky:** the same commit both passes and fails.

## Auditing a suite

To judge a whole suite and decide what to cut, follow [AUDIT.md](AUDIT.md).
