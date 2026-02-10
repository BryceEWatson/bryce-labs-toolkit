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
| `/spec-workflow:spec <description>` | Generate SPEC.md and run full pipeline |
| `/spec-workflow:plan <spec-path>` | Generate PLAN.md with review loop |
| `/spec-workflow:implement <plan-path>` | Execute with PR review loop |
| `/spec-workflow:review [spec-path]` | Manual PR review |
| `/spec-workflow:reset [flags]` | Clear spec-workflow artifacts |

## Workflow

### Full Pipeline (Recommended)

A single command runs the entire pipeline, pausing for your approval between stages:

```bash
/spec-workflow:spec "Add user authentication"
# → Generates spec → asks approval → generates plan (with internal review loop)
#   → asks approval → implements (with PR review loop) → presents PR
```

#### Quiet Gates Mode

Use `--quiet-gates` to reduce pre-gate output. Instead of printing full summary tables
and excerpts before each approval gate, only artifact paths and the latest review verdict
are shown. The modal options still provide full review access.

```bash
/spec-workflow:spec --quiet-gates "Add user authentication"
/spec-workflow:plan --quiet-gates docs/specs/SPEC-user-auth.md
```

### Individual Stages

Each stage can still be invoked standalone:

```bash
/spec-workflow:plan docs/specs/SPEC-user-auth.md
/spec-workflow:implement docs/plans/PLAN-user-auth.md
/spec-workflow:review
```

## Architecture

### Information Asymmetry

- PRReviewer checks SPEC, not PLAN (catches plan drift)
- Implementer cannot see SPEC (forces plan adherence)
- Reviewers cannot see producer reasoning (prevents bias)

### Internal Review Loops

Each phase runs a mandatory internal review (minimum 1 iteration, max 3):

| Phase | Reviewer | Checks Against |
|-------|----------|----------------|
| Spec | SpecReviewer | Spec quality (completeness, testability, RFC 2119) |
| Plan | PlanReviewer | Spec (requirement coverage, AC mapping) |
| Implementation | PRReviewer | Spec (catches plan drift) |

- `context: fork` isolates reviewer context
- Prompt-based Stop hooks + JSON decision lines evaluate completion
- Reviewers output machine-parsable `{"verdict":..., "must_fix":N, ...}` for iteration tracking

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

### Review Files

Reviews are persisted to `docs/reviews/` as local artifacts (not committed automatically):

| Source | File Pattern | Example |
|--------|-------------|---------|
| Spec review (pipeline) | `REVIEW-SPEC-{feature}.md` | `REVIEW-SPEC-dark-mode.md` |
| Plan review (pipeline) | `REVIEW-PLAN-{feature}.md` | `REVIEW-PLAN-dark-mode.md` |
| PR review (pipeline) | `REVIEW-PR-{feature}.md` | `REVIEW-PR-dark-mode.md` |
| Standalone PR review | `REVIEW-{pr-number}.md` | `REVIEW-42.md` |

## Compatibility

Requires Claude Code 2.1.0+ with support for:
- `context: fork` in agent frontmatter
- Prompt-based Stop hooks (`type: prompt`)

## Reset Artifacts

Remove generated specs, plans, and reviews to start from a clean slate.

### Plugin Command (Claude Code)

```bash
/spec-workflow:reset --dry-run              # Preview what would be deleted
/spec-workflow:reset --force                # Delete all artifacts (no prompt)
/spec-workflow:reset --feature dark-mode    # Delete only dark-mode artifacts
```

### Shell Scripts

**Git Bash / macOS / Linux:**
```bash
./tools/spec-workflow-reset.sh --dry-run
./tools/spec-workflow-reset.sh --force
./tools/spec-workflow-reset.sh --force --feature dark-mode
```

**Windows CMD:**
```cmd
tools\spec-workflow-reset.cmd --dry-run
tools\spec-workflow-reset.cmd --force
tools\spec-workflow-reset.cmd --force --feature dark-mode
```

Safety: `.gitkeep` files are always preserved. Only `SPEC-*.md`, `PLAN-*.md`, and
`REVIEW-*.md` files are deleted. See [artifact-contract.md](../../docs/reference/artifact-contract.md)
for the full reset contract.

**Scope note:** A full reset (no `--feature`) deletes **all** `REVIEW-*.md` files, including
standalone `REVIEW-{pr-number}.md` files. Use `--feature <name>` to scope deletion to a
single feature's artifacts (SPEC, PLAN, REVIEW-SPEC, REVIEW-PLAN, REVIEW-PR only).

## Developer Workflow (Local Plugin Testing)

Claude Code caches plugins and runs from the cache, not from your working directory.
See [UPSTREAM.md](UPSTREAM.md) for full details.

### Quick Sync

After editing plugin files, sync to cache:

**Git Bash (Windows — NOT WSL):**
```bash
./tools/spec-workflow-dev-sync.sh
```

**CMD (Windows):**
```cmd
tools\spec-workflow-dev-sync.cmd
```

Then open a **new chat window**.

The scripts auto-detect the installed cache version directory, so you don't need to
match `plugin.json` version with the installed version.

### Verification

The first output from `/spec-workflow:spec` should include `ORCH_SENTINEL__9F2E`.
If it doesn't, the cache was rebuilt from the remote — re-run the sync script.

The sync scripts exit non-zero if the sentinel is missing, preventing invalid syncs.

## Known Issue (Upstream: Claude Code)

Claude Code's slash-command picker may auto-submit a selected command immediately,
which prevents typing arguments first (e.g., `/spec-workflow:spec <feature-description>`).

**Workaround:** Type the command manually and then add arguments, e.g.:
`/spec-workflow:spec ` + your feature description (or use tab completion).

**Upstream:** https://github.com/anthropics/claude-code/issues/23781

## License

Apache-2.0
