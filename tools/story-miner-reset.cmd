@echo off
setlocal enabledelayedexpansion
REM story-miner-reset.cmd
REM Safely clears story-miner output artifacts.
REM
REM Usage:
REM   tools\story-miner-reset.cmd [--dry-run] [--force] [--output <dir>]
REM
REM Options:
REM   --dry-run            Show what would be deleted without deleting anything
REM   --force              Skip confirmation prompt
REM   --output <dir>       Output directory (default: .story-miner)

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "OUTPUT_DIR=.story-miner"
set "DRY_RUN=false"
set "FORCE=false"

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
if "%~1"=="--output" (
    if "%~2"=="" (
        echo ERROR: --output requires a value
        exit /b 1
    )
    set "OUTPUT_DIR=%~2"
    shift
    shift
    goto :parse_args
)
if "%~1"=="-h" goto :show_help
if "%~1"=="--help" goto :show_help
echo ERROR: Unknown option: %~1
exit /b 1

:show_help
echo Usage: %~nx0 [--dry-run] [--force] [--output ^<dir^>]
echo.
echo Options:
echo   --dry-run            Show what would be deleted
echo   --force              Skip confirmation prompt
echo   --output ^<dir^>       Output directory (default: .story-miner)
exit /b 0

:done_args

REM Resolve output dir relative to repo root
set "FULL_OUTPUT_DIR=!REPO_ROOT!\!OUTPUT_DIR!"

if not exist "!FULL_OUTPUT_DIR!" (
    echo story-miner-reset: Output directory not found: !FULL_OUTPUT_DIR!
    echo   Nothing to clear.
    exit /b 0
)

REM Try preprocessor first
set "PREPROCESSOR=!REPO_ROOT!\skills\story-miner\bin\story-preprocessor.cjs"
set "USE_NODE=false"

where node >nul 2>&1
if not errorlevel 1 (
    if exist "!PREPROCESSOR!" set "USE_NODE=true"
)

if "!USE_NODE!"=="true" (
    echo story-miner-reset (via preprocessor)
    echo   Output dir: !FULL_OUTPUT_DIR!
    echo.

    if "!DRY_RUN!"=="true" (
        node "!PREPROCESSOR!" --clear --output-dir "!FULL_OUTPUT_DIR!" --dry-run
        exit /b 0
    )

    if not "!FORCE!"=="true" (
        node "!PREPROCESSOR!" --clear --output-dir "!FULL_OUTPUT_DIR!" --dry-run
        echo.
        set /p "REPLY=Proceed with deletion? [y/N] "
        if /i not "!REPLY!"=="y" (
            echo Aborted.
            exit /b 0
        )
    )

    node "!PREPROCESSOR!" --clear --output-dir "!FULL_OUTPUT_DIR!"
    echo Done.
) else (
    REM Fallback: direct file deletion
    echo WARNING: node not found or preprocessor missing — using direct file deletion
    echo story-miner-reset (direct)
    echo   Output dir: !FULL_OUTPUT_DIR!
    echo.

    set "FILE_COUNT=0"
    for %%F in ("!FULL_OUTPUT_DIR!\*") do (
        if not "%%~nxF"==".gitkeep" (
            set /a FILE_COUNT+=1
            set "FILE_!FILE_COUNT!=%%F"
        )
    )

    if !FILE_COUNT! equ 0 (
        echo No files to delete.
        exit /b 0
    )

    echo Files to delete (!FILE_COUNT!):
    for /l %%I in (1,1,!FILE_COUNT!) do (
        echo   - !FILE_%%I!
    )
    echo.

    if "!DRY_RUN!"=="true" (
        echo [dry-run] No files were deleted.
        exit /b 0
    )

    if not "!FORCE!"=="true" (
        set /p "REPLY=Delete these !FILE_COUNT! file(s)? [y/N] "
        if /i not "!REPLY!"=="y" (
            echo Aborted.
            exit /b 0
        )
    )

    set "DELETED=0"
    for /l %%I in (1,1,!FILE_COUNT!) do (
        del "!FILE_%%I!" 2>nul
        set /a DELETED+=1
    )
    echo Deleted !DELETED! file(s).
)

endlocal
