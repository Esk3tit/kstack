"""Check that normal Git staging cannot include private learning notes or backups."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PrivacyTests(unittest.TestCase):
    def test_tracking_lookup_uses_the_literal_selected_directory(self):
        with tempfile.TemporaryDirectory(prefix="learning-literal-path-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
            state = project / "*" / ".learning"
            state.mkdir(parents=True)
            profile = state / "profile.md"
            profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
            sibling = project / "zz"
            sibling.mkdir()
            (sibling / ".learning").write_text("unrelated tracked file\n")
            subprocess.run(["git", "-C", str(project), "add", "--", "zz/.learning"], check=True, capture_output=True)
            command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(state.parent)]
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertFalse(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [])
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "--", str(profile)], check=True, capture_output=True)
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertTrue(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [str(profile)])

    def test_tracked_guard_alone_allows_private_notes_and_reset(self):
        with tempfile.TemporaryDirectory(prefix="learning-tracked-guard-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
            state = project / ".learning"
            state.mkdir()
            shutil.copyfile(ROOT / "templates/private.gitignore", state / ".gitignore")
            (state / "profile.md").write_text("Learning mode: paused\nTrack learning notes: no\n")
            subprocess.run(["git", "-C", str(project), "add", "-f", str(state / ".gitignore")], check=True, capture_output=True)
            output = subprocess.check_output([sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(project)], text=True)
            result = json.loads(output)
            self.assertFalse(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [])
            command = [sys.executable, "-B", str(ROOT / "scripts/reset.py"), "--cwd", str(project)]
            preview = json.loads(subprocess.check_output(command, text=True))
            reset_result = json.loads(subprocess.check_output(command + ["--confirm", preview["confirmation"]], text=True))
            self.assertEqual(reset_result["status"], "reset")
            self.assertEqual((state / ".gitignore").read_bytes(), (ROOT / "templates/private.gitignore").read_bytes())

    def test_untracking_backup_survives_committed_branch_switches(self):
        with tempfile.TemporaryDirectory(prefix="learning-untracking-") as directory:
            project = Path(directory).resolve()

            def git(*args):
                return subprocess.run(["git", "-C", str(project), *args], check=True, capture_output=True, text=True)

            git("init", "-q", "-b", "main")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            state = project / ".learning"
            state.mkdir()
            notes = {"profile.md": "Learning mode: active\nTrack learning notes: yes\n", "progress.md": "existing assessment\n", ".gitignore": "backups/\n"}
            for name, text in notes.items():
                (state / name).write_text(text)
            git("add", ".")
            git("commit", "-qm", "track learning notes")
            git("switch", "-qc", "private-notes")
            command = [sys.executable, "-B", str(ROOT / "scripts/reset.py"), "--cwd", str(project)]
            preview = json.loads(subprocess.check_output(command, text=True))
            reset_result = json.loads(subprocess.check_output(command + ["--confirm", preview["confirmation"]], text=True))
            reset_backup = Path(reset_result["backup"])
            notes["profile.md"] = "Learning mode: active\nTrack learning notes: no\n"
            notes["progress.md"] = "never committed private assessment\n"
            for name, text in notes.items():
                (state / name).write_text(text)
            backup = state / "backups" / "before-untracking"
            backup.mkdir(parents=True)
            shutil.copyfile(ROOT / "templates/private.gitignore", backup / ".gitignore")
            copies = backup / "files"
            copies.mkdir()
            for name in notes:
                shutil.copyfile(state / name, copies / name)
                self.assertEqual((copies / name).read_bytes(), (state / name).read_bytes())
            exclude = Path(git("rev-parse", "--path-format=absolute", "--git-path", "info/exclude").stdout.strip())
            exclude.write_text(exclude.read_text() + "\n/.learning/\n")
            git("rm", "--cached", "--", *[str(state / name) for name in notes])
            shutil.copyfile(ROOT / "templates/private.gitignore", state / ".gitignore")
            git("add", "--all")
            git("commit", "-qm", "untrack learning notes")
            self.assertEqual(git("ls-files", "--", str(backup)).stdout, "")
            (state / "progress.md").write_text("later private assessment\n")
            git("switch", "main")
            git("switch", "private-notes")
            for name, text in notes.items():
                self.assertFalse((state / name).exists())
                self.assertEqual((copies / name).read_text(), text)
            self.assertTrue((reset_backup / "progress.md").exists())
            git("add", "--all")
            self.assertEqual(git("diff", "--cached", "--name-only").stdout, "")
            self.assertEqual(git("ls-files", "--", str(state / "backups")).stdout, "")

    def test_inspection_reports_tracked_private_notes(self):
        with tempfile.TemporaryDirectory(prefix="learning-tracking-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)],check=True,capture_output=True)
            state = project / ".learning"
            state.mkdir()
            profile = state / "profile.md"
            profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
            subprocess.run(["git", "-C", str(project), "add", "-f", str(profile)],check=True,capture_output=True)
            output = subprocess.check_output([sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(project)],text=True)
            result = json.loads(output)
            self.assertTrue(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [str(profile)])
            self.assertFalse((state / "backups").exists())

    def test_guard_survives_reset_and_excludes_notes_from_git_add(self):
        with tempfile.TemporaryDirectory(prefix="learning-privacy-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)],check=True,capture_output=True)
            state = project / ".learning"
            state.mkdir()
            for name in ["profile.md", "progress.md", "project-map.md"]:
                shutil.copyfile(ROOT / "templates" / name, state / name)
            shutil.copyfile(ROOT / "templates/private.gitignore", state / ".gitignore")
            (project / "app.py").write_text("application source\n")
            command = [sys.executable, "-B", str(ROOT / "scripts/reset.py"), "--cwd", str(project)]
            preview = json.loads(subprocess.check_output(command, text=True))
            subprocess.run(command + ["--confirm", preview["confirmation"]],check=True,capture_output=True)
            subprocess.run(["git", "-C", str(project), "add", "--all"],check=True,capture_output=True)
            tracked = subprocess.check_output(["git", "-C", str(project), "ls-files"],text=True).splitlines()
            self.assertEqual(tracked, ["app.py"])
            self.assertEqual((state / ".gitignore").read_bytes(), (ROOT / "templates/private.gitignore").read_bytes())
            self.assertTrue(any((state / "backups").iterdir()))


if __name__ == "__main__":
    unittest.main()
