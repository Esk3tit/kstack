# Auditing a test suite

An audit gives every test a verdict by **Choosing what stays** in [SKILL.md](SKILL.md) and ends in tickets that cut the suite down. Notes go in `~/.local/share/research/<repo>/test-audit/`; only the tickets and their PRs land in the repo.

1. **Cost.** Time every test and every CI job.
2. **History.** Sort the last 60 days of CI failures by what turned them green: a bug caught, an intended change, a test edited though behavior held, a flake, or the environment. Count each bug once. A suite run before every push catches bugs on the author's machine, so a quiet history is missing evidence, not proof of no value.
3. **Rules.** Show the owner the cost and history, and settle what the skill leaves to the repo: which flows are core, which one-time changes are finished, which tools act unattended.
4. **Score.** Split the suite into areas. Two auditors from different model families read every test and the code it drives, independently and without editing anything, and give each test the outcomes it is for, whether it passes the bar on each, and a one-line reason. Each lists the important outcomes no test guards. A third reader settles where they differ.
5. **Choose.** Across the whole suite, pick each outcome's guard and read off every verdict, so a duplicate in one area names its guard in another. Owner calls (legal, brand, a rule's edge) go to the owner's delegate first. Done when every test has one verdict.
6. **Hand over.** File one spec issue with a ticket per area. A ticket that deletes tests leaning on a rewrite waits for that rewrite to land. Report the projected cuts, rewrites, CI time saved per job and missing tests, labelled as projections.
