# Contributing to bryce-labs-toolkit

Thank you for your interest in contributing!

## How to Contribute

### Reporting Issues

- Use GitHub Issues to report bugs or request features
- Include steps to reproduce for bugs
- Check existing issues before creating a new one

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Test your changes
5. Commit with descriptive messages: `git commit -m "feat: add new feature"`
6. Push to your fork: `git push origin feature/your-feature`
7. Open a Pull Request

### Commit Messages

Follow conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test additions or changes

### Adding a New Skill

1. Create a new directory under `skills/`
2. Include a `SKILL.md` with YAML frontmatter:
   ```yaml
   ---
   name: your-skill-name
   description: What the skill does
   ---
   ```
3. Add prompts in `prompts/` subdirectory
4. Add examples in `examples/` subdirectory
5. Update the main README.md
6. Update documentation:
   - `docs/reference/repo-layout.md` - Add files to the repository tree diagram
   - `docs/index.md` - Add entry in the appropriate section (Skills, Plugins, or Tools)
   - `README.md` - Add to "What's Included" and update Repository Structure if needed

### Skill Naming Rules

- Lowercase letters, numbers, and hyphens only
- No reserved words
- Must be descriptive

## Validation

Before submitting a pull request, run these checks:

### Windows-Safety Lint

```bash
# Check all source skills
./tools/lint-skills.sh

# Check a specific skill
./tools/lint-skills.sh skills/your-skill-name
```

### Skill Integrity

If you modified or added skills, verify they match the source:

```bash
./tools/skills-sync --project . --all --check
```

## Code of Conduct

Be respectful and constructive in all interactions.

## Questions?

Open an issue for questions about contributing.
