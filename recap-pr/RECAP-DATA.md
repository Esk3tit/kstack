# The recap's data

Step 5 writes the recap as `recap.json` beside the log, and `render.py` puts it into `recap.html`, the page the user reads. [sample-recap.json](sample-recap.json) is a filled-in example of the shape, abridged: it cites only some of its log's rows, where a real recap places every row, and its screenshots aren't included. To preview the page on it, run `python3 render.py sample-recap.json /tmp/sample.html`. After changing `render.py` or `recap.html`, run `bash test-render.sh` beside them and look at that preview.

The page works out its headline from the data:

- each item in `divergences` and each `owner_call` in `attention` is a thing that needs the user, with buttons to answer it;
- a PR whose `merge_ready` starts `no` makes it "not ready to merge";
- any other `attention` item makes it "Nothing to decide. Read the notes before merging";
- only with none of these does it say "Safe to merge", adding any `after <PR> merges` condition.

So a divergence or owner call goes in those places only while it's open, and every open one goes there.

## Top level

| field | holds |
|---|---|
| `title` | what the PRs change, in a user's words |
| `ticket` | `{label, url}`, or `null` |
| `generated` | when the recap was written, UTC `YYYY-MM-DDTHH:MM:SSZ` |
| `head_note` | the heads the recap covers, and any rebase or merge that moved them |
| `prs` | one per PR, at least one: `repo`, `number`, `url`, `title`, `head`, `base`, `base_sha`, `merge_order`, and `merge_ready` (`yes`, `yes, after <PR> merges`, or `no: <what blocks it>`, as `/pr-loop` hands back) |
| `log` | `{path, rows}`: the decision log and its row count |
| `reviewed_by` | step 4's reviewer |
| `parity` | `{summary, pairs}`. Each pair is step 3's master/branch comparison: `surface`, `label`, `master` and `branch` (a screenshot, as below, or `""`), `verdict` (`same`, `differs` or `read only`), `note` |
| `sections` | exactly the six sections, each a list of items, `[]` when empty |

## An item

| field | holds |
|---|---|
| `surface` | where people meet it: a page, an API, a prompt, the pipeline |
| `text` | the decision in plain words, for a reader who hasn't seen the code. Only `**bold**` and `` `code` `` are formatted |
| `why` | the reason, or `null` |
| `who` | the log's `source` values behind it: `you`, `me`, `codex`, `claude`, `fable`, `review`, `bot:<name>` |
| `asked` | `yes` or `no` |
| `result` | `accepted`, `rejected`, `reverted`, `superseded`, `retracted` or `open` |
| `rows` | the log's row numbers behind it, counting data rows from 1 |
| `evidence` | a list of `{label, href, kind}`. `kind` is `commit`, `file`, `comment`, `screenshot`, `test` or `issue`; `href` is an `http(s)` URL, a file path (absolute, or relative to `recap.json`; `~` isn't expanded), or `""`. Anything else shows as plain text |
| `group` | in `not_asked_for`: a short heading for related items; groups holding a mechanism come first |
| `mechanism` | `true` for an added mechanism |
| `owner_call` | in `attention`: `true` when only the user can decide it |
| `options` | for an owner call: each choice as a short phrase, which the page turns into buttons |
