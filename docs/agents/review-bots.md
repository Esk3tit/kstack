# Review bots

## Final-pass reviewer: Cursor Bugbot

Its tag is a PR comment: `bugbot run`, posted with `gh` as a person (`gh api user --jq .type` says `User`), not through an app's GitHub tools such as Claude's: Bugbot ignores a tag from a bot or GitHub App. The owner's Cursor account runs it only when tagged, so `/address-pr-comments`, **The final pass**, says when.

- **Why last:** every run is billed ([pricing](https://cursor.com/docs/bugbot.md#pricing); Cursor puts the average run at $1). Run on every push, it averaged over three runs per PR.
- **Reading its review:** each run posts its PR summary as a comment (`prSummary` in `.cursor/config/bugbot.yaml`), which wakes a T3 watch. Findings arrive as review threads. A clean review adds nothing else: its `Cursor Bugbot` check run on the commit that was the head when tagged says "Bugbot completed review - no issues found!" (`gh api 'repos/Esk3tit/kstack/commits/<sha>/check-runs?check_name=Cursor%20Bugbot'`, fields `started_at` and `output.summary`).
- **A skip:** a comment saying "Bugbot couldn't run - usage limit reached", or asking for the PR to be split for size, bills nothing. Report it as `NOT_REVIEWED=bugbot:<reason>` rather than tagging it again.
