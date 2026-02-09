# bryce-labs-toolkit Documentation

Welcome to the documentation for bryce-labs-toolkit.

## Overview

This toolkit provides reusable Claude Code skills for AI-assisted development workflows.

## Contents

- [Reference](reference/)
  - [Repository Layout](reference/repo-layout.md) - Understanding the project structure
  - [Artifact Reset Contract](reference/artifact-contract.md) - Standard contract for reset commands

## Skills

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

## Quick Links

- [Main README](../README.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [Security Policy](../SECURITY.md)
