# Running a Fable pass

Read this when the tail's call is to run Fable (SKILL.md, **Review order**), or at a design pause (step 1).

Run it read-only, briefed with the diff since the last head it reviewed and the whole PR's, the settled decisions (`log.sh --pins`) and the spec's agreed prototype, and what to look for: judgement calls, taste, simpler shapes of the problem and the code, edge cases, an adversarial read. For a design pause, brief it on the cluster the pause names instead, and carry its proposal to the user unapplied.

- **In Claude Code** it is a subagent with `model: fable`.
- **In Codex** it is `/Users/<you>/.codex/bin/claude-read claude-fable-5-2 "<brief>" [<extra dirs to read>]` (a copy of kstack `codex/bin/`), pointing the brief at files to Read; Codex allows only that read-only wrapper outside the sandbox, as a plain command.

Record the tail's pass on the head it read: `log.sh --pass fable <head> clean|fixed`, or `not-reviewed` when it cannot run or finish, which the hand-back's Fable line reports. A design-pause read reviews the cluster, not the head, so log it as a decision row carrying its proposal rather than a pass. A taste finding that departs from the agreed prototype is a prototype question (SKILL.md, **Review order**). Accepted changes are committed with the tail's other fixes (SKILL.md, step 6).
