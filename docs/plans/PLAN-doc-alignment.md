# Implementation Plan: Documentation Alignment

**Spec:** docs/specs/SPEC-doc-alignment.md
**Version:** 1.0
**Status:** Draft
**Date:** 2026-02-09

## Requirement Mapping

| Spec ID | Task ID(s) | Status |
|---------|------------|--------|
| REQ-001 | TASK-001 | Mapped |
| REQ-002 | TASK-001 | Mapped |
| REQ-003 | TASK-001 | Mapped |
| REQ-004 | TASK-001 | Mapped |
| REQ-005 | TASK-001 | Mapped |
| REQ-006 | TASK-001 | Mapped |
| REQ-007 | TASK-001 | Mapped |
| REQ-008 | TASK-001 | Mapped |
| REQ-009 | TASK-002 | Mapped |
| REQ-010 | TASK-002 | Mapped |
| REQ-011 | TASK-002 | Mapped |
| REQ-012 | TASK-002 | Mapped |
| REQ-013 | TASK-003 | Mapped |
| REQ-014 | TASK-003 | Mapped |
| REQ-015 | TASK-003 | Mapped |
| REQ-016 | TASK-003 | Mapped |
| REQ-017 | TASK-003 | Mapped |
| REQ-018 | TASK-004 | Mapped |
| REQ-019 | TASK-005 | Mapped |
| REQ-020 | TASK-005 | Mapped |
| REQ-021 | TASK-001 | Mapped |
| AC-001 | TASK-001 (test) | Mapped |
| AC-002 | TASK-001 (test) | Mapped |
| AC-003 | TASK-001 (test) | Mapped |
| AC-004 | TASK-001 (test) | Mapped |
| AC-005 | TASK-001 (test) | Mapped |
| AC-006 | TASK-001 (test) | Mapped |
| AC-007 | TASK-001 (test) | Mapped |
| AC-008 | TASK-001 (test) | Mapped |
| AC-009 | TASK-002 (test) | Mapped |
| AC-010 | TASK-002 (test) | Mapped |
| AC-011 | TASK-002 (test) | Mapped |
| AC-012 | TASK-002 (test) | Mapped |
| AC-013 | TASK-003 (test) | Mapped |
| AC-014 | TASK-003 (test) | Mapped |
| AC-015 | TASK-003 (test) | Mapped |
| AC-016 | TASK-003 (test) | Mapped |
| AC-017 | TASK-003 (test) | Mapped |
| AC-018 | TASK-004 (test) | Mapped |
| AC-019 | TASK-005 (test) | Mapped |
| AC-020 | TASK-005 (test) | Mapped |
| AC-021 | TASK-001 (test) | Mapped |
| AC-022 | TASK-006 (test) | Mapped |
| AC-023 | TASK-006 (test) | Mapped |
| NFR-001 | ALL TASKS | Mapped |
| NFR-002 | TASK-006 | Mapped |
| NFR-003 | ALL TASKS | Mapped |
| NFR-004 | TASK-006 | Mapped |
| NFR-005 | ALL TASKS | Mapped |
| NFR-006 | ALL TASKS | Mapped |

**Coverage:** 21/21 REQ mapped, 23/23 AC mapped, 6/6 NFR mapped

## Tasks

### TASK-001: Update README.md

**Maps to:** REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-021
**Dependencies:** None

**Files:**
- Modify: `README.md`

**Test:** AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-021

**Description:**

1. **Skills Section** — Add after lessons-extractor entry:
   ```markdown
   - **[story-miner](skills/story-miner/)** - Mine Claude Code session history for publishable development stories
   ```

2. **Tools Section** — Add four new entries after lint-skills:
   ```markdown
   - **[spec-workflow-reset](tools/spec-workflow-reset.sh)** - Reset spec-workflow artifacts (specs, plans, reviews)
   - **[story-miner-reset](tools/story-miner-reset.sh)** - Reset story-miner output artifacts
   - **[lessons-extractor-reset](tools/lessons-extractor-reset.sh)** - Reset lessons-extractor output artifacts
   - **[spec-workflow-dev-sync](tools/spec-workflow-dev-sync.sh)** - Sync plugin edits to Claude Code cache for local development
   ```

3. **Installation Section** — Add clarification note between "Install Plugins" and "Install Skills" sections:
   ```markdown
   > **Note:** Skills (cleanup, lessons-extractor, story-miner) can be installed via the marketplace or using skills-sync (below). The spec-workflow plugin is installed only via marketplace or local path.
   ```

4. **Repository Structure** — Replace the tree with:
   ```
   bryce-labs-toolkit/
     plugins/                # Claude Code plugins
       spec-workflow/        # Spec-driven development workflow
     skills/                 # Claude Code skills
       cleanup/              # Post-merge branch cleanup
       lessons-extractor/    # Log reflection skill
       story-miner/          # Session history story mining
     tools/                  # CLI tools
       skills-sync           # POSIX wrapper
       skills-sync.cmd       # Windows wrapper
       skills-sync.js        # Main script
       lint-skills.sh        # Windows-safety linter
       spec-workflow-dev-sync.sh      # Plugin dev sync (POSIX)
       spec-workflow-dev-sync.cmd     # Plugin dev sync (Windows)
       spec-workflow-reset.sh         # Spec-workflow reset (POSIX)
       spec-workflow-reset.cmd        # Spec-workflow reset (Windows)
       story-miner-reset.sh           # Story-miner reset (POSIX)
       story-miner-reset.cmd          # Story-miner reset (Windows)
       lessons-extractor-reset.sh     # Lessons-extractor reset (POSIX)
       lessons-extractor-reset.cmd    # Lessons-extractor reset (Windows)
     docs/                   # Documentation
   ```

---

### TASK-002: Update docs/index.md

**Maps to:** REQ-009, REQ-010, REQ-011, REQ-012
**Dependencies:** None

**Files:**
- Modify: `docs/index.md`

**Test:** AC-009, AC-010, AC-011, AC-012

**Description:**

1. **Contents/Reference section** — Add artifact-contract link:
   ```markdown
     - [Artifact Reset Contract](reference/artifact-contract.md) - Standard reset contract
   ```

2. **Skills section** — Add cleanup subsection after existing heading:
   ```markdown
   ### cleanup

   Post-merge git branch cleanup with safety checks.

   - [SKILL.md](../skills/cleanup/SKILL.md) - Skill definition
   ```

3. **Skills section** — Add story-miner subsection after lessons-extractor:
   ```markdown
   ### story-miner

   Mine Claude Code session history for publishable development stories.

   - [SKILL.md](../skills/story-miner/SKILL.md) - Skill definition
   - [Examples](../skills/story-miner/examples/) - Sample inputs and outputs
   - [Implementation Plan](story-miner/IMPLEMENTATION_PLAN.md) - Development roadmap
   ```

4. **Add Plugins section** — After Skills section, before Quick Links:
   ```markdown
   ## Plugins

   ### spec-workflow

   Spec-driven development with automated review loops (Specification -> Planning -> Implementation -> Review).

   - [README](../plugins/spec-workflow/README.md) - Plugin documentation
   ```

---

### TASK-003: Update docs/reference/repo-layout.md

**Maps to:** REQ-013, REQ-014, REQ-015, REQ-016, REQ-017
**Dependencies:** None

**Files:**
- Modify: `docs/reference/repo-layout.md`

**Test:** AC-013, AC-014, AC-015, AC-016, AC-017

**Description:**

1. **Root-level entries** — Add `.claude-plugin/` after `.gitignore`:
   ```
     .claude-plugin/         # Marketplace configuration
       marketplace.json      # Plugin registry
   ```

2. **Add plugins/ tree** — Before skills/:
   ```
     plugins/                # Claude Code plugins
       spec-workflow/        # Spec-driven development workflow
         .claude-plugin/     # Plugin metadata
           plugin.json       # Plugin definition
         agents/             # AI agent prompts
           spec-builder.md
           planner.md
           implementer.md
           plan-reviewer.md
           pr-reviewer.md
           spec-reviewer.md
         commands/           # Plugin commands
           spec.md
           plan.md
           implement.md
           review.md
           reset.md
         skills/             # Embedded skills
           spec-driven-dev/  # Core methodology skill
         hooks/              # Command hooks
           hooks.json
         scripts/            # Utility scripts
           check-review-result.py
         README.md
         UPSTREAM.md
   ```

3. **Add story-miner to skills/ tree** — After cleanup/:
   ```
       story-miner/          # Session history story mining skill
         SKILL.md            # Skill definition (YAML frontmatter + instructions)
         config.json         # Default configuration
         config.schema.json  # Configuration schema
         bin/                # Preprocessor CLI
           story-preprocessor.cjs  # Node.js preprocessor
           story-preprocessor      # POSIX shell wrapper
           story-preprocessor.cmd  # Windows batch wrapper
         prompts/            # Prompt templates (score, write, render)
           score_candidates.md
           write_story.md
           render_outputs.md
         eval/               # Deterministic eval runner + fixtures
           run-selftest.cjs  # Eval runner (decides PASS/FAIL)
           fixtures/         # Test fixtures (JSON)
         examples/           # Sample inputs/outputs
           sample-input.md
           sample-output.md
   ```

4. **Update tools/ tree** — Replace with all 12 files:
   ```
     tools/                  # CLI tools
       skills-sync           # POSIX wrapper
       skills-sync.cmd       # Windows wrapper
       skills-sync.js        # Main script (Node.js)
       lint-skills.sh        # Windows-safety linter
       spec-workflow-dev-sync.sh      # Plugin dev sync (POSIX)
       spec-workflow-dev-sync.cmd     # Plugin dev sync (Windows)
       spec-workflow-reset.sh         # Spec-workflow reset (POSIX)
       spec-workflow-reset.cmd        # Spec-workflow reset (Windows)
       story-miner-reset.sh           # Story-miner reset (POSIX)
       story-miner-reset.cmd          # Story-miner reset (Windows)
       lessons-extractor-reset.sh     # Lessons-extractor reset (POSIX)
       lessons-extractor-reset.cmd    # Lessons-extractor reset (Windows)
   ```

5. **Update docs/ tree** — Add new entries:
   ```
     docs/                   # Documentation
       index.md              # Docs landing page
       reference/            # Reference documentation
         repo-layout.md      # This file
         artifact-contract.md  # Reset command contract
       story-miner/          # Story-miner documentation
         IMPLEMENTATION_PLAN.md  # Development roadmap
   ```

---

### TASK-004: Update SECURITY.md

**Maps to:** REQ-018
**Dependencies:** None

**Files:**
- Modify: `SECURITY.md`

**Test:** AC-018

**Description:**

1. **Update Log Processing intro** — Change first sentence to mention both skills:
   - Before: `The \`lessons-extractor\` skill processes Claude Code session logs which may contain:`
   - After: `The \`lessons-extractor\` and \`story-miner\` skills process Claude Code session logs which may contain:`

2. **Add story-miner specific section** — After the existing "Mitigations" subsection, add:
   ```markdown
   ### Story-Miner Extended Security

   The `story-miner` skill applies additional security measures beyond `lessons-extractor`:

   - **Extended redaction**: At least 17 redaction patterns (compared to lessons-extractor's 7), covering GitHub PATs, GitLab PATs, Slack tokens, API keys, JWTs, PEM blocks, AWS keys, auth headers, cookies, and connection strings
   - **Post-pipeline output scanner**: Scans ALL output files after generation, detecting leaked secrets, PII, and thinking-block attribution violations
   - **Fail-on-detection**: Scanner exits with error code if findings are detected — never silently fixes

   Users should apply the same review practices to story-miner outputs as lessons-extractor outputs.
   ```

---

### TASK-005: Update .claude-plugin/marketplace.json

**Maps to:** REQ-019, REQ-020
**Dependencies:** None

**Files:**
- Modify: `.claude-plugin/marketplace.json`

**Test:** AC-019, AC-020

**Description:**

Add two entries to the `plugins` array after the existing `lessons-extractor` entry:

```json
{
  "name": "cleanup",
  "source": "./skills/cleanup",
  "description": "Post-merge git branch cleanup with safety checks",
  "version": "1.0.0"
},
{
  "name": "story-miner",
  "source": "./skills/story-miner",
  "description": "Mine Claude Code session history for publishable development stories",
  "version": "1.0.0"
}
```

---

### TASK-006: Validate All Internal Links

**Maps to:** NFR-002, NFR-004, AC-022, AC-023
**Dependencies:** TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Files:**
- No files modified (validation only)

**Test:** AC-022, AC-023

**Description:**

1. Extract all markdown links from all 5 modified files
2. Resolve each relative path from the file's parent directory
3. Verify target exists on filesystem (file or directory)
4. Verify git diff shows only .md and .json files modified
5. Report any broken links or unexpected file types in diff

**New links to validate:**
- README.md: `skills/story-miner/`, `tools/spec-workflow-reset.sh`, `tools/story-miner-reset.sh`, `tools/lessons-extractor-reset.sh`, `tools/spec-workflow-dev-sync.sh`
- docs/index.md: `../skills/cleanup/SKILL.md`, `../skills/story-miner/SKILL.md`, `../skills/story-miner/examples/`, `story-miner/IMPLEMENTATION_PLAN.md`, `../plugins/spec-workflow/README.md`, `reference/artifact-contract.md`

---

## Architecture Decisions

### AD-001: File-Grouped Task Strategy

**Choice:** Group tasks by target file (one task per file)
**Rationale:** 5 discrete files with no interdependencies; simplifies review, minimizes merge conflicts, enables parallel execution
**Alternatives:** Requirement-grouped (each task touches multiple files) — rejected due to higher complexity; single monolithic task — rejected for review difficulty

### AD-002: No Automated Link Checker

**Choice:** Manual link validation in TASK-006
**Rationale:** All paths are known to exist from codebase exploration; adding automated tooling would exceed the documentation-only scope (NFR-003)
**Alternatives:** Custom grep-based link checker — rejected as out of scope

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Markdown syntax errors break rendering | Medium | Preview in VS Code, validate JSON syntax |
| Broken internal links | Medium | TASK-006 validates all new links |
| Merge conflicts if base branch changes | Low | File-grouped tasks are independent |
| Copy-paste errors in tree structures | Medium | Compare trees against actual filesystem listing |
| Marketplace.json syntax errors | High | Validate JSON before committing |
