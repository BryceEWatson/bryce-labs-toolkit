# Repository Layout

This document explains the structure of the bryce-labs-toolkit repository.

## Current Structure (v0 - Skill-first)

```
bryce-labs-toolkit/
  LICENSE                 # Apache-2.0
  README.md               # Project overview and install instructions
  CONTRIBUTING.md         # Contribution guidelines
  SECURITY.md             # Security policy
  .gitignore              # Git ignore patterns
  .claude-plugin/         # Marketplace configuration
    marketplace.json      # Plugin registry for Claude Code marketplace
  .claude/                # Claude Code local configuration
    commands/             # Custom command definitions (git-tracked)
      cleanup.md          # Cleanup skill command
    settings.local.json   # Local settings (gitignored)
    skills/               # Pre-installed skill copies (gitignored, see note below)
      story-miner/        # Bootstrapped for toolkit development

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

  skills/                 # Claude Code skills
    README.md             # Skills development guide
    cleanup/              # Post-merge branch cleanup skill
      SKILL.md            # Skill definition (YAML frontmatter + instructions)
      bin/                # Executable scripts
        git-cleanup.py    # Python cleanup script (stdlib only)
        git-cleanup       # POSIX shell wrapper
        git-cleanup.cmd   # Windows batch wrapper
      tests/              # pytest integration tests
    lessons-extractor/    # Log reflection skill
      SKILL.md            # Skill definition (YAML frontmatter + instructions)
      config.json         # Default configuration
      config.schema.json  # Configuration schema
      prompts/            # Prompt templates
      examples/           # Sample inputs/outputs
    story-miner/          # Session history story mining skill
      SKILL.md            # Skill definition (YAML frontmatter + instructions)
      config.json         # Default configuration
      config.schema.json  # Configuration schema
      bin/                # Preprocessor CLI
        story-preprocessor.cjs  # Node.js preprocessor (forked from lessons-extractor)
        story-preprocessor      # POSIX shell wrapper
        story-preprocessor.cmd  # Windows batch wrapper
      prompts/            # Prompt templates
        score_candidates.md     # Candidate scoring prompt
        write_story.md          # Story writing prompt
        render_outputs.md       # Output rendering prompt
      eval/               # Deterministic eval runner + fixtures
        run-selftest.cjs  # Eval runner (decides PASS/FAIL)
        fixtures/         # Test fixtures (JSON)
      examples/           # Sample inputs/outputs
        sample-input.md   # Example input
        sample-output.md  # Example output

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

  docs/                   # Documentation
    index.md              # Docs landing page
    specs/                # Specification documents (SPEC-*.md)
      .gitkeep
    plans/                # Implementation plans (PLAN-*.md)
      .gitkeep
    reviews/              # Review artifacts (REVIEW-*.md)
      .gitkeep
    ai/                   # AI-generated artifacts
      lessons-extractor/  # Extracted lessons
        .gitkeep
    reference/            # Reference documentation
      repo-layout.md      # This file
      artifact-contract.md  # Reset command contract
    story-miner/          # Story-miner documentation
      IMPLEMENTATION_PLAN.md  # Development roadmap
```

### Notes on .claude/ Directory

The `.claude/` directory contains both git-tracked and gitignored files:

- **Tracked:** `commands/cleanup.md` -- provides a default cleanup command for the toolkit
- **Gitignored:** `settings.local.json` -- user-specific local settings
- **Gitignored:** `skills/` -- pre-installed skill copies placed by `skills-sync`

The `skills/` subdirectory is gitignored because installed skills are derived from `skills/` (the source directory). Use `tools/skills-sync` to install or update skills. The installed copies exist for local development convenience and should not be committed.

> **Implementation note:** The spec (REQ-004) lists `settings.local.json` and `skills/story-miner/` as "tracked contents" of `.claude/`. In reality, only `commands/cleanup.md` is git-tracked; the others are gitignored per `.gitignore`. The tree diagram includes all items from the spec but annotates their actual git status for accuracy.

## Design Principles

### Skill-first Approach

v0 focuses on shipping useful Claude Code skills. Infrastructure (tools, CI, runners) will be added when needed.

### Skills Directory

Skills are self-contained directories under `skills/`. Each skill must have:

- `SKILL.md` - Skill definition with YAML frontmatter
- Supporting files (prompts, config, examples)

### Install Locations

Skills can be installed:

- **Project skill**: `<project>/.claude/skills/<skill-name>/`
- **Personal skill**: `~/.claude/skills/<skill-name>/`

## Future Structure

When tool packages are added:

```
bryce-labs-toolkit/
  ...existing...

  packages/               # Language-specific tool packages
    js/                   # Node.js tools (pnpm workspace)
    py/                   # Python tools (future)

  scripts/                # Cross-cutting scripts
    run                   # Tool dispatcher

  content/                # Blog, journal, notes (future)
```

See [Deferred Milestones](#deferred-milestones) for planned additions.

## Deferred Milestones

These will be added when needed:

- [ ] `packages/js/` - pnpm workspace for Node.js tools
- [ ] `scripts/run` - Tool dispatcher
- [ ] `content/` - Blog/journal content with CC BY 4.0 license
- [ ] GitHub Actions CI
- [ ] Tool contract specification
