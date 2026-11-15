#!/usr/bin/env python3
"""Render a recap's data into its HTML page.

Usage: render.py <recap.json> [<out.html>]

Reads the recap data, checks it has a title, a reviewer, PRs that each say whether they're
ready, and all six sections, then writes it into recap.html, the template beside this script.
The page goes to <out.html>, or recap.html beside the JSON, and its path is printed. On bad
input it names every problem, writes nothing and exits non-zero.
"""
import json
import pathlib
import re
import sys

TEMPLATE = pathlib.Path(__file__).with_name("recap.html")
DATA_BLOCK = re.compile(r'(<script type="application/json" id="recap-data">)(.*?)(</script>)', re.S)
SECTIONS = (
    "divergences",
    "behavior_changes",
    "not_asked_for",
    "rejected_or_reverted",
    "decided_no_change",
    "attention",
)


def problems(data) -> list[str]:
    if not isinstance(data, dict):
        return ["the recap is not a JSON object"]
    found = [f"{key} is missing or empty" for key in ("title", "reviewed_by") if not isinstance(data.get(key), str) or not data[key].strip()]
    prs = data.get("prs")
    if not isinstance(prs, list) or not prs:
        found.append("prs is missing or empty")
    else:
        found += [f"prs[{i}] has no merge_ready" for i, pr in enumerate(prs) if not isinstance(pr, dict) or not pr.get("merge_ready")]
    sections = data.get("sections")
    if not isinstance(sections, dict):
        found.append("sections is missing or not an object")
    else:
        found += [f"sections.{name} is missing or not a list" for name in SECTIONS if not isinstance(sections.get(name), list)]
    return found


def render(data) -> str:
    found = problems(data)
    if found:
        raise ValueError("; ".join(found))
    # "<" only occurs inside JSON strings, so escaping it keeps a value from closing the script block.
    payload = json.dumps(data, ensure_ascii=False, indent=1).replace("<", "\\u003c")
    page, count = DATA_BLOCK.subn(lambda m: m.group(1) + payload + m.group(3), TEMPLATE.read_text(), count=1)
    if count != 1:
        raise ValueError(f"no recap-data block in {TEMPLATE}")
    return page


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    source = pathlib.Path(argv[1])
    try:
        page = render(json.loads(source.read_text()))
    except (OSError, ValueError) as error:
        print(f"render.py: {source}: {error}", file=sys.stderr)
        return 1
    out = pathlib.Path(argv[2]) if len(argv) == 3 else source.with_name("recap.html")
    out.write_text(page)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
