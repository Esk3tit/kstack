"""Exercise real state inspection processes at project and checkout boundaries."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/project_state.py"


class ProjectStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="learning-state-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.project = self.root / "project with spaces"
        self.project.mkdir()
        (self.project / ".git").mkdir()

    def state(self, project=None, name=".learning", text="Learning mode: active\n"):
        path = (project or self.project) / name
        path.mkdir()
        (path / "profile.md").write_text(text, encoding="utf-8")
        return path

    def inspect(self, cwd=None):
        result = subprocess.run(
            [sys.executable, "-B", str(SCRIPT), "--cwd", str(cwd or self.project)],
            capture_output=True, text=True,
        )
        self.assertEqual(result.stderr, "")
        return result.returncode, json.loads(result.stdout)

    def test_markerless_profiles_activate_only_in_legacy_directories(self):
        modern = self.state(text="Goal: better engineering\n")
        self.assertEqual(self.inspect()[1]["profile_status"], "paused")
        modern.rename(self.project / ".vibe-wise")
        self.assertEqual(self.inspect()[1]["profile_status"], "active")
        (self.project / ".vibe-wise").rename(self.project / ".sensible-vibes")
        self.assertEqual(self.inspect()[1]["profile_status"], "active")

    def test_bullet_pause_is_respected_in_modern_and_legacy_profiles(self):
        state = self.state(text="- **Learning mode:** paused\n")
        self.assertEqual(self.inspect()[1]["profile_status"], "paused")
        state.rename(self.project / ".vibe-wise")
        self.assertEqual(self.inspect()[1]["profile_status"], "paused")

    def test_nearest_legacy_state_wins_over_parent_state(self):
        self.state()
        child = self.project / "package"
        child.mkdir()
        state = self.state(child, ".sensible-vibes", "Learning mode: paused\n")
        code, result = self.inspect(child)
        self.assertEqual(code, 0)
        self.assertEqual(result["state"], str(state))
        self.assertEqual(result["profile_status"], "paused")

    def test_primary_directory_wins_over_both_legacy_names(self):
        self.state(name=".sensible-vibes")
        self.state(name=".vibe-wise")
        primary = self.state(text="Learning mode: paused\n")
        self.assertEqual(self.inspect()[1]["state"], str(primary))
        self.assertEqual(self.inspect()[1]["profile_status"], "paused")

    def test_no_git_folder_does_not_borrow_parent_notes(self):
        self.state(self.root)
        plain = self.root / "plain"
        plain.mkdir()
        self.assertEqual(self.inspect(plain)[1]["profile_status"], "missing")
        own = self.state(plain)
        self.assertEqual(self.inspect(plain)[1]["state"], str(own))

    def test_nested_repository_does_not_borrow_outer_notes(self):
        self.state()
        child = self.project / "nested"
        child.mkdir()
        (child / ".git").mkdir()
        self.assertEqual(self.inspect(child)[1]["profile_status"], "missing")

    def test_large_profile_does_not_hide_a_late_pause(self):
        self.state(text="Learning mode: active\n" + "Evidence\n" * 20000 + "Learning mode: paused\n")
        self.assertEqual(self.inspect()[1]["profile_status"], "paused")

    def test_missing_companions_preserve_profile_without_creating_files(self):
        state = self.state(text="Learning mode: active\nTrack learning notes: yes\n")
        before = {p.name: p.read_bytes() for p in state.iterdir()}
        code, result = self.inspect()
        self.assertEqual(code, 0)
        self.assertTrue(result["track_notes"])
        self.assertEqual(before, {p.name: p.read_bytes() for p in state.iterdir()})

    def test_invalid_profile_text_reports_an_error(self):
        state = self.state()
        (state / "profile.md").write_bytes(b"Learning mode: active\n\xff")
        code, result = self.inspect()
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "error")

    def test_non_directory_state_blocks_legacy_fallback(self):
        self.state(name=".vibe-wise")
        (self.project / ".learning").write_text("not a directory")
        code, result = self.inspect()
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "error")

    def test_invalid_working_directories_are_rejected(self):
        plain_file = self.root / "file"
        plain_file.write_text("file")
        for path in ["relative/path", self.root / "missing", plain_file]:
            with self.subTest(path=str(path)):
                self.assertEqual(self.inspect(path)[0], 1)


if __name__ == "__main__":
    unittest.main()
