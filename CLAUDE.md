# Global instructions

## Technical decisions

When making technical decisions, give no weight to development cost or engineering effort by default. **Quality, simplicity, robustness, scalability, and long-term maintainability are the decisive factors** in any technical decision. Give cost/effort weight only when the user signals urgency, and even then very little — never more than that urgency clearly warrants.

## Bug fixes

When doing bug fixes, always start with reproducing the bug in an E2E setting as closely aligned with how an end user would experience it as possible. This makes sure you find the real problem so your fix will actually solve it.

## Quality bar — fix what's broken, even if it's not yours

When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel perfection. If something clearly looks off, even if it is not directly related to what you are doing, try to get it fixed along the way.

Apply that same high standard to engineering excellence: lint, test failures, and test flakiness. If you see one, even if it is not caused by what you are working on right now, still get it fixed.

## Code comments — sparse by default

Default to **NO comments**. Well-named identifiers explain WHAT. Only add a comment when WHY is non-obvious from reading the code: a hidden constraint, subtle invariant, workaround for a specific bug, surprising behavior.

When a comment IS needed:
- **1 concise line** preferred. **Maximum 2 lines.**
- No multi-paragraph docstrings. No narrative blocks. No section headers.
- No explaining what the code already shows ("// loop through users", "// set the value").
- **NEVER reference phases, tasks, plan steps, Linear issues, ticket IDs, PR numbers, iteration numbers, or code-review findings in comments.** Examples to avoid: `// Phase 2`, `// Step 4`, `// PRO-1158`, `// PR #1234`, `// per code review`, `// addressed in iteration 3`, `// fix for issue X`. These belong in the commit message and rot fast — they look dirty in the codebase.
- No "// removed X" or "// changed Y" markers — git diff already shows that.

If removing the comment wouldn't confuse a future reader, don't write it.
