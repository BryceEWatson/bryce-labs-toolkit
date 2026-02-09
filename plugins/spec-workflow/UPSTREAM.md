# Upstream Dependencies

## Claude Code: Slash command picker auto-submits arg commands

- **Upstream:** https://github.com/anthropics/claude-code/issues/23781
- **Affects:** spec-workflow slash commands requiring args (e.g., `/spec-workflow:spec`)
- **Impact:** Selecting from picker submits command before args can be entered
- **Workaround:** Manual typing + args (see [README](README.md#known-issue-upstream-claude-code))
- **Remove/Update:** When upstream fixed and verified

## Claude Code: Plugin cache never reads from local working directory

- **Upstream:** https://github.com/anthropics/claude-code/issues/17361, https://github.com/anthropics/claude-code/issues/15369
- **Affects:** All plugin development — editing source files has no effect on runtime behavior
- **Root cause:** Marketplace-installed plugins are cached under the following path (varies by OS):
  - **Windows:** `%USERPROFILE%\.claude\plugins\cache\<marketplace>\<plugin>\<version>\`
  - **macOS/Linux:** `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`

  Claude Code executes from this cache, never from the local repo. When the cache is missing, it rebuilds from the marketplace git source at the recorded `gitCommitSha` in `~/.claude/plugins/installed_plugins.json`. The `installPath` field is metadata only — not used as an execution source.
- **Implication:** Local edits to `plugins/spec-workflow/` do nothing unless:
  1. You copy files into the cache (`tools/spec-workflow-dev-sync.sh` or `.cmd`), OR
  2. You push changes to the remote repo, update `gitCommitSha` in `installed_plugins.json`, and delete the cache so it rebuilds
- **Workaround for local dev:** Run `tools/spec-workflow-dev-sync.sh` (Git Bash on Windows — NOT WSL) or `tools\spec-workflow-dev-sync.cmd` after editing plugin files, then open a new chat window. The scripts auto-detect the installed cache version directory (deterministic 4-tier policy: exact LOCAL_VERSION match → sole dir → newest mtime of multiple → fallback), copy to a temp directory, verify the sentinel, and rename atomically.
- **Dev sync scripts exit non-zero** if the ORCH_SENTINEL marker is missing from spec.md, preventing invalid syncs.
- **Dev sync scripts auto-detect installed version** — they don't solely rely on `plugin.json`. If the installed cache version differs from `plugin.json`, the scripts sync into the installed version and print a warning.
- **Verification:** After syncing, the first output from `/spec-workflow:spec` should include `ORCH_SENTINEL__9F2E`. If it doesn't, the cache was rebuilt from the remote — re-run the sync script.
- **Remove/Update:** When Claude Code supports a first-class "load from local path" dev mode for plugins
