---
name: lessons-extractor
description: Extracts lessons learned from Claude Code session logs into organized markdown and JSONL files
argument-hint: "[--since <date>] [--output <dir>] [--log-glob <glob>]"
---

# lessons-extractor

Extract reusable lessons from Claude Code session logs.

## Usage

```
/lessons-extractor
/lessons-extractor --since 2026-01-01
/lessons-extractor --output docs/ai/custom/
/lessons-extractor --log-glob "~/.claude/projects/specific-hash/**/*.jsonl"
```

## Arguments

Access via `$ARGUMENTS`:
- `--since <date>` - Only process logs modified after this date (ISO format). Recommended to limit volume.
- `--output <dir>` - Output directory (default: `docs/ai/lessons-extractor/`)
- `--log-glob <glob>` - Custom glob pattern for logs (default: `~/.claude/projects/**/*.jsonl`)

## Configuration

If `config.json` exists in the skill directory, load settings from it. Otherwise use defaults.

Config file location: `.claude/skills/lessons-extractor/config.json` or `~/.claude/skills/lessons-extractor/config.json`

## Workflow

### Step 1: Locate Logs

Claude Code stores session logs at `~/.claude/projects/**/*.jsonl` (user home directory). Project directories are **encoded hashes**, not human-readable project names.

**If shell execution is permitted**, use command injection to find logs:

**macOS/Linux:**
```
!find ~/.claude/projects -name '*.jsonl' -type f | head -50
```

With date filter (last 7 days):
```
!find ~/.claude/projects -name '*.jsonl' -mtime -7 -type f
```

**Windows (PowerShell):**
```
!powershell -Command "Get-ChildItem -Path $env:USERPROFILE\.claude\projects -Filter *.jsonl -Recurse | Select-Object -First 50 | ForEach-Object { $_.FullName }"
```

**If shell execution is NOT permitted** (or user prefers manual):
- User provides `--log-glob` with specific path
- User pastes selected log excerpts directly into conversation

**Note:** To enable shell commands, users may need to allow them in Claude Code settings. See Claude Code docs on permissions.

### Step 2: Read and Redact

For each log file, read contents and apply redaction patterns before processing:
- Remove API keys, tokens, passwords, secrets
- Remove absolute paths containing usernames
- Remove any patterns matching config redact rules

Use these default redaction patterns:
- `(?i)api[_-]?key` followed by values
- `(?i)password` followed by values
- `(?i)secret` followed by values
- `(?i)token` followed by values
- `/Users/<username>/` paths
- `/home/<username>/` paths
- `C:\Users\<username>\` paths

### Step 3: Summarize Sessions

For each session log, apply the summarize_run prompt:
- Identify: what task was attempted, what worked, what didn't
- Extract: key decisions, tool usage patterns, error recovery
- Note: any surprising behaviors or gotchas

### Step 4: Extract Lessons

Apply the extract_lessons prompt to summarized sessions:
- Identify reusable patterns and anti-patterns
- Categorize: workflow, debugging, architecture, tool-specific
- Rate confidence/applicability (0.0-1.0)
- Include concrete examples where helpful

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

## Workflow
- Lesson 1...
- Lesson 2...

## Debugging
...
```

**docs/ai/lessons-extractor/lessons.jsonl** - Machine-readable:
```jsonl
{"id":"lesson-001","category":"workflow","title":"...","description":"...","confidence":0.9}
{"id":"lesson-002","category":"debugging","title":"...","description":"...","confidence":0.8}
```

## Important Notes

- **Never commit raw logs** - they may contain sensitive data
- **Review outputs before committing** - redaction is best-effort; `docs/ai/lessons-extractor/*` may still contain sensitive strings
- Logs are read from `~/.claude/projects/` by default (Claude Code's storage location)
- Log directories use encoded hashes, not project names
- Use `--since` to limit volume when processing many sessions
