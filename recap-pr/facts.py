#!/usr/bin/env python3
"""Write a PR's facts block from its sources, between <!-- pr-facts:start --> and <!-- pr-facts:end -->.

    facts.py <pr> [--dry-run | --record-only]

Run it in the PR's checkout. The block holds the head's check runs and commit statuses with their
results, the PRs a base merge brought in since the branch point, each section the repo declares in
docs/agents/pr-loop.md, and, between <!-- pr-facts:record:start/end -->, the review passes recorded
on the head (log.sh --check) and the time it was written. Sections are read from the declaration on the
default branch GitHub names, fetched fresh, never the PR's, because their commands run on this machine with
its credentials; they run only when the checkout is at the PR head, and a comment marker in their output
is escaped so it cannot end or hide part of the block:

    - facts: <title> = run: <command and arguments>   (run without a shell and within FACTS_COMMAND_SECONDS,
      default 600, its stdout as Markdown; {pr}, {head}, {base} filled in; it still runs the checkout's
      code, as the PR's tests do)
    - facts: <title> = file: <path from the repo root>   (refused if it resolves outside the checkout)

It reads the live body, replaces only its own block (inserting it before the bots' summaries the first
time), writes, and reads the body back; a bot that rewrites the body from an older copy is outrun by
fetching and writing again, up to three times, and stops if the description's own text changed
meanwhile rather than writing an older copy back. --dry-run prints the block and writes nothing.
--record-only rewrites only the review record, keeping every fact as it stands, so a pass that read
the facts stays clean; a full write ends with one, so its record describes the description it left.
"""

import datetime
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path

START, END = "<!-- pr-facts:start -->", "<!-- pr-facts:end -->"
RECORD_START, RECORD_END = "<!-- pr-facts:record:start -->", "<!-- pr-facts:record:end -->"
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
    statuses = run(["gh", "api", f"repos/{slug}/commits/{head}/status?per_page=100", "--paginate",
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


def passes_section(pr, head, body=None):
    """log.sh --check on the head, against the live PR body or, when given, the body facts.py wrote."""
    log_sh = Path(__file__).resolve().with_name("log.sh")
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(body or "")
    try:
        result = run([str(log_sh), "--check", head, f.name if body is not None else str(pr)], check=False)
    finally:
        os.unlink(f.name)
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


def declaration(slug):
    """The declaration on the default branch GitHub names, fetched fresh: a PR can't add or change its commands."""
    default = run(["gh", "api", f"repos/{slug}", "--jq", ".default_branch"]).stdout.strip()
    # An explicit refspec updates the tracking ref even in a clone that fetches only its own branch.
    git("fetch", "--quiet", "origin", f"+refs/heads/{default}:refs/remotes/origin/{default}")
    shown = run(["git", "show", f"origin/{default}:{DECLARATION}"], check=False)
    return shown.stdout if shown.returncode == 0 else ""


def declared_sections(pr, slug, head, base, top):
    at = git("rev-parse", "HEAD")
    if at != head:
        return ["", f"_Declared facts skipped: the checkout is at `{at[:8]}`, not the PR head; rerun facts.py there._"]
    lines = []
    for raw in declaration(slug).splitlines():
        match = FACT_LINE.match(raw)
        if not match:
            continue
        title, kind, source = match["title"], match["kind"], match["source"]
        if kind == "run":
            try:
                argv = [arg.replace("{pr}", str(pr)).replace("{head}", head).replace("{base}", base)
                        for arg in shlex.split(source)]
                result = subprocess.run(argv, cwd=top, capture_output=True, text=True,
                                        timeout=float(os.environ.get("FACTS_COMMAND_SECONDS", "600")))
            except subprocess.TimeoutExpired as problem:
                text = f"_`{source}` timed out after {problem.timeout:g} s._"
            except (ValueError, OSError) as problem:
                text = f"_`{source}` could not run: {cell(str(problem))}_"
            else:
                error = cell(result.stderr.strip()[-300:])
                text = result.stdout.strip() if result.returncode == 0 else (
                    f"_`{source}` failed with exit {result.returncode}{': ' + error if error else ''}_")
        else:
            path = Path(top, source).resolve()
            if not path.is_relative_to(Path(top).resolve()):
                text = f"_`{source}` is outside the checkout._"
            else:
                text = path.read_text().strip() if path.is_file() else f"_`{source}` does not exist._"
        lines += ["", f"**{title}** (`{source}`):", "", text.replace("<!--", "&lt;!--") or "_empty_"]
    return lines


def build_block(pr, slug, head, base, top):
    lines = [START,
             f"**Facts on `{head[:8]}`**, written by `facts.py` from their sources; "
             "rerun it to refresh them rather than editing this block.", ""]
    lines += checks_section(slug, head) + [""]
    lines += brought_in_section(base, head)
    lines += declared_sections(pr, slug, head, base, top)
    # The review record changes as passes land; log.sh leaves it out of the body hash.
    lines += ["", record(pr, head), END]
    return "\n".join(lines)


def record(pr, head, body=None):
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%MZ")
    return "\n".join([RECORD_START] + passes_section(pr, head, body) + ["", f"_Written at {now}._", RECORD_END])


def with_record(block, new_record):
    """The block as it stands, its review record replaced and every fact kept."""
    start, end = (block or "").find(RECORD_START), (block or "").find(RECORD_END)
    if start == -1 or end < start:
        fail("the description has no facts block with a review record yet: run facts.py <pr> first")
    return block[:start] + new_record + block[end + len(RECORD_END):]


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


def own_text(body):
    """log.sh's hash of the body without this block, so bots' summaries and blank lines don't count."""
    start, end = body.find(START), body.find(END)
    rest = body[:start] + body[end + len(END):] if start != -1 and end > start else body
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(rest)
    try:
        return run([str(Path(__file__).resolve().with_name("log.sh")), "--body-hash", f.name]).stdout.strip()
    finally:
        os.unlink(f.name)


def live_body(pr, head):
    """The PR's live body, read with its head so a push mid-write fails rather than leaving another head's facts."""
    view = pr_view(pr, "headRefOid,body")
    if view["headRefOid"] != head:
        fail(f"the PR's head moved to {view['headRefOid'][:8]} while facts.py ran for {head[:8]}: rerun it for the new head")
    return view.get("body") or ""


def fresh_record(pr, head, facts=None):
    """A make_block for write(): keeps the facts it first sees, and on every attempt reads the review record
    from the body that attempt publishes, wherever a retry puts the block."""
    kept = [facts]

    def make(live):
        kept[0] = kept[0] or own_block(live)
        placeholder = with_record(kept[0], RECORD_START + "\n" + RECORD_END)
        return with_record(kept[0], record(pr, head, splice(live, placeholder)))
    return make


def write(slug, pr, head, make_block, first=None):
    """Write the block into the live body and read it back; returns (attempts, author-text baseline)."""
    changed = ("the description's own text changed while facts.py was writing (a bot may have restored an "
               "older copy, or someone edited it): compare it with the last edit, restore it if needed, and rerun")
    for attempt in range(1, WRITE_ATTEMPTS + 1):
        live = live_body(pr, head)
        text = own_text(live)
        first = first or text
        if text != first:
            fail(changed)
        block = make_block(live)
        updated = splice(live, block)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as payload:
            json.dump({"body": updated}, payload)
        try:
            run(["gh", "api", "-X", "PATCH", f"repos/{slug}/pulls/{pr}", "--input", payload.name])
        finally:
            os.unlink(payload.name)
        back = live_body(pr, head)
        if own_text(back) != first:
            fail(changed)
        if own_block(back) == block:
            return attempt, first
        time.sleep(float(os.environ.get("FACTS_RETRY_SECONDS", "5")))
    fail(f"the body kept losing the facts block after {WRITE_ATTEMPTS} writes; a bot is rewriting it, so rerun once it settles")


def main(argv):
    flags = {"--dry-run", "--record-only"}
    args = [a for a in argv if a not in flags]
    if len(args) != 1 or not args[0].isdigit() or len(flags & set(argv)) > 1:
        fail("usage: facts.py <pr number> [--dry-run | --record-only]")
    pr = int(args[0])
    view = pr_view(pr, "headRefOid,baseRefName,url")
    head, base = view["headRefOid"], view["baseRefName"]
    slug = "/".join(view["url"].split("/")[3:5])
    top = git("rev-parse", "--show-toplevel")
    git("fetch", "--quiet", "origin", base)
    if run(["git", "cat-file", "-e", f"{head}^{{commit}}"], check=False).returncode != 0:
        git("fetch", "--quiet", "origin", head)
    if "--record-only" in argv:
        attempts, _ = write(slug, pr, head, fresh_record(pr, head))
        print(f"review record refreshed on PR #{pr} for {head[:8]}" + (f" after {attempts} writes" if attempts > 1 else ""))
        return
    block = build_block(pr, slug, head, base, top)
    if "--dry-run" in argv:
        print(block)
        return
    attempts, first = write(slug, pr, head, lambda live: block)
    # The record read the description before these facts landed: write the same facts again with a fresh
    # record and the same author-text baseline, so a bot's older copy can't slip in.
    write(slug, pr, head, fresh_record(pr, head, block), first)
    print(f"facts block written to PR #{pr} for {head[:8]}" + (f" after {attempts} writes" if attempts > 1 else ""))


if __name__ == "__main__":
    main(sys.argv[1:])
