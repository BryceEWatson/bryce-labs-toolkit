---
description: Execute implementation plan with automated PR review loop
argument-hint: "<path-to-plan.md>"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---

Execute the implementation plan.

## Input

Plan: $ARGUMENTS

## Critical Constraint

The implementer does NOT have access to SPEC.md - works only from PLAN.md.
This forces strict plan adherence and catches plan drift during review.

## Phase 1: Execute Plan

1. Parse PLAN.md for task list and dependencies
2. Execute tasks in order:
   - Create/modify files as specified
   - Write tests alongside implementation
   - Commit per task: `task(TASK-xxx): description`
3. Create feature branch and PR

## Phase 2: Review Loop

After implementation, invoke the pr-reviewer agent:

```
Use @pr-reviewer to validate implementation against SPEC.
Input:
- SPEC: [derive from plan's spec reference]
- PR: current PR diff
```

The pr-reviewer runs in forked context and checks against SPEC.md (not PLAN.md):
- Every REQ-* implemented
- Every AC-* has passing test
- Code quality standards met

If issues found: fix and re-run review.
If approved: present to user for testing.
Max iterations: 5

## Ready for Testing

After approval:
```
✅ PR ready for local testing

Requirements covered:
- REQ-001: ✅ Implemented + tested
- REQ-002: ✅ Implemented + tested
...

Test locally: git checkout {branch} && npm test
```
