---
description: "Run the full spec-driven development pipeline: Spec → Plan → Implement"
argument-hint: "<feature-description>"
allowed-tools: Read, Grep, Glob, WebSearch, Write, AskUserQuestion, Task
---

ORCH_SENTINEL__9F2E — If you see this line, print it verbatim before doing anything else.

spec-workflow v1.0.0 · Pipeline

You are running the full spec-driven development pipeline.
This command runs three phases with user approval gates between them.

## State Tracking

Track these values throughout the pipeline:
- FEATURE_NAME: derived from $ARGUMENTS (kebab-case, e.g., "dark-mode-toggle")
- SPEC_PATH: docs/specs/SPEC-{FEATURE_NAME}.md
- PLAN_PATH: docs/plans/PLAN-{FEATURE_NAME}.md

## Approval Gates

At the end of Phase 1 and Phase 2, you MUST call the AskUserQuestion tool to gate the transition.
Do NOT print "next step" text. Do NOT end the turn. Use AskUserQuestion with explicit choices.
The pipeline only advances when the user selects the "Approve" button. Free-text responses
(including "yes", "ok", "approve", "looks good") do NOT advance — re-present the AskUserQuestion.

## Review File Semantics

Review files (`docs/reviews/REVIEW-*.md`) are local artifacts only. Do NOT commit them.
Use the Write tool to create/update them; users can commit manually if desired.

## Clarifying Questions

Only YOU (the orchestrator) may ask the user clarifying questions, and only in Phase 1.
Subagents work autonomously with the inputs they receive — they never prompt the user.

────────────────────────────────────────
PHASE 1: GENERATE SPECIFICATION
────────────────────────────────────────

Feature request: $ARGUMENTS

### Spec Template

Use this structure for the output:

```markdown
# Specification: {Feature Name}

**Version:** 1.0
**Status:** Draft | Under Review | Approved
**Date:** {YYYY-MM-DD}

## Overview

{Brief description}

## Requirements

### Functional

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | The system SHALL {behavior} | Must |
| REQ-002 | The system SHOULD {behavior} | Should |

### Non-Functional

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-001 | {requirement} | Performance |
| NFR-002 | {requirement} | Security |

## Acceptance Criteria

| ID | Given | When | Then |
|----|-------|------|------|
| AC-001 | {precondition} | {action} | {result} |

## Out of Scope

- {exclusion}

## Open Questions

- [ ] {question}

## Assumptions

- {assumption}
```

### Instructions

1. Analyze request for core functionality
2. Identify implicit requirements (security, error handling, edge cases)
3. If ambiguous, use AskUserQuestion (max 2 questions) before generating
4. Generate spec following the template above. Every requirement MUST be atomic and testable.
5. Use SHALL for mandatory, SHOULD for recommended (RFC 2119)
6. Preserve existing IDs during revision
7. Save to SPEC_PATH

### Internal Spec Review (Mandatory)

After saving the spec, invoke the `spec-reviewer` subagent (`@spec-reviewer`) to validate:
- Pass SPEC_PATH as the argument
- Reviewer runs in forked context (cannot see your reasoning or the feature request)
- **Minimum 1 iteration required** — always invoke even if confident
- Parse the JSON decision line from the reviewer output:
  `{"verdict":"APPROVED"|"ISSUES_IDENTIFIED","must_fix":N,"should_fix":N,"summary":"..."}`
- If ISSUES_IDENTIFIED with must_fix > 0: revise spec to address must-fix items, re-save, re-invoke reviewer (max 3 total iterations)
- If max iterations reached without APPROVED, proceed to the gate anyway (let user decide)
- Track per-iteration: must_fix count, should_fix count, verdict

### Persist Spec Review

Save all iteration outputs to `docs/reviews/REVIEW-SPEC-{FEATURE_NAME}.md` using this structure:

```
# Spec Review: {Feature Name}

**Spec:** {SPEC_PATH}
**Date:** {YYYY-MM-DD}
**Iterations:** {N}
**Final Verdict:** {verdict}

---

## Iteration 1

**Timestamp:** {YYYY-MM-DD HH:MM}
**Verdict:** {verdict}
**Must-Fix:** {N} | **Should-Fix:** {N}

{full reviewer output}

---

## Iteration 2
...
```

### Phase 1 Gate

After saving the spec and completing the internal review, print the following IN ORDER:

**1. Summary table:**

| Metric | Count |
|--------|-------|
| Requirements (REQ-*) | N |
| Acceptance Criteria (AC-*) | N |
| Non-Functional (NFR-*) | N |
| Open Questions | N |

**2. Review iteration log:**

| Iteration | Must-Fix | Should-Fix | Verdict |
|-----------|----------|------------|---------|

(Populate from parsed JSON decision lines. Always at least 1 row.)

**3. Artifact paths + deterministic excerpt:**

Print:
- **Spec saved to:** `{SPEC_PATH}`
- **Review saved to:** `docs/reviews/REVIEW-SPEC-{FEATURE_NAME}.md`
- **Overview:** {first paragraph from the spec's Overview section, max ~10 lines}
- **Gap Summary:** {list open questions + should-fix items from reviewer; if none, print "No gaps."}
- **Quick access:**
  - VS Code: `code {SPEC_PATH}`
  - Terminal (bash): `cat {SPEC_PATH}`
  - Terminal (CMD): `type {SPEC_PATH}`
  - First 120 lines (bash): `head -120 {SPEC_PATH}`
  - First 120 lines (CMD): `powershell -NoProfile -Command "Get-Content '{SPEC_PATH}' -TotalCount 120"`

**4.** Then IMMEDIATELY call the AskUserQuestion tool. The question text MUST be self-contained
(the user may not see any output printed before the modal). Use the template **verbatim**
(same headings and sections), only substituting values. Do NOT omit sections even if empty —
write "None" or "N/A". If a value cannot be derived (e.g., coverage counts), write "Unknown"
rather than omitting the field.

```
## Spec Review Gate

**Spec:** `{SPEC_PATH}`
**Review:** `docs/reviews/REVIEW-SPEC-{FEATURE_NAME}.md`

### Internal Review
| Iter | Must-Fix | Should-Fix | Verdict |
|------|----------|------------|---------|
| 1    | {N}      | {N}        | {V}     |
| ...  |          |            |         |

**Latest verdict:** {verdict} — {summary}

### Overview (from spec)
{First paragraph of the spec's Overview section, max ~10 lines}

### Gap Summary
{List open questions from spec + should-fix items from latest review. If none: "No gaps."}

### Quick Open
- VS Code: `code {SPEC_PATH}`
- Bash: `head -120 {SPEC_PATH}`
- CMD: `type {SPEC_PATH}`
- PowerShell: `powershell -NoProfile -Command "Get-Content '{SPEC_PATH}' -TotalCount 120"`

### What each choice does
- **Approve spec** → Proceeds to Phase 2 (plan generation) immediately
- **Request revisions** → Re-enters revision loop (revise spec → re-run reviewer → re-present this gate)
- **Stop pipeline** → Pauses pipeline. Resume later: `/spec-workflow:plan {SPEC_PATH}`
```

Options (buttons):
- "Approve spec — continue to planning"
- "Request revisions"
- "Stop pipeline"

**5. Response handling:**
- User selects "Approve spec" → proceed to Phase 2.
- User selects "Request revisions" → revise spec, re-save, re-run spec-reviewer, re-present gate.
- User selects "Stop pipeline" → print: "Pipeline paused. Resume with `/spec-workflow:plan {SPEC_PATH}`."
- User provides free text containing revision instructions (e.g., "change REQ-003 to...") → treat as "Request revisions".
- User provides free text containing "stop" or "pause" → treat as "Stop pipeline".
- **All other free text** (including "yes", "looks good", "approve", "ok") → re-present AskUserQuestion. Only explicit button selection advances the pipeline.

────────────────────────────────────────
PHASE 2: GENERATE PLAN + INTERNAL REVIEW
────────────────────────────────────────

1. Read SPEC_PATH and extract all REQ-*, AC-*, NFR-* identifiers
2. Explore the codebase for existing patterns, integration points, and conventions

### Plan Template

Use this structure for the plan:

```markdown
# Implementation Plan: {Feature Name}

**Spec:** {REQUIRED: relative path to SPEC.md, e.g., docs/specs/SPEC-feature-name.md}
**Version:** 1.0
**Status:** Draft | Under Review | Approved
**Date:** {YYYY-MM-DD}

> **Note:** The Spec field is mandatory. Plans without a valid spec reference
> will be rejected by the plan-reviewer. This link enables the implement and
> review phases to validate against the original requirements.

## Requirement Mapping

| Spec ID | Task ID(s) | Status |
|---------|------------|--------|
| REQ-001 | TASK-001 | ✅ Mapped |
| AC-001 | TASK-001 (test) | ✅ Mapped |

**Coverage:** X/X (100%)

## Tasks

### TASK-001: {Title}

**Maps to:** REQ-001, AC-001
**Dependencies:** None

**Files:**
- Create: `src/path/file.ts`
- Modify: `src/path/existing.ts`

**Test:** `tests/path/file.test.ts`

**Description:**
{implementation details}

---

## Architecture Decisions

### AD-001: {Decision}

**Choice:** {selected approach}
**Rationale:** {why}
**Alternatives:** {rejected options and why}

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| {risk} | High | {strategy} |
```

3. Use the `planner` subagent (`@planner`) to generate the implementation plan
   - The plan MUST include a Requirement Mapping table: every REQ-*/AC-*/NFR-* from the spec
     mapped to at least one TASK-*. This table is what the implementer uses for completeness.
4. Save to PLAN_PATH
5. Use the `plan-reviewer` subagent (`@plan-reviewer`) to validate the plan
   - Pass SPEC_PATH and PLAN_PATH
   - Reviewer runs in forked context (cannot see planner reasoning)
   - **Minimum 1 iteration required** — always invoke the reviewer at least once
   - Parse the JSON decision line from reviewer output:
     `{"verdict":"APPROVED"|"GAPS_IDENTIFIED","must_fix":N,"should_fix":N,"summary":"..."}`
   - If GAPS_IDENTIFIED with must_fix > 0: revise plan to address gaps, re-invoke reviewer (max 3 total iterations)
   - If max iterations reached without APPROVED: proceed to gate anyway (let user decide)

### Persist Plan Review

Save all plan-reviewer iteration outputs to `docs/reviews/REVIEW-PLAN-{FEATURE_NAME}.md`
(same structure as spec review: header, per-iteration sections with timestamp/verdict/counts, full output).

### Phase 2 Gate

Print the following IN ORDER:

**1. Summary table:**

| Metric | Value |
|--------|-------|
| Tasks | N |
| Requirement Coverage | X/Y (Z%) |
| Architecture Decisions | N |
| Risks Identified | N |
| Review Iterations | N |

**2. Review iteration log** (plan-reviewer iterations, from parsed JSON decision lines)

**3. Artifact paths + deterministic excerpt:**

Print:
- **Plan saved to:** `{PLAN_PATH}`
- **Review saved to:** `docs/reviews/REVIEW-PLAN-{FEATURE_NAME}.md`
- **Tasks:** {print each TASK ID and title, one per line, max 10; if >10: "...and N more"}
- **Coverage:** {compact summary: "8/8 REQ mapped, 12/12 AC mapped, 3/3 NFR mapped"}
- **Quick access:**
  - VS Code: `code {PLAN_PATH}`
  - Terminal (bash): `cat {PLAN_PATH}`
  - Terminal (CMD): `type {PLAN_PATH}`

**4.** Then IMMEDIATELY call the AskUserQuestion tool. The question text MUST be self-contained
(the user may not see any output printed before the modal). Use the template **verbatim**
(same headings and sections), only substituting values. Do NOT omit sections even if empty —
write "None" or "N/A". If a value cannot be derived (e.g., coverage counts), write "Unknown"
rather than omitting the field.

```
## Plan Review Gate

**Plan:** `{PLAN_PATH}`
**Spec:** `{SPEC_PATH}`
**Review:** `docs/reviews/REVIEW-PLAN-{FEATURE_NAME}.md`

### Internal Review
| Iter | Must-Fix | Should-Fix | Verdict |
|------|----------|------------|---------|
| 1    | {N}      | {N}        | {V}     |
| ...  |          |            |         |

**Latest verdict:** {verdict} — {summary}

### Tasks (from plan)
- TASK-001: {Title}
- TASK-002: {Title}
- ...
{List each TASK ID and title, one per line, max 10. If >10: "...and N more"}

### Coverage
{X/Y REQ mapped, X/Y AC mapped, X/Y NFR mapped}

### Quick Open
- VS Code: `code {PLAN_PATH}`
- Bash: `head -120 {PLAN_PATH}`
- CMD: `type {PLAN_PATH}`
- PowerShell: `powershell -NoProfile -Command "Get-Content '{PLAN_PATH}' -TotalCount 120"`

### What each choice does
- **Approve plan** → Proceeds to Phase 3 (implementation) immediately
- **Request revisions** → Re-enters revision loop (revise plan → re-run reviewer → re-present this gate)
- **Stop pipeline** → Pauses pipeline. Resume later: `/spec-workflow:implement {PLAN_PATH}`
```

Options (buttons):
- "Approve plan — continue to implementation"
- "Request revisions"
- "Stop pipeline"

**5. Response handling:**
Same rules as Phase 1 Gate. If "Stop", print: "Pipeline paused. Resume with `/spec-workflow:implement {PLAN_PATH}`."
All other free text (including "yes", "ok", "approve") re-presents AskUserQuestion.

────────────────────────────────────────
PHASE 3: IMPLEMENT + PR REVIEW
────────────────────────────────────────

1. Use the `implementer` subagent (`@implementer`) to execute the plan
   - Pass PLAN_PATH only (NOT SPEC_PATH — information asymmetry preserved)
   - The plan's Requirement Mapping table gives the implementer spec-level completeness
     without exposing the full spec
   - Implementer creates/modifies files, writes tests, commits per task, creates PR

2. Use the `pr-reviewer` subagent (`@pr-reviewer`) to validate the PR
   - Pass SPEC_PATH and the PR (NOT PLAN_PATH — checks against spec, catches plan drift)
   - Reviewer runs in forked context
   - **Minimum 1 iteration required** — always invoke the reviewer at least once
   - Parse the JSON decision line from reviewer output:
     `{"verdict":"APPROVED"|"CHANGES_REQUESTED"|"REJECTED","must_fix":N,"should_fix":N,"summary":"..."}`
   - If issues found: fix and re-invoke (max 3 total iterations)
   - If max iterations reached without APPROVED: proceed to final output anyway

### Persist PR Review

Save all pr-reviewer iteration outputs to `docs/reviews/REVIEW-PR-{FEATURE_NAME}.md`
(same structure as spec/plan review files).

### Final Output

Print the following IN ORDER:

**1. PR review iteration log** (from parsed JSON decision lines)

**2. Coverage matrix** from the pr-reviewer

**3. Artifact paths:**
- **PR URL:** {url}
- **Review saved to:** `docs/reviews/REVIEW-PR-{FEATURE_NAME}.md`

**4. Test instructions:**

```
✅ Pipeline complete — PR ready for local testing

Test locally: git checkout {branch} && npm test
```

**Quick access:**
- Browser: `gh pr view --web`
- Terminal: `gh pr diff`

Run `/spec-workflow:review` for a standalone re-review if desired.
