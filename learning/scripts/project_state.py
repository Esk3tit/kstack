"""Inspect this checkout's learning state without creating or modifying notes."""

import argparse
import json
from pathlib import Path
import re
import stat
import sys


NOTE_NAMES = ("profile.md", "progress.md", "project-map.md")
LEGACY_DIRECTORIES = (".vibe-wise", ".sensible-vibes")


def profile_options(lines, legacy=False):
    """Read saved controls; only legacy directories activate without a mode line."""
    has_content = False
    saw_mode = False
    active = True
    track_notes = None
    for raw in lines:
        has_content = has_content or bool(raw.strip())
        line = raw.strip().replace("**", "").replace("__", "")
        line = re.sub(r"^[-+*]\s+", "", line)
        mode = re.fullmatch(r"Learning mode\s*:\s*(.*)", line, re.IGNORECASE)
        tracking = re.fullmatch(r"Track learning notes\s*:\s*(.*)", line, re.IGNORECASE)
        if mode:
            saw_mode = True
            active = active and mode.group(1).strip().casefold() == "active"
        if tracking:
            choice = tracking.group(1).strip().casefold() == "yes"
            track_notes = choice if track_notes is None else track_notes and choice
    return {
        "active": active if saw_mode else legacy and has_content,
        "track_notes": bool(track_notes),
        "has_content": has_content,
    }


def project_directory(raw):
    cwd = Path(raw)
    if not cwd.is_absolute() or not cwd.is_dir():
        raise ValueError("Use an existing absolute project working directory.")
    return cwd.resolve()


def git_root(cwd):
    for directory in (cwd, *cwd.parents):
        if (directory / ".git").exists():
            return directory
    return None


def state_directory(cwd):
    """Find the nearest real notes directory inside the current Git checkout."""
    root = git_root(cwd)
    candidates = [cwd] if root is None else [cwd, *cwd.parents][
        : len(cwd.relative_to(root).parts) + 1
    ]
    for directory in candidates:
        for name in (".learning", *LEGACY_DIRECTORIES):
            state = directory / name
            if state.exists() or state.is_symlink():
                if state.is_dir() and not state.is_symlink():
                    return state
                raise ValueError("Learning notes must be a real directory: " + str(state))
    return None


def note_files(state):
    files = {}
    for name in NOTE_NAMES:
        path = state / name
        try:
            mode = path.lstat().st_mode
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(mode):
            raise ValueError("Learning notes must be regular files: " + str(path))
        files[name] = path
    return files


def inspect_project(raw_cwd):
    cwd = project_directory(raw_cwd)
    state = state_directory(cwd)
    target = state or (git_root(cwd) or cwd) / ".learning"
    status = "missing"
    options = profile_options(())
    if state is not None:
        profile = note_files(state).get("profile.md")
        if profile is not None:
            with profile.open(encoding="utf-8") as stream:
                options = profile_options(stream, legacy=state.name in LEGACY_DIRECTORIES)
            status = ("active" if options["active"] else "paused") if options["has_content"] else "empty"
    return {
        "project": str(target.parent), "state": str(target),
        "exists": state is not None, "profile_status": status,
        "track_notes": options["track_notes"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cwd", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect_project(args.cwd)))
    except (OSError, ValueError, UnicodeError) as error:
        print(json.dumps({"status": "error", "message": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
