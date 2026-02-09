@echo off
setlocal enabledelayedexpansion
REM spec-workflow-dev-sync.cmd
REM Copies local plugin source into the Claude Code plugin cache.
REM
REM Usage: tools\spec-workflow-dev-sync.cmd
REM
REM Why: Claude Code runs plugins from %USERPROFILE%\.claude\plugins\cache\,
REM not from your working directory. This script copies local edits into the
REM cache for fast development iteration.

set "SCRIPT_DIR=%~dp0"
set "SOURCE=%SCRIPT_DIR%..\plugins\spec-workflow"
set "PLUGIN_JSON=%SOURCE%\.claude-plugin\plugin.json"

if not exist "%SOURCE%" (
    echo ERROR: Source not found: %SOURCE%
    exit /b 1
)

if not exist "%PLUGIN_JSON%" (
    echo ERROR: plugin.json not found: %PLUGIN_JSON%
    exit /b 1
)

REM Derive local version from plugin.json
for /f "tokens=2 delims=:," %%A in ('findstr /c:"\"version\"" "%PLUGIN_JSON%"') do (
    set "RAW=%%A"
)
set "LOCAL_VERSION=!RAW:"=!"
set "LOCAL_VERSION=!LOCAL_VERSION: =!"

if "!LOCAL_VERSION!"=="" (
    echo ERROR: Could not parse version from %PLUGIN_JSON%
    exit /b 1
)

set "CACHE_PARENT=%USERPROFILE%\.claude\plugins\cache\bryce-labs\spec-workflow"

REM Detect installed version with deterministic selection policy:
REM 1. If CACHE_PARENT\LOCAL_VERSION exists -> use it (exact match)
REM 2. Else if exactly one version dir exists -> use it
REM 3. Else if multiple dirs exist -> pick first (alphabetical), warn
REM 4. Else (no cache dir) -> fall back to LOCAL_VERSION (fresh install)
set "VERSION="
set "DIR_COUNT=0"
set "FIRST_DIR="

if exist "!CACHE_PARENT!" (
    for /f "delims=" %%D in ('dir /b /ad "!CACHE_PARENT!" 2^>nul ^| findstr /v "__tmp"') do (
        set /a DIR_COUNT+=1
        if "!FIRST_DIR!"=="" set "FIRST_DIR=%%D"
    )
)

REM Policy 1: exact match with local version
if exist "!CACHE_PARENT!\!LOCAL_VERSION!" (
    set "VERSION=!LOCAL_VERSION!"
) else if !DIR_COUNT! equ 1 (
    REM Policy 2: sole version dir
    set "VERSION=!FIRST_DIR!"
) else if !DIR_COUNT! gtr 1 (
    REM Policy 3: multiple dirs — pick first, warn loudly
    set "VERSION=!FIRST_DIR!"
    echo WARNING: Multiple cache versions found in !CACHE_PARENT!
    for /f "delims=" %%D in ('dir /b /ad "!CACHE_PARENT!" 2^>nul ^| findstr /v "__tmp"') do (
        echo   - %%D
    )
    echo   Selected: !VERSION!
    echo   To fix: delete stale version dirs
    echo.
)

REM Policy 4: fallback to local version
if "!VERSION!"=="" set "VERSION=!LOCAL_VERSION!"

if "!VERSION!"=="" (
    echo ERROR: Could not determine plugin version
    exit /b 1
)

set "CACHE_DIR=!CACHE_PARENT!\!VERSION!"
set "CACHE_TMP=!CACHE_DIR!.__tmp"

REM Warn if versions differ
if not "!VERSION!"=="!LOCAL_VERSION!" (
    echo NOTE: Local plugin.json says v!LOCAL_VERSION!, but installed cache is v!VERSION!
    echo       Syncing into installed version so Claude Code picks it up.
    echo.
)

echo spec-workflow-dev-sync
echo   Source:  %SOURCE%
echo   Cache:   !CACHE_DIR!
echo   Version: !VERSION!
echo.

REM Atomic-ish copy: write to temp dir, then rename
if exist "!CACHE_TMP!" rmdir /s /q "!CACHE_TMP!"
if exist "!CACHE_DIR!" rmdir /s /q "!CACHE_DIR!"

REM robocopy returns 0-7 on success; /E = recursive, /NFL /NDL /NJH /NJS = quiet
robocopy "%SOURCE%" "!CACHE_TMP!" /E /NFL /NDL /NJH /NJS
if errorlevel 8 (
    echo ERROR: robocopy failed with exit code %errorlevel%
    if exist "!CACHE_TMP!" rmdir /s /q "!CACHE_TMP!"
    exit /b 1
)

REM Verify .claude-plugin was copied
if not exist "!CACHE_TMP!\.claude-plugin\plugin.json" (
    echo ERROR: .claude-plugin\plugin.json missing from copy
    if exist "!CACHE_TMP!" rmdir /s /q "!CACHE_TMP!"
    exit /b 1
)

REM Verify sentinel in spec.md (hard error — sync is invalid without it)
findstr /c:"ORCH_SENTINEL" "!CACHE_TMP!\commands\spec.md" >nul 2>&1
if errorlevel 1 (
    echo ERROR: ORCH_SENTINEL not found in spec.md — sync aborted
    if exist "!CACHE_TMP!" rmdir /s /q "!CACHE_TMP!"
    exit /b 1
)

REM Rename temp to final
ren "!CACHE_TMP!" "!VERSION!"

echo Verifying sentinel in cached spec.md:
findstr /c:"ORCH_SENTINEL" "!CACHE_DIR!\commands\spec.md"
echo.
echo ========================================
echo   spec-workflow v!VERSION! synced to cache
echo   Open a NEW chat window to pick up changes
echo ========================================
endlocal
