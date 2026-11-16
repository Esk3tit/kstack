# The decision log

A ticket's work leaves a **decision log**: one TSV row per decision, so the reviewer can audit hands-off work without reading the whole diff. `/recap-pr` reads it before merge.

## Where it lives

`~/.local/share/recap/<key>/decisions.tsv`. `<key>` is `$RECAP_KEY` when set, else the ticket in the branch name or commit subjects (`PRO-2725`; pattern `$RECAP_TICKET_RE`, default `pro-[0-9]+`), else `<repo>-<branch>`. A branch keeps the key of its first row, so a later commit naming a ticket does not move its log. `RECAP_KEY` routes single writes made on another branch's behalf (the `/recap-pr` backfill) and registers nothing; to move a branch's own logging, use `log.sh --bind <key>`, which points it at another log from then on; rows never move, so the branch's key file (`~/.local/share/recap/.branch-keys/<repo>--<branch, % as %25 and / as %2F>`) lists every key it has used, newest last, and `/recap-pr` reads them all. One log spans every repo a ticket touches; point a sibling branch that lacks the ticket at it with `log.sh --bind <key>`. Review passes go to `reviews.tsv` beside it (**Review passes**, below). It is local only and never committed.

## Writing a row

```bash
~/.claude/skills/recap-pr/log.sh <phase> <source> <asked> <decision> <why> <prod_delta> <evidence> <result>
```

After any change to `log.sh`, run `bash test-log.sh` beside it. The helper finds the log from the current repo's branch, writes the header on first use, stamps `ts` (or `$RECAP_TS` for a backfilled row, in UTC `YYYY-MM-DDTHH:MM:SSZ`; other formats are refused so rows sort as text) and `repo`, and flattens tabs and newlines. `log.sh --path` prints the log path; `log.sh --pins` prints the settled decisions.

| column | holds |
|---|---|
| `phase` | `implement`, `review`, `codexloop`, `pr-comments`, `fable`, `e2e`, `user`, `parity`, `backfill` |
| `source` | who proposed it: `you` (the user), `me` (the agent writing), `codex`, `claude` (a Claude reviewer called from Codex), `fable`, `review` (Standards/Spec subagents), `bot:<name>` (Gemini, BugBot, Codex connector) |
| `asked` | `yes` when the user or the ticket asked for it; `no` when an agent or reviewer chose it |
| `decision` | what was chosen or done, one line |
| `why` | the reason, in plain words |
| `prod_delta` | what analysts, customers or ops will see differently from **master**; `dev: ` and the difference when only developers or agents see it; or `none` |
| `evidence` | commit SHA, `file:line`, PR comment URL, screenshot path |
| `result` | `accepted`, `rejected`, `reverted` or `open`, plus the verification (`tests green`, `screenshot`) |

## What earns a row

- Every answer the user gives to a design question (`source you`, `asked yes`). These are the **settled decisions**; reviewers get them as pins (below).
- Every reviewer finding, accepted or rejected, with the reason.
- Every change whose `prod_delta` is not `none`, whoever proposed it.
- Every added **mechanism** (see below).
- Every pivot, revert, and choice the spec left open.

A trivial edit with no choice in it and no behavior change gets no row.

## Pins

`log.sh --pins` feeds the user's accepted answers to the reviewer as focus text. `RECAP_PIN_KEYS` (space-separated keys) adds other logs, read together so a row in one log retires pins in the rest. Two `result` forms retire a pin; each matches the decision text exactly, retires every pin with that text, and goes last in the result, after anything like verification, right after `; ` or `, `. A tag anywhere else counts for nothing. A row carries one form, not both: everything after the first tag is decision text, so a row naming both retires neither.

- **The user changes an answer:** log the new answer with a `result` that ends in `supersedes: <the old row's decision text>` (`accepted, tests green; supersedes: quotes above the alert text`).
- **A pin was never the user's answer** (it credited them with someone else's call): log a correction, from any source, with a `result` of `accepted; retracts: <that row's decision text>`. The old row stays as history, and a later answer from the user with the same text pins it again. A retraction does not restore a decision the retracted row superseded; log that decision again.

## The mechanism rule

A **mechanism** is a semaphore or concurrency cap, cache, retry, batch, timeout, feature flag, or a new place data is stored. Whoever proposes one (implementer, Codex, Fable, a bot), it is accepted only when its `why` names a problem measured in this code or its data: a number, a trace, a log line, a failing test. A plausible risk is not a measurement. Without one the row is `rejected`. Accepted or rejected, its row has `asked no` unless the user or ticket asked for it, so `/recap-pr` lists it under "Not asked for".

## prod_delta is measured against master

Compare with what master does today, never with the branch's previous commit. A fix that restores master behavior the branch had broken is `none (restores master)`, and the row that broke it should already carry the delta. Placement, ordering, labels, collapse state, wording, throughput and storage location all count as behavior.

People who work on the code see differences too. Write those with a `dev: ` prefix, so they stay apart from runtime changes in the recap and the PR's behavior section:

- a stricter CI limit: `dev: CI fails a PR whose JavaScript passes 180 KB; master allowed 200 KB`;
- a new build rule: `dev: the build refuses a server module imported from client code`;
- a test path no longer exercised: `dev: the Safari folder-stack case no longer runs on PRs; master ran it on each one`;
- a new coding rule: `dev: reviewers enforce colours from tokens only`;
- a changed agent instruction: `dev: /pr-loop runs Fable on every head it hands back in a repo that requires it`.

```
ts	repo	phase	source	asked	decision	why	prod_delta	evidence	result
2026-10-16T18:02:11Z	AI-ARG	implement	me	no	put Show quotes above the alert text	evidence reads before the claim	analysts see quotes above the alert text; master shows them below	commit 1a2b3c4	reverted after the analyst flagged it
2026-10-16T19:40:05Z	TPRM-API	codexloop	codex	no	F2.1 on feat/cont-mon: cap cold-record fetches with a semaphore of 8	avoid bursts against S3	comparisons load slower on busy days	src/cont_mon/event_artifacts.py:41	rejected: no measured S3 pressure
2026-10-16T20:15:30Z	TPRM-API	user	you	yes	newly linked documents are Added and sit in the main list	the new link is the change	linked quotes return to the main list, now labelled Added	PR #3164	accepted
2026-10-17T09:12:44Z	TPRM-API	implement	me	no	run the migration check in CI	a broken migration reached staging	dev: CI fails a PR whose migrations do not apply to a fresh database; master did not check	commit 9f8e7d6	accepted, CI red on a broken fixture
```

## Review passes

A **review pass** is one run of a reviewer a repo can require before merge (`/pr-loop`, **Required passes**). Record each one as it lands:

```bash
~/.claude/skills/recap-pr/log.sh --pass <pass> <head> <verdict> [<PR body file it read>]
```

The verdict is `clean` when the pass ran on that head and its findings changed nothing (none, each rejected with a logged reason, or each left `open` as a question for the user), `fixed` when they changed the head or the PR body, and `not-reviewed` when it did not run or did not finish. Give the body file for a pass that read the PR description: the row keeps a hash of the body's own text, leaving out blank lines, the review bots' summaries (the blocks `body_hash` in `log.sh` lists) and the review record inside `facts.py`'s block. A bot rewriting its own summary, or a refreshed record, never stales a pass; a changed check result or figure in the facts block does, and so does a bot writing back an older copy of the author's text. Each row in `reviews.tsv` holds `ts repo branch pass head verdict body`.

`log.sh --check <head> [<PR number | body file>]` prints one line per pass the declaration requires (the head's `docs/agents/pr-loop.md`, or the default branch's when the head has none), and exits 1, naming each, unless every one is `clean` on that exact head and, when given the PR or a body file, a pass that reads the body is clean on the current body; it exits 3 when the only passes left are recorded `not-reviewed` there, and exits 2 when it cannot run, for example on a `- pass:` line it cannot read, a failed `gh` call, or a head with no declaration and no default branch (origin/HEAD, origin/main, origin/master) to read one from. A PR number reads the live body and confirms the PR's head is the one given. With no declaration it lists what ran on the head and each pass's latest record, and exits 0.
