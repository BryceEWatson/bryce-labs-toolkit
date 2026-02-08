# Write Development Story from Candidate

You are writing a narrative development story from a promoted candidate and its evidence events.

## Input Format

You will receive:

1. **Promoted candidate** from `candidates.jsonl`:
```json
{
  "candidateId": "cand-abc123",
  "sessionId": "session-001",
  "primaryEventIndex": 45,
  "eventIndices": [40, 41, 42, 43, 44, 45, 46, 47, 48],
  "title": "Memory leak from unreleased ObjectURLs",
  "synopsis": "PDF viewer created ObjectURLs but never revoked them...",
  "score": 0.82,
  "signals": ["root_cause", "subtle_bug"],
  "promoteReason": "non_obvious_root_cause",
  "structuralCheck": { "pass": true, ... },
  "evidencePointers": ["session-001/45#abc123", ...]
}
```

2. **Evidence events** from `preprocessed.json` (events matching eventIndices):
```json
{
  "index": 45,
  "kind": "assistant",
  "text": "The memory leak is caused by createObjectURL...",
  "timestamp": "2026-02-07T10:30:00Z",
  "blockType": "text",
  "storySignals": ["root_cause"],
  "toolName": null,
  "provenance": {
    "sessionId": "session-001",
    "lineIndex": 45,
    "contentHash16": "abc123def456",
    "pointer": "session-001/45#abc123def456"
  }
}
```

**Field notes:**
- `kind` indicates the event type: `user`, `assistant`, `tool_call`, `tool_result`
- `text` contains the redacted, truncated content — use this for quotes
- `blockType` tracks original content block type — NEVER quote from `"thinking"` events

## Task

Write a narrative story (200-800 words) that:

1. Tells the incident as a cohesive story with clear narrative arc
2. Includes at least ONE grounded quote from evidence events
3. Highlights the twist/root-cause/technique that makes it interesting
4. Extracts factual claims with evidence pointers
5. Follows strict quotation and attribution rules

## Narrative Structure

Your story should follow this arc:

1. **Hook** (1-2 sentences)
   - What went wrong or what was attempted
   - Why it matters

2. **Context** (2-3 sentences)
   - What the developer was working on
   - Initial approach or expectation

3. **Twist/Discovery** (3-5 sentences)
   - The non-obvious root cause or insight
   - How it was discovered
   - Include at least one grounded quote here

4. **Resolution** (2-4 sentences)
   - How it was fixed
   - What changed

5. **Takeaway** (1-2 sentences)
   - Transferable insight
   - When this might apply elsewhere

## Quotation Rules (CRITICAL)

### Quote Sources

- Quotes MUST come from `preprocessed.json` events only
- Use events matching the candidate's `eventIndices`
- NEVER quote from events where `blockType === "thinking"`
- NEVER fabricate or paraphrase quotes

### Quote Attribution

Each quote MUST include:

1. **Verbatim text** from the event's `text` field (may be lightly edited for clarity)
2. **Attribution**: "assistant" or "user" based on event's `kind` field (`tool_call` → "assistant", `tool_result` → "tool")
3. **Provenance pointer**: Full pointer string in format `{sessionId}/{lineIndex}#{contentHash16}`

### Quote Format in Narrative

Integrate quotes naturally:

```markdown
The assistant identified the issue: "The memory leak is caused by createObjectURL
calls that are never matched with revokeObjectURL."
[session-001/45#abc123def456]
```

Or as block quotes:

```markdown
> "The memory leak is caused by createObjectURL calls that are never matched
> with revokeObjectURL."
> -- assistant, [session-001/45#abc123def456]
```

### Thinking Events (BANNED)

NEVER quote from thinking blocks. Thinking events contain:
- `blockType === "thinking"`
- Internal reasoning Claude performed before responding
- NOT part of the conversation the user sees

If an insight appears in thinking, you must:
- Find where that insight was stated in a text/tool_use/tool_result event
- Quote from the non-thinking event instead
- If no non-thinking event exists, describe the insight without quoting

## Claims Extraction

Extract factual claims from the story with evidence pointers.

### Claim Requirements

- Minimum 1 claim with `type: "root_cause"`
- Minimum 1 claim with `type: "fix"`
- Each claim must have at least 1 evidence pointer
- Claims must be specific, not generic advice

### Claim Types

- **root_cause**: Why the problem occurred
- **fix**: How the problem was resolved
- **technique**: A development technique used
- **observation**: A factual observation about behavior

### Claim Format

```json
{
  "claim": "createObjectURL allocates browser memory that is never released without revokeObjectURL",
  "type": "root_cause",
  "evidencePointers": ["session-001/45#abc123def456"]
}
```

## Banned Phrases

NEVER use these phrases in the narrative:

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

These phrases make stories feel like generic advice rather than specific incidents.

## Output Format

Produce a single JSON object:

```json
{
  "storyId": "story-abc123def456",
  "title": "Memory Leak from Unreleased ObjectURLs",
  "category": "bug",
  "tags": ["memory", "cleanup", "react", "useEffect"],
  "synopsis": "A PDF viewer component leaked browser memory by creating ObjectURLs without revoking them. The leak went unnoticed until a user reported browser slowdowns after viewing multiple documents.",
  "narrative": "## Memory Leak from Unreleased ObjectURLs\n\nA seemingly innocent PDF viewer component was causing browser memory to grow unbounded...\n\n[Full markdown story here, 200-800 words]\n\n",
  "quotes": [
    {
      "text": "The memory leak is caused by createObjectURL calls that are never matched with revokeObjectURL.",
      "attribution": "assistant",
      "provenance": {
        "sessionId": "session-001",
        "lineIndex": 45,
        "contentHash16": "abc123def456",
        "pointer": "session-001/45#abc123def456"
      },
      "context": "Identifying the root cause of browser memory growth"
    }
  ],
  "claims": [
    {
      "claim": "createObjectURL allocates browser memory that is never released without revokeObjectURL",
      "type": "root_cause",
      "evidencePointers": ["session-001/45#abc123def456"]
    },
    {
      "claim": "Adding revokeObjectURL to useEffect cleanup function prevents memory leak",
      "type": "fix",
      "evidencePointers": ["session-001/47#def789ghi012"]
    }
  ],
  "dedupeClusterId": null,
  "mergedFrom": ["cand-abc123"],
  "score": 0.82,
  "createdAt": "2026-02-07T14:22:00Z",
  "riskFlags": []
}
```

### Field Specifications

- **storyId**: `story-{first 12 chars of sha256(dedupeClusterId || candidateId)}`
- **title**: Story title (can refine candidate title, < 80 chars)
- **category**: One of: "bug", "technique", "pattern", "architecture", "tooling"
- **tags**: 3-6 specific tags (lowercase, hyphen-separated)
- **synopsis**: 2-3 sentence summary (can expand candidate synopsis)
- **narrative**: Full markdown story (200-800 words)
- **quotes**: Array of quote objects with full provenance
- **claims**: Array of factual claims with evidence pointers
- **dedupeClusterId**: null (clustering happens in separate step)
- **mergedFrom**: Array of candidateIds merged into this story
- **score**: Carry forward from candidate (or average if merged)
- **createdAt**: ISO-8601 timestamp
- **riskFlags**: Array of risk indicators (empty for now)

## Category Guidelines

**bug**: Problem in code behavior
- Memory leaks
- Race conditions
- Unexpected errors
- Edge cases

**technique**: Development method or approach
- Debugging strategies
- Testing approaches
- Refactoring patterns

**pattern**: Code design pattern
- Architectural decisions
- API design
- Data modeling

**architecture**: System-level design
- Component structure
- Integration patterns
- Performance optimization

**tooling**: Tool usage or configuration
- Claude Code tool interactions
- Git workflows
- Build system issues

## Tag Guidelines

Tags should be:
- Specific to the incident (NOT generic like "debugging")
- Technical terms (function names, technologies, concepts)
- Lowercase with hyphens
- 3-6 tags per story

Good tags: `memory`, `useEffect`, `cleanup`, `objecturl`, `react`, `pdf`
Bad tags: `coding`, `bug-fixing`, `development`, `issue`

## Quality Standards

### Narrative Quality

- **Specific**: Names actual functions, files, tools, errors
- **Concrete**: Describes what actually happened, not general advice
- **Grounded**: Every key claim backed by a quote or evidence pointer
- **Readable**: Clear prose, logical flow, proper markdown formatting
- **Focused**: Stays on the incident, no tangents

### Quote Quality

- **Accurate**: Matches source event content exactly (or with minimal clarity edits)
- **Attributed**: Clear provenance pointer for every quote
- **Relevant**: Supports the narrative at that point
- **Non-thinking**: Never from thinking blocks

### Claims Quality

- **Factual**: Statements of fact, not opinions or advice
- **Supported**: Every claim has evidence pointers
- **Specific**: Names concrete elements (functions, files, errors)
- **Complete**: Minimum 1 root_cause + 1 fix claim

## Example Output

```json
{
  "storyId": "story-7a8b9c0d1e2f",
  "title": "Memory Leak from Unreleased ObjectURLs in PDF Viewer",
  "category": "bug",
  "tags": ["memory", "cleanup", "react", "useEffect", "objecturl", "pdf-viewer"],
  "synopsis": "A PDF viewer component leaked browser memory by creating ObjectURLs without revoking them. The leak went unnoticed during development but caused browser slowdowns when users viewed multiple documents in a single session.",
  "narrative": "## Memory Leak from Unreleased ObjectURLs in PDF Viewer\n\nA seemingly well-tested PDF viewer component was causing browser memory to grow unbounded. Users reported slowdowns after viewing multiple documents, but the component worked perfectly in development.\n\nThe component used `URL.createObjectURL()` to display PDF files uploaded by users. During initial testing with a few documents, everything worked smoothly. The code passed all functional tests, and the PDFs rendered correctly.\n\nThe issue emerged during a code review focused on React useEffect cleanup patterns. The assistant identified the problem: \"The memory leak is caused by createObjectURL calls that are never matched with revokeObjectURL. Each time a new PDF is loaded, a new ObjectURL is created, but the old ones persist in memory.\" [session-001/45#abc123def456]\n\nThe browser allocates memory for each ObjectURL and holds it until explicitly released. Without cleanup, every PDF viewed during a session consumed additional memory that was never freed. In a typical development test with 2-3 documents, the leak was imperceptible. But users viewing dozens of documents experienced degraded browser performance.\n\nThe fix was straightforward once identified: add `URL.revokeObjectURL(objectUrl)` to the useEffect cleanup function. The assistant modified the component to store the ObjectURL in a ref and revoke it when the component unmounted or when a new PDF was loaded. After deploying the fix, memory usage remained stable regardless of how many documents users viewed.\n\nThe key insight: browser APIs that allocate resources (ObjectURLs, event listeners, timers) require explicit cleanup. Testing with realistic usage patterns—not just happy-path cases—reveals resource leaks that short development tests miss.",
  "quotes": [
    {
      "text": "The memory leak is caused by createObjectURL calls that are never matched with revokeObjectURL. Each time a new PDF is loaded, a new ObjectURL is created, but the old ones persist in memory.",
      "attribution": "assistant",
      "provenance": {
        "sessionId": "session-001",
        "lineIndex": 45,
        "contentHash16": "abc123def456",
        "pointer": "session-001/45#abc123def456"
      },
      "context": "Identifying the root cause during code review"
    }
  ],
  "claims": [
    {
      "claim": "URL.createObjectURL allocates browser memory that persists until explicitly released with revokeObjectURL",
      "type": "root_cause",
      "evidencePointers": ["session-001/45#abc123def456"]
    },
    {
      "claim": "Adding URL.revokeObjectURL to useEffect cleanup function prevents ObjectURL memory leaks",
      "type": "fix",
      "evidencePointers": ["session-001/47#def789ghi012"]
    },
    {
      "claim": "Resource leaks may be imperceptible in short development tests but significant under realistic usage patterns",
      "type": "observation",
      "evidencePointers": ["session-001/45#abc123def456", "session-001/48#ghi345jkl678"]
    }
  ],
  "dedupeClusterId": null,
  "mergedFrom": ["cand-abc123def456"],
  "score": 0.82,
  "createdAt": "2026-02-07T14:22:00Z",
  "riskFlags": []
}
```

## Processing Instructions

1. Read the promoted candidate
2. Retrieve evidence events from preprocessed.json using eventIndices
3. Filter out any thinking events (blockType === "thinking")
4. Identify key moments (context, discovery, resolution)
5. Select 1-3 compelling quotes from non-thinking events
6. Draft narrative following the 5-part structure
7. Extract factual claims with evidence pointers
8. Validate: no banned phrases, all quotes have provenance, min claims met
9. Output single JSON object

## Validation Checklist

Before outputting, verify:

- [ ] Narrative is 200-800 words
- [ ] At least 1 quote included
- [ ] All quotes have provenance pointers
- [ ] No quotes from thinking events
- [ ] Minimum 1 root_cause claim
- [ ] Minimum 1 fix claim
- [ ] All claims have evidence pointers
- [ ] No banned phrases in narrative
- [ ] Category is one of: bug, technique, pattern, architecture, tooling
- [ ] 3-6 specific tags
- [ ] storyId correctly formatted
- [ ] createdAt is ISO-8601 timestamp
