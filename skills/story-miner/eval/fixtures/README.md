# Story Miner Eval Fixtures

Sanitized test fixtures for evaluating the story-miner skill's preprocessing, quote extraction, and safety mechanisms.

## Fixture Inventory

### `local-sample-fixture-1.json`

**Purpose:** Test story-worthy excerpt extraction vs generic-advice filtering and secret leakage redaction.

**Contains 3 sessions:**

| Session | Tests | Key Elements |
|---------|-------|-------------|
| `fixture-session-aaa111` | Quote provenance, story signal detection | Root-cause analysis of `grep` exit-code interaction with `set -e`; includes `_storySignals` markers |
| `fixture-session-bbb222` | Generic-advice filtering | Boilerplate "add logging, run tests" session with no story-worthy content; evaluator should discard this |
| `fixture-session-ccc333` | Secret leakage redaction | Contains intentional `sk-FIXTURE-*` and `Authorization: Bearer` patterns in tool inputs; `_redactionRequired` flags mark events that must be redacted |

**Eval checklist:**
- [ ] Excerpt from `aaa111` event index 4 is selected as story-worthy
- [ ] Session `bbb222` is filtered out (generic advice, no insight)
- [ ] Secret patterns in `ccc333` events 2 and 4 are redacted before output
- [ ] Provenance pointers resolve to correct session/event/block

### `local-sample-fixture-2.json`

**Purpose:** Test deduplication of same-incident excerpts and tool transaction coherence.

**Contains 2 sessions:**

| Session | Tests | Key Elements |
|---------|-------|-------------|
| `fixture-session-ddd444` | Tool transactions, story extraction, failure recovery | Full debug cycle: search -> read -> root cause -> failed test -> fix -> passing test; 5 complete transactions |
| `fixture-session-eee555` | Dedupe (same incident) | References the same `extractText` bug from `ddd444`; should be merged/deduped |

**Eval checklist:**
- [ ] `_dedupeCluster: "extractText-array-content-bug"` excerpts are merged into single story
- [ ] Tool transactions in `ddd444` are correctly paired (call <-> result)
- [ ] Failed transaction `toolu_fixture_012` is identified as the test failure that drove the fix
- [ ] Provenance pointers are stable across reruns (deterministic from content hash + timestamp)

## Fixture Structure

Fixtures follow the story-miner preprocessed output format:

```json
{
  "_fixture": { "name", "version", "purpose", "tests" },
  "metadata": { "projectSlug", "preprocessorVersion", "generatedAt", ... },
  "sessions": [
    {
      "sessionId": "...",
      "events": [
        {
          "index": 0,
          "kind": "user|assistant|tool_call|tool_result",
          "text": "...",
          "lineHash": "16-char hex",
          "toolUseId": "...",
          "_storySignals": ["root_cause", ...],
          "_dedupeCluster": "cluster-name"
        }
      ],
      "transactions": [...],
      "toolFailures": [...],
      "evidence": { "sampleStrategy", "contextWindow", ... }
    }
  ],
  "summary": { ... }
}
```

## Conventions

- **`_` prefixed fields** (e.g., `_storySignals`, `_redactionRequired`, `_dedupeCluster`) are eval-only annotations not present in production output
- **`[REDACTED]`** markers replace real user paths and sensitive values
- **`fixture-session-*`** IDs are synthetic; real sessions use UUIDs
- **`lineHash`** values are synthetic 16-char hex strings; real hashes are SHA-256 derived
- **`sk-FIXTURE-*`** values are intentional decoys for testing redaction, not real keys

## Adding Fixtures

1. Create a new `local-sample-fixture-N.json` following the structure above
2. Add eval-only annotations with `_` prefix for expected outcomes
3. Ensure all paths and identifiers are fully redacted
4. Document the fixture in this README with its test purpose
5. Run fixture validation: `node -e "JSON.parse(require('fs').readFileSync('fixture.json'))"` to verify valid JSON
