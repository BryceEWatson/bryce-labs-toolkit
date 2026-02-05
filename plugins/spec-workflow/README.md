# Spec-Workflow Plugin

Spec-driven development with automated review loops.

## Installation

```bash
/plugin marketplace add BryceEWatson/bryce-labs-toolkit
/plugin install spec-workflow@bryce-labs
```

## Commands

| Command | Description |
|---------|-------------|
| `/spec-workflow:spec <description>` | Generate SPEC.md |
| `/spec-workflow:plan <spec-path>` | Generate PLAN.md with review loop |
| `/spec-workflow:implement <plan-path>` | Execute with PR review loop |
| `/spec-workflow:review [spec-path]` | Manual PR review |

## Workflow

```bash
# 1. Create specification
/spec-workflow:spec "Add user authentication"
# Review and approve

# 2. Create plan (internal review loop)
/spec-workflow:plan docs/specs/SPEC-user-auth.md
# Review and approve

# 3. Implement (internal PR review loop)
/spec-workflow:implement docs/plans/PLAN-user-auth.md
# Test locally, then merge
```

## Architecture

### Information Asymmetry

- PRReviewer checks SPEC, not PLAN (catches plan drift)
- Implementer cannot see SPEC (forces plan adherence)
- Reviewers cannot see producer reasoning (prevents bias)

### Internal Review Loops

- `context: fork` isolates reviewer context
- Prompt-based Stop hooks evaluate completion
- Max 5 iterations before escalating to user

## License

Apache-2.0
