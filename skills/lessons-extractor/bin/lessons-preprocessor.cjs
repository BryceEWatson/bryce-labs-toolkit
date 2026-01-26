#!/usr/bin/env node
/**
 * lessons-preprocessor - Pre-process Claude Code session logs for lesson extraction
 *
 * A cross-platform CLI tool that:
 * - Discovers logs without shell injection
 * - Streams and truncates JSONL content
 * - Filters out extractor sessions
 * - Extracts tool failures
 * - Supports incremental processing via cursor
 *
 * Usage:
 *   node lessons-preprocessor.cjs --since 7d
 *   node lessons-preprocessor.cjs --full --verbose
 *   node lessons-preprocessor.cjs --self-test
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// ============================================================================
// Constants
// ============================================================================

const TOOL_VERSION = '1.0.0';
const MIN_NODE_VERSION = 14;

// Default configuration values
const DEFAULTS = {
  maxLogsPerRun: 50,
  maxBytesPerLog: 100000,
  maxEventsPerLog: 500,
  truncateContentLength: 3000,
  contextEventsCount: 20,
  resolutionEventsCount: 20,
  errorWindowEvents: 5,
  skipExtractorSessions: true,
  cursorFile: '.lessons-cursor.json',
  maxRecentFiles: 200,
  maxOutputSizeBytes: 5000000,  // 5MB (increased from 500KB to allow more events per session)
  followSymlinks: false,
  outputDir: 'docs/ai/lessons-extractor',
  logGlob: '~/.claude/projects'
};

// Event types to keep during normalization
const KEEP_EVENT_TYPES = ['user', 'assistant', 'tool_call', 'tool_result', 'error', 'system'];

// Patterns to detect extractor sessions (structured markers, not simple regex)
const EXTRACTOR_MARKERS = [
  /<command-name>\/lessons-extractor<\/command-name>/i,
  /<command-name>\/lessons-preprocessor<\/command-name>/i,
  /^Base directory for this skill/m,
  /^Running lessons extractor skill/m
];

// Tool failure detection patterns (regex-second, after checking exitCode)
const ERROR_PATTERNS = [
  /command\s*not\s*found/i,
  /permission\s*denied/i,
  /ENOENT|no such file/i,
  /Illegal\s*\\\s*at\s*end\s*of\s*pattern/i,
  /CommandNotFoundException/i,
  /Output too large.*saved to/i,
  /\bfailed\b.*\b(compile|build|test)/i,
  /error:|Error:|ERROR:/i
];

// Default redaction patterns (compiled once at startup via compileRedactions)
const DEFAULT_REDACT_PATTERNS = [
  'api[_-]?key["\']?\\s*[:=]\\s*["\']?[\\w-]+',
  'password["\']?\\s*[:=]\\s*["\']?[^\\s"\',]+',
  'secret["\']?\\s*[:=]\\s*["\']?[\\w-]+',
  'token["\']?\\s*[:=]\\s*["\']?[\\w-]+',
  '/Users/[^/]+/',
  '/home/[^/]+/',
  'C:\\\\Users\\\\[^\\\\]+\\\\'
];

/**
 * Compile redaction patterns once at startup
 * Supports: plain patterns (uses 'gi') or /pattern/flags syntax
 * @param {string[]} patterns
 * @returns {{ regexes: Array<{regex: RegExp, source: string}>, warnings: string[] }}
 */
function compileRedactions(patterns) {
  const regexes = [];
  const warnings = [];

  for (const pattern of patterns) {
    try {
      let regex;
      // Check for /pattern/flags syntax - find LAST slash to handle patterns containing /
      if (pattern.startsWith('/') && pattern.length > 1) {
        const lastSlash = pattern.lastIndexOf('/');
        if (lastSlash > 0) {
          const body = pattern.slice(1, lastSlash);
          const flags = pattern.slice(lastSlash + 1);
          // Validate flags are all valid regex flags
          if (/^[gimsuy]*$/.test(flags)) {
            regex = new RegExp(body, flags || 'gi');
          } else {
            // Invalid flags, treat as plain pattern
            regex = new RegExp(pattern, 'gi');
          }
        } else {
          // No closing slash, treat as plain pattern
          regex = new RegExp(pattern, 'gi');
        }
      } else {
        // Plain pattern - use default 'gi' flags
        regex = new RegExp(pattern, 'gi');
      }
      regexes.push({ regex, source: pattern });
    } catch (e) {
      warnings.push(`Invalid redaction pattern: ${pattern} (${e.message})`);
    }
  }

  return { regexes, warnings };
}

// ============================================================================
// Logging
// ============================================================================

let verboseEnabled = false;

function log(level, message) {
  const prefixes = {
    success: '[OK]',
    info: '[INFO]',
    warn: '[WARN]',
    error: '[ERROR]',
    verbose: '[DEBUG]'
  };

  if (level === 'verbose' && !verboseEnabled) {
    return;
  }

  const prefix = prefixes[level] || '';
  console.log(`${prefix} ${message}`);
}

// ============================================================================
// Repository Root Detection & Safety
// ============================================================================

/**
 * Find the repository root by walking up from a starting directory
 * Looks for .git directory or package.json as markers
 * Falls back to deriving from skill path if installed at <repo>/.claude/skills/<skill>
 */
function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    // Check for .git directory (most reliable)
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    // Check for package.json as fallback
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  // Fallback: derive from skill location if we're inside .claude/skills/
  const skillRoot = getSkillRoot();
  const claudeMatch = skillRoot.match(/^(.+)[/\\]\.claude[/\\]skills[/\\]/);
  if (claudeMatch) {
    return claudeMatch[1];
  }

  // Last resort: use cwd
  return process.cwd();
}

/**
 * Validate output directory is safe to clear
 * Must be inside repo root, not root/home/system dirs
 */
function isOutputDirSafe(outputDir) {
  const resolved = path.resolve(outputDir);

  // Reject filesystem root
  if (resolved === '/' || /^[A-Za-z]:[\\/]?$/.test(resolved)) {
    return { safe: false, reason: 'Cannot clear filesystem root' };
  }

  // Reject home directory
  if (resolved === os.homedir()) {
    return { safe: false, reason: 'Cannot clear home directory' };
  }

  // Find repo root (works even if cwd is inside .claude/skills/...)
  const repoRoot = findRepoRoot(process.cwd());

  // Reject repo root itself
  if (resolved === repoRoot) {
    return { safe: false, reason: 'Cannot clear repository root' };
  }

  // Must be INSIDE the repo root
  const resolvedNorm = resolved.replace(/\\/g, '/');
  const repoRootNorm = repoRoot.replace(/\\/g, '/');
  if (!resolvedNorm.startsWith(repoRootNorm + '/')) {
    return { safe: false, reason: 'Output directory must be inside the repository' };
  }

  return { safe: true, reason: null };
}

/**
 * Clear generated lesson files from output directory
 */
function clearOutputFiles(outputDir, opts) {
  const resolved = path.resolve(outputDir);

  const safety = isOutputDirSafe(resolved);
  if (!safety.safe) {
    throw new Error(`Refusing to clear ${resolved}: ${safety.reason}`);
  }

  const filesToClear = [
    'lessons.md',
    'lessons.jsonl',
    'preprocessed.json',
    '.lessons-cursor.json'
  ];

  const deleted = [];

  for (const filename of filesToClear) {
    const filePath = path.join(resolved, filename);

    if (opts.dryRun) {
      if (fs.existsSync(filePath)) {
        log('info', `[DRY-RUN] Would delete: ${filePath}`);
        deleted.push(filename);
      }
      continue;
    }

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted.push(filename);
        log('verbose', `Deleted: ${filePath}`);
      }
    } catch (err) {
      log('warn', `Could not delete ${filePath}: ${err.message}`);
    }
  }

  if (deleted.length > 0) {
    log('success', `Cleared ${deleted.length} file(s): ${deleted.join(', ')}`);
  } else {
    log('info', 'No files to clear (directory already clean)');
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check Node.js version meets minimum requirement
 */
function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE_VERSION) {
    log('error', `Node.js >= ${MIN_NODE_VERSION} required (found ${process.versions.node})`);
    process.exit(1);
  }
}

/**
 * Expand ~ to user home directory (cross-platform)
 */
function expandPath(p) {
  if (!p) return p;
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Get the script's directory (for finding config relative to skill)
 */
function getScriptDir() {
  return path.dirname(__filename);
}

/**
 * Get the skill root directory (parent of bin/)
 */
function getSkillRoot() {
  return path.resolve(getScriptDir(), '..');
}

/**
 * Truncate a string to maxLength, adding marker if truncated
 */
function truncate(str, maxLength) {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '... [TRUNCATED]';
}

/**
 * Coerce any value to a string for safe text processing
 * - string: return as-is
 * - array of content blocks: extract .text from text blocks, join with \n
 * - other array/object: JSON.stringify (stable, deterministic)
 * - null/undefined: return empty string
 * - Never throws
 * @param {*} value - Any value to coerce
 * @returns {string}
 */
function coerceText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    // Handle Claude content block arrays: [{type:"text",text:"..."},...]
    const textParts = value
      .filter(b => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text);
    if (textParts.length > 0) return textParts.join('\n');
    // Fallback: stringify
    try { return JSON.stringify(value); } catch { return '[unserializable]'; }
  }

  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[unserializable]'; }
  }

  return String(value);
}

/**
 * Parse relative date strings like "7d", "2w", "1m", "24h"
 */
function parseRelativeDate(str) {
  if (!str) return null;

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  }

  // Relative: 7d, 2w, 1m, 24h
  const match = str.match(/^(\d+)([dwmh])$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const now = Date.now();
    const msPerUnit = {
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
      m: 30 * 24 * 60 * 60 * 1000
    };
    return new Date(now - num * msPerUnit[unit]);
  }

  return null;
}

// ============================================================================
// Event Normalization
// ============================================================================

/**
 * Extract text content from various event shapes
 * Always returns a string (coerces arrays/objects via coerceText)
 */
function extractText(raw) {
  // Direct content field
  if (raw.content !== undefined) return coerceText(raw.content);

  // Nested in message (can be array of content blocks)
  if (raw.message?.content !== undefined) return coerceText(raw.message.content);

  // Tool result content
  if (raw.tool_result?.content !== undefined) return coerceText(raw.tool_result.content);
  if (raw.toolResult?.content !== undefined) return coerceText(raw.toolResult.content);

  // Output field
  if (raw.output !== undefined) return coerceText(raw.output);

  return '';
}

/**
 * Detect event kind from raw JSONL event
 * TIGHTENED: raw.name alone doesn't trigger tool_result
 */
function detectEventKind(raw) {
  // Check explicit type field
  if (raw.type === 'user') return 'user';
  if (raw.type === 'assistant') return 'assistant';
  if (raw.type === 'error') return 'error';
  if (raw.type === 'system') return 'system';

  // Check for tool-related events
  if (raw.tool_calls || raw.toolCalls) return 'tool_call';

  // TIGHTENED: tool_result detection requires explicit signals
  if (raw.type === 'tool_result' || raw.type === 'tool-results') return 'tool_result';
  if (raw.exit_code !== undefined || raw.exitCode !== undefined) return 'tool_result';
  if (raw.tool_result || raw.toolResult) return 'tool_result';
  if (Array.isArray(raw.tool_results)) return 'tool_result';

  // Skip noise events
  if (raw.type === 'queue-operation') return null;
  if (raw.type === 'file-history-snapshot') return null;
  if (raw.type === 'persisted-output' && !raw.tool_results) return null;

  return null;
}

/**
 * Normalize a raw JSONL event to consistent shape
 */
function normalizeEvent(raw) {
  const kind = detectEventKind(raw);
  if (!kind) return null;

  return {
    kind,
    timestamp: raw.timestamp || raw.ts || null,
    text: extractText(raw),
    toolName: raw.tool?.name || raw.name || null,
    exitCode: raw.exit_code ?? raw.exitCode ?? null,
    command: raw.tool?.arguments?.command || raw.arguments?.command || null,
    sessionId: raw.sessionId || raw.session_id || null,
    metadata: {
      cwd: raw.cwd || null,
      gitBranch: raw.gitBranch || raw.git_branch || null
    }
  };
}

/**
 * Handle persisted-output with nested tool_results
 * Decision: EXPLODE into multiple normalized events
 */
function normalizePersistedOutput(raw) {
  if (raw.type !== 'persisted-output' || !Array.isArray(raw.tool_results)) {
    return null;
  }

  return raw.tool_results.map((tr, idx) => ({
    kind: 'tool_result',
    timestamp: raw.timestamp,
    text: coerceText(tr.content ?? tr.output ?? ''),
    toolName: tr.name || tr.tool || null,
    exitCode: tr.exit_code ?? tr.exitCode ?? null,
    command: tr.arguments?.command || null,
    sessionId: raw.sessionId || null,
    _explodedIndex: idx
  }));
}

// ============================================================================
// Log Discovery
// ============================================================================

/**
 * Recursively find JSONL files in a directory
 */
function findJsonlFiles(dir, options = {}) {
  const results = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip symlinks if configured
    if (entry.isSymbolicLink() && !options.followSymlinks) {
      continue;
    }

    if (entry.isDirectory()) {
      // Skip subagents directories
      if (entry.name === 'subagents') {
        continue;
      }

      // Recurse
      results.push(...findJsonlFiles(fullPath, options));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      // Skip agent-*.jsonl files
      if (entry.name.startsWith('agent-')) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        results.push({
          path: fullPath,
          mtime: stat.mtime,
          mtimeMs: stat.mtimeMs,
          size: stat.size
        });
      } catch (err) {
        log('verbose', `  Skipping unreadable file: ${fullPath}`);
      }
    }
  }

  return results;
}

/**
 * Discover log files without shell commands
 */
function discoverLogs(options) {
  const logDir = expandPath(options.logDir || DEFAULTS.logGlob);

  log('verbose', `Discovering logs in: ${logDir}`);

  if (!fs.existsSync(logDir)) {
    log('warn', `Log directory not found: ${logDir}`);
    return [];
  }

  let files = findJsonlFiles(logDir, {
    followSymlinks: options.followSymlinks ?? DEFAULTS.followSymlinks
  });

  // Filter by since date
  if (options.since) {
    const sinceMs = options.since.getTime();
    const before = files.length;
    files = files.filter(f => f.mtimeMs >= sinceMs);
    log('verbose', `  Filtered by --since: ${before} -> ${files.length} files`);
  }

  // Sort by mtime descending (most recent first)
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Limit to maxLogs
  const maxLogs = options.maxLogs ?? DEFAULTS.maxLogsPerRun;
  if (files.length > maxLogs) {
    log('verbose', `  Limiting to ${maxLogs} most recent logs`);
    files = files.slice(0, maxLogs);
  }

  return files;
}

// ============================================================================
// Extractor Session Detection
// ============================================================================

/**
 * Detect if a session is running the extractor (should be skipped)
 */
function isExtractorSession(events) {
  // Only check first 20 user/system events
  const checkEvents = events
    .filter(e => e.kind === 'user' || e.kind === 'system')
    .slice(0, 20);

  for (const event of checkEvents) {
    if (!event.text) continue;
    for (const marker of EXTRACTOR_MARKERS) {
      if (marker.test(event.text)) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// Tool Failure Extraction
// ============================================================================

/**
 * Check if text matches any error pattern
 */
function matchesErrorPattern(text) {
  if (!text) return false;
  return ERROR_PATTERNS.some(p => p.test(text));
}

/**
 * Check if an event is a tool failure
 */
function isToolFailure(event) {
  if (event.kind !== 'tool_result') return false;

  // Field-first: check exitCode
  if (event.exitCode != null && event.exitCode !== 0) {
    return true;
  }

  // Regex-second: fallback to content patterns
  if (matchesErrorPattern(event.text)) {
    return true;
  }

  return false;
}

/**
 * Extract tool failures from events
 */
function extractToolFailures(events) {
  const failures = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!isToolFailure(event)) continue;

    failures.push({
      tool: event.toolName,
      command: event.command,
      exitCode: event.exitCode,
      error: truncate(event.text, 500),
      timestamp: event.timestamp,
      eventIndex: i
    });
  }

  return failures;
}

// ============================================================================
// Redaction
// ============================================================================

/**
 * Apply pre-compiled redaction patterns
 * @param {object} obj - Object with text, error, command fields
 * @param {Array<{regex: RegExp, source: string}>} compiledRegexes - Pre-compiled regexes from compileRedactions()
 */
function applyRedaction(obj, compiledRegexes) {
  if (!obj) return obj;

  const result = { ...obj };

  // Redact .text, .error, and .command fields
  for (const field of ['text', 'error', 'command']) {
    if (!result[field]) continue;

    // Belt + suspenders: ensure we have a string before calling .replace()
    let redacted = typeof result[field] === 'string'
      ? result[field]
      : coerceText(result[field]);

    for (const { regex } of compiledRegexes) {
      regex.lastIndex = 0; // Reset for global regex
      redacted = redacted.replace(regex, '[REDACTED]');
    }
    result[field] = redacted;
  }

  return result;
}

// ============================================================================
// Sampling Strategy
// ============================================================================

/**
 * Compute which event indices to keep
 */
function computeSampleIndices(totalEvents, failureIndices, config) {
  const indices = new Set();

  // First N (context)
  const contextCount = config.contextEventsCount ?? DEFAULTS.contextEventsCount;
  for (let i = 0; i < Math.min(contextCount, totalEvents); i++) {
    indices.add(i);
  }

  // Last M (resolution)
  const resolutionCount = config.resolutionEventsCount ?? DEFAULTS.resolutionEventsCount;
  for (let i = Math.max(0, totalEvents - resolutionCount); i < totalEvents; i++) {
    indices.add(i);
  }

  // Error windows
  const windowSize = config.errorWindowEvents ?? DEFAULTS.errorWindowEvents;
  for (const fi of failureIndices) {
    const start = Math.max(0, fi - windowSize);
    const end = Math.min(totalEvents, fi + windowSize + 1);
    for (let i = start; i < end; i++) {
      indices.add(i);
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Truncate event content fields
 */
function truncateEvent(event, maxLength) {
  return {
    ...event,
    text: truncate(event.text, maxLength)
  };
}

// ============================================================================
// Log File Processing
// ============================================================================

/**
 * Process a single log file
 * @param {string} filePath - Path to the log file
 * @param {object} config - Configuration object
 * @param {Array<{regex: RegExp, source: string}>} compiledRedactions - Pre-compiled redaction regexes
 */
async function processLogFile(filePath, config, compiledRedactions) {
  const allEvents = [];
  const toolFailureIndices = [];

  const maxEvents = config.maxEventsPerLog ?? DEFAULTS.maxEventsPerLog;
  const maxBytes = config.maxBytesPerLog ?? DEFAULTS.maxBytesPerLog;

  let bytesRead = 0;
  let lineNumber = 0;
  let sessionId = null;
  let metadata = {};

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    lineNumber++;
    bytesRead += line.length;

    // Hard guardrail: stop if too many events
    if (allEvents.length >= maxEvents) {
      log('verbose', `  Reached maxEventsPerLog (${maxEvents}), stopping at line ${lineNumber}`);
      break;
    }

    // Hard guardrail: stop if too many bytes
    if (bytesRead >= maxBytes) {
      log('verbose', `  Reached maxBytesPerLog (${maxBytes}), stopping at line ${lineNumber}`);
      break;
    }

    let raw;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      log('verbose', `  Skipping malformed JSON at line ${lineNumber}`);
      continue;
    }

    // Extract session metadata from early events
    if (!sessionId && (raw.sessionId || raw.session_id)) {
      sessionId = raw.sessionId || raw.session_id;
    }
    if (raw.cwd && !metadata.cwd) metadata.cwd = raw.cwd;
    if ((raw.gitBranch || raw.git_branch) && !metadata.gitBranch) {
      metadata.gitBranch = raw.gitBranch || raw.git_branch;
    }

    // Handle persisted-output with nested tool_results
    const normalized = (raw.type === 'persisted-output' && Array.isArray(raw.tool_results))
      ? normalizePersistedOutput(raw)
      : [normalizeEvent(raw)];

    for (const event of normalized.filter(Boolean)) {
      // Store minimal fields only
      const minimal = {
        kind: event.kind,
        timestamp: event.timestamp,
        text: event.text,
        toolName: event.toolName,
        exitCode: event.exitCode,
        command: event.command
      };
      allEvents.push(minimal);

      // Index bookkeeping tied directly to allEvents.length
      const eventIdx = allEvents.length - 1;
      if (isToolFailure(minimal)) {
        toolFailureIndices.push(eventIdx);
      }
    }
  }

  // Generate session ID if not found
  if (!sessionId) {
    sessionId = path.basename(filePath, '.jsonl');
  }

  // Compute sample indices
  const keepIndices = computeSampleIndices(allEvents.length, toolFailureIndices, config);

  // Extract evidence snippets BEFORE truncation
  const evidenceSnippets = toolFailureIndices.map(idx => {
    const event = allEvents[idx];
    const redacted = applyRedaction(event, compiledRedactions);
    return {
      sessionId,
      timestamp: event.timestamp,
      excerpt: truncate(redacted.text, 200)
    };
  });

  // Apply redaction and truncation to kept events
  const truncateLength = config.truncateContentLength ?? DEFAULTS.truncateContentLength;
  const sampledEvents = keepIndices.map(i => {
    let event = allEvents[i];
    event = applyRedaction(event, compiledRedactions);
    return truncateEvent(event, truncateLength);
  });

  // Extract and redact tool failures
  const toolFailures = extractToolFailures(allEvents).map(f => applyRedaction(f, compiledRedactions));

  return {
    sessionId,
    metadata,
    totalEvents: allEvents.length,
    events: sampledEvents,
    toolFailures,
    evidence: evidenceSnippets,
    isExtractorSession: isExtractorSession(allEvents)
  };
}

// ============================================================================
// Cursor Management
// ============================================================================

/**
 * Read cursor file for incremental processing
 */
function readCursor(cursorPath) {
  try {
    if (!fs.existsSync(cursorPath)) return null;
    const data = JSON.parse(fs.readFileSync(cursorPath, 'utf-8'));
    return data;
  } catch (err) {
    log('warn', `Could not read cursor file: ${err.message}`);
    return null;
  }
}

/**
 * Write cursor file after processing
 */
function writeCursor(cursorPath, processedFiles, maxRecent = DEFAULTS.maxRecentFiles) {
  // Guard: skip writing cursor if no files processed
  if (!processedFiles || processedFiles.length === 0) {
    log('verbose', 'No files processed, skipping cursor update');
    return;
  }

  const recentFiles = processedFiles
    .slice(0, maxRecent)
    .map(f => ({
      path: f.path,
      mtimeMs: f.mtimeMs,
      sizeBytes: f.size
    }));

  const maxMtime = Math.max(...processedFiles.map(f => f.mtimeMs));

  const cursor = {
    schemaVersion: 1,
    lastRunAt: new Date().toISOString(),
    lastMtimeCutoffMs: maxMtime,
    recentFiles
  };

  fs.writeFileSync(cursorPath, JSON.stringify(cursor, null, 2) + '\n');
}

/**
 * Check if a file should be processed based on cursor
 */
function shouldProcessFile(file, cursor) {
  if (!cursor) return true;

  // New file (mtime after last cutoff)
  if (file.mtimeMs > cursor.lastMtimeCutoffMs) return true;

  // Check recent files
  const recent = cursor.recentFiles?.find(r => r.path === file.path);
  if (!recent) return true;

  // Changed file (size differs)
  if (recent.sizeBytes !== file.size) return true;

  return false;
}

/**
 * Determine if cursor should be written based on run success
 * Blocks cursor update on: complete failure, high error rate, or unexpectedly empty output
 * @param {object} stats - Run statistics with logsAttempted, logsSucceeded, logsFailed
 * @param {number} sessionsWritten - Number of sessions written to output
 * @param {number} logsFound - Total logs found before filtering
 * @returns {{ write: boolean, reason: string }}
 */
function shouldWriteCursor(stats, sessionsWritten, logsFound) {
  const { logsAttempted, logsSucceeded, logsFailed } = stats;

  // No files attempted
  if (logsAttempted === 0) {
    return { write: false, reason: 'No files attempted' };
  }

  // Complete failure: all attempted files failed
  if (logsSucceeded === 0 && logsFailed > 0) {
    return { write: false, reason: `All ${logsFailed} files failed processing` };
  }

  // High error rate (> 50%)
  const errorRate = logsFailed / logsAttempted;
  if (errorRate > 0.5) {
    return { write: false, reason: `Error rate ${(errorRate * 100).toFixed(1)}% exceeds 50% threshold` };
  }

  // Unexpectedly empty output
  if (sessionsWritten === 0 && logsFound > 0) {
    return { write: false, reason: 'No sessions extracted despite logs found' };
  }

  // Good run
  return { write: true, reason: 'Run succeeded' };
}

// ============================================================================
// Output Generation
// ============================================================================

/**
 * Compute per-session budget based on total sessions
 */
function computePerSessionBudget(sessionCount, config) {
  const maxOutput = config.maxOutputSizeBytes ?? DEFAULTS.maxOutputSizeBytes;
  const availableBytes = maxOutput - 10000; // Reserve for summary
  const perSessionBytes = Math.floor(availableBytes / Math.max(1, sessionCount));

  const truncateLength = config.truncateContentLength ?? DEFAULTS.truncateContentLength;
  const computedEvents = Math.floor(perSessionBytes / (truncateLength * 2));

  // Clamp to minimum of 30 events per session (never zero)
  const maxEventsPerSession = Math.max(
    30,  // Increased from 10 to preserve more context
    Math.min(config.maxEventsPerLog ?? DEFAULTS.maxEventsPerLog, computedEvents)
  );

  return { perSessionBytes, maxEventsPerSession };
}

/**
 * Generate preprocessor output
 */
function generateOutput(sessions, stats, config) {
  return {
    preprocessorVersion: TOOL_VERSION,
    processedAt: new Date().toISOString(),
    config: {
      maxLogsPerRun: config.maxLogsPerRun ?? DEFAULTS.maxLogsPerRun,
      truncateContentLength: config.truncateContentLength ?? DEFAULTS.truncateContentLength,
      skipExtractorSessions: config.skipExtractorSessions ?? DEFAULTS.skipExtractorSessions
    },
    summary: {
      logsProcessed: sessions.length,
      totalEvents: sessions.reduce((sum, s) => sum + s.totalEvents, 0),
      sampledEvents: sessions.reduce((sum, s) => sum + s.events.length, 0),
      toolFailures: sessions.reduce((sum, s) => sum + s.toolFailures.length, 0),
      skipped: stats.skipped
    },
    sessions: sessions.map(s => ({
      sessionId: s.sessionId,
      logPath: s.logPath,
      mtime: s.mtime,
      eventCount: s.totalEvents,
      sampledEventCount: s.events.length,
      events: s.events,
      toolFailures: s.toolFailures,
      evidence: s.evidence
    }))
  };
}

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    since: null,
    output: null,
    outputDir: null,  // NEW: directory for outputs (distinct from --output file path)
    maxLogs: null,
    full: false,
    clear: false,     // NEW: clear generated files
    dryRun: false,
    verbose: false,
    config: null,
    cursor: null,
    selfTest: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--since':
      case '-s':
        opts.since = parseRelativeDate(args[++i]);
        break;
      case '--output':
      case '-o':
        opts.output = args[++i];
        break;
      case '--max-logs':
        opts.maxLogs = parseInt(args[++i], 10);
        break;
      case '--full':
      case '-f':
        opts.full = true;
        break;
      case '--dry-run':
      case '-n':
        opts.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        opts.verbose = true;
        break;
      case '--config':
      case '-c':
        opts.config = args[++i];
        break;
      case '--cursor':
        opts.cursor = args[++i];
        break;
      case '--output-dir':
        opts.outputDir = args[++i];
        break;
      case '--clear':
        opts.clear = true;
        break;
      case '--self-test':
        opts.selfTest = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
lessons-preprocessor v${TOOL_VERSION} - Pre-process Claude Code session logs

USAGE:
  node lessons-preprocessor.cjs [options]

OPTIONS:
  --since, -s <date>   Only logs modified after date
                       Formats: ISO (2026-01-15), relative (7d, 2w, 1m, 24h)

  --output-dir <dir>   Output directory for all generated files
                       Default: ${DEFAULTS.outputDir}

  --output, -o <path>  Output file path (deprecated, use --output-dir)

  --max-logs <n>       Max logs to process (default: ${DEFAULTS.maxLogsPerRun})

  --full, -f           Ignore cursor, process all matching logs

  --clear              Delete generated files from output directory

  --dry-run, -n        Show what would be processed (or deleted with --clear)

  --verbose, -v        Show detailed output

  --config, -c <path>  Path to config.json

  --cursor <path>      Path to cursor file

  --self-test          Run built-in tests

  --help, -h           Show this help

CLEAR MODE:
  --clear removes: lessons.md, lessons.jsonl, preprocessed.json, .lessons-cursor.json
  Directory: --output-dir > config.outputDir > default (${DEFAULTS.outputDir})
  Use --dry-run to preview. Directory must be inside the repository.

RELATIVE DATE PARSING:
  7d  = 7 days ago
  2w  = 2 weeks ago
  1m  = 1 month ago (30 days)
  24h = 24 hours ago

EXAMPLES:
  node lessons-preprocessor.cjs --since 7d
  node lessons-preprocessor.cjs --full --verbose
  node lessons-preprocessor.cjs --clear --dry-run
  node lessons-preprocessor.cjs --self-test
`);
}

// ============================================================================
// Self-Test Suite
// ============================================================================

async function runSelfTest() {
  console.log(`lessons-preprocessor v${TOOL_VERSION} - Self-Test\n`);

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.log(`  [FAIL] ${testName}`);
      failed++;
    }
  }

  // Test 1: Node version
  console.log('Node Version:');
  const major = parseInt(process.versions.node.split('.')[0], 10);
  assert(major >= MIN_NODE_VERSION, `Node >= ${MIN_NODE_VERSION} (found ${process.versions.node})`);

  // Test 2: Path expansion
  console.log('\nPath Expansion:');
  const expanded = expandPath('~/.claude');
  assert(expanded === path.join(os.homedir(), '.claude'), 'expands ~ to homedir');
  assert(expandPath('/absolute/path') === '/absolute/path', 'preserves absolute paths');
  assert(expandPath('C:\\Windows') === 'C:\\Windows', 'preserves Windows paths');

  // Test 3: Relative date parsing
  console.log('\nRelative Date Parsing:');
  const d7d = parseRelativeDate('7d');
  assert(d7d instanceof Date && !isNaN(d7d.getTime()), 'parses 7d');
  const d2w = parseRelativeDate('2w');
  assert(d2w instanceof Date && d2w < d7d, 'parses 2w (older than 7d)');
  const diso = parseRelativeDate('2026-01-15');
  assert(diso instanceof Date && diso.getFullYear() === 2026, 'parses ISO date');
  assert(parseRelativeDate('invalid') === null, 'returns null for invalid');

  // Test 4: Event kind detection
  console.log('\nEvent Kind Detection:');
  assert(detectEventKind({ type: 'user' }) === 'user', 'detects user');
  assert(detectEventKind({ type: 'assistant' }) === 'assistant', 'detects assistant');
  assert(detectEventKind({ type: 'tool_result', exit_code: 0 }) === 'tool_result', 'detects tool_result');
  assert(detectEventKind({ exit_code: 1 }) === 'tool_result', 'detects by exit_code alone');
  assert(detectEventKind({ type: 'queue-operation' }) === null, 'skips queue-operation');
  assert(detectEventKind({ name: 'SomeTool' }) === null, 'raw.name alone does NOT match tool_result');

  // Test 5: Event normalization
  console.log('\nEvent Normalization:');
  const normalized = normalizeEvent({ type: 'user', content: 'Hello', timestamp: '2026-01-20T10:00:00Z' });
  assert(normalized && normalized.kind === 'user', 'normalizes user event');
  assert(normalized && normalized.text === 'Hello', 'extracts text from content');
  assert(normalizeEvent({ type: 'queue-operation' }) === null, 'returns null for noise');

  // Test 6: Persisted output explosion
  console.log('\nPersisted Output Handling:');
  const persisted = {
    type: 'persisted-output',
    timestamp: '2026-01-20T10:00:00Z',
    tool_results: [
      { name: 'Read', content: 'file1' },
      { name: 'Write', content: 'file2' }
    ]
  };
  const exploded = normalizePersistedOutput(persisted);
  assert(Array.isArray(exploded) && exploded.length === 2, 'explodes into multiple events');
  assert(exploded[0].kind === 'tool_result' && exploded[0].toolName === 'Read', 'first event correct');

  // Test 7: Tool failure detection
  console.log('\nTool Failure Detection:');
  assert(isToolFailure({ kind: 'tool_result', exitCode: 1, text: '' }), 'detects non-zero exitCode');
  assert(isToolFailure({ kind: 'tool_result', exitCode: null, text: 'command not found: xyz' }), 'detects error pattern');
  assert(!isToolFailure({ kind: 'tool_result', exitCode: 0, text: 'success' }), 'ignores successful result');
  assert(!isToolFailure({ kind: 'user', exitCode: 1, text: '' }), 'ignores non-tool events');

  // Test 8: Extractor session detection
  console.log('\nExtractor Session Detection:');
  const extractorEvents = [
    { kind: 'user', text: '<command-name>/lessons-extractor</command-name>' }
  ];
  assert(isExtractorSession(extractorEvents), 'detects extractor command marker');
  const normalEvents = [{ kind: 'user', text: 'Help me fix a bug' }];
  assert(!isExtractorSession(normalEvents), 'allows normal sessions');

  // Test 9: Truncation
  console.log('\nTruncation:');
  const longText = 'x'.repeat(5000);
  const truncated = truncate(longText, 3000);
  assert(truncated.length <= 3020, 'truncates to limit with marker');
  assert(truncate('short', 3000) === 'short', 'preserves short text');

  // Test 10: Redaction
  console.log('\nRedaction:');
  const { regexes: testRedactions } = compileRedactions(DEFAULT_REDACT_PATTERNS);
  const toRedact = { text: 'api_key=secret123', error: 'password=hunter2' };
  const redacted = applyRedaction(toRedact, testRedactions);
  assert(redacted.text.includes('[REDACTED]'), 'redacts api_key in text');
  assert(redacted.error.includes('[REDACTED]'), 'redacts password in error');
  // Invalid regex is now caught at compile time (see Test 14)
  const { regexes: invalidRegexes } = compileRedactions(['[invalid regex']);
  assert(applyRedaction({ text: 'normal text' }, invalidRegexes).text === 'normal text',
    'handles invalid regex gracefully');

  // Test 11: Sampling strategy
  console.log('\nSampling Strategy:');
  const indices = computeSampleIndices(100, [50], { contextEventsCount: 10, resolutionEventsCount: 10, errorWindowEvents: 5 });
  assert(indices.includes(0) && indices.includes(9), 'includes first 10 (context)');
  assert(indices.includes(90) && indices.includes(99), 'includes last 10 (resolution)');
  assert(indices.includes(45) && indices.includes(55), 'includes error window around 50');

  // Test 12: Cursor file operations
  console.log('\nCursor Operations:');
  const tempCursor = path.join(os.tmpdir(), `test-cursor-${Date.now()}.json`);
  const testFiles = [
    { path: '/test/a.jsonl', mtimeMs: 1000, size: 100 },
    { path: '/test/b.jsonl', mtimeMs: 2000, size: 200 }
  ];
  writeCursor(tempCursor, testFiles, 10);
  const cursor = readCursor(tempCursor);
  assert(cursor && cursor.schemaVersion === 1, 'writes and reads cursor');
  assert(cursor.recentFiles.length === 2, 'stores recent files');
  fs.unlinkSync(tempCursor);

  // Test 13: shouldProcessFile
  console.log('\nIncremental Processing:');
  const testCursor = {
    lastMtimeCutoffMs: 1500,
    recentFiles: [{ path: '/test/a.jsonl', mtimeMs: 1000, sizeBytes: 100 }]
  };
  assert(shouldProcessFile({ path: '/test/b.jsonl', mtimeMs: 2000, size: 200 }, testCursor), 'processes new file');
  assert(!shouldProcessFile({ path: '/test/a.jsonl', mtimeMs: 1000, size: 100 }, testCursor), 'skips unchanged file');
  assert(shouldProcessFile({ path: '/test/a.jsonl', mtimeMs: 1000, size: 150 }, testCursor), 'processes changed file (size)');

  // Test 14: Redaction compilation
  console.log('\nRedaction Compilation:');
  {
    const r1 = compileRedactions(['api_key', 'password']);
    assert(r1.regexes.length === 2 && r1.warnings.length === 0, 'compiles plain patterns');

    const r2 = compileRedactions(['/secret/i', '/token/g']);
    assert(r2.regexes.length === 2, 'compiles /pattern/flags syntax');
    assert(r2.regexes[0].regex.flags === 'i', 'preserves custom flags');

    const r3 = compileRedactions(['[invalid', 'valid']);
    assert(r3.regexes.length === 1 && r3.warnings.length === 1, 'warns once per invalid');

    // Test pattern with / in body (note: regex.source escapes the /)
    const r4 = compileRedactions(['/foo/bar/gi']);
    assert(r4.regexes.length === 1 && r4.regexes[0].regex.source === 'foo\\/bar', 'handles / in pattern body');
  }

  // Test 15: Clear safety validation
  console.log('\nClear Safety:');
  {
    const repoRoot = findRepoRoot(process.cwd());

    assert(!isOutputDirSafe('/').safe, 'rejects Unix root');
    assert(!isOutputDirSafe('C:\\').safe, 'rejects Windows root');
    assert(!isOutputDirSafe(os.homedir()).safe, 'rejects home dir');
    assert(!isOutputDirSafe(repoRoot).safe, 'rejects repo root itself');
    assert(!isOutputDirSafe('/random/path').safe, 'rejects path outside repo');

    // Valid path inside repo root
    const validPath = path.join(repoRoot, 'docs', 'ai', 'lessons-extractor');
    assert(isOutputDirSafe(validPath).safe, 'accepts path inside repo');
  }

  // Test 16: Clear operation
  console.log('\nClear Operation:');
  {
    // Create temp dir INSIDE cwd to pass safety check
    const tempDir = path.join(process.cwd(), '.test-clear-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    const testFiles = ['lessons.md', 'preprocessed.json'];
    for (const f of testFiles) {
      fs.writeFileSync(path.join(tempDir, f), 'test');
    }

    clearOutputFiles(tempDir, { dryRun: false, verbose: false });
    assert(!fs.existsSync(path.join(tempDir, 'lessons.md')), 'clears lessons.md');

    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // Test 17: ESM host repo compatibility
  console.log('\nESM Compatibility:');
  {
    const { execSync } = require('child_process');
    const tempDir = path.join(os.tmpdir(), `esm-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Create package.json with "type": "module" (ESM host)
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ type: 'module' }, null, 2)
    );

    try {
      // Run our .cjs preprocessor from within the ESM project
      const scriptPath = path.resolve(__filename).replace(/\\/g, '/');
      const result = execSync(`node "${scriptPath}" --help`, {
        cwd: tempDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      assert(result.includes('lessons-preprocessor'), 'runs in ESM host project');
    } catch (err) {
      assert(false, `ESM host compatibility: ${err.message}`);
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // Test 18: Text coercion
  console.log('\nText Coercion:');
  {
    // String passthrough
    assert(coerceText('hello') === 'hello', 'preserves strings');

    // null/undefined
    assert(coerceText(null) === '', 'null -> empty string');
    assert(coerceText(undefined) === '', 'undefined -> empty string');

    // Claude content block array
    const contentBlocks = [
      { type: 'text', text: 'First part.' },
      { type: 'tool_use', id: 'abc', name: 'Read' },
      { type: 'text', text: 'Second part.' }
    ];
    const coerced = coerceText(contentBlocks);
    assert(coerced === 'First part.\nSecond part.', 'extracts text from content blocks');

    // Non-text array
    const numArray = [1, 2, 3];
    assert(coerceText(numArray) === '[1,2,3]', 'stringifies non-content arrays');

    // Object
    const obj = { key: 'value' };
    assert(coerceText(obj) === '{"key":"value"}', 'stringifies objects');

    // Numbers/booleans
    assert(coerceText(42) === '42', 'converts numbers');
    assert(coerceText(true) === 'true', 'converts booleans');
  }

  // Test 19: Cursor gating
  console.log('\nCursor Gating:');
  {
    // Complete failure
    assert(
      !shouldWriteCursor({ logsAttempted: 5, logsSucceeded: 0, logsFailed: 5 }, 0, 10).write,
      'blocks cursor on complete failure'
    );

    // High error rate (> 50%)
    assert(
      !shouldWriteCursor({ logsAttempted: 10, logsSucceeded: 4, logsFailed: 6 }, 4, 10).write,
      'blocks cursor on > 50% error rate'
    );

    // Acceptable error rate
    assert(
      shouldWriteCursor({ logsAttempted: 10, logsSucceeded: 6, logsFailed: 4 }, 6, 10).write,
      'allows cursor on <= 50% error rate'
    );

    // No files attempted
    assert(
      !shouldWriteCursor({ logsAttempted: 0, logsSucceeded: 0, logsFailed: 0 }, 0, 10).write,
      'blocks cursor when no files attempted'
    );

    // Unexpectedly empty output
    assert(
      !shouldWriteCursor({ logsAttempted: 10, logsSucceeded: 10, logsFailed: 0 }, 0, 10).write,
      'blocks cursor when no sessions extracted'
    );

    // Perfect run
    assert(
      shouldWriteCursor({ logsAttempted: 10, logsSucceeded: 10, logsFailed: 0 }, 5, 10).write,
      'allows cursor on perfect run'
    );
  }

  // Test 20: Exact failure mode - message.content as array of content blocks
  console.log('\nArray Content Handling (Failure Mode Fix):');
  {
    const raw = {
      type: 'assistant',
      timestamp: '2026-01-20T12:00:00Z',
      message: {
        content: [
          { type: 'text', text: 'Part one.' },
          { type: 'tool_use', id: 't1', name: 'Read', input: {} },
          { type: 'text', text: 'Part two.' }
        ]
      }
    };
    const normalized = normalizeEvent(raw);
    assert(typeof normalized.text === 'string', 'event.text is a string');
    assert(normalized.text === 'Part one.\nPart two.', 'text blocks joined correctly');

    // Verify redaction doesn't crash
    const redactedResult = applyRedaction(normalized, testRedactions);
    assert(typeof redactedResult.text === 'string', 'redacted text is still a string');
  }

  // Test 21: Array content fixture processing
  console.log('\nArray Content Fixture:');
  {
    const fixturePath = path.join(getSkillRoot(), 'fixtures', 'array-content.jsonl');
    if (fs.existsSync(fixturePath)) {
      let error = null;
      let result = null;
      try {
        result = await processLogFile(fixturePath, DEFAULTS, testRedactions);
      } catch (e) {
        error = e;
      }

      assert(error === null, `processes array-content fixture without error (${error?.message || 'OK'})`);
      assert(result !== null && result.events.length > 0, 'extracts events from array-content fixture');

      // Verify text was extracted correctly
      const assistantEvents = result.events.filter(e => e.kind === 'assistant');
      assert(
        assistantEvents.some(e => e.text && e.text.includes('Response part 1.')),
        'extracts text from content block arrays'
      );
    } else {
      assert(false, 'array-content.jsonl fixture not found');
    }
  }

  // Test 22: Tool failure fixture detection
  console.log('\nTool Failure Fixture Detection:');
  {
    const fixturePath = path.join(getSkillRoot(), 'fixtures', 'tool-failures.jsonl');
    if (fs.existsSync(fixturePath)) {
      const lines = fs.readFileSync(fixturePath, 'utf-8').split('\n').filter(Boolean);
      const events = lines.map(line => {
        try {
          const raw = JSON.parse(line);
          return normalizeEvent(raw);
        } catch {
          return null;
        }
      }).filter(Boolean);

      const failures = events.filter(e => isToolFailure(e));
      assert(failures.length >= 2, `detects ${failures.length} failures in fixture (expected >= 2)`);
      assert(failures.some(f => f.exitCode === 1), 'detects exit_code: 1 failures');
    } else {
      assert(false, 'tool-failures.jsonl fixture not found');
    }
  }

  // Summary
  console.log('\n' + '='.repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  try {
    checkNodeVersion();

    const opts = parseArgs(process.argv);
    verboseEnabled = opts.verbose;

    if (opts.help) {
      printHelp();
      process.exit(0);
    }

    if (opts.selfTest) {
      await runSelfTest();
      return;
    }

    // Load config
    let config = { ...DEFAULTS };
    const configPath = opts.config || path.join(getSkillRoot(), 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config = { ...config, ...fileConfig, ...fileConfig.preprocessor };
        log('verbose', `Loaded config from: ${configPath}`);
      } catch (err) {
        log('warn', `Could not load config: ${err.message}`);
      }
    }

    // Override with CLI options
    if (opts.maxLogs) config.maxLogsPerRun = opts.maxLogs;

    // Resolve output directory: CLI --output-dir > config.outputDir > default
    // Anchor relative paths to repo root so it works regardless of CWD
    const repoRoot = findRepoRoot(process.cwd());
    let outputDir = expandPath(opts.outputDir || config.outputDir || DEFAULTS.outputDir);
    if (!path.isAbsolute(outputDir)) {
      outputDir = path.join(repoRoot, outputDir);
    }
    log('verbose', `Repo root: ${repoRoot}`);
    log('verbose', `Output directory: ${outputDir}`);

    // Handle --clear mode
    if (opts.clear) {
      clearOutputFiles(outputDir, opts);
      process.exit(0);
    }

    // Compile redaction patterns once at startup
    const rawPatterns = config.redactPatterns || DEFAULT_REDACT_PATTERNS;
    const { regexes: compiledRedactions, warnings: redactionWarnings } = compileRedactions(rawPatterns);

    // Log warnings ONCE at startup
    for (const warning of redactionWarnings) {
      log('warn', warning);
    }
    if (compiledRedactions.length > 0) {
      log('verbose', `Compiled ${compiledRedactions.length} redaction patterns`);
    }

    // Determine output path (also anchor relative --output to repo root)
    let outputPath = opts.output || path.join(outputDir, 'preprocessed.json');
    if (opts.output && !path.isAbsolute(opts.output)) {
      outputPath = path.join(repoRoot, opts.output);
    }

    // Load cursor (unless --full)
    let cursor = null;
    if (!opts.full) {
      const cursorPath = opts.cursor || path.join(outputDir, config.cursorFile || DEFAULTS.cursorFile);
      cursor = readCursor(cursorPath);
      if (cursor) {
        log('verbose', `Loaded cursor from: ${cursorPath}`);
      }
    }

    // Discover logs
    const allLogs = discoverLogs({
      logDir: config.logGlob || DEFAULTS.logGlob,
      since: opts.since,
      maxLogs: config.maxLogsPerRun,
      followSymlinks: config.followSymlinks
    });

    if (allLogs.length === 0) {
      log('warn', 'No log files found. Check --since filter or log directory.');
      process.exit(0);
    }

    log('info', `Found ${allLogs.length} log files`);

    // Filter by cursor (incremental)
    let logsToProcess = allLogs;
    if (cursor && !opts.full) {
      logsToProcess = allLogs.filter(f => shouldProcessFile(f, cursor));
      log('info', `Incremental: ${logsToProcess.length} new/changed files (${allLogs.length - logsToProcess.length} skipped)`);
    }

    // Dry run
    if (opts.dryRun) {
      log('info', '[DRY-RUN] Would process:');
      for (const f of logsToProcess.slice(0, 20)) {
        log('info', `  ${f.path}`);
      }
      if (logsToProcess.length > 20) {
        log('info', `  ... and ${logsToProcess.length - 20} more`);
      }
      process.exit(0);
    }

    // Compute budget
    const { maxEventsPerSession } = computePerSessionBudget(logsToProcess.length, config);
    const processConfig = {
      ...config,
      maxEventsPerLog: Math.min(config.maxEventsPerLog, maxEventsPerSession)
    };

    // Process each log
    const sessions = [];
    const stats = {
      skipped: {
        extractorSessions: 0,
        unchanged: allLogs.length - logsToProcess.length
      },
      // Run-level error tracking for cursor gating
      logsAttempted: 0,
      logsSucceeded: 0,
      logsFailed: 0,
      processingErrors: []
    };

    for (const logFile of logsToProcess) {
      log('verbose', `Processing: ${logFile.path}`);
      stats.logsAttempted++;

      try {
        const result = await processLogFile(logFile.path, processConfig, compiledRedactions);

        // Skip extractor sessions
        if (result.isExtractorSession && (config.skipExtractorSessions ?? DEFAULTS.skipExtractorSessions)) {
          log('verbose', `  Skipping extractor session`);
          stats.skipped.extractorSessions++;
          stats.logsSucceeded++; // Successfully processed (just skipped)
          continue;
        }

        sessions.push({
          ...result,
          logPath: logFile.path,
          mtime: logFile.mtime.toISOString()
        });

        stats.logsSucceeded++;
        log('verbose', `  Events: ${result.totalEvents} total, ${result.events.length} sampled, ${result.toolFailures.length} failures`);
      } catch (err) {
        stats.logsFailed++;
        stats.processingErrors.push({ path: logFile.path, error: err.message });
        log('warn', `  Error processing: ${err.message}`);
      }
    }

    // Generate output
    const output = generateOutput(sessions, stats, config);

    // Write output
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
    log('success', `Output written to: ${outputPath}`);

    // Write cursor (only on successful runs)
    let cursorWritten = false;
    if (!opts.dryRun) {
      const cursorPath = opts.cursor || path.join(outputDir, config.cursorFile || DEFAULTS.cursorFile);
      const cursorDecision = shouldWriteCursor(stats, sessions.length, allLogs.length);

      if (cursorDecision.write) {
        writeCursor(cursorPath, logsToProcess, config.maxRecentFiles);
        cursorWritten = true;
        log('verbose', `Cursor updated: ${cursorPath}`);
      } else {
        log('warn', `Cursor NOT updated: ${cursorDecision.reason}`);
      }
    }

    // Summary
    log('info', `Processing summary:`);
    log('info', `  Logs found: ${allLogs.length}`);
    log('info', `  Logs attempted: ${stats.logsAttempted}`);
    log('info', `  Logs succeeded: ${stats.logsSucceeded}`);
    if (stats.logsFailed > 0) {
      log('warn', `  Logs failed: ${stats.logsFailed}`);
    }
    log('info', `  Sessions written: ${sessions.length}`);
    log('info', `  Total events: ${output.summary.totalEvents}`);
    log('info', `  Sampled events: ${output.summary.sampledEvents}`);
    log('info', `  Tool failures detected: ${output.summary.toolFailures}`);
    if (stats.skipped.extractorSessions > 0) {
      log('info', `  Skipped extractor sessions: ${stats.skipped.extractorSessions}`);
    }
    log('info', `  Cursor written: ${cursorWritten ? 'Yes' : 'No'}`)

  } catch (err) {
    log('error', err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
