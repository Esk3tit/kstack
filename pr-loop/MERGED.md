# When the user says merged

Read this when the user says a PR this loop ran has merged.

1. Use the cleanup skill to retire this run's resources, deleting its merged branches, and stop any PR watch the run started.
2. Close what the PRs finished: each ticket whose whole scope the merged PRs delivered and the merge did not close itself, and a parent once every child is closed and nothing on its checklist is left, ticking what the merge delivered. A ticket with work left stays open, with a comment saying what remains.
3. Check production runs the merge, following the deploy check the repo documents (`docs/deploy.md` or similar): report the deployed commit and, where the merge carries migrations, whether they applied. With no documented check, say so rather than guess.

Done when the cleanup inventory is empty or names a reason for each kept resource, the finished issues are closed, and the deploy state is reported.
