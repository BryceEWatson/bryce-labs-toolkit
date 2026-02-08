---
name: story-miner
description: Mines Claude Code session history for publishable development stories
argument-hint: "[self-test|evolve] [--since <date>] [--output <dir>] [--full] [--clear]"
---

# story-miner

Extract publishable development stories from Claude Code session logs.

## Usage

```
/story-miner
/story-miner --since 7d
/story-miner --output .story-miner/
/story-miner --full
/story-miner --clear
/story-miner self-test
/story-miner evolve
```

## Arguments

Access via `$ARGUMENTS`:
- `--since <date>` - Only process logs modified after this date. Formats: ISO (2026-01-15) or relative (7d, 2w, 1m, 24h).
- `--output <dir>` - Output directory (default: `.story-miner/`)
- `--full` - Process all logs, ignoring incremental cursor
- `--clear` - Clear existing outputs before generating fresh stories
- `self-test` - Run evaluation suite on fixtures to validate prompt quality
- `evolve` - Propose prompt improvements based on self-test metrics

## Workflow

### Prohibited Actions

> **CRITICAL**: This skill MUST NOT create any files except the declared output set.

**Hard rule — no extra files:**

1. **Do NOT write helper scripts** - Never create `.js`, `.cjs`, `.mjs`, `.ts`, `.sh`, or any other code files
2. **Do NOT create temporary files** - No `analyze-*.cjs`, no scratch files, no intermediate outputs
3. **Do NOT add any files to the repo** - If something isn't working, fall back to simpler analysis techniques
4. **Do NOT commit output files** - All outputs in the output directory are generated artifacts, not source code
5. **Do NOT push to remote** - This skill only generates local outputs
6. **Do NOT modify files outside output directory** - Only edit files in the output directory and skill directory
7. **Do NOT silently edit prompt files** - Only the `evolve` subcommand can propose prompt edits (via patch file)

**Allowed file writes (using the Write tool):**

| File | Tool | Notes |
|------|------|-------|
| `preprocessed.json` | Preprocessor only | Created by `node story-preprocessor.cjs`, NOT by Write |
| `.stories-cursor.json` | Preprocessor only | Created by preprocessor, NOT by Write |
| `candidates.jsonl` | Write | Scored candidate stories |
| `stories.jsonl` | Write | Full narrative stories |
| `stories.md` | Write | Human-readable stories |
| `digest.md` | Write | Executive summary |
| `index.json` | Write | Machine-readable index |
| `selftest-report.md` | Write | Self-test results (self-test mode only) |
| `selftest-metrics.json` | Write | Self-test metrics (self-test mode only) |
| `evolve-proposal.md` | Write | Prompt evolution proposal (evolve mode only) |
| `evolve-metrics.json` | Write | Evolution metrics (evolve mode only) |
| `prompt-diff.patch` | Write | Prompt diff patch (evolve mode only) |

**Strong guidance — avoid unreliable techniques:**

- **Avoid `node -e`** - Shell escaping is unreliable across platforms; prefer Read/Grep/summary instead
- **Avoid shell pipelines for JSON** - Use the preprocessor's built-in summary data

**What to do instead when analysis is difficult:**

- **Use the `summary` object** - It already contains processing stats (logs processed, events sampled, etc.)
- **Read selectively** - Use `Read` with `offset`/`limit` to examine portions of large files
- **Search with Grep** - Use `Grep` to find specific patterns within `preprocessed.json`
- **Process fewer sessions** - Re-run with `--since 1d` or `--since 12h`
- **Ask the user** - If data is too large to analyze, ask if they want a smaller slice

If you encounter ANY friction that tempts you to write a script, STOP and use these alternatives.

### Step 0: Handle --clear (if requested)

If `$ARGUMENTS` contains `--clear`:

1. **Parse output directory** from `$ARGUMENTS`:
   - If `--output <dir>` is present, use that directory
   - Otherwise use default: `.story-miner/`

2. **Run clear command** (removes existing outputs):
   ```bash
   node .claude/skills/story-miner/bin/story-preprocessor.cjs --clear --output-dir <dir>
   ```

3. **Continue to Step 1** with remaining arguments (excluding `--clear`):
   - This ensures fresh stories are generated after clearing
   - Example: `/story-miner --clear --since 7d` → clear, then preprocess with `--since 7d`

**Important:** Do NOT pass `--clear` to Step 1. The clear happens here, then Step 1 runs preprocessing normally.

### Main Workflow (Default Mode)

Execute when `$ARGUMENTS` does NOT start with `self-test` or `evolve`.

### Step 1: Run Preprocessor

The preprocessor handles cross-platform log discovery, filtering, and story signal detection.

**Build the command from parsed arguments** (do NOT include `--clear`):

```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs [--since <date>] [--output-dir <dir>] [--full] [--verbose]
```

**Map skill arguments to preprocessor flags:**
- Skill `--since <date>` → Preprocessor `--since <date>`
- Skill `--output <dir>` → Preprocessor `--output-dir <dir>`
- Skill `--full` → Preprocessor `--full`
- Skill `--clear` → Already handled in Step 0, do NOT pass here

**From repo root (most common):**
```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs --since 7d
```

**From skill directory:**
```bash
cd .claude/skills/story-miner && node bin/story-preprocessor.cjs --since 7d
```

**With custom output directory:**
```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs --since 7d --output-dir .story-miner
```

**Process all logs (ignore cursor):**
```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs --full --verbose
```

The preprocessor will:
- Discover logs in `~/.claude/projects/` (cross-platform, no shell)
- Filter out subagent logs and `agent-*.jsonl` files
- Skip sessions that are running this skill (avoids noise)
- Detect story signals (commits, PRs, architecture decisions, debugging breakthroughs)
- Apply sampling strategy to capture story-relevant events
- Truncate large content fields
- Apply redaction patterns
- Output a compact JSON file for analysis

**Preprocessor output location:** `.story-miner/preprocessed.json` (default)

**If preprocessor fails:**
1. Check that Node.js is installed (`node --version`)
2. Verify the skill is installed (`ls .claude/skills/story-miner/bin/`)
3. Run with `--verbose` to see detailed output
4. Fall back to manual log excerpts if needed

### Step 2: Read Preprocessed Data

Read the preprocessor output file:

```
Read: .story-miner/preprocessed.json
```

**Start with the `summary` object** at the top of the file:
- `summary.logsProcessed` - How many session logs were analyzed
- `summary.totalEvents` - Total events across all sessions (before sampling)
- `summary.sampledEvents` - Events included after sampling
- `summary.runScope` - Indicates if this is a `full`, `substantial`, or `incremental` run
- `summary.newSessions` - Count of new sessions processed since last run

**Check run scope (Step 2.5):**
1. Read `summary.runScope` from preprocessed.json
2. If `runScope === "incremental"` AND `summary.newSessions === 0`:
   - Log: "No new sessions to process. Skipping story generation."
   - Exit skill execution
3. Otherwise: Continue to Step 3

**The full structure contains:**
- `summary` - Processing statistics (read this FIRST)
- `sessions[]` - Array of processed sessions with:
  - `sessionId` - Unique session identifier
  - `logPath` - Log file path (home directory replaced with `~` to avoid exposing usernames)
  - `events[]` - Sampled and truncated events
  - `storySignals{}` - Detected story signals (commits, PRs, breakthroughs, etc.)
  - `evidence[]` - Short excerpts with timestamps for story attribution

**If the file is too large to read at once:**
1. Use `Read` with `limit: 200` to see the structure and summary
2. Use `Grep` to search for specific patterns (e.g., `"storySignals"`, commit messages)
3. Request a smaller slice: ask the user to re-run with `--since 1d` or `--since 12h`

**NEVER write helper scripts to analyze this data** - see "Prohibited Actions" above.

### Step 3: Score Candidates

Read the scoring prompt:

```
Read: .claude/skills/story-miner/prompts/score_candidates.md
```

Apply the prompt to preprocessed data. For each session with story signals, evaluate:
- **Narrative potential** - Does this have a compelling arc (problem → solution → outcome)?
- **Technical depth** - Does this demonstrate interesting techniques or insights?
- **Uniqueness** - Is this a fresh perspective or novel approach?
- **Groundedness** - Can this be supported with concrete quotes from the session?

Output format (candidates.jsonl):
```jsonl
{"sessionId":"abc","score":0.85,"reasoning":"...","storyAngle":"...","promoted":true}
{"sessionId":"def","score":0.45,"reasoning":"...","storyAngle":"...","promoted":false}
```

Write to output directory:
```
Write: .story-miner/candidates.jsonl
```

### Step 3.5: Early Scan

Run the scanner on candidates.jsonl:

```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs --scan-dir <outputDir>
```

The scanner checks for:
- Secret patterns (API keys, tokens, credentials)
- PII (email addresses, usernames)
- Malformed JSONL

**If scanner exits with code 1 (findings detected):**
1. Read the scanner output to identify issues
2. Fix the candidates.jsonl file (redact secrets, fix formatting)
3. Re-run the scanner
4. Repeat until scanner exits with code 0

**If scanner exits with code 0:**
- Continue to Step 4

### Step 4: Deduplicate (Deterministic)

Run the deterministic deduplication process:

```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs --dedupe --output-dir <outputDir>
```

This is **100% deterministic** with no LLM calls. The deduplicator:
- Clusters similar candidates by story signals (commit SHAs, file paths, error signatures)
- Assigns cluster IDs to each candidate
- Promotes the highest-scoring candidate per cluster
- Overwrites candidates.jsonl with cluster assignments

Output format (updated candidates.jsonl):
```jsonl
{"sessionId":"abc","score":0.85,"promoted":true,"clusterId":"c1","clusterRep":true}
{"sessionId":"def","score":0.82,"promoted":false,"clusterId":"c1","clusterRep":false}
{"sessionId":"ghi","score":0.75,"promoted":true,"clusterId":"c2","clusterRep":true}
```

**Only `promoted: true` and `clusterRep: true` candidates advance to Step 5.**

### Step 5: Write Stories

Read the story writing prompt:

```
Read: .claude/skills/story-miner/prompts/write_story.md
```

For each promoted candidate (where `promoted === true` AND `clusterRep === true`), write a narrative story:
- **Grounded quotes** - Every claim must be supported by direct quotes from the session
- **Narrative arc** - Clear beginning (problem), middle (approach), end (outcome)
- **Technical depth** - Explain the "why" and "how", not just "what"
- **Generalizable insights** - What can readers apply to their own work?

Output format (stories.jsonl):
```jsonl
{"storyId":"story-001","sessionId":"abc","title":"...","narrative":"...","quotes":[...],"tags":["debugging","architecture"],"publishability":0.85}
{"storyId":"story-002","sessionId":"ghi","title":"...","narrative":"...","quotes":[...],"tags":["git","workflow"],"publishability":0.78}
```

Write to output directory:
```
Write: .story-miner/stories.jsonl
```

### Step 6: Output Scan

Run the scanner on ALL output files:

```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs --scan-dir <outputDir>
```

**If scanner exits with code 1 (findings detected):**
1. Read the scanner output to identify issues
2. Fix the offending files (stories.jsonl, candidates.jsonl)
3. Re-run the scanner
4. Repeat until scanner exits with code 0

**If scanner exits with code 0:**
- Continue to Step 7

### Step 7: Render Outputs

Read the rendering prompt:

```
Read: .claude/skills/story-miner/prompts/render_outputs.md
```

Before rendering, read `candidates.jsonl` and compute pipeline metadata:
- **candidatesEvaluated**: total line count
- **candidatesPromoted**: lines where `status="promoted"`
- **candidatesRejected**: lines where `status="rejected"`

Pass these counts as context when following `render_outputs.md`.

Generate final outputs from stories.jsonl:

**stories.md** - Human-readable stories with metadata:
```markdown
# Development Stories

Last updated: 2026-02-07

## Story 1: Debugging a Race Condition in React Hooks

Tags: debugging, react, hooks

[Full narrative with grounded quotes...]

---
## Story 2: Migrating from Jest to Vitest

Tags: testing, migration, tooling

[Full narrative...]

---
## Sources Used
- Preprocessor: ✓ (v1.0.0)
- Session logs: ✓ (12 files from ~/.claude/projects/)
- Stories extracted: 2
```

**digest.md** - Executive summary:
```markdown
# Story Digest

Run date: 2026-02-07
Sessions processed: 12
Candidates scored: 8
Stories published: 2

## Key Themes
- Debugging and troubleshooting (1 story)
- Tooling and migration (1 story)

## Top Stories
1. **Debugging a Race Condition in React Hooks** (0.85/1.0)
2. **Migrating from Jest to Vitest** (0.78/1.0)
```

**index.json** - Machine-readable index:
```json
{
  "generatedAt": "2026-02-07T10:30:00Z",
  "runScope": "substantial",
  "sessionsProcessed": 12,
  "candidatesScored": 8,
  "storiesPublished": 2,
  "stories": [
    {
      "storyId": "story-001",
      "title": "Debugging a Race Condition in React Hooks",
      "tags": ["debugging", "react", "hooks"],
      "publishability": 0.85
    }
  ]
}
```

Write to output directory:
```
Write: .story-miner/stories.md
Write: .story-miner/digest.md
Write: .story-miner/index.json
```

### Step 8: Final Scan

Run the scanner one last time on ALL rendered outputs:

```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs --scan-dir <outputDir>
```

**If scanner exits with code 1 (findings detected):**
1. Read the scanner output
2. Fix the offending files
3. Re-run the scanner
4. Repeat until scanner exits with code 0

**If scanner exits with code 0:**
- Report success
- Log file paths for all generated outputs
- Exit skill execution

---

## Self-Test Subcommand

Execute when `$ARGUMENTS` starts with `self-test`.

**Purpose:** Validate prompt quality using deterministic fixtures with known ground truth.

### Step 1: Run Preprocessor Self-Test

```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs --self-test
```

This validates the preprocessor can process fixture files correctly.

### Step 2: Run Full Pipeline on Fixtures

1. Read fixture files from `.claude/skills/story-miner/eval/fixtures/`
2. Apply scoring prompt to fixtures (Step 3 logic)
3. Apply story writing prompt to high-scoring candidates (Step 5 logic)
4. Write candidates.jsonl and stories.jsonl to output directory

### Step 3: Run Deterministic Eval Runner

```bash
node .claude/skills/story-miner/eval/run-selftest.cjs --fixtures-dir .claude/skills/story-miner/eval/fixtures/ --output-dir <outputDir>
```

The eval runner:
- Reads expected outputs from `eval/fixtures/expected/`
- Reads actual outputs from `<outputDir>/`
- Compares using deterministic metrics:
  - **Exact match** - Story IDs, titles, tags
  - **Quote fidelity** - Are quotes verbatim from sessions?
  - **Coverage** - Are all expected stories detected?
  - **Precision** - Are there false positives?
- Writes metrics to `selftest-metrics.json`
- Writes report to `selftest-report.md`

### Step 4: Report Results

Read and display:
```
Read: <outputDir>/selftest-report.md
```

**Success criteria:**
- Coverage >= 90% (detected at least 90% of expected stories)
- Precision >= 85% (no more than 15% false positives)
- Quote fidelity >= 95% (quotes are verbatim)

**If metrics are below thresholds:**
- Report failure
- Suggest running `evolve` subcommand to improve prompts

---

## Evolve Subcommand

Execute when `$ARGUMENTS` starts with `evolve`.

**Purpose:** Propose prompt improvements based on self-test metrics.

### Step 1: Run Baseline Self-Test

Run the full self-test workflow (see above) and capture baseline metrics:
```
Read: <outputDir>/selftest-metrics.json
```

Store baseline metrics for comparison.

### Step 2: Propose Prompt Variants

Analyze current prompts and baseline metrics to identify weaknesses:
- Low coverage → improve story signal detection in score_candidates.md
- Low precision → tighten scoring criteria
- Low quote fidelity → strengthen grounding instructions in write_story.md

Propose 1-3 small edits as candidate variants. For each variant:
- Describe the change (e.g., "Add scoring penalty for sessions without commits")
- Predict expected improvement (e.g., "+5% precision")

### Step 3: Test Variants

For each variant (limit 3):

1. **Create variant directory:**
   ```
   <outputDir>/_evolve/candidate-1/prompts/
   <outputDir>/_evolve/candidate-2/prompts/
   <outputDir>/_evolve/candidate-3/prompts/
   ```

2. **Write variant prompt files:**
   ```
   Write: <outputDir>/_evolve/candidate-1/prompts/score_candidates.md
   Write: <outputDir>/_evolve/candidate-1/prompts/write_story.md
   Write: <outputDir>/_evolve/candidate-1/prompts/render_outputs.md
   ```

3. **Re-run pipeline with variant prompts:**
   - Use variant prompts instead of repo prompts
   - Write outputs to `<outputDir>/_evolve/candidate-1/`

4. **Run eval runner on variant:**
   ```bash
   node .claude/skills/story-miner/eval/run-selftest.cjs --fixtures-dir .claude/skills/story-miner/eval/fixtures/ --output-dir <outputDir>/_evolve/candidate-1/
   ```

5. **Read variant metrics:**
   ```
   Read: <outputDir>/_evolve/candidate-1/selftest-metrics.json
   ```

### Step 4: Select Best Candidate

Compare variant metrics against baseline:
- **Quality improvement** - Coverage, precision, quote fidelity
- **No safety regression** - Must not introduce new secrets/PII leakage

Select the variant with:
- Highest quality improvement
- No safety regression
- At least +2% improvement on any metric

**If no variant improves:**
- Report "No improvement found"
- Do NOT generate patch file
- Exit evolve mode

### Step 5: Generate Patch File

For the selected variant, generate a unified diff:

```bash
diff -u .claude/skills/story-miner/prompts/score_candidates.md <outputDir>/_evolve/candidate-N/prompts/score_candidates.md > <outputDir>/prompt-diff.patch
diff -u .claude/skills/story-miner/prompts/write_story.md <outputDir>/_evolve/candidate-N/prompts/write_story.md >> <outputDir>/prompt-diff.patch
diff -u .claude/skills/story-miner/prompts/render_outputs.md <outputDir>/_evolve/candidate-N/prompts/render_outputs.md >> <outputDir>/prompt-diff.patch
```

Write patch file:
```
Write: <outputDir>/prompt-diff.patch
```

### Step 6: Output Proposal

Write evolution proposal:

**evolve-proposal.md:**
```markdown
# Prompt Evolution Proposal

Run date: 2026-02-07

## Baseline Metrics
- Coverage: 88%
- Precision: 82%
- Quote fidelity: 96%

## Selected Variant: candidate-2

### Changes
- Added scoring penalty for sessions without commits
- Strengthened grounding requirements in story narratives

### Predicted Improvement
- Coverage: 88% → 92% (+4%)
- Precision: 82% → 87% (+5%)
- Quote fidelity: 96% → 96% (no change)

## Patch File
See: prompt-diff.patch

## Next Steps
1. Review the patch file
2. Apply with: `git apply <outputDir>/prompt-diff.patch`
3. Run self-test to validate improvement
4. Commit if metrics improve
```

Write to output directory:
```
Write: <outputDir>/evolve-proposal.md
Write: <outputDir>/evolve-metrics.json
```

### Step 7: Exit

Report success:
- Display path to evolve-proposal.md
- Display path to prompt-diff.patch
- Remind user to review before applying

**CRITICAL:** Do NOT silently edit prompt files in `.claude/skills/story-miner/prompts/`. The user must review and apply the patch manually.

---

## Important Notes

- **Never commit raw logs** - they may contain sensitive data
- **Review outputs before committing** - redaction is best-effort
- Logs are read from `~/.claude/projects/` by default (Claude Code's storage location)
- Log directories use encoded names (e.g., `c--Users-YourName-Projects-myrepo`)
- Use `--since` to limit volume when processing many sessions
- The preprocessor automatically skips its own sessions to avoid noise
- All outputs are written to the output directory (default: `.story-miner/`)
- Outputs are NOT tracked in git by default (add to .gitignore)

## Troubleshooting

### Preprocessor not found

If the preprocessor script is not found:

1. Verify the skill is installed:
   ```bash
   ls .claude/skills/story-miner/bin/
   ```

2. Check Node.js is available:
   ```bash
   node --version
   ```

3. Run the preprocessor directly:
   ```bash
   node .claude/skills/story-miner/bin/story-preprocessor.cjs --help
   ```

### No logs found

If the preprocessor reports no logs:

1. Check the log directory exists:
   ```bash
   ls ~/.claude/projects/
   ```

2. Try without date filter:
   ```bash
   node .claude/skills/story-miner/bin/story-preprocessor.cjs --full --verbose
   ```

3. The preprocessor will show detailed discovery output with `--verbose`

### Scanner finds secrets

If the scanner detects secrets or PII:

1. Read the scanner output to identify the issue
2. Fix the source file (candidates.jsonl or stories.jsonl)
3. Re-run the scanner
4. **Do NOT bypass the scanner** - secrets must be redacted

### Zero candidates

If no candidates are scored:

1. Check if sessions have story signals (commits, PRs, breakthroughs)
2. Review the scoring prompt for overly strict criteria
3. Try with `--full` to process all sessions
4. Check preprocessed.json to verify story signals were detected

### Dedupe fails

If deduplication fails:

1. Verify candidates.jsonl is valid JSONL (one object per line)
2. Check that required fields exist: sessionId, score, promoted
3. Run the scanner to detect formatting issues
4. Re-run Step 3 to regenerate candidates.jsonl

### Self-test failures

If self-test metrics are below thresholds:

1. Run `evolve` subcommand to propose prompt improvements
2. Review evolve-proposal.md for suggested changes
3. Apply the patch file: `git apply <outputDir>/prompt-diff.patch`
4. Re-run self-test to validate improvement

### Windows-specific issues

The preprocessor eliminates most Windows/Git Bash issues by using Node.js instead of shell commands. If you still encounter problems:

1. Ensure you're using forward slashes or let Node.js handle path resolution
2. The `~` expansion works cross-platform in the preprocessor
3. Run `--self-test` to verify the preprocessor works on your system:
   ```bash
   node .claude/skills/story-miner/bin/story-preprocessor.cjs --self-test
   ```

## Acceptance Criteria

A successful story-miner run produces EXACTLY these files:

| File | Required | Created By | Mode |
|------|----------|------------|------|
| `preprocessed.json` | Yes | Preprocessor (Bash) | All |
| `.stories-cursor.json` | Yes | Preprocessor (Bash) | All |
| `candidates.jsonl` | Yes | Write tool | Default |
| `stories.jsonl` | Yes | Write tool | Default |
| `stories.md` | Yes | Write tool | Default |
| `digest.md` | Yes | Write tool | Default |
| `index.json` | Yes | Write tool | Default |
| `selftest-report.md` | Yes | Write tool | Self-test |
| `selftest-metrics.json` | Yes | Write tool | Self-test |
| `evolve-proposal.md` | Yes | Write tool | Evolve |
| `evolve-metrics.json` | Yes | Write tool | Evolve |
| `prompt-diff.patch` | Yes | Write tool | Evolve |

**Verification before commit:**

Unix/Git Bash:
```bash
# List files in output directory
ls .story-miner/

# Detect helper scripts (should print nothing)
ls .story-miner/*.cjs .story-miner/*.js .story-miner/*.mjs .story-miner/*.ts .story-miner/*.sh 2>/dev/null && echo "ERROR: Helper scripts found!" || echo "OK: No helper scripts"
```

PowerShell:
```powershell
# List files in output directory
Get-ChildItem .story-miner | Select-Object Name

# Detect helper scripts (should return nothing)
Get-ChildItem .story-miner\*.cjs,.story-miner\*.js,.story-miner\*.mjs,.story-miner\*.ts,.story-miner\*.sh -ErrorAction SilentlyContinue
```

If ANY other files (especially `.cjs`, `.js`, `.sh`, or `analyze-*` files) appear in the output directory, the run has violated the skill constraints and those files must be deleted.
