#!/usr/bin/env bash
# spec-workflow-dev-sync.sh
# Copies local plugin source into the Claude Code plugin cache.
#
# Usage: ./tools/spec-workflow-dev-sync.sh
#
# IMPORTANT: On Windows, run from Git Bash (not WSL). WSL's ~ points to the
# WSL home, but Claude Code's cache is in the Windows user profile.
#
# Why: Claude Code runs plugins from ~/.claude/plugins/cache/, not from your
# working directory. Marketplace-installed plugins rebuild their cache from the
# recorded gitCommitSha, so local edits have no effect unless you copy into
# the cache manually. This script does that for fast local dev iteration.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$REPO_ROOT/plugins/spec-workflow"
PLUGIN_JSON="$SOURCE/.claude-plugin/plugin.json"

if [ ! -d "$SOURCE" ]; then
  echo "ERROR: Source not found: $SOURCE"
  exit 1
fi

# Derive local version from plugin.json
if [ ! -f "$PLUGIN_JSON" ]; then
  echo "ERROR: plugin.json not found: $PLUGIN_JSON"
  exit 1
fi
LOCAL_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_JSON" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
if [ -z "$LOCAL_VERSION" ]; then
  echo "ERROR: Could not parse version from $PLUGIN_JSON"
  exit 1
fi

# Use USERPROFILE on Windows (Git Bash), HOME otherwise
CLAUDE_HOME="${USERPROFILE:-$HOME}"
CACHE_PARENT="$CLAUDE_HOME/.claude/plugins/cache/bryce-labs/spec-workflow"

# Detect installed version with deterministic selection policy:
# 1. If CACHE_PARENT/LOCAL_VERSION exists → use it (exact match)
# 2. Else if exactly one version dir exists → use it
# 3. Else if multiple dirs exist → pick newest mtime, print loud warning
# 4. Else (no cache dir) → fall back to LOCAL_VERSION (fresh install)
VERSION=""
if [ -d "$CACHE_PARENT" ]; then
  CANDIDATES=$(ls -1 "$CACHE_PARENT" 2>/dev/null | grep -v '__tmp' | grep -v '__bak' || true)
  COUNT=$(echo "$CANDIDATES" | grep -c '.' || true)

  if [ -d "$CACHE_PARENT/$LOCAL_VERSION" ]; then
    VERSION="$LOCAL_VERSION"
  elif [ "$COUNT" -eq 1 ] && [ -n "$CANDIDATES" ]; then
    VERSION="$CANDIDATES"
  elif [ "$COUNT" -gt 1 ]; then
    VERSION=$(ls -1t "$CACHE_PARENT" | grep -v '__tmp' | grep -v '__bak' | head -1)
    echo "WARNING: Multiple cache versions found:"
    echo "$CANDIDATES" | sed 's/^/  - /'
    echo "  Selected: $VERSION (most recently modified)"
    echo "  To fix: delete stale version dirs from $CACHE_PARENT"
    echo ""
  fi
fi
VERSION="${VERSION:-$LOCAL_VERSION}"

if [ -z "$VERSION" ]; then
  echo "ERROR: Could not determine plugin version"
  exit 1
fi

CACHE_DIR="$CACHE_PARENT/$VERSION"
CACHE_TMP="${CACHE_DIR}.__tmp"

# Warn if local and installed versions differ
if [ "$VERSION" != "$LOCAL_VERSION" ]; then
  echo "NOTE: Local plugin.json says v${LOCAL_VERSION}, but installed cache is v${VERSION}"
  echo "      Syncing into installed version (${VERSION}) so Claude Code picks it up."
  echo ""
fi

echo "spec-workflow-dev-sync"
echo "  Source:  $SOURCE"
echo "  Cache:   $CACHE_DIR"
echo "  Version: $VERSION"
echo ""

# Atomic-ish copy: write to temp dir, verify, then swap
rm -rf "$CACHE_TMP"
mkdir -p "$(dirname "$CACHE_DIR")"
cp -r "$SOURCE" "$CACHE_TMP"

# Verify .claude-plugin/ was copied
if [ ! -f "$CACHE_TMP/.claude-plugin/plugin.json" ]; then
  echo "ERROR: .claude-plugin/plugin.json missing from copy"
  rm -rf "$CACHE_TMP"
  exit 1
fi

# Verify sentinel in spec.md (hard error — sync is invalid without it)
if ! grep -q "ORCH_SENTINEL" "$CACHE_TMP/commands/spec.md" 2>/dev/null; then
  echo "ERROR: ORCH_SENTINEL not found in spec.md — sync aborted"
  rm -rf "$CACHE_TMP"
  exit 1
fi

# All verified — now replace the live cache
# Rename old to backup, swap new in, then delete backup
CACHE_BAK="${CACHE_DIR}.__bak"
rm -rf "$CACHE_BAK"
if [ -d "$CACHE_DIR" ]; then
  mv "$CACHE_DIR" "$CACHE_BAK"
fi
mv "$CACHE_TMP" "$CACHE_DIR"
rm -rf "$CACHE_BAK"

echo "Verifying sentinel in cached spec.md:"
grep "ORCH_SENTINEL" "$CACHE_DIR/commands/spec.md"
echo ""
echo "════════════════════════════════════════"
echo "  spec-workflow v${VERSION} synced to cache"
echo "  Open a NEW chat window to pick up changes"
echo "════════════════════════════════════════"
