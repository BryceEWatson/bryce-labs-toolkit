---
description: Generate implementation plan with automated review loop
argument-hint: "<path-to-spec.md>"
allowed-tools: Read, Grep, Glob, WebSearch, Write, Bash(git status, git log *, git diff *, git branch *, git show *), Task
---

Generate and validate an implementation plan.

## Input

Specification: $ARGUMENTS

## Phase 1: Generate Plan

1. Read and parse SPEC.md
2. Extract all REQ-*, AC-*, NFR-* identifiers
3. Explore codebase for patterns and integration points
4. Create PLAN.md with:
   - Requirement Mapping Table (every REQ-* maps to task(s))
   - Tasks with dependencies, file paths, test files
   - Architecture Decisions with rationale
   - Risk Assessment

Save to: `docs/plans/PLAN-{feature-name}.md`

Use template: @${CLAUDE_PLUGIN_ROOT}/skills/spec-driven-dev/reference/PLAN_TEMPLATE.md

## Phase 2: Review Loop

After generating the plan, invoke the plan-reviewer agent:

```
Use @plan-reviewer to validate the plan.
Input:
- SPEC: $ARGUMENTS
- PLAN: docs/plans/PLAN-{feature-name}.md
```

The plan-reviewer runs in forked context and checks:
- Every REQ-* mapped to task(s)
- Every AC-* has test coverage
- Architecture decisions have rationale
- Risks identified

If gaps found: revise plan and re-run review.
If approved: present to user.
Max iterations: 5

## Next Step

After approval: `/spec-workflow:implement docs/plans/PLAN-{feature-name}.md`
