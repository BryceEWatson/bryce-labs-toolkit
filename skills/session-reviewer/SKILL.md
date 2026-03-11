---
name: session-reviewer
description: Post-session QA that reviews file writes against project invariants and safety checks
argument-hint: "[<session-id-or-path>]"
---

# session-reviewer

Post-session quality assurance: parse the most recent session transcript, extract all file write operations, and evaluate them against project invariants and universal safety checks.

## Usage

```
/session-reviewer
/session-reviewer abc123-def456
/session-reviewer /path/to/session.jsonl
```

## Arguments

Access via `$ARGUMENTS`:
- No arguments: analyzes the most recent session
- Session ID or UUID: finds the matching session in `~/.claude/projects/`
- File path: analyzes the specified JSONL file directly

## Workflow

### Step 1: Locate the Session Transcript

1. If `$ARGUMENTS` contains a file path (ends in `.jsonl`), use it directly.
2. If `$ARGUMENTS` contains a session ID, search for a matching JSONL file:
   ```bash
   node tools/parse-transcripts.js --list --json
   ```
   Then find the file matching the session ID.
3. If no arguments, get the most recent session:
   ```bash
   node tools/parse-transcripts.js --recent 1 --mode writes --json
   ```

### Step 2: Parse the Session

Run the parser to extract all data:
```bash
node tools/parse-transcripts.js --session <file> --mode all --json
```

This returns summary, writes, costs, and tool usage data.

### Step 3: Extract and Catalog Writes

From the `writes` array in the parser output, build a catalog of all file modifications:

| # | Tool | File Path | Preview |
|---|------|-----------|---------|
| 1 | Write | src/utils.js | function greet()... |
| 2 | Edit | src/index.js | import { greet }... |

### Step 4: Load Project Invariants

Check for a project invariants file at `.claude/invariants.json` in the current working directory. If it exists, load the rules. If not, proceed with only universal safety checks.

**Invariants file format:**
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
      "type": "content-must-contain",
      "path": "package.json",
      "pattern": "\"name\":",
      "severity": "WARNING",
      "message": "package.json must have a name field"
    },
    {
      "type": "content-must-not-contain",
      "path": ".env",
      "pattern": "sk-[a-zA-Z0-9]{20,}",
      "severity": "CRITICAL",
      "message": "No API keys in .env file"
    }
  ]
}
```

### Step 5: Run Universal Safety Checks

Evaluate every file write against these universal safety checks:

| Check | Severity | Trigger |
|-------|----------|---------|
| Critical file deletion | CRITICAL | Write/Edit to a file that effectively empties or removes a critical file (README.md, LICENSE, package.json, CLAUDE.md, .gitignore) |
| Config field removal | WARNING | Edit that removes fields from config files (package.json, tsconfig.json, etc.) without clear intent |
| Secret exposure | CRITICAL | Write/Edit that introduces patterns matching API keys, tokens, passwords (e.g., `sk-`, `ghp_`, `password =`, `SECRET_KEY`) |
| Scope creep | WARNING | Files modified outside the apparent task scope (compare file paths to the session topic) |
| Large rewrite | INFO | A Write tool call that replaces an entire file (vs. targeted Edit) on a file that existed before |
| Test removal | WARNING | Deletion or emptying of test files, or removal of test assertions |
| Debug code left | INFO | Write/Edit that leaves `console.log`, `debugger`, `print(` statements in production code |
| Dependency change | INFO | Modifications to package.json dependencies, requirements.txt, go.mod, etc. |

### Step 6: Run Invariant Checks

If `.claude/invariants.json` was loaded, evaluate each rule:

- **file-must-exist**: Check if any write operation deleted or emptied this file
- **content-must-contain**: For files that were written, verify the pattern exists in the new content
- **content-must-not-contain**: For files that were written, verify the pattern does NOT exist in the new content

### Step 7: Generate Report

Output a structured report:

```markdown
## Session Review Report

**Session:** [session ID]
**Date:** [timestamp]
**Topic:** [first user message preview]
**Files modified:** N

### Findings

#### CRITICAL
- [finding description, file path, remediation suggestion]

#### WARNING
- [finding description, file path]

#### INFO
- [finding description]

### Verdict

**[SAFE / NEEDS REVIEW / BLOCKED]**

- SAFE: No CRITICAL or WARNING findings
- NEEDS REVIEW: Has WARNING findings but no CRITICAL
- BLOCKED: Has CRITICAL findings — manual review required before proceeding
```

### Step 8: Suggest Remediations

For each CRITICAL finding, include a specific remediation:

- **Secret exposure**: "Remove the secret from [file]. Add it to `.env` (gitignored) and reference via environment variable."
- **Critical file deletion**: "Restore [file] from git: `git checkout HEAD -- [file]`"
- **Test removal**: "Restore test file from git or rewrite the removed assertions."

## Session Storage

Session transcripts are JSONL files stored at:
- `~/.claude/projects/<encoded-project-path>/sessions/<uuid>.jsonl` (newer layout)
- `~/.claude/projects/<encoded-project-path>/<uuid>.jsonl` (older layout)
- On Windows: `%APPDATA%/Claude/` instead of `~/.claude/`

**Do NOT scan** `local-agent-mode-sessions/` or `claude-code-sessions/` — those contain registry files, not transcripts.
