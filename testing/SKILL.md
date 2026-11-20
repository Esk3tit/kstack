---
name: testing
description: Which tests to write, keep, trim, rewrite or delete. Use when writing a test, fixing a bug, handling a test that fails after a change, reviewing tests, or auditing a test suite.
---

# Testing

A test guards **observable** behavior: what someone outside the code can see, including outside systems that read the product's output, such as a link preview or an error report. Behavior is **important** when it is a security boundary, a business rule, data integrity, or a core flow the product exists for. The repo's coding standards hold its own stack's test details; read them beside this.

## The bar

A **sound** test passes two edits:

- **The break.** Make the behavior wrong, and the test goes **red**. Its expected value comes from the requirement, not from the code under test.
- **The refactor.** Change the internals and keep every observable result, and its assertions stay **green**. A test whose assertion goes red is **pinned**: it asserts internal state, call order, class names or markup.

## Checked once

These get no committed test. Check each once, on the change, with the evidence in the PR.

- **A one-time change to data** (a migration, a backfill, a repair): run it on rows in the old shape and check what it leaves; count, through a read-only path, the production rows it will touch.
- **Internal backward compatibility:** move what still uses an old data shape or call form to the new one, show in the PR that nothing uses the old one, and retire it with its tests. A format someone outside holds (a shared link, a public API) stays guarded.
- **Looks:** compare screenshots. Guard a measurement only when its failure stops someone using the product or hides what they need to act, such as a control off screen or which option is chosen.
- **Developer tools a person reads** (dev scripts, CI config, test helpers): run them and read the output. Guard a tool that acts unattended where a wrong answer does lasting harm.
- **Rules a type or lint rule can hold:** make them one.
- **A dependency's own guarantees:** test our use of the library, and trust the library.

## Choosing what stays

Tests overlap, so judge them together. Each outcome worth guarding has one **guard**: the cheapest sound test CI runs that sees the outcome itself (the rendered words, a role, the stored row) rather than a stand-in for it. A dearer test keeps what only it sees: a unit test can catch a wrong total, while a checkout test catches a right total that never reaches the receipt.

Give each test the first verdict that fits:

- **Rewrite:** an important outcome has no guard, and this is the test to make its guard. Name the outcome it should assert.
- **Keep:** it is a guard, and every assertion serves an outcome it guards.
- **Trim:** it is a guard; drop the assertions that serve no outcome it guards.
- **Delete:** it guards nothing. A duplicate's reason names the guard that stays.

Done when every test in scope has a verdict and a one-line reason.

## Writing a test

Look for the outcome's guard first; if it has one, there is no test to write. Otherwise drive the public interface or the user-facing controls. Keep real collaborators; substitute only what the product doesn't own (a third-party service, the clock, randomness) or what the runner can't provide (a platform API, a forced error). Done when you have seen it go red on the break, for the reason it names, and green on working code.

## Fixing a bug

1. Reproduce it where the user met it, and watch the reproduction go red.
2. Fix it, and watch the same reproduction go green.
3. When the bug broke lasting behavior that is important or that someone needs to use the product, and a test can catch it, keep a guard for it: the reproduction, or a cheaper test that goes red on the bug. When the reproduction isn't the guard, remove what it added and put its red-then-green output in the PR.

## A test that fails after a change

Rerun it, then ask whether the observable outcome changed:

- **Green on a rerun:** it is flaky. A race users can hit is a product bug; a test that checked too early waits for the observable outcome.
- **On purpose:** judge it by **Choosing what stays** against the new requirement.
- **By accident:** the test caught a bug. Fix the product and keep the assertion.
- **Not at all:** repair a broken locator or setup, finding elements the way the user does (role, label, visible text). A broken assertion means the test is pinned: judge it by **Choosing what stays** rather than patching it to the new internals.

## Auditing a suite

To judge a whole suite and cut it down, follow [AUDIT.md](AUDIT.md).
