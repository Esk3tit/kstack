# Local patches to mattpocock skills

Each patch is a local edit an `npx skills` update wipes. Apply in number order: two patches on the same skill can depend on each other's text.

```bash
patch -p1 -d ~/.agents/skills/<skill> < ~/.claude/skills/update-mattpocock-skills/patches/<file>
```

## 01 · implement · affected tests only

`patches/01-implement-affected-tests.patch`, added 2026-10-04.

- **What it does:** at the end of `/implement`, the agent runs only the tests the change can affect (found by grepping the test tree for every file and symbol the diff touches), not the whole suite. The whole suite runs only for global changes or when asked. A failing test is first re-run on the base commit, so an old failure is reported as old instead of being "fixed" silently.
- **Why:** the TPRM-API suite takes about 40 minutes.

## 02 · implement-spec · affected tests only

`patches/02-implement-spec-affected-tests.patch`, added 2026-10-07.

- **What it does:** the implementer subagents that `/implement-spec` spawns also check their work with the affected tests only.
- **Why:** an implementer subagent ran the full suite.

## 03 · implement · decision log

`patches/03-implement-decision-log.patch`, added 2026-10-17. Its context lines come from patch 01.

- **What it does:** while implementing, the agent writes a row to the `/recap-pr` decision log for every choice the spec left open, every mechanism it adds (semaphore, cache, retry, flag), and every change users will see compared with master.
- **Why:** behavior drifted from prod during hands-off work and was only found by testing.

## 04 · pr · behavior changes vs master

`patches/04-pr-behavior-changes.patch`, added 2026-10-17.

- **What it does:** adds a "Behavior changes vs master" section to PR bodies, listing what users, customers or ops will see differently and why, taken from the decision log.
- **Why:** reviewers saw code changes but not behavior changes.
