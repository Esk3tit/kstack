---
name: pr-loop
description: Take an authorized finished branch or PR to merge-ready through review, valid comment fixes, affected checks, and recap. Use when asked to finish PR review or get a change ready to merge, or when the user says a PR it ran has merged.
---


# /pr-loop

Run the whole pre-merge loop on the current branch, and on the same-named branch in any sibling repo the change spans, without stopping to ask; a change that spans repos reads [CROSS-REPO.md](CROSS-REPO.md) before step 1. The loop is the same in Claude Code and Codex, and this shared skill is authoritative (slash commands are aliases): in Codex, read and follow `~/.codex/prompts/<command>.md`, since Codex does not execute those prompts itself; in Claude Code, use `~/.claude/commands/<command>.md`. The user is away; the recap at the end is how they audit the run, so write each decision to the decision log as it is made (`~/.claude/skills/recap-pr/LEDGER.md`), and pass every change accepted from any reviewer through LEDGER's mechanism rule. The run ends with a hand-back (step 8's block for each PR); merging is the user's call.

## Review cycles

Every PR needs **Standards** and **Spec** (step 1's axes; Spec also reads the PR description) and **Codex** (`/codexloop`) clean on the exact head handed back. A **cycle** is one trip through the pass sequence on a new head.

- **Start.** Before step 1, log the run's start row in each repo's branch (`log.sh review me yes "pr-loop run started on <branch>" "a new run" none "head <sha>" accepted`), then run `log.sh --check HEAD` there. "This run" means records made after this repo's latest start row: compare the time the check prints for a `NOT REVIEWED` pass with that row's `ts` in the log `log.sh --path` names.
- **The pass sequence** runs, in order, step 1's axes and then `/codexloop --until-converged --base <base>`, each only where the check's closing `Not clean on` or `Not reviewed on` line names it, with Fable between them when the cycle warrants it. It repeats until the check exits 0, or exits 3 with every pass it names recorded `not-reviewed` by this run, and each cycle's Fable call is logged; a pass an earlier run left `not-reviewed` is tried again in its place. Any new commit (a base merge, rebase or restack too) starts a new cycle; a pass already clean on the head is not rerun. Record every pass as it lands (LEDGER.md, **Review passes**).
- **Fable**, on each cycle, runs when the changes since the last head it reviewed (`last read` in the check; the whole PR if none) carry new judgement: a design or behaviour change its users or agents will feel, a call the mechanical reviews keep circling, or coupling a reviewer has to hold in their head. Changes that only carry out findings already settled, and mechanical edits, go without it. Log the call and its reason either way, and when it runs, follow [FABLE.md](FABLE.md). Its findings are worked like any other; its record never gates merge-ready.
- **A required pass whose reviewer cannot run or finish** (it fails or times out, or `/codexloop` exits `FAIL` on a reviewer error) is recorded `not-reviewed` and not rerun on that head in this run; a later run tries it again, and a clean result replaces the record. The run still runs its other passes, makes a guarded push and carries on through steps 3 to 8, where step 8 hands it back as `Merge-ready: no`; a lint, test or merge failure is the run's to fix.
- **A finding that would undo** a change another pass's finding made in this run is logged `rejected`, plus an `open` row putting both findings to the user as one question.
- **Pushes.** A head reaches the remote only once the check exits 0 or 3 (step 2's draft-PR pushes for CI aside; `/codexloop`'s step 4 holds its push), and the sequence ends with a **guarded push**: `git push -u origin HEAD` from a branch other than `master`/`main` that has commits beyond the base, made when the remote lacks the head and never forced; a diverged remote hands back `Merge-ready: no: remote diverged`.
- **Prototype questions.** A taste finding from Standards, Spec or Fable that departs from the spec's agreed prototype goes to the user as a question showing both pictures, the prototype as built and the proposal: one standalone gallery per question, under its own `--marker` (`no-mistakes-frontend` step 8), posted once, when the PR is open (step 3). The prototype stays built until they choose.

## 1. Two-axis review

Run `/code-review` on each repo's branch for the axes on the check's closing line (skip it when that names neither), with the fixed point `origin/<base>` (the branch it merges into), the spec given up front (the ticket, or with none the request that authorized the work, quoted word for word in a `you` row so every run reads it, plus the user's settled decisions, `log.sh --pins`), and `spec-body-<head>.md` beside the log named as the file it saves the PR body to (on every Spec run, step 8's too). Fix every hard violation and every spec gap; take a judgement call only when it makes the change simpler or clearer. Log each finding with its outcome, and record each axis that ran on the head it reviewed: `log.sh --pass standards <head> clean|fixed`, and `log.sh --pass spec <head> clean|fixed [<body file>]`, giving that file when Spec read it.

Done when each branch's findings are fixed, logged as rejected with a reason, or logged with result `open` as questions for the user, and each axis that ran is recorded.

## 2. Cross-family review to convergence

When only CI can judge the change (a failure seen only on CI's runners, a suite too heavy to run locally), open a draft PR first. Run the pass sequence on each branch; `/codexloop`'s reviewer is the other model family (Codex from Claude Code, Claude Opus 5.5 from Codex).

A `PAUSED` exit from `/codexloop` (its design pause), wherever this run calls it, stops the run on that branch. A design pause is a call the mechanical reviews keep circling, so it runs Fable's read of the cluster as [FABLE.md](FABLE.md) says, logged and carried to the user unapplied. Hand back the branch, and its PR if one is open, with the design question as the open item and `Merge-ready: no: design pause`.

Done when every branch has converged, or has only passes this run recorded `not-reviewed` left, and its head is on the remote; or has stopped on a design pause.

## 3. Open the PRs

Open one PR per repo against `<base>` with the `/pr` template (a change across repos adds CROSS-REPO.md's merge order and links), marked as closing the spec and tickets it finishes, its "Behavior changes vs master" section filled from the log's accepted rows with a `prod_delta` other than `none`, and the log's `open` rows listed as open questions. A branch that already has a PR keeps it, with its body updated the same way, and a draft opened under step 2 is marked ready. Then, in each repo, write its PR's facts block (`python3 ~/.claude/skills/recap-pr/facts.py <pr>`; a failure is retried in step 8) and post each pending prototype question's gallery.

Done when every repo with commits on the branch has an open PR carrying its facts block (or a `facts.py` failure left for step 8) and any pending prototype gallery.

## 4. Bot and CI findings

Commit any fix from steps 5–7. A branch with unpushed commits first runs the pass sequence. Then follow `/address-pr-comments` on each PR, judging every bot finding and red check on the pushed head without another selection prompt; a `LOOP_STATUS=FAIL` from it goes to step 8 without waiting for CI and hands back `Merge-ready: no: <its ERROR>`. Its finalize step sends accepted fixes through the same passes, and `/codexloop` picks up from its last logged round (Round scope).

A red check that passes on a re-run is an unexplained failure: diagnose it in this run as [FLAKY.md](FLAKY.md) says.

Done when every PR has converged, has no open bot finding (threads and review-body items alike), and every reviewer on its final pushed head has reviewed that head and passed, or is reported `NOT_REVIEWED` or `PENDING` (the `/address-pr-comments` convergence gate), and every check that passed on a re-run has a reproduced cause or a `cause unknown` line. A final-pass reviewer is judged in step 7.

## 5. Verify in the running app, when the diff changes what renders

When a diff changes what a user sees or does (components, routes, styles, copy, a UI-facing API), run `/no-mistakes` on the final head through a route that drives the browser (frontend or full-stack, never backend-only), with a case for the change on screen, and post its screenshots and recordings to the PR (across repos, the one CROSS-REPO.md names). A diff that changes nothing on screen skips this; log the run-or-skip and why. A fix it causes goes back through step 4, and the evidence is retaken on the head that fix produces.

Done when every PR whose diff changes what renders carries evidence from its final head, or a logged skip.

## 6. Affected tests

Run each repo's affected tests on the final heads, deriving the set from the diff as `/implement` does. Fix a failure that predates the branch too, in its own commit, logged with `asked no`; any fix goes back through step 4, and through step 5 when it changes what renders.

Record each final head, affected commands and collected/executed test results, review state, and unresolved items together in the decision log. Reuse evidence for unchanged inputs and revisions; a relevant fix reruns its affected checks. Done when the affected tests pass on the heads being handed back.

## 7. Final pass

When the repo names final-pass reviewers (`/address-pr-comments`, **The final pass**), make the call for each one on each PR once steps 4–6 are done on that PR's final head, and post the requests you make together, so they review last. Then run step 4, which waits for their reviews and works their findings; steps 5 and 6 follow for the fixes they touch. Each time steps 4, 5 and 6 settle on a new head, make the call again.

Done when each final-pass reviewer is done (**The final pass**, "It's done") and steps 5 and 6 are done for its fixes. A repo that names none skips this step.

## 8. Recap and hand-back

1. Follow `~/.claude/skills/recap-pr/SKILL.md`.
2. Once CI has finished on each final head, or passed its deadline (**Waits** in `/address-pr-comments`), or at once after a FAIL from step 4, refresh its PR's facts block from its repo: step 3's `facts.py <pr>`.
3. Run `log.sh --check <head> <pr>` in its repo, and the pass sequence while it names passes to run: a changed fact or the recap's edit reruns Spec, so Spec reads the finished description last. A pass that changes the head sends it back through steps 4 to 7, then step 8 starts again from 1 on the new head; so does a PR whose head is not the one checked (moved on, or missing a push). A stale body the run did not cause means a bot or person changed the description: compare it with `spec-body-<head>.md` and restore an edit only where a bot wrote back an older copy, as `/pr`'s **Editing the body** says, keeping a person's change; then rerun Spec. A `gh` error (exit 2) is retried once; any error then hands back `Merge-ready: no: check could not run: <its message>`.
4. Refresh only the block's review record (`facts.py <pr> --record-only`), keeping the facts Spec read, and run the check a last time: its output is the one handed back. Exit 3 (only `not-reviewed` passes left) hands back `Merge-ready: no: <passes> not reviewed`; any other failure of the check goes back to 3. A `facts.py` failure at 2 or 4 goes back to 2, which rebuilds a missing block; a second one in this step hands back `Merge-ready: no: facts block not written: <its message>`.
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

A deploy job's result is reported but never sets `Merge-ready: no`; a failed reviewer, an open finding, a failing or still-pending required CI check, a required pass this run recorded `not-reviewed` on the final head, or `log.sh --check` exiting non-zero does. A description edit after the hand-back (a settled question) reruns Spec and the check before a `yes` stands again.

Done when `recap.html` exists beside the log, every PR body's "Behavior changes vs master" section matches it, each PR's facts block was written on its final head or its failure handed back, and each PR's block is handed back with its check's output.

## When the user says merged

Follow [MERGED.md](MERGED.md): retire the run's resources, close what the PRs finished, and report the deploy.

## Waits, delegation and close-out

Every wait in the run, on a bot, a check, a delegated round or a child, follows **Waits** in `/address-pr-comments`. Before delegating, read [HANDOFF.md](HANDOFF.md). Before declaring the session safe to archive, use the cleanup skill to account for owned processes, brokers, servers, Docker resources, and retained worktrees, and pull any cloud machine's memory as HANDOFF.md says. A completed agent turn is not proof that its jobs have finished.
