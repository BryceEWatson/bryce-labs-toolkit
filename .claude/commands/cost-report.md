Use the **cost-tracker** skill to analyze token usage and costs across recent Claude Code sessions.

Default: analyze the last 20 sessions. If the user provided arguments in `$ARGUMENTS`, pass them through:
- A number means the session count (e.g., "50" → `--sessions 50`)
- A project name means filter by project (e.g., "myapp" → `--project myapp`)
- A date or relative period means filter by time (e.g., "7d" or "2026-03-01" → `--since <value>`)

Follow the cost-tracker skill's workflow:
1. Run `parse-transcripts.js` to collect cost data across sessions
2. Aggregate per-session, per-project, and grand total costs
3. Compute efficiency metrics (cache hit rate, tokens per turn)
4. Generate a cost report with summary table, top 5 expensive sessions, and insights
