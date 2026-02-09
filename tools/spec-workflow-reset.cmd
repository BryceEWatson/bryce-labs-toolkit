@echo off
setlocal enabledelayedexpansion
REM spec-workflow-reset.cmd
REM Safely removes spec-workflow artifacts (specs, plans, reviews).
REM
REM Usage:
REM   tools\spec-workflow-reset.cmd [--dry-run] [--force] [--feature <kebab-name>]
REM
REM Options:
REM   --dry-run            Show what would be deleted without deleting anything
REM   --force              Skip confirmation prompt
REM   --feature <name>     Only delete artifacts for a specific feature (kebab-case)

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "SPECS_DIR=%REPO_ROOT%\docs\specs"
set "PLANS_DIR=%REPO_ROOT%\docs\plans"
set "REVIEWS_DIR=%REPO_ROOT%\docs\reviews"

set "DRY_RUN=false"
set "FORCE=false"
set "FEATURE="

REM Parse arguments
:parse_args
if "%~1"=="" goto :done_args
if "%~1"=="--dry-run" (
    set "DRY_RUN=true"
    shift
    goto :parse_args
)
if "%~1"=="--force" (
    set "FORCE=true"
    shift
    goto :parse_args
)
if "%~1"=="--feature" (
    if "%~2"=="" (
        echo ERROR: --feature requires a value
        exit /b 1
    )
    set "FEATURE=%~2"
    shift
    shift
    goto :parse_args
)
if "%~1"=="-h" goto :show_help
if "%~1"=="--help" goto :show_help
echo ERROR: Unknown option: %~1
exit /b 1

:show_help
echo Usage: %~nx0 [--dry-run] [--force] [--feature ^<kebab-name^>]
echo.
echo Options:
echo   --dry-run            Show what would be deleted
echo   --force              Skip confirmation prompt
echo   --feature ^<name^>     Only delete artifacts for a specific feature
exit /b 0

:done_args

REM Collect files to delete
set "FILE_COUNT=0"
set "FILES="

if not "!FEATURE!"=="" (
    REM Feature-scoped deletion
    if exist "!SPECS_DIR!\SPEC-!FEATURE!.md" (
        set /a FILE_COUNT+=1
        set "FILE_!FILE_COUNT!=!SPECS_DIR!\SPEC-!FEATURE!.md"
    )
    if exist "!PLANS_DIR!\PLAN-!FEATURE!.md" (
        set /a FILE_COUNT+=1
        set "FILE_!FILE_COUNT!=!PLANS_DIR!\PLAN-!FEATURE!.md"
    )
    if exist "!REVIEWS_DIR!\REVIEW-SPEC-!FEATURE!.md" (
        set /a FILE_COUNT+=1
        set "FILE_!FILE_COUNT!=!REVIEWS_DIR!\REVIEW-SPEC-!FEATURE!.md"
    )
    if exist "!REVIEWS_DIR!\REVIEW-PLAN-!FEATURE!.md" (
        set /a FILE_COUNT+=1
        set "FILE_!FILE_COUNT!=!REVIEWS_DIR!\REVIEW-PLAN-!FEATURE!.md"
    )
    if exist "!REVIEWS_DIR!\REVIEW-PR-!FEATURE!.md" (
        set /a FILE_COUNT+=1
        set "FILE_!FILE_COUNT!=!REVIEWS_DIR!\REVIEW-PR-!FEATURE!.md"
    )
) else (
    REM Full reset — all spec-workflow artifacts
    for %%F in ("!SPECS_DIR!\SPEC-*.md") do (
        set /a FILE_COUNT+=1
        set "FILE_!FILE_COUNT!=%%F"
    )
    for %%F in ("!PLANS_DIR!\PLAN-*.md") do (
        set /a FILE_COUNT+=1
        set "FILE_!FILE_COUNT!=%%F"
    )
    for %%F in ("!REVIEWS_DIR!\REVIEW-*.md") do (
        set /a FILE_COUNT+=1
        set "FILE_!FILE_COUNT!=%%F"
    )
)

REM Report
if !FILE_COUNT! equ 0 (
    echo spec-workflow-reset: No artifacts found to delete.
    exit /b 0
)

echo spec-workflow-reset
if not "!FEATURE!"=="" echo   Feature: !FEATURE!
echo   Files to delete (!FILE_COUNT!):
for /l %%I in (1,1,!FILE_COUNT!) do (
    echo     - !FILE_%%I!
)
echo.

REM Dry-run exits here
if "!DRY_RUN!"=="true" (
    echo [dry-run] No files were deleted.
    exit /b 0
)

REM Confirm unless --force
if not "!FORCE!"=="true" (
    set /p "REPLY=Delete these !FILE_COUNT! file(s)? [y/N] "
    if /i not "!REPLY!"=="y" (
        echo Aborted.
        exit /b 0
    )
)

REM Delete
set "DELETED=0"
for /l %%I in (1,1,!FILE_COUNT!) do (
    del "!FILE_%%I!" 2>nul
    set /a DELETED+=1
)

echo Deleted !DELETED! file(s).

REM Summary of what remains
echo.
echo Remaining files:
set "REMAINING=0"
for %%D in ("!SPECS_DIR!" "!PLANS_DIR!" "!REVIEWS_DIR!") do (
    for %%F in ("%%~D\*.md") do (
        if not "%%~nxF"==".gitkeep" (
            echo   - %%F
            set /a REMAINING+=1
        )
    )
)
if !REMAINING! equ 0 (
    echo   (none — directories contain only .gitkeep^)
)

endlocal
