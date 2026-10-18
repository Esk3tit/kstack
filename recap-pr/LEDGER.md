# The decision log

A ticket's work leaves a **decision log**: one TSV row per decision, so the reviewer can audit hands-off work without reading the whole diff. `/recap-pr` reads it before merge.

## Where it lives

`~/.local/share/recap/<key>/decisions.tsv`. `<key>` is `$RECAP_KEY` when set, else the ticket in the branch name or commit subjects (`PRO-2725`; pattern `$RECAP_TICKET_RE`, default `pro-[0-9]+`), else `<repo>-<branch>`. A branch keeps the key of its first row (`~/.local/share/recap/.branch-keys/`), so a later commit naming a ticket does not move its log. `RECAP_KEY` routes rows without registering anything; `log.sh --bind <key>` points the current branch at a log on purpose and moves any rows it had already logged elsewhere. One log spans every repo a ticket touches, so set `RECAP_KEY` when sibling branches might not carry the ticket. It is local only and never committed.

## Writing a row

```bash
~/.claude/skills/recap-pr/log.sh <phase> <source> <asked> <decision> <why> <prod_delta> <evidence> <result>
```

The helper finds the log from the current repo's branch, writes the header on first use, stamps `ts` and `repo`, and flattens tabs and newlines. `log.sh --path` prints the log path; `log.sh --pins` prints the settled decisions.

| column | holds |
|---|---|
| `phase` | `implement`, `review`, `codexloop`, `pr-comments`, `fable`, `e2e`, `user`, `parity`, `backfill` |
| `source` | who proposed it: `you` (the user), `me` (the agent writing), `codex`, `fable`, `review` (Standards/Spec subagents), `bot:<name>` (Gemini, BugBot, Codex connector) |
| `asked` | `yes` when the user or the ticket asked for it; `no` when an agent or reviewer chose it |
| `decision` | what was chosen or done, one line |
| `why` | the reason, in plain words |
| `prod_delta` | what analysts, customers or ops will see differently from **master**, or `none` |
| `evidence` | commit SHA, `file:line`, PR comment URL, screenshot path |
| `result` | `accepted`, `rejected`, `reverted` or `open`, plus the verification (`tests green`, `screenshot`) |

## What earns a row

- Every answer the user gives to a design question (`source you`, `asked yes`). These are the **settled decisions**: `log.sh --pins` feeds the accepted ones to Codex as focus text. When the user changes one, log the new answer with a `result` that ends in `supersedes: <the old row's decision text>` (anything else, like verification, goes before it: `accepted, tests green; supersedes: quotes above the alert text`); the old row drops out of the pins.
- Every reviewer finding, accepted or rejected, with the reason.
- Every change whose `prod_delta` is not `none`, whoever proposed it.
- Every added **mechanism** (see below).
- Every pivot, revert, and choice the spec left open.

A trivial edit with no choice in it and no behavior change gets no row.

## The mechanism rule

A **mechanism** is a semaphore or concurrency cap, cache, retry, batch, timeout, feature flag, or a new place data is stored. Whoever proposes one (implementer, Codex, Fable, a bot), it is accepted only when its `why` names a problem measured in this code or its data: a number, a trace, a log line, a failing test. A plausible risk is not a measurement. Without one the row is `rejected`. Accepted or rejected, its row has `asked no` unless the user or ticket asked for it, so `/recap-pr` lists it under "Not asked for".

## prod_delta is measured against master

Compare with what master does today, never with the branch's previous commit. A fix that restores master behavior the branch had broken is `none (restores master)`, and the row that broke it should already carry the delta. Placement, ordering, labels, collapse state, wording, throughput and storage location all count as behavior.

```
ts	repo	phase	source	asked	decision	why	prod_delta	evidence	result
2026-10-16T18:02:11Z	AI-ARG	implement	me	no	put Show quotes above the alert text	evidence reads before the claim	analysts see quotes above the alert text; master shows them below	commit 1a2b3c4	reverted after the analyst flagged it
2026-10-16T19:40:05Z	TPRM-API	codexloop	codex	no	cap cold-record fetches with a semaphore of 8	avoid bursts against S3	comparisons load slower on busy days	src/cont_mon/event_artifacts.py:41	rejected: no measured S3 pressure
2026-10-16T20:15:30Z	TPRM-API	user	you	yes	newly linked documents are Added and sit in the main list	the new link is the change	linked quotes return to the main list, now labelled Added	PR #3164	accepted
```
