---
name: lessons-extractor
description: Extracts lessons learned from Claude Code session logs into organized markdown and JSONL files
argument-hint: "[--since <date>] [--output <dir>] [--full]"
---

# lessons-extractor

Extract reusable lessons from Claude Code session logs.

## Usage

```
/lessons-extractor
/lessons-extractor --since 7d
/lessons-extractor --output docs/ai/custom/
/lessons-extractor --full
```

## Arguments

Access via `$ARGUMENTS`:
- `--since <date>` - Only process logs modified after this date. Formats: ISO (2026-01-15) or relative (7d, 2w, 1m, 24h).
- `--output <dir>` - Output directory (default: `docs/ai/lessons-extractor/`)
- `--full` - Process all logs, ignoring incremental cursor

## Configuration

If `config.json` exists in the skill directory, load settings from it. Otherwise use defaults.

Config file location: `.claude/skills/lessons-extractor/config.json` (relative to repo root after skill installation)

## Workflow

### Step 1: Run Preprocessor

The preprocessor handles cross-platform log discovery, filtering, and truncation. It eliminates shell escaping issues and reduces token usage.

**Run the preprocessor using the Bash tool:**

**From repo root (most common):**
```bash
node .claude/skills/lessons-extractor/bin/lessons-preprocessor.js --since 7d
```

**From skill directory:**
```bash
cd .claude/skills/lessons-extractor && node bin/lessons-preprocessor.js --since 7d
```

**With custom output:**
```bash
node .claude/skills/lessons-extractor/bin/lessons-preprocessor.js --since 7d --output docs/ai/lessons-extractor/preprocessed.json
```

**Process all logs (ignore cursor):**
```bash
node .claude/skills/lessons-extractor/bin/lessons-preprocessor.js --full --verbose
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

The output contains:
- `summary` - Processing statistics (logs processed, events sampled, tool failures found)
- `sessions[]` - Array of processed sessions with:
  - `sessionId` - Unique session identifier
  - `logPath` - Original log file path
  - `events[]` - Sampled and truncated events
  - `toolFailures[]` - Detected tool failures with error details
  - `evidence[]` - Short excerpts with timestamps for lesson attribution

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
   node .claude/skills/lessons-extractor/bin/lessons-preprocessor.js --help
   ```

### No logs found

If the preprocessor reports no logs:

1. Check the log directory exists:
   ```bash
   ls ~/.claude/projects/
   ```

2. Try without date filter:
   ```bash
   node .claude/skills/lessons-extractor/bin/lessons-preprocessor.js --full --verbose
   ```

3. The preprocessor will show detailed discovery output with `--verbose`

### Windows-specific issues

The preprocessor eliminates most Windows/Git Bash issues by using Node.js instead of shell commands. If you still encounter problems:

1. Ensure you're using forward slashes or let Node.js handle path resolution
2. The `~` expansion works cross-platform in the preprocessor
3. Run `--self-test` to verify the preprocessor works on your system:
   ```bash
   node .claude/skills/lessons-extractor/bin/lessons-preprocessor.js --self-test
   ```

### Permission errors

If logs are outside the repo and Claude Code cannot read them:

1. Run the preprocessor manually in a terminal with appropriate permissions
2. Copy the `preprocessed.json` output into the repo
3. Continue from Step 2 (Read Preprocessed Data)
