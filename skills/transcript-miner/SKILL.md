---
name: transcript-miner
description: Pattern extraction and decision archaeology across session history
argument-hint: "<mode> [--sessions <n>] [--since <date>]"
---

# transcript-miner

Mine Claude Code session transcripts for patterns, decisions, config evolution, and recurring mistakes.

## Usage

```
/transcript-miner prompts
/transcript-miner config
/transcript-miner decisions --sessions 50
/transcript-miner mistakes --since 7d
/transcript-miner all
```

## Arguments

Access via `$ARGUMENTS`:
- `<mode>` - Required. One of: `prompts`, `config`, `decisions`, `mistakes`, `all`
- `--sessions <n>` - Number of recent sessions to analyze (default: 20)
- `--since <date>` - Only include sessions modified after this date. Formats: ISO (2026-01-15) or relative (7d, 2w, 1m)

## Modes

### Mode 1: Prompt Pattern Extraction (`prompts`)

**Goal:** Identify structural patterns in high-quality opening prompts to build a reusable template library.

#### Procedure

1. Collect sessions:
   ```bash
   node tools/parse-transcripts.js --recent 20 --mode all --json
   ```

2. For each session, extract the first user message (the opening prompt).

3. Classify session quality using these signals:
   - **High quality:** Few or no correction messages ("no, that's wrong", "revert", "undo"), low token count relative to task complexity, successful outcome
   - **Low quality:** Multiple corrections, high token waste, abandoned tasks

4. From high-quality sessions, extract structural patterns:
   - Does the prompt specify context? (project description, tech stack)
   - Does it include constraints? ("don't modify X", "use library Y")
   - Does it include success criteria? ("tests should pass", "output should match")
   - Does it specify format? (code only, explanation, step-by-step)
   - What's the prompt length? (token count of opening message)

5. Cluster prompts by pattern and produce a template library:

```markdown
## Prompt Templates

### Pattern: Context + Constraint + Task
**Frequency:** 8/20 sessions | **Avg quality:** High
**Template:**
> I'm working on [project] using [tech stack].
> Constraints: [list constraints]
> Task: [specific request]

### Pattern: Direct Task (no context)
**Frequency:** 5/20 sessions | **Avg quality:** Medium
...
```

6. Output both:
   - Markdown report: `prompt-patterns.md`
   - JSONL data: `prompt-patterns.jsonl` (one JSON object per pattern)

### Mode 2: Config Evolution Tracking (`config`)

**Goal:** Build a timeline of all configuration file changes across sessions.

#### Procedure

1. Collect sessions:
   ```bash
   node tools/parse-transcripts.js --recent 20 --mode writes --json
   ```

2. Filter writes for configuration files:
   - `package.json`, `tsconfig.json`, `eslint.config.*`, `prettier.config.*`
   - `.env*`, `docker-compose.yml`, `Dockerfile`
   - `CLAUDE.md`, `.claude/settings.*`, `invariants.json`
   - `terraform.tf*`, `*.yaml`/`*.yml` (if in config directories)
   - Any file matching common config patterns

3. For each config file change, extract:
   - **When:** Timestamp
   - **What:** File path and change preview (from Write/Edit input)
   - **Who initiated:** Was this a user request or Claude's initiative?
     - User-initiated: The preceding user message explicitly asked for the change
     - Claude-initiated: Claude decided to modify the config as part of a larger task
   - **Reasoning:** Extract reasoning from the surrounding assistant message text
   - **Correctness verdict:** Did a later session revert or correct this change?

4. Output a timeline:

```markdown
## Config Evolution Timeline

### package.json

| Date | Change | Initiated By | Reasoning | Reverted? |
|------|--------|-------------|-----------|-----------|
| 2026-03-01 | Added eslint dep | User | "Add linting" | No |
| 2026-03-05 | Removed eslint dep | Claude | Cleanup task | Yes (03-06) |
```

5. Output both:
   - Markdown report: `config-evolution.md`
   - JSONL data: `config-evolution.jsonl`

### Mode 3: Decision Archaeology (`decisions`)

**Goal:** Find decision points in transcripts and extract the reasoning.

#### Procedure

1. Collect sessions:
   ```bash
   node tools/parse-transcripts.js --recent 20 --mode all --json
   ```

2. Identify decision points by scanning assistant messages for:
   - Explicit options: "Option A: ... Option B: ..." or "We could either..."
   - Trade-off language: "trade-off", "alternatively", "on the other hand"
   - Recommendations: "I recommend", "I suggest", "the best approach"
   - Questions to user: "Should I...", "Would you prefer..."
   - Architecture choices: "pattern", "architecture", "design", "structure"

3. For each decision point, extract:
   - **Context:** What problem was being solved
   - **Options:** What alternatives were considered
   - **Chosen:** Which option was selected (and by whom — user or Claude)
   - **Reasoning:** Why that option was chosen
   - **Outcome:** Did it work? Was it reverted later?

4. Produce a decision log:

```markdown
## Decision Log

### Decision: Database ORM Selection
**Session:** abc123 | **Date:** 2026-03-01
**Context:** Setting up database layer for user auth
**Options:**
1. Prisma — type-safe, great DX, heavier
2. Drizzle — lightweight, SQL-like, newer
3. Raw SQL — full control, no abstraction

**Chosen:** Prisma (by user)
**Reasoning:** "Already familiar with Prisma from previous projects"
**Outcome:** Successful — no later corrections
```

5. Output both:
   - Markdown report: `decision-log.md`
   - JSONL data: `decision-log.jsonl`

### Mode 4: Recurring Mistake Detection (`mistakes`)

**Goal:** Find correction patterns and suggest preventive measures.

#### Procedure

1. Collect sessions:
   ```bash
   node tools/parse-transcripts.js --recent 20 --mode all --json
   ```

2. Scan for correction signals in user messages:
   - Explicit corrections: "no", "that's wrong", "not what I asked", "revert that", "undo"
   - Re-requests: "try again", "let me rephrase", "what I meant was"
   - Frustration signals: "stop", "wait", "hold on"
   - Reverts: user asking to restore previous version of a file

3. Also scan for Claude self-corrections:
   - "I apologize", "my mistake", "let me correct that"
   - Immediate re-writes of the same file
   - Tool calls that undo previous tool calls

4. Cluster mistakes by type:
   - **Scope creep:** Claude modified files beyond what was asked
   - **Wrong pattern:** Claude used an incorrect API, library, or pattern
   - **Missing context:** Claude didn't read enough of the codebase before acting
   - **Ignored constraint:** Claude violated a stated constraint
   - **Style mismatch:** Claude used wrong naming convention, formatting, etc.

5. For each cluster, suggest a CLAUDE.md constraint:

```markdown
## Recurring Mistakes

### Cluster: Scope Creep (5 occurrences)

**Examples:**
- Session abc123: Modified 8 files when asked to change 1
- Session def456: Added error handling to unrelated functions

**Suggested CLAUDE.md constraint:**
> When modifying code, only change files explicitly mentioned in the request
> or files that are direct dependencies of the requested change.
> Ask before modifying additional files.
```

6. Output both:
   - Markdown report: `recurring-mistakes.md`
   - JSONL data: `recurring-mistakes.jsonl`

## Running All Modes

When `$ARGUMENTS` is `all`, run all four modes sequentially and produce a combined report with all sections.

## Important Notes

- **Privacy:** Before outputting any report, scan for and redact potential secrets (API keys, tokens, passwords). Replace with `[REDACTED]`.
- **Subagent chains:** When analyzing sessions, include records where `isSidechain: true` for pattern mining (these contain subagent reasoning that informs decisions). However, exclude sidechain records from cost calculations.
- **Thinking blocks:** Content blocks with `type: "thinking"` contain Claude's internal reasoning. These are valuable for decision archaeology — include them in analysis.
- **Output location:** Write reports to the current working directory unless the user specifies otherwise.

## Session Storage

Session transcripts are JSONL files stored at:
- `~/.claude/projects/<encoded-project-path>/sessions/<uuid>.jsonl` (newer layout)
- `~/.claude/projects/<encoded-project-path>/<uuid>.jsonl` (older layout)
- On Windows: `%APPDATA%/Claude/` instead of `~/.claude/`

**Do NOT scan** `local-agent-mode-sessions/` or `claude-code-sessions/` — those contain registry files, not transcripts.
