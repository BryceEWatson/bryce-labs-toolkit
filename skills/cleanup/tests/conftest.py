"""Test fixtures for git-cleanup integration tests.

Creates temporary git repositories with bare remotes for realistic testing.
All fixtures are function-scoped for test isolation.
"""

import os
import subprocess
import sys
import textwrap

import pytest

# Path to the git-cleanup.py script under test
SCRIPT_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "bin", "git-cleanup.py")
)


def _run_in(cwd, *args, check=True):
    """Run a command in a directory, capturing output."""
    return subprocess.run(
        list(args),
        cwd=cwd,
        check=check,
        capture_output=True,
        text=True,
        timeout=30,
    )


def _write_file(repo_path, filename, content=""):
    """Write a file inside a repo directory."""
    filepath = os.path.join(repo_path, filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w") as f:
        f.write(content)


@pytest.fixture
def git_repo_factory(tmp_path_factory):
    """Factory that creates a local git repo with a bare remote.

    Returns a callable with the following parameters:
        base_name: Name of the default branch (default: "main")
        branches: List of branch names to create with commits
        current_branch: Branch to checkout after setup (default: last created)
        dirty: Leave uncommitted changes in working tree
        squash_merged: List of branch names to squash-merge into base
        merged: List of branch names to regular-merge into base
        no_remote_head: Don't set remote HEAD symref
        protected_config: List of patterns to add to cleanup.protected-branches
        extra_remotes: Dict of {name: path} for additional remotes

    Returns (local_path, remote_path) tuple.
    """

    def factory(
        base_name="main",
        branches=None,
        current_branch=None,
        dirty=False,
        squash_merged=None,
        merged=None,
        no_remote_head=False,
        protected_config=None,
        extra_remotes=None,
    ):
        base_dir = tmp_path_factory.mktemp("git-cleanup-test")
        remote_path = str(base_dir / "remote.git")
        local_path = str(base_dir / "local")

        # Create bare remote
        _run_in(str(base_dir), "git", "init", "--bare", remote_path)

        # Clone it
        _run_in(str(base_dir), "git", "clone", remote_path, local_path)

        # Configure user for commits
        _run_in(local_path, "git", "config", "user.email", "test@test.com")
        _run_in(local_path, "git", "config", "user.name", "Test User")

        # Initial commit on default branch
        _write_file(local_path, "README.md", "# Test Repo\n")
        _run_in(local_path, "git", "add", ".")
        _run_in(local_path, "git", "commit", "-m", "Initial commit")

        # Rename default branch if needed
        _run_in(local_path, "git", "branch", "-M", base_name)
        _run_in(local_path, "git", "push", "-u", "origin", base_name)

        # Set remote HEAD unless disabled, and sync to local
        if not no_remote_head:
            _run_in(
                remote_path,
                "git", "symbolic-ref", "HEAD",
                "refs/heads/{}".format(base_name),
            )
            _run_in(
                local_path,
                "git", "remote", "set-head", "origin", base_name,
            )

        # Create feature branches with commits
        for branch in (branches or []):
            _run_in(local_path, "git", "switch", "-c", branch)
            # Support branch names with slashes by using a flat filename
            safe_name = branch.replace("/", "-")
            _write_file(
                local_path, "{}.txt".format(safe_name),
                "content for {}\n".format(branch),
            )
            _run_in(local_path, "git", "add", ".")
            _run_in(local_path, "git", "commit", "-m", "Add {}".format(branch))
            _run_in(local_path, "git", "push", "-u", "origin", branch)

        # Regular-merge branches into base
        for branch in (merged or []):
            _run_in(local_path, "git", "switch", base_name)
            _run_in(
                local_path, "git", "merge", branch,
                "--no-ff", "-m", "Merge {}".format(branch),
            )
            _run_in(local_path, "git", "push", "origin", base_name)

        # Squash-merge branches into base, then delete remote branch
        # (simulates GitHub's "Squash and merge" + auto-delete behavior)
        for branch in (squash_merged or []):
            _run_in(local_path, "git", "switch", base_name)
            _run_in(local_path, "git", "merge", "--squash", branch)
            _run_in(
                local_path, "git", "commit",
                "-m", "Squash merge {}".format(branch),
            )
            _run_in(local_path, "git", "push", "origin", base_name)
            # Delete remote branch (GitHub does this after squash merge)
            _run_in(
                local_path, "git", "push", "origin", "--delete", branch,
                check=False,
            )
            _run_in(local_path, "git", "fetch", "--prune")

        # Set current branch
        if current_branch:
            _run_in(local_path, "git", "switch", current_branch)
        elif branches and not merged and not squash_merged:
            # Stay on last created branch (realistic: user just pushed)
            pass
        else:
            # Ensure we're on base after merges
            _run_in(local_path, "git", "switch", base_name)

        # Make working tree dirty
        if dirty:
            _write_file(local_path, "dirty.txt", "uncommitted changes\n")

        # Set protected branches config
        for pattern in (protected_config or []):
            _run_in(
                local_path, "git", "config", "--add",
                "cleanup.protected-branches", pattern,
            )

        # Add extra remotes
        for name, path in (extra_remotes or {}).items():
            _run_in(local_path, "git", "remote", "add", name, path)

        return local_path, remote_path

    return factory


@pytest.fixture
def run_cleanup():
    """Helper to invoke git-cleanup.py in a given directory.

    Returns a callable: run(cwd, *extra_args) -> (exit_code, stdout, stderr)
    """

    def run(cwd, *args):
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH] + list(args),
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        return result.returncode, result.stdout, result.stderr

    return run
