# Story-Miner Skill: Implementation Plan

> **Target location**: `docs/story-miner/IMPLEMENTATION_PLAN.md`
> **Scope**: Single PR, one skill addition
> **Mirrors**: `skills/lessons-extractor/` patterns

---

## 1. Overview

**Story-miner** is a Claude Code skill that mines local Claude Code session history (`~/.claude/projects/`) and produces publishable narrative stories about genuinely interesting techniques, bugs, fixes, and features discovered during development sessions.

**What it is NOT**: A generic "lessons learned" or "best practices" generator. Stories must have a non-obvious twist, root cause, or reusable pattern. Generic dev advice ("always write tests", "use logging") is explicitly rejected at the scoring stage via both banned-phrase matching and structural validation (stories must contain context + twist + fix + concrete nouns).

**Key differentiators from lessons-extractor**:
- Produces *narrative stories* with grounded, verbatim quotes (not just categorized lessons)
- Enforces quote provenance with verifiable pointers back to source material
- Extended secret redaction (17+ patterns vs 7)
- Story signal detection to surface only genuinely interesting content
- Cross-session deduplication of same-incident stories
- Deterministic eval runner (`eval/run-selftest.cjs`) decides PASS/FAIL — not Claude
- Self-test and evolve modes as first-class features

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| F1 | Preprocess Claude Code session logs with extended redaction and story-signal detection | Must |
| F2 | Score incidents (not sessions) for narrative value; reject generic advice; multiple candidates per session | Must |
| F3 | Extract verbatim quotes from preprocessed data with provenance pointers | Must |
| F4 | Deduplicate same-incident stories across sessions deterministically | Must |
| F5 | Produce all output artifacts (see Section 3) to a gitignored output directory | Must |
| F6 | Deterministic eval runner (`run-selftest.cjs`) with hard-gated eval suites | Must |
| F7 | Evolve mode proposing prompt/rubric improvements without silent edits | Must |
| F8 | Incremental processing via cursor state (skip unchanged sessions) | Must |
| F9 | Enforce thinking-block quote policy; stories must not claim insights without non-thinking evidence | Must |
| F10 | Output scanning: scan ALL output files in output dir, FAIL on findings (never silently fix) | Must |
| F11 | Configurable via `config.json` + `config.schema.json` | Must |
| F12 | Structural validation: promoted stories must have context + twist + fix + concrete nouns | Must |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|----|------------|
| NF1 | Deterministic story IDs across repeated runs on same input |
| NF2 | Cross-platform: Windows (CMD + PowerShell) + Unix/macOS |
| NF3 | Node.js >= 18 (match repo toolchain), zero external dependencies (stdlib only) |
| NF4 | Preprocessor: single `.cjs` file (forked from lessons-extractor) |
| NF5 | CI-friendly: fixtures are small JSON, self-test exits 0/1 |
| NF6 | Output files limited to declared set (no helper scripts, no temp files) |
| NF7 | All prompts are standalone markdown files in `prompts/` |
| NF8 | Output directory is gitignored; docs contain only static docs and fixtures |

---

## 3. Output File Schemas

### 3.0 Output Directory

**Default**: `.story-miner/` (relative to project root, gitignored)

This directory is for personal artifacts (not repo docs). **Do not commit; output dir is always gitignored.** Add to `.gitignore`:
```
.story-miner/
```

Overridable via:
- `--output <dir>` CLI flag (highest priority)
- `STORY_MINER_OUTPUT_DIR` environment variable
- `outputDir` in `config.json` (lowest priority)

### 3.1 `preprocessed.json` (Preprocessor output)

Canonical evidence source. All quotes must originate from this file. The preprocessor is focused on **sanitized evidence + pointers**; it does NOT compute dedupe clusters or aggregate signal summaries.

```
{
  "metadata": {
    "preprocessorVersion": string,  // semver
    "generatedAt": string,          // ISO 8601
    "runScope": "full"|"substantial"|"incremental",
    "logCount": number,
    "eventCount": number,
    "sampledEventCount": number
  },
  "sessions": [
    {
      "sessionId": string,            // UUID from filename
      "projectId": string,            // encoded project slug (e.g. "c--Users-REDACTED-Projects-toolkit")
      "sessionFile": string,          // filename only, no path (e.g. "abc123.jsonl")
      "firstTimestamp": string,       // ISO 8601
      "lastTimestamp": string,        // ISO 8601
      "taskPreview": string,          // first 200 chars of first user message
      "toolNames": string[],          // unique tool names used
      "kindsCount": {                 // event type counts
        "user": number,
        "assistant": number,
        "tool_call": number,
        "tool_result": number
      },
      "totalEvents": number,
      "sampledEventCount": number,
      "toolFailuresCount": number,
      "mode": "full"|"cached"|"fast",
      "events": [
        {
          "index": number,            // 0-based within session
          "kind": "user"|"assistant"|"tool_call"|"tool_result",
          "text": string,             // redacted content (truncated)
          "timestamp": string,        // ISO 8601
          "lineHash": string,         // 16-char hex (SHA-256 of line content, truncated)
          "toolName": string|null,    // for tool_call/tool_result
          "toolUseId": string|null,   // links call to result
          "exitCode": number|null,    // for tool_result
          "isError": boolean,         // true if tool failed
          "blockType": string,        // "text"|"thinking"|"tool_use"|"tool_result"
          "provenance": {             // quote grounding pointer
            "sessionId": string,
            "lineIndex": number,      // 0-based line in source JSONL
            "contentHash16": string   // SHA-256 of first 400 chars, truncated to 16 hex
          },
          "storySignals": string[]    // detected signals for this event (empty if none)
        }
      ],
      "transactions": [              // tool call <-> result pairs
        {
          "toolUseId": string,
          "toolName": string,
          "state": "completed"|"failed"|"orphaned"|"pending",
          "callEventIndex": number,
          "resultEventIndex": number|null,
          "isFailure": boolean,
          "detectionTier": "A"|"B"|"C"|null
        }
      ],
      "toolFailures": [
        {
          "eventIndex": number,
          "toolName": string,
          "toolUseId": string,
          "exitCode": number|null,
          "isError": boolean,
          "detectionTier": "A"|"B"|"C",
          "patternMatched": string,
          "inputSummary": string
        }
      ],
      "evidence": {
        "sampleStrategy": string,
        "contextWindow": number[],
        "resolutionWindow": number[],
        "errorWindows": number[],
        "importanceWindows": number[]
      }
    }
  ],
  "summary": {
    "totalSessions": number,
    "totalEvents": number,
    "totalSampledEvents": number,
    "totalToolFailures": number,
    "toolNameFrequency": { [name: string]: number }
  }
}
```

**Key changes from lessons-extractor**:
- `filePath` replaced with `projectId` + `sessionFile` (no machine-specific paths)
- `blockType` preserved on every event (for thinking-policy enforcement)
- `provenance` on every event (for quote grounding)
- `storySignals` as a flat string array per event (lightweight; regex detection in preprocessor)
- NO `dedupeClusters` in summary (clustering is downstream)
- NO aggregated signal counts in summary (computed downstream)

### 3.2 `.stories-cursor.json` (Incremental state)

Same schema as `.lessons-cursor.json` with `schemaVersion: 1`. Stored in output dir.

```
{
  "schemaVersion": 1,
  "lastRunAt": string,
  "lastMtimeCutoffMs": number,
  "recentFiles": string[],
  "index": {
    [encodedPath: string]: {
      "mtime": number,
      "mtimeMs": number,
      "size": number,
      "sessionId": string,
      "taskPreview": string,
      "toolNames": string[],
      "kindsCount": object,
      "hasToolFailures": boolean,
      "hasStorySignals": boolean,
      "estimatedEventCount": number
    }
  },
  "indexStats": {
    "entryCount": number,
    "lastPruneAt": string,
    "lastPruneReason": string
  }
}
```

### 3.3 `candidates.jsonl` (All candidates with scores)

One JSON object per line. **Candidates are per-incident, not per-session.** A session with multiple distinct story-worthy incidents produces multiple candidates (max 3 per session).

```
{
  "candidateId": string,            // "cand-" + SHA-256(sessionId + "|" + primaryEventIndex)[:12]
  "sessionId": string,
  "primaryEventIndex": number,      // the key signal event
  "eventIndices": number[],         // all evidence events for this incident
  "title": string,                  // short headline (< 80 chars)
  "synopsis": string,               // 1-2 sentence summary
  "score": number,                  // 0.0-1.0 narrative value
  "signals": string[],              // detected story signals
  "dedupeClusterId": string|null,   // assigned during dedupe (null initially)
  "status": "promoted"|"rejected"|"deduped",
  "rejectionReason": string|null,   // e.g. "generic_advice", "insufficient_signal", "missing_structure"
  "promoteReason": string|null,     // e.g. "non_obvious_root_cause", "subtle_interaction"
  "structuralCheck": {              // required structure validation
    "hasContext": boolean,
    "hasTwist": boolean,
    "hasFix": boolean,
    "concreteNounCount": number,    // file/function/error/tool names found
    "concreteNouns": string[],      // the actual nouns detected
    "pass": boolean                 // true if all structural requirements met
  },
  "evidencePointers": [
    {
      "sessionId": string,
      "lineIndex": number,
      "contentHash16": string,
      "quotePreview": string        // first 80 chars
    }
  ]
}
```

### 3.4 `stories.jsonl` (Promoted canonical stories)

One JSON object per line. Only promoted stories with curated quotes.

```
{
  "storyId": string,                // "story-" + SHA-256(clusterId||candidateId + "|" + primarySessionId)[:12]
  "title": string,                  // narrative headline
  "category": "bug"|"technique"|"pattern"|"architecture"|"tooling",
  "tags": string[],                 // freeform tags
  "synopsis": string,               // 2-3 sentence summary
  "narrative": string,              // full story (markdown, 200-800 words)
  "quotes": [
    {
      "text": string,               // verbatim quote (redacted)
      "attribution": string,        // "assistant" or "user" (NEVER "thinking")
      "provenance": {
        "sessionId": string,
        "lineIndex": number,
        "contentHash16": string,
        "pointer": string           // "{sessionId}/{lineIndex}#{contentHash16}"
      },
      "context": string             // 1-sentence context for the quote
    }
  ],
  "claims": [                       // grounded factual claims (deterministically verifiable)
    {
      "claim": string,              // the factual statement (1 sentence)
      "type": "root_cause"|"fix"|"technique"|"observation",
      "evidencePointers": [string]  // provenance pointer(s) backing this claim
    }
  ],
  "dedupeClusterId": string|null,
  "mergedFrom": string[],           // candidateIds merged into this story
  "score": number,
  "createdAt": string,              // ISO 8601
  "riskFlags": string[]             // safety concerns (empty = clean)
}
```

### 3.5 `stories.md` (Publish-ready narrative)

```markdown
# Story Mine: Development Stories

> Mined from Claude Code session history. Each story includes grounded quotes
> with provenance pointers back to source material.

Last updated: {date}

## Stories

### {title}

**Category:** {category} | **Score:** {score}

{narrative}

> "{quote.text}"
> -- {quote.attribution}, [{pointer}]

---

## Summary

- Stories published: {N}
- Candidates evaluated: {M}
- Sessions analyzed: {K}
- Dedupe clusters merged: {D}

## Sources

- Preprocessor: v{version}
- Session logs: {N} files from ~/.claude/projects/
```

### 3.6 `digest.md` (Rollup)

```markdown
# Story Mine Digest

> Quick summary of {N} stories from {date range}

| # | Title | Category | Score |
|---|-------|----------|-------|
| 1 | {title} | {category} | {score} |

## Top Insights

1. {one-line insight from story 1}
2. {one-line insight from story 2}
```

### 3.7 `index.json` (Quick filter index)

```
{
  "version": 1,
  "generatedAt": string,
  "stories": [
    {
      "storyId": string,
      "title": string,
      "category": string,
      "tags": string[],
      "score": number,
      "quoteCount": number,
      "createdAt": string
    }
  ],
  "categories": { [cat: string]: number },
  "tags": { [tag: string]: number }
}
```

### 3.8 Self-Test Outputs

**`selftest-report.md`** and **`selftest-metrics.json`** — produced by the deterministic eval runner (`eval/run-selftest.cjs`), not by Claude.

`selftest-metrics.json`:
```
{
  "timestamp": string,
  "preprocessorVersion": string,
  "evalRunnerVersion": string,
  "fixturesUsed": string[],
  "suites": {
    "schema_integrity": { "passed": N, "failed": N, "assertions": [...], "gate": "pass"|"fail" },
    "grounding_provenance": { ... },
    "safety_leak_scanning": { ... },
    "generic_advice_ban": { ... },
    "dedupe_correctness": { ... },
    "tool_coherence": { ... },
    "id_stability": { ... }
  },
  "metrics": {
    "pointerResolveRate": number,
    "hashVerificationRate": number,
    "quoteCoverageRate": number,
    "secretFindingCount": number,
    "bannedPhraseCount": number,
    "dedupeClusterPassRate": number,
    "toolCoherenceRate": number,
    "idStability": number
  },
  "overall": "pass"|"fail",
  "exitCode": 0|1
}
```

### 3.9 Evolve Outputs

**`evolve-proposal.md`**: Markdown describing proposed changes, baseline vs candidate metrics.
**`evolve-metrics.json`**: Before/after metric comparison for each candidate.
**`prompt-diff.patch`**: Unified diff of proposed prompt changes.

---

## 4. CLI Commands and Flags

### 4.1 Main Run: `/story-miner`

```
/story-miner [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--since <date>` | string | none | Filter logs by date (ISO or relative: 7d, 2w, 1m) |
| `--output <dir>` | string | `.story-miner/` | Output directory (gitignored) |
| `--full` | boolean | false | Process all logs, ignore cursor |
| `--clear` | boolean | false | Clear outputs before generating |
| `--max-stories <n>` | integer | 20 | Maximum stories to produce |
| `--verbose` | boolean | false | Enable debug output |

**Preprocessor CLI** (internal, invoked by SKILL.md):

```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs \
  [--since <date>] [--output-dir <dir>] [--full] [--clear] [--verbose] \
  [--self-test] [--scan-dir <dir>] [--dedupe] [--dry-run] [--help]
```

### 4.2 Self-Test: `/story-miner self-test`

```
/story-miner self-test
```

Workflow:
1. Run preprocessor `--self-test` (validates preprocessor internals)
2. Run full pipeline on fixtures (Claude generates candidates + stories)
3. Run deterministic eval runner: `node .claude/skills/story-miner/eval/run-selftest.cjs --output-dir <dir>`
4. Eval runner loads fixtures + pipeline outputs, validates all hard gates, emits `selftest-report.md` + `selftest-metrics.json`
5. Eval runner exits 0 (all pass) or 1 (any failure)

**Claude generates the narrative; the eval runner decides PASS/FAIL.**

### 4.3 Evolve: `/story-miner evolve`

```
/story-miner evolve
```

Runs baseline self-test, proposes 1-3 prompt/rubric edits, re-runs self-test per candidate, selects best. Outputs proposal artifacts only (never edits prompts silently).

---

## 5. Architecture

### 5.1 Pipeline Overview

```
Step 0: --clear handling (if requested)
    |
Step 1: Preprocessor (Node.js CLI)
    |   Discover -> Parse -> Normalize -> Redact -> Sample
    |   -> Signal-Detect -> Provenance -> Output
    |   Outputs: preprocessed.json, .stories-cursor.json
    |
Step 2: Read preprocessed data (Read tool)
    |   Check runScope (incremental -> skip)
    |
Step 3: Score candidates (Claude + score_candidates.md prompt)
    |   Read preprocessed.json -> identify incidents (multiple per session)
    |   -> score each incident -> structural validation
    |   Output: candidates.jsonl (Write tool)
    |
Step 3.5: Early scan (Node.js CLI)
    |   node story-preprocessor.cjs --scan-dir <outputDir>
    |   Catches leaks in candidates.jsonl early before more work is done
    |   FAILS (exit 1) if findings -- Claude must fix and re-scan
    |
Step 4: Deduplicate (Node.js CLI -- deterministic, NOT Claude)
    |   node story-preprocessor.cjs --dedupe --output-dir <outputDir>
    |   Reads candidates.jsonl + preprocessed.json
    |   Computes key-term fingerprints, clusters, primary selection
    |   Overwrites candidates.jsonl with status: promoted / deduped
    |   100% deterministic -- no LLM involvement
    |
Step 5: Write stories (Claude + write_story.md prompt)
    |   For each promoted candidate -> write narrative with grounded quotes
    |   Enforce: thinking policy, claims[] grounding, quote grounding
    |   Output: stories.jsonl (Write tool)
    |
Step 6: Output scan (Node.js CLI)
    |   node story-preprocessor.cjs --scan-dir <outputDir>
    |   Scans ALL files: candidates.jsonl, stories.jsonl, preprocessed.json
    |   DETECTS matches and FAILS (exit 1) -- never silently fixes
    |
Step 7: Render (Claude + render_outputs.md prompt)
    |   Generate: stories.md, digest.md, index.json
    |   Output: via Write tool
    |
Step 8: Final scan (repeat Step 6 on ALL rendered outputs)
```

### 5.2 Preprocessor (`bin/story-preprocessor.cjs`)

Forked from `lessons-extractor/bin/lessons-preprocessor.cjs`. The preprocessor stays focused on **sanitized evidence + pointers**. It does NOT compute dedupe clusters.

**Additions over lessons-extractor**:

| Addition | Description |
|----------|-------------|
| Extended redaction | 17+ patterns (see Section 7) |
| Story signal detection | Per-event regex detection, stored as `event.storySignals[]` |
| Provenance pointers | Each event gets `provenance: {sessionId, lineIndex, contentHash16}` |
| `blockType` field | Preserved on events for thinking-policy enforcement downstream |
| `--scan-dir` mode | Post-hoc scan of ALL output files; detects and fails (never fixes) |
| `--self-test` additions | New assertions for signal detection, provenance, redaction |
| Skip story-miner sessions | `skipMinerSessions: true` |
| `projectId` + `sessionFile` | Replace `filePath` with non-path identifiers |

**Key functions to add**:

| Function | Purpose |
|----------|---------|
| `detectStorySignals(eventText)` | Returns `string[]` of signal names for the event |
| `computeProvenance(sessionId, lineIndex, text)` | Returns `{sessionId, lineIndex, contentHash16}` |
| `computeContentHash16(text)` | SHA-256 of first 400 chars, truncated to 16 hex |
| `scanDirectory(dirPath, redactPatterns, bannedPhrases)` | Scans all JSON/JSONL/MD files; returns `{clean, findings[]}` |
| `extractKeyTerms(text)` | Extract function/file/error names from text |
| `buildDedupeClusters(candidates, preprocessed, config)` | Deterministic clustering: key-term fingerprinting + Union-Find |
| `runDedupeMode(outputDir, config)` | CLI entry point for `--dedupe` mode; reads/writes candidates.jsonl |

**Dedupe mode** (`--dedupe`): The preprocessor also serves as the deterministic dedupe engine. When invoked with `--dedupe --output-dir <dir>`, it:
1. Reads `candidates.jsonl` and `preprocessed.json` from the output dir
2. Extracts key terms, applies stopword filtering, computes fingerprints
3. Forms clusters via Union-Find, assigns cluster IDs, selects primaries
4. Overwrites `candidates.jsonl` with updated `status` and `dedupeClusterId` fields
5. This is 100% deterministic — no LLM involvement. The eval runner uses the same code path to verify correctness.

**Story signal patterns** (configurable via `config.json`):

```javascript
const STORY_SIGNAL_PATTERNS = [
  { pattern: /root cause/i,                          signal: "root_cause",          weight: 0.9 },
  { pattern: /the (issue|problem|bug) (is|was)/i,    signal: "root_cause",          weight: 0.85 },
  { pattern: /turns out/i,                            signal: "twist",              weight: 0.8 },
  { pattern: /the fix (is|was)/i,                     signal: "fix_description",    weight: 0.7 },
  { pattern: /subtle/i,                               signal: "subtle_interaction", weight: 0.75 },
  { pattern: /the reason/i,                            signal: "root_cause",         weight: 0.7 },
  { pattern: /key insight/i,                           signal: "insight",            weight: 0.8 },
  { pattern: /non-obvious/i,                           signal: "twist",             weight: 0.8 },
  { pattern: /interaction between/i,                   signal: "subtle_interaction", weight: 0.7 },
  { pattern: /edge case/i,                             signal: "edge_case",         weight: 0.65 },
  { pattern: /workaround/i,                            signal: "technique",         weight: 0.6 },
  { pattern: /I.ve confirmed/i,                        signal: "confirmation",      weight: 0.5 }
];
```

### 5.3 Eval Runner (`eval/run-selftest.cjs`)

**Deterministic Node.js script** that decides PASS/FAIL. Claude generates narrative; the eval runner validates it.

**Responsibilities**:
1. Load fixtures from `eval/fixtures/`
2. Load pipeline outputs from output dir (preprocessed.json, candidates.jsonl, stories.jsonl)
3. Run all eval suites (Section 8) with hard gates
4. Compute dedupe clusters deterministically (for dedupe correctness validation)
5. Verify pointer resolution, hash matching, quote substring matching
6. Scan all outputs for secret patterns and banned phrases
7. Check ID stability (run twice, compare)
8. Emit `selftest-report.md` + `selftest-metrics.json`
9. Exit 0 (pass) or 1 (fail)

**Key functions**:

| Function | Purpose |
|----------|---------|
| `loadFixtures(fixtureDir)` | Load and parse all fixture JSON files |
| `loadPipelineOutputs(outputDir)` | Load preprocessed.json, candidates.jsonl, stories.jsonl |
| `runSchemaIntegritySuite(outputs)` | Validate all output files parse, required fields present |
| `runGroundingProvenanceSuite(preprocessed, stories)` | Verify pointer resolution + hash match + substring match |
| `runSafetyLeakSuite(outputDir, redactPatterns)` | Scan ALL files for secret patterns |
| `runGenericAdviceBanSuite(candidates, stories, bannedPhrases)` | Check promoted stories for banned phrases + structural validation |
| `runDedupeCorrectnessSuite(candidates, fixtures)` | Verify cluster formation matches fixture annotations |
| `runToolCoherenceSuite(preprocessed, fixtures)` | Verify transaction pairing |
| `runIdStabilitySuite(outputDir)` | Compare IDs across two runs |
| `extractKeyTerms(text)` | Extract function/file/error names for dedupe verification |
| `buildDedupeClusters(candidates)` | Deterministic clustering for verification |
| `emitReport(results)` | Generate selftest-report.md + selftest-metrics.json |

### 5.4 Prompt Pipeline (`prompts/`)

**`prompts/score_candidates.md`** — Candidate scoring prompt

- Input: `preprocessed.json` sessions with per-event storySignals
- Task: For each session, identify distinct **incidents** (max 3 per session)
- Each incident becomes a separate candidate centered on its signal event(s)
- Score each incident on 0.0-1.0 scale for narrative value
- Apply structural validation: reject if missing (context + twist/root-cause + fix/resolution)
- Reject if fewer than 2 concrete nouns (file/function/error/tool names)
- Must explain rejection/promotion reason
- Output format: One candidate object per incident (candidates.jsonl shape)

**`prompts/write_story.md`** — Story writing prompt

- Input: A promoted candidate + its evidence events from preprocessed.json
- Task: Write a narrative story (200-800 words) with at least one grounded quote
- Rules:
  - Quotes must come from `preprocessed.json` events only
  - Each quote must include its `provenance.pointer` string
  - NEVER quote from events where `blockType === "thinking"`
  - NEVER present insights as factual claims unless backed by a quote from non-thinking evidence
  - NEVER use banned phrases in the narrative
  - Include the twist/root-cause/technique that makes the story interesting
  - Must produce a `claims[]` array with >= 1 `root_cause` claim and >= 1 `fix` claim, each with evidence pointers
- Output format: stories.jsonl object shape

**`prompts/render_outputs.md`** — Rendering prompt

- Input: All promoted stories from stories.jsonl
- Task: Generate stories.md, digest.md, index.json
- Rules: Follow exact templates from Section 3.5-3.7

### 5.5 SKILL.md Structure

```yaml
---
name: story-miner
description: Mines Claude Code session history for publishable development stories
argument-hint: "[self-test|evolve] [--since <date>] [--output <dir>] [--full] [--clear]"
---
```

Body follows the 8-step workflow pattern, with branching for `self-test` and `evolve` subcommands parsed from `$ARGUMENTS`.

---

## 6. Dedupe + Stable IDs

### 6.1 Dedupe Algorithm v1 (Rare Key-Term Fingerprinting)

**Goal**: Group candidates across sessions that discuss the same incident into dedupe clusters. Deterministic and reproducible.

**Where it runs**:
- **Production (Step 4)**: Runs in Node.js via `story-preprocessor.cjs --dedupe --output-dir <dir>`. 100% deterministic, no LLM involvement.
- **Self-test**: The eval runner (`run-selftest.cjs`) uses the same `buildDedupeClusters()` function to verify correctness.

**Steps**:

1. **Candidate selection**: Only candidates with `status !== "rejected"` are dedupe-eligible.

2. **Term source collection** per candidate:
   - Collect text from: candidate `title` + `synopsis` + text of all events at `eventIndices`
   - From combined text, extract key terms:
     - Function/method names: regex `\b([a-zA-Z_]\w+)\s*\(` (capture group 1)
     - File paths: regex `\b[\w./\\-]+\.(js|ts|py|sh|json|md|cjs|mjs)\b`
     - Error class names: regex `\b([A-Z][a-zA-Z]+Error)\b`
     - Tool names from evidence events' `toolName` fields
   - Normalize: lowercase all terms, sort, deduplicate

3. **Stopword filtering** (prevent false merges on common terms):
   - Remove high-frequency terms that appear in > 30% of all candidates in the current run
   - Also remove a hardcoded stoplist: `config`, `json`, `file`, `test`, `error`, `function`, `module`, `index`, `src`, `node`, `import`, `export`, `const`, `let`, `var`
   - Remaining terms are "rare terms"

4. **Fingerprint computation**:
   - Canonical string = sorted rare terms joined by `|`
   - If fewer than 2 rare terms remain, the candidate is not dedupe-eligible (too generic to cluster)
   - Fingerprint = SHA-256(canonical string), truncated to 16 hex chars

5. **Cluster formation**:
   - Two candidates are in the same cluster if they share >= 3 rare terms
   - Use Union-Find to merge overlapping pairs into connected clusters

6. **Cluster ID**:
   - Sort all candidate fingerprints in the cluster
   - Cluster ID = SHA-256(sorted fingerprints joined by `|`), truncated to 16 hex chars
   - Deterministic: same candidates always produce the same cluster ID

7. **Primary candidate selection** (within a cluster):
   - The candidate with the earliest `firstTimestamp` (from its session) is primary
   - If tied, the candidate with the higher `score` wins
   - Non-primary candidates get `status: "deduped"`

### 6.2 Stable Story IDs

**StoryId computation**:
```
Input: clusterId (or candidateId if no cluster), primarySessionId
storyId = "story-" + SHA-256(clusterId + "|" + primarySessionId)[:12]
```

**CandidateId computation**:
```
Input: sessionId, primaryEventIndex (the key signal event index)
candidateId = "cand-" + SHA-256(sessionId + "|" + String(primaryEventIndex))[:12]
```

**Properties**:
- Deterministic: same content always produces same ID
- Stable across reruns: depends only on content and event indices, not run timestamp
- Collision-resistant: 12 hex chars = 48 bits, sufficient for small corpora

### 6.3 Fixture Verification

Fixture 2 includes `_dedupeCluster: "extractText-array-content-bug"` on events in sessions `ddd444` and `eee555`.

Term extraction:
- ddd444 event 6: `extracttext`, `applyredaction`, `raw.content`, `raw.message.content`, `coercion` → rare terms (after stopword removal): `extracttext`, `applyredaction`, `coercion`
- eee555 event 1: `extracttext`, `applyredaction`, `content blocks`, `arrays` → rare terms: `extracttext`, `applyredaction`

Overlap: >= 3 shared rare terms (including from candidate title/synopsis which will reference `extractText`). They cluster together.

Eval verifies: cluster contains exactly sessions `[ddd444, eee555]`, merged into one story.

### 6.4 Known Failure Modes + Mitigations

| Failure Mode | Mitigation |
|-------------|------------|
| False merge: unrelated incidents sharing common tool names | Stopword filtering removes high-frequency terms; >= 3 rare term threshold |
| False split: same incident described with different vocabulary | v1 accepts this; evolve mode can tune thresholds; future: embedding-based |
| Very short events with few extractable terms | Events with < 2 rare terms are not dedupe-eligible |

---

## 7. Safety Model

### 7.1 Redaction (Defense Layer 1: Preprocessor)

All text passes through redaction before being stored in `preprocessed.json`.

| # | Pattern | Target | Source |
|---|---------|--------|--------|
| 1 | `api[_-]?key["']?\s*[:=]\s*["']?[\w-]+` | API key assignments | lessons-extractor |
| 2 | `password["']?\s*[:=]\s*["']?[^\s"']+` | Password assignments | lessons-extractor |
| 3 | `secret["']?\s*[:=]\s*["']?[\w-]+` | Secret assignments | lessons-extractor |
| 4 | `token["']?\s*[:=]\s*["']?[\w-]+` | Token assignments | lessons-extractor |
| 5 | `/Users/[^/]+/` | macOS home dirs | lessons-extractor |
| 6 | `/home/[^/]+/` | Linux home dirs | lessons-extractor |
| 7 | `C:\\Users\\[^\\]+\\` | Windows home dirs | lessons-extractor |
| 8 | `ghp_[A-Za-z0-9_]{36,}` | GitHub PATs | NEW |
| 9 | `glpat-[A-Za-z0-9_-]{20,}` | GitLab PATs | NEW |
| 10 | `xoxb-[A-Za-z0-9-]+` | Slack bot tokens | NEW |
| 11 | `sk-[A-Za-z0-9]{20,}` | OpenAI/Anthropic API keys | NEW |
| 12 | `eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}` | JWT tokens | NEW |
| 13 | `-----BEGIN\s+(RSA\s+)?(PRIVATE\|PUBLIC)\s+KEY-----` | PEM blocks | NEW |
| 14 | `AKIA[A-Z0-9]{16}` | AWS access keys | NEW |
| 15 | `Authorization:\s*(Bearer\s+)?[^\n]{10,}` | Auth headers | NEW |
| 16 | `Cookie:\s*[^\n]{20,}` | Cookie headers | NEW |
| 17 | `(mongodb\|postgres\|mysql\|redis)://[^\s"']+` | Connection strings | NEW |

**Long-hex handling** (pattern 18):
- Pattern: `[0-9a-f]{64}` (64+ hex chars only)
- Git SHAs (exactly 40 hex) are NOT matched
- Configurable via `redactPatterns` in `config.json`

**Replacement**: All matches replaced with `[REDACTED]`. Original text is never stored.

### 7.2 Output Scanning (Defense Layer 2: Post-Pipeline)

```bash
node .claude/skills/story-miner/bin/story-preprocessor.cjs --scan-dir <outputDir>
```

The scanner:
1. Enumerates ALL files in the output directory: `preprocessed.json`, `candidates.jsonl`, `stories.jsonl`, `stories.md`, `digest.md`, `index.json`
2. For each file, reads all string content
3. **Detects** matches of all redaction patterns — does NOT apply redaction or fix anything
4. Also detects: `blockType: "thinking"` in quote attributions, banned phrases in promoted story text
5. Returns JSON result: `{clean: true/false, findings: [{file, field, pattern, matchPreview, severity}]}`
6. **Exits 1 if any `"error"` severity findings** — the pipeline halts, findings are logged, Claude must fix and re-scan

**Severity levels for scanner rules:**

| Severity | Patterns | Action |
|----------|----------|--------|
| `error` (hard-fail) | GitHub PATs (`ghp_`), GitLab PATs (`glpat-`), API keys (`sk-`), AWS keys (`AKIA`), JWTs (`eyJ`), PEM blocks, connection strings, non-redacted `Authorization: Bearer <payload>` | Exit 1, halt pipeline |
| `error` (hard-fail) | `blockType: "thinking"` in quote attribution, banned phrases in promoted stories | Exit 1, halt pipeline |
| `warn` | Long hex (64+ chars) that is not `[REDACTED]` and not allowlisted | Logged in findings, does NOT cause exit 1 |
| `warn` | Generic `token`/`password`/`secret` assignment patterns if payload is `[REDACTED]` | Logged but not a failure (redaction already applied) |

This is a **detect-and-fail** scanner for errors, **detect-and-warn** for lower severity. Never a **fix-and-continue** scanner.

### 7.3 Thinking Block Policy (Defense Layer 3: Prompt + Eval)

**Default policy**: `"internal_only"`

- `thinking` blocks MAY be used internally by Claude during story writing (to understand context)
- `thinking` blocks MUST NOT appear as quotes in any output
- Stories MUST NOT present insights as factual claims ("I realized X because...") unless backed by a quote from **non-thinking** evidence
- The `write_story.md` prompt explicitly enforces both rules
- The output scanner checks `quote.attribution !== "thinking"` (hard gate)
- The eval runner verifies no thinking-block quotes in output
- Each story must include a `claims[]` array with explicitly grounded pointers (see Section 3.4)
- The eval runner verifies every `claims[].evidencePointers` resolves to a non-thinking event
- The eval runner verifies each promoted story has >= 1 `root_cause` claim AND >= 1 `fix` claim

### 7.4 Risk Flags

Stories carry `riskFlags: string[]`:

| Flag | Meaning |
|------|---------|
| `"redaction_applied"` | At least one redaction pattern matched in source material |
| `"long_hex_present"` | Long hex strings found (may be false positive) |
| `"thinking_used_internally"` | Thinking blocks were read during story construction |
| `"manual_review_recommended"` | Scanner found borderline content |

---

## 8. Evals (Self-Test)

### 8.1 Architecture: Deterministic Eval Runner

The eval runner is `eval/run-selftest.cjs` — a standalone Node.js script. Claude generates narrative artifacts; the **eval runner alone decides PASS/FAIL**.

```bash
node .claude/skills/story-miner/eval/run-selftest.cjs \
  --fixtures-dir eval/fixtures/ \
  --output-dir .story-miner/ \
  --preprocessed preprocessed.json \
  --candidates candidates.jsonl \
  --stories stories.jsonl
```

Exit codes: 0 = all suites pass, 1 = any failure.

### 8.2 Eval Suites

| Suite | Fixture(s) | Gate Type | Description |
|-------|-----------|-----------|-------------|
| Schema/Integrity | 1, 2 | Hard | All output files parse, required fields present, types correct |
| Grounding/Provenance | 1, 2 | Hard | Every quote pointer resolves, hash matches, text is substring of evidence |
| Safety/Leak Scanning | 1 | Hard | Zero secret patterns in ANY output file |
| Generic Advice Ban | 1 | Hard | Zero banned phrases in promoted stories; structural validation pass; bbb222 rejected |
| Dedupe Correctness | 2 | Hard | Cluster containing ddd444+eee555 formed; single story produced |
| Tool Coherence | 2 | Hard | All transactions in ddd444 correctly paired (4 completed, 1 failed) |
| ID Stability | 1, 2 | Hard | Running pipeline twice on same input produces identical IDs |

### 8.3 Hard Gates and Thresholds

| Metric | Threshold | Description |
|--------|-----------|-------------|
| `pointerResolveRate` | = 1.0 | All quote pointers resolve to preprocessed.json events |
| `hashVerificationRate` | = 1.0 | All contentHash16 match recomputed hash from event text |
| `quoteCoverageRate` | >= 0.95 | Fraction of promoted stories with >= 1 grounded quote |
| `secretFindingCount` | = 0 | Zero secret patterns in all output files combined |
| `bannedPhraseCount` (promoted) | = 0 | Zero banned phrases in promoted story narrative/synopsis |
| `structuralPassRate` (promoted) | = 1.0 | All promoted stories pass structural validation |
| `claimsGroundedRate` | = 1.0 | Every `claims[].evidencePointers` resolves to a non-thinking event |
| `claimsCoverageRate` | = 1.0 | Every promoted story has >= 1 root_cause claim AND >= 1 fix claim |
| `dedupeClusterPassRate` | = 1.0 | All fixture-annotated clusters correctly formed |
| `toolCoherenceRate` | = 1.0 | All tool transactions correctly paired (call <-> result) |
| `idStability` | = 1.0 | Story/candidate IDs identical across 2 consecutive runs |

### 8.4 Fixture Mapping

**Fixture 1 (`local-sample-fixture-1.json`)** — 3 sessions, 42 events:

| Assertion | Session | Expected Outcome |
|-----------|---------|------------------|
| Story signal detected | aaa111 event 4 | `storySignals` includes `"root_cause"` |
| Incident promoted | aaa111 | At least 1 candidate with `status: "promoted"` |
| Quote with valid provenance | aaa111 | stories.jsonl entry has >= 1 quote, pointer resolves, hash matches |
| Generic session rejected | bbb222 | All candidates from bbb222 have `status: "rejected"` |
| Structural validation | bbb222 | `structuralCheck.pass === false` (no twist, no concrete nouns) |
| Secret redacted | ccc333 | `sk-FIXTURE-*` and `Authorization: Bearer` not in any output file |

**Fixture 2 (`local-sample-fixture-2.json`)** — 2 sessions, 38 events:

| Assertion | Session | Expected Outcome |
|-----------|---------|------------------|
| Dedupe cluster formed | ddd444 + eee555 | Same cluster ID, merged into single story |
| Tool transactions paired | ddd444 | 5 transactions: 4 completed, 1 failed |
| Failed transaction | ddd444 | `toolu_fixture_012` marked `isFailure: true` |
| ID stability | all | Two runs produce identical IDs |
| Primary session | ddd444 | Earlier timestamp selected as primary |

### 8.5 Banned Phrases + Structural Validation

**Banned phrases** (case-insensitive substring match):

```javascript
const BANNED_PHRASES = [
  "always write tests", "best practice", "make sure to", "don't forget to",
  "it's important to", "always remember", "be careful", "consider using",
  "you should always", "pro tip", "helpful tip", "keep in mind",
  "general rule of thumb"
];
```

**Structural validation** (deterministic, applied to all promoted stories):

A promoted story must have ALL of:
1. **Context**: The narrative references a specific situation/task (detected: presence of file/function/tool names)
2. **Twist or root cause**: The narrative contains a non-obvious discovery (detected: >= 1 story signal in evidence events)
3. **Fix or resolution**: The narrative describes what was done. Satisfied if EITHER:
   - Evidence events include a tool_call after the signal event, OR
   - Assistant text contains fix markers (`fixed`, `resolved`, `changed`, `inlined`, `removed`, `added`, `updated`, `replaced`, `patched`) AND contains >= 1 concrete noun
4. **Concrete nouns**: >= 2 concrete nouns (function names, file paths, error classes, tool names) in the story narrative

Stories failing structural validation are rejected with `rejectionReason: "missing_structure"`, `structuralCheck.pass: false`.

---

## 9. File-by-File Change List

### 9.1 New Files

| # | File Path | Purpose |
|---|-----------|---------|
| 1 | `skills/story-miner/SKILL.md` | Skill definition: YAML frontmatter + 8-step workflow + self-test + evolve branching |
| 2 | `skills/story-miner/config.json` | Default config: extended redaction, signal patterns, thresholds, output dir |
| 3 | `skills/story-miner/config.schema.json` | JSON Schema Draft 7 validation for config.json |
| 4 | `skills/story-miner/bin/story-preprocessor.cjs` | Node.js preprocessor (forked from lessons-preprocessor.cjs, evidence-focused) |
| 5 | `skills/story-miner/bin/story-preprocessor` | POSIX shell wrapper |
| 6 | `skills/story-miner/bin/story-preprocessor.cmd` | Windows batch wrapper |
| 7 | `skills/story-miner/prompts/score_candidates.md` | Prompt: identify incidents, score for narrative value, structural validation |
| 8 | `skills/story-miner/prompts/write_story.md` | Prompt: write narrative with grounded quotes, thinking policy, evidence-backed claims |
| 9 | `skills/story-miner/prompts/render_outputs.md` | Prompt: generate stories.md, digest.md, index.json |
| 10 | `skills/story-miner/eval/run-selftest.cjs` | **Deterministic eval runner**: loads fixtures + outputs, validates hard gates, emits report |
| 11 | `skills/story-miner/eval/fixtures/local-sample-fixture-1.json` | Already exists |
| 12 | `skills/story-miner/eval/fixtures/local-sample-fixture-2.json` | Already exists |
| 13 | `skills/story-miner/eval/fixtures/README.md` | Already exists |
| 14 | `skills/story-miner/examples/sample-input.md` | Example preprocessed.json excerpt |
| 15 | `skills/story-miner/examples/sample-output.md` | Example stories.md excerpt |
| 16 | `docs/story-miner/IMPLEMENTATION_PLAN.md` | This plan document |

### 9.2 Modified Files

| # | File Path | Change |
|---|-----------|--------|
| 1 | `skills/README.md` | Add story-miner to "Available Skills" table |
| 2 | `docs/reference/repo-layout.md` | Add story-miner directory structure |
| 3 | `.gitignore` | Add `.story-miner/` entry |

### 9.3 Files NOT Modified

- `skills/lessons-extractor/*` — story-miner forks, does not modify original
- `.claude/settings.local.json` — no new permissions needed
- `tools/skills-sync.js` — already handles any skill directory generically

---

## 10. Step-by-Step Implementation Plan

### Phase A: Foundation (Preprocessor)

- [ ] **A1. Fork preprocessor**
  - Copy `skills/lessons-extractor/bin/lessons-preprocessor.cjs` -> `skills/story-miner/bin/story-preprocessor.cjs`
  - Update version string to `1.0.0`, update Node version check to `>= 18`
  - Update skill-name references: session skip detection (`skipMinerSessions`), output names
  - Change cursor filename to `.stories-cursor.json`
  - Replace `filePath` output with `projectId` + `sessionFile` (no full paths)
  - Remove any lessons-extractor-specific logic that doesn't apply
  - **Verify**: `node skills/story-miner/bin/story-preprocessor.cjs --help` prints usage

- [ ] **A2. Add extended redaction patterns**
  - Add patterns 8-17 from Section 7.1 to default config
  - Add long-hex conditional handling (pattern 18: >= 64 chars, skip exactly 40)
  - **Verify**: Preprocessor self-test assertions for new patterns pass

- [ ] **A3. Add story signal detection**
  - Implement `detectStorySignals(eventText)` — returns `string[]` of signal names
  - Wire into event normalization: populate `event.storySignals` per event
  - Store as flat array on each event (not a separate session-level structure)
  - Add configurable patterns to config.json under `storyMiner.storySignalPatterns`
  - **Verify**: Fixture 1 aaa111 event 4 gets `["root_cause", "subtle_interaction"]`

- [ ] **A4. Add provenance pointers**
  - Implement `computeContentHash16(text)` using `crypto.createHash('sha256')`
  - Implement `computeProvenance(sessionId, lineIndex, text)` returning pointer object
  - Add `provenance` field to each normalized event
  - Preserve `blockType` field on events (`text`/`thinking`/`tool_use`/`tool_result`)
  - **Verify**: Provenance pointers on fixture events have deterministic hashes across runs

- [ ] **A5. Add output scanner (`--scan-dir`) mode**
  - Implement `scanDirectory(dirPath, redactPatterns, bannedPhrases)` function
  - Scans ALL files in dir: `.json`, `.jsonl`, `.md` extensions
  - For each file, reads content and checks all redaction patterns
  - Also checks: thinking attribution in quotes, banned phrases in promoted stories
  - **DETECTS matches and FAILS (exit 1)** — never silently fixes
  - Returns JSON `{clean, findings[{file, field, pattern, matchPreview}]}` to stdout
  - **Verify**: Scanner detects `sk-FIXTURE-*` in a test file, exits 1

- [ ] **A6. Add dedupe mode (`--dedupe`)**
  - Implement `extractKeyTerms(text)` for function names, file paths, error classes
  - Implement `buildDedupeClusters(candidates, preprocessed, config)` with Union-Find
  - Implement `runDedupeMode(outputDir, config)`: reads candidates.jsonl + preprocessed.json, computes clusters, overwrites candidates.jsonl
  - Wire to `--dedupe --output-dir <dir>` CLI flag
  - 100% deterministic, no LLM involvement
  - **Verify**: Running on fixture 2 candidates produces correct cluster (ddd444 + eee555)

- [ ] **A7. Add self-test assertions**
  - Add test cases for: signal detection, provenance hash determinism, extended redaction, blockType preservation, dedupe clustering
  - Wire fixtures from `eval/fixtures/` into `--self-test` mode
  - **Verify**: `node story-preprocessor.cjs --self-test` passes all assertions

- [ ] **A8. Create shell wrappers**
  - `bin/story-preprocessor` (POSIX, mirror `lessons-preprocessor`)
  - `bin/story-preprocessor.cmd` (Windows, mirror `lessons-preprocessor.cmd`)
  - **Verify**: Both wrappers invoke the .cjs correctly

### Phase B: Eval Runner

- [ ] **B1. Create eval/run-selftest.cjs**
  - Standalone Node.js script (>= 18, stdlib only)
  - CLI: `--fixtures-dir`, `--output-dir`, `--preprocessed`, `--candidates`, `--stories`
  - Loads fixtures, loads pipeline outputs
  - Implements all 7 eval suites from Section 8.2
  - Implements key-term extraction + dedupe cluster computation for verification
  - Implements structural validation checks
  - Implements ID stability check (compares two run results)
  - Emits `selftest-report.md` + `selftest-metrics.json`
  - Exits 0 (all pass) or 1 (any fail)
  - **Verify**: Running on hand-crafted test outputs produces correct pass/fail

### Phase C: Configuration

- [ ] **C1. Create config.json**
  - Mirror lessons-extractor structure for preprocessor settings
  - Add `storyMiner` section:
    - `maxStoriesPerRun`: 20
    - `maxCandidatesPerSession`: 3
    - `maxQuotesPerStory`: 5
    - `maxQuoteLength`: 300
    - `thinkingBlockPolicy`: "internal_only"
    - `bannedPhrases`: [...list from Section 8.5...]
    - `storySignalPatterns`: [...serialized pattern list...]
    - `structuralValidation.minConcreteNouns`: 2
    - `dedupe.minRareTermOverlap`: 3
    - `dedupe.stoplist`: [...common terms...]
    - `dedupe.maxFrequencyPct`: 30
  - Set `outputDir` default to `.story-miner`
  - **Verify**: JSON parses correctly

- [ ] **C2. Create config.schema.json**
  - JSON Schema Draft 7
  - Cover all config.json fields
  - **Verify**: Config validates against schema

### Phase D: Prompts

- [ ] **D1. Write score_candidates.md**
  - Per-incident scoring (not per-session): identify distinct incidents, max 3 per session
  - Scoring rubric: signal strength, narrative twist, non-obviousness
  - Structural validation rules: context + twist + fix + >= 2 concrete nouns
  - Rejection criteria: generic advice, insufficient signal, missing structure
  - Banned phrase list reference
  - **Verify**: Prompt is self-contained

- [ ] **D2. Write write_story.md**
  - Quote grounding rules (must come from preprocessed.json, must include provenance pointer)
  - Thinking block policy: never quote thinking; never claim insights without non-thinking evidence
  - Narrative structure: hook, context, twist/root-cause, resolution, takeaway
  - Length: 200-800 words
  - **Verify**: Prompt is self-contained

- [ ] **D3. Write render_outputs.md**
  - Templates for stories.md, digest.md, index.json
  - Field mappings from stories.jsonl
  - **Verify**: Prompt is self-contained

### Phase E: SKILL.md

- [ ] **E1. Write SKILL.md**
  - YAML frontmatter: name, description, argument-hint
  - Workflow steps 0-8 with preprocessor + eval runner invocation commands
  - `self-test` branch: run preprocessor --self-test, run pipeline on fixtures, run eval runner, report
  - `evolve` branch: baseline self-test, propose edits, re-test, select best, output proposal
  - Prohibited actions section (mirror lessons-extractor)
  - Allowed output files list
  - Troubleshooting section
  - **Verify**: SKILL.md follows lessons-extractor patterns

### Phase F: Examples

- [ ] **F1. Create sample-input.md**
  - Small preprocessed.json excerpt with 1 session, story signals, provenance
  - **Verify**: Valid JSON in code block

- [ ] **F2. Create sample-output.md**
  - Example stories.md, stories.jsonl, candidates.jsonl excerpts
  - **Verify**: Shows expected format

### Phase G: Evolve Mode

- [ ] **G1. Implement evolve workflow in SKILL.md**
  - Step 1: Run baseline self-test via eval runner, capture metrics
  - Step 2: Claude proposes 1-3 small prompt/rubric edits as candidate variants
  - Step 3: For each candidate variant:
    - Write variant prompt files to `<outputDir>/_evolve/candidate-N/prompts/` (temp folder inside gitignored output dir)
    - Re-run pipeline pointing to variant prompt folder (SKILL.md passes `--prompts-dir` override to Claude's prompt reads)
    - Run eval runner on variant outputs in `<outputDir>/_evolve/candidate-N/`
  - Step 4: Select best candidate (improves quality metrics, no safety regression)
  - Step 5: Generate `prompt-diff.patch` by diffing variant prompts against repo prompts (`diff -u`)
  - Step 6: Output evolve-proposal.md, evolve-metrics.json, prompt-diff.patch to output dir
  - Never silently edit prompt files in the skill directory
  - **Verify**: Evolve mode produces proposal artifacts; variant files stay in `_evolve/` (gitignored)

### Phase H: Docs + Integration

- [ ] **H1. Update skills/README.md**
  - Add story-miner row to Available Skills table

- [ ] **H2. Update docs/reference/repo-layout.md**
  - Add story-miner directory structure

- [ ] **H3. Update .gitignore**
  - Add `.story-miner/` entry

- [ ] **H4. Copy this plan to docs/story-miner/IMPLEMENTATION_PLAN.md**

### Phase I: Validation

- [ ] **I1. Run preprocessor self-test**
  - `node skills/story-miner/bin/story-preprocessor.cjs --self-test`
  - **Gate**: Zero failures

- [ ] **I2. Run full pipeline on fixtures (fixture 1)**
  - Invoke SKILL.md workflow on fixture 1 data
  - Verify: aaa111 incident promoted, bbb222 rejected, ccc333 secrets redacted
  - Verify: provenance pointers resolve, structural validation passes on promoted
  - **Gate**: All eval assertions pass

- [ ] **I3. Run full pipeline on fixtures (fixture 2)**
  - Verify: dedupe cluster formed (ddd444 + eee555 -> 1 story)
  - Verify: tool transactions paired correctly
  - **Gate**: All eval assertions pass

- [ ] **I4. Run eval runner for ID stability**
  - Run pipeline twice on same input, eval runner compares IDs
  - **Gate**: `idStability = 1.0`

- [ ] **I5. Run output scanner on all outputs**
  - `node story-preprocessor.cjs --scan-dir .story-miner/`
  - **Gate**: `clean: true`, exit 0

- [ ] **I6. Run lint check**
  - `./tools/lint-skills.sh skills/story-miner`
  - **Gate**: No PowerShell variable pattern violations

- [ ] **I7. Final file inventory**
  - Verify exactly the files listed in Section 9.1 exist
  - Verify `.story-miner/` is gitignored
  - Verify no extra files created
  - **Gate**: Clean `git status` (except planned new files)

---

## 11. Open Questions / Future Enhancements

### Open Questions (v1 decisions made, documented for reconsideration)

| # | Question | v1 Decision | Rationale |
|---|----------|-------------|-----------|
| 1 | Sub-agent logs (`subagents/agent-*.jsonl`) | Skip | Sub-agent context is fragmented. Revisit if signal density is low. |
| 2 | Tool-result overflow files (`tool-results/toolu_*.txt`) | Skip | Stories use summarized event text, not full output. |
| 3 | Cross-project deduplication | Process all projects, no cross-project dedupe | All discovered projects are processed by default (matching lessons-extractor). Dedupe operates within a single run's candidates. |
| 4 | Progress events | Skip | Streaming data is noise for story mining. |
| 5 | File-history-snapshot events | Skip | Code diffs add complexity. Future enhancement. |
| 6 | ML-based story signal scoring | Regex only | 12 patterns found 3 candidates in 5 sessions. Sufficient for v1. |

### Future Enhancements

| # | Enhancement | Trigger |
|---|------------|---------|
| 1 | Embedding-based dedupe (replace key-term fingerprinting) | When key-term approach produces false negatives |
| 2 | Thinking block labeled-quote mode (`thinkingBlockPolicy: "labeled"`) | User request + config gate |
| 3 | Cross-project dedupe | User request for global stories |
| 4 | Code diff integration via file-history-snapshot | When stories need "before/after" context |
| 5 | GitHub issue/PR linking | When stories should reference published PRs |
| 6 | RSS/Atom feed output | When stories need a subscription format |
| 7 | Story versioning (update existing stories with new evidence) | When incremental runs should enrich, not just append |
| 8 | Interactive story review mode | When users want to approve/reject before publish |
| 9 | `--project <slug>` filter flag | When users want single-project runs |
| 10 | IDF-weighted term scoring for smarter dedupe | When false merges become a problem |
