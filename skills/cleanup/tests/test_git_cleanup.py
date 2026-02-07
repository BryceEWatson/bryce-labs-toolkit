"""Integration tests for git-cleanup.py.

All tests use real temporary git repos with bare remotes.
No mocking of git. Each test is fully isolated.
"""

import os
import subprocess


# ---------------------------------------------------------------------------
# Helper to check actual git state after cleanup runs
# ---------------------------------------------------------------------------

def _git_branches(cwd):
    """Return a set of local branch names in the repo."""
    result = subprocess.run(
        ["git", "branch", "--list", "--format=%(refname:short)"],
        cwd=cwd, capture_output=True, text=True, check=True,
    )
    return set(result.stdout.strip().splitlines())


def _git_current_branch(cwd):
    """Return the current branch name."""
    result = subprocess.run(
        ["git", "branch", "--show-current"],
        cwd=cwd, capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def _run_in(cwd, *args, check=True):
    """Run a command in a directory."""
    return subprocess.run(
        list(args), cwd=cwd, check=check, capture_output=True, text=True,
    )


# ---------------------------------------------------------------------------
# Test 1: Not in git repo
# ---------------------------------------------------------------------------

class TestNotGitRepo:
    def test_not_git_repo(self, tmp_path, run_cleanup):
        """Running outside a git repo should exit 1."""
        code, stdout, stderr = run_cleanup(str(tmp_path))
        assert code == 1
        assert "[cleanup:error] not a git repository" in stdout


# ---------------------------------------------------------------------------
# Tests 2-3: Dirty working tree
# ---------------------------------------------------------------------------

class TestDirtyWorkingTree:
    def test_dirty_tree_aborts(self, git_repo_factory, run_cleanup):
        """Dirty working tree without --allow-dirty should exit 1."""
        local, _ = git_repo_factory(
            branches=["feature/test"],
            current_branch="feature/test",
            dirty=True,
        )
        code, stdout, _ = run_cleanup(local)
        assert code == 1
        assert "[cleanup:error] working tree has uncommitted changes" in stdout

    def test_dirty_tree_allow_dirty(self, git_repo_factory, run_cleanup):
        """Dirty working tree with --allow-dirty should proceed."""
        local, _ = git_repo_factory(
            branches=["feature/test"],
            current_branch="feature/test",
            merged=["feature/test"],
            dirty=True,
        )
        code, stdout, _ = run_cleanup(local, "--allow-dirty")
        assert code == 0
        assert "[cleanup]" in stdout


# ---------------------------------------------------------------------------
# Tests 4-7: Base branch detection
# ---------------------------------------------------------------------------

class TestBaseBranchDetection:
    def test_detection_via_symbolic_ref(self, git_repo_factory, run_cleanup):
        """Should detect base from remote HEAD symbolic-ref."""
        local, _ = git_repo_factory(
            base_name="main",
            branches=["feature/test"],
            current_branch="feature/test",
            merged=["feature/test"],
        )
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "[cleanup] base: main" in stdout

    def test_detection_fallback_no_remote_head(self, git_repo_factory, run_cleanup):
        """With no remote HEAD, should fall back to probing main."""
        local, _ = git_repo_factory(
            base_name="main",
            branches=["feature/test"],
            current_branch="feature/test",
            merged=["feature/test"],
            no_remote_head=True,
        )
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "[cleanup] base: main" in stdout

    def test_explicit_base_flag(self, git_repo_factory, run_cleanup):
        """--base flag should override detection."""
        local, _ = git_repo_factory(
            base_name="develop",
            branches=["feature/test"],
            current_branch="feature/test",
            merged=["feature/test"],
        )
        code, stdout, _ = run_cleanup(local, "--base", "develop")
        assert code == 0
        assert "[cleanup] base: develop" in stdout

    def test_cleanup_base_git_config(self, git_repo_factory, run_cleanup):
        """git config cleanup.base should be used when set."""
        local, _ = git_repo_factory(
            base_name="develop",
            branches=["feature/test"],
            current_branch="feature/test",
            merged=["feature/test"],
            no_remote_head=True,
        )
        # Set config
        _run_in(local, "git", "config", "cleanup.base", "develop")
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "[cleanup] base: develop" in stdout


# ---------------------------------------------------------------------------
# Tests 8-10: Branch deletion
# ---------------------------------------------------------------------------

class TestBranchDeletion:
    def test_safe_delete_merged(self, git_repo_factory, run_cleanup):
        """Regular-merged branch should be safely deleted."""
        local, _ = git_repo_factory(
            branches=["feature/merged"],
            current_branch="feature/merged",
            merged=["feature/merged"],
        )
        # After merge, factory leaves us on main; switch to feature
        _run_in(local, "git", "switch", "feature/merged")
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "[cleanup] delete: feature/merged (merged)" in stdout
        assert "feature/merged" not in _git_branches(local)

    def test_safe_delete_fails_squash_merge(self, git_repo_factory, run_cleanup):
        """Squash-merged branch should fail safe-delete and exit 2."""
        local, _ = git_repo_factory(
            branches=["feature/squashed"],
            current_branch="feature/squashed",
            squash_merged=["feature/squashed"],
        )
        # After squash merge, factory leaves us on main; switch to feature
        _run_in(local, "git", "switch", "feature/squashed")
        code, stdout, _ = run_cleanup(local)
        assert code == 2
        assert "not fully merged" in stdout
        # Branch should still exist
        assert "feature/squashed" in _git_branches(local)

    def test_force_delete_squash_merge(self, git_repo_factory, run_cleanup):
        """--force should allow deleting squash-merged branches."""
        local, _ = git_repo_factory(
            branches=["feature/squashed"],
            current_branch="feature/squashed",
            squash_merged=["feature/squashed"],
        )
        _run_in(local, "git", "switch", "feature/squashed")
        code, stdout, _ = run_cleanup(local, "--force")
        assert code == 0
        assert "[cleanup] delete: feature/squashed (force)" in stdout
        assert "feature/squashed" not in _git_branches(local)


# ---------------------------------------------------------------------------
# Tests 11-13: Protected branches
# ---------------------------------------------------------------------------

class TestProtectedBranches:
    def test_protected_base_branch(self, git_repo_factory, run_cleanup):
        """Should not delete the base branch, exit 0."""
        local, _ = git_repo_factory(base_name="main")
        # Already on main, nothing to delete
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "0 branch deleted" in stdout
        assert "main" in _git_branches(local)

    def test_protected_pattern_release(self, git_repo_factory, run_cleanup):
        """Branches matching release/* should be protected."""
        local, _ = git_repo_factory(
            branches=["release/1.0"],
            current_branch="release/1.0",
            merged=["release/1.0"],
        )
        _run_in(local, "git", "switch", "release/1.0")
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "protected" in stdout
        assert "release/1.0" in _git_branches(local)

    def test_protected_via_git_config(self, git_repo_factory, run_cleanup):
        """Branches matching cleanup.protected-branches config should be protected."""
        local, _ = git_repo_factory(
            branches=["feature/special"],
            current_branch="feature/special",
            merged=["feature/special"],
            protected_config=["feature/special"],
        )
        _run_in(local, "git", "switch", "feature/special")
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "protected" in stdout
        assert "feature/special" in _git_branches(local)


# ---------------------------------------------------------------------------
# Tests 14-16: Fast-forward update
# ---------------------------------------------------------------------------

class TestFastForwardUpdate:
    def test_ff_only_success(self, git_repo_factory, run_cleanup):
        """Should report fast-forward success."""
        local, remote = git_repo_factory(
            branches=["feature/ff"],
            current_branch="feature/ff",
            merged=["feature/ff"],
        )
        _run_in(local, "git", "switch", "feature/ff")
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "fast-forwarded" in stdout

    def test_ff_only_failure_diverged(self, git_repo_factory, run_cleanup):
        """Diverged base should exit 1."""
        local, remote = git_repo_factory(
            branches=["feature/div"],
            current_branch="feature/div",
            merged=["feature/div"],
        )
        _run_in(local, "git", "switch", "feature/div")

        # Create divergence: add a commit to local main that's not on remote
        _run_in(local, "git", "switch", "main")
        with open(os.path.join(local, "local-only.txt"), "w") as f:
            f.write("local divergence\n")
        _run_in(local, "git", "add", ".")
        _run_in(local, "git", "commit", "-m", "Local-only commit")

        # Add a different commit to remote main
        # Clone remote to a temp location, commit, push
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_clone = os.path.join(tmpdir, "tmp-clone")
            _run_in(tmpdir, "git", "clone", remote, tmp_clone)
            _run_in(tmp_clone, "git", "config", "user.email", "t@t.com")
            _run_in(tmp_clone, "git", "config", "user.name", "T")
            with open(os.path.join(tmp_clone, "remote-only.txt"), "w") as f:
                f.write("remote divergence\n")
            _run_in(tmp_clone, "git", "add", ".")
            _run_in(tmp_clone, "git", "commit", "-m", "Remote-only commit")
            _run_in(tmp_clone, "git", "push", "origin", "main")

        # Switch back to feature branch for cleanup
        _run_in(local, "git", "switch", "feature/div")

        code, stdout, _ = run_cleanup(local)
        assert code == 1
        assert "[cleanup:error]" in stdout
        assert "diverged" in stdout or "not updated" in stdout

    def test_no_update_skips(self, git_repo_factory, run_cleanup):
        """--no-update should skip fast-forward, exit 0."""
        local, _ = git_repo_factory(
            branches=["feature/noup"],
            current_branch="feature/noup",
            merged=["feature/noup"],
        )
        _run_in(local, "git", "switch", "feature/noup")
        code, stdout, _ = run_cleanup(local, "--no-update")
        assert code == 0
        assert "skipped (--no-update)" in stdout


# ---------------------------------------------------------------------------
# Tests 17-18: Pruning
# ---------------------------------------------------------------------------

class TestPruning:
    def test_prune_invoked(self, git_repo_factory, run_cleanup):
        """Fetch with --prune should be invoked."""
        local, remote = git_repo_factory(
            branches=["feature/prune-test"],
            current_branch="feature/prune-test",
            merged=["feature/prune-test"],
        )
        # Delete the branch on remote so it becomes stale
        _run_in(remote, "git", "branch", "-D", "feature/prune-test")
        _run_in(local, "git", "switch", "feature/prune-test")

        code, stdout, _ = run_cleanup(local)
        # Should succeed (or exit 2 for safe-delete); fetch should mention prune
        assert "[cleanup] fetch:" in stdout

    def test_prune_tags(self, git_repo_factory, run_cleanup):
        """--prune-tags should be passed through to fetch."""
        local, _ = git_repo_factory(
            branches=["feature/tags"],
            current_branch="feature/tags",
            merged=["feature/tags"],
        )
        _run_in(local, "git", "switch", "feature/tags")
        code, stdout, _ = run_cleanup(local, "--prune-tags")
        assert code == 0
        assert "[cleanup] fetch:" in stdout


# ---------------------------------------------------------------------------
# Test 19: Dry run
# ---------------------------------------------------------------------------

class TestDryRun:
    def test_dry_run_no_state_changes(self, git_repo_factory, run_cleanup):
        """--dry-run should show plan but not change anything."""
        local, _ = git_repo_factory(
            branches=["feature/dry"],
            current_branch="feature/dry",
            merged=["feature/dry"],
        )
        _run_in(local, "git", "switch", "feature/dry")

        # Record state before
        branches_before = _git_branches(local)
        current_before = _git_current_branch(local)

        code, stdout, _ = run_cleanup(local, "--dry-run")
        assert code == 0
        assert "[cleanup:dry-run]" in stdout
        assert "would" in stdout

        # Verify nothing changed
        assert _git_branches(local) == branches_before
        assert _git_current_branch(local) == current_before


# ---------------------------------------------------------------------------
# Tests 20-22: Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_already_on_base(self, git_repo_factory, run_cleanup):
        """Already on base should still fetch/update/prune."""
        local, _ = git_repo_factory(base_name="main")
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "already on main" in stdout
        assert "0 branch deleted" in stdout

    def test_base_only_on_remote(self, git_repo_factory, run_cleanup):
        """Base branch that only exists on remote should be created locally."""
        local, remote = git_repo_factory(
            base_name="main",
            branches=["feature/remote-base"],
            current_branch="feature/remote-base",
            merged=["feature/remote-base"],
        )
        _run_in(local, "git", "switch", "feature/remote-base")

        # Delete local main (but keep it on remote)
        _run_in(local, "git", "branch", "-D", "main")
        assert "main" not in _git_branches(local)

        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "main" in _git_branches(local)

    def test_no_branches_to_delete(self, git_repo_factory, run_cleanup):
        """When already on main with no other branches, exit 0."""
        local, _ = git_repo_factory(base_name="main")
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "0 branch deleted" in stdout


# ---------------------------------------------------------------------------
# Tests 23-24: Remote detection
# ---------------------------------------------------------------------------

class TestRemoteDetection:
    def test_upstream_preferred(self, git_repo_factory, run_cleanup):
        """When both origin and upstream exist, prefer upstream."""
        local, remote = git_repo_factory(
            base_name="main",
            branches=["feature/upstream"],
            current_branch="feature/upstream",
            merged=["feature/upstream"],
        )
        _run_in(local, "git", "switch", "feature/upstream")

        # Add an 'upstream' remote pointing to same bare repo
        _run_in(local, "git", "remote", "add", "upstream", remote)
        # Set remote HEAD for upstream
        _run_in(local, "git", "fetch", "upstream")
        _run_in(
            local, "git", "remote", "set-head", "upstream", "--auto",
            check=False,
        )

        code, stdout, _ = run_cleanup(local)
        assert "[cleanup] remote: upstream" in stdout

    def test_invalid_remote(self, git_repo_factory, run_cleanup):
        """Specifying a non-existent remote should exit 1."""
        local, _ = git_repo_factory(base_name="main")
        code, stdout, _ = run_cleanup(local, "--remote", "nonexistent")
        assert code == 1
        assert "[cleanup:error]" in stdout
        assert "nonexistent" in stdout


# ---------------------------------------------------------------------------
# Test 25: Branch name with slashes
# ---------------------------------------------------------------------------

class TestBranchNameSlashes:
    def test_branch_with_slashes(self, git_repo_factory, run_cleanup):
        """Branch names with multiple slashes should work correctly."""
        local, _ = git_repo_factory(
            branches=["feature/foo/bar"],
            current_branch="feature/foo/bar",
            merged=["feature/foo/bar"],
        )
        _run_in(local, "git", "switch", "feature/foo/bar")
        code, stdout, _ = run_cleanup(local)
        assert code == 0
        assert "feature/foo/bar" in stdout
        assert "feature/foo/bar" not in _git_branches(local)
