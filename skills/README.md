# Skills

This directory contains Claude Code skills - reusable prompt-based workflows that extend Claude's capabilities.

## What is a Skill?

A Claude Code skill is a directory containing:

- `SKILL.md` - The skill definition with YAML frontmatter and instructions
- Supporting files (prompts, config, examples)

Skills are invoked as slash commands in Claude Code (e.g., `/lessons-extractor`).

## Available Skills

| Skill | Description |
|-------|-------------|
| [lessons-extractor](lessons-extractor/) | Extract lessons from Claude Code session logs |

## Creating a New Skill

### 1. Create the Directory

```bash
mkdir -p skills/your-skill-name
```

### 2. Create SKILL.md

Every skill needs a `SKILL.md` with YAML frontmatter:

```markdown
---
name: your-skill-name
description: Brief description of what the skill does
argument-hint: "[optional] [arguments]"
---

# your-skill-name

Instructions for Claude on how to execute this skill...
```

### 3. Naming Rules

The `name` field must follow these rules:

- Lowercase letters, numbers, and hyphens only
- No reserved words
- Must be non-empty and descriptive

### 4. Add Supporting Files

Organize your skill with subdirectories:

```
your-skill-name/
  SKILL.md              # Required: skill definition
  config.json           # Optional: default configuration
  config.schema.json    # Optional: configuration schema
  prompts/              # Optional: prompt templates
    step1.md
    step2.md
  examples/             # Recommended: sample inputs/outputs
    sample-input.md
    sample-output.md
```

### 5. Install and Test

```bash
# Install as personal skill
cp -r skills/your-skill-name ~/.claude/skills/

# Test in Claude Code
/your-skill-name
```

## Skill Features

### Arguments

Access user-provided arguments via `$ARGUMENTS`:

```markdown
The user provided: $ARGUMENTS
```

### Shell Command Injection

Run shell commands and inject output (requires permission):

```markdown
!find ~/.claude/projects -name '*.jsonl' -type f
```

### Configuration

Load settings from `config.json` in the skill directory.

## Best Practices

1. **Clear Instructions** - Write detailed workflow steps
2. **Handle Edge Cases** - Provide fallbacks when features are unavailable
3. **Include Examples** - Show expected inputs and outputs
4. **Security Awareness** - Note any data sensitivity concerns
