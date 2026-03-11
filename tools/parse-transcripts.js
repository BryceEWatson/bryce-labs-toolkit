#!/usr/bin/env node
/**
 * parse-transcripts - Parse Claude Code session transcripts
 *
 * A cross-platform CLI tool and importable module for parsing Claude Code
 * JSONL session transcripts. Extracts summaries, file writes, token costs,
 * and tool usage from session history.
 *
 * Usage:
 *   parse-transcripts --list
 *   parse-transcripts --recent [n] [--mode MODE] [--json]
 *   parse-transcripts --project <path> [--mode MODE] [--json]
 *   parse-transcripts --session <file> [--mode MODE] [--json]
 *   parse-transcripts --help
 *
 * Modes: summary (default), writes, costs, tools, all
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================================
// Constants
// ============================================================================

const TOOL_VERSION = '1.0.0';
const MIN_NODE_VERSION = 14;

// Pricing as of March 2026 — verify at https://claude.com/pricing
const PRICING = {
  'sonnet': { inputPerMillion: 3.00, outputPerMillion: 15.00, cacheWritePerMillion: 3.75, cacheReadPerMillion: 0.30 },
  'opus':   { inputPerMillion: 5.00, outputPerMillion: 25.00, cacheWritePerMillion: 6.25, cacheReadPerMillion: 0.50 },
  'haiku':  { inputPerMillion: 1.00, outputPerMillion: 5.00,  cacheWritePerMillion: 1.25, cacheReadPerMillion: 0.10 },
};
const DEFAULT_PRICING_MODEL = 'sonnet';

// Directories that contain registry files, NOT JSONL transcripts.
// NEVER scan these for session data.
const EXCLUDED_DIRS = ['local-agent-mode-sessions', 'claude-code-sessions'];

const VALID_MODES = ['summary', 'writes', 'costs', 'tools', 'all'];

// ============================================================================
// Utility Functions
// ============================================================================

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE_VERSION) {
    console.error(`[ERROR] Node.js >= ${MIN_NODE_VERSION} required (found ${process.versions.node})`);
    process.exit(1);
  }
}

let verboseEnabled = false;

function log(level, message) {
  const prefixes = {
    info: '[INFO]',
    warn: '[WARN]',
    error: '[ERROR]',
    verbose: '[DEBUG]'
  };
  if (level === 'verbose' && !verboseEnabled) return;
  const prefix = prefixes[level] || '';
  console.error(`${prefix} ${message}`);
}

// ============================================================================
// Session Discovery
// ============================================================================

/**
 * Get the Claude home directory.
 * On Windows, checks %APPDATA%/Claude first, then falls back to ~/.claude.
 * On all platforms, defaults to ~/.claude.
 */
function getClaudeHome() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    const appDataPath = path.join(process.env.APPDATA, 'Claude');
    if (fs.existsSync(appDataPath)) {
      return appDataPath;
    }
  }
  return path.join(os.homedir(), '.claude');
}

/**
 * Find all session directories (encoded project paths) under Claude home.
 * Optionally filter by a project path substring.
 *
 * @param {string} [projectFilter] - Substring to match against decoded project paths
 * @returns {Array<{source: string, dir: string, project: string}>}
 */
function findSessionDirs(projectFilter) {
  const claudeHome = getClaudeHome();
  const projectsDir = path.join(claudeHome, 'projects');

  if (!fs.existsSync(projectsDir)) {
    log('verbose', `Projects directory not found: ${projectsDir}`);
    return [];
  }

  let entries;
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (err) {
    log('warn', `Cannot read projects directory: ${err.message}`);
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Skip registry directories — these do NOT contain JSONL transcripts
    if (EXCLUDED_DIRS.includes(entry.name)) continue;

    const decodedProject = decodeProjectPath(entry.name);
    if (projectFilter && !decodedProject.toLowerCase().includes(projectFilter.toLowerCase())) {
      continue;
    }

    results.push({
      source: 'projects',
      dir: path.join(projectsDir, entry.name),
      project: decodedProject,
    });
  }

  return results;
}

/**
 * Decode an encoded project path.
 * The encoding replaces path separators with '-'.
 * e.g., '-home-user-myapp' → '/home/user/myapp'
 * e.g., 'c--Users-Bryce-Projects-foo' → 'C:/Users/Bryce/Projects/foo'
 */
function decodeProjectPath(encoded) {
  // Windows-style: starts with a drive letter like 'c--'
  const winMatch = encoded.match(/^([a-zA-Z])--(.*)/);
  if (winMatch) {
    const drive = winMatch[1].toUpperCase();
    const rest = winMatch[2].replace(/-/g, '/');
    return `${drive}:/${rest}`;
  }
  // Unix-style: starts with '-' representing '/'
  if (encoded.startsWith('-')) {
    return encoded.replace(/-/g, '/');
  }
  // Fallback: just replace dashes
  return encoded.replace(/-/g, '/');
}

/**
 * Find JSONL session files within discovered session directories.
 * Handles both layouts:
 *   - Newer: <projectDir>/sessions/<uuid>.jsonl
 *   - Older: <projectDir>/<uuid>.jsonl
 *
 * @param {string} [projectFilter] - Substring to match against project paths
 * @param {number} [limit] - Maximum number of files to return (sorted by mtime descending)
 * @returns {Array<{path: string, source: string, project: string, sessionId: string, mtime: Date, size: number}>}
 */
function findSessionFiles(projectFilter, limit) {
  const dirs = findSessionDirs(projectFilter);
  const files = [];

  for (const dirInfo of dirs) {
    // Check newer layout: sessions/ subdirectory
    const sessionsSubdir = path.join(dirInfo.dir, 'sessions');
    const dirsToScan = [];

    if (fs.existsSync(sessionsSubdir)) {
      dirsToScan.push(sessionsSubdir);
    }
    // Also scan the project dir directly for older layout
    dirsToScan.push(dirInfo.dir);

    for (const scanDir of dirsToScan) {
      let entries;
      try {
        entries = fs.readdirSync(scanDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

        const filePath = path.join(scanDir, entry.name);
        let stat;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }

        const sessionId = entry.name.replace('.jsonl', '');
        files.push({
          path: filePath,
          source: dirInfo.source,
          project: dirInfo.project,
          sessionId,
          mtime: stat.mtime,
          size: stat.size,
        });
      }
    }
  }

  // Sort by modification time, newest first
  files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (limit && limit > 0) {
    return files.slice(0, limit);
  }
  return files;
}

// ============================================================================
// JSONL Parsing
// ============================================================================

/**
 * Parse a JSONL session file into an array of records.
 * Synchronous — reads the entire file, splits by newlines, parses each line.
 * Malformed lines are skipped with a warning (never crashes).
 *
 * @param {string} filePath - Path to the .jsonl file
 * @returns {Array<Object>} Parsed records
 */
function parseSession(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log('error', `Cannot read file: ${filePath} — ${err.message}`);
    return [];
  }

  // Strip BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  const lines = content.split('\n');
  const records = [];
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      records.push(JSON.parse(line));
    } catch {
      skipped++;
      if (skipped <= 3) {
        log('verbose', `Skipped malformed line ${i + 1} in ${path.basename(filePath)}`);
      }
    }
  }

  if (skipped > 3) {
    log('verbose', `... and ${skipped - 3} more malformed lines in ${path.basename(filePath)}`);
  }

  return records;
}

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extract a summary from parsed session records.
 *
 * @param {Array<Object>} records - Parsed JSONL records
 * @param {Object} [fileInfo] - Optional file metadata (path, sessionId, mtime, size)
 * @returns {Object} Summary object
 */
function extractSummary(records, fileInfo) {
  const userMessages = records.filter(r => r.type === 'user' && !r.isSidechain);
  const assistantMessages = records.filter(r => r.type === 'assistant' && !r.isSidechain);
  const allMessages = records.filter(r => (r.type === 'user' || r.type === 'assistant') && !r.isSidechain);

  // Extract topic from first user message
  let topic = '(unknown)';
  if (userMessages.length > 0) {
    const firstUser = userMessages[0];
    const content = firstUser.message?.content;
    if (typeof content === 'string') {
      topic = content.slice(0, 120);
    } else if (Array.isArray(content)) {
      const textBlock = content.find(b => b.type === 'text');
      if (textBlock) {
        topic = textBlock.text.slice(0, 120);
      }
    }
  }

  // Extract timestamps for duration
  const timestamps = records
    .filter(r => r.timestamp)
    .map(r => new Date(r.timestamp).getTime())
    .filter(t => !isNaN(t));
  const startTime = timestamps.length > 0 ? Math.min(...timestamps) : null;
  const endTime = timestamps.length > 0 ? Math.max(...timestamps) : null;
  const durationMs = (startTime && endTime) ? endTime - startTime : 0;

  // Collect unique models
  const models = new Set();
  for (const r of assistantMessages) {
    const model = r.message?.model;
    if (model) models.add(model);
  }

  // Count tool calls
  let toolCallCount = 0;
  for (const r of assistantMessages) {
    const content = r.message?.content;
    if (Array.isArray(content)) {
      toolCallCount += content.filter(b => b.type === 'tool_use').length;
    }
  }

  // Git branch
  const branches = new Set();
  for (const r of records) {
    if (r.gitBranch) branches.add(r.gitBranch);
  }

  return {
    sessionId: fileInfo?.sessionId || null,
    filePath: fileInfo?.path || null,
    project: fileInfo?.project || null,
    topic,
    userMessages: userMessages.length,
    assistantMessages: assistantMessages.length,
    totalMessages: allMessages.length,
    toolCallCount,
    models: Array.from(models),
    gitBranches: Array.from(branches),
    startTime: startTime ? new Date(startTime).toISOString() : null,
    endTime: endTime ? new Date(endTime).toISOString() : null,
    durationMs,
    durationFormatted: formatDuration(durationMs),
    fileSize: fileInfo?.size || null,
    recordCount: records.length,
  };
}

/**
 * Extract file write operations from parsed session records.
 *
 * @param {Array<Object>} records - Parsed JSONL records
 * @returns {Array<Object>} Write operations
 */
function extractWrites(records) {
  const writes = [];
  const writeTools = ['Write', 'Edit', 'NotebookEdit'];

  for (const record of records) {
    if (record.type !== 'assistant' || record.isSidechain) continue;

    const content = record.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      if (!writeTools.includes(block.name)) continue;

      const input = block.input || {};
      writes.push({
        tool: block.name,
        toolUseId: block.id || null,
        filePath: input.file_path || input.path || null,
        description: block.name === 'Edit'
          ? `Edit: ${(input.old_string || '').slice(0, 60)}...`
          : `${block.name}: ${input.file_path || '(unknown)'}`,
        contentPreview: (input.content || input.new_string || '').slice(0, 200),
        timestamp: record.timestamp || null,
      });
    }
  }

  return writes;
}

/**
 * Extract token usage and cost data from parsed session records.
 * Filters out isSidechain and isApiErrorMessage records.
 *
 * @param {Array<Object>} records - Parsed JSONL records
 * @returns {Object} Cost breakdown
 */
function extractCosts(records) {
  const turns = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalCacheReadTokens = 0;

  for (const record of records) {
    // Only count assistant messages for token usage
    if (record.type !== 'assistant') continue;
    // Filter out sidechain (subagent) records
    if (record.isSidechain) continue;
    // Filter out API error messages
    if (record.isApiErrorMessage) continue;

    // Token usage can be at message.usage or top-level usage
    const usage = record.message?.usage || record.usage;
    if (!usage) continue;

    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
    const cacheReadTokens = usage.cache_read_input_tokens || 0;

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCacheWriteTokens += cacheWriteTokens;
    totalCacheReadTokens += cacheReadTokens;

    turns.push({
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      model: record.message?.model || null,
      timestamp: record.timestamp || null,
    });
  }

  // Calculate cost using default pricing
  // Pricing as of March 2026 — verify at https://claude.com/pricing
  const pricing = PRICING[DEFAULT_PRICING_MODEL];
  const inputCost = (totalInputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (totalOutputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheWriteCost = (totalCacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion;
  const cacheReadCost = (totalCacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

  // Efficiency metrics
  const totalTokens = totalInputTokens + totalOutputTokens;
  const cacheHitRate = (totalInputTokens > 0 && totalCacheReadTokens > 0)
    ? (totalCacheReadTokens / (totalInputTokens + totalCacheReadTokens)) * 100
    : 0;

  return {
    turns,
    totals: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheWriteTokens: totalCacheWriteTokens,
      cacheReadTokens: totalCacheReadTokens,
      totalTokens,
      estimatedCostUSD: Math.round(totalCost * 10000) / 10000,
      breakdown: {
        inputCostUSD: Math.round(inputCost * 10000) / 10000,
        outputCostUSD: Math.round(outputCost * 10000) / 10000,
        cacheWriteCostUSD: Math.round(cacheWriteCost * 10000) / 10000,
        cacheReadCostUSD: Math.round(cacheReadCost * 10000) / 10000,
      },
      pricingModel: DEFAULT_PRICING_MODEL,
      pricingNote: 'Pricing as of March 2026. Verify at https://claude.com/pricing. Pro/Max plan users are not billed per-token — these are API-equivalent costs for comparison.',
    },
    efficiency: {
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      tokensPerTurn: turns.length > 0 ? Math.round(totalTokens / turns.length) : 0,
      turnsWithUsage: turns.length,
    },
  };
}

/**
 * Extract tool usage statistics from parsed session records.
 *
 * @param {Array<Object>} records - Parsed JSONL records
 * @returns {Object} Tool usage data
 */
function extractToolUsage(records) {
  const frequency = {};
  const timeline = [];
  let totalToolCalls = 0;

  for (const record of records) {
    if (record.type !== 'assistant' || record.isSidechain) continue;

    const content = record.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type !== 'tool_use') continue;

      const toolName = block.name || 'unknown';
      frequency[toolName] = (frequency[toolName] || 0) + 1;
      totalToolCalls++;

      timeline.push({
        tool: toolName,
        id: block.id || null,
        timestamp: record.timestamp || null,
      });
    }
  }

  // Sort frequency by count descending
  const toolFrequency = Object.entries(frequency)
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);

  return {
    toolFrequency,
    toolTimeline: timeline,
    totalToolCalls,
  };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Output Formatting
// ============================================================================

function printSummary(summary, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`\n=== Session Summary ===`);
  if (summary.sessionId) console.log(`  Session:    ${summary.sessionId}`);
  if (summary.project) console.log(`  Project:    ${summary.project}`);
  console.log(`  Topic:      ${summary.topic}`);
  console.log(`  Duration:   ${summary.durationFormatted}`);
  console.log(`  Messages:   ${summary.userMessages} user, ${summary.assistantMessages} assistant`);
  console.log(`  Tool calls: ${summary.toolCallCount}`);
  console.log(`  Models:     ${summary.models.join(', ') || '(none detected)'}`);
  if (summary.gitBranches.length > 0) console.log(`  Branches:   ${summary.gitBranches.join(', ')}`);
  if (summary.fileSize) console.log(`  File size:  ${formatBytes(summary.fileSize)}`);
  console.log(`  Records:    ${summary.recordCount}`);
}

function printWrites(writes, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(writes, null, 2));
    return;
  }
  console.log(`\n=== File Writes (${writes.length}) ===`);
  if (writes.length === 0) {
    console.log('  (no file writes detected)');
    return;
  }
  for (const w of writes) {
    console.log(`  [${w.tool}] ${w.filePath || '(unknown path)'}`);
    if (w.contentPreview) {
      const preview = w.contentPreview.replace(/\n/g, '\\n').slice(0, 100);
      console.log(`    Preview: ${preview}...`);
    }
  }
}

function printCosts(costs, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(costs, null, 2));
    return;
  }
  const t = costs.totals;
  console.log(`\n=== Token Usage & Cost ===`);
  console.log(`  Input tokens:       ${t.inputTokens.toLocaleString()}`);
  console.log(`  Output tokens:      ${t.outputTokens.toLocaleString()}`);
  console.log(`  Cache write tokens: ${t.cacheWriteTokens.toLocaleString()}`);
  console.log(`  Cache read tokens:  ${t.cacheReadTokens.toLocaleString()}`);
  console.log(`  Total tokens:       ${t.totalTokens.toLocaleString()}`);
  console.log(`  Estimated cost:     $${t.estimatedCostUSD.toFixed(4)} (${t.pricingModel} pricing)`);
  console.log(`  Cache hit rate:     ${costs.efficiency.cacheHitRate}%`);
  console.log(`  Tokens/turn:        ${costs.efficiency.tokensPerTurn.toLocaleString()}`);
  console.log(`  Note: ${t.pricingNote}`);
}

function printToolUsage(toolUsage, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(toolUsage, null, 2));
    return;
  }
  console.log(`\n=== Tool Usage (${toolUsage.totalToolCalls} calls) ===`);
  if (toolUsage.toolFrequency.length === 0) {
    console.log('  (no tool calls detected)');
    return;
  }
  for (const { tool, count } of toolUsage.toolFrequency) {
    const bar = '#'.repeat(Math.min(count, 40));
    console.log(`  ${tool.padEnd(20)} ${String(count).padStart(4)} ${bar}`);
  }
}

// ============================================================================
// CLI
// ============================================================================

function printHelp() {
  console.log(`
parse-transcripts v${TOOL_VERSION} — Parse Claude Code session transcripts

Usage:
  parse-transcripts --list                          List all discoverable session dirs
  parse-transcripts --recent [n]  [--mode MODE]     Analyze N most recent sessions (default 5)
  parse-transcripts --project <path> [--mode MODE]  Filter by project path substring
  parse-transcripts --session <file> [--mode MODE]  Analyze a single JSONL file

Options:
  --mode <MODE>   Output mode: summary, writes, costs, tools, all (default: summary)
  --json          Machine-readable JSON output
  --verbose       Enable debug logging
  --help          Show this help

Modes:
  summary   Session overview (topic, duration, message counts, models)
  writes    File write operations (Write, Edit, NotebookEdit tool calls)
  costs     Token usage and estimated cost breakdown
  tools     Tool call frequency and timeline
  all       All of the above

Session Storage:
  Transcripts are stored in ~/.claude/projects/<encoded-path>/ as JSONL files.
  On Windows, the base may be %APPDATA%/Claude/ instead of ~/.claude/.
  The directories local-agent-mode-sessions/ and claude-code-sessions/ contain
  registry files only — they are NOT scanned for transcripts.
`);
}

function parseArgs(argv) {
  const args = {
    list: false,
    recent: null,
    project: null,
    session: null,
    mode: 'summary',
    json: false,
    verbose: false,
    help: false,
  };

  const rawArgs = argv.slice(2);
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--list':
        args.list = true;
        break;
      case '--recent':
        args.recent = 5; // default
        if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) {
          const n = parseInt(rawArgs[i + 1], 10);
          if (!isNaN(n) && n > 0) {
            args.recent = n;
            i++;
          }
        }
        break;
      case '--project':
        if (i + 1 < rawArgs.length) {
          args.project = rawArgs[++i];
        }
        break;
      case '--session':
        if (i + 1 < rawArgs.length) {
          args.session = rawArgs[++i];
        }
        break;
      case '--mode':
        if (i + 1 < rawArgs.length) {
          args.mode = rawArgs[++i];
        }
        break;
      case '--json':
        args.json = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        log('warn', `Unknown argument: ${arg}`);
    }
  }

  return args;
}

function validateArgs(args) {
  if (args.mode && !VALID_MODES.includes(args.mode)) {
    log('error', `Invalid mode: ${args.mode}. Valid modes: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  }

  const actionCount = [args.list, args.recent !== null, args.project !== null, args.session !== null]
    .filter(Boolean).length;

  if (actionCount === 0 && !args.help) {
    log('error', 'No action specified. Use --list, --recent, --project, or --session.');
    printHelp();
    process.exit(1);
  }

  if (actionCount > 1) {
    log('error', 'Only one action allowed at a time (--list, --recent, --project, --session).');
    process.exit(1);
  }
}

// ============================================================================
// Main Actions
// ============================================================================

function runList(jsonMode) {
  const dirs = findSessionDirs();
  if (jsonMode) {
    console.log(JSON.stringify(dirs, null, 2));
    return;
  }
  console.log(`\nDiscovered ${dirs.length} session director${dirs.length === 1 ? 'y' : 'ies'}:\n`);
  for (const d of dirs) {
    console.log(`  ${d.project}`);
    console.log(`    ${d.dir}`);
  }
  if (dirs.length === 0) {
    console.log('  (none found — check that Claude Code has been used on this machine)');
  }
}

function analyzeSession(filePath, mode, jsonMode) {
  const records = parseSession(filePath);
  if (records.length === 0) {
    log('warn', `No records found in ${filePath}`);
    return;
  }

  // Build fileInfo from the path
  const stat = fs.statSync(filePath);
  const fileInfo = {
    path: filePath,
    sessionId: path.basename(filePath, '.jsonl'),
    mtime: stat.mtime,
    size: stat.size,
  };

  const modes = mode === 'all' ? ['summary', 'writes', 'costs', 'tools'] : [mode];

  if (jsonMode && mode === 'all') {
    const result = {};
    if (modes.includes('summary')) result.summary = extractSummary(records, fileInfo);
    if (modes.includes('writes')) result.writes = extractWrites(records);
    if (modes.includes('costs')) result.costs = extractCosts(records);
    if (modes.includes('tools')) result.tools = extractToolUsage(records);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const m of modes) {
    switch (m) {
      case 'summary': printSummary(extractSummary(records, fileInfo), jsonMode); break;
      case 'writes': printWrites(extractWrites(records), jsonMode); break;
      case 'costs': printCosts(extractCosts(records), jsonMode); break;
      case 'tools': printToolUsage(extractToolUsage(records), jsonMode); break;
    }
  }
}

function runRecent(limit, mode, jsonMode, projectFilter) {
  const files = findSessionFiles(projectFilter, limit);
  if (files.length === 0) {
    log('info', 'No session files found.');
    return;
  }

  if (jsonMode) {
    const results = [];
    for (const f of files) {
      const records = parseSession(f.path);
      const result = { fileInfo: f };
      const modes = mode === 'all' ? ['summary', 'writes', 'costs', 'tools'] : [mode];
      if (modes.includes('summary')) result.summary = extractSummary(records, f);
      if (modes.includes('writes')) result.writes = extractWrites(records);
      if (modes.includes('costs')) result.costs = extractCosts(records);
      if (modes.includes('tools')) result.tools = extractToolUsage(records);
      results.push(result);
    }
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\nAnalyzing ${files.length} most recent session${files.length === 1 ? '' : 's'}...\n`);
  for (const f of files) {
    console.log(`${'─'.repeat(60)}`);
    console.log(`Session: ${f.sessionId}`);
    console.log(`Project: ${f.project}`);
    console.log(`Date:    ${f.mtime.toISOString()}`);
    console.log(`Size:    ${formatBytes(f.size)}`);
    analyzeSession(f.path, mode, false);
    console.log('');
  }
}

// ============================================================================
// Entry Point
// ============================================================================

function main() {
  checkNodeVersion();

  const args = parseArgs(process.argv);

  if (args.verbose) {
    verboseEnabled = true;
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  validateArgs(args);

  if (args.list) {
    runList(args.json);
  } else if (args.session) {
    const sessionPath = path.resolve(args.session);
    if (!fs.existsSync(sessionPath)) {
      log('error', `Session file not found: ${sessionPath}`);
      process.exit(1);
    }
    analyzeSession(sessionPath, args.mode, args.json);
  } else if (args.recent !== null) {
    runRecent(args.recent, args.mode, args.json, args.project);
  } else if (args.project) {
    runRecent(null, args.mode, args.json, args.project);
  }
}

// Module exports for programmatic use
module.exports = {
  getClaudeHome,
  findSessionDirs,
  findSessionFiles,
  parseSession,
  extractSummary,
  extractWrites,
  extractCosts,
  extractToolUsage,
  decodeProjectPath,
  PRICING,
};

// CLI entry point
if (require.main === module) {
  main();
}
