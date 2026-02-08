# Sample Output

This shows the expected output format from the story-miner skill.

## .story-miner/candidates.jsonl

```jsonl
{"candidateId":"cand-a1b2c3d4e5f6","sessionId":"85c64ef2-ae9d-4da8-833c-57245c784ecb","primaryEventIndex":4,"eventIndices":[0,4,5,6,7],"title":"grep Exit Code vs set -e: A Silent CI Killer","synopsis":"A lint script worked locally but failed in CI because grep returns exit code 1 when no matches are found, which set -e treats as a fatal error.","score":0.85,"signals":["root_cause","subtle_interaction"],"dedupeClusterId":null,"status":"promoted","rejectionReason":null,"promoteReason":"non_obvious_root_cause","structuralCheck":{"hasContext":true,"hasTwist":true,"hasFix":true,"concreteNounCount":4,"concreteNouns":["lint-skills.sh","grep","set -e","|| true"],"pass":true},"evidencePointers":[{"sessionId":"85c64ef2-ae9d-4da8-833c-57245c784ecb","lineIndex":633,"contentHash16":"7cccf37428f34167","quotePreview":"Fixed. The issue was at tools/lint-skills.sh:55-56 - added || true to both grep"}]}
```

## .story-miner/stories.jsonl

```jsonl
{"storyId":"story-f8a2b3c4d5e6","title":"grep Exit Code vs set -e: A Silent CI Killer","category":"bug","tags":["shell","ci","grep","exit-codes"],"synopsis":"A lint script worked locally but failed in CI because grep returns exit code 1 when no matches are found, and set -e in the script header treats any non-zero exit as fatal.","narrative":"The lint-skills.sh script had been working fine locally for weeks. Then one day, CI started failing with no clear error message — the script just stopped mid-execution.\n\nThe investigation revealed a subtle interaction between two well-known shell features. The script used `set -e` at the top (exit on any error), and two `grep` commands to search for different patterns. When only one pattern existed in the scanned files, the other `grep` returned exit code 1 (no matches found).\n\nNormally, `grep` returning 1 just means \"no matches\" — perfectly valid. But under `set -e`, any non-zero exit code is treated as a fatal error, immediately terminating the script.\n\n> \"Fixed. The issue was at tools/lint-skills.sh:55-56 - added `|| true` to both grep commands so they don't abort the script when only one pattern matches.\"\n> — assistant, [85c64ef2-ae9d-4da8-833c-57245c784ecb/633#7cccf37428f34167]\n\nThe fix was simple: append `|| true` to each grep command, converting \"no matches\" from an error into a successful no-op. This is a common pattern in shell scripts, but easy to forget when `set -e` is inherited from a template.\n\nThe root cause wasn't a bug in the grep commands themselves — they were correct. The bug was the interaction between grep's \"no match\" exit code and the script's error-handling policy.","quotes":[{"text":"Fixed. The issue was at tools/lint-skills.sh:55-56 - added || true to both grep commands so they don't abort the script when only one pattern matches.","attribution":"assistant","provenance":{"sessionId":"85c64ef2-ae9d-4da8-833c-57245c784ecb","lineIndex":633,"contentHash16":"7cccf37428f34167","pointer":"85c64ef2-ae9d-4da8-833c-57245c784ecb/633#7cccf37428f34167"},"context":"After investigating the CI failure and identifying the root cause"}],"claims":[{"claim":"grep returns exit code 1 when no matches are found, which set -e treats as a fatal script error","type":"root_cause","evidencePointers":["85c64ef2-ae9d-4da8-833c-57245c784ecb/633#7cccf37428f34167"]},{"claim":"Appending || true to grep commands prevents set -e from aborting on no-match results","type":"fix","evidencePointers":["85c64ef2-ae9d-4da8-833c-57245c784ecb/633#7cccf37428f34167"]}],"dedupeClusterId":null,"mergedFrom":["cand-a1b2c3d4e5f6"],"score":0.85,"createdAt":"2026-02-07T12:00:00.000Z","riskFlags":[]}
```

## .story-miner/stories.md

```markdown
# Story Mine: Development Stories

> Mined from Claude Code session history. Each story includes grounded quotes
> with provenance pointers back to source material.

Last updated: 2026-02-07

## Stories

### grep Exit Code vs set -e: A Silent CI Killer

**Category:** bug | **Score:** 0.85

The lint-skills.sh script had been working fine locally for weeks. Then one
day, CI started failing with no clear error message — the script just stopped
mid-execution.

The investigation revealed a subtle interaction between two well-known shell
features. The script used `set -e` at the top (exit on any error), and two
`grep` commands to search for different patterns. When only one pattern existed
in the scanned files, the other `grep` returned exit code 1 (no matches found).

Normally, `grep` returning 1 just means "no matches" — perfectly valid. But
under `set -e`, any non-zero exit code is treated as a fatal error, immediately
terminating the script.

> "Fixed. The issue was at tools/lint-skills.sh:55-56 - added `|| true` to
> both grep commands so they don't abort the script when only one pattern
> matches."
> — assistant, [85c64ef2-ae9d-4da8-833c-57245c784ecb/633#7cccf37428f34167]

The fix was simple: append `|| true` to each grep command, converting "no
matches" from an error into a successful no-op.

The root cause wasn't a bug in the grep commands themselves — they were correct.
The bug was the interaction between grep's "no match" exit code and the script's
error-handling policy.

---

## Summary

- Stories published: 1
- Candidates evaluated: 3
- Sessions analyzed: 3
- Dedupe clusters merged: 0

## Sources

- Preprocessor: v1.0.0
- Session logs: 3 files from ~/.claude/projects/
```

## .story-miner/digest.md

```markdown
# Story Mine Digest

> Quick summary of 1 story from 2026-01-23

| # | Title | Category | Score |
|---|-------|----------|-------|
| 1 | grep Exit Code vs set -e: A Silent CI Killer | bug | 0.85 |

## Top Insights

1. grep returns exit code 1 on "no matches", which set -e treats as fatal — append `|| true` to prevent silent script abortion
```

## Notes

- All output files are written to `.story-miner/` (gitignored, never committed)
- Every quote includes a provenance pointer back to the source session log
- Stories include `claims[]` with typed evidence pointers for verification
- The eval runner validates all quotes, pointers, and safety checks deterministically
