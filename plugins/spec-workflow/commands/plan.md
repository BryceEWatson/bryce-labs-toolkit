---
description: Generate implementation plan with automated review loop
argument-hint: "<path-to-spec.md>"
allowed-tools: Read, Grep, Glob, WebSearch, Write, Bash(git status, git log *, git diff *, git branch *, git show *, code *), Task, AskUserQuestion
---

spec-workflow v1.0.0 · Plan

You are running the standalone plan generation stage.

## Review File Semantics

Review files (`docs/reviews/REVIEW-*.md`) are local artifacts only. Do NOT commit them.
Use the Write tool to create/update them; users can commit manually if desired.

## Artifact Write Rules

1. ALWAYS use the **Write** tool to persist PLAN and REVIEW files.
   - NEVER use Bash heredocs (`cat <<EOF`), `echo "..." >`, or `python -c "..."` to write artifact content.
2. All generated artifacts MUST contain only ASCII characters (U+0000-U+007F).
   - Use ASCII status markers: `[x]` (done), `[ ]` (pending), `[!]` (critical), `[~]` (warning).
   - Do NOT use emoji: no checkmarks, crosses, colored circles, or warning triangles.
   - Reason: Non-ASCII causes cp1252 encoding failures on Windows consoles and file I/O.

## Windows + Bash Path Rules

When executing Bash commands on Windows (non-WSL):
- ALWAYS use forward-slash paths: `"c:/Users/Bryce/Projects/bryce-labs-toolkit"`
- NEVER use `/mnt/c/...` unless the environment is confirmed to be WSL
- NEVER pass raw backslash paths (`c:\Users\...`) into Bash — backslashes are stripped or misinterpreted
- After `cd` to the repo root, use repo-relative paths for all subsequent commands

Canonical examples:
- `cd "c:/Users/Bryce/Projects/bryce-labs-toolkit" && ls tools/`
- `cd "c:/Users/Bryce/Projects/bryce-labs-toolkit" && node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'))"`

### Preflight (before every Bash call)

Before executing ANY Bash command, verify:
1. The command string does NOT contain `:\` or `\\` (Windows backslash paths).
   - If found: rewrite to forward slashes (e.g., `c:\Users\Bryce` -> `c:/Users/Bryce`).
2. If the operation needs a Windows-only command (`type`, `dir`, `del`), route through
   `cmd /c "..."` or `powershell -NoProfile -Command "..."` instead of bare Bash.
3. All file paths use repo-relative paths where possible (after an initial `cd`).

## Tool Error Retry Rules

If a Bash call errors with `<tool_use_error>` or fails unexpectedly:
1. Retry ONCE with a simpler command:
   - Remove command chaining (no `&&`) — run one command per Bash call
   - Use repo-relative paths after a separate `cd`
   - Avoid `find` with Windows backslash paths
2. Do NOT issue consecutive Bash calls without reading/handling the previous result
3. Prefer one Bash call per step to minimize concurrency errors

## Argument Parsing

First, check if `$ARGUMENTS` contains `--quiet-gates`. If so, set QUIET_GATES = true and remove the flag from the text. Otherwise, QUIET_GATES = false.

Determine the type of the remaining arguments:

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
| REQ-001 | TASK-001 | [x] Mapped |
| AC-001 | TASK-001 (test) | [x] Mapped |

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

**If QUIET_GATES is enabled**, print only:
- **Plan:** `docs/plans/PLAN-{FEATURE_NAME}.md`
- **Review:** `docs/reviews/REVIEW-PLAN-{FEATURE_NAME}.md`
- **Latest:** {LATEST_VERDICT} (must_fix={MUST_FIX}, should_fix={SHOULD_FIX})
- Use the gate options below to review or open in VS Code.

Then skip directly to step **4** (AskUserQuestion) below.

**Otherwise (default)**, print the following IN ORDER:

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

**4.** Then IMMEDIATELY call the AskUserQuestion tool.
Keep the question text SHORT (max 5 lines). Move all details into option descriptions.

QUESTION TEXT (substitute values in braces):

PLAN GATE
Plan: docs/plans/PLAN-{FEATURE_NAME}.md | Review: docs/reviews/REVIEW-PLAN-{FEATURE_NAME}.md
Latest: {LATEST_VERDICT} {MUST_FIX}/{SHOULD_FIX} | Issues: {TOP_ISSUES}
History: {ITER_SUMMARY}
Choose an action.

TOP_ISSUES derivation:
- From the latest plan-reviewer output, extract up to 3 bullet items from "### Must-Fix" (first) then "### Should-Fix".
- Use only the first ~50 chars of each bullet (the ID + title portion).
- Join with "; ". If all sections contain only "- None", output "None".

ITER_SUMMARY derivation:
- For each completed review iteration, format: "{N}:{must_fix}/{should_fix}"
- Join with " -> ". Example: "1:2/1 -> 2:0/0"

OPTIONS (each option MUST have both label and description):

- Label: "Approve plan"
  Description: "Reviewer: {LATEST_SUMMARY}. Plan approved and finalized. Run /spec-workflow:implement to begin implementation. Coverage: REQ {REQ_MAPPED}/{REQ_TOTAL}, AC {AC_MAPPED}/{AC_TOTAL}, NFR {NFR_MAPPED}/{NFR_TOTAL}. Tasks: {TASK_COUNT} total."

- Label: "Request revisions"
  Description: "Last review: {LATEST_VERDICT} (must_fix={MUST_FIX}, should_fix={SHOULD_FIX}). Summary: {LATEST_SUMMARY}. Reviewer requested: {REQUESTED_REVISIONS_SNIPPET}. Selecting this will revise the plan, re-run plan-reviewer, then re-present this gate."

  REQUESTED_REVISIONS_SNIPPET derivation:
  - If MUST_FIX==0 AND SHOULD_FIX==0: use "None (approved)."
  - Else: extract from the latest plan-reviewer full output:
    - Up to 3 bullets from the "### Must-Fix" section
    - Up to 3 bullets from the "### Should-Fix" section
    - Format as a compact inline list, e.g., "Must-fix: REQ-003 unmapped, AC-005 no test. Should-fix: TASK-002 add error handling."
    - If "### Must-Fix" or "### Should-Fix" sections are missing in the reviewer output, fall back to: "See Summary above; open the review log for details."

- Label: "Review now (open in VS Code)"
  Description: "Opens plan and review log in VS Code for review. This gate re-appears after. Plan: docs/plans/PLAN-{FEATURE_NAME}.md. Review: docs/reviews/REVIEW-PLAN-{FEATURE_NAME}.md. Fallback (CMD): type docs\plans\PLAN-{FEATURE_NAME}.md"

- Label: "Done — review later"
  Description: "Plan saved. Resume later with: /spec-workflow:implement docs/plans/PLAN-{FEATURE_NAME}.md"

**5. Response handling:**
- User selects "Approve plan" → print: "Plan approved. Run `/spec-workflow:implement docs/plans/PLAN-{FEATURE_NAME}.md` to implement."
- User selects "Request revisions" → revise plan, re-save, re-run plan-reviewer, re-present gate.
- User selects "Review now" → run `code "docs/plans/PLAN-{FEATURE_NAME}.md"` and `code "docs/reviews/REVIEW-PLAN-{FEATURE_NAME}.md"` via Bash. If `code` command fails, print fallback: `type docs\plans\PLAN-{FEATURE_NAME}.md` (CMD) or `cat docs/plans/PLAN-{FEATURE_NAME}.md` (bash). Then re-present the same AskUserQuestion gate (do NOT advance).
- User selects "Done" → print: "Plan saved. Resume with `/spec-workflow:implement docs/plans/PLAN-{FEATURE_NAME}.md`."
- User provides free text containing revision instructions → treat as "Request revisions".
- User provides free text containing "stop", "pause", or "done" → treat as "Done".
- **All other free text** (including "yes", "ok", "approve") → re-present AskUserQuestion. Only explicit button selection advances.
