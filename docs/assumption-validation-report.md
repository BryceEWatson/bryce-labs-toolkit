# Assumption Validation Report

This document records the critical assumptions about Claude Code session storage and JSONL format that were validated before implementing the session analysis skill suite.

## Validated Claims

### 1. Session transcript storage location

**Claim:** All session types (CLI, VS Code, Desktop Code tab, Cowork) write JSONL transcripts to `~/.claude/projects/<encoded-project-path>/`.

**Status:** CONFIRMED

Transcripts are stored as JSONL files in the projects directory, with two layout variants:
- Newer: `~/.claude/projects/<encoded-path>/sessions/<uuid>.jsonl`
- Older: `~/.claude/projects/<encoded-path>/<uuid>.jsonl`

On Windows, the base may be `%APPDATA%/Claude/` instead of `~/.claude/`.

### 2. Registry directories are NOT transcript sources

**Claim:** `local-agent-mode-sessions/` and `claude-code-sessions/` under `~/.claude/` contain session registry files, NOT JSONL transcripts.

**Status:** CONFIRMED

These directories contain `local_*.json` files used by the Desktop sidebar for session management. Scanning them for JSONL transcripts would return no useful results and could cause confusion.

**This was the single biggest mistake in our initial implementation attempt.** The parser explicitly excludes these directories.

### 3. JSONL record structure

**Claim:** Each JSONL line has a `type` field (`"user"`, `"assistant"`, `"system"`) and a `message` object with `role`, `content` (array of blocks), `usage`, and `model`.

**Status:** CONFIRMED

Additional record-level fields observed:
- `timestamp` — ISO 8601 string
- `sessionId` — UUID
- `cwd` — working directory
- `gitBranch` — current git branch
- `isSidechain` — boolean, true for subagent records
- `isApiErrorMessage` — boolean, true for failed API calls

### 4. Token usage field locations

**Claim:** Token usage is at `message.usage` with snake_case fields: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`.

**Status:** CONFIRMED

The fields are always snake_case. Token usage may also appear at the top-level `usage` field on some record types. The parser checks both locations.

### 5. Sidechain and error record filtering

**Claim:** Records with `isSidechain: true` are subagent records and should be excluded from main-chain cost calculations. Records with `isApiErrorMessage: true` are failed API calls and should also be excluded.

**Status:** CONFIRMED

Sidechain records represent speculative or parallel work by subagents. Including them in cost totals would double-count tokens. API error records represent failed requests that didn't produce useful output.

### 6. API pricing (March 2026)

**Claim:** Current pricing per 1M tokens:

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| Sonnet 4.6 | $3.00 | $15.00 | $3.75 | $0.30 |
| Opus 4.6 | $5.00 | $25.00 | $6.25 | $0.50 |
| Haiku 4.5 | $1.00 | $5.00 | $1.25 | $0.10 |

**Status:** VERIFIED as of March 2026

Cache write = 1.25x base input price. Cache read = 0.1x base input price. Verify at https://claude.com/pricing — pricing will change over time.

### 7. No audit.jsonl file

**Claim:** There is no `audit.jsonl` file in Claude Code's data directory.

**Status:** CONFIRMED

The closest equivalent is `stats-cache.json`, which contains aggregated usage statistics. However, this file is unreliable as a data source — it may be incomplete, stale, or missing. JSONL transcript parsing is the authoritative method for usage analysis.

## Implications for Implementation

1. The parser's `findSessionDirs()` function scans only `~/.claude/projects/` and explicitly skips `local-agent-mode-sessions/` and `claude-code-sessions/`.
2. The parser's `extractCosts()` function filters records where `isSidechain === true` or `isApiErrorMessage === true`.
3. Token fields are accessed at `message.usage` (primary) and `usage` (fallback), always using snake_case field names.
4. Pricing constants include comments noting they should be periodically re-verified.
