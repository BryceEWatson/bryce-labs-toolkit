# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by:

1. **Do NOT** open a public issue
2. Email the maintainer directly or use GitHub's private vulnerability reporting

## Security Considerations

### Log Processing

The `lessons-extractor` skill processes Claude Code session logs which may contain:

- API keys and tokens
- Passwords and secrets
- File paths with usernames
- Proprietary code

**Mitigations:**

- Default redaction patterns remove common sensitive data
- Users should review outputs before committing
- Raw logs should never be committed to repositories

### Redaction Patterns

The skill applies regex patterns to redact:

- API keys (`api_key`, `apiKey`, etc.)
- Passwords
- Secrets and tokens
- User home directory paths

These patterns are best-effort. Always manually review extracted lessons for sensitive information.

## Best Practices

1. Never commit raw Claude Code logs
2. Review `docs/ai/lessons-extractor/*` before committing
3. Add additional redaction patterns in `config.json` for project-specific secrets
4. Use `--log-glob` to limit which logs are processed
