# Running a Fable pass

Read this when step 5's call for a round is to run Fable, or a design pause (step 2) wants its read.

Run it read-only, briefed with the round's diff and the whole PR's, the settled decisions (`log.sh --pins`) and the spec's agreed prototype, and what to look for: judgement calls, taste, simpler shapes of the problem and the code, edge cases, an adversarial read. For a design pause, brief it on the cluster the pause names instead, and carry its proposal to the user unapplied.

- **In Claude Code** it is a subagent with `model: fable`.
- **In Codex** it is `/Users/<you>/.codex/bin/claude-read claude-fable-5-2 "<brief>" [<extra dirs to read>]` (a copy of kstack `codex/bin/`), pointing the brief at files to Read; Codex allows only that read-only wrapper outside the sandbox, as a plain command.

Record it on the head it read: `log.sh --pass fable <head> clean|fixed`. A taste finding that departs from the agreed prototype is a prototype question (SKILL.md, **Review rounds**). Accepted changes are committed and start a new round, through step 4 once the PR is open.
