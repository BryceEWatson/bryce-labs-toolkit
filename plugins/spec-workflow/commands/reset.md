---
description: "Clear spec-workflow artifacts (specs/plans/reviews)"
argument-hint: "[--dry-run] [--force] [--feature <name>]"
allowed-tools: Bash, AskUserQuestion, Glob
---

spec-workflow v1.0.0 · Reset

You are running the spec-workflow artifact reset command.
This removes generated specs, plans, and reviews to start from a clean slate.

## Argument Parsing

Parse `$ARGUMENTS` for these flags:
- `--dry-run` — Show what would be deleted, delete nothing
- `--force` — Skip confirmation prompt
- `--feature <name>` — Only delete artifacts for a specific feature (kebab-case)

If no arguments are provided, default behavior is: delete ALL spec-workflow artifacts with confirmation.

## Step 1: Discover Artifacts

Use Glob to find existing artifacts:

```
docs/specs/SPEC-*.md
docs/plans/PLAN-*.md
docs/reviews/REVIEW-*.md
```

If `--feature <name>` was provided, filter to only:
- `docs/specs/SPEC-<name>.md`
- `docs/plans/PLAN-<name>.md`
- `docs/reviews/REVIEW-SPEC-<name>.md`
- `docs/reviews/REVIEW-PLAN-<name>.md`
- `docs/reviews/REVIEW-PR-<name>.md`

## Step 2: Report

Print a summary of what will be deleted:

```
spec-workflow reset
  Feature: <name>  (if --feature was provided)
  Files to delete (N):
    - docs/specs/SPEC-example.md
    - docs/plans/PLAN-example.md
    - docs/reviews/REVIEW-SPEC-example.md
```

If no artifacts are found, print:
```
spec-workflow reset: No artifacts found to delete.
```
And stop.

## Step 3: Dry-Run Check

If `--dry-run` is in `$ARGUMENTS`:
- Print `[dry-run] No files were deleted.`
- Print how to re-run without dry-run:
  - `./tools/spec-workflow-reset.sh --force` (Git Bash / macOS / Linux)
  - `tools\spec-workflow-reset.cmd --force` (Windows CMD)
  - `/spec-workflow:reset --force` (Claude Code)
- Stop. Do NOT delete anything.

## Step 4: Confirmation

If `--force` is NOT in `$ARGUMENTS`, use AskUserQuestion to confirm:

```
## Spec-Workflow Reset

The following files will be permanently deleted:

{list each file path, one per line}

.gitkeep files will be preserved. Directories will not be removed.

### What each choice does
- **Delete all listed files** → Permanently removes the artifacts shown above
- **Cancel** → No files are deleted; re-run with `--dry-run` to preview again
```

Options (buttons):
- "Delete all listed files"
- "Cancel"

If user selects "Cancel" or provides free text that isn't clearly "delete" or "yes":
- Print "Aborted. No files were deleted."
- Stop.

## Step 5: Execute Deletion

Build the script command by forwarding all parsed flags from `$ARGUMENTS`:

```
./tools/spec-workflow-reset.sh --force [--feature <name> if provided]
```

**Flag forwarding rules** (you MUST follow these exactly):
- Always include `--force` (confirmation was already handled in Step 4)
- If `--feature <name>` was in `$ARGUMENTS`, append `--feature <name>` to the script command
- Do NOT include `--dry-run` (that case was already handled in Step 3)

**Examples:**
- `$ARGUMENTS` = "" → `./tools/spec-workflow-reset.sh --force`
- `$ARGUMENTS` = "--feature dark-mode" → `./tools/spec-workflow-reset.sh --force --feature dark-mode`
- `$ARGUMENTS` = "--force --feature dark-mode" → `./tools/spec-workflow-reset.sh --force --feature dark-mode`

Run via Bash.

## Step 6: Summary

Print a final summary:

```
Reset complete.

Deleted: N file(s)
Remaining: (list any remaining spec-workflow files, or "none")

To regenerate artifacts:
  /spec-workflow:spec "your feature description"
```
