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
      prompts/            # Prompt templates (score, write, render)
      eval/               # Deterministic eval runner + fixtures
        run-selftest.cjs  # Eval runner (decides PASS/FAIL)
        fixtures/         # Test fixtures (JSON)
      examples/           # Sample inputs/outputs

  docs/                   # Documentation
    index.md              # Docs landing page
    reference/            # Reference documentation
      repo-layout.md      # This file
```

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
