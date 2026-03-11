# Session Analysis Skills

Three Claude Code skills for analyzing JSONL session transcripts, plus a shared parser tool.

## Problem

Claude Code writes detailed JSONL transcripts for every session — user messages, assistant responses, tool calls, token usage. These files accumulate in `~/.claude/projects/` but nobody reads them. The session analysis suite makes this data actionable.

## Skills

### session-reviewer

**Problem it solves:** After a long coding session, you want to verify that Claude didn't introduce security issues, delete important files, or drift outside the task scope.

**What it does:** Parses the most recent session transcript, extracts all file write operations, and evaluates them against universal safety checks and optional project-specific invariants (`.claude/invariants.json`).

**Output:** A review report with CRITICAL/WARNING/INFO findings and a SAFE/NEEDS REVIEW/BLOCKED verdict.

**Invoke:** `/session-reviewer` or `/review-session`

### cost-tracker

**Problem it solves:** You want to understand how many tokens your sessions consume and what they cost (at API-equivalent rates).

**What it does:** Aggregates token usage across recent sessions, computes per-session and per-project cost breakdowns, and reports efficiency metrics like cache hit rate and tokens per turn.

**Output:** A cost report with summary table, top 5 expensive sessions, per-project breakdown, and optimization insights.

**Invoke:** `/cost-tracker` or `/cost-report`

### transcript-miner

**Problem it solves:** You want to learn from past sessions — what prompts work well, how configs evolved, what decisions were made, and what mistakes keep recurring.

**What it does:** Runs one of four mining modes across session history:
1. **prompts** — Extract patterns from high-quality opening prompts → template library
2. **config** — Track configuration file changes → evolution timeline
3. **decisions** — Find decision points and extract reasoning → decision log
4. **mistakes** — Detect correction patterns → suggest CLAUDE.md constraints

**Output:** Markdown reports and JSONL data files for each mode.

**Invoke:** `/transcript-miner <mode>` or `/mine-sessions`

## Parser Tool

All three skills use `tools/parse-transcripts.js` for session discovery and JSONL parsing.

### CLI Usage

```bash
# List discoverable session directories
node tools/parse-transcripts.js --list

# Analyze 5 most recent sessions
node tools/parse-transcripts.js --recent 5

# Analyze sessions for a specific project
node tools/parse-transcripts.js --project myapp --mode costs

# Analyze a single session file
node tools/parse-transcripts.js --session path/to/session.jsonl --mode all

# JSON output for programmatic use
node tools/parse-transcripts.js --recent 10 --mode costs --json
```

### Module Usage

```javascript
const { parseSession, extractCosts, extractWrites } = require('./tools/parse-transcripts.js');

const records = parseSession('/path/to/session.jsonl');
const costs = extractCosts(records);
const writes = extractWrites(records);
```

### Modes

| Mode | Description |
|------|-------------|
| `summary` | Session overview: topic, duration, message counts, models |
| `writes` | File write operations (Write, Edit, NotebookEdit tool calls) |
| `costs` | Token usage and estimated cost breakdown |
| `tools` | Tool call frequency and timeline |
| `all` | All of the above |

## Session Storage Architecture

### Where transcripts live

All session types (CLI, VS Code, Desktop, Cowork) write JSONL transcripts to:

```
~/.claude/projects/<encoded-project-path>/sessions/<uuid>.jsonl   (newer)
~/.claude/projects/<encoded-project-path>/<uuid>.jsonl             (older)
```

On Windows, the base is `%APPDATA%/Claude/` instead of `~/.claude/`.

### Path encoding

The project path is encoded by replacing path separators with `-`:
- `/home/user/myapp` → `-home-user-myapp`
- `C:\Users\Bryce\Projects\foo` → `c--Users-Bryce-Projects-foo`

### What NOT to scan

The directories `local-agent-mode-sessions/` and `claude-code-sessions/` under `~/.claude/` contain **session registry files** (`local_*.json`) for the Desktop sidebar — they do **NOT** contain JSONL transcripts. The parser explicitly excludes these.

## Project Invariants

Create `.claude/invariants.json` in your project to define custom rules for the session-reviewer:

```json
{
  "rules": [
    {
      "type": "file-must-exist",
      "path": "README.md",
      "severity": "CRITICAL",
      "message": "README.md must not be deleted"
    },
    {
      "type": "content-must-not-contain",
      "path": ".env",
      "pattern": "sk-[a-zA-Z0-9]{20,}",
      "severity": "CRITICAL",
      "message": "No API keys should be committed"
    }
  ]
}
```

See [docs/examples/invariants.example.json](examples/invariants.example.json) for a full template.

## Installation

Install via skills-sync:

```bash
./tools/skills-sync --project /path/to/your-project --skill session-reviewer
./tools/skills-sync --project /path/to/your-project --skill cost-tracker
./tools/skills-sync --project /path/to/your-project --skill transcript-miner
```

The parser tool (`tools/parse-transcripts.js`) must be accessible from the toolkit repo. Skills reference it by relative path.
