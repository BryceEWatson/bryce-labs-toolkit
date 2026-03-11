@echo off
:: parse-transcripts - Claude Code session transcript parser
:: Windows batch wrapper for parse-transcripts.js

node "%~dp0parse-transcripts.js" %*
