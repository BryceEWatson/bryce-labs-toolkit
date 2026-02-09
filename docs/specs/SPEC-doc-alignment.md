# Specification: Documentation Alignment

**Version:** 2.1
**Status:** Draft
**Date:** 2026-02-09

## Overview

The bryce-labs-toolkit documentation has drifted from the actual codebase state. Several components that exist in code are missing from documentation, cross-references between docs are incomplete, and structural descriptions don't match the filesystem. This specification defines the full set of documentation corrections needed to bring all documentation files into alignment with the code as it exists today.

The scope covers documentation files (.md) and the marketplace configuration (.json) — no skill/tool code changes, no new features, no refactoring. Every requirement targets a specific file and a specific gap verified by reading both the documentation and the filesystem.

## Requirements

### Functional

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | README.md SHALL add a `**[story-miner](skills/story-miner/)**` entry to the Skills section with description `Mine Claude Code session history for publishable development stories`, matching the link/bold pattern of the existing cleanup and lessons-extractor entries | Must |
| REQ-002 | README.md SHALL add `**[spec-workflow-reset](tools/spec-workflow-reset.sh)**` to the Tools section with description `Reset spec-workflow artifacts (specs, plans, reviews)` | Must |
| REQ-003 | README.md SHALL add `**[story-miner-reset](tools/story-miner-reset.sh)**` to the Tools section with description `Reset story-miner output artifacts` | Must |
| REQ-004 | README.md SHALL add `**[lessons-extractor-reset](tools/lessons-extractor-reset.sh)**` to the Tools section with description `Reset lessons-extractor output artifacts` | Must |
| REQ-005 | README.md SHALL add `**[spec-workflow-dev-sync](tools/spec-workflow-dev-sync.sh)**` to the Tools section with description `Sync plugin edits to Claude Code cache for local development` | Must |
| REQ-006 | README.md SHALL add `story-miner/` under `skills/` in the Repository Structure code block | Must |
| REQ-007 | README.md SHALL add `plugins/` with `spec-workflow/` subtree in the Repository Structure code block | Must |
| REQ-008 | README.md SHALL update the `tools/` section of the Repository Structure code block to list all 12 files: `skills-sync`, `skills-sync.cmd`, `skills-sync.js`, `lint-skills.sh`, `spec-workflow-dev-sync.sh`, `spec-workflow-dev-sync.cmd`, `spec-workflow-reset.sh`, `spec-workflow-reset.cmd`, `story-miner-reset.sh`, `story-miner-reset.cmd`, `lessons-extractor-reset.sh`, `lessons-extractor-reset.cmd` | Must |
| REQ-009 | docs/index.md SHALL add a `### cleanup` subsection to the Skills section with link `[SKILL.md](../skills/cleanup/SKILL.md)` and one-line description `Post-merge git branch cleanup with safety checks` | Must |
| REQ-010 | docs/index.md SHALL add a `### story-miner` subsection to the Skills section with links to `[SKILL.md](../skills/story-miner/SKILL.md)`, `[Examples](../skills/story-miner/examples/)`, and `[Implementation Plan](story-miner/IMPLEMENTATION_PLAN.md)` | Must |
| REQ-011 | docs/index.md SHALL add a `## Plugins` section containing a `### spec-workflow` subsection with link `[README](../plugins/spec-workflow/README.md)` and one-line description `Spec-driven development with automated review loops` | Must |
| REQ-012 | docs/index.md SHALL add `[Artifact Reset Contract](reference/artifact-contract.md)` to the Reference list under Contents | Must |
| REQ-013 | docs/reference/repo-layout.md SHALL add a `plugins/` tree under Current Structure containing `spec-workflow/` with subdirectories: `.claude-plugin/` (`plugin.json`), `agents/` (`spec-builder.md`, `planner.md`, `implementer.md`, `plan-reviewer.md`, `pr-reviewer.md`, `spec-reviewer.md`), `commands/` (`spec.md`, `plan.md`, `implement.md`, `review.md`, `reset.md`), `skills/` (`spec-driven-dev/`), `hooks/` (`hooks.json`), `scripts/` (`check-review-result.py`), `README.md`, `UPSTREAM.md` | Must |
| REQ-014 | docs/reference/repo-layout.md SHALL add `story-miner/` to the skills/ tree with: `SKILL.md`, `config.json`, `config.schema.json`, `bin/` (`story-preprocessor.cjs`, `story-preprocessor`, `story-preprocessor.cmd`), `prompts/` (`score_candidates.md`, `write_story.md`, `render_outputs.md`), `eval/` (`run-selftest.cjs`, `fixtures/`), `examples/` (`sample-input.md`, `sample-output.md`) | Must |
| REQ-015 | docs/reference/repo-layout.md SHALL update the tools/ tree to list all 12 files: `skills-sync`, `skills-sync.cmd`, `skills-sync.js`, `lint-skills.sh`, `spec-workflow-dev-sync.sh`, `spec-workflow-dev-sync.cmd`, `spec-workflow-reset.sh`, `spec-workflow-reset.cmd`, `story-miner-reset.sh`, `story-miner-reset.cmd`, `lessons-extractor-reset.sh`, `lessons-extractor-reset.cmd` | Must |
| REQ-016 | docs/reference/repo-layout.md SHALL add `reference/artifact-contract.md` and `story-miner/` (containing `IMPLEMENTATION_PLAN.md`) to the docs/ tree | Must |
| REQ-017 | docs/reference/repo-layout.md SHALL add `.claude-plugin/marketplace.json` as a root-level entry in the tree (after `.gitignore`) | Must |
| REQ-018 | SECURITY.md SHALL add story-miner to the Log Processing section, noting: (a) it processes the same session logs as lessons-extractor, (b) it applies at least 17 extended redaction patterns compared to lessons-extractor's 7, and (c) it includes a post-pipeline output scanner that detects leaked secrets, PII, and thinking-block attribution violations | Must |
| REQ-019 | .claude-plugin/marketplace.json SHALL add an entry for `story-miner` with source `./skills/story-miner` and description `Mine Claude Code session history for publishable development stories` to the `plugins` array | Must |
| REQ-020 | .claude-plugin/marketplace.json SHALL add an entry for `cleanup` with source `./skills/cleanup` and description `Post-merge git branch cleanup with safety checks` to the `plugins` array | Must |
| REQ-021 | README.md SHALL ensure the installation section clarifies that skills (cleanup, lessons-extractor, story-miner) can be installed via marketplace or via skills-sync, while spec-workflow is a plugin installed only via marketplace or local path | Must |

### Non-Functional

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-001 | All documentation changes SHALL preserve existing formatting conventions (markdown style, heading levels, link patterns) used in each file | Consistency |
| NFR-002 | All internal links between documentation files SHALL resolve to existing files (no broken links) | Integrity |
| NFR-003 | No skill, plugin, or tool code files (.py, .js, .cjs, .sh, .cmd) SHALL be modified — only documentation (.md) and marketplace configuration (.json) are in scope | Scope |
| NFR-004 | All file paths referenced in documentation SHALL match actual filesystem paths as verified against the current branch's filesystem state | Accuracy |
| NFR-005 | Documentation changes SHALL be reviewable in a single PR | Process |
| NFR-006 | Existing correct documentation content SHALL NOT be rewritten or restructured unless required to fix a gap | Stability |

## Acceptance Criteria

| ID | Given | When | Then |
|----|-------|------|------|
| AC-001 | README.md is read | The Skills section is examined | story-miner appears as `**[story-miner](skills/story-miner/)**` with description matching SKILL.md frontmatter |
| AC-002 | README.md is read | The Tools section is examined | spec-workflow-reset entry exists linking to `tools/spec-workflow-reset.sh` |
| AC-003 | README.md is read | The Tools section is examined | story-miner-reset entry exists linking to `tools/story-miner-reset.sh` |
| AC-004 | README.md is read | The Tools section is examined | lessons-extractor-reset entry exists linking to `tools/lessons-extractor-reset.sh` |
| AC-005 | README.md is read | The Tools section is examined | spec-workflow-dev-sync entry exists linking to `tools/spec-workflow-dev-sync.sh` |
| AC-006 | README.md is read | The Repository Structure tree is examined | `story-miner/` appears under `skills/` |
| AC-007 | README.md is read | The Repository Structure tree is examined | `plugins/` appears with `spec-workflow/` subtree |
| AC-008 | README.md is read | The Repository Structure tree is examined | `tools/` lists exactly 12 files matching actual filesystem |
| AC-009 | docs/index.md is read | The Skills section is examined | cleanup subsection exists with working link to `../skills/cleanup/SKILL.md` |
| AC-010 | docs/index.md is read | The Skills section is examined | story-miner subsection exists with working links to SKILL.md, examples/, and implementation plan |
| AC-011 | docs/index.md is read | The Plugins section is examined | spec-workflow subsection exists with working link to `../plugins/spec-workflow/README.md` |
| AC-012 | docs/index.md is read | The Reference list is examined | Artifact Reset Contract link resolves to `reference/artifact-contract.md` |
| AC-013 | docs/reference/repo-layout.md is read | The plugins/ tree is examined | `spec-workflow/` subtree lists 6 agent .md files, 5 command .md files, `skills/spec-driven-dev/`, `hooks/hooks.json`, `scripts/check-review-result.py`, `README.md`, `UPSTREAM.md` |
| AC-014 | docs/reference/repo-layout.md is read | The skills/ tree is examined | `story-miner/` appears with `bin/`, `prompts/`, `eval/`, `examples/` subdirectories and all files listed in REQ-014 |
| AC-015 | docs/reference/repo-layout.md is read | The tools/ tree is examined | All 12 files listed in REQ-015 are present |
| AC-016 | docs/reference/repo-layout.md is read | The docs/ tree is examined | `reference/artifact-contract.md` and `story-miner/IMPLEMENTATION_PLAN.md` appear |
| AC-017 | docs/reference/repo-layout.md is read | The root-level tree is examined | `.claude-plugin/marketplace.json` appears after `.gitignore` |
| AC-018 | SECURITY.md is read | The Log Processing section is examined | story-miner is mentioned with: at least 17 redaction patterns (vs lessons-extractor's 7), post-pipeline output scanner detecting leaked secrets, PII, and thinking-block attribution violations |
| AC-019 | .claude-plugin/marketplace.json is read | The plugins array is examined | story-miner entry exists with source `./skills/story-miner` |
| AC-020 | .claude-plugin/marketplace.json is read | The plugins array is examined | cleanup entry exists with source `./skills/cleanup` |
| AC-021 | README.md is read | The installation section is examined | Text clarifies that skills are installable via marketplace or skills-sync, and spec-workflow is a marketplace/local-path plugin |
| AC-022 | All internal markdown links in all modified files are validated | Each `[text](path)` link is resolved against the filesystem from the file's directory | Every link resolves to an existing file or directory; zero broken links |
| AC-023 | git diff of the PR is reviewed | File types in the diff are examined | Only .md and marketplace.json files appear; no .py, .js, .cjs, .sh, or .cmd files are modified |

## Out of Scope

- Adding new features or code to any skill, plugin, or tool
- Creating new documentation files (all changes target existing files)
- Restructuring or reorganizing documentation (only additions to fix gaps)
- Updating CLAUDE.md files (these are user/project configuration, not project documentation)
- Updating the story-miner IMPLEMENTATION_PLAN.md (this is a historical development artifact)
- Modifying plugin.json (only marketplace.json is updated)

## Open Questions

(None — all questions resolved in v2.0)

## Assumptions

- The current filesystem state (as of 2026-02-09 on the feature/story-miner-skill branch) is the source of truth for what exists
- story-miner is a fully implemented skill that should be documented alongside cleanup and lessons-extractor
- The spec-workflow plugin is a fully implemented plugin that should be documented in the docs index
- All tools/ scripts that exist on disk are intended to be part of the project and should be documented
- All three skills (cleanup, lessons-extractor, story-miner) should be marketplace-installable entries
