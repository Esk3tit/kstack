# A check that passed on a re-run

Read this when a red check passes on a re-run (step 4): it is an unexplained failure, diagnosed in this run.

Diagnose it through the repo's CI-only reproduction recipe (in its CI or e2e doc) and the `diagnosing-bugs` skill. The diagnosis ends when:

- a cause is reproduced, by a command that fails on it as `diagnosing-bugs` requires: a cause in the change is a finding like any other, and one older than the branch is step 7's own-commit fix;
- or the recipe has run without reproducing the failure;
- or, with no recipe, `diagnosing-bugs` has read the failing run's log and artifacts without reproducing one.

In those last two cases the hand-back's CI line reports `cause unknown` and says which.
