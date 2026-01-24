# bryce-labs-toolkit

A collection of reusable Claude Code skills, tools, and templates for AI-assisted development workflows.

## What's Included

### Skills

- **[lessons-extractor](skills/lessons-extractor/)** - Extract lessons learned from Claude Code session logs into organized markdown and JSONL files

### Tools

- **[skills-sync](tools/skills-sync.js)** - Install and update skills to target projects
- **[lint-skills](tools/lint-skills.sh)** - Lint skills for Windows-unsafe patterns

## Install Skills

### Using skills-sync (Recommended)

The `skills-sync` tool handles installation, updates, and verification:

```bash
# Clone this repo
git clone https://github.com/BryceEWatson/bryce-labs-toolkit.git
cd bryce-labs-toolkit

# List available skills
node tools/skills-sync.js --list

# Install a skill to your project
node tools/skills-sync.js --project /path/to/your-project --skill lessons-extractor

# Install all skills
node tools/skills-sync.js --project /path/to/your-project --all

# Check if installed skills are up to date
node tools/skills-sync.js --project /path/to/your-project --all --check

# Force update (clean install)
node tools/skills-sync.js --project /path/to/your-project --skill lessons-extractor --force
```

Skills are installed to `<project>/.claude/skills/<skill-name>/` and become available as `/<skill-name>` in Claude Code.

### Symlink (Development)

For active development on the toolkit itself, symlink instead of copy:

```bash
# macOS/Linux
ln -s /path/to/bryce-labs-toolkit/skills/lessons-extractor ~/.claude/skills/lessons-extractor

# Windows (PowerShell - requires admin)
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.claude\skills\lessons-extractor" -Target "C:\path\to\bryce-labs-toolkit\skills\lessons-extractor"
```

## Repository Structure

```
bryce-labs-toolkit/
  skills/                 # Claude Code skills
    lessons-extractor/    # Log reflection skill
  tools/                  # CLI tools
    skills-sync.js        # Skill installer
    lint-skills.sh        # Windows-safety linter
  docs/                   # Documentation
```

See [docs/reference/repo-layout.md](docs/reference/repo-layout.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Code, skills, and documentation are all covered under Apache-2.0.
