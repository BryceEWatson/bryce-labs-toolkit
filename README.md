# bryce-labs-toolkit

A collection of reusable Claude Code skills, tools, and templates for AI-assisted development workflows.

## What's Included

### Plugins

- **[spec-workflow](plugins/spec-workflow/)** - Spec-driven development with automated review loops (Specification → Planning → Implementation → Review)

### Skills

- **[cleanup](skills/cleanup/)** - Post-merge git branch cleanup with safety checks, auto-detected base branch, and squash-merge support
- **[lessons-extractor](skills/lessons-extractor/)** - Extract lessons learned from Claude Code session logs into organized markdown and JSONL files
- **[story-miner](skills/story-miner/)** - Mine Claude Code session history for publishable development stories

### Tools

- **[skills-sync](tools/)** - Install and update skills to target projects (cross-platform wrappers included)
- **[lint-skills](tools/lint-skills.sh)** - Lint skills for Windows-unsafe patterns
- **[spec-workflow-reset](tools/spec-workflow-reset.sh)** - Reset spec-workflow artifacts (specs, plans, reviews)
- **[story-miner-reset](tools/story-miner-reset.sh)** - Reset story-miner output artifacts
- **[lessons-extractor-reset](tools/lessons-extractor-reset.sh)** - Reset lessons-extractor output artifacts
- **[spec-workflow-dev-sync](tools/spec-workflow-dev-sync.sh)** - Sync plugin edits to Claude Code cache for local development

## Install Plugins

Plugins are installed via the Claude Code marketplace:

```bash
# Add the marketplace source (one-time)
/plugin marketplace add BryceEWatson/bryce-labs-toolkit

# Install a plugin
/plugin install spec-workflow@bryce-labs
```

For development or testing a PR branch, install from a local path:

```bash
git clone https://github.com/BryceEWatson/bryce-labs-toolkit.git
/plugin install /path/to/bryce-labs-toolkit/plugins/spec-workflow
```

> **Note:** Skills (cleanup, lessons-extractor, story-miner) can be installed via the marketplace or using skills-sync (below). The spec-workflow plugin is installed only via marketplace or local path.

## Install Skills

### Using skills-sync (Recommended)

The `skills-sync` tool handles installation, updates, and verification:

```bash
# Clone this repo
git clone https://github.com/BryceEWatson/bryce-labs-toolkit.git
cd bryce-labs-toolkit

# List available skills
./tools/skills-sync --list

# Install a skill to your project
./tools/skills-sync --project /path/to/your-project --skill lessons-extractor

# Install all skills
./tools/skills-sync --project /path/to/your-project --all

# Check if installed skills are up to date
./tools/skills-sync --project /path/to/your-project --all --check

# Force update (clean install)
./tools/skills-sync --project /path/to/your-project --skill lessons-extractor --force
```

On Windows (CMD/PowerShell):

```bat
tools\skills-sync.cmd --list
tools\skills-sync.cmd --project C:\path\to\your-project --skill lessons-extractor
```

Skills are installed to `<project>/.claude/skills/<skill-name>/` and become available as `/<skill-name>` in Claude Code.

### Symlink (Development)

For active development on the toolkit itself, symlink into your target project:

```bash
# macOS/Linux
ln -s /path/to/bryce-labs-toolkit/skills/lessons-extractor /path/to/your-project/.claude/skills/lessons-extractor

# Windows (PowerShell - requires admin)
New-Item -ItemType SymbolicLink -Path "C:\path\to\your-project\.claude\skills\lessons-extractor" -Target "C:\path\to\bryce-labs-toolkit\skills\lessons-extractor"
```

## Repository Structure

```
bryce-labs-toolkit/
  .claude/                # Claude Code configuration (partially tracked)
    commands/             # Custom commands (git-tracked)
    skills/               # Pre-installed skills (gitignored)
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
    specs/                # Specification documents
    plans/                # Implementation plans
    reviews/              # Review artifacts
    ai/                   # AI-generated artifacts
      lessons-extractor/  # Extracted lessons
    reference/            # Reference docs
    story-miner/          # Story-miner documentation
```

See [docs/reference/repo-layout.md](docs/reference/repo-layout.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Code, skills, and documentation are all covered under Apache-2.0.
