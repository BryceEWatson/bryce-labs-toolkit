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

## Artifact Write Rules

1. ALWAYS use the **Write** tool to persist REVIEW files and any code artifacts.
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
- `git checkout -b feature/my-feature`

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
[x] Implementation complete — PR ready for local testing

Test locally: git checkout {branch} && npm test
```

Run `/spec-workflow:review` for a standalone re-review if desired.
