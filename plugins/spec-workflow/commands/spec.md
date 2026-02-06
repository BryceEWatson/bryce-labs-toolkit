---
description: Generate requirements specification from natural language
argument-hint: "<feature-description>"
allowed-tools: Read, Grep, Glob, WebSearch, Write
---

Generate a formal specification from the feature request.

## Input

Feature: $ARGUMENTS

## Process

1. Analyze the request for core functionality
2. Identify implicit requirements (security, error handling, edge cases)
3. Ask clarifying questions if ambiguous
4. Research technical context if needed
5. Generate SPEC.md with:
   - Requirements: REQ-001, REQ-002, ...
   - Acceptance Criteria: AC-001, AC-002, ...
   - Non-Functional Requirements: NFR-001, ...
   - Out of Scope
   - Open Questions

## Output

Save to: `docs/specs/SPEC-{feature-name}.md`

Use template: @${CLAUDE_PLUGIN_ROOT}/skills/spec-driven-dev/reference/SPEC_TEMPLATE.md

## Quality

- Every requirement must be atomic and testable
- Use "SHALL" for mandatory, "SHOULD" for recommended
- Preserve existing IDs during revision

## Next Step

After approval: `/spec-workflow:plan docs/specs/SPEC-{feature-name}.md`
