#!/usr/bin/env python3
"""git-cleanup: Post-merge branch cleanup with safety checks.

A deterministic, reusable script for cleaning up local branches after
a PR is merged. Detects remote, base branch, and protected branches
automatically. Produces parseable [cleanup] output lines.

Requires: Python 3.8+, Git 2.23+ (for git switch)
Dependencies: None (stdlib only)
"""

import argparse
import fnmatch
import subprocess
import sys

VERSION = "1.0.0"

PROTECTED_EXACT = frozenset({
    "main", "master", "develop", "staging", "production",
})
PROTECTED_PATTERNS = ("release/*", "hotfix/*")

PREFIX = "[cleanup]"
PREFIX_DRY = "[cleanup:dry-run]"
PREFIX_WARN = "[cleanup:warn]"
PREFIX_ERROR = "[cleanup:error]"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def emit(msg, prefix=PREFIX):
    """Print a prefixed, parseable output line."""
    print("{} {}".format(prefix, msg))


def emit_dry(msg):
    emit(msg, prefix=PREFIX_DRY)


def emit_warn(msg):
    emit(msg, prefix=PREFIX_WARN)


def emit_error(msg):
    emit(msg, prefix=PREFIX_ERROR)


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def run_git(*args, check=True, capture=True):
    """Run a git command and return CompletedProcess.

    Never uses shell=True. Always passes args as a list.
    """
    cmd = ["git"] + list(args)
    try:
        result = subprocess.run(
            cmd,
            check=check,
            capture_output=capture,
            text=True,
            timeout=60,
        )
        return result
    except subprocess.CalledProcessError as exc:
        return exc
    except subprocess.TimeoutExpired:
        return None


def git_output(*args):
    """Run a git command and return stripped stdout, or None on failure."""
    result = run_git(*args, check=False)
    if result is None:
        return None
    if isinstance(result, subprocess.CalledProcessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def is_git_repo():
    """Return True if the current directory is inside a git repo."""
    out = git_output("rev-parse", "--git-dir")
    return out is not None


def is_dirty():
    """Return True if the working tree has uncommitted changes."""
    out = git_output("status", "--porcelain")
    if out is None:
        return True  # treat failure as dirty for safety
    return len(out) > 0


def current_branch():
    """Return the current branch name, or '' if in detached HEAD state."""
    out = git_output("branch", "--show-current")
    if out is None:
        return ""
    return out


def list_remotes():
    """Return a list of remote names."""
    out = git_output("remote")
    if not out:
        return []
    return out.splitlines()


def remote_exists(name):
    """Return True if a remote with the given name exists."""
    return name in list_remotes()


def branch_exists_locally(name):
    """Return True if a local branch with the given name exists."""
    result = run_git("rev-parse", "--verify", "refs/heads/{}".format(name), check=False)
    if result is None or isinstance(result, subprocess.CalledProcessError):
        return False
    return result.returncode == 0


def remote_branch_exists(remote, branch):
    """Return True if a remote-tracking ref exists for remote/branch."""
    result = run_git(
        "rev-parse", "--verify",
        "refs/remotes/{}/{}".format(remote, branch),
        check=False,
    )
    if result is None or isinstance(result, subprocess.CalledProcessError):
        return False
    return result.returncode == 0


def get_config(key):
    """Return git config value for key, or None if unset."""
    out = git_output("config", "--get", key)
    return out if out else None


def get_config_all(key):
    """Return all git config values for key as a list."""
    out = git_output("config", "--get-all", key)
    if not out:
        return []
    return out.splitlines()


# ---------------------------------------------------------------------------
# Detection logic
# ---------------------------------------------------------------------------

def detect_remote(explicit=None):
    """Detect the remote to use.

    Priority:
    1. explicit (--remote flag)
    2. git config cleanup.remote
    3. 'upstream' if it exists
    4. 'origin' if it exists
    5. first remote
    6. None (no remotes)
    """
    if explicit:
        if remote_exists(explicit):
            return explicit
        return None  # caller handles error

    config_remote = get_config("cleanup.remote")
    if config_remote and remote_exists(config_remote):
        return config_remote

    remotes = list_remotes()
    if not remotes:
        return None

    if "upstream" in remotes:
        return "upstream"
    if "origin" in remotes:
        return "origin"
    return remotes[0]


def detect_base_branch(remote, explicit=None):
    """Detect the base (default) branch.

    Priority:
    1. explicit (--base flag)
    2. git config cleanup.base
    3. git symbolic-ref refs/remotes/{remote}/HEAD
    4. Probe main, then master locally
    5. None
    """
    if explicit:
        return explicit

    config_base = get_config("cleanup.base")
    if config_base:
        return config_base

    # Try symbolic-ref (local, no network)
    symref = git_output("symbolic-ref", "refs/remotes/{}/HEAD".format(remote))
    if symref:
        # symref looks like "refs/remotes/origin/main" -> extract "main"
        prefix = "refs/remotes/{}/".format(remote)
        if symref.startswith(prefix):
            return symref[len(prefix):]

    # Probe common names (local first, then remote tracking refs)
    for candidate in ("main", "master"):
        if branch_exists_locally(candidate):
            return candidate
    for candidate in ("main", "master"):
        if remote_branch_exists(remote, candidate):
            return candidate

    return None


def is_protected(branch, base, extra_patterns=None):
    """Return True if the branch should be protected from deletion.

    The base branch is ALWAYS protected, even with --force.
    """
    if branch == base:
        return True
    if branch in PROTECTED_EXACT:
        return True
    for pattern in PROTECTED_PATTERNS:
        if fnmatch.fnmatch(branch, pattern):
            return True
    for pattern in (extra_patterns or []):
        if fnmatch.fnmatch(branch, pattern):
            return True
    return False


# ---------------------------------------------------------------------------
# Core operations
# ---------------------------------------------------------------------------

def fetch_remote(remote, prune_tags=False, dry_run=False):
    """Fetch from remote with --prune (and optionally --prune-tags).

    Returns True on success, False on failure.
    """
    args = ["fetch", remote, "--prune"]
    if prune_tags:
        args.append("--prune-tags")

    if dry_run:
        tag_note = " --prune-tags" if prune_tags else ""
        emit_dry("would fetch: {} --prune{}".format(remote, tag_note))
        return True

    result = run_git(*args, check=False)
    if result is None:
        emit_error("fetch timed out")
        return False
    if isinstance(result, subprocess.CalledProcessError) or result.returncode != 0:
        stderr = ""
        if hasattr(result, "stderr") and result.stderr:
            stderr = result.stderr.strip()
        emit_error("fetch failed: {}".format(stderr or "unknown error"))
        return False

    # Report what was pruned (info is in stderr for git fetch)
    stderr = result.stderr.strip() if result.stderr else ""
    pruned_lines = [
        l for l in stderr.splitlines()
        if "pruned" in l.lower() or "[deleted]" in l.lower()
    ]
    if pruned_lines:
        emit("fetch: pruned {} stale remote-tracking ref(s)".format(len(pruned_lines)))
    else:
        emit("fetch: up to date")
    return True


def switch_to_base(base, remote, current, dry_run=False):
    """Switch to the base branch, creating a tracking branch if needed.

    Returns True on success, False on failure.
    """
    if current == base:
        if not dry_run:
            emit("switch: already on {}".format(base))
        return True

    if dry_run:
        emit_dry("would switch: {} -> {}".format(current or "(detached)", base))
        return True

    if branch_exists_locally(base):
        result = run_git("switch", base, check=False)
    else:
        # Create tracking branch
        result = run_git(
            "switch", "-c", base, "--track",
            "{}/{}".format(remote, base),
            check=False,
        )

    if result is None or isinstance(result, subprocess.CalledProcessError):
        emit_error("switch to {} failed".format(base))
        return False
    if result.returncode != 0:
        stderr = result.stderr.strip() if result.stderr else ""
        emit_error("switch to {} failed: {}".format(base, stderr))
        return False

    emit("switch: {} -> {}".format(current or "(detached)", base))
    return True


def update_base(base, remote, dry_run=False):
    """Fast-forward the base branch from remote.

    Returns True on success, False on divergence/failure.
    """
    if dry_run:
        emit_dry("would update: {} via fast-forward".format(base))
        return True

    # Verify remote branch exists
    if not remote_branch_exists(remote, base):
        emit_error("remote branch {}/{} not found".format(remote, base))
        return False

    result = run_git("merge", "--ff-only", "{}/{}".format(remote, base), check=False)
    if result is None or isinstance(result, subprocess.CalledProcessError):
        emit_error(
            "base not updated: {} has diverged from {}/{} "
            "(use --no-update to skip)".format(base, remote, base)
        )
        return False
    if result.returncode != 0:
        emit_error(
            "base not updated: {} has diverged from {}/{} "
            "(use --no-update to skip)".format(base, remote, base)
        )
        return False

    # Get short SHA for summary
    sha = git_output("rev-parse", "--short", "HEAD") or "unknown"
    emit("update: {} fast-forwarded to {}".format(base, sha))
    return True


def delete_branch(branch, force=False, dry_run=False):
    """Delete a local branch.

    Returns:
        0 = deleted successfully
        1 = error (unexpected failure)
        2 = safe-delete refused (not fully merged, needs --force)
    """
    if dry_run:
        emit_dry("would delete: {}".format(branch))
        return 0

    # Try safe delete first
    result = run_git("branch", "-d", branch, check=False)
    if result is not None and not isinstance(result, subprocess.CalledProcessError) and result.returncode == 0:
        emit("delete: {} (merged)".format(branch))
        return 0

    # Safe delete failed
    if not force:
        emit_warn(
            "branch {} not fully merged (use --force to delete)".format(branch)
        )
        return 2

    # Force delete
    result = run_git("branch", "-D", branch, check=False)
    if result is not None and not isinstance(result, subprocess.CalledProcessError) and result.returncode == 0:
        emit("delete: {} (force)".format(branch))
        return 0

    stderr = ""
    if result and hasattr(result, "stderr") and result.stderr:
        stderr = result.stderr.strip()
    emit_error("failed to delete {}: {}".format(branch, stderr or "unknown error"))
    return 1


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def cleanup(args):
    """Run the full cleanup workflow. Returns exit code (0, 1, or 2)."""
    # Step 1: Verify git repo
    if not is_git_repo():
        emit_error("not a git repository")
        return 1

    # Step 2: Check dirty working tree
    if not args.allow_dirty and is_dirty():
        emit_error(
            "working tree has uncommitted changes "
            "(use --allow-dirty to override)"
        )
        return 1

    # Step 3: Record current branch
    starting_branch = current_branch()
    detached = not starting_branch

    # Step 4: Detect remote
    remote = detect_remote(explicit=args.remote)
    if not remote:
        if args.remote:
            emit_error("remote '{}' not found".format(args.remote))
        else:
            emit_error("no remotes configured")
        return 1

    # Step 5: Detect base branch
    base = detect_base_branch(remote, explicit=args.base)
    if not base:
        emit_error(
            "could not detect base branch "
            "(use --base <branch> or set git config cleanup.base)"
        )
        return 1

    # Emit detected configuration
    p = PREFIX_DRY if args.dry_run else PREFIX
    emit("remote: {}".format(remote), prefix=p)
    emit("base: {}".format(base), prefix=p)
    if not args.dry_run:
        emit("starting-branch: {}".format(starting_branch or "(detached)"))

    if detached and not args.dry_run:
        emit_warn("detached HEAD detected, skipping branch deletion")

    # Step 6: Dry-run plan
    if args.dry_run:
        emit_dry("would fetch: {} --prune{}".format(
            remote,
            " --prune-tags" if args.prune_tags else "",
        ))
        if starting_branch != base:
            emit_dry("would switch: {} -> {}".format(
                starting_branch or "(detached)", base
            ))
        if not args.no_update:
            emit_dry("would update: {} via fast-forward".format(base))
        if starting_branch and starting_branch != base and not detached:
            extra = get_config_all("cleanup.protected-branches")
            if is_protected(starting_branch, base, extra):
                emit_dry("would skip: {} (protected)".format(starting_branch))
            else:
                emit_dry("would delete: {}".format(starting_branch))
        return 0

    # Step 7: Fetch
    if not fetch_remote(remote, prune_tags=args.prune_tags):
        return 1

    # Step 8: Switch to base
    if not switch_to_base(base, remote, starting_branch):
        return 1

    # Step 9: Fast-forward update
    if not args.no_update:
        if not update_base(base, remote):
            return 1
    else:
        emit("update: skipped (--no-update)")

    # Step 10: Delete previously-current branch
    deleted = 0
    skipped = 0
    failed = 0

    if detached or not starting_branch or starting_branch == base:
        # Nothing to delete
        skipped = 0
    else:
        extra_protected = get_config_all("cleanup.protected-branches")
        if is_protected(starting_branch, base, extra_protected):
            emit("skip: {} (protected)".format(starting_branch))
            skipped = 1
        else:
            result = delete_branch(starting_branch, force=args.force)
            if result == 0:
                deleted = 1
            elif result == 2:
                failed = 1
                # Step 11: Print summary even on exit 2
                emit("done: {} branch deleted, {} skipped, {} failed".format(
                    deleted, skipped, failed
                ))
                return 2
            else:
                failed = 1

    # Step 11: Summary
    emit("done: {} branch deleted, {} skipped, {} failed".format(
        deleted, skipped, failed
    ))

    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv=None):
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        prog="git-cleanup",
        description=(
            "Post-merge branch cleanup: fetch, switch to base branch, "
            "fast-forward, delete merged branch, prune stale refs."
        ),
    )
    parser.add_argument(
        "--remote",
        default=None,
        help=(
            "Remote name (default: auto-detect; prefers 'upstream' over "
            "'origin'). Override per-repo with: git config cleanup.remote <name>"
        ),
    )
    parser.add_argument(
        "--base",
        default=None,
        help=(
            "Base branch to switch to (default: auto-detect via remote HEAD "
            "or probe main/master). Override per-repo with: "
            "git config cleanup.base <branch>"
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help=(
            "Force-delete branches that are not fully merged "
            "(uses git branch -D instead of -d)"
        ),
    )
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        default=False,
        help="Proceed even if the working tree has uncommitted changes",
    )
    parser.add_argument(
        "--prune-tags",
        action="store_true",
        default=False,
        help="Also prune local tags not present on the remote",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Print what would happen without making any changes",
    )
    parser.add_argument(
        "--no-update",
        action="store_true",
        default=False,
        help="Skip fast-forward update of the base branch",
    )
    parser.add_argument(
        "--version",
        action="version",
        version="git-cleanup {}".format(VERSION),
    )
    return parser.parse_args(argv)


def main():
    args = parse_args()
    code = cleanup(args)
    sys.exit(code)


if __name__ == "__main__":
    main()
