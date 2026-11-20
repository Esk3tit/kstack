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

A test that passes both edits earns its place. Prefer no new test to a bad one.

## Guarded or checked once

A lasting behavior is **guarded** by a committed test. A one-time truth is **checked once**, at the change, with its evidence (the commands and their output, the screenshots) in the PR description. These are checked once:

- **A one-time change to data:** a migration's effect on existing rows, a backfill, a one-off repair. Run it against rows in the old shape, count with a read-only query the production rows it will touch, and put both in the PR. Once it has run on every database it will touch, no input can reach it again; until then, as when customers upgrade their own installs from older releases, it is current behavior and stays guarded.
- **Internal backward compatibility:** an old data shape or function form that only our own code still sends. Move the callers to the new form and delete the old path with its tests. Stored data is a caller too, including what visitors' browsers keep: count what is still in the old shape (for rows, with a read-only query), and while any remains, the old path is current behavior; guard it, or convert what remains and then delete it. A link or format someone outside still holds, such as a shared URL, a published file format or a public API, is observable behavior and stays guarded.
- **Looks:** alignment, font sizes, spacing, proportions, a focus ring's exact width. Look at them: screenshots of the change beside its closest sibling, or an image diff when the change should leave looks untouched. A measurement stays guarded only when its failure lasts until the person acts and either:
  - **stops use:** a control off screen or covered, a phone page scrolling sideways, a control sliding out from under the pointer, a tap landing on a different control from the one drawn where the wrong action takes effect at once. A size floor alone is looks.
  - **hides what they need to act:** which option is chosen, whether focus is on screen, text cut short where the choices differ at the cut. Cut text whose whole is one step away is looks.

  A state that clears by itself within seconds, or shows for a frame or two, is looks. A setting the person chose, such as reduced motion, is behavior: guard that it is honoured, and leave how the motion looks to the eye.
- **Tools a person reads:** dev scripts, reports, CI and config files, test helpers. Guard a tool only when it acts with nobody reading its output and a wrong answer does lasting harm, such as the guard that stops a destructive migration or a command that must keep a password out of its logs.
- **Rules a compiler or linter can hold:** make them a type or a lint rule.
- **A dependency's own guarantees:** test our use of the library, and trust the library.

## Where a test lives

Pick the cheapest level that sees the behavior the way its user does. When two tests catch the same failure, the cheaper one wins if it sees the outcome itself (the rendered words, a role, focus, the stored row) rather than a stand-in for it (a styling hook, a mock's payload, simulated layout). The dearer one stays only for evidence nothing else at its level gives, such as wiring, persistence, permissions or the browser.

- **Unit:** rules and calculations with their boundary cases (a ranking, a validation, a permission decision, a format), driven through the module's public interface with real neighbours wherever they are cheap.
- **Database:** queries, constraints, row-level policies and transactions, through the app's own read and write path against a real database engine.
- **Browser:** a few journeys that cross every layer (sign in, submit, see it saved), and what only a browser shows: focus, navigation, scrolling, layout that stops use. Repeat a case across engines, themes, widths or signed-in roles only where that dimension can change the outcome, as when it depends on how an engine paints, lays out or times.

## Writing a test

1. Name the observable behavior and who would notice it break. With nobody to name, there is nothing to guard, and the work ends here.
2. Decide guarded or checked once. For checked once, run the check, put the evidence in the PR, and stop.
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
3. Decide what stays. Commit the reproduction as a test when it passes the bar and the bug broke something important or stopped someone using the page, in its own commit ahead of the fix's, so the history shows red first. Otherwise put the red-then-green output in the PR and delete the reproduction.

## A test that fails after a change

Ask first whether observable behavior changed:

- **Changed on purpose:** update the expected value, and say in the PR what changed for the user.
- **Changed by accident:** the test caught a bug. Fix the code and leave the assertion alone.
- **Unchanged:** when only its locator broke, find the element the way its user does (role, label, visible text) and the test stands. Otherwise the test is pinned: give it a verdict by **Judging an existing test**, since patching it to match the new internals keeps it alive for the next refactor to break.
- **Green on a rerun:** it is flaky. Find out whether the test races the app or the app holds the race. An app race is a bug; a test racing the app needs its wait fixed, which is upkeep, not a rewrite.

Weaken an assertion only when the behavior genuinely changed, and say why in the PR.

## Judging an existing test

For each test, name what it guards, run the two edits (in your head, or for real when unsure), match it against the smells, and give it a verdict:

- **Keep:** it passes the bar on a lasting behavior (**Guarded or checked once**), and **Where a test lives** keeps it over any other test that catches the same failure.
- **Trim:** its outcome assertions earn Keep, but other lines are pinned, looks-only or duplicated. Drop those lines and keep the test.
- **Rewrite:** it fails the bar, but it is the only guard on something important. Name the outcome it should assert instead.
- **Delete:** everything else.

A test guards only where CI runs it. One that skips unless a flag CI never sets gets a CI job or goes, and only a test CI runs can make another a duplicate.

Done when every test in scope has a verdict, its smell and a one-line reason.

### Smells

- **Vacuous:** green on the break. It asserts a mock returns what it was told, asserts nothing that can fail, or sits in a callback the runner never awaits.
- **Pinned:** red on the refactor. Its outcome assertions read internal state, a private helper, an internal call count, a class name or markup structure. A selector that only finds the element, or a line that only confirms the setup (a request in flight, the hazard present), pins nothing. A label, role, accessible name or live region's text is observable, so a test of one is not pinned.
- **Change detector:** its expected value restates the code (a constant, a config shape, a workflow file, source text) with no separate requirement behind it. A fixed value is fair when an outside party requires it, as with a published format or a documented limit.
- **Self-test:** it fails only if a dependency breaks its own guarantee. Remove our wiring and it still passes.
- **Over-mocked:** our own logic never runs: the real authorization, persistence or integration is replaced, so the test fails only when the rehearsed calls change. Stubbing a response to force an error, standing in for a platform API the runner lacks, and asserting what our code hands a substituted third-party SDK are all fair. Mocking our own server function is fair only for a client rule the stored result can't show, such as whether it writes at all.
- **Duplicate:** another test catches the same failure, and **Where a test lives** keeps that one.
- **Snapshot sprawl:** it compares a large recorded output, and nobody can say which part of it is promised.
- **Time-bound:** it guards a one-time change that no input can reach again.
- **Looks-only:** a measurement the **Looks** rule leaves to the eye.
- **Flaky:** the same commit both passes and fails.

## Auditing a suite

To judge a whole suite and decide what to cut, follow [AUDIT.md](AUDIT.md).
