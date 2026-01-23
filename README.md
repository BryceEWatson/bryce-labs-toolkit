# bryce-labs-toolkit

A collection of reusable Claude Code skills, tools, and templates for AI-assisted development workflows.

## What's Included

### Skills

- **[lessons-extractor](skills/lessons-extractor/)** - Extract lessons learned from Claude Code session logs into organized markdown and JSONL files

## Install

### As Project Skill

Copy to your project's `.claude/skills/` directory:

```bash
# Clone this repo, then:
cp -r skills/lessons-extractor /path/to/your-project/.claude/skills/
```

The skill is now available in that project as `/lessons-extractor`.

### As Personal Skill

Copy to your personal Claude Code skills directory (available in all projects):

```bash
# macOS/Linux
cp -r skills/lessons-extractor ~/.claude/skills/

# Windows (PowerShell)
Copy-Item -Recurse skills\lessons-extractor $env:USERPROFILE\.claude\skills\
```

### Symlink (Development)

For active development, symlink instead of copy:

```bash
# macOS/Linux
ln -s /path/to/bryce-labs-toolkit/skills/lessons-extractor ~/.claude/skills/lessons-extractor

# Windows (PowerShell - requires admin)
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.claude\skills\lessons-extractor" -Target "C:\path\to\bryce-labs-toolkit\skills\lessons-extractor"
```

### Permissions Note

The skill uses shell command injection (`!find ...` / `!powershell ...`) to locate log files. If this is blocked by your Claude Code settings, you can:

1. Allow the necessary commands in Claude Code settings
2. Use `--log-glob` to specify paths manually
3. Paste log excerpts directly into the conversation

## Repository Structure

```
bryce-labs-toolkit/
  skills/                 # Claude Code skills
    lessons-extractor/    # Log reflection skill
  docs/                   # Documentation
```

See [docs/reference/repo-layout.md](docs/reference/repo-layout.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Code, skills, and documentation are all covered under Apache-2.0.
