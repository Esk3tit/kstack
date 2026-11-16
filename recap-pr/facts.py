#!/usr/bin/env python3
"""Write a PR's facts block from its sources, between <!-- pr-facts:start --> and <!-- pr-facts:end -->.

    facts.py <pr> [--dry-run]

Run it in the PR's checkout. The block holds the head's check runs and commit statuses with their
results, the review passes recorded on the head (log.sh --check), the PRs a base merge brought in
since the branch point, and each section the repo declares in docs/agents/pr-loop.md:

    - facts: <title> = run: <shell command>   (its stdout, as Markdown; {pr}, {head}, {base} filled in)
    - facts: <title> = file: <path from the repo root>

It reads the live body, replaces only its own block (inserting it before the bots' summaries the first
time), writes, and reads the body back; a bot that rewrites the body from an older copy is outrun by
fetching and writing again, up to three times. --dry-run prints the block and writes nothing.
"""

import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

START, END = "<!-- pr-facts:start -->", "<!-- pr-facts:end -->"
BOT_STARTS = (
    "<!-- Macroscope's pull request summary starts here -->",
    "<!-- This is an auto-generated comment: release notes by coderabbit.ai -->",
    "<!-- CURSOR_SUMMARY -->",
)
DECLARATION = "docs/agents/pr-loop.md"
FACT_LINE = re.compile(r"^- facts: (?P<title>.+?) = (?P<kind>run|file): (?P<source>.+?)\s*$")
SQUASHED = re.compile(r"^(?P<title>.*?)\s*\(#(?P<pr>\d+)\)\s*$")
MERGED = re.compile(r"^Merge pull request #(?P<pr>\d+)\b")
WRITE_ATTEMPTS = 3


def fail(message):
    print(f"facts.py: {message}", file=sys.stderr)
    sys.exit(1)


def run(args, check=True, **kw):
    result = subprocess.run(args, capture_output=True, text=True, **kw)
    if check and result.returncode != 0:
        fail(f"{' '.join(args[:4])} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result


def git(*args, check=True):
    return run(["git", *args], check=check).stdout.strip()


def gh_json(*args):
    return json.loads(run(["gh", *args]).stdout)


def pr_view(pr, fields):
    return gh_json("pr", "view", str(pr), "--json", fields)


def cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def checks_section(slug, head):
    rows = []
    runs = run(["gh", "api", f"repos/{slug}/commits/{head}/check-runs", "--paginate",
                "-q", '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv']).stdout
    for line in filter(None, runs.splitlines()):
        name, status, conclusion = (line.split("\t") + ["", ""])[:3]
        rows.append((name, conclusion if status == "completed" else status))
    statuses = run(["gh", "api", f"repos/{slug}/commits/{head}/status",
                    "-q", ".statuses[] | [.context, .state] | @tsv"]).stdout
    for line in filter(None, statuses.splitlines()):
        name, state = (line.split("\t") + [""])[:2]
        rows.append((name, state))
    if not rows:
        return ["**Checks:** none reported on this head."]
    rows.sort()
    tally = {}
    for _, result in rows:
        tally[result] = tally.get(result, 0) + 1
    counts = ", ".join(f"{n} {result}" for result, n in sorted(tally.items(), key=lambda kv: (-kv[1], kv[0])))
    lines = [f"**Checks:** {len(rows)} on this head: {counts}.", "", "| Check | Result |", "| --- | --- |"]
    lines += [f"| {cell(name)} | {cell(result)} |" for name, result in rows]
    return lines


def passes_section(pr, head):
    log_sh = Path(__file__).resolve().with_name("log.sh")
    result = run([str(log_sh), "--check", head, str(pr)], check=False)
    output = (result.stdout + result.stderr).strip() or f"log.sh --check exited {result.returncode} with no output"
    return ["**Review passes:**", "", "```text", output, "```"]


def brought_in_section(base, head):
    own = git("rev-list", "--first-parent", head, "--not", f"origin/{base}").splitlines()
    merge_base = git("merge-base", f"origin/{base}", head)
    if not own:
        return [f"**Brought in from `{base}`:** none; the head is on `{base}`."]
    branch_point = git("rev-parse", f"{own[-1]}^1")
    commits = [c for c in git("log", "--first-parent", "--format=%s%x1f%b%x1e",
                               f"{branch_point}..{merge_base}").split("\x1e") if c.strip()]
    prs = []
    for commit in commits:
        subject, _, message = commit.strip("\n").partition("\x1f")
        squashed, merged = SQUASHED.match(subject), MERGED.match(subject)
        if squashed:
            prs.append(f"#{squashed['pr']} {squashed['title']}")
        elif merged:
            prs.append(f"#{merged['pr']} {(message.strip().splitlines() or [subject])[0]}")
    lead = f"**Brought in from `{base}` since the branch point `{branch_point[:8]}`:**"
    if not commits:
        return [f"{lead} none."]
    others = len(commits) - len(prs)
    lines = [lead, ""] + [f"- {cell(p)}" for p in reversed(prs)]
    if others:
        lines.append(f"- {others} commit{'s' if others != 1 else ''} naming no PR")
    return lines


def declared_sections(pr, head, base, top):
    shown = run(["git", "show", f"{head}:{DECLARATION}"], check=False)
    if shown.returncode != 0:
        return []
    lines = []
    for raw in shown.stdout.splitlines():
        match = FACT_LINE.match(raw)
        if not match:
            continue
        title, kind, source = match["title"], match["kind"], match["source"]
        if kind == "run":
            command = source.replace("{pr}", str(pr)).replace("{head}", head).replace("{base}", base)
            result = subprocess.run(command, shell=True, cwd=top, capture_output=True, text=True)
            error = cell(result.stderr.strip()[-300:])
            text = result.stdout.strip() if result.returncode == 0 else (
                f"_`{source}` failed with exit {result.returncode}{': ' + error if error else ''}_")
        else:
            path = Path(top, source)
            text = path.read_text().strip() if path.is_file() else f"_`{source}` does not exist._"
        lines += ["", f"**{title}** (`{source}`):", "", text or "_empty_"]
    return lines


def build_block(pr, slug, head, base, top):
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%MZ")
    lines = [START,
             f"**Facts on `{head[:8]}`**, written by `facts.py` from their sources at {now}; "
             "rerun it to refresh them rather than editing this block.", ""]
    lines += checks_section(slug, head) + [""]
    lines += passes_section(pr, head) + [""]
    lines += brought_in_section(base, head)
    lines += declared_sections(pr, head, base, top)
    lines.append(END)
    return "\n".join(lines)


def splice(body, block):
    start, end = body.find(START), body.find(END)
    if start != -1 and end != -1 and start < end and body.count(START) == 1 and body.count(END) == 1:
        return body[:start] + block + body[end + len(END):]
    if start != -1 or end != -1:
        fail(f"the body's facts markers are broken: keep exactly one {START} before one {END}, then rerun")
    bots = [i for i in (body.find(marker) for marker in BOT_STARTS) if i != -1]
    if not bots:
        return f"{body.rstrip()}\n\n{block}\n"
    return f"{body[:min(bots)].rstrip()}\n\n{block}\n\n{body[min(bots):]}"


def own_block(body):
    start, end = body.find(START), body.find(END)
    return body[start:end + len(END)] if start != -1 and end > start else None


def write(slug, pr, block):
    for attempt in range(1, WRITE_ATTEMPTS + 1):
        live = pr_view(pr, "body").get("body") or ""
        updated = splice(live, block)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as payload:
            json.dump({"body": updated}, payload)
        try:
            run(["gh", "api", "-X", "PATCH", f"repos/{slug}/pulls/{pr}", "--input", payload.name])
        finally:
            os.unlink(payload.name)
        if own_block(pr_view(pr, "body").get("body") or "") == block:
            return attempt
        time.sleep(float(os.environ.get("FACTS_RETRY_SECONDS", "5")))
    fail(f"the body kept losing the facts block after {WRITE_ATTEMPTS} writes; a bot is rewriting it, so rerun once it settles")


def main(argv):
    args = [a for a in argv if a != "--dry-run"]
    if len(args) != 1 or not args[0].isdigit():
        fail("usage: facts.py <pr number> [--dry-run]")
    pr = int(args[0])
    view = pr_view(pr, "headRefOid,baseRefName,url")
    head, base = view["headRefOid"], view["baseRefName"]
    slug = "/".join(view["url"].split("/")[3:5])
    top = git("rev-parse", "--show-toplevel")
    git("fetch", "--quiet", "origin", base)
    if run(["git", "cat-file", "-e", f"{head}^{{commit}}"], check=False).returncode != 0:
        git("fetch", "--quiet", "origin", head)
    block = build_block(pr, slug, head, base, top)
    if "--dry-run" in argv:
        print(block)
        return
    attempts = write(slug, pr, block)
    print(f"facts block written to PR #{pr} for {head[:8]}" + (f" after {attempts} writes" if attempts > 1 else ""))


if __name__ == "__main__":
    main(sys.argv[1:])
