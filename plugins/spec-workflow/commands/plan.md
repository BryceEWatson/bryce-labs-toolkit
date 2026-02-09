---
description: Generate implementation plan with automated review loop
argument-hint: "<path-to-spec.md>"
allowed-tools: Read, Grep, Glob, WebSearch, Write, Bash(git status, git log *, git diff *, git branch *, git show *), Task, AskUserQuestion
---

spec-workflow v1.0.0 · Plan

You are running the standalone plan generation stage.

## Review File Semantics

Review files (`docs/reviews/REVIEW-*.md`) are local artifacts only. Do NOT commit them.
Use the Write tool to create/update them; users can commit manually if desired.

## Argument Parsing

Determine the type of $ARGUMENTS:

1. **File path** (contains `/` or `\` or ends in `.md`):
   - SPEC_PATH = $ARGUMENTS
   - Derive FEATURE_NAME from basename: `SPEC-foo-bar.md` → `foo-bar`

2. **Freeform text** (no path separators, does not end in `.md`):
   - FEATURE_NAME = kebab-case($ARGUMENTS), e.g., "Add user auth" → `add-user-auth`
   - SPEC_PATH = `docs/specs/SPEC-{FEATURE_NAME}.md`
   - Verify SPEC_PATH exists. If not, ask user for the correct spec path.

## Step 1: Read Inputs

Read the specification at SPEC_PATH.
Extract all REQ-*, AC-*, NFR-* identifiers from the spec.

## Step 2: Explore Codebase

Explore the codebase for existing patterns, integration points, and conventions using read-only tools.

## Step 3: Generate Plan

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

Create the implementation plan following the template:
- Requirement Mapping Table — every REQ-*/AC-*/NFR-* MUST map to at least one task
- Tasks: TASK-001, TASK-002, ... with dependencies, specific file paths, and test files
- Architecture Decisions with rationale
- Risk Assessment

Save to: `docs/plans/PLAN-{FEATURE_NAME}.md`

## Step 4: Internal Review Loop

Use the `plan-reviewer` subagent (`@plan-reviewer`) to validate the plan. Pass it:
- SPEC: SPEC_PATH
- PLAN: docs/plans/PLAN-{FEATURE_NAME}.md

The plan-reviewer runs in forked context and checks:
- Every REQ-* mapped to task(s)
- Every AC-* has test coverage
- Architecture decisions have rationale
- Risks identified

**Minimum 1 iteration required** — always invoke the reviewer at least once.

Parse the JSON decision line from reviewer output:
`{"verdict":"APPROVED"|"GAPS_IDENTIFIED","must_fix":N,"should_fix":N,"summary":"..."}`

If the reviewer finds gaps with must_fix > 0, revise the plan and re-invoke the reviewer. Repeat up to 3 total iterations.
If max iterations reached without APPROVED, proceed to output anyway (let user decide).

### Persist Plan Review

Save all plan-reviewer iteration outputs to `docs/reviews/REVIEW-PLAN-{FEATURE_NAME}.md`:

```
# Plan Review: {Feature Name}

**Plan:** docs/plans/PLAN-{FEATURE_NAME}.md
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

## Step 5: Present Results

Print the following IN ORDER:

**1. Summary table:**

| Metric | Value |
|--------|-------|
| Tasks | N |
| Requirement Coverage | X/Y (Z%) |
| Architecture Decisions | N |
| Risks Identified | N |
| Review Iterations | N |

**2. Review iteration log** (from parsed JSON decision lines):

| Iteration | Must-Fix | Should-Fix | Verdict |
|-----------|----------|------------|---------|

**3. Artifact paths + excerpt:**

- **Plan saved to:** `docs/plans/PLAN-{FEATURE_NAME}.md`
- **Review saved to:** `docs/reviews/REVIEW-PLAN-{FEATURE_NAME}.md`
- **Tasks:** {TASK IDs and titles, one per line, max 10}
- **Quick access:**
  - VS Code: `code docs/plans/PLAN-{FEATURE_NAME}.md`
  - Terminal (bash): `cat docs/plans/PLAN-{FEATURE_NAME}.md`
  - Terminal (CMD): `type docs\plans\PLAN-{FEATURE_NAME}.md`

**4.** Then IMMEDIATELY call the AskUserQuestion tool. The question text MUST be self-contained
(the user may not see any output printed before the modal). Build the question text using this
Gate Question Standard template, substituting actual values:

```
## Plan Review Gate

**Plan:** `docs/plans/PLAN-{FEATURE_NAME}.md`
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
- VS Code: `code docs/plans/PLAN-{FEATURE_NAME}.md`
- Bash: `head -120 docs/plans/PLAN-{FEATURE_NAME}.md`
- CMD: `type docs\plans\PLAN-{FEATURE_NAME}.md`
- PowerShell: `powershell -NoProfile -Command "Get-Content 'docs/plans/PLAN-{FEATURE_NAME}.md' -TotalCount 120"`

### What each choice does
- **Approve plan** → Plan is finalized. Proceed with: `/spec-workflow:implement docs/plans/PLAN-{FEATURE_NAME}.md`
- **Request revisions** → Re-enters revision loop (revise plan → re-run reviewer → re-present this gate)
- **Done** → Plan saved. Resume implementation later: `/spec-workflow:implement docs/plans/PLAN-{FEATURE_NAME}.md`
```

Options (buttons):
- "Approve plan"
- "Request revisions"
- "Done — review later"

**5. Response handling:**
- User selects "Approve plan" → print: "Plan approved. Run `/spec-workflow:implement docs/plans/PLAN-{FEATURE_NAME}.md` to implement."
- User selects "Request revisions" → revise plan, re-save, re-run plan-reviewer, re-present gate.
- User selects "Done" → print: "Plan saved. Resume with `/spec-workflow:implement docs/plans/PLAN-{FEATURE_NAME}.md`."
- User provides free text containing revision instructions → treat as "Request revisions".
- User provides free text containing "stop", "pause", or "done" → treat as "Done".
- **All other free text** (including "yes", "ok", "approve") → re-present AskUserQuestion. Only explicit button selection advances.
