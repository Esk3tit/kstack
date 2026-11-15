# Review bots

## Final-pass reviewer: Cursor Bugbot

Its tag is a PR comment: `bugbot run`, posted with `gh` as a person (`gh api user --jq .type` says `User`), not through an app's GitHub tools such as Claude's: Bugbot ignores a tag from a bot or GitHub App. The owner's Cursor account runs it only when tagged, so `/address-pr-comments`, **The final pass**, says when.

- **Why last:** every run is billed ([pricing](https://cursor.com/docs/bugbot.md#pricing); Cursor puts the average run at $1). Run on every push, it averaged over three runs per PR.
- **Reading its review:** a tagged run ends with a review on the PR, which wakes a T3 watch: "✅ Bugbot reviewed your changes and found no new issues!" when clean, otherwise its findings as review threads. The review for your request is the one on the head you tagged, submitted after your `bugbot run` comment. Its PR summary comment (`prSummary` in `.cursor/config/bugbot.yaml`) posts when a review starts, not when it finishes.
- **A skip:** a comment saying "Bugbot couldn't run - usage limit reached", or asking for the PR to be split for size, bills nothing. Report it as `NOT_REVIEWED=bugbot:<reason>` rather than tagging it again.
