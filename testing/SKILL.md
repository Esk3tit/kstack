---
name: testing
description: Which tests to write, keep, trim, rewrite or delete, so each one guards observable behavior. Use when writing a test, fixing a bug, handling a test that fails after a change, reviewing tests, or auditing a test suite.
---

# Testing

A test guards **observable** behavior: what someone outside the code can see. That someone is a person using the product, a caller of a public interface, or an outside system that reads the product's output, such as a link preview, a search engine or an error report. Behavior is **important** when it is a security boundary, a business rule, data integrity, or a core flow the product exists for. The repo's coding standards hold its own stack's test details; read them beside this.

## The bar

A **sound** test passes two edits:

- **The break.** Make the behavior wrong, and the test goes **red**. Its expected value comes from the requirement, not from the code under test.
- **The refactor.** Change the internals and keep every observable result, and the test stays **green**. One that goes red is **pinned**: it asserts internal state, call order, class names or markup. A selector that only finds the element pins nothing.

## Checked once

A one-time truth gets no committed test. Check it on the change and put the evidence (the commands and their output, the screenshots) in the PR, even when the change also needs a lasting test.

- **A one-time change to data** (a migration, a backfill, a repair): run it on rows in the old shape, and count through a read-only path the production rows it will touch.
- **Internal backward compatibility:** retire an old data shape or call form, with its tests, once our callers and stored data have moved off it. A format someone outside still holds (a shared link, a published file format, a public API) is current behavior and stays guarded.
- **Looks:** compare screenshots. Guard a measurement only when its failure stops someone using the product or hides what they need to act, such as a control off screen or which option is chosen.
- **Tools a person reads** (dev scripts, reports, CI config, test helpers): run them and read the output. Guard a tool that acts unattended where a wrong answer does lasting harm.
- **Rules a type or lint rule can hold:** make them one.
- **A dependency's own guarantees:** test our use of the library, and trust the library.

## Choosing what stays

Tests overlap, so judge them together. Each outcome worth guarding, under one set of conditions, has one **guard**: the cheapest sound test CI runs that sees the outcome itself (the rendered words, a role, the stored row) rather than a stand-in for it. A dearer test keeps what only it sees: a unit test can catch a wrong total, while a checkout test catches a right total that never reaches the receipt.

Give each test one verdict from everything it guards:

- **Keep:** it guards an outcome, and every check serves its guards.
- **Trim:** drop its checks that are pinned, checked once, or another guard's, keeping the steps its own outcomes need.
- **Rewrite:** an important outcome has no sound guard, and this test, rewritten, would be its guard. Name the outcome it should assert. Tests that lean on the rewrite stay until it passes the bar.
- **Delete:** it guards nothing. A duplicate's reason names the guard that stays.

Done when every test in scope has a verdict and a one-line reason.

## Writing a test

Look for the outcome's guard first; a sound one means there is no test to write. Otherwise drive the public interface or the user-facing controls with a concrete input and an expected value from the requirement. For "this never happens", include a case where it does, so the test can see the thing at all. Keep real collaborators; substitute only what the product doesn't own (a third-party service, the clock, randomness) or what the runner can't provide (a platform API, a forced error response). Done when you have seen it go red on the break, for the reason it names, and green on working code.

## Fixing a bug

1. Reproduce it where the user met it, and watch the reproduction go red.
2. Fix it, and watch the same reproduction go green.
3. When the bug was important or stopped someone using the product, give it a guard by **Choosing what stays** (the reproduction, or a cheaper test that goes red on the bug) and commit the guard ahead of the fix, so the history shows red first. A reproduction that doesn't stay is deleted, with its red-then-green output in the PR.

## A test that fails after a change

Ask whether the observable outcome changed:

- **On purpose:** update the expected value, and say in the PR what changed for the user.
- **By accident:** the test caught a bug. Fix the product and keep the assertion.
- **Not at all:** when what broke is how the test reaches the outcome (a locator, its setup), repair that, finding elements the way the user does (role, label, visible text). When it is the assertion, the test is pinned: judge it by **Choosing what stays**, since patching it to the new internals keeps it alive for the next refactor to break.
- **Green on a rerun:** it is flaky. Find why the result changed: a race users can hit is a product bug, and a test that checked too early waits for the observable outcome.

## Auditing a suite

To judge a whole suite and cut it down, follow [AUDIT.md](AUDIT.md).
