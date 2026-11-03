"""Exercise the read-only project inspection command against real temporary paths."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/project_state.py"


class InspectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="learning-inspect-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.project = self.root / "project with spaces"
        self.project.mkdir()
        (self.project / ".git").mkdir()

    def inspect(self, cwd=None):
        result = subprocess.run(
            [sys.executable, "-B", str(SCRIPT), "--cwd", str(cwd or self.project)],
            capture_output=True, text=True,
        )
        self.assertEqual(result.stderr, "")
        return result.returncode, json.loads(result.stdout)

    def test_new_project_reports_missing_without_creating_notes(self):
        code, result = self.inspect()
        self.assertEqual(code, 0)
        self.assertEqual(result["profile_status"], "missing")
        self.assertEqual(result["state"], str(self.project / ".learning"))
        self.assertFalse(result["exists"])
        self.assertEqual(list(self.project.iterdir()), [self.project / ".git"])

    def test_saved_pause_survives_a_separate_process_from_a_subdirectory(self):
        state = self.project / ".learning"
        state.mkdir()
        profile = state / "profile.md"
        original = b"Learning mode: paused\nOnboarding: complete\n"
        profile.write_bytes(original)
        nested = self.project / "src"
        nested.mkdir()
        for cwd in [self.project, nested]:
            code, result = self.inspect(cwd)
            self.assertEqual(code, 0)
            self.assertEqual(result["state"], str(state))
            self.assertEqual(result["profile_status"], "paused")
        self.assertEqual(profile.read_bytes(), original)

    def test_active_profile_and_legacy_notes_are_preserved(self):
        state = self.project / ".sensible-vibes"
        state.mkdir()
        profile = state / "profile.md"
        profile.write_text("Learning mode: active\n")
        code, result = self.inspect()
        self.assertEqual(code, 0)
        self.assertEqual(result["state"], str(state))
        self.assertEqual(result["profile_status"], "active")
        self.assertFalse((self.project / ".learning").exists())

    def test_off_aliases_and_unknown_mode_values_stay_off(self):
        state = self.project / ".learning"
        state.mkdir()
        for line in ["Learning mode: off", "**Learning mode:** paused", "  Learning mode: paused", "__Learning mode:__ off", "Learning mode: disabled", "Learning mode :", "Learning mode: active\nLearning mode: paused"]:
            with self.subTest(line=line):
                profile = state / "profile.md"
                profile.write_text(line + "\nOnboarding: complete\n")
                code, result = self.inspect()
                self.assertEqual(code, 0)
                self.assertEqual(result["profile_status"], "paused")
                self.assertEqual(profile.read_text(), line + "\nOnboarding: complete\n")

    def test_existing_vibe_wise_notes_are_selected_without_migration(self):
        state = self.project / ".vibe-wise"
        state.mkdir()
        profile = state / "profile.md"
        original = b"Learning mode: active\nOnboarding: complete\n"
        profile.write_bytes(original)
        code, result = self.inspect()
        self.assertEqual(code, 0)
        self.assertEqual(result["state"], str(state))
        self.assertEqual(result["profile_status"], "active")
        self.assertEqual(profile.read_bytes(), original)
        self.assertFalse((self.project / ".learning").exists())

    def test_blocked_local_state_does_not_fall_back_to_parent_notes(self):
        outer = self.project / ".learning"
        outer.mkdir()
        (outer / "profile.md").write_text("Learning mode: active\n")
        nested = self.project / "src"
        nested.mkdir()
        (nested / ".learning").symlink_to(outer, target_is_directory=True)
        code, result = self.inspect(nested)
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "error")

    def test_linked_companion_note_is_rejected_without_reading_its_contents(self):
        state = self.project / ".learning"
        state.mkdir()
        (state / "profile.md").write_text("Learning mode: active\n")
        outside = self.root / "private.txt"
        outside.write_text("private contents")
        (state / "progress.md").symlink_to(outside)
        code, result = self.inspect()
        self.assertEqual(code, 1)
        self.assertNotIn("private contents", json.dumps(result))
        self.assertEqual(outside.read_text(), "private contents")

    def test_worktree_boundary_prevents_inheriting_outer_mode(self):
        state = self.project / ".learning"
        state.mkdir()
        (state / "profile.md").write_text("Learning mode: active\n")
        checkout = self.project / "other-checkout"
        checkout.mkdir()
        (checkout / ".git").write_text("gitdir: elsewhere\n")
        code, result = self.inspect(checkout)
        self.assertEqual(code, 0)
        self.assertEqual(result["profile_status"], "missing")
        self.assertEqual(result["state"], str(checkout / ".learning"))


if __name__ == "__main__":
    unittest.main()
