# Local patches to mattpocock skills

Each patch is a local edit an `npx skills` update wipes. Apply in number order: two patches on the same skill can depend on each other's text.

```bash
patch -p1 -d ~/.agents/skills/<skill> < ~/.claude/skills/update-mattpocock-skills/patches/<file>
```

## 01 · implement · affected tests only

`patches/01-implement-affected-tests.patch`, added 2026-10-04.

- **What it does:** at the end of `/implement`, the agent runs only the tests the change can affect (found by grepping the test tree for every file and symbol the change touches, committed or not), not the whole suite. The whole suite runs only for global changes or when asked. A failing test is first re-run on the base commit, so an old failure is reported as old instead of being "fixed" silently.
- **Why:** the TPRM-API suite takes about 40 minutes.

## 02 · implement-spec · affected tests only

`patches/02-implement-spec-affected-tests.patch`, added 2026-10-07.

- **What it does:** the implementer subagents that `/implement-spec` spawns also check their work with the affected tests, with the same full-suite exceptions as patch 01 (a global change, or when asked).
- **Why:** an implementer subagent ran the full suite.

## 03 · implement · decision log

`patches/03-implement-decision-log.patch`, added 2026-10-17. Its context lines come from patch 01.

- **What it does:** while implementing, the agent writes a row to the `/recap-pr` decision log for every choice the spec left open, every mechanism it adds (semaphore, cache, retry, flag), and every change users will see compared with master.
- **Why:** behavior drifted from prod during hands-off work and was only found by testing.

## 04 · pr · behavior changes vs master

`patches/04-pr-behavior-changes.patch`, added 2026-10-17.

- **What it does:** adds a "Behavior changes vs master" section to PR bodies, listing what users, customers or ops will see differently and why, taken from the decision log.
- **Why:** reviewers saw code changes but not behavior changes.

## 05 · implement · verification handoff

`patches/05-implement-verification-handoff.patch`, added 2026-10-23. Apply after patch 03.

- **What it does:** carries affected tests, stage-eval inputs, required prompt-writing skills, and shared-service ownership into child briefs. It preserves E2E bug reproduction and warranted integration checks.
- **Why:** subagents repeatedly ran broad suites against the same dev database or replayed the full pipeline for a stage-only experiment.

## 06 · research · notes outside the repo

`patches/06-research-notes-outside-repo.patch`, added 2026-11-03.

- **What it does:** `/research` saves its notes to `~/.local/share/research/<repo>/<topic>.md` instead of inside the repo. Codex can write there only because `codex/config.toml.example` lists the folder in `writable_roots`, so a change of folder has to change both.
- **Why:** the notes are throwaway input to a decision, and a 109 KB notes file in one PR accounted for about $6.50 of its Macroscope review.

## 07 · wayfinder · research answers on the ticket

`patches/07-wayfinder-research-on-ticket.patch`, added 2026-11-03. Pairs with patch 06.

- **What it does:** `/wayfinder`'s research subagents post the answer and its sources on their ticket and point to the notes file, instead of pushing a `research/<name>` branch.
- **Why:** those branches kept throwaway notes in the GitHub repo long after the decision was made.
