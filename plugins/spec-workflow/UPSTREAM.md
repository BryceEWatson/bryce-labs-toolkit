# Upstream Dependencies

## Claude Code: Slash command picker auto-submits arg commands

- **Upstream:** https://github.com/anthropics/claude-code/issues/23781
- **Affects:** spec-workflow slash commands requiring args (e.g., `/spec-workflow:spec`)
- **Impact:** Selecting from picker submits command before args can be entered
- **Workaround:** Manual typing + args (see [README](README.md#known-issue-upstream-claude-code))
- **Remove/Update:** When upstream fixed and verified
