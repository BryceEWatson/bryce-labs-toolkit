#!/usr/bin/env bash
# spec-workflow-reset.sh
# Safely removes spec-workflow artifacts (specs, plans, reviews).
#
# Usage:
#   ./tools/spec-workflow-reset.sh [--dry-run] [--force] [--feature <kebab-name>]
#
# Options:
#   --dry-run            Show what would be deleted without deleting anything
#   --force              Skip confirmation prompt
#   --feature <name>     Only delete artifacts for a specific feature (kebab-case)
#
# Safety:
#   - Never deletes .gitkeep files
#   - Only touches docs/specs/SPEC-*.md, docs/plans/PLAN-*.md, docs/reviews/REVIEW-*.md
#   - Prints a summary of what was removed and what remains

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPECS_DIR="$REPO_ROOT/docs/specs"
PLANS_DIR="$REPO_ROOT/docs/plans"
REVIEWS_DIR="$REPO_ROOT/docs/reviews"

DRY_RUN=false
FORCE=false
FEATURE=""

# Parse arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  DRY_RUN=true; shift ;;
    --force)    FORCE=true; shift ;;
    --feature)
      if [ -z "${2:-}" ]; then
        echo "ERROR: --feature requires a value"
        exit 1
      fi
      FEATURE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--force] [--feature <kebab-name>]"
      echo ""
      echo "Options:"
      echo "  --dry-run            Show what would be deleted"
      echo "  --force              Skip confirmation prompt"
      echo "  --feature <name>     Only delete artifacts for a specific feature"
      exit 0 ;;
    *)
      echo "ERROR: Unknown option: $1"
      exit 1 ;;
  esac
done

# Collect files to delete
FILES_TO_DELETE=()

if [ -n "$FEATURE" ]; then
  # Feature-scoped deletion
  [ -f "$SPECS_DIR/SPEC-${FEATURE}.md" ]            && FILES_TO_DELETE+=("$SPECS_DIR/SPEC-${FEATURE}.md")
  [ -f "$PLANS_DIR/PLAN-${FEATURE}.md" ]             && FILES_TO_DELETE+=("$PLANS_DIR/PLAN-${FEATURE}.md")
  [ -f "$REVIEWS_DIR/REVIEW-SPEC-${FEATURE}.md" ]    && FILES_TO_DELETE+=("$REVIEWS_DIR/REVIEW-SPEC-${FEATURE}.md")
  [ -f "$REVIEWS_DIR/REVIEW-PLAN-${FEATURE}.md" ]    && FILES_TO_DELETE+=("$REVIEWS_DIR/REVIEW-PLAN-${FEATURE}.md")
  [ -f "$REVIEWS_DIR/REVIEW-PR-${FEATURE}.md" ]      && FILES_TO_DELETE+=("$REVIEWS_DIR/REVIEW-PR-${FEATURE}.md")
else
  # Full reset — all spec-workflow artifacts
  for f in "$SPECS_DIR"/SPEC-*.md; do
    [ -f "$f" ] && FILES_TO_DELETE+=("$f")
  done
  for f in "$PLANS_DIR"/PLAN-*.md; do
    [ -f "$f" ] && FILES_TO_DELETE+=("$f")
  done
  for f in "$REVIEWS_DIR"/REVIEW-*.md; do
    [ -f "$f" ] && FILES_TO_DELETE+=("$f")
  done
fi

# Report
if [ ${#FILES_TO_DELETE[@]} -eq 0 ]; then
  echo "spec-workflow-reset: No artifacts found to delete."
  exit 0
fi

echo "spec-workflow-reset"
if [ -n "$FEATURE" ]; then
  echo "  Feature: $FEATURE"
fi
echo "  Files to delete (${#FILES_TO_DELETE[@]}):"
for f in "${FILES_TO_DELETE[@]}"; do
  echo "    - ${f#$REPO_ROOT/}"
done
echo ""

# Dry-run exits here
if [ "$DRY_RUN" = true ]; then
  echo "[dry-run] No files were deleted."
  exit 0
fi

# Confirm unless --force
if [ "$FORCE" != true ]; then
  printf "Delete these %d file(s)? [y/N] " "${#FILES_TO_DELETE[@]}"
  read -r REPLY
  if [ "$REPLY" != "y" ] && [ "$REPLY" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
fi

# Delete
DELETED=0
for f in "${FILES_TO_DELETE[@]}"; do
  rm -f "$f"
  DELETED=$((DELETED + 1))
done

echo "Deleted $DELETED file(s)."

# Summary of what remains
echo ""
echo "Remaining files:"
REMAINING=0
for dir in "$SPECS_DIR" "$PLANS_DIR" "$REVIEWS_DIR"; do
  for f in "$dir"/*; do
    if [ -f "$f" ] && [ "$(basename "$f")" != ".gitkeep" ]; then
      echo "  - ${f#$REPO_ROOT/}"
      REMAINING=$((REMAINING + 1))
    fi
  done
done
if [ $REMAINING -eq 0 ]; then
  echo "  (none — directories contain only .gitkeep)"
fi
