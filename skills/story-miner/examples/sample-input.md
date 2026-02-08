# Sample Input

This shows an example of preprocessed Claude Code session data that the story-miner skill works with.

## Example `preprocessed.json` Excerpt

```json
{
  "metadata": {
    "preprocessorVersion": "1.0.0",
    "generatedAt": "2026-02-07T12:00:00.000Z",
    "runScope": "full",
    "logCount": 3,
    "eventCount": 42,
    "sampledEventCount": 28
  },
  "sessions": [
    {
      "sessionId": "85c64ef2-ae9d-4da8-833c-57245c784ecb",
      "projectId": "c--Users-REDACTED-Projects-toolkit",
      "sessionFile": "85c64ef2-ae9d-4da8-833c-57245c784ecb.jsonl",
      "firstTimestamp": "2026-01-23T22:30:00.000Z",
      "lastTimestamp": "2026-01-23T23:15:00.000Z",
      "taskPreview": "Fix the lint-skills.sh script that aborts when only one grep pattern matches",
      "toolNames": ["Read", "Edit", "Bash", "Grep"],
      "kindsCount": { "user": 4, "assistant": 6, "tool_call": 8, "tool_result": 8 },
      "totalEvents": 26,
      "sampledEventCount": 18,
      "toolFailuresCount": 1,
      "mode": "full",
      "events": [
        {
          "index": 0,
          "kind": "user",
          "text": "The lint-skills.sh script is failing in CI...",
          "timestamp": "2026-01-23T22:30:00.000Z",
          "lineHash": "a1b2c3d4e5f60718",
          "toolName": null,
          "toolUseId": null,
          "exitCode": null,
          "isError": false,
          "blockType": "text",
          "provenance": {
            "sessionId": "85c64ef2-ae9d-4da8-833c-57245c784ecb",
            "lineIndex": 0,
            "contentHash16": "f8a2c1b3d4e56789"
          },
          "storySignals": []
        },
        {
          "index": 4,
          "kind": "assistant",
          "text": "Fixed. The issue was at tools/lint-skills.sh:55-56 - added || true to both grep commands so they don't abort the script when only one pattern matches. The subtle interaction was between grep's exit code 1 (no match) and set -e causing the whole script to abort.",
          "timestamp": "2026-01-23T23:14:01.724Z",
          "lineHash": "7cccf37428f34167",
          "toolName": null,
          "toolUseId": null,
          "exitCode": null,
          "isError": false,
          "blockType": "text",
          "provenance": {
            "sessionId": "85c64ef2-ae9d-4da8-833c-57245c784ecb",
            "lineIndex": 633,
            "contentHash16": "7cccf37428f34167"
          },
          "storySignals": ["root_cause", "subtle_interaction"]
        }
      ],
      "transactions": [
        {
          "toolUseId": "toolu_001",
          "toolName": "Read",
          "state": "completed",
          "callEventIndex": 1,
          "resultEventIndex": 2,
          "isFailure": false,
          "detectionTier": null
        }
      ],
      "toolFailures": [
        {
          "eventIndex": 6,
          "toolName": "Bash",
          "toolUseId": "toolu_003",
          "exitCode": 1,
          "isError": true,
          "detectionTier": "A",
          "patternMatched": "exit_code_nonzero",
          "inputSummary": "./tools/lint-skills.sh"
        }
      ],
      "evidence": {
        "sampleStrategy": "full",
        "contextWindow": [0, 1, 2],
        "resolutionWindow": [3, 4, 5],
        "errorWindows": [5, 6, 7],
        "importanceWindows": [4]
      }
    }
  ],
  "summary": {
    "totalSessions": 3,
    "totalEvents": 42,
    "totalSampledEvents": 28,
    "totalToolFailures": 2,
    "toolNameFrequency": { "Read": 12, "Edit": 8, "Bash": 6, "Grep": 4 }
  }
}
```

## What Gets Mined

From this preprocessed data, story-miner would identify:

1. **Incident**: grep exit code + `set -e` interaction causing CI failure
2. **Story Signals**: `root_cause` and `subtle_interaction` detected on event 4
3. **Provenance**: Quote traceable to `85c64ef2.../633#7cccf37428f34167`
4. **Candidate**: Scored for narrative value (non-obvious root cause, subtle shell interaction)

## Key Differences from Lessons-Extractor Input

- Each event has `provenance` pointers for quote grounding
- Each event has `storySignals` array for narrative value detection
- Each event has `blockType` for thinking-block policy enforcement
- Sessions use `projectId` + `sessionFile` instead of machine-specific file paths
- `transactions` array links tool calls to their results
