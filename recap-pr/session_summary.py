#!/usr/bin/env python3
"""Count what a Claude Code session executed, for a retro or a cost table.

    session_summary.py <session .jsonl> [--json]

Reads the session's transcript and every subagent log beside it (<session id>/subagents/*.jsonl).
It counts executed tool calls by distinct tool-use ID, from top-level assistant and user entries
only, and prints separately what is not new work: replayed API copies, compaction boundaries and
the continuation summaries written at them, errors, hook and other permission denials, and outputs
context-mode cut and indexed. The definitions print with the counts.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

DEFINITIONS = {
    "executed tool call": "a tool_use block in a top-level assistant entry, counted once per tool-use ID. "
                          "api-request and api-request-blob entries replay earlier messages to the API and are skipped.",
    "subagents": "calls from the subagent logs in <session id>/subagents/*.jsonl, and from sidechain entries "
                 "in the session file itself; their .meta.json siblings are metadata, not logs.",
    "error": "a tool result marked is_error that no hook or permission rule denied, once per tool-use ID.",
    "hook denial": "a tool result whose entry records a hook's reject (permissionDecision source hook), "
                   "or whose text opens with a PreToolUse hook error.",
    "other denial": "a tool result rejected by another permission source: the user, a safety check.",
    "indexed output": "a tool result context-mode cut to its best-matching parts: its last line points to "
                      "ctx_search with the source holding the rest, whether a hook cut a built-in tool's output "
                      "or ctx_execute indexed its own. A ctx_search page's \"More:\" pointer is not one.",
    "compaction boundary": "a system entry of subtype compact_boundary.",
    "continuation summary": "the user-role entry holding the summary written at a compaction "
                            "(isCompactSummary); it restates earlier work and is not a new message.",
    "user text": "user-role entries in the session file carrying text that are not tool results, continuation "
                 "summaries, meta or sidechain entries. Delegated briefs, skill text and notifications arrive "
                 "this way too, so verify authorship before counting one as the human's.",
}


INDEXED = re.compile(r'^(?:mcp__[\w-]+__)?ctx_search\(\{queries:\[.*\], source:"(?:[^"\\]|\\.)+"\}\)')


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict))
    return ""


class Tally:
    def __init__(self):
        self.calls = {"parent": {}, "subagents": {}}
        self.results = {}
        self.boundaries = self.summaries = self.user_text = self.unreadable = 0
        self.skipped = Counter()

    def read(self, path, column):
        for line in path.read_text(errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                self.unreadable += 1
                continue
            if not isinstance(entry, dict):
                self.unreadable += 1
                continue
            self.entry(entry, "subagents" if entry.get("isSidechain") else column)

    def entry(self, entry, column):
        kind = entry.get("type")
        message = entry.get("message") if isinstance(entry.get("message"), dict) else {}
        content = message.get("content")
        if kind == "assistant":
            for block in content if isinstance(content, list) else []:
                if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("id"):
                    self.calls[column].setdefault(block["id"], block.get("name", "?"))
        elif kind == "user":
            blocks = [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
            results = [b for b in blocks if b.get("type") == "tool_result" and b.get("tool_use_id")]
            for block in results:
                self.results.setdefault(block["tool_use_id"], self.outcome(entry, block))
            if results:
                return
            if entry.get("isCompactSummary"):
                self.summaries += 1
            elif column == "parent" and not entry.get("isMeta") and text_of(content).strip():
                self.user_text += 1
        elif kind == "system" and entry.get("subtype") == "compact_boundary":
            self.boundaries += 1
        else:
            self.skipped[kind or "untyped"] += 1

    @staticmethod
    def outcome(entry, block):
        decision = entry.get("permissionDecision") or {}
        text = text_of(block.get("content"))
        if decision.get("decision") == "reject":
            return "hook denial" if decision.get("source") == "hook" else "other denial"
        if block.get("is_error") and text.startswith("PreToolUse:") and " hook " in text[:80]:
            return "hook denial"
        if block.get("is_error"):
            return "error"
        lines = text.strip().splitlines()
        if lines and INDEXED.match(lines[-1].strip()):
            return "indexed output"
        return "ok"

    def summary(self, session, logs, metadata):
        names = {**self.calls["subagents"], **self.calls["parent"]}
        by_outcome = {k: Counter() for k in ("error", "hook denial", "other denial", "indexed output")}
        for tool_id, outcome in self.results.items():
            if outcome in by_outcome:
                by_outcome[outcome][names.get(tool_id, "unmatched result")] += 1
        return {
            "session": session,
            "subagent_logs": logs,
            "metadata_files": metadata,
            "tool_calls": {col: dict(Counter(ids.values())) for col, ids in self.calls.items()},
            "results": {k: dict(v) for k, v in by_outcome.items()},
            "compaction_boundaries": self.boundaries,
            "continuation_summaries": self.summaries,
            "user_text": self.user_text,
            "skipped_entries": dict(self.skipped),
            "unreadable_lines": self.unreadable,
            "definitions": DEFINITIONS,
        }


def render(s):
    parent, subs = Counter(s["tool_calls"]["parent"]), Counter(s["tool_calls"]["subagents"])
    results = {k: Counter(v) for k, v in s["results"].items()}
    tools = sorted(set(parent) | set(subs) | {t for c in results.values() for t in c},
                   key=lambda t: (-(parent[t] + subs[t]), t))
    heads = ["tool", "parent", "subagents", "error", "hook denial", "other denial", "indexed output"]
    rows = [[t, parent[t], subs[t], *(results[k][t] for k in heads[3:])] for t in tools]
    rows.append(["total", sum(parent.values()), sum(subs.values()), *(sum(results[k].values()) for k in heads[3:])])
    width = [max(len(str(r[i])) for r in [heads] + rows) for i in range(len(heads))]
    out = [f"Session {s['session']}: {s['subagent_logs']} subagent logs read, {s['metadata_files']} metadata files skipped.",
           "", "Executed tool calls and their results:"]
    for r in [heads] + rows:
        out.append("  " + "  ".join(str(v).ljust(w) if i == 0 else str(v).rjust(w) for i, (v, w) in enumerate(zip(r, width))))
    skipped = ", ".join(f"{k} {n}" for k, n in sorted(s["skipped_entries"].items())) or "none"
    out += ["",
            f"Compaction boundaries: {s['compaction_boundaries']}; continuation summaries: {s['continuation_summaries']}.",
            f"User text entries: {s['user_text']}.",
            f"Entries skipped as not work: {skipped}. Unreadable lines: {s['unreadable_lines']}.",
            "", "Definitions:"]
    out += [f"  {k}: {v}" for k, v in s["definitions"].items()]
    return "\n".join(out)


def main(argv):
    paths = [a for a in argv if a != "--json"]
    if len(paths) != 1 or not Path(paths[0]).is_file():
        sys.exit("usage: session_summary.py <session .jsonl> [--json]")
    parent = Path(paths[0])
    tally = Tally()
    tally.read(parent, "parent")
    folder = parent.with_suffix("") / "subagents"
    logs = sorted(folder.glob("*.jsonl")) if folder.is_dir() else []
    for log in logs:
        tally.read(log, "subagents")
    metadata = len(list(folder.glob("*.meta.json"))) if folder.is_dir() else 0
    summary = tally.summary(parent.stem, len(logs), metadata)
    print(json.dumps(summary, indent=2, sort_keys=True) if "--json" in argv else render(summary))


if __name__ == "__main__":
    main(sys.argv[1:])
