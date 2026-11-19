# A change that spans repos

Read this before step 1 when the change spans sibling repos: the same-named branch in another repo. Every step then runs in each repo's branch, and these add to it:

- **One log.** Resolve the log key once in the main repo (`log.sh --path` reuses the key the branch already logged under), then run `log.sh --bind <that key>` in each sibling repo's branch, so every repo writes to one log. Collect every key in every participating branch's key file and set them as `RECAP_PIN_KEYS='<keys>'` in front of each `log.sh --pins` call (shell variables do not survive between calls), so `--pins` in any repo reads all of those logs together and every review gets the same settled decisions, including ones logged in a sibling before binding.
- **The PRs** (step 2) name the merge order in every body and cross-link each other.
- **App evidence** (step 5) goes on the PR whose diff caused what changed on screen.
- **The hand-back** gives each PR's merge order, and `Merge-ready: yes, after <sibling PR> merges` for a PR that waits on another.
