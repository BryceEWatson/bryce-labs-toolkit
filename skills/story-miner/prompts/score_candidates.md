# Score Candidates for Narrative Value

You are analyzing preprocessed Claude Code session data to identify and score potential development stories.

## Input Format

You will receive `preprocessed.json` containing sessions with per-event `storySignals`. Each event has:

```json
{
  "lineIndex": N,
  "timestamp": "ISO-8601",
  "blockType": "text"|"tool_use"|"tool_result"|"thinking",
  "role": "user"|"assistant",
  "storySignals": ["root_cause", "aha_moment", ...],
  "redactedContent": "...",
  "toolName": "...",
  "provenance": {
    "sessionId": "...",
    "lineIndex": N,
    "contentHash16": "...",
    "pointer": "{sessionId}/{lineIndex}#{contentHash16}"
  }
}
```

## Task

For each session, identify distinct **incidents** (max 3 per session). Each incident becomes a separate candidate centered on its signal event(s).

### Incident Definition

An incident is a cohesive narrative unit containing:
- **Primary event**: The event with the strongest story signal (root cause, aha moment, subtle bug, etc.)
- **Supporting events**: Surrounding events that provide context, evidence, and resolution
- **Event window**: Typically 5-20 events centered on the primary event

### Scoring Criteria (0.0-1.0 scale)

Score each incident for narrative value based on:

1. **Signal Strength** (0.4 weight)
   - Multiple distinct signals present
   - Root cause or non-obvious discovery
   - Specific technique or pattern revealed

2. **Structural Completeness** (0.4 weight)
   - Clear context (specific situation/task)
   - Twist or discovery (non-obvious insight)
   - Resolution or fix (concrete action taken)
   - Sufficient concrete nouns (function names, files, tools)

3. **Teaching Value** (0.2 weight)
   - Transferable insight
   - Non-obvious technique
   - Subtle interaction revealed

### Structural Validation

Each candidate MUST pass structural checks:

**Required Elements:**

1. **Context** (hasContext: true/false)
   - References specific situation or task
   - Contains file names, function names, or tool names
   - NOT generic advice or general discussion

2. **Twist or Root Cause** (hasTwist: true/false)
   - Contains non-obvious discovery
   - At least 1 story signal in evidence events
   - Signal types: root_cause, aha_moment, subtle_bug, unexpected_interaction, counterintuitive_fix

3. **Fix or Resolution** (hasFix: true/false)
   - Evidence events include a tool_call AFTER the signal event, OR
   - Assistant text contains fix markers (fixed, resolved, changed, inlined, removed, added, updated, replaced, patched) PLUS at least 1 concrete noun

4. **Concrete Nouns** (concreteNounCount >= 2)
   - Function names (camelCase, snake_case identifiers)
   - File paths (contains `/` or `\` or file extension)
   - Error classes (PascalCase ending in Error/Exception)
   - Tool names (Read, Write, Edit, Bash, etc.)
   - Variable/parameter names in code context
   - NOT generic terms (file, function, variable, code, bug, error, issue)

**Validation Logic:**

```
pass = hasContext AND hasTwist AND hasFix AND (concreteNounCount >= 2)
```

### Rejection Criteria

Reject candidates (status: "rejected") if:

- **generic_advice**: Generic best practices without specific incident
- **insufficient_signal**: Fewer than 1 story signal in evidence
- **missing_structure**: Structural validation fails (pass = false)

### Promotion Criteria

Promote candidates (status: "promoted") if:

- Structural validation passes (pass = true)
- Score >= 0.6
- Contains non-obvious insight

**Promotion reasons:**

- **non_obvious_root_cause**: Root cause was not immediately apparent
- **subtle_interaction**: Unexpected interaction between components/tools
- **effective_technique**: Demonstrates effective debugging/development technique
- **counterintuitive_fix**: Fix contradicts initial expectation

## Banned Phrases

NEVER use these phrases in titles, synopses, or promotion reasons:

- "always write tests"
- "best practice"
- "make sure to"
- "don't forget to"
- "it's important to"
- "always remember"
- "be careful"
- "consider using"
- "you should always"
- "pro tip"
- "helpful tip"
- "keep in mind"
- "general rule of thumb"

These phrases indicate generic advice rather than specific incidents.

## Output Format

Produce JSONL (one candidate object per line):

```json
{
  "candidateId": "cand-{sha256(sessionId|primaryEventIndex)[:12]}",
  "sessionId": "session-abc123",
  "primaryEventIndex": 42,
  "eventIndices": [38, 39, 40, 41, 42, 43, 44, 45],
  "title": "Brief incident title < 80 chars",
  "synopsis": "1-2 sentence summary of the incident",
  "score": 0.85,
  "signals": ["root_cause", "aha_moment"],
  "dedupeClusterId": null,
  "status": "promoted",
  "rejectionReason": null,
  "promoteReason": "non_obvious_root_cause",
  "structuralCheck": {
    "hasContext": true,
    "hasTwist": true,
    "hasFix": true,
    "concreteNounCount": 4,
    "concreteNouns": ["extractText", "lessons-preprocessor.cjs", "ContentTypeError", "Read"],
    "pass": true
  },
  "evidencePointers": [
    "session-abc123/38#a1b2c3d4e5f6a7b8",
    "session-abc123/42#f6e5d4c3b2a1f0e9"
  ]
}
```

### Field Specifications

- **candidateId**: `cand-{first 12 chars of sha256(sessionId + "|" + primaryEventIndex)}`
- **sessionId**: Source session identifier
- **primaryEventIndex**: Line index of primary signal event
- **eventIndices**: All event line indices included in this incident
- **title**: Brief, specific title (< 80 chars, NO banned phrases)
- **synopsis**: 1-2 sentence incident summary
- **score**: 0.0-1.0 narrative value score
- **signals**: Array of story signal types found in evidence
- **dedupeClusterId**: null (clustering happens in separate step)
- **status**: "promoted" or "rejected"
- **rejectionReason**: Reason for rejection (if rejected)
- **promoteReason**: Reason for promotion (if promoted)
- **structuralCheck**: Object containing validation results
- **evidencePointers**: Array of provenance pointers for key evidence events

## Example Output

```jsonl
{"candidateId":"cand-a1b2c3d4e5f6","sessionId":"session-001","primaryEventIndex":45,"eventIndices":[40,41,42,43,44,45,46,47,48],"title":"Memory leak from unreleased ObjectURLs in PDF viewer","synopsis":"PDF viewer component created ObjectURLs but never called revokeObjectURL, causing browser memory to grow unbounded during long sessions.","score":0.82,"signals":["root_cause","subtle_bug"],"dedupeClusterId":null,"status":"promoted","rejectionReason":null,"promoteReason":"non_obvious_root_cause","structuralCheck":{"hasContext":true,"hasTwist":true,"hasFix":true,"concreteNounCount":5,"concreteNouns":["createObjectURL","revokeObjectURL","useEffect","PDFViewer","cleanup"],"pass":true},"evidencePointers":["session-001/45#abc123def456","session-001/47#def789ghi012"]}
{"candidateId":"cand-f6e5d4c3b2a1","sessionId":"session-002","primaryEventIndex":12,"eventIndices":[10,11,12,13,14],"title":"Generic testing advice","synopsis":"User asked about testing strategy, assistant provided general best practices.","score":0.25,"signals":[],"dedupeClusterId":null,"status":"rejected","rejectionReason":"generic_advice","promoteReason":null,"structuralCheck":{"hasContext":false,"hasTwist":false,"hasFix":false,"concreteNounCount":0,"concreteNouns":[],"pass":false},"evidencePointers":[]}
{"candidateId":"cand-9876543210ab","sessionId":"session-003","primaryEventIndex":67,"eventIndices":[63,64,65,66,67,68,69,70],"title":"Git rebase conflict from stale remote tracking","synopsis":"Rebase failed because local main was stale; syncing origin/main first resolved the conflict.","score":0.73,"signals":["root_cause","counterintuitive_fix"],"dedupeClusterId":null,"status":"promoted","rejectionReason":null,"promoteReason":"counterintuitive_fix","structuralCheck":{"hasContext":true,"hasTwist":true,"hasFix":true,"concreteNounCount":6,"concreteNouns":["git","rebase","origin/main","fetch","--prune","CONFLICT"],"pass":true},"evidencePointers":["session-003/67#xyz789abc123","session-003/69#mno456pqr789"]}
```

## Processing Instructions

1. Read all sessions from `preprocessed.json`
2. For each session:
   - Scan for events with `storySignals.length > 0`
   - Group signals into distinct incidents (max 3 per session)
   - For each incident:
     - Identify primary event (strongest signal)
     - Collect surrounding events (context + resolution)
     - Extract concrete nouns from event content
     - Run structural validation
     - Calculate score
     - Determine status and reason
     - Generate candidate object
3. Output one candidate per line in JSONL format
4. Ensure NO banned phrases appear in any text fields

## Quality Standards

- Titles must be specific and concrete
- Synopses must describe the actual incident, not general advice
- Structural checks must be accurate
- Concrete nouns must be actual identifiers from the code/tools
- Scores must reflect genuine narrative value
- Promotion/rejection reasons must be honest and accurate
