---
description: Execute implementation plan with automated PR review loop
argument-hint: "<path-to-plan.md>"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, AskUserQuestion
---

spec-workflow v1.0.0 · Implement

You are running the standalone implementation stage.

## Review File Semantics

Review files (`docs/reviews/REVIEW-*.md`) are local artifacts only. Do NOT commit them.
Use the Write tool to create/update them; users can commit manually if desired.

## Argument Parsing

Determine the type of $ARGUMENTS:

1. **File path** (contains `/` or `\` or ends in `.md`):
   - PLAN_PATH = $ARGUMENTS
   - Derive FEATURE_NAME from basename: `PLAN-foo-bar.md` → `foo-bar`

2. **Freeform text** (no path separators, does not end in `.md`):
   - FEATURE_NAME = kebab-case($ARGUMENTS), e.g., "user auth" → `user-auth`
   - PLAN_PATH = `docs/plans/PLAN-{FEATURE_NAME}.md`
   - Verify PLAN_PATH exists. If not, ask user for the correct plan path.

Read the plan file and extract the `Spec:` field to get SPEC_PATH (required in all plans).

## Step 1: Read Plan

Read the plan at PLAN_PATH.

**Critical constraint:** You do NOT have access to SPEC.md. Work only from PLAN.md. This forces strict plan adherence; plan drift is caught during review. The plan's Requirement Mapping table provides spec-level completeness context.

## Step 2: Execute Tasks

Parse the plan for tasks and dependencies. Execute each task in order:

1. Create/modify files as specified in the plan
2. Write tests alongside implementation
3. Commit per task: `task(TASK-xxx): description`

Do NOT add creative embellishments beyond what the plan specifies. If blocked by missing info in the plan, flag and ask rather than guessing.

## Step 3: Create PR

Create a feature branch and PR:

```bash
git checkout -b feature/{FEATURE_NAME}
git push -u origin feature/{FEATURE_NAME}
gh pr create --title "{feature}" --body "Implements PLAN-{FEATURE_NAME}.md"
```

## Step 4: Internal Review Loop

Use the `pr-reviewer` subagent (`@pr-reviewer`) to validate the implementation. Pass it:
- SPEC: SPEC_PATH (derived from plan's Spec field)
- PR: current PR diff

The pr-reviewer checks against SPEC.md (not PLAN.md) to catch plan drift:
- Every REQ-* implemented
- Every AC-* has passing test
- Code quality standards met

**Minimum 1 iteration required** — always invoke the reviewer at least once.

Parse the JSON decision line from reviewer output:
`{"verdict":"APPROVED"|"CHANGES_REQUESTED"|"REJECTED","must_fix":N,"should_fix":N,"summary":"..."}`

If the reviewer finds issues with must_fix > 0, fix them and re-invoke the reviewer. Repeat up to 3 total iterations.
If max iterations reached without APPROVED, proceed to output anyway (let user decide).

### Persist PR Review

Save all pr-reviewer iteration outputs to `docs/reviews/REVIEW-PR-{FEATURE_NAME}.md`:

```
# PR Review: {Feature Name}

**PR:** {PR URL}
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

## Step 5: Present Results

Print the following IN ORDER:

**1. PR review iteration log** (from parsed JSON decision lines):

| Iteration | Must-Fix | Should-Fix | Verdict |
|-----------|----------|------------|---------|

**2. Coverage matrix** (each REQ-* and AC-* status from pr-reviewer)

**3. Artifact paths:**

- **PR URL:** {url}
- **Review saved to:** `docs/reviews/REVIEW-PR-{FEATURE_NAME}.md`
- **Quick access:**
  - Browser: `gh pr view --web`
  - Terminal: `gh pr diff`

**4. Test instructions:**

```
✅ Implementation complete — PR ready for local testing

Test locally: git checkout {branch} && npm test
```

Run `/spec-workflow:review` for a standalone re-review if desired.
