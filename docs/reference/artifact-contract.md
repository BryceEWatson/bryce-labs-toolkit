# Artifact Reset Contract

Tools that generate output files follow a standard reset contract for safe cleanup.

## Output Roots

| Tool | Output Location | Scope |
|------|----------------|-------|
| spec-workflow | `docs/specs/SPEC-*.md`, `docs/plans/PLAN-*.md`, `docs/reviews/REVIEW-*.md` | Per-feature or all |
| story-miner | `.story-miner/` | Entire directory contents |
| lessons-extractor | `docs/ai/lessons-extractor/` | Entire directory contents |

## Reset Expectations

Every reset implementation must support:

| Flag | Behavior |
|------|----------|
| `--dry-run` | Show what would be deleted, delete nothing |
| `--force` | Skip interactive confirmation |
| (default) | Prompt for confirmation before deleting |

### Safety Rules

- **Never delete `.gitkeep` files** — these preserve empty directory structure in git
- **Never delete outside known output locations** — scoped to the tool's declared outputs only
- **Cross-platform** — provide both `.sh` (Git Bash / macOS / Linux) and `.cmd` (Windows CMD)

## Reset Scripts

Scripts live in `tools/` and follow the naming pattern `<tool>-reset.{sh,cmd}`:

| Script | Tool |
|--------|------|
| `tools/spec-workflow-reset.sh` / `.cmd` | spec-workflow |
| `tools/story-miner-reset.sh` / `.cmd` | story-miner |
| `tools/lessons-extractor-reset.sh` / `.cmd` | lessons-extractor |

### spec-workflow

Supports `--feature <name>` to scope deletion to a single feature's artifacts.

**Scope:** A full reset (no `--feature`) deletes all `REVIEW-*.md` files, including standalone
`REVIEW-{pr-number}.md`. Use `--feature <name>` to limit to SPEC, PLAN, REVIEW-SPEC,
REVIEW-PLAN, and REVIEW-PR for that feature only.

```bash
# Preview
./tools/spec-workflow-reset.sh --dry-run

# Delete all
./tools/spec-workflow-reset.sh --force

# Delete one feature
./tools/spec-workflow-reset.sh --force --feature dark-mode

# Plugin command (in Claude Code)
/spec-workflow:reset --dry-run
/spec-workflow:reset --force
/spec-workflow:reset --feature dark-mode
```

### story-miner / lessons-extractor

Prefer the preprocessor's `--clear` for consistency. Fall back to direct file deletion if `node` is unavailable.

Supports `--output <dir>` to target a non-default output directory.

```bash
# story-miner
./tools/story-miner-reset.sh --dry-run
./tools/story-miner-reset.sh --force

# lessons-extractor
./tools/lessons-extractor-reset.sh --dry-run
./tools/lessons-extractor-reset.sh --force
```

## Adding Reset to a New Tool

1. Define the tool's output root(s) and file patterns
2. Create `tools/<tool>-reset.sh` and `tools/<tool>-reset.cmd`
3. Implement `--dry-run`, `--force`, and default confirmation behavior
4. Preserve `.gitkeep` files
5. Update this document with the new tool's entry
6. If the tool has a Claude Code command, add a `reset` command variant
