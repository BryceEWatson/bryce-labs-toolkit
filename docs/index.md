# bryce-labs-toolkit Documentation

Welcome to the documentation for bryce-labs-toolkit.

## Overview

This toolkit provides reusable Claude Code skills for AI-assisted development workflows.

## Contents

- [Reference](reference/)
  - [Repository Layout](reference/repo-layout.md) - Understanding the project structure
  - [Artifact Reset Contract](reference/artifact-contract.md) - Standard contract for reset commands
- [Session Analysis](session-analysis-skills.md) - Suite overview and architecture
- [Assumption Validation](assumption-validation-report.md) - Validated claims about session storage
- [Examples](examples/)
  - [invariants.example.json](examples/invariants.example.json) - Project invariants template

## Skills

### Session Analysis Suite

#### session-reviewer

Post-session QA that reviews file writes against project invariants and safety checks.

- [SKILL.md](../skills/session-reviewer/SKILL.md) - Skill definition
- [Overview](session-analysis-skills.md) - Suite documentation

#### cost-tracker

Token usage and cost analysis across Claude Code sessions.

- [SKILL.md](../skills/cost-tracker/SKILL.md) - Skill definition
- [Overview](session-analysis-skills.md) - Suite documentation

#### transcript-miner

Pattern extraction and decision archaeology across session history.

- [SKILL.md](../skills/transcript-miner/SKILL.md) - Skill definition
- [Overview](session-analysis-skills.md) - Suite documentation

### cleanup

Post-merge git branch cleanup with safety checks.

- [SKILL.md](../skills/cleanup/SKILL.md) - Skill definition

### lessons-extractor

Extracts lessons learned from Claude Code session logs.

- [SKILL.md](../skills/lessons-extractor/SKILL.md) - Skill definition
- [Examples](../skills/lessons-extractor/examples/) - Sample inputs and outputs

### story-miner

Mine Claude Code session history for publishable development stories.

- [SKILL.md](../skills/story-miner/SKILL.md) - Skill definition
- [Examples](../skills/story-miner/examples/) - Sample inputs and outputs
- [Implementation Plan](story-miner/IMPLEMENTATION_PLAN.md) - Development roadmap

## Plugins

### spec-workflow

Spec-driven development with automated review loops (Specification -> Planning -> Implementation -> Review).

- [README](../plugins/spec-workflow/README.md) - Plugin documentation

## Tools

Command-line utilities for managing skills, plugins, and output artifacts.

- **[parse-transcripts](../tools/parse-transcripts.js)** - Parse Claude Code JSONL session transcripts ([POSIX](../tools/parse-transcripts) | [Windows](../tools/parse-transcripts.cmd))
- **[skills-sync](../tools/skills-sync.js)** - Install, update, and verify skills across projects ([POSIX](../tools/skills-sync) | [Windows](../tools/skills-sync.cmd))
- **[lint-skills](../tools/lint-skills.sh)** - Lint skills for Windows-unsafe shell patterns
- **[spec-workflow-dev-sync](../tools/spec-workflow-dev-sync.sh)** - Sync plugin edits to Claude Code cache for local development ([Windows](../tools/spec-workflow-dev-sync.cmd))
- **[spec-workflow-reset](../tools/spec-workflow-reset.sh)** - Reset spec-workflow artifacts (specs, plans, reviews) ([Windows](../tools/spec-workflow-reset.cmd))
- **[story-miner-reset](../tools/story-miner-reset.sh)** - Reset story-miner output artifacts ([Windows](../tools/story-miner-reset.cmd))
- **[lessons-extractor-reset](../tools/lessons-extractor-reset.sh)** - Reset lessons-extractor output artifacts ([Windows](../tools/lessons-extractor-reset.cmd))

See [Artifact Reset Contract](reference/artifact-contract.md) for reset command behavior and safety rules.

## Output Artifacts

Generated files are organized into these directories:

| Directory | Git Status | Purpose |
|-----------|------------|---------|
| `docs/specs/` | Tracked | Specification documents (SPEC-*.md) |
| `docs/plans/` | Tracked | Implementation plans (PLAN-*.md) |
| `docs/reviews/` | Tracked | Review artifacts (REVIEW-*.md) -- not auto-committed by pipeline |
| `docs/ai/lessons-extractor/` | Tracked | Extracted lessons from session logs |
| `.story-miner/` | Gitignored | Story mining artifacts -- local only |

All tracked artifact directories include a `.gitkeep` file to preserve the directory structure on clone. See [Artifact Reset Contract](reference/artifact-contract.md) for cleanup procedures.

## Quick Links

- [Main README](../README.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [Security Policy](../SECURITY.md)
