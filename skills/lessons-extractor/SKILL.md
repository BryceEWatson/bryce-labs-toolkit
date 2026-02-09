---
name: lessons-extractor
description: Extracts lessons learned from Claude Code session logs into organized markdown and JSONL files
argument-hint: "[--since <date>] [--output <dir>] [--full] [--clear]"
---

# lessons-extractor

Extract reusable lessons from Claude Code session logs.

## Usage

```
/lessons-extractor
/lessons-extractor --since 7d
/lessons-extractor --output docs/ai/custom/
/lessons-extractor --full
/lessons-extractor --clear
/lessons-extractor --clear --since 7d
```

## Arguments

Access via `$ARGUMENTS`:
- `--since <date>` - Only process logs modified after this date. Formats: ISO (2026-01-15) or relative (7d, 2w, 1m, 24h).
- `--output <dir>` - Output directory (default: `docs/ai/lessons-extractor/`)
- `--full` - Process all logs, ignoring incremental cursor
- `--clear` - Clear existing outputs before generating fresh lessons
- `--reindex` - Force refresh index for all processed logs (v1.2.0)
- `--index-max <n>` - Maximum index entries (default: 500, v1.2.0)
- `--index-days <n>` - Prune entries older than N days (default: 30, v1.2.0)

## Configuration

If `config.json` exists in the skill directory, load settings from it. Otherwise use defaults.

Config file location: `.claude/skills/lessons-extractor/config.json` (relative to repo root after skill installation)

## Workflow

### Prohibited Actions

> **CRITICAL**: This skill MUST NOT create any files except the four expected outputs listed above.

**Hard rule — no extra files:**

1. **Do NOT write helper scripts** - Never create `.js`, `.cjs`, `.mjs`, `.ts`, `.sh`, or any other code files
2. **Do NOT create temporary files** - No `analyze-*.cjs`, no scratch files, no intermediate outputs
3. **Do NOT add any files to the repo** - If something isn't working, fall back to simpler analysis techniques

**Allowed file writes (using the Write tool):**

| File | Tool | Notes |
|------|------|-------|
| `lessons.md` | Write | Human-readable output |
| `lessons.jsonl` | Write | Machine-readable output |
| `preprocessed.json` | Preprocessor only | Created by `node lessons-preprocessor.cjs`, NOT by Write |
| `.lessons-cursor.json` | Preprocessor only | Created by preprocessor, NOT by Write |

**Strong guidance — avoid unreliable techniques:**

- **Avoid `node -e`** - Shell escaping is unreliable across platforms; prefer Read/Grep/summary instead
- **Avoid shell pipelines for JSON** - Use the preprocessor's built-in summary data

**What to do instead when analysis is difficult:**

- **Use the `summary` object** - It already contains processing stats (logs processed, events sampled, tool failures)
- **Read selectively** - Use `Read` with `offset`/`limit` to examine portions of large files
- **Search with Grep** - Use `Grep` to find specific patterns within `preprocessed.json`
- **Process fewer sessions** - Re-run with `--since 1d` for a smaller dataset
- **Ask the user** - If data is too large to analyze, ask if they want a smaller slice

If you encounter ANY friction that tempts you to write a script, STOP and use these alternatives.

### Reset / Clear

Clear all output artifacts to start from scratch:

- **Skill flag:** `/lessons-extractor --clear` (clears then regenerates)
- **Standalone script (Bash):** `./tools/lessons-extractor-reset.sh [--dry-run] [--force] [--output <dir>]`
- **Standalone script (CMD):** `tools\lessons-extractor-reset.cmd [--dry-run] [--force] [--output <dir>]`

The scripts support `--dry-run` (preview only) and `--force` (skip confirmation).
They use the preprocessor's `--clear` internally for consistency.

### Step 0: Handle --clear (if requested)

If `$ARGUMENTS` contains `--clear`:

1. **Parse output directory** from `$ARGUMENTS`:
   - If `--output <dir>` is present, use that directory
   - Otherwise use default: `docs/ai/lessons-extractor/`

2. **Run clear command** (removes existing outputs):
   ```bash
   node .claude/skills/lessons-extractor/bin/lessons-preprocessor.cjs --clear --output-dir <dir>
   ```

3. **Continue to Step 1** with remaining arguments (excluding `--clear`):
   - This ensures fresh lessons are generated after clearing
   - Example: `/lessons-extractor --clear --since 7d` → clear, then preprocess with `--since 7d`

**Important:** Do NOT pass `--clear` to Step 1. The clear happens here, then Step 1 runs preprocessing normally.

**Dry-run preview:**
```bash
node .claude/skills/lessons-extractor/bin/lessons-preprocessor.cjs --clear --output-dir docs/ai/lessons-extractor --dry-run
```

### Step 1: Run Preprocessor

The preprocessor handles cross-platform log discovery, filtering, and truncation. It eliminates shell escaping issues and reduces token usage.

**Build the command from parsed arguments** (do NOT include `--clear`):

```bash
node .claude/skills/lessons-extractor/bin/lessons-preprocessor.cjs [--since <date>] [--output-dir <dir>] [--full]
```

**Map skill arguments to preprocessor flags:**
- Skill `--since <date>` → Preprocessor `--since <date>`
- Skill `--output <dir>` → Preprocessor `--output-dir <dir>`
- Skill `--full` → Preprocessor `--full`
- Skill `--clear` → Already handled in Step 0, do NOT pass here

**From repo root (most common):**
```bash
node .claude/skills/lessons-extractor/bin/lessons-preprocessor.cjs --since 7d
```

**From skill directory:**
```bash
cd .claude/skills/lessons-extractor && node bin/lessons-preprocessor.cjs --since 7d
```

**With custom output directory:**
```bash
node .claude/skills/lessons-extractor/bin/lessons-preprocessor.cjs --since 7d --output-dir docs/ai/lessons-extractor
```

**Process all logs (ignore cursor):**
```bash
node .claude/skills/lessons-extractor/bin/lessons-preprocessor.cjs --full --verbose
```

The preprocessor will:
- Discover logs in `~/.claude/projects/` (cross-platform, no shell)
- Filter out subagent logs and `agent-*.jsonl` files
- Skip sessions that are running this extractor (avoids noise)
- Apply sampling strategy (first N + last M + error windows)
- Truncate large content fields
- Apply redaction patterns
- Extract tool failures as first-class data
- Output a compact JSON file for analysis

**Preprocessor output location:** `docs/ai/lessons-extractor/preprocessed.json` (default)

**If preprocessor fails:**
1. Check that Node.js is installed (`node --version`)
2. Verify the skill is installed (`ls .claude/skills/lessons-extractor/bin/`)
3. Run with `--verbose` to see detailed output
4. Fall back to manual log excerpts if needed

### Step 2: Read Preprocessed Data

Read the preprocessor output file:

```
Read: docs/ai/lessons-extractor/preprocessed.json
```

**Start with the `summary` object** at the top of the file:
- `summary.logsProcessed` - How many session logs were analyzed
- `summary.totalEvents` - Total events across all sessions (before sampling)
- `summary.sampledEvents` - Events included after sampling
- `summary.toolFailures` - Count of tool failures extracted
- `summary.skipped.extractorSessions` - How many extractor-own sessions were filtered

This summary provides the statistics needed for the "Run Efficiency Findings" section without parsing every session.

**The full structure contains:**
- `summary` - Processing statistics (read this FIRST)
- `sessions[]` - Array of processed sessions with:
  - `sessionId` - Unique session identifier
  - `logPath` - Log file path (home directory replaced with `~` to avoid exposing usernames)
  - `events[]` - Sampled and truncated events
  - `toolFailures[]` - Detected tool failures with error details
  - `evidence[]` - Short excerpts with timestamps for lesson attribution

**If the file is too large to read at once:**
1. Use `Read` with `limit: 200` to see the structure and summary
2. Use `Grep` to search for specific patterns (e.g., `"toolFailures"`, error keywords)
3. Request a smaller slice: ask the user to re-run with `--since 1d` or `--since 12h`

**NEVER write helper scripts to analyze this data** - see "Prohibited Actions" above.

### Understanding Run Scope (v1.4.0)

The preprocessor outputs `summary.runScope` to guide lesson regeneration behavior:

| Scope | Meaning | Required Action |
|-------|---------|-----------------|
| `full` | Complete reprocessing (--full, --reindex, or --clear) | Regenerate all lessons |
| `substantial` | >= 5 new sessions processed | Update lessons with new findings |
| `incremental` | < 5 new sessions | **Skip lesson regeneration entirely** |

**Enforcement**: Before Step 4 (Extract Lessons), check `summary.runScope`:
- If `incremental`:
  - Do NOT write lessons.md
  - Do NOT write lessons.jsonl
  - Output: "Skipped lesson regeneration (incremental run with N new sessions)"
  - Exit skill execution
- If `substantial` or `full`: Proceed with lesson extraction and regeneration.

This prevents churn from tiny incremental runs degrading lesson quality.

### Step 3: Summarize Sessions

For each session in the preprocessed data, apply the summarize_run prompt:
- Identify: what task was attempted, what worked, what didn't
- Extract: key decisions, tool usage patterns, error recovery
- Note: any surprising behaviors or gotchas

**Important:** When tool failures are present, prioritize documenting:
- The symptom (what failed and how)
- The context (what was being attempted)
- The resolution (how it was fixed, or if it wasn't)

### Step 4: Extract Lessons

**First, check run scope:**
1. Read `summary.runScope` from preprocessed.json
2. If `incremental`: Skip to end. Log: "Incremental run - lesson regeneration skipped (N new sessions < threshold)"
3. If `substantial` or `full`: Continue with extraction below

Apply the extract_lessons prompt to summarized sessions:
- Identify reusable patterns and anti-patterns
- Categorize: workflow, debugging, architecture, tool-specific, windows-compatibility
- Rate confidence/applicability (0.0-1.0)
- Include concrete examples where helpful

**Tool failures are first-class lesson candidates:**
- Pattern-match failures across sessions
- Extract debugging approaches that worked
- Note platform-specific gotchas (especially Windows/Git Bash issues)

### Step 5: Merge and Deduplicate

Apply the merge_dedupe prompt to consolidate lessons:
- Merge similar lessons into single entries
- Remove exact duplicates
- Organize by category
- Add cross-references between related lessons

### Step 6: Write Outputs

Write to output directory (default `docs/ai/lessons-extractor/`):

**docs/ai/lessons-extractor/lessons.md** - Human-readable:
```markdown
# Lessons Learned

Last updated: 2026-01-22

## Run Efficiency Findings

- Logs processed: 12
- Events sampled: 156 (from 847 total)
- Tool failures analyzed: 8
- Extractor sessions skipped: 2

## Workflow
- Lesson 1...
- Lesson 2...

## Debugging
...

## Windows Compatibility
...
```

**docs/ai/lessons-extractor/lessons.jsonl** - Machine-readable:
```jsonl
{"id":"lesson-001","category":"workflow","title":"...","description":"...","confidence":0.9,"evidence":{"sessionId":"abc","timestamp":"2026-01-20T10:15:32Z"}}
{"id":"lesson-002","category":"debugging","title":"...","description":"...","confidence":0.8,"evidence":{"sessionId":"def","timestamp":"2026-01-20T11:30:00Z"}}
```

**Required: Sources Used footer in lessons.md:**

Every output MUST include this footer at the end:

```markdown
---
## Sources Used
- Preprocessor: ✓ (v1.0.0)
- Session logs: ✓ (12 files from ~/.claude/projects/)
- Tool failures: 8 extracted
```

If preprocessor was not used (fallback):

```markdown
---
## Sources Used
- Preprocessor: ✗ (not available)
- Session logs: ✓ (manual discovery)
- Git history: ✓ (supplemental)

⚠️ Lessons quality may be reduced without preprocessor. Consider installing Node.js.
```

## Important Notes

- **Never commit raw logs** - they may contain sensitive data
- **Review outputs before committing** - redaction is best-effort
- Logs are read from `~/.claude/projects/` by default (Claude Code's storage location)
- Log directories use encoded names (e.g., `c--Users-YourName-Projects-myrepo`)
- Use `--since` to limit volume when processing many sessions
- The preprocessor automatically skips its own sessions to avoid noise

## Cursor Index (v1.2.0)

The preprocessor maintains a persistent index of processed log files in `.lessons-cursor.json`. This enables faster incremental runs by caching derived metadata.

### How It Works

On first run, the preprocessor:
1. Processes all discovered logs fully
2. Stores derived metadata (taskPreview, toolNames, kindsCount, etc.) in the cursor index
3. On subsequent runs, reuses cached metadata for unchanged files

**Index hits** emit lightweight "cached" sessions without re-reading the file.
**Index misses** (new/changed files) trigger full processing.

### Output Session Modes

Sessions in `preprocessed.json` have a `mode` field:
- `mode: "full"` - Fully processed session with events, evidence, and tool failures
- `mode: "cached"` - Lightweight session from index (no events array, faster)
- `mode: "fast"` - Fast-path scanned session (quick scan only)

Cached sessions have `fromIndex: true` and `events: null`. Use `--full` to force full processing for all sessions.

### Index Configuration

In `config.json` under `preprocessor.indexing`:

```json
{
  "indexing": {
    "maxEntries": 500,        // Maximum entries in index
    "maxAgeDays": 30,         // Prune entries older than N days (0=disabled)
    "pruneStrategy": "hybrid", // "lru", "age", or "hybrid"
    "preserveUserFields": true // Preserve tags/notes when updating
  }
}
```

### CLI Options

| Flag | Description |
|------|-------------|
| `--reindex` | Force refresh index for all files (preserves user tags/notes) |
| `--index-max <n>` | Override max index entries (default: 500, min: 50) |
| `--index-days <n>` | Override max age days (default: 30, 0=disabled) |

### User Annotations

The index supports user-added metadata per log file:
- `tags`: Array of strings for categorization
- `notes`: Free-form string for session-specific notes

Edit `.lessons-cursor.json` directly to add annotations. They are preserved across index updates.

### Pruning Strategies

- **lru**: Keep most recently accessed entries up to `maxEntries`
- **age**: Remove entries older than `maxAgeDays`, no entry count limit
- **hybrid** (default): Apply age pruning first, then LRU to reach `maxEntries`

Entries with user annotations (tags/notes) are never automatically pruned.

## Tool Result Detection (v1.3.0)

The preprocessor detects tool results from multiple formats to ensure accurate `toolResultsDetected` and `toolFailuresDetected` statistics.

### Supported Formats

1. **Direct `type: "tool_result"` events** - Top-level events with explicit type
2. **Events with `exit_code`/`exitCode` field** - Any event containing an exit code
3. **`persisted-output` events** - Events with nested `tool_results` array
4. **Content blocks** (v1.3.0) - `message.content` arrays containing `{ type: "tool_result", ... }` blocks

### Content Block Format (Claude API)

Claude API returns tool results as content blocks within user messages:

```json
{
  "type": "user",
  "message": {
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01...",
        "content": "command output here",
        "exit_code": 0
      }
    ]
  }
}
```

These are now correctly detected and counted as `kind: "tool_result"` events.

### Hash Suffixing

Content block tool results are "exploded" into separate normalized events for accurate counting. Each exploded event receives a unique hash suffix for deterministic deduplication:

- Tool calls: `{lineHash}-tc{index}` (tool_use blocks)
- Tool results: `{lineHash}-tr{index}` (tool_result blocks)

### Failure Detection

Tool failures are detected when:
- `exit_code` (or `exitCode`) is non-zero
- `is_error: true` is present (converted to `exitCode: 1`)
- Error patterns are detected in output text (fallback)

## Troubleshooting

### Preprocessor not found

If the preprocessor script is not found:

1. Verify the skill is installed:
   ```bash
   ls .claude/skills/lessons-extractor/bin/
   ```

2. Check Node.js is available:
   ```bash
   node --version
   ```

3. Run the preprocessor directly:
   ```bash
   node .claude/skills/lessons-extractor/bin/lessons-preprocessor.cjs --help
   ```

### No logs found

If the preprocessor reports no logs:

1. Check the log directory exists:
   ```bash
   ls ~/.claude/projects/
   ```

2. Try without date filter:
   ```bash
   node .claude/skills/lessons-extractor/bin/lessons-preprocessor.cjs --full --verbose
   ```

3. The preprocessor will show detailed discovery output with `--verbose`

### Windows-specific issues

The preprocessor eliminates most Windows/Git Bash issues by using Node.js instead of shell commands. If you still encounter problems:

1. Ensure you're using forward slashes or let Node.js handle path resolution
2. The `~` expansion works cross-platform in the preprocessor
3. Run `--self-test` to verify the preprocessor works on your system:
   ```bash
   node .claude/skills/lessons-extractor/bin/lessons-preprocessor.cjs --self-test
   ```

### Permission errors

If logs are outside the repo and Claude Code cannot read them:

1. Run the preprocessor manually in a terminal with appropriate permissions
2. Copy the `preprocessed.json` output into the repo
3. Continue from Step 2 (Read Preprocessed Data)

## Acceptance Criteria

A successful lessons-extractor run produces EXACTLY these files:

| File | Required | Created By |
|------|----------|------------|
| `preprocessed.json` | Yes | Preprocessor (Bash) |
| `.lessons-cursor.json` | Yes | Preprocessor (Bash) |
| `lessons.md` | Yes | Write tool |
| `lessons.jsonl` | Yes | Write tool |

**Verification before commit:**

Unix/Git Bash:
```bash
# List files in output directory - should see only the 4 expected files
ls docs/ai/lessons-extractor/

# Detect helper scripts (should print nothing)
ls docs/ai/lessons-extractor/*.cjs docs/ai/lessons-extractor/*.js docs/ai/lessons-extractor/*.mjs docs/ai/lessons-extractor/*.ts docs/ai/lessons-extractor/*.sh 2>/dev/null && echo "ERROR: Helper scripts found!" || echo "OK: No helper scripts"
```

PowerShell:
```powershell
# List files in output directory
Get-ChildItem docs\ai\lessons-extractor | Select-Object Name

# Detect helper scripts (should return nothing)
Get-ChildItem docs\ai\lessons-extractor\*.cjs,docs\ai\lessons-extractor\*.js,docs\ai\lessons-extractor\*.mjs,docs\ai\lessons-extractor\*.ts,docs\ai\lessons-extractor\*.sh -ErrorAction SilentlyContinue
```

If ANY other files (especially `.cjs`, `.js`, `.sh`, or `analyze-*` files) appear in the output directory, the run has violated the skill constraints and those files must be deleted.
