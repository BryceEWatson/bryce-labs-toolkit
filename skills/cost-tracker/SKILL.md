---
name: cost-tracker
description: Token usage and cost analysis across Claude Code sessions
argument-hint: "[--sessions <n>] [--project <name>] [--since <date>]"
---

# cost-tracker

Analyze token usage and estimated costs across Claude Code sessions.

## Usage

```
/cost-tracker
/cost-tracker --sessions 50
/cost-tracker --project myapp
/cost-tracker --since 7d
/cost-tracker --sessions 20 --project myapp
```

## Arguments

Access via `$ARGUMENTS`:
- `--sessions <n>` - Number of recent sessions to analyze (default: 20)
- `--project <name>` - Filter by project path substring
- `--since <date>` - Only include sessions modified after this date. Formats: ISO (2026-01-15) or relative (7d, 2w, 1m)

## Workflow

### Step 1: Discover and Parse Sessions

1. Run the parse-transcripts tool to collect cost data:
   ```bash
   node tools/parse-transcripts.js --recent 20 --mode costs --json
   ```
   If `$ARGUMENTS` specifies a project filter, add `--project <name>`.
   If `$ARGUMENTS` specifies a session count, use that instead of 20.

2. Parse the JSON output. Each session entry contains:
   - `costs.totals.inputTokens`, `outputTokens`, `cacheWriteTokens`, `cacheReadTokens`
   - `costs.totals.estimatedCostUSD`
   - `costs.efficiency.cacheHitRate`, `tokensPerTurn`
   - `costs.turns[]` with per-turn breakdowns

3. If `--since` is specified, filter sessions by their modification timestamp.

### Step 2: Aggregate Costs

Compute these aggregations across all sessions:

**Per-session breakdown:**
- Session ID, project, date, total tokens, estimated cost

**Grand totals:**
- Total input tokens, output tokens, cache write, cache read
- Total estimated cost (sum across sessions)
- Average cost per session

**Per-project breakdown (if multiple projects):**
- Group sessions by project path
- Sum tokens and cost per project

**Efficiency metrics:**
- Average cache hit rate across sessions
- Average tokens per turn
- Cost per file write (total cost / total write operations — requires running `--mode all`)

### Step 3: Format Report

Output a markdown report with these sections:

```markdown
## Cost Report

**Period:** [earliest session date] to [latest session date]
**Sessions analyzed:** N

### Summary

| Metric | Value |
|--------|-------|
| Total tokens | X |
| Total estimated cost | $X.XX |
| Average cost/session | $X.XX |
| Average cache hit rate | X% |

### Top 5 Most Expensive Sessions

| # | Session | Project | Tokens | Cost |
|---|---------|---------|--------|------|
| 1 | abc123  | myapp   | 50,000 | $0.45 |
...

### Cost by Project

| Project | Sessions | Tokens | Cost |
|---------|----------|--------|------|
| /path/to/myapp | 12 | 200,000 | $2.10 |
...

### Efficiency Insights

- Cache hit rate: X% (higher is better — reduces input costs)
- Tokens per turn: X (lower means more concise interactions)
- Recommendation: [based on metrics]
```

### Pricing Reference

<!-- Pricing as of March 2026 — verify at https://claude.com/pricing -->

| Model | Input/1M | Output/1M | Cache Write/1M | Cache Read/1M |
|-------|----------|-----------|----------------|---------------|
| Sonnet 4.6 | $3.00 | $15.00 | $3.75 | $0.30 |
| Opus 4.6 | $5.00 | $25.00 | $6.25 | $0.50 |
| Haiku 4.5 | $1.00 | $5.00 | $1.25 | $0.10 |

Cache write = 1.25x base input price. Cache read = 0.1x base input price.

## Important Notes

- **Pro/Max plan users are not billed per-token.** These are API-equivalent costs for comparison and optimization purposes only. They help identify inefficient sessions and track improvement over time.
- **Subagent costs are in separate JSONL records.** When `isSidechain: true`, those tokens are excluded from the parent session's totals. To see subagent costs, you would need to analyze them separately.
- **`stats-cache.json` is unreliable.** The authoritative source for token usage is the JSONL session transcript. The `stats-cache.json` file under `~/.claude/` is a secondary cache that may be incomplete or stale.
- **Pricing will go stale.** Always verify current pricing at https://claude.com/pricing before making cost-based decisions. The parser uses Sonnet 4.6 pricing as the default estimate.

## Session Storage

Session transcripts are JSONL files stored at:
- `~/.claude/projects/<encoded-project-path>/sessions/<uuid>.jsonl` (newer layout)
- `~/.claude/projects/<encoded-project-path>/<uuid>.jsonl` (older layout)
- On Windows: `%APPDATA%/Claude/` instead of `~/.claude/`

**Do NOT scan** `local-agent-mode-sessions/` or `claude-code-sessions/` — those contain registry files, not transcripts.
