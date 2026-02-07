---
description: Clean up after a merged PR - switch to base branch, pull, delete merged branch, prune
argument-hint: "[--dry-run] [--force] [--base <branch>] [--remote <name>] [--allow-dirty] [--prune-tags] [--no-update]"
allowed-tools: Bash(python3 *, python *, git *)
---

Run the cleanup skill to clean up after a merged PR.

## Context

Current branch:

!git branch --show-current

Remotes:

!git remote -v

## Instructions

Run the cleanup script with the provided arguments:

```bash
python3 .claude/skills/cleanup/bin/git-cleanup.py $ARGUMENTS
```

If python3 is not available, try:

```bash
python .claude/skills/cleanup/bin/git-cleanup.py $ARGUMENTS
```

Report the `[cleanup]` output lines **verbatim** to the user.

If exit code is 1, report the `[cleanup:error]` message to the user.

If exit code is 2, inform the user that the branch could not be safely deleted (common after squash merges) and suggest re-running with `--force`.
