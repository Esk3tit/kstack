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
