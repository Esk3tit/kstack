# Review bots

Macroscope and Cursor Bugbot are this repo's final-pass reviewers.

**Which to request:** Bugbot is the default. Add Macroscope when the change carries residual risk of the kinds where, on wt-records, its findings outran Bugbot's: two writers or runs touching the same file (a decision log, a branch's key file), a token, secret or permission check, or how failures are caught and reported.

## Final-pass reviewer: Macroscope

Its tag is a PR comment: `@macroscope-app review`. Its automatic reviews are off for this repo, so it reviews only when tagged; `/address-pr-comments`, **The final pass**, says when.

- **Why last:** every review is billed. In this repo's Balanced mode that's $0.05 per KB of reviewable diff, with a $0.50 minimum (10 KB) per review ([pricing](https://docs.macroscope.com/pricing)). Most of its findings repeat the cheaper bots'; reviewing last, it finds only what they missed.
- **What it bills for:** the diff minus its [ignore rules](https://docs.macroscope.com/code-review/ignore-files) (the repo's ignore file, or Macroscope's defaults without one) and minus tests. Before requesting it for a risk, check that the file carrying the risk is reviewed.
- **Reading its review:** its check run, `Macroscope - Correctness Check`, completes with a summary naming the head it reviewed and what it found; findings also come as review threads. A clean review posts no comment or review, so a T3 watch does not wake for it: read the check run.
- **A skip for cost:** its check run's summary names the detection mode and the three costliest files (`gh api repos/Esk3tit/kstack/commits/<sha>/check-runs`). Report those files rather than tagging it again.

## Final-pass reviewer: Cursor Bugbot

Its tag is a PR comment: `bugbot run`, posted with `gh` as a person (`gh api user --jq .type` says `User`), not through an app's GitHub tools such as Claude's: Bugbot ignores a tag from a bot or GitHub App. The owner's Cursor account runs it only when tagged, so `/address-pr-comments`, **The final pass**, says when, and when `/pr-loop`'s tail requests it again.

- **Why last:** every run is billed ([pricing](https://cursor.com/docs/bugbot.md#pricing); Cursor puts the average run at $1). Run on every push, it averaged over three runs per PR.
- **Reading its review:** a tagged run ends with a review on the PR, which wakes a T3 watch: "✅ Bugbot reviewed your changes and found no new issues!" when clean, otherwise its findings as review threads. The review for your request is the one on the head you tagged, submitted after your `bugbot run` comment. Its PR summary comment (`prSummary` in `.cursor/config/bugbot.yaml`) posts when a review starts, not when it finishes.
- **A skip:** a comment saying "Bugbot couldn't run - usage limit reached", or asking for the PR to be split for size, bills nothing. Report it as `NOT_REVIEWED=bugbot:<reason>` rather than tagging it again.
