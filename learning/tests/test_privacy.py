"""Check that normal Git staging cannot include private learning notes or backups."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PrivacyTests(unittest.TestCase):
    def test_linked_sibling_namespace_is_not_a_spelling_alias(self):
        for linked_component in ["namespace", "ancestor"]:
            with self.subTest(linked_component=linked_component), tempfile.TemporaryDirectory(prefix="learning-sibling-link-") as directory:
                project = Path(directory).resolve()
                subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
                for folder in ["a", "b"]:
                    state = project / folder / ".learning"
                    state.mkdir(parents=True)
                    (state / "profile.md").write_text("Learning mode: paused\nTrack learning notes: no\n")
                selected = project / "a" / ".learning"
                sibling = project / "b" / ".learning"
                subprocess.run(["git", "-C", str(project), "add", "-f", "--", str(sibling / "profile.md")], check=True, capture_output=True)
                (sibling / "profile.md").unlink()
                sibling.rmdir()
                if linked_component == "namespace":
                    sibling.symlink_to(selected, target_is_directory=True)
                else:
                    sibling.parent.rmdir()
                    sibling.parent.symlink_to(selected.parent, target_is_directory=True)
                command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(selected.parent)]
                result = json.loads(subprocess.check_output(command, text=True))
                self.assertFalse(result["private_notes_tracked"])
                self.assertEqual(result["tracked_files"], [])
                self.assertEqual(result["tracked_relative_paths"], {})
                reset = [sys.executable, "-B", str(ROOT / "scripts/reset.py"), "--cwd", str(selected.parent)]
                preview = json.loads(subprocess.check_output(reset, text=True))
                subprocess.run(reset + ["--confirm", preview["confirmation"]], check=True, capture_output=True)
                subprocess.run(["git", "-C", str(project), "add", "-f", "--", str(selected / "profile.md")], check=True, capture_output=True)
                result = json.loads(subprocess.check_output(command, text=True))
                self.assertTrue(result["private_notes_tracked"])
                self.assertEqual(result["tracked_files"], [str(selected / "profile.md")])

    def test_index_paths_use_native_checkout_spelling(self):
        cases = [("De\u0301veloppement", "repo", "Développement", "repo"),
                 ("parent", "proje\u0301t", "parent", "projét")]
        for parent, checkout, entered_parent, entered_checkout in cases:
            with self.subTest(parent=parent, checkout=checkout), tempfile.TemporaryDirectory(prefix="learning-checkout-spelling-") as directory:
                base = Path(directory).resolve()
                project = base / parent / checkout
                project.mkdir(parents=True)
                entered = base / entered_parent / entered_checkout
                if not entered.is_dir():
                    self.skipTest("Filesystem does not alias these Unicode spellings")
                subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
                state = project / ".learning"
                state.mkdir()
                profile = state / "profile.md"
                profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
                subprocess.run(["git", "-C", str(project), "add", "--", ".learning/profile.md"], check=True, capture_output=True)
                result = json.loads(subprocess.check_output([sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(entered)], text=True))
                self.assertTrue(result["private_notes_tracked"])
                self.assertEqual(result["tracked_relative_paths"][result["tracked_files"][0]], "profile.md")
                subprocess.run(["git", "-c", "core.precomposeunicode=false", "--literal-pathspecs", "-C", str(entered), "add", "-f", "--", *result["tracked_files"]], check=True, capture_output=True)
                subprocess.run(["git", "-c", "core.precomposeunicode=false", "--literal-pathspecs", "-C", str(entered), "rm", "--cached", "--", *result["tracked_files"]], check=True, capture_output=True)
                self.assertEqual(subprocess.check_output(["git", "-C", str(project), "ls-files", "-z"]), b"")
                self.assertTrue(profile.is_file())

    def test_checkout_spelling_preserves_line_characters(self):
        for name in ["repo\r", "repo\n", "repo\r\n"]:
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix="learning-checkout-lines-") as directory:
                project = Path(directory).resolve() / name
                project.mkdir()
                subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
                state = project / ".learning"
                state.mkdir()
                profile = state / "profile.md"
                profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
                subprocess.run(["git", "-C", str(project), "add", "--", ".learning/profile.md"], check=True, capture_output=True)
                result = json.loads(subprocess.check_output([sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(project)], text=True))
                self.assertEqual(result["tracked_files"], [str(profile)])
                self.assertEqual(result["tracked_relative_paths"], {str(profile): "profile.md"})

    def test_git_worktree_must_match_the_selected_checkout(self):
        with tempfile.TemporaryDirectory(prefix="learning-worktree-scope-") as directory:
            project = Path(directory).resolve() / "project"
            project.mkdir()
            subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
            state = project / ".learning"
            state.mkdir()
            (state / "profile.md").write_text("Learning mode: paused\nTrack learning notes: no\n")
            other = project.parent / "other"
            other.mkdir()
            environment = os.environ.copy()
            environment["GIT_WORK_TREE"] = str(other)
            result = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(project)], text=True, capture_output=True, env=environment)
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not match", json.loads(result.stdout)["message"])

    def test_tracking_uses_native_case_aliases_and_index_paths(self):
        for parent, notes_name, entered in [("Sub", ".learning", "SUB"), ("Mixed", ".Learning", "Mixed")]:
            with self.subTest(parent=parent, notes_name=notes_name), tempfile.TemporaryDirectory(prefix="learning-case-alias-") as directory:
                project = Path(directory).resolve()
                subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
                state = project / parent / notes_name
                state.mkdir(parents=True)
                if not (project / entered / ".learning").is_dir():
                    self.skipTest("Filesystem does not provide these case aliases")
                profile = state / "profile.md"
                profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
                subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "--", str(profile)], check=True, capture_output=True)
                command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(project / entered)]
                result = json.loads(subprocess.check_output(command, text=True))
                self.assertTrue(result["private_notes_tracked"])
                self.assertEqual(len(result["tracked_files"]), 1)
                self.assertTrue(Path(result["tracked_files"][0]).samefile(profile))
                self.assertEqual(result["tracked_relative_paths"][result["tracked_files"][0]], "profile.md")
                reset = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/reset.py"), "--cwd", str(project / entered)], capture_output=True, text=True)
                self.assertEqual(reset.returncode, 1)
                subprocess.run(["git", "-c", "core.precomposeunicode=false", "--literal-pathspecs", "-C", str(project), "rm", "--cached", "--", *result["tracked_files"]], check=True, capture_output=True)
                self.assertFalse(json.loads(subprocess.check_output(command, text=True))["private_notes_tracked"])
                self.assertTrue(profile.is_file())

    def test_index_spelling_survives_unicode_policy_change(self):
        with tempfile.TemporaryDirectory(prefix="learning-index-unicode-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
            state = project / "cafe\u0301" / ".learning"
            state.mkdir(parents=True)
            entered = project / "café"
            if not entered.is_dir():
                self.skipTest("Filesystem does not alias these Unicode spellings")
            profile = state / "profile.md"
            profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
            subprocess.run(["git", "-C", str(project), "config", "core.precomposeunicode", "false"], check=True, capture_output=True)
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "--", str(profile)], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(project), "config", "core.precomposeunicode", "true"], check=True, capture_output=True)
            command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(entered)]
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertTrue(result["private_notes_tracked"])
            self.assertEqual(len(result["tracked_files"]), 1)
            self.assertEqual(result["tracked_relative_paths"][result["tracked_files"][0]], "profile.md")
            subprocess.run(["git", "-c", "core.precomposeunicode=false", "--literal-pathspecs", "-C", str(project), "add", "-f", "--", *result["tracked_files"]], check=True, capture_output=True)
            self.assertEqual(len(subprocess.check_output(["git", "-C", str(project), "ls-files", "-z"]).split(b"\0")) - 1, 1)
            reset = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/reset.py"), "--cwd", str(entered)], capture_output=True, text=True)
            self.assertEqual(reset.returncode, 1)
            subprocess.run(["git", "-c", "core.precomposeunicode=false", "--literal-pathspecs", "-C", str(project), "rm", "--cached", "--", *result["tracked_files"]], check=True, capture_output=True)
            self.assertFalse(json.loads(subprocess.check_output(command, text=True))["private_notes_tracked"])
            self.assertTrue(profile.is_file())

    def test_namespace_query_keeps_other_notes_directories_out_of_scope(self):
        with tempfile.TemporaryDirectory(prefix="learning-index-scope-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
            state = project / "selected" / ".learning"
            state.mkdir(parents=True)
            profile = state / "profile.md"
            profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
            for folder, namespace in [("other", ".learning"), ("deep/inner", ".learning"), ("legacy", ".vibe-wise")]:
                other = project / folder / namespace
                other.mkdir(parents=True)
                (other / "profile.md").write_text("other notes\n")
                subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "--", str(other / "profile.md")], check=True, capture_output=True)
            command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(state.parent)]
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertEqual(result["tracked_files"], [])
            self.assertEqual(result["tracked_relative_paths"], {})
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "--", str(profile)], check=True, capture_output=True)
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertEqual(result["tracked_files"], [str(profile)])
            self.assertEqual(result["tracked_relative_paths"], {str(profile): "profile.md"})

    def test_internal_query_has_explicit_pathspec_semantics(self):
        with tempfile.TemporaryDirectory(prefix="learning-pathspec-environment-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
            state = project / ".learning"
            state.mkdir()
            profile = state / "profile.md"
            profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
            subprocess.run(["git", "-C", str(project), "add", "--", str(profile)], check=True, capture_output=True)
            environment = os.environ.copy()
            environment.update({key: "1" for key in ["GIT_LITERAL_PATHSPECS", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"]})
            command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(project)]
            result = json.loads(subprocess.check_output(command, text=True, env=environment))
            self.assertTrue(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [str(profile)])

    def test_nested_backup_guard_is_not_root_metadata_through_a_link(self):
        with tempfile.TemporaryDirectory(prefix="learning-guard-boundary-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
            state = project / ".learning"
            state.mkdir()
            shutil.copyfile(ROOT / "templates/private.gitignore", state / ".gitignore")
            (state / "profile.md").write_text("Learning mode: paused\nTrack learning notes: no\n")
            alias = state / "backups" / "old" / "files"
            alias.mkdir(parents=True)
            snapshot = alias / ".gitignore"
            snapshot.write_text("private backup content\n")
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "-f", "--", str(snapshot)], check=True, capture_output=True)
            snapshot.unlink()
            alias.rmdir()
            alias.symlink_to(state, target_is_directory=True)
            command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(project)]
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertTrue(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [str(snapshot)])
            self.assertEqual(result["tracked_relative_paths"], {str(snapshot): "backups/old/files/.gitignore"})

    def test_tracked_guard_in_unicode_folder_is_metadata(self):
        with tempfile.TemporaryDirectory(prefix="learning-unicode-guard-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(project), "config", "core.precomposeunicode", "true"], check=True, capture_output=True)
            state = project / "cafe\u0301" / ".learning"
            state.mkdir(parents=True)
            shutil.copyfile(ROOT / "templates/private.gitignore", state / ".gitignore")
            profile = state / "profile.md"
            profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "-f", "--", str(state / ".gitignore")], check=True, capture_output=True)
            command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(state.parent)]
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertFalse(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [])
            reset_command = [sys.executable, "-B", str(ROOT / "scripts/reset.py"), "--cwd", str(state.parent)]
            preview = json.loads(subprocess.check_output(reset_command, text=True))
            subprocess.run(reset_command + ["--confirm", preview["confirmation"]], check=True, capture_output=True)
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "-f", "--", str(profile)], check=True, capture_output=True)
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertTrue(result["private_notes_tracked"])
            self.assertEqual(len(result["tracked_files"]), 1)
            self.assertTrue(Path(result["tracked_files"][0]).samefile(profile))

    def test_tracking_paths_preserve_carriage_returns(self):
        with tempfile.TemporaryDirectory(prefix="learning-path-bytes-") as directory:
            project = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(project)], check=True, capture_output=True)
            state = project / "line\rbreak" / ".learning"
            state.mkdir(parents=True)
            profile = state / "profile.md"
            profile.write_text("Learning mode: paused\nTrack learning notes: no\n")
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "--", str(profile)], check=True, capture_output=True)
            command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(state.parent)]
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertTrue(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [str(profile)])
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "rm", "--cached", "--", *result["tracked_files"]], check=True, capture_output=True)
            self.assertEqual(subprocess.check_output(["git", "-C", str(project), "ls-files", "-z"]), b"")
            self.assertTrue(profile.is_file())

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
            other_notes = project / "ab" / ".learning"
            other_notes.mkdir(parents=True)
            (other_notes / "profile.md").write_text("other project notes\n")
            subprocess.run(["git", "-C", str(project), "add", "--", "zz/.learning", "ab/.learning/profile.md"], check=True, capture_output=True)
            command = [sys.executable, "-B", str(ROOT / "scripts/project_state.py"), "--cwd", str(state.parent)]
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertFalse(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [])
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "add", "--", str(profile)], check=True, capture_output=True)
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertTrue(result["private_notes_tracked"])
            self.assertEqual(result["tracked_files"], [str(profile)])
            subprocess.run(["git", "--literal-pathspecs", "-C", str(project), "rm", "--cached", "--", str(profile)], check=True, capture_output=True)
            tracked = subprocess.check_output(["git", "-C", str(project), "ls-files"], text=True).splitlines()
            self.assertEqual(tracked, ["ab/.learning/profile.md", "zz/.learning"])
            self.assertTrue(profile.is_file())

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
