Use the **session-reviewer** skill to perform post-session QA on a Claude Code session.

If the user provided a session ID or file path in `$ARGUMENTS`, analyze that specific session. Otherwise, analyze the most recent session.

Follow the session-reviewer skill's workflow:
1. Locate the session transcript using `parse-transcripts.js`
2. Parse and extract all file writes
3. Check for `.claude/invariants.json` and load custom rules if present
4. Run universal safety checks against all file writes
5. Generate a review report with CRITICAL/WARNING/INFO findings
6. Provide a verdict: SAFE, NEEDS REVIEW, or BLOCKED
