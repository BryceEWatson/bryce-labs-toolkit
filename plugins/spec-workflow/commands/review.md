---
description: Manually trigger PR review against specification
argument-hint: "[path-to-spec.md]"
allowed-tools: Read, Grep, Glob, Bash(gh *, git *, npm test, pytest), Write, Task
---

spec-workflow v1.0.0 · Review

You are running a standalone spec-workflow review.

## Review File Semantics

Review files (`docs/reviews/REVIEW-*.md`) are local artifacts only. Do NOT commit them.
Use the Write tool to create/update them; users can commit manually if desired.

## Artifact Write Rules

1. ALWAYS use the **Write** tool to persist REVIEW files.
   - NEVER use Bash heredocs (`cat <<EOF`), `echo "..." >`, or `python -c "..."` to write artifact content.
2. All generated artifacts MUST contain only ASCII characters (U+0000-U+007F).
   - Use ASCII status markers: `[x]` (done), `[ ]` (pending), `[!]` (critical), `[~]` (warning).
   - Do NOT use emoji: no checkmarks, crosses, colored circles, or warning triangles.
   - Reason: Non-ASCII causes cp1252 encoding failures on Windows consoles and file I/O.

## Windows + Bash Path Rules

When executing Bash commands on Windows (non-WSL):
- ALWAYS use forward-slash paths in Bash arguments
- NEVER pass raw backslash paths (`c:\Users\...`) into Bash
- After `cd` to the repo root, use repo-relative paths

Example: `gh pr diff` (no path needed), `git diff docs/specs/SPEC-foo.md` (relative path)

### Preflight (before every Bash call)

Before executing ANY Bash command, verify:
1. The command string does NOT contain `:\` or `\\` (Windows backslash paths).
   - If found: rewrite to forward slashes (e.g., `c:\Users\Bryce` -> `c:/Users/Bryce`).
2. If the operation needs a Windows-only command (`type`, `dir`, `del`), route through
   `cmd /c "..."` or `powershell -NoProfile -Command "..."` instead of bare Bash.
3. All file paths use repo-relative paths where possible (after an initial `cd`).

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
| REQ-001 | {desc} | [x] | `file:line` | `test:line` |
| REQ-002 | {desc} | [~] | `file` | Missing |
| REQ-003 | {desc} | [!] | - | - |

**Summary:** X/Y implemented (Z%)

## Issues

### [!!] Critical

1. **{Issue}**
   - Location: `file:line`
   - Expected: {what}
   - Found: {what}

### [~] Warnings

1. **{Issue}**
   - Recommendation: {fix}

## Verdict

- [ ] [x] Approved
- [ ] [~] Changes Requested
- [ ] [!] Rejected

## Notes for Tester

- [ ] {test scenario}
```

Save the review to: `docs/reviews/REVIEW-{pr-number}.md`

The review MUST include:
- Coverage matrix (each REQ-* status)
- Issues (critical / warning / info)
- Verdict: Approved / Changes Requested / Rejected
- Notes for tester
