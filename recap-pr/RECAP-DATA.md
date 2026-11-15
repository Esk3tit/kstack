# The recap's data

Step 5 writes the recap as `recap.json` beside the log, and `render.py` puts it into `recap.html`, the page the user reads. [sample-recap.json](sample-recap.json) is a filled-in example: copy its shape. To preview the page on it, run `python3 render.py sample-recap.json /tmp/sample.html`.

The page works out its headline from the data: "Nothing needs you" when `divergences` and the owner calls in `attention` are empty, and otherwise a count of what needs the user. So every divergence and every call only the user can make must be in the data, and nothing else belongs in those two places.

## Top level

| field | holds |
|---|---|
| `schema` | `1` |
| `title` | what the PRs change, in a user's words |
| `ticket` | `{label, url}`, or `null` |
| `generated` | when the recap was written, UTC `YYYY-MM-DDTHH:MM:SSZ` |
| `head_note` | the heads the recap covers, and any rebase or merge that moved them |
| `prs` | one per PR: `repo`, `number`, `url`, `title`, `head`, `base`, `base_sha`, `merge_order`, `merge_ready` (`yes`, or `no: <what blocks it>`) |
| `log` | `{path, rows}`: the decision log and its row count |
| `reviewed_by` | step 4's reviewer |
| `parity` | `{summary, pairs}`. Each pair is step 3's master/branch comparison: `surface`, `label`, `master` and `branch` (a screenshot's absolute path or URL, or `""`), `verdict` (`same`, `differs` or `read only`), `note` |
| `sections` | all six sections, each a list of items, `[]` when empty |

## An item

| field | holds |
|---|---|
| `surface` | where people meet it: a page, an API, a prompt, the pipeline |
| `text` | the decision in plain words, as step 5 says. Only `**bold**` and `` `code` `` are formatted |
| `why` | the reason, or `null` |
| `who` | the log's `source` values behind it: `you`, `me`, `codex`, `claude`, `fable`, `review`, `bot:<name>` |
| `asked` | `yes` or `no` |
| `result` | `accepted`, `rejected`, `reverted`, `superseded`, `retracted` or `open` |
| `rows` | the log's row numbers behind it, counting data rows from 1 |
| `evidence` | a list of `{label, href, kind}`. `kind` is `commit`, `file`, `comment`, `screenshot`, `test` or `issue`; `href` is a URL, an absolute path, or `""` |
| `group` | in `not_asked_for`: `Mechanisms` for added mechanisms, listed first, then any grouping that helps |
| `mechanism` | `true` for an added mechanism |
| `owner_call` | in `attention`: `true` when only the user can decide it |
| `options` | for an owner call: each choice as a short phrase, which the page turns into buttons |
