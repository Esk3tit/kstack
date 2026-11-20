# Auditing a test suite

An audit gives every test in a suite one verdict against [SKILL.md](SKILL.md), weighs it by what the test costs and what it has caught, and ends in tickets that cut the suite down. Notes go outside the repo, in the research folder (`~/.local/share/research/<repo>/test-audit/`); only the tickets and their PRs land in the repo.

1. **Cost.** Time every test, and sum per file. For a suite that runs quickly on this machine, run it once with the runner's JSON reporter. For a browser suite, take per-test durations from the latest green CI run's own shard logs, per engine; a merged report job may name no tests. Record each CI job's wall time beside them. Done when every test has a duration, or a stated reason it has none.

2. **History.** Read the last 60 days of CI failures (or as far back as the logs go), and sort each failed test episode by what turned it green:
   - **caught:** app code changed and the assertion stayed, so the test found a real problem;
   - **intended change:** observable behavior changed on purpose and the test was updated to match;
   - **coupled:** the test was edited though observable behavior did not change;
   - **flake:** a rerun of the same commit passed;
   - **infra:** the environment failed, not a test;
   - **unclear:** the evidence supports more than one of these.

   Collapse episodes into distinct bugs, since one bug often fails many variants of one case. Suites that run before every push catch most of their bugs on the author's machine, so their absence from CI history is missing evidence, not proof of no value. Done when every failed run in the window is sorted or listed as unreadable.

3. **Rules.** Show the owner the cost and history, and settle with them each call the bar leaves to the repo: which flows are core, whether a one-time change (an importer, a migration) is finished, which tools act unattended. Done when the auditors' brief can name a decision for every such call.

4. **Score twice.** Split the test files into areas of similar size. For each area, brief one auditor from each of two model families, independently, with this skill, the owner's decisions, and the cost and history notes. The auditors share one checkout, so they judge both edits by reading, every test body and the code it drives, and edit and run nothing. Each does step 1 of **Judging tests** and stops there, giving every test, as written in the source, a row: file, line, title, each failure it is for with its sound or unsound mark and the product code where that break would be made, the smell of every other check, and a one-line reason. Each also lists the important behavior it saw no test for. Done when every area has two complete tables.

5. **Reconcile.**
   - **Disagreements:** two rows agree when they list the same failures with the same marks, however worded, and an agreed row stands. Where they differ, a third reader from the strongest model at hand reads the test and rules, one area at a time; an auditor whose reason is generic carries no weight.
   - **Guards:** merge every area's settled rows into one table and group them by failure, using the code where each break would be made to find a failure's candidates. The third reader takes one failure at a time and does step 2 of **Judging tests**, with each test's own duration from the **Cost** step deciding which sound test is cheapest; once every failure has its guard, it does step 3 for each test. Then strike from the missing-test lists each behavior that now has a guard, sound or due a rewrite.
   - **Owner calls** (legal, brand, visual direction, a rule's edge) go to whoever the owner has delegated judgement to, and to the owner only when that delegate can't settle them or the step needs the owner's permission.
   - **Gaps in SKILL.md** a disagreement exposes: draft the clause each needs in the audit notes. The skill is shared by every repo, so the clause lands as its own change with the owner's yes.

   Done when every failure in the table names one guard, every test has one verdict, and every missing-test entry names a behavior with no guard.

6. **Hand over.** File one spec issue with a ticket per area, each to land as one PR. A ticket that removes a check whose failure's guard another ticket rewrites is blocked by that ticket, so CI keeps the check until its replacement lands; tickets that would block each other land together as one PR. Report what the verdicts project: tests and lines to delete, tests to rewrite, the wall time each CI job should save (for parallel shards, the slowest shard's time before the cut minus the slowest after it), and the missing tests to add. Label each figure a projection; the tickets' PRs measure the real ones.
