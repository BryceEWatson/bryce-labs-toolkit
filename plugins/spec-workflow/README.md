# Spec-Workflow Plugin

Spec-driven development with automated review loops.

## Installation

### From Marketplace

```bash
/plugin marketplace add BryceEWatson/bryce-labs-toolkit
/plugin install spec-workflow@bryce-labs
```

### From Local Path (Development/PR Testing)

For testing unreleased changes or validating a PR before merge:

```bash
# Clone the toolkit repository
git clone https://github.com/BryceEWatson/bryce-labs-toolkit.git
cd bryce-labs-toolkit

# Checkout the PR branch (if testing a PR)
git checkout feature/branch-name

# Install from local path (use absolute path)
/plugin install /absolute/path/to/bryce-labs-toolkit/plugins/spec-workflow
```

The marketplace follows the default branch. Use local path installation to test
feature branches or PR changes before they're merged.

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

### Review Loop Behavior

The automated review loops use Claude Code's prompt-based Stop hooks defined in
agent frontmatter. Loop behavior depends on Claude Code's hook support:

- **If hooks work**: Reviewer agents automatically re-invoke after finding gaps
- **If hooks don't trigger**: Manually re-run the command after making edits

An alternative command-based hook approach using Python is available in
`hooks/hooks.json` (disabled by default). To enable, rename `_SubagentStop`
to `SubagentStop`.

### File Naming

Commands generate files with kebab-case feature names derived from your input:
- `/spec-workflow:spec "Add user authentication"` → `SPEC-user-auth.md`
- `/spec-workflow:plan docs/specs/SPEC-user-auth.md` → `PLAN-user-auth.md`

## Compatibility

Requires Claude Code 2.1.0+ with support for:
- `context: fork` in agent frontmatter
- Prompt-based Stop hooks (`type: prompt`)
- Plugin path variables (`${CLAUDE_PLUGIN_ROOT}`)

## License

Apache-2.0
