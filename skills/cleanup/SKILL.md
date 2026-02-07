---
name: cleanup
description: Post-merge git branch cleanup with safety checks and auto-detected base branch
argument-hint: "[--dry-run] [--force] [--base <branch>] [--remote <name>] [--allow-dirty] [--prune-tags] [--no-update]"
---

# cleanup

Post-merge branch cleanup: fetch, switch to base branch, fast-forward update, delete merged branch, prune stale refs.

## Usage

```
/cleanup
/cleanup --dry-run
/cleanup --base develop
/cleanup --remote upstream
/cleanup --force
/cleanup --allow-dirty
/cleanup --prune-tags
/cleanup --no-update
```

## Arguments

Access via `$ARGUMENTS`:

| Flag | Description |
|------|-------------|
| `--remote <name>` | Remote to operate against (default: auto-detect; prefers `upstream` over `origin`) |
| `--base <branch>` | Base branch to switch to (default: auto-detect via remote HEAD or probe main/master) |
| `--force` | Force-delete branches not fully merged (`git branch -D` instead of `-d`) |
| `--allow-dirty` | Proceed despite uncommitted changes in the working tree |
| `--prune-tags` | Also prune local tags not present on the remote |
| `--dry-run` | Preview what would happen without making changes |
| `--no-update` | Skip fast-forward update of the base branch |

## Per-Repo Configuration

Override defaults per repository using git config:

```bash
git config cleanup.base develop          # Always use 'develop' as base
git config cleanup.remote upstream       # Always use 'upstream' remote
git config --add cleanup.protected-branches 'staging'    # Protect extra branches
git config --add cleanup.protected-branches 'release/*'  # Protect with glob patterns
```

## Workflow

### Context

Current branch:

!git branch --show-current

Remotes:

!git remote -v

### Step 1: Run the cleanup script

Locate the script relative to this skill's install location. Try these paths in order:

1. Installed path (after `skills-sync`):
```bash
python3 .claude/skills/cleanup/bin/git-cleanup.py $ARGUMENTS
```

2. Source path (in the toolkit repo):
```bash
python3 skills/cleanup/bin/git-cleanup.py $ARGUMENTS
```

If `python3` is not available, use `python` instead.

### Step 2: Report results

Parse the output lines and report the summary to the user:

- Lines prefixed with `[cleanup]` are normal operation results
- Lines prefixed with `[cleanup:dry-run]` show what would happen
- Lines prefixed with `[cleanup:warn]` are warnings requiring attention
- Lines prefixed with `[cleanup:error]` indicate failures

Report the `[cleanup]` output lines **verbatim** to the user. Do not paraphrase or reformat them.

## Safety Semantics

**Protected branches** are never deleted, even with `--force`:
- The detected base branch (always)
- `main`, `master`, `develop`, `staging`, `production`
- Branches matching `release/*` or `hotfix/*`
- Branches matching patterns in `git config --get-all cleanup.protected-branches`

Pattern matching uses `fnmatch` glob syntax (case-sensitive).

**Working tree**: Aborts if dirty unless `--allow-dirty` is passed.

**Base update**: Uses `git merge --ff-only` (never creates merge commits). If the base has diverged, exits with error unless `--no-update` is passed.

**Branch deletion**: Uses `git branch -d` (safe delete) by default. If the branch is not fully merged (common with squash merges), suggests `--force`.

## Error Handling

| Exit Code | Meaning | What to tell the user |
|-----------|---------|----------------------|
| 0 | Success (including skipped protected branches) | Report the summary |
| 1 | Fatal error (not a repo, dirty tree, remote/base not found, fetch failed, base diverged) | Report the `[cleanup:error]` message |
| 2 | Safe-delete refused (branch not fully merged) | Suggest re-running with `--force` if the PR was merged via squash |

## Troubleshooting

### Python not found

The script requires Python 3.8+. Verify:

```bash
python3 --version
```

On Windows, try `python --version` instead.

### Remote HEAD not set

If base branch detection fails with "could not detect base branch":

```bash
# Set it manually for this repo
git config cleanup.base main

# Or set the remote HEAD
git remote set-head origin --auto
```

### Git version too old

The script uses `git switch` (Git 2.23+, August 2019). Check your version:

```bash
git --version
```

### Branch not fully merged

This typically happens after a squash merge on GitHub/GitLab. The original branch commits are not ancestors of the base, so `git branch -d` refuses. Use `--force` to delete with `git branch -D` after verifying the PR was merged.
