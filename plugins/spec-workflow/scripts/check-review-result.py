#!/usr/bin/env python3
"""
SubagentStop hook for plan-reviewer and pr-reviewer.
Checks review output and decides whether to continue loop.

NOTE: The primary review loop mechanism uses prompt-based hooks in agent
frontmatter. This script is an alternative command-based approach that can
be enabled in hooks.json by renaming _SubagentStop to SubagentStop.

Input (from stdin): JSON with SubagentStop hook fields:
  - session_id: Current session ID
  - transcript_path: Path to JSONL transcript file
  - stop_hook_active: Whether stop hook is active
  - agent_name: Name of the agent that stopped

Output (to stdout): JSON decision:
  - {"decision": "approve", "reason": "..."} - Allow agent to stop
  - {"decision": "block", "reason": "..."} - Continue the review loop
"""
from __future__ import annotations

import json
import sys
import os
from pathlib import Path


def read_transcript(transcript_path: str) -> str:
    """Read and concatenate text content from JSONL transcript."""
    if not transcript_path or not Path(transcript_path).exists():
        return ''

    content_parts = []
    try:
        with open(transcript_path, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    entry = json.loads(line.strip())
                    # Extract text content from various message formats
                    if isinstance(entry, dict):
                        if 'content' in entry:
                            content = entry['content']
                            if isinstance(content, str):
                                content_parts.append(content)
                            elif isinstance(content, list):
                                for item in content:
                                    if isinstance(item, dict) and item.get('type') == 'text':
                                        content_parts.append(item.get('text', ''))
                                    elif isinstance(item, str):
                                        content_parts.append(item)
                        if 'message' in entry and isinstance(entry['message'], dict):
                            msg_content = entry['message'].get('content', '')
                            if isinstance(msg_content, str):
                                content_parts.append(msg_content)
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass

    return '\n'.join(content_parts)


def extract_verdict(transcript: str) -> tuple[bool, bool]:
    """
    Extract verdict from structured output.

    Looks for ## Verdict section with specific tokens to avoid false positives
    from casual mentions of words like "Missing" in summaries.

    Returns: (approved, has_issues)
    """
    import re

    # Look for ## Verdict section
    verdict_match = re.search(
        r'##\s*Verdict\s*\n(.*?)(?=\n##|\Z)',
        transcript,
        re.IGNORECASE | re.DOTALL
    )

    if verdict_match:
        verdict_text = verdict_match.group(1)
        approved = any(ind in verdict_text for ind in [
            '[x] Approved',
            '**[x] Approved**',
            '[x] PLAN APPROVED',
            'APPROVED',
            # Legacy emoji markers (backward compat)
            '✅ Approved',
            '**✅ Approved**',
            '✅ PLAN APPROVED',
        ])
        has_issues = any(ind in verdict_text for ind in [
            'Changes Requested',
            'Rejected',
            '[!]',
            # Legacy emoji markers (backward compat)
            '❌',
        ])
        return approved, has_issues

    # Fallback: check for structured markers anywhere
    approved = any(ind in transcript for ind in [
        '## Plan Review: APPROVED',
        '## PR Review: APPROVED',
        '[x] PLAN APPROVED',
        '**[x] Approved**',
        # Legacy emoji markers (backward compat)
        '✅ PLAN APPROVED',
        '**✅ Approved**',
    ])

    has_issues = any(ind in transcript for ind in [
        '## Plan Review: GAPS IDENTIFIED',
        '### [!!] Critical',
        '**Changes Requested**',
        '**[!] Rejected**',
        # Legacy emoji markers (backward compat)
        '### 🔴 Critical',
        '**❌ Rejected**',
    ])

    return approved, has_issues


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # No input or invalid JSON - allow stop
        print(json.dumps({"decision": "approve", "reason": "No input data"}))
        sys.exit(0)

    # Get session and agent identifiers for state isolation
    session_id = input_data.get('session_id', 'unknown')
    agent_name = input_data.get('agent_name', 'unknown')
    state_key = f"{session_id}-{agent_name}"

    # Get transcript content from transcript_path
    transcript_path = input_data.get('transcript_path', '')
    transcript = read_transcript(transcript_path)

    # Also check for direct transcript field (legacy/alternative format)
    if not transcript:
        transcript = input_data.get('transcript', '')

    # Check for structured verdict
    approved, has_issues = extract_verdict(transcript)

    # Track iterations via state file, keyed by session+agent to avoid collisions
    # Use project dir if available, otherwise temp directory
    project_dir = os.environ.get('CLAUDE_PROJECT_DIR', '')
    if project_dir:
        state_dir = Path(project_dir) / '.claude' / 'review-loop-state'
    else:
        state_dir = Path('/tmp') / 'claude-review-loop-state'

    state_file = state_dir / f"{state_key}.json"

    try:
        state = json.loads(state_file.read_text()) if state_file.exists() else {'iterations': 0}
    except Exception:
        state = {'iterations': 0}

    state['iterations'] += 1
    max_iterations = 5

    state_dir.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state))

    if approved and not has_issues:
        # Clean up and approve
        state_file.unlink(missing_ok=True)
        print(json.dumps({
            "decision": "approve",
            "reason": "Review passed. Ready for user."
        }))
        sys.exit(0)

    if state['iterations'] >= max_iterations:
        state_file.unlink(missing_ok=True)
        print(json.dumps({
            "decision": "approve",
            "reason": f"Max iterations ({max_iterations}) reached.",
            "systemMessage": "[~] Review loop hit max iterations. Some issues may remain."
        }))
        sys.exit(0)

    # Continue loop
    print(json.dumps({
        "decision": "block",
        "reason": f"Review found issues (iteration {state['iterations']}/{max_iterations}). Revise and re-review."
    }))
    sys.exit(0)


if __name__ == '__main__':
    main()
