---
description: Manually trigger PR review against specification
argument-hint: "[path-to-spec.md]"
allowed-tools: Read, Grep, Glob, Bash(gh *, git *, npm test, pytest), Write, Task
---

spec-workflow v1.0.0 · Review

You are running a standalone spec-workflow review.

## Argument Parsing

Determine the type of $ARGUMENTS:

1. **File path** (contains `/` or `\` or ends in `.md`):
   - SPEC_PATH = $ARGUMENTS

2. **Freeform text** (no path separators, does not end in `.md`):
   - FEATURE_NAME = kebab-case($ARGUMENTS)
   - SPEC_PATH = `docs/specs/SPEC-{FEATURE_NAME}.md`
   - Verify SPEC_PATH exists. If not, fall back to discovery below.

3. **Not provided** (empty $ARGUMENTS):
   - Discover the spec from the PR description or the most recent `docs/specs/SPEC-*.md` file.

## Step 2: Gather PR Context

Run these commands to collect context:

```bash
gh pr diff
gh pr view
npm test  # or pytest
```

## Step 3: Invoke Reviewer

Use the `pr-reviewer` subagent (`@pr-reviewer`) to review the PR against the specification.

## Step 4: Save Review

### Review Template

Use this structure for the review:

```markdown
# PR Review: {Title}

**Spec:** {link}
**PR:** #{number}
**Date:** {YYYY-MM-DD}

## Coverage Matrix

| ID | Description | Status | Location | Test |
|----|-------------|--------|----------|------|
| REQ-001 | {desc} | ✅ | `file:line` | `test:line` |
| REQ-002 | {desc} | ⚠️ | `file` | Missing |
| REQ-003 | {desc} | ❌ | - | - |

**Summary:** X/Y implemented (Z%)

## Issues

### 🔴 Critical

1. **{Issue}**
   - Location: `file:line`
   - Expected: {what}
   - Found: {what}

### 🟡 Warnings

1. **{Issue}**
   - Recommendation: {fix}

## Verdict

- [ ] ✅ Approved
- [ ] ⚠️ Changes Requested
- [ ] ❌ Rejected

## Notes for Tester

- [ ] {test scenario}
```

Save the review to: `docs/reviews/REVIEW-{pr-number}.md`

The review MUST include:
- Coverage matrix (each REQ-* status)
- Issues (critical / warning / info)
- Verdict: Approved / Changes Requested / Rejected
- Notes for tester
