# bryce-labs-toolkit

A collection of reusable Claude Code skills, tools, and templates for AI-assisted development workflows.

## Why This Exists

Claude Code writes detailed JSONL session transcripts for every interaction — messages, tool calls, token usage, decisions. These files accumulate in `~/.claude/projects/` but nobody reads them. This toolkit's session analysis skills make that data actionable: post-session QA, cost tracking, pattern mining, and lesson extraction.

Beyond session analysis, the toolkit includes skills for branch cleanup, story mining, and a spec-driven development plugin.

## What's Included

### Plugins

- **[spec-workflow](plugins/spec-workflow/)** — Spec-driven development with automated review loops (Specification → Planning → Implementation → Review)

### Skills

#### Session Analysis Suite

- **[session-reviewer](skills/session-reviewer/)** — Post-session QA: extracts all file writes from the most recent session and checks them against project invariants and universal safety rules. Reports CRITICAL/WARNING/INFO findings with a SAFE/NEEDS REVIEW/BLOCKED verdict.
- **[cost-tracker](skills/cost-tracker/)** — Token usage and cost analysis across sessions. Produces per-session, per-project, and per-model breakdowns with efficiency metrics (cache hit rate, tokens per turn).
- **[transcript-miner](skills/transcript-miner/)** — Pattern extraction across session history. Four modes: prompt pattern analysis, config evolution tracking, decision archaeology, and recurring mistake detection.

#### Other Skills

- **[cleanup](skills/cleanup/)** — Post-merge git branch cleanup with safety checks, auto-detected base branch, and squash-merge support
- **[lessons-extractor](skills/lessons-extractor/)** — Extract lessons learned from Claude Code session logs into organized markdown and JSONL files
- **[story-miner](skills/story-miner/)** — Mine Claude Code session history for publishable development stories

### Tools

- **[parse-transcripts](tools/parse-transcripts.js)** — Parse Claude Code JSONL session transcripts (CLI + importable Node.js module)
- **[skills-sync](tools/skills-sync.js)** — Install and update skills to target projects (cross-platform wrappers included)
- **[lint-skills](tools/lint-skills.sh)** — Lint skills for Windows-unsafe patterns
- **[spec-workflow-reset](tools/spec-workflow-reset.sh)** — Reset spec-workflow artifacts
- **[story-miner-reset](tools/story-miner-reset.sh)** — Reset story-miner output artifacts
- **[lessons-extractor-reset](tools/lessons-extractor-reset.sh)** — Reset lessons-extractor output artifacts
- **[spec-workflow-dev-sync](tools/spec-workflow-dev-sync.sh)** — Sync plugin edits to Claude Code cache

### Slash Commands

| Command | Skill | What It Does |
|---------|-------|-------------|
| `/review-session` | session-reviewer | QA the most recent session's file writes |
| `/cost-report` | cost-tracker | Analyze token costs across last 20 sessions |
| `/mine-sessions` | transcript-miner | Extract patterns from session history |

## Quick Start

```bash
# Clone the repo
git clone https://github.com/BryceEWatson/bryce-labs-toolkit.git
cd bryce-labs-toolkit

# List available skills
./tools/skills-sync --list

# Install session analysis skills to your project
./tools/skills-sync --project /path/to/your-project --skill session-reviewer
./tools/skills-sync --project /path/to/your-project --skill cost-tracker
./tools/skills-sync --project /path/to/your-project --skill transcript-miner

# Test the parser on your sessions
node tools/parse-transcripts.js --list
node tools/parse-transcripts.js --recent 5 --mode summary

# Run the test suite
node tests/test-parser.js

# Use slash commands in Claude Code
# /review-session
# /cost-report
# /mine-sessions decisions
```

On Windows (CMD/PowerShell):
```bat
tools\skills-sync.cmd --list
tools\parse-transcripts.cmd --list
```

## How Session Storage Works

All session types (CLI, VS Code, Desktop, Cowork) write JSONL transcripts to:

```
~/.claude/projects/<encoded-project-path>/sessions/<uuid>.jsonl   (newer)
~/.claude/projects/<encoded-project-path>/<uuid>.jsonl             (older)
```

The path encoding replaces `/` with `-` (e.g., `/home/user/myapp` → `-home-user-myapp`). On Windows, `C:\Users\Bryce\Projects\foo` becomes `c--Users-Bryce-Projects-foo`.

On Windows, the base may be `%APPDATA%/Claude/` instead of `~/.claude/`.

**Important:** The directories `local-agent-mode-sessions/` and `claude-code-sessions/` contain session registry files for the Desktop sidebar — they do NOT contain JSONL transcripts.

## Install Plugins

Plugins are installed via the Claude Code marketplace:

```bash
# Add the marketplace source (one-time)
/plugin marketplace add BryceEWatson/bryce-labs-toolkit

# Install a plugin
/plugin install spec-workflow@bryce-labs
```

## Install Skills

### Using skills-sync (Recommended)

```bash
# Install a single skill
./tools/skills-sync --project /path/to/your-project --skill lessons-extractor

# Install all skills
./tools/skills-sync --project /path/to/your-project --all

# Check if installed skills are up to date
./tools/skills-sync --project /path/to/your-project --all --check

# Force update (clean install)
./tools/skills-sync --project /path/to/your-project --skill session-reviewer --force
```

Skills are installed to `<project>/.claude/skills/<skill-name>/` and become available as `/<skill-name>` in Claude Code.

### Symlink (Development)

```bash
# macOS/Linux
ln -s /path/to/bryce-labs-toolkit/skills/session-reviewer /path/to/your-project/.claude/skills/session-reviewer

# Windows (PowerShell - requires admin)
New-Item -ItemType SymbolicLink -Path "C:\project\.claude\skills\session-reviewer" -Target "C:\bryce-labs-toolkit\skills\session-reviewer"
```

## Defining Project Invariants

Create `.claude/invariants.json` in your project to define custom rules that the session-reviewer checks against:

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
      "message": "No API keys in committed files"
    }
  ]
}
```

See [docs/examples/invariants.example.json](docs/examples/invariants.example.json) for a full template.

## Using parse-transcripts.js as a Module

```javascript
const {
  parseSession,
  extractSummary,
  extractWrites,
  extractCosts,
  extractToolUsage,
  findSessionFiles,
} = require('./tools/parse-transcripts.js');

// Parse a single session
const records = parseSession('/path/to/session.jsonl');
const summary = extractSummary(records, { sessionId: 'abc123' });
const costs = extractCosts(records);
const writes = extractWrites(records);
const tools = extractToolUsage(records);

// Find recent sessions
const recentFiles = findSessionFiles(null, 10); // 10 most recent across all projects
const projectFiles = findSessionFiles('myapp', 5); // 5 most recent for 'myapp'
```

## Assumptions and Verification

The session analysis skills rely on specific assumptions about Claude Code's JSONL format and storage paths. These were validated against primary sources before implementation.

Key findings:
- Transcripts go to `~/.claude/projects/`, NOT `local-agent-mode-sessions/`
- Token fields are snake_case at `message.usage`
- `isSidechain` and `isApiErrorMessage` records must be filtered from cost calculations
- Pricing verified as of March 2026

See [docs/assumption-validation-report.md](docs/assumption-validation-report.md) for the full validation report.

## Repository Structure

```
bryce-labs-toolkit/
  .claude/                # Claude Code configuration (partially tracked)
    commands/             # Custom slash commands (git-tracked)
      review-session.md   # Session reviewer command
      cost-report.md      # Cost tracker command
      mine-sessions.md    # Transcript miner command
    skills/               # Pre-installed skills (gitignored)
  plugins/                # Claude Code plugins
    spec-workflow/        # Spec-driven development workflow
  skills/                 # Claude Code skills
    cleanup/              # Post-merge branch cleanup
    cost-tracker/         # Token usage and cost analysis
    lessons-extractor/    # Log reflection skill
    session-reviewer/     # Post-session QA
    story-miner/          # Session history story mining
    transcript-miner/     # Pattern extraction and decision archaeology
  tools/                  # CLI tools
    parse-transcripts.js  # Session transcript parser (main script)
    parse-transcripts     # POSIX wrapper
    parse-transcripts.cmd # Windows wrapper
    skills-sync.js        # Skill installer (main script)
    skills-sync           # POSIX wrapper
    skills-sync.cmd       # Windows wrapper
    lint-skills.sh        # Windows-safety linter
  tests/                  # Test suite
    fixtures/             # Test data
      test-session.jsonl  # Synthetic session for parser tests
    test-parser.js        # Parser unit tests
  docs/                   # Documentation
    session-analysis-skills.md      # Session analysis overview
    assumption-validation-report.md # Validated architecture claims
    examples/                       # Templates and examples
      invariants.example.json       # Invariants file template
    reference/                      # Reference docs
    specs/, plans/, reviews/        # Spec-workflow artifacts
```

See [docs/reference/repo-layout.md](docs/reference/repo-layout.md) for the complete layout.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.

Code, skills, and documentation are all covered under Apache-2.0.
