Use the **transcript-miner** skill to extract patterns from Claude Code session history.

Determine the mining mode from `$ARGUMENTS`:
- If the user mentions "patterns", "prompts", or "templates" → use mode `prompts`
- If the user mentions "config", "configuration", or "settings" → use mode `config`
- If the user mentions "decisions", "choices", or "architecture" → use mode `decisions`
- If the user mentions "mistakes", "errors", "corrections", or "recurring" → use mode `mistakes`
- If the user says "all" or provides no specific mode keyword → run all four modes

Pass through any additional arguments:
- `--sessions <n>` for session count
- `--since <date>` for time filtering

Follow the transcript-miner skill's workflow for the selected mode(s), producing both markdown reports and JSONL data files.
