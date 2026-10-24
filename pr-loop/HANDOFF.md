# Agent handoff

Read this before delegating implementation, evaluation or verification. Put these facts in the child brief:

- The deliverable, fixed revision and owned checkout or resources. Give isolated worktrees to concurrent writers; otherwise keep edits serial in the parent.
- The affected tests and their inputs. Stage experiments use frozen packets through `~/.agents/skills/eval/SKILL.md`; retain E2E bug reproduction and final integration checks for changed boundaries.
- Required skills. Prompt and agent-instruction edits use `~/.agents/skills/writing-for-agents/SKILL.md`.
- One owner for shared services and database tests. Children coordinate with that owner instead of independently resetting or testing the same database.
- The return contract: changed paths, revision or patch, collected/executed checks, retained resources and unresolved findings. Account for how isolated edits reach the parent before calling them fixed.

A child follows its own authorized brief. A completed turn can still have live jobs; carry those identities into close-out.
