#!/bin/bash
# Lint Claude Code skills for Windows-unsafe patterns
# Forbidden: $env:, $_, $( inside PowerShell command strings
#
# Usage: ./tools/lint-skills.sh [skill-dir]
# Default: skills/

set -e

SKILL_DIR="${1:-skills}"
ERRORS=0

echo "Checking skills in $SKILL_DIR for Windows-unsafe patterns..."
echo ""

# Find all relevant files and check for forbidden patterns
while IFS= read -r -d '' file; do
    # Only check lines that contain 'powershell' (case-insensitive)
    # This avoids false positives in unrelated documentation

    # Extract lines containing powershell
    PS_LINES=$(grep -in 'powershell' "$file" 2>/dev/null || true)

    if [ -n "$PS_LINES" ]; then
        # Check for $env: pattern (fixed-string match)
        if echo "$PS_LINES" | grep -Fq '$env:'; then
            echo "ERROR: $file"
            echo "$PS_LINES" | grep -F '$env:' | head -3
            echo '  ^ Contains $env: in PowerShell command'
            echo ""
            ERRORS=$((ERRORS + 1))
        fi

        # Check for $_ pattern (fixed-string match)
        if echo "$PS_LINES" | grep -Fq '$_'; then
            echo "ERROR: $file"
            echo "$PS_LINES" | grep -F '$_' | head -3
            echo '  ^ Contains $_ in PowerShell command'
            echo ""
            ERRORS=$((ERRORS + 1))
        fi

        # Check for $( pattern (fixed-string match)
        if echo "$PS_LINES" | grep -Fq '$('; then
            echo "ERROR: $file"
            echo "$PS_LINES" | grep -F '$(' | head -3
            echo '  ^ Contains $( in PowerShell command'
            echo ""
            ERRORS=$((ERRORS + 1))
        fi

        # Check for $HOME or $USERPROFILE (fixed-string match)
        if echo "$PS_LINES" | grep -Fq '$HOME' || echo "$PS_LINES" | grep -Fq '$USERPROFILE'; then
            echo "ERROR: $file"
            echo "$PS_LINES" | grep -F '$HOME' | head -3 || true
            echo "$PS_LINES" | grep -F '$USERPROFILE' | head -3 || true
            echo '  ^ Contains $HOME or $USERPROFILE in PowerShell command'
            echo ""
            ERRORS=$((ERRORS + 1))
        fi
    fi

done < <(find "$SKILL_DIR" \( -name '*.md' -o -name '*.json' -o -name '*.sh' -o -name '*.ps1' \) -print0 2>/dev/null)

if [ $ERRORS -gt 0 ]; then
    echo "========================================"
    echo "Found $ERRORS Windows-unsafe pattern(s)."
    echo ""
    echo 'Fix: Replace $-based syntax with $-free equivalents:'
    echo '  - $env:USERPROFILE  ->  ~'
    echo '  - $_                ->  -ExpandProperty or property-based Where-Object'
    echo '  - $(...)            ->  method call syntax like (Get-Date).AddDays(-7)'
    echo ""
    echo "See: .claude/skills/lessons-extractor/SKILL.md#troubleshooting (installed)"
    echo "     skills/lessons-extractor/SKILL.md#troubleshooting (source)"
    exit 1
fi

echo "✓ All skills pass Windows-safety checks."
