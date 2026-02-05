#!/usr/bin/env python3
"""
SubagentStop hook for plan-reviewer and pr-reviewer.
Checks review output and decides whether to continue loop.
"""
import json
import sys
import os
from pathlib import Path

def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    # Get transcript or output
    transcript = input_data.get('transcript', '')

    # Check for approval indicators
    approved = any(ind in transcript for ind in [
        'APPROVED',
        '✅ Approved',
        '✅ PLAN APPROVED',
        'Ready for user',
        '100%'
    ])

    gaps = any(ind in transcript for ind in [
        'GAPS IDENTIFIED',
        'Changes Requested',
        '❌',
        '🔴 Critical',
        'Missing',
        'Not found',
        'Not implemented'
    ])

    # Track iterations via state file
    project_dir = os.environ.get('CLAUDE_PROJECT_DIR', '.')
    state_file = Path(project_dir) / '.claude' / 'review-loop-state.json'

    try:
        state = json.loads(state_file.read_text()) if state_file.exists() else {'iterations': 0}
    except:
        state = {'iterations': 0}

    state['iterations'] += 1
    max_iterations = 5

    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state))

    if approved and not gaps:
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
            "systemMessage": "⚠️ Review loop hit max iterations. Some issues may remain."
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
