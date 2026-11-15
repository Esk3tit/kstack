#!/usr/bin/env python3
"""Render a recap's data into its HTML page.

Usage: render.py <recap.json> [<out.html>]

Reads the recap data, checks it has a title, PRs and all six sections, and writes it into
recap.html (the template beside this script). The page goes to <out.html>, or recap.html
beside the JSON, and its path is printed. Exits non-zero, writing nothing, on bad input.
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


def render(data: dict) -> str:
    missing = [key for key in ("title", "prs", "sections") if key not in data]
    sections = data.get("sections")
    if isinstance(sections, dict):
        missing += [f"sections.{name}" for name in SECTIONS if not isinstance(sections.get(name), list)]
    if missing:
        raise ValueError("missing or not a list: " + ", ".join(missing))
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
