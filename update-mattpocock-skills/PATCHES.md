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

## 08 · grilling · persistent project learning

`patches/08-grilling-learning-mode.patch`, added 2026-11-03.

- **What it does:** connects grilling to the directly maintained `learning/` module in kstack, installed as `~/.agents/learning`. It supplies one shared corrective teaching workflow, private .learning notes, onboarding, read-only state lookup, and confirmed reset with backups. Learning starts off; enabling or pausing it is remembered per checkout. Off-mode entry reads only the mode-check guide and helper output; teaching and management instructions load on their respective branches, with privacy enforced before learning-note writes. Ordinary grilling retains its recommended answers while off. The module contains the attribution, MIT notice, templates, and regression tests. No startup hook is registered.
- **Why:** combine Matt's workflow with Vibe Wise's learning memory and lifecycle in one maintained source, so development teaches independent reasoning without losing candid technical correction or adding a competing plugin.

## 09 · implement · learning handoff

`patches/09-implement-learning-mode.patch`, added 2026-11-03. Apply after patch 05; requires the shared `~/.agents/learning` module.

- **What it does:** reads the shared learning guide at implementation entry to resolve the saved project mode. When active, implementation returns to discussion for substantial unresolved design decisions, briefly explains the result, and records learning evidence. It keeps all ordinary implementation steps and uses the same notes as grilling.
- **Why:** resume learning across threads without adding a second teaching workflow, duplicate progress records, or duplicate approvals.

## 10 · implement-spec · shared learning handoff

`patches/10-implement-spec-learning-mode.patch`, added 2026-11-03. Apply after patch 02; requires the shared `~/.agents/learning` module.

- **What it does:** the parent coordinating a spec reads the same saved mode and learning guide as ordinary implementation. The parent owns the learning conversation and notes while workers report substantial unresolved decisions or contradictions in the agreed design.
- **Why:** keep the normal spec implementation path in the same learning workflow without adding a second set of rules or progress records.

## 11 · implement-spec · PR opens after review

`patches/11-implement-spec-pr-after-review.patch`, added 2026-11-04. Apply after patches 02 and 10.

- **What it does:** `/implement-spec` stops opening a draft PR after its first merge. It reports the integration branch and what its PR will close, and `/pr-loop` opens that PR once the cross-family review has converged.
- **Why:** Bugbot and Macroscope reviewed drafts, so each integration push billed them before any cross-family review. wt-records PR #411's first Bugbot review came three hours before it was marked ready.

## 12 · code-review · bounded reads, findings that close, the live PR body

`patches/12-code-review-bounded-reads-closing-findings.patch`, added 2026-11-16.

- **What it does:** each sub-agent brief lists every source with its size and the route for a large one (slices with `offset` and `limit`, or `ctx_execute` with `file=`), and the reviewer still accounts for every rule. A wording finding names the concrete misreading the current words invite, and a rename covers the whole naming family. A caller can ask for one axis alone, such as a Spec re-check after a description edit. A taste finding that departs from the spec's agreed prototype is a question for the user, with both pictures, and the prototype stays built. When the branch's open PR has the reviewed commit as its head, Spec reads its live body, saved to a file the caller can name, and checks each figure and coverage claim against its source, keeping "no measurable difference" apart from "unchanged" and "observed" apart from "inferred". `/pr-loop` depends on this patch.
- **Why:** in the tech-tree work, about 60 reviewer reads of large standards and diff files (`CODING_STANDARDS.md` is 20 KB) were refused across six sessions; wording findings went back and forth for three rounds and a rename took three; a centred picture Fable proposed was built, then reversed by the owner; and four late description checks returned 20 findings, wrong figures and coverage claims among them.

## 13 · pr · facts block and live-body edits

`patches/13-pr-facts-block-live-body.patch`, added 2026-11-16. Apply after patch 04; its context lines come from it.

- **What it does:** the template carries a "Facts" section holding the markers `recap-pr/facts.py` fills from its sources, and the body cites those figures rather than retyping them. Any edit to a PR description starts from the live body, keeps every other section (bots' included), and is read back. The behavior section lists developer- and agent-facing changes (`dev:` rows) apart. `/pr-loop` and `/recap-pr` depend on this patch.
- **Why:** hand-typed check counts, test totals, byte figures and lists of PRs a base merge brought in drifted in every PR of the tech-tree work, and one edit deleted Macroscope's summary.

## 14 · retro · start from the session summary

`patches/14-retro-session-summary.patch`, added 2026-11-16. Requires `recap-pr/session_summary.py` from kstack.

- **What it does:** a retro on a Claude Code session starts from the session summary's counts of executed tool calls, errors, hook denials, indexed outputs and compaction summaries, with their definitions, and counts any figure it does not print by the same definitions.
- **Why:** the #579 retro first counted 336 agent calls and 157 Codex runs; the real figures were 203 and 85, because replayed API copies in the log were counted as new work.

## 15 · tdd · the testing skill decides what stays

`patches/15-tdd-testing-skill-decides-what-stays.patch`, added 2026-11-19. Requires kstack's `testing` skill.

- **What it does:** before the first test of a red → green loop, and again before committing the tests a loop leaves behind, the agent loads the `testing` skill, which decides whether a behavior earns a committed test or is checked once at the change.
- **Why:** a WT Records audit marked 1,257 of its 3,947 tests for deletion (vacuous, tied to implementation, duplicated, looks-only, or guarding one-time changes), most of them committed by loops that kept every test they wrote.

## 16 · diagnosing-bugs · the testing skill decides what stays

`patches/16-diagnosing-bugs-testing-skill-decides-what-stays.patch`, added 2026-11-19. Requires kstack's `testing` skill.

- **What it does:** a new last step of Phase 5 hands the decision of what stays to the `testing` skill's bug-fix rule, and the Phase 6 checklist accepts either a committed regression test or its red-then-green output in the PR.
- **Why:** Phase 5 made a permanent regression test the default for every bug with a seam, which is how looks-only and pinned reproductions piled up in WT Records' browser suite.
