#!/usr/bin/env bash
# lessons-extractor-reset.sh
# Safely clears lessons-extractor output artifacts.
#
# Usage:
#   ./tools/lessons-extractor-reset.sh [--dry-run] [--force] [--output <dir>]
#
# Options:
#   --dry-run            Show what would be deleted without deleting anything
#   --force              Skip confirmation prompt
#   --output <dir>       Output directory (default: docs/ai/lessons-extractor)
#
# Safety:
#   - Never deletes .gitkeep files
#   - Only touches files inside the output directory
#   - Prefers the preprocessor's --clear for consistency

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="docs/ai/lessons-extractor"

DRY_RUN=false
FORCE=false

# Parse arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  DRY_RUN=true; shift ;;
    --force)    FORCE=true; shift ;;
    --output)
      if [ -z "${2:-}" ]; then
        echo "ERROR: --output requires a value"
        exit 1
      fi
      OUTPUT_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--force] [--output <dir>]"
      echo ""
      echo "Options:"
      echo "  --dry-run            Show what would be deleted"
      echo "  --force              Skip confirmation prompt"
      echo "  --output <dir>       Output directory (default: docs/ai/lessons-extractor)"
      exit 0 ;;
    *)
      echo "ERROR: Unknown option: $1"
      exit 1 ;;
  esac
done

# Resolve output dir relative to repo root
if [[ "$OUTPUT_DIR" != /* ]]; then
  OUTPUT_DIR="$REPO_ROOT/$OUTPUT_DIR"
fi

if [ ! -d "$OUTPUT_DIR" ]; then
  echo "lessons-extractor-reset: Output directory not found: $OUTPUT_DIR"
  echo "  Nothing to clear."
  exit 0
fi

# Try preprocessor first (preferred — consistent with skill's --clear behavior)
PREPROCESSOR="$REPO_ROOT/skills/lessons-extractor/bin/lessons-preprocessor.cjs"
USE_NODE=false

if command -v node >/dev/null 2>&1 && [ -f "$PREPROCESSOR" ]; then
  USE_NODE=true
fi

if [ "$USE_NODE" = true ]; then
  echo "lessons-extractor-reset (via preprocessor)"
  echo "  Output dir: $OUTPUT_DIR"
  echo ""

  if [ "$DRY_RUN" = true ]; then
    node "$PREPROCESSOR" --clear --output-dir "$OUTPUT_DIR" --dry-run
    exit 0
  fi

  if [ "$FORCE" != true ]; then
    # Show dry-run first for confirmation
    node "$PREPROCESSOR" --clear --output-dir "$OUTPUT_DIR" --dry-run
    echo ""
    printf "Proceed with deletion? [y/N] "
    read -r REPLY
    if [ "$REPLY" != "y" ] && [ "$REPLY" != "Y" ]; then
      echo "Aborted."
      exit 0
    fi
  fi

  node "$PREPROCESSOR" --clear --output-dir "$OUTPUT_DIR"
  echo "Done."
else
  # Fallback: direct file deletion
  echo "WARNING: node not found or preprocessor missing — using direct file deletion"
  echo "lessons-extractor-reset (direct)"
  echo "  Output dir: $OUTPUT_DIR"
  echo ""

  # Collect files (known output set, excluding .gitkeep)
  FILES_TO_DELETE=()
  for f in "$OUTPUT_DIR"/*; do
    if [ -f "$f" ] && [ "$(basename "$f")" != ".gitkeep" ]; then
      FILES_TO_DELETE+=("$f")
    fi
  done

  if [ ${#FILES_TO_DELETE[@]} -eq 0 ]; then
    echo "No files to delete."
    exit 0
  fi

  echo "Files to delete (${#FILES_TO_DELETE[@]}):"
  for f in "${FILES_TO_DELETE[@]}"; do
    echo "  - $(basename "$f")"
  done
  echo ""

  if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] No files were deleted."
    exit 0
  fi

  if [ "$FORCE" != true ]; then
    printf "Delete these %d file(s)? [y/N] " "${#FILES_TO_DELETE[@]}"
    read -r REPLY
    if [ "$REPLY" != "y" ] && [ "$REPLY" != "Y" ]; then
      echo "Aborted."
      exit 0
    fi
  fi

  DELETED=0
  for f in "${FILES_TO_DELETE[@]}"; do
    rm -f "$f"
    DELETED=$((DELETED + 1))
  done
  echo "Deleted $DELETED file(s)."
fi
