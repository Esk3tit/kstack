"""Preview by default; confirm only with exclusive access to local learning notes."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile


# Imports must not leave bytecode in the shared kstack checkout.
sys.dont_write_bytecode = True
from project_state import LEGACY_DIRECTORIES, NOTE_NAMES, note_files, profile_options, project_directory, state_directory, tracked_note_files


TEMPLATES = Path(__file__).resolve().parents[1] / "templates"


def fresh_notes(options):
    notes = {name: (TEMPLATES / name).read_text(encoding="utf-8") for name in NOTE_NAMES}
    controls = {
        "Learning mode": "active" if options["active"] else "paused",
        "Track learning notes": "yes" if options["track_notes"] else "no",
    }
    lines = []
    for line in notes["profile.md"].splitlines():
        key = line.partition(":")[0]
        lines.append(key + ": " + controls[key] if key in controls else line)
        if key == "Onboarding":
            lines.append("Onboarding reset: pending")
    notes["profile.md"] = "\n".join(lines) + "\n"
    return notes


def snapshot(cwd):
    state = state_directory(cwd)
    if state is None:
        return None, {}, None
    notes = {name: path.read_bytes() for name, path in note_files(state).items()}
    digest = hashlib.sha256(str(state).encode())
    for name in NOTE_NAMES:
        data = notes.get(name)
        digest.update(json.dumps([name, None if data is None else data.hex()]).encode())
    return state, notes, digest.hexdigest()


def reset(cwd, confirmation=None):
    cwd = project_directory(cwd)
    state, notes, fingerprint = snapshot(cwd)
    if confirmation is not None and (not notes or confirmation != fingerprint):
        raise ValueError("Target or notes changed. Preview and confirm again; nothing reset.")
    if not notes:
        return {"status": "no_notes", "cwd": str(cwd)}
    try:
        options = profile_options(notes.get("profile.md", b"").decode("utf-8").splitlines(), legacy=state.name in LEGACY_DIRECTORIES)
    except UnicodeError:
        options = profile_options(())
    if not options["track_notes"]:
        tracked = tracked_note_files(state)
        if tracked:
            raise ValueError(
                "Private learning notes are tracked by Git: " + ", ".join(tracked)
                + ". Choose tracking or remove these paths from the index before resetting."
            )
    mode_after_reset = "active" if options["active"] else "paused"
    fresh = fresh_notes(options)
    result = {
        "status": "preview", "project": str(state.parent), "state": str(state),
        "files": list(NOTE_NAMES), "existing_files": list(notes),
        "creates": [name for name in NOTE_NAMES if name not in notes],
        "mode_after_reset": mode_after_reset,
        "backup_parent": str(state / "backups"),
        "confirmation": fingerprint,
    }
    if confirmation is None:
        return result

    backup_parent = state / "backups"
    if backup_parent.is_symlink() or (backup_parent.exists() and not backup_parent.is_dir()):
        raise ValueError("Backup path must be a real directory; nothing reset.")
    backup_parent.mkdir(mode=0o700, exist_ok=True)
    prefix = datetime.now(timezone.utc).strftime("reset-%Y%m%dT%H%M%SZ-")
    backup = Path(tempfile.mkdtemp(prefix=prefix, dir=backup_parent))
    try:
        (backup / ".gitignore").write_bytes((TEMPLATES / "private.gitignore").read_bytes())
        for name, data in notes.items():
            (backup / name).write_bytes(data)
        for name, text in fresh.items():
            (backup / (".new-" + name)).write_text(text, encoding="utf-8")
        if snapshot(cwd)[2] != fingerprint:
            raise ValueError("Notes changed during backup; active notes were not reset.")
        for name in NOTE_NAMES:
            os.replace(backup / (".new-" + name), state / name)
    except (OSError, ValueError) as error:
        raise ValueError(
            "Reset did not complete. Backup location: {}. "
            "Check active notes before continuing. {}".format(backup, error)
        ) from error
    return {"status": "reset", "project": str(state.parent),
            "state": str(state), "backup": str(backup), "mode_after_reset": mode_after_reset}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--confirm", help="Snapshot token from a preview; only after user confirmation")
    args = parser.parse_args()
    try:
        result = reset(args.cwd, args.confirm)
    except (OSError, ValueError) as error:
        print(json.dumps({"status": "error", "message": str(error)}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
