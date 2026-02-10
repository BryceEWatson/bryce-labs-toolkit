# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by:

1. **Do NOT** open a public issue
2. Email the maintainer directly or use GitHub's private vulnerability reporting

## Security Considerations

### Log Processing

The `lessons-extractor` and `story-miner` skills process Claude Code session logs which may contain:

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

### Story-Miner Extended Security

The `story-miner` skill applies additional security measures beyond `lessons-extractor`:

- **Extended redaction**: At least 17 redaction patterns (compared to lessons-extractor's 7), covering GitHub PATs, GitLab PATs, Slack tokens, API keys, JWTs, PEM blocks, AWS keys, auth headers, cookies, and connection strings
- **Post-pipeline output scanner**: Scans ALL output files after generation, detecting leaked secrets, PII, and thinking-block attribution violations
- **Fail-on-detection**: Scanner exits with error code if findings are detected — never silently fixes

Users should apply the same review practices to story-miner outputs as lessons-extractor outputs.

## Best Practices

1. Never commit raw Claude Code logs
2. Review `docs/ai/lessons-extractor/*` before committing
3. Add additional redaction patterns in `config.json` for project-specific secrets
4. Use `--log-glob` to limit which logs are processed
