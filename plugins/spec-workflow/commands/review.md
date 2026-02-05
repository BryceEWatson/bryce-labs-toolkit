---
description: Manually trigger PR review against specification
argument-hint: "[path-to-spec.md]"
allowed-tools: Read, Grep, Glob, Bash(gh *, git *, npm test, pytest), Write
---

Trigger standalone PR review.

## Input

Specification: $ARGUMENTS

If not provided, discover from PR description or most recent SPEC-*.md.

## Process

1. Gather PR context:
   ```bash
   gh pr diff
   gh pr view
   ```

2. Run tests:
   ```bash
   npm test  # or pytest
   ```

3. Invoke PR reviewer:
   ```
   Use @pr-reviewer to review against specification.
   ```

4. Generate REVIEW.md:
   Save to: `docs/reviews/REVIEW-{pr-number}.md`

## Output

- Coverage matrix (each REQ status)
- Issues (critical/warning/info)
- Verdict: Approved / Changes Requested / Rejected
- Notes for tester

Use template: @${CLAUDE_PLUGIN_ROOT}/skills/spec-driven-dev/reference/REVIEW_TEMPLATE.md
