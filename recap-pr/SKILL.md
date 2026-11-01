---
name: recap-pr
description: "Pre-merge recap of a ticket's PRs: every decision made during hands-off work, every behavior change versus master, and anything nobody asked for."
disable-model-invocation: true
---

# /recap-pr

The user is about to merge and was not watching every loop. Give them the whole story: what changed for the people who use the product, who decided it, and why. The source is the ticket's **decision log** (format and location: [LEDGER.md](LEDGER.md)); this skill backfills it, checks it against master, and renders it.

Arguments: optional PR numbers or a ticket key. Default: the current branch's PR plus same-named branches' PRs in sibling repos.

## 1. Gather

List every PR in scope: the ones named in the arguments; for a ticket key, the PRs linked on the ticket plus `gh pr list --state all --search <key>` in each repo the log or ticket names; else `gh pr list --head <branch>` in those repos. A ticket with no PR found is listed under Attention. For each, read its head SHA and base from `gh pr view <n> --json headRefOid,baseRefName`, fetch both, and work from `git diff origin/<base>...<head SHA>`; every later step uses that exact head, never the current checkout. Find the PR's logs from its own repo and head branch, never the current checkout: every key in its key file (LEDGER.md, "Where it lives"); with no key file, its ticket; with neither, `<repo>-<head branch, encoded>`. Read the union of those logs, drop duplicate rows, and order by `ts`. Write new rows with `RECAP_KEY` set to the key file's last key (else the derived key).

Done when every PR in scope and its diff are in hand.

## 2. Backfill the log

Rows go missing during long runs. Cross the log against what actually happened:

- every commit on each PR (`git log origin/<base>..<head SHA>`, with the refs captured in step 1);
- every review thread and reviewer finding (`gh` threads, Codex results, Fable/Standards/Spec reports);
- every question the user answered, in every session that worked on the branch: follow [HISTORY.md](HISTORY.md) for T3, native Codex durable history and legacy JSONL, and Claude transcripts. Verify authorship and deduplicate mirrored or inherited messages. Put missing, truncated, or unsupported history under Attention as a coverage gap.

Append a `backfill` row for each one with no row behind it, with `RECAP_TS` set to when it happened (the commit time, the finding's time, the transcript message's time) so the log stays in time order. Done when each commit, finding and user answer maps to at least one row.

## 3. Parity sweep

The log only holds what the agent knew it changed. A **divergence** is a difference from master that nobody decided: the regression nobody logged. Find them by observation.

List every surface the diffs touch that someone outside the code experiences: rendered UI (placement, order, collapse state, labels, styling), customer-facing text, API payloads, LLM inputs and prompts, where and how data is stored, throughput and latency limits, notifications.

Choose inputs that exercise every branch the diff changes: for each new or edited condition, a real record that takes each side of it (an event with a linked document, one without). On UI surfaces, open every toggle, tab and collapsed section the change touches before comparing.

For each surface, put master and the branch side by side on the same real input:

- UI: screenshot the master build and the branch build on the same event. Prod runs master, so a prod event is the cheapest master view (read-only); otherwise use a master worktree on a second port.
- Backend: run both on the same stored input, or compare outputs the tests already pin down.
- When neither can run, read the diff for that surface and mark the pair `read only`; it goes under Attention as unverified.

Only an accepted row can explain a difference. Every difference no accepted row's `prod_delta` explains becomes a `parity` row (`source me`, `asked no`, `result open`), including one that matches a rejected, reverted or superseded row: that change is still in the code.

Done when every listed surface has a master/branch pair or a stated reason it cannot be observed.

## 4. Second opinion

Hand the log, the diffs and the parity pairs to a reviewer from a different model family from the one that did most of the work: Codex `gpt-6.1-sol` through the companion `task`, read-only, when Claude implemented; Claude Opus 5.5 when Codex did. From Codex, run it as the plain command `/Users/<you>/.codex/bin/claude-read claude-opus-5-5 "<brief>" [<extra dirs to read>]` (a copy of kstack `codex/bin/`, the only read-only Claude entry Codex allows outside the sandbox), pointing the brief at files to Read. It flags:

- `prod_delta none` rows whose diff says otherwise;
- accepted `asked no` rows that add a mechanism or widen scope;
- rows whose evidence does not show what they claim;
- anything a skim of the recap would miss.

Done when the reviewer's flags are in hand, or it reports none.

## 5. Recap

Write `recap.md` beside the log and print it. Group by surface within each section; one line per decision: what changed, why, who proposed it, evidence.

```markdown
## Divergences nobody decided
## Behavior changes vs master
## Not asked for
## Rejected or reverted
## Decided, no behavior change
## Attention
reviewed by <model>
```

`Not asked for` holds accepted `asked no` rows, mechanisms first. `Attention` holds step 4's flags and any other `open` row, or "No flags".

Then refresh each PR body's `## Behavior changes vs master` section (the `/pr` template) from the changes still in that PR's final diff: accepted rows with a `prod_delta` other than `none`, plus open parity divergences. Rejected, reverted and superseded rows stay in the recap's "Rejected or reverted" section only.

`Decided, no behavior change` holds accepted `asked yes` rows with `prod_delta none`.

Done when every log row and every parity row appears in exactly one section: a superseded or retracted row in `Rejected or reverted`, an accepted `asked no` row in `Not asked for`, any other row in the first section above that fits.
