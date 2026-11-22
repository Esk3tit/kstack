---
name: pr-loop
description: Take an authorized finished branch or PR to merge-ready through review, valid comment fixes, affected checks, and recap. Use when asked to finish PR review or get a change ready to merge, or when the user says a PR it ran has merged.
---


# /pr-loop

Run the whole pre-merge loop on the current branch, and on the same-named branch in any sibling repo the change spans, without stopping to ask; a change that spans repos reads [CROSS-REPO.md](CROSS-REPO.md) before step 1. In Codex, read and follow `~/.codex/prompts/codexloop.md` for `/codexloop`, since Codex does not execute prompts itself. The user is away; the recap at the end is how they audit the run, so write each decision to the decision log as it is made (`~/.claude/skills/recap-pr/LEDGER.md`), and pass every change accepted from any reviewer through LEDGER's mechanism rule. The run ends with a hand-back (step 7's block for each PR); merging is the user's call.

## Review order

Every PR needs **Standards** and **Spec** (step 6's axes) and **Codex** (`/codexloop`) clean on the exact head handed back. Reviews run in two tiers, so the expensive ones read a settled head. **The cheap tier** (steps 1–4) loops freely: Codex to convergence, CI and the review bots that run on their own, and affected tests, until all of them have settled on one head. Fixes collect unpushed until step 1, the only step that pushes (its draft for CI aside). Step 5 then takes app evidence. **The tail** (step 6) runs on the head they settled on: Standards and Spec, Fable when its call says so, and the repo's final-pass reviewers.

- **Start.** Before step 1, log the run's start row in each repo's branch (`log.sh review me yes "pr-loop run started on <branch>" "a new run" none "head <sha>" accepted`) and, with no ticket, the request that authorized the work, quoted word for word in a `you` row, once, with any credential or signed URL replaced by `<redacted: what it was>` (`<redacted: settings mockup>`); then run `log.sh --check HEAD` there. "This run" means records made after this repo's latest start row: compare the time the check prints for a `NOT REVIEWED` pass with that row's `ts` in the log `log.sh --path` names.
- **Required passes** run, in their tier, only where the check's closing `Not clean on` or `Not reviewed on` line names them, so a pass already clean on the head is not rerun. Any new commit (a base merge, rebase or restack too) is a new head. Record every pass as it lands (LEDGER.md, **Review passes**).
- **A required pass whose reviewer cannot run or finish** (it fails or times out, or `/codexloop` exits `FAIL` on a reviewer error) is recorded `not-reviewed` and not rerun on that head in this run; a later run tries it again, and a clean result replaces the record. The run carries on as step 6 allows, unless step 1 stopped it on a head Codex could not review; a lint, test or merge failure is the run's to fix.
- **A finding that would undo** a change another pass's finding made in this run is logged `rejected`, plus an `open` row putting both findings to the user as one question.
- **Open questions.** Each `open` row the user has not answered goes into its PR's open questions as it is logged, and any one missing there goes in before each `log.sh --check` of the PR and at any hand-back.
- **Prototype questions.** A taste finding from Standards, Spec or Fable that departs from the spec's agreed prototype goes to the user as a question showing both pictures, the prototype as built and the proposal: one standalone gallery per question, under its own `--marker` (`no-mistakes-frontend` step 8), posted once on the PR. The prototype stays built until they choose.

## 1. Cross-family review to convergence

Run `/codexloop --until-converged --base <base>` on each branch. When only CI can judge the change (a failure seen only on CI's runners, a suite too heavy to run locally), open a draft PR first. A head short of this step's Done only by its push gets the same push by hand, through `/codexloop`'s step 4 confirmations and wait. A diverged remote hands back `Merge-ready: no: remote diverged`. A head Codex could not review stays unpushed and stops the run on that branch: hand back the branch, and its PR if one is open, with `log.sh --check <head>`'s output, the commits left unpushed and `Merge-ready: no: codexloop not reviewed`.

A `PAUSED` exit from `/codexloop` (its design pause), wherever this run calls it, stops the run on that branch: run Fable's read of the cluster as [FABLE.md](FABLE.md) says, and hand back the branch, and its PR if one is open, with the design question as the open item and `Merge-ready: no: design pause`.

Done when every branch has Codex clean on its head and that head on the remote; or has stopped on a design pause or on a head Codex could not review.

## 2. Open the PRs

Open one PR per repo against `<base>`, ready for review (review bots can skip drafts), with the `/pr` template, marked as closing the spec and tickets it finishes, its "Behavior changes vs master" section filled from the log's accepted rows with a `prod_delta` other than `none`. A branch that already has a PR keeps it, with its body updated the same way, and a draft opened under step 1 is marked ready. Then, in each repo, write its PR's facts block (`python3 ~/.claude/skills/recap-pr/facts.py <pr>`; a failure is retried in step 7) and post each pending prototype question's gallery.

Done when every repo with commits on the branch has an open PR carrying its facts block (or a `facts.py` failure left for step 7) and any pending prototype gallery.

## 3. Bot and CI findings

Commit any fix from steps 4, 5 and 7 and take it through step 1 first, so the comments pass reads the head that carries it. Follow [COMMENTS.md](COMMENTS.md) on each PR; a `LOOP_STATUS=FAIL` from it goes to step 7. Once it converges, a branch short of step 1's Done takes its head through step 1 and runs this step again.

A red check that passes on a re-run is an unexplained failure: diagnose it in this run as [FLAKY.md](FLAKY.md) says.

Done when every PR's head is pushed and has converged (COMMENTS.md, step 1), and every check that passed on a re-run has a reproduced cause or a `cause unknown` line. A final-pass reviewer is judged in step 6.

## 4. Affected tests

Run each repo's affected tests on the heads step 3 settled on, deriving the set from the diff as `/implement` does. Fix a failure that predates the branch too, in its own commit, logged with `asked no`; any fix goes back through step 3.

Record each final head, affected commands and collected/executed test results, review state, and unresolved items together in the decision log. Reuse evidence for unchanged inputs and revisions; a relevant fix reruns its affected checks. Done when the affected tests pass on the heads being handed back.

## 5. Verify in the running app

When a diff changes what a user sees or does (components, routes, styles, copy, a UI-facing API), run `/no-mistakes` through a route that drives the browser (frontend or full-stack, never backend-only), with a case for the change on screen, and post its screenshots and recordings to the PR. Run it on the head steps 1–4 settle on, and again only on a later head whose new commits fix what it found or change what a user sees or does. A fix it causes goes back through step 3. A diff that changes nothing a user sees or does skips this; log the run-or-skip and why.

Done when every PR whose diff changes what a user sees or does carries evidence taken on or after its last head whose new commits fixed what a run found or changed what a user sees or does, or a logged skip.

## 6. The tail

This step starts once steps 1–5 are done on a PR's head with Codex clean on it and every required CI check that is neither a review bot's nor a deploy ([COMMENTS.md](COMMENTS.md), **Reviewers vs. deploys**) finished: one of those gone red sends it back to step 3 first; otherwise one still `PENDING` sends it straight to step 7. Then run `log.sh --check <head> <pr>`, handling a moved head or an error as step 7's item 3 does, and run [TAIL.md](TAIL.md) on that head.

Once Standards, Spec and Fable finish, commit their fixes and take them through step 1, whose push waits out the final-pass reviews; then run step 3, which works those reviewers' findings. Steps 4 and 5 follow for what the fixes touch, and this step runs again, on the head they settle on, until its Done holds.

Done when the check, run again, exits 0, or 3 with every pass it names recorded `not-reviewed` by this run; each head's Fable call is logged; every finding is fixed, logged as rejected with a reason, or logged with result `open` as a question for the user; and each final-pass reviewer is done (TAIL.md, **The final pass**, "It's done").

## 7. Recap and hand-back

1. Follow `~/.claude/skills/recap-pr/SKILL.md`.
2. Once CI has finished on each final head, or passed its deadline (COMMENTS.md, **Waits**), or at once after a FAIL from step 3, refresh its PR's facts block from its repo: step 2's `facts.py <pr>`.
3. After a FAIL from step 3, or on a head step 6 sent straight here, skip to item 4: the check only reports. Otherwise run `log.sh --check <head> <pr>` in its repo, and the passes it names, as step 6 runs them: decision rows a Spec read adds rebuild the recap (item 1) before the next check, and a changed fact or the recap's edit reruns Spec, so Spec reads the finished description last. A pass that changes the code sends it back through steps 3 to 6, then step 7 starts again from item 1 on the new head; so does a PR missing a push of the head checked, while one whose head moved to a commit this run did not push hands back `Merge-ready: no: pushed from elsewhere`. A `gh` error (exit 2) is retried once; any error then hands back `Merge-ready: no: check could not run: <its message>`.
4. Refresh only the block's review record (`facts.py <pr> --record-only`), keeping the facts Spec read, and run the check a last time: its output is the one handed back. Exit 3 (only `not-reviewed` passes left) hands back `Merge-ready: no: <passes> not reviewed`; any other failure of the check goes back to item 3, unless item 3 skipped to item 4. A `facts.py` failure at item 2 or 4 goes back to item 2, which rebuilds a missing block; a second one in this step hands back `Merge-ready: no: facts block not written: <its message>`.
5. Hand back this block for each PR, every line filled from the final head (across repos, with CROSS-REPO.md's merge order):

```text
PR <url>: <what it changes, in a user's words> · head <sha> · merge order <n>
Required passes: <log.sh --check's output, whole>
Fable: <last read <sha> (<verdict>), as the check lists it | not run> · later heads: <the logged call for them and its reason>
Reviewers on this head: <each review bot and final-pass reviewer: passed | failed: why | NOT_REVIEWED: reason | its final-pass report>
Open findings: <none | each one>
CI on this head: <each check and its conclusion from the facts block, with test counts where the repo's facts give them; a check that passed on a re-run, with its cause or `cause unknown`: which>
App evidence: <taken on <sha> | skipped: reason>
Merge-ready: <yes | yes, after <sibling PR> merges | no: what blocks it>
```

After a FAIL from step 3, `Merge-ready: no: <its ERROR>` comes first among the blockers, naming any commits left unpushed. A deploy job's result is reported but never sets `Merge-ready: no`; a failed reviewer, an open finding, a failing or still-pending required CI check, a required pass this run recorded `not-reviewed` on the final head, or `log.sh --check` exiting non-zero does. A description edit after the hand-back (a settled question) reruns Spec and the check before a `yes` stands again.

Done when `recap.html` exists beside the log, every PR body's "Behavior changes vs master" section matches it, each PR's facts block was written on its final head or its failure handed back, and each PR's block is handed back with its check's output.

## When the user says merged

Follow [MERGED.md](MERGED.md): retire the run's resources, close what the PRs finished, and report the deploy.

## Waits, delegation and close-out

Every wait in the run, on a bot, a check, a delegated round or a child, follows [COMMENTS.md](COMMENTS.md), **Waits**. Before delegating, read [HANDOFF.md](HANDOFF.md). Before declaring the session safe to archive, use the cleanup skill, and pull any cloud machine's memory as HANDOFF.md says.
