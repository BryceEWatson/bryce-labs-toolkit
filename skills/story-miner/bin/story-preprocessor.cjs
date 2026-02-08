#!/usr/bin/env node
/**
 * story-preprocessor - Pre-process Claude Code session logs for story mining
 *
 * A cross-platform CLI tool that:
 * - Discovers logs without shell injection
 * - Streams and truncates JSONL content
 * - Filters out miner/extractor sessions
 * - Extracts tool failures with transaction mapping
 * - Detects story-worthy signals per event
 * - Computes provenance pointers for quote grounding
 * - Extended redaction (17+ patterns) for safe verbatim quotes
 * - Output scanning (--scan-dir) for post-pipeline safety
 * - Deterministic deduplication (--dedupe) of candidates
 * - Supports incremental processing via cursor
 *
 * Forked from lessons-preprocessor v1.5.0
 *
 * Usage:
 *   node story-preprocessor.cjs --since 7d
 *   node story-preprocessor.cjs --full --verbose
 *   node story-preprocessor.cjs --self-test
 *   node story-preprocessor.cjs --scan-dir .story-miner/
 *   node story-preprocessor.cjs --dedupe --output-dir .story-miner/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');

// ============================================================================
// Constants
// ============================================================================

const TOOL_VERSION = '1.0.0';
const MIN_NODE_VERSION = 18;

// Default configuration values (v1.1.0: nested structure)
const DEFAULTS = {
  maxLogsPerRun: 50,
  truncateContentLength: 3000,
  skipExtractorSessions: true,
  skipMinerSessions: true,
  cursorFile: '.stories-cursor.json',
  maxRecentFiles: 200,
  maxOutputSizeBytes: 5000000,  // 5MB
  followSymlinks: false,
  outputDir: '.story-miner',
  logGlob: '~/.claude/projects',

  // Nested: windowing configuration (head+tail reading)
  windowing: {
    headBytes: 60000,      // First 60KB of file
    tailBytes: 40000,      // Last 40KB of file
    headEvents: 250,       // Max events from head window
    tailEvents: 250        // Max events from tail window
  },

  // Nested: discovery configuration
  discovery: {
    maxDepth: 10,          // Directory depth limit (0=unlimited)
    maxDirectories: 1000,  // Directory count limit (0=unlimited)
    earlyStopCount: 0,     // Stop after N recent files (0=disabled)
    earlyStopAgeDays: 7    // "Recent" = modified within N days
  },

  // Nested: sampling configuration
  sampling: {
    contextEvents: 20,           // Events from session start
    resolutionEvents: 20,        // Events from session end
    errorWindowEvents: 5,        // Events around errors
    importanceWindowEvents: 5,   // Events around importance markers
    taskPreviewLength: 200       // Max chars for taskPreview
  },

  // Deprecated keys (backward compat) - read but not written
  maxBytesPerLog: 100000,      // DEPRECATED: use windowing.headBytes + tailBytes
  maxEventsPerLog: 500,        // DEPRECATED: use windowing.headEvents + tailEvents
  contextEventsCount: 20,      // DEPRECATED: use sampling.contextEvents
  resolutionEventsCount: 20,   // DEPRECATED: use sampling.resolutionEvents
  errorWindowEvents: 5         // DEPRECATED: use sampling.errorWindowEvents
};

// Index configuration defaults (v1.2.0: cursor index for metadata caching)
const INDEX_DEFAULTS = {
  maxEntries: 500,           // Maximum entries in cursor index
  maxAgeDays: 30,            // Prune entries older than N days (0=disabled)
  pruneStrategy: 'hybrid',   // 'lru', 'age', or 'hybrid'
  preserveUserFields: true   // Preserve user tags/notes when updating entries
};

/**
 * Compute stable SHA-256 hash of raw JSONL line for deduplication
 * @param {string} rawLine - The raw JSONL line string
 * @returns {string} First 16 hex chars of SHA-256 hash
 */
function hashLine(rawLine) {
  return crypto.createHash('sha256').update(rawLine, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Redact user home directory from file paths to avoid exposing usernames
 * Replaces /Users/username/, /home/username/, C:\Users\username\ with ~/
 * @param {string} filePath - The file path to redact
 * @returns {string} Path with home directory replaced by ~
 */
function redactPath(filePath) {
  if (!filePath) return filePath;
  const homeDir = os.homedir();
  // Normalize path separators for comparison
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedHome = homeDir.replace(/\\/g, '/');
  if (normalizedPath.startsWith(normalizedHome)) {
    return '~' + normalizedPath.slice(normalizedHome.length);
  }
  return filePath;
}

/**
 * Migrate old flat config keys to nested structure
 * @param {object} config - Raw config object
 * @returns {object} Config with nested structure
 */
function migrateConfig(config) {
  const pp = config.preprocessor || {};

  // Migrate flat windowing keys to nested structure
  if (!pp.windowing && (pp.maxBytesPerLog || pp.maxEventsPerLog)) {
    pp.windowing = {
      headBytes: Math.round((pp.maxBytesPerLog || 100000) * 0.6),
      tailBytes: Math.round((pp.maxBytesPerLog || 100000) * 0.4),
      headEvents: Math.round((pp.maxEventsPerLog || 500) * 0.5),
      tailEvents: Math.round((pp.maxEventsPerLog || 500) * 0.5)
    };
  }

  // Migrate flat sampling keys to nested structure
  if (!pp.sampling && (pp.contextEventsCount || pp.resolutionEventsCount || pp.errorWindowEvents)) {
    pp.sampling = {
      contextEvents: pp.contextEventsCount ?? DEFAULTS.sampling.contextEvents,
      resolutionEvents: pp.resolutionEventsCount ?? DEFAULTS.sampling.resolutionEvents,
      errorWindowEvents: pp.errorWindowEvents ?? DEFAULTS.sampling.errorWindowEvents,
      importanceWindowEvents: DEFAULTS.sampling.importanceWindowEvents,
      taskPreviewLength: DEFAULTS.sampling.taskPreviewLength
    };
  }

  // Initialize discovery if not present
  if (!pp.discovery) {
    pp.discovery = { ...DEFAULTS.discovery };
  }

  config.preprocessor = pp;
  return config;
}

// Event types to keep during normalization
const KEEP_EVENT_TYPES = ['user', 'assistant', 'tool_call', 'tool_result', 'error', 'system'];

// Patterns to detect extractor sessions (structured markers, not simple regex)
const EXTRACTOR_MARKERS = [
  /<command-name>\/lessons-extractor<\/command-name>/i,
  /<command-name>\/lessons-preprocessor<\/command-name>/i,
  /^Base directory for this skill/m,
  /^Running lessons extractor skill/m
];

// Patterns to detect story-miner sessions (skip to avoid self-referential mining)
const MINER_MARKERS = [
  /<command-name>\/story-miner<\/command-name>/i,
  /<command-name>\/story-preprocessor<\/command-name>/i,
  /^Running story miner skill/m,
  /^Running story-miner skill/m
];

// Tool failure detection patterns (regex-second, after checking exitCode)
// DEPRECATED in v1.4.0: Use FATAL_PATTERNS and BROAD_PATTERNS with isToolFailureV2
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

// v1.4.0: Tiered failure detection patterns
// FATAL_PATTERNS: High-confidence errors for shell tools (balanced + heuristic modes)
const FATAL_PATTERNS = [
  /command\s*not\s*found/i,
  /permission\s*denied/i,
  /ENOENT|no such file/i,
  /Illegal\s*\\\s*at\s*end\s*of\s*pattern/i,
  /CommandNotFoundException/i
];

// BROAD_PATTERNS: Lower-confidence signals requiring threshold (heuristic mode only)
// IMPORTANT: No generic "Error:" pattern - that caused false positives with Read/Edit/Write
const BROAD_PATTERNS = [
  /Output too large.*saved to/i,
  /\bfailed\b.*\b(compile|build|test)/i
];

// v1.4.0: Tool allowlist/denylist for regex-based detection
const DEFAULT_REGEX_ALLOWLIST = ['Bash', 'PowerShell', 'shell'];
const DEFAULT_REGEX_DENYLIST = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];

// Importance markers for smart sampling (v1.1.0)
const IMPORTANCE_MARKERS = [
  { name: 'plan', pattern: /\bPLAN\b/i },
  { name: 'acceptance_criteria', pattern: /\b(Acceptance\s+Criteria|AC:)/i },
  { name: 'files_to_modify', pattern: /\bFiles?\s+to\s+(modify|change|update|create)/i },
  { name: 'test_plan', pattern: /\bTest\s+plan\b/i },
  { name: 'tests_pass', pattern: /\b(Tests?\s+pass|All\s+tests\s+pass)/i },
  { name: 'build_passes', pattern: /\b(Build\s+pass|Build\s+succeed)/i },
  { name: 'commit', pattern: /\b(Commit|committing|committed):/i },
  { name: 'ready_for_review', pattern: /\b(Ready\s+for\s+review|PR\s+ready)/i }
];

// Compiled importance marker regex (once at startup)
const IMPORTANCE_REGEX = new RegExp(
  IMPORTANCE_MARKERS.map(m => m.pattern.source).join('|'),
  'i'
);

// Default redaction patterns (compiled once at startup via compileRedactions)
// Story-miner uses extended patterns (17+) since it surfaces verbatim quotes
const DEFAULT_REDACT_PATTERNS = [
  // Patterns 1-7: Inherited from lessons-extractor
  'api[_-]?key["\']?\\s*[:=]\\s*["\']?[\\w-]+',
  'password["\']?\\s*[:=]\\s*["\']?[^\\s"\',]+',
  'secret["\']?\\s*[:=]\\s*["\']?[\\w-]+',
  'token["\']?\\s*[:=]\\s*["\']?[\\w-]+',
  '/Users/[^/]+/',
  '/home/[^/]+/',
  'C:\\\\Users\\\\[^\\\\]+\\\\',
  // Patterns 8-17: Extended for story-miner (verbatim quote safety)
  'ghp_[A-Za-z0-9_]{36,}',                                      // GitHub PATs
  'glpat-[A-Za-z0-9_-]{20,}',                                   // GitLab PATs
  'xoxb-[A-Za-z0-9-]+',                                         // Slack bot tokens
  'sk-[A-Za-z0-9]{20,}',                                        // OpenAI/Anthropic API keys
  'eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}',                // JWT tokens
  '-----BEGIN\\s+(RSA\\s+)?(PRIVATE|PUBLIC)\\s+KEY-----',       // PEM blocks
  'AKIA[A-Z0-9]{16}',                                           // AWS access keys
  'Authorization:\\s*(Bearer\\s+)?[^\\n]{10,}',                  // Auth headers
  'Cookie:\\s*[^\\n]{20,}',                                      // Cookie headers
  '(mongodb|postgres|mysql|redis)://[^\\s"\']+',                 // Connection strings
  '[0-9a-f]{64}'                                                 // Long hex (64+ chars, potential private keys)
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
// Story Signal Detection (story-miner addition)
// ============================================================================

const DEFAULT_STORY_SIGNAL_PATTERNS = [
  { pattern: /root cause/i,                          signal: 'root_cause',          weight: 0.9 },
  { pattern: /the (issue|problem|bug) (is|was)/i,    signal: 'root_cause',          weight: 0.85 },
  { pattern: /turns out/i,                            signal: 'twist',              weight: 0.8 },
  { pattern: /the fix (is|was)/i,                     signal: 'fix_description',    weight: 0.7 },
  { pattern: /subtle/i,                               signal: 'subtle_interaction', weight: 0.75 },
  { pattern: /the reason/i,                           signal: 'root_cause',         weight: 0.7 },
  { pattern: /key insight/i,                           signal: 'insight',            weight: 0.8 },
  { pattern: /non-obvious/i,                           signal: 'twist',             weight: 0.8 },
  { pattern: /interaction between/i,                   signal: 'subtle_interaction', weight: 0.7 },
  { pattern: /edge case/i,                             signal: 'edge_case',         weight: 0.65 },
  { pattern: /workaround/i,                            signal: 'technique',         weight: 0.6 },
  { pattern: /I.ve confirmed/i,                        signal: 'confirmation',      weight: 0.5 },
  { pattern: /(approach|strategy|method) (is|was|works|worked)/i, signal: 'technique', weight: 0.7 },
  { pattern: /(configured|set up|integrated) .+ (tool|workflow|pipeline)/i, signal: 'tooling_insight', weight: 0.7 },
  { pattern: /(pattern|architecture|design) (decision|choice)/i, signal: 'design_pattern', weight: 0.7 }
];

/**
 * Detect story-worthy signals in event text
 * @param {string} text - Event text content
 * @param {Array} patterns - Signal patterns (defaults to DEFAULT_STORY_SIGNAL_PATTERNS)
 * @returns {string[]} Array of signal names detected
 */
function detectStorySignals(text, patterns) {
  if (!text || typeof text !== 'string') return [];
  patterns = patterns || DEFAULT_STORY_SIGNAL_PATTERNS;
  const signals = new Set();
  for (const { pattern, signal } of patterns) {
    if (pattern.test(text)) {
      signals.add(signal);
    }
  }
  return Array.from(signals);
}

// ============================================================================
// Provenance Pointers (story-miner addition)
// ============================================================================

/**
 * Compute a 16-char hex content hash for provenance verification
 * @param {string} text - Text content (first 400 chars used)
 * @returns {string} 16-char hex string
 */
function computeContentHash16(text) {
  if (!text || typeof text !== 'string') return '0000000000000000';
  const input = text.slice(0, 400);
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Compute a provenance pointer for quote grounding
 * @param {string} sessionId - Session UUID
 * @param {number} lineIndex - 0-based line index in source JSONL
 * @param {string} text - Event text content
 * @returns {{sessionId: string, lineIndex: number, contentHash16: string}}
 */
function computeProvenance(sessionId, lineIndex, text) {
  const contentHash16 = computeContentHash16(text);
  return {
    sessionId: sessionId || '',
    lineIndex: lineIndex || 0,
    contentHash16,
    pointer: `${sessionId || ''}/${lineIndex || 0}#${contentHash16}`
  };
}

// ============================================================================
// Banned Phrases (story-miner addition)
// ============================================================================

const DEFAULT_BANNED_PHRASES = [
  'always write tests', 'best practice', 'make sure to', "don't forget to",
  "it's important to", 'always remember', 'be careful', 'consider using',
  'you should always', 'pro tip', 'helpful tip', 'keep in mind',
  'general rule of thumb'
];

// ============================================================================
// Output Scanner (story-miner addition)
// ============================================================================

/**
 * Scanner severity levels for different pattern types
 */
const SCANNER_RULES = [
  // Error severity (hard-fail)
  { pattern: /ghp_[A-Za-z0-9_]{36,}/g,                                         severity: 'error', name: 'GitHub PAT' },
  { pattern: /glpat-[A-Za-z0-9_-]{20,}/g,                                      severity: 'error', name: 'GitLab PAT' },
  { pattern: /sk-[A-Za-z0-9]{20,}/g,                                            severity: 'error', name: 'API key (sk-)' },
  { pattern: /AKIA[A-Z0-9]{16}/g,                                               severity: 'error', name: 'AWS access key' },
  { pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,                     severity: 'error', name: 'JWT token' },
  { pattern: /-----BEGIN\s+(RSA\s+)?(PRIVATE|PUBLIC)\s+KEY-----/g,              severity: 'error', name: 'PEM block' },
  { pattern: /(mongodb|postgres|mysql|redis):\/\/[^\s"']+/g,                    severity: 'error', name: 'Connection string' },
  { pattern: /Authorization:\s*(Bearer\s+)?(?!\[REDACTED\])[^\n]{10,}/g,        severity: 'error', name: 'Auth header' },
  // Warn severity (logged but not fatal)
  { pattern: /[0-9a-f]{64}/g,                                                   severity: 'warn',  name: 'Long hex (64+ chars)' }
];

/**
 * Scan all files in a directory for secret patterns and policy violations
 * @param {string} dirPath - Directory to scan
 * @param {Array} extraRules - Additional scanner rules
 * @param {string[]} bannedPhrases - Phrases banned in promoted stories
 * @returns {{clean: boolean, findings: Array, errorCount: number, warnCount: number}}
 */
function scanDirectory(dirPath, extraRules, bannedPhrases) {
  const findings = [];
  const rules = [...SCANNER_RULES, ...(extraRules || [])];
  bannedPhrases = bannedPhrases || DEFAULT_BANNED_PHRASES;

  if (!fs.existsSync(dirPath)) {
    return { clean: true, findings: [], errorCount: 0, warnCount: 0 };
  }

  const files = fs.readdirSync(dirPath).filter(f => /\.(json|jsonl|md)$/.test(f));

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Check secret patterns
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(content)) !== null) {
        // Skip matches that are already redacted
        const context = content.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20);
        if (context.includes('[REDACTED]') && rule.severity === 'warn') continue;

        findings.push({
          file,
          pattern: rule.name,
          severity: rule.severity,
          matchPreview: match[0].slice(0, 40) + (match[0].length > 40 ? '...' : ''),
          offset: match.index
        });
      }
    }

    // Check for thinking block quotes in stories (error severity)
    // Layer 1: Check explicit attribution; Layer 2: Verify source event blockType
    if (file === 'stories.jsonl') {
      // Load preprocessed.json for source event blockType verification
      let eventIndex = null;
      const preprocessedPath = path.join(dirPath, 'preprocessed.json');
      if (fs.existsSync(preprocessedPath)) {
        try {
          const pp = JSON.parse(fs.readFileSync(preprocessedPath, 'utf-8'));
          if (pp && pp.sessions) {
            eventIndex = {};
            for (const session of pp.sessions) {
              for (const evt of (session.events || [])) {
                if (evt.provenance) {
                  const key = `${evt.provenance.sessionId}/${evt.provenance.lineIndex}#${evt.provenance.contentHash16}`;
                  eventIndex[key] = evt;
                }
              }
            }
          }
        } catch { /* ignore load failures */ }
      }

      const lines = content.split('\n').filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        try {
          const story = JSON.parse(lines[i]);
          if (story.quotes) {
            for (const quote of story.quotes) {
              // Layer 1: Explicit attribution check
              if (quote.attribution === 'thinking') {
                findings.push({
                  file,
                  pattern: 'Thinking block quote (attribution)',
                  severity: 'error',
                  matchPreview: `Story "${story.storyId}": quote attributed to thinking`,
                  offset: 0
                });
              }
              // Layer 2: Verify source event blockType via provenance pointer
              if (eventIndex && quote.provenance && quote.provenance.pointer) {
                const sourceEvent = eventIndex[quote.provenance.pointer];
                if (sourceEvent && sourceEvent.blockType === 'thinking') {
                  findings.push({
                    file,
                    pattern: 'Thinking block quote (source blockType)',
                    severity: 'error',
                    matchPreview: `Story "${story.storyId}": quote source event has blockType=thinking at ${quote.provenance.pointer}`,
                    offset: 0
                  });
                }
              }
            }
          }
        } catch { /* skip malformed lines */ }
      }
    }

    // Check for banned phrases in promoted stories (error severity)
    if (file === 'stories.jsonl' || file === 'candidates.jsonl') {
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.status === 'promoted' || obj.narrative) {
            const textToCheck = (obj.narrative || '') + ' ' + (obj.synopsis || '') + ' ' + (obj.title || '');
            for (const phrase of bannedPhrases) {
              if (textToCheck.toLowerCase().includes(phrase.toLowerCase())) {
                findings.push({
                  file,
                  pattern: `Banned phrase: "${phrase}"`,
                  severity: 'error',
                  matchPreview: `Found in ${obj.storyId || obj.candidateId || 'unknown'}`,
                  offset: 0
                });
              }
            }
          }
        } catch { /* skip malformed lines */ }
      }
    }
  }

  const errorCount = findings.filter(f => f.severity === 'error').length;
  const warnCount = findings.filter(f => f.severity === 'warn').length;

  return {
    clean: errorCount === 0,
    findings,
    errorCount,
    warnCount
  };
}

// ============================================================================
// Dedupe Engine (story-miner addition)
// ============================================================================

const DEFAULT_DEDUPE_STOPLIST = [
  'config', 'json', 'file', 'test', 'error', 'function', 'module',
  'index', 'src', 'node', 'import', 'export', 'const', 'let', 'var'
];

/**
 * Extract key terms (function names, file paths, error classes) from text
 * @param {string} text - Text to extract terms from
 * @returns {string[]} Normalized, deduplicated terms
 */
function extractKeyTerms(text) {
  if (!text || typeof text !== 'string') return [];
  const terms = new Set();

  // Function/method names: word followed by (
  const funcMatches = text.matchAll(/\b([a-zA-Z_]\w+)\s*\(/g);
  for (const m of funcMatches) terms.add(m[1].toLowerCase());

  // File paths with extensions
  const fileMatches = text.matchAll(/\b[\w./\\-]+\.(js|ts|py|sh|json|md|cjs|mjs)\b/g);
  for (const m of fileMatches) terms.add(m[0].toLowerCase());

  // Error class names
  const errorMatches = text.matchAll(/\b([A-Z][a-zA-Z]+Error)\b/g);
  for (const m of errorMatches) terms.add(m[1].toLowerCase());

  return Array.from(terms).sort();
}

/**
 * Union-Find data structure for clustering
 */
class UnionFind {
  constructor() { this.parent = new Map(); this.rank = new Map(); }
  find(x) {
    if (!this.parent.has(x)) { this.parent.set(x, x); this.rank.set(x, 0); }
    if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)));
    return this.parent.get(x);
  }
  union(x, y) {
    const rx = this.find(x), ry = this.find(y);
    if (rx === ry) return;
    const rankX = this.rank.get(rx), rankY = this.rank.get(ry);
    if (rankX < rankY) this.parent.set(rx, ry);
    else if (rankX > rankY) this.parent.set(ry, rx);
    else { this.parent.set(ry, rx); this.rank.set(rx, rankX + 1); }
  }
}

/**
 * Build dedupe clusters from candidates deterministically
 * @param {Array} candidates - Array of candidate objects from candidates.jsonl
 * @param {object} preprocessed - Preprocessed data for event text lookup
 * @param {object} config - Dedupe config (minRareTermOverlap, stoplist, maxFrequencyPct)
 * @returns {{clusters: object, updatedCandidates: Array}}
 */
function buildDedupeClusters(candidates, preprocessed, config) {
  config = config || {};
  const minOverlap = config.minRareTermOverlap || 3;
  const stoplist = new Set(config.stoplist || DEFAULT_DEDUPE_STOPLIST);
  const maxFreqPct = (config.maxFrequencyPct || 30) / 100;

  // Build session event text lookup
  const sessionEvents = {};
  if (preprocessed && preprocessed.sessions) {
    for (const session of preprocessed.sessions) {
      sessionEvents[session.sessionId] = session.events || [];
    }
  }

  // Step 1: Collect terms per candidate
  const eligible = candidates.filter(c => c.status !== 'rejected');
  const candidateTerms = new Map();

  for (const cand of eligible) {
    let text = (cand.title || '') + ' ' + (cand.synopsis || '');
    // Add event text from evidence
    const events = sessionEvents[cand.sessionId] || [];
    for (const idx of (cand.eventIndices || [])) {
      if (events[idx]) text += ' ' + (events[idx].text || '');
    }
    // Add tool names from evidence events
    for (const idx of (cand.eventIndices || [])) {
      if (events[idx] && events[idx].toolName) text += ' ' + events[idx].toolName;
    }
    candidateTerms.set(cand.candidateId, extractKeyTerms(text));
  }

  // Step 2: Compute term frequency across candidates
  const termFreq = new Map();
  for (const terms of candidateTerms.values()) {
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1);
    }
  }

  // Step 3: Filter to rare terms (remove stoplist + high-frequency)
  // Skip frequency filter when <= 5 candidates (too few for meaningful frequency stats)
  const totalCands = eligible.length;
  const applyFreqFilter = totalCands > 5;
  const rareTerms = new Map();
  for (const [candId, terms] of candidateTerms) {
    const rare = terms.filter(t =>
      !stoplist.has(t) && (!applyFreqFilter || (termFreq.get(t) || 0) / totalCands <= maxFreqPct)
    );
    rareTerms.set(candId, rare);
  }

  // Step 4: Cluster via Union-Find on shared rare terms
  const uf = new UnionFind();
  const eligibleIds = eligible.map(c => c.candidateId);
  for (const id of eligibleIds) uf.find(id); // Initialize

  for (let i = 0; i < eligibleIds.length; i++) {
    for (let j = i + 1; j < eligibleIds.length; j++) {
      const termsI = rareTerms.get(eligibleIds[i]) || [];
      const termsJ = rareTerms.get(eligibleIds[j]) || [];
      const shared = termsI.filter(t => termsJ.includes(t));
      if (shared.length >= minOverlap) {
        uf.union(eligibleIds[i], eligibleIds[j]);
      }
    }
  }

  // Step 5: Form clusters
  const clusterMap = new Map();
  for (const id of eligibleIds) {
    const root = uf.find(id);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root).push(id);
  }

  // Step 6: Compute cluster IDs and select primaries
  const clusters = {};
  const candLookup = new Map(candidates.map(c => [c.candidateId, c]));

  // Build session -> firstTimestamp lookup from preprocessed data
  const sessionTimestamps = {};
  if (preprocessed && preprocessed.sessions) {
    for (const session of preprocessed.sessions) {
      sessionTimestamps[session.sessionId] = session.firstTimestamp || '';
    }
  }

  for (const [, memberIds] of clusterMap) {
    if (memberIds.length <= 1) continue; // No cluster for singletons

    // Compute cluster ID from sorted fingerprints
    const fingerprints = memberIds.map(id => {
      const terms = (rareTerms.get(id) || []).join('|');
      return crypto.createHash('sha256').update(terms, 'utf8').digest('hex').slice(0, 16);
    }).sort();
    const clusterId = crypto.createHash('sha256')
      .update(fingerprints.join('|'), 'utf8').digest('hex').slice(0, 16);

    // Select primary: earliest session firstTimestamp (from preprocessed), then highest score
    const members = memberIds.map(id => candLookup.get(id)).filter(Boolean);
    members.sort((a, b) => {
      const tsA = sessionTimestamps[a.sessionId] || '';
      const tsB = sessionTimestamps[b.sessionId] || '';
      if (tsA !== tsB) return tsA < tsB ? -1 : 1;
      return (b.score || 0) - (a.score || 0);
    });

    const primaryId = members[0].candidateId;
    clusters[clusterId] = {
      members: memberIds,
      primaryId,
      sessionIds: [...new Set(members.map(m => m.sessionId))]
    };

    // Update candidate statuses
    for (const member of members) {
      member.dedupeClusterId = clusterId;
      if (member.candidateId !== primaryId) {
        member.status = 'deduped';
      }
    }
  }

  return { clusters, updatedCandidates: candidates };
}

/**
 * Run dedupe mode: read candidates.jsonl + preprocessed.json, compute clusters, write back
 * @param {string} outputDir - Output directory path
 * @param {object} config - Dedupe configuration
 */
function runDedupeMode(outputDir, config) {
  const candidatesPath = path.join(outputDir, 'candidates.jsonl');
  const preprocessedPath = path.join(outputDir, 'preprocessed.json');

  if (!fs.existsSync(candidatesPath)) {
    log('error', `candidates.jsonl not found in ${outputDir}`);
    process.exit(1);
  }

  // Load candidates
  const candidateLines = fs.readFileSync(candidatesPath, 'utf-8').split('\n').filter(Boolean);
  const candidates = candidateLines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  // Load preprocessed (optional, for event text lookup)
  let preprocessed = null;
  if (fs.existsSync(preprocessedPath)) {
    try { preprocessed = JSON.parse(fs.readFileSync(preprocessedPath, 'utf-8')); } catch { /* ignore */ }
  }

  // Run dedupe
  const { clusters, updatedCandidates } = buildDedupeClusters(candidates, preprocessed, config);

  // Write back candidates.jsonl
  const output = updatedCandidates.map(c => JSON.stringify(c)).join('\n') + '\n';
  fs.writeFileSync(candidatesPath, output);

  const clusterCount = Object.keys(clusters).length;
  const dedupedCount = updatedCandidates.filter(c => c.status === 'deduped').length;
  log('success', `Dedupe complete: ${clusterCount} clusters formed, ${dedupedCount} candidates deduped`);

  return { clusters, clusterCount, dedupedCount };
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
    'preprocessed.json',
    'candidates.jsonl',
    'stories.jsonl',
    'stories.md',
    'digest.md',
    'index.json',
    'selftest-report.md',
    'selftest-metrics.json',
    '.stories-cursor.json'
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
  // Check for tool-related events FIRST (assistant can have tool_calls)
  if (raw.tool_calls || raw.toolCalls) return 'tool_call';
  // Detect tool_use blocks in message.content (Claude API format)
  if (Array.isArray(raw.message?.content) && raw.message.content.some(b => b.type === 'tool_use')) return 'tool_call';

  // TIGHTENED: tool_result detection requires explicit signals
  if (raw.type === 'tool_result' || raw.type === 'tool-results') return 'tool_result';
  if (raw.exit_code !== undefined || raw.exitCode !== undefined) return 'tool_result';
  if (raw.tool_result || raw.toolResult) return 'tool_result';
  if (Array.isArray(raw.tool_results)) return 'tool_result';

  // Check explicit type field (after tool checks)
  if (raw.type === 'user') return 'user';
  if (raw.type === 'assistant') return 'assistant';
  if (raw.type === 'error') return 'error';
  if (raw.type === 'system') return 'system';

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

  // Extract tool info from various sources (single value per event)
  let toolName = raw.tool?.name || raw.name || null;
  let command = raw.tool?.arguments?.command || raw.arguments?.command || null;
  let toolUseId = null;

  // For tool_call kind, also check tool_calls array and message.content tool_use blocks
  if (kind === 'tool_call') {
    const calls = raw.tool_calls || raw.toolCalls || [];
    const contentCalls = (raw.message?.content || []).filter(b => b.type === 'tool_use');
    const allCalls = [...calls, ...contentCalls];
    if (allCalls.length > 0 && !toolName) {
      toolName = allCalls[0].name || null;
      command = allCalls[0].arguments?.command || allCalls[0].input?.command || null;
      toolUseId = allCalls[0].id || null;
    }
  }

  // v1.5.0: Extract tool_use_id and is_error for tool_result events
  // (Fallback path - most tool_result events go through normalizeToolResults)
  const isError = raw.is_error === true;
  if (kind === 'tool_result') {
    toolUseId = raw.tool_use_id || null;
  }

  let exitCode = raw.exit_code ?? raw.exitCode ?? null;
  // is_error: true is authoritative - override exit_code if 0 or null
  if (isError && (exitCode === null || exitCode === 0)) {
    exitCode = 1;
  }

  return {
    kind,
    timestamp: raw.timestamp || raw.ts || null,
    text: extractText(raw),
    toolName,
    toolUseId,
    exitCode,
    isError,
    command,
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
 * v1.5.0: Added lineHash parameter for toolUseId fallback generation
 * @param {Object} raw - Raw JSONL event
 * @param {string} lineHash - Hash of the raw line for fallback toolUseId
 */
function normalizePersistedOutput(raw, lineHash) {
  if (raw.type !== 'persisted-output' || !Array.isArray(raw.tool_results)) {
    return null;
  }

  return raw.tool_results.map((tr, idx) => {
    const isError = tr.is_error === true;
    let exitCode = tr.exit_code ?? tr.exitCode ?? null;
    // is_error: true is authoritative - override exit_code if 0 or null
    if (isError && (exitCode === null || exitCode === 0)) {
      exitCode = 1;
    }

    return {
      kind: 'tool_result',
      timestamp: raw.timestamp,
      text: coerceText(tr.content ?? tr.output ?? ''),
      toolName: tr.name || tr.tool || null,
      toolUseId: tr.tool_use_id || `${lineHash}-po${idx}`,
      exitCode,
      isError,
      command: tr.arguments?.command || null,
      sessionId: raw.sessionId || null,
      _explodedIndex: idx
    };
  });
}

/**
 * Handle multi-tool-call messages
 * v1.1.1: EXPLODE tool_calls and message.content tool_use blocks into multiple events
 * This ensures toolNames[] and toolCallsDetected counts are accurate
 * v1.5.0: Added lineHash parameter for toolUseId fallback generation
 * @param {Object} raw - Raw JSONL event
 * @param {string} lineHash - Hash of the raw line for fallback toolUseId
 */
function normalizeToolCalls(raw, lineHash) {
  const calls = raw.tool_calls || raw.toolCalls || [];
  const contentCalls = (raw.message?.content || []).filter(b => b.type === 'tool_use');
  const allCalls = [...calls, ...contentCalls];

  if (allCalls.length === 0) {
    return null;
  }

  // Extract any text content from message.content (before/between tool_use blocks)
  const textContent = (raw.message?.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join(' ')
    .trim();

  return allCalls.map((call, idx) => {
    // Truncate input JSON for failure attribution (v1.5.0)
    const inputObj = call.input || call.arguments || {};
    let inputJson = null;
    try {
      inputJson = JSON.stringify(inputObj);
      if (inputJson.length > 500) inputJson = inputJson.slice(0, 500) + '...';
    } catch {
      inputJson = '[unserializable]';
    }

    return {
      kind: 'tool_call',
      timestamp: raw.timestamp || raw.ts || null,
      text: idx === 0 ? (textContent || coerceText(raw.content)) : null, // Only first event gets the text
      toolName: call.name || null,
      toolUseId: call.id || `${lineHash}-tc${idx}`,
      command: call.arguments?.command || call.input?.command || null,
      exitCode: null,
      isError: false,
      sessionId: raw.sessionId || raw.session_id || null,
      _explodedIndex: idx,
      _inputJson: inputJson
    };
  });
}

/**
 * Normalize tool_result blocks from message.content arrays.
 * Returns array of events if explosion needed, null otherwise.
 * v1.3.0: Handles Claude API content block format
 * v1.5.0: Added lineHash parameter for toolUseId fallback generation
 * @param {Object} raw - Raw JSONL event
 * @param {string} lineHash - Hash of the raw line for fallback toolUseId
 * @returns {Array|null} Array of normalized tool_result events or null
 */
function normalizeToolResults(raw, lineHash) {
  // Check for tool_result blocks in message.content
  const content = raw.message?.content || [];
  if (!Array.isArray(content)) return null;

  const toolResultBlocks = content.filter(b => b.type === 'tool_result');
  if (toolResultBlocks.length === 0) return null;

  // Build tool_use_id → toolName map from any tool_use blocks in same message
  // (rare in practice, but handles edge cases)
  const toolUseBlocks = content.filter(b => b.type === 'tool_use');
  const toolNameMap = new Map();
  for (const tu of toolUseBlocks) {
    if (tu.id && tu.name) {
      toolNameMap.set(tu.id, tu.name);
    }
  }

  // Map each tool_result block to a normalized event
  return toolResultBlocks.map((block, idx) => {
    // v1.5.0: Preserve is_error as separate field
    const isError = block.is_error === true;

    // Extract exit code from various field names
    let exitCode = block.exit_code ?? block.exitCode ?? block.output?.exit_code ?? null;

    // is_error: true is authoritative - override exit_code if 0 or null
    // Some tools emit exit_code: 0 alongside is_error: true
    if (isError && (exitCode === null || exitCode === 0)) {
      exitCode = 1;  // Treat as failure
    }

    // Try to get toolName: direct fields, or map from tool_use_id
    let toolName = block.name || block.tool_name || block.toolName || null;
    if (!toolName && block.tool_use_id) {
      toolName = toolNameMap.get(block.tool_use_id) || null;
    }

    const blockContent = extractToolResultContent(block);

    return {
      kind: 'tool_result',
      timestamp: raw.timestamp || raw.ts || null,
      text: blockContent,  // Only tool output, no prepended text
      toolName,
      toolUseId: block.tool_use_id || `${lineHash}-tr${idx}`,
      exitCode: typeof exitCode === 'number' ? exitCode : null,
      isError,
      command: block.input?.command || block.arguments?.command || null,
      sessionId: raw.sessionId || raw.session_id || null,  // Robust field names
      metadata: {
        cwd: raw.cwd || null,
        gitBranch: raw.gitBranch || raw.git_branch || null  // Robust field names
      },
      _explodedIndex: idx
    };
  });
}

/**
 * Extract text content from a tool_result block.
 * Handles various content structures (string, array, object).
 * v1.3.0: Supports Claude API nested content formats
 */
function extractToolResultContent(block) {
  const content = block.content ?? block.output ?? block.text ?? '';

  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === 'string') return item;
      if (item.text) return item.text;
      if (item.type === 'text' && item.text) return item.text;
      return JSON.stringify(item);
    }).join('\n');
  }

  if (typeof content === 'object' && content !== null) {
    if (content.text) return content.text;
    return JSON.stringify(content);
  }

  return String(content);
}

/**
 * Build a transaction map linking tool_call events to their tool_result events.
 * v1.5.0: Enables transaction coherence in sampling and failure attribution.
 *
 * @param {Array} events - Array of normalized events with toolUseId
 * @returns {Map<string, object>} Map of toolUseId -> transaction object
 */
function buildTransactionMap(events) {
  const transactions = new Map();

  // Pass 1: Create transactions from tool_call events
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind === 'tool_call' && e.toolUseId) {
      transactions.set(e.toolUseId, {
        toolUseId: e.toolUseId,
        toolName: e.toolName,
        callEventIndex: i,
        resultEventIndex: null,
        state: 'pending',
        isFailure: false,
        failureDetails: null,
        inputSummary: e._inputJson || null,
        durationMs: null
      });
    }
  }

  // Pass 2: Link tool_result events + backfill toolName/command from call
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind === 'tool_result' && e.toolUseId) {
      let tx = transactions.get(e.toolUseId);
      if (!tx) {
        // Orphaned result (call not in window or legacy format)
        tx = {
          toolUseId: e.toolUseId,
          toolName: e.toolName,
          callEventIndex: null,
          resultEventIndex: i,
          state: 'orphaned',
          isFailure: false,
          failureDetails: null,
          inputSummary: null,
          durationMs: null
        };
        transactions.set(e.toolUseId, tx);
      } else {
        tx.resultEventIndex = i;
        tx.state = 'completed';

        // BACKFILL: toolName from call if result has null
        if (!e.toolName && tx.toolName) {
          e.toolName = tx.toolName;
        }
        // BACKFILL: command from call (result blocks rarely have input.command)
        if (!e.command && events[tx.callEventIndex]?.command) {
          e.command = events[tx.callEventIndex].command;
        }

        // Calculate duration if both timestamps available
        if (tx.callEventIndex !== null && events[tx.callEventIndex]?.timestamp && e.timestamp) {
          const callTime = new Date(events[tx.callEventIndex].timestamp).getTime();
          const resultTime = new Date(e.timestamp).getTime();
          if (!isNaN(callTime) && !isNaN(resultTime)) {
            tx.durationMs = resultTime - callTime;
          }
        }
      }

      // Check failure (exitCode or isError)
      // Note: Only change state to 'failed' if not orphaned (preserve orphaned state)
      if ((e.exitCode != null && e.exitCode !== 0) || e.isError) {
        tx.isFailure = true;
        // Only transition completed→failed, keep orphaned as orphaned
        if (tx.state !== 'orphaned') {
          tx.state = 'failed';
        }
        tx.failureDetails = {
          exitCode: e.exitCode,
          isError: e.isError,
          detectionTier: 'A',
          patternMatched: e.isError ? 'is_error' : `exit_code:${e.exitCode}`,
          errorExcerpt: truncate(e.text, 500)
        };
      }
    }
  }

  return transactions;
}

/**
 * Compute tool metrics from events and transaction map.
 * v1.5.0: Provides health metrics for transaction coherence validation.
 *
 * @param {Array} events - Array of normalized events
 * @param {Map} transactionMap - Transaction map from buildTransactionMap
 * @returns {object} Tool metrics including counts, ratios, and health warnings
 */
function computeToolMetrics(events, transactionMap) {
  let toolCallsDetected = 0;
  let toolResultsDetected = 0;

  for (const e of events) {
    if (e.kind === 'tool_call') toolCallsDetected++;
    if (e.kind === 'tool_result') toolResultsDetected++;
  }

  let transactionsComplete = 0;
  let transactionsOrphaned = 0;
  let transactionsPending = 0;
  let transactionsFailed = 0;
  let transactionsOrphanedFailed = 0;

  for (const tx of transactionMap.values()) {
    if (tx.state === 'completed') transactionsComplete++;
    else if (tx.state === 'failed') { transactionsComplete++; transactionsFailed++; }
    else if (tx.state === 'orphaned') {
      transactionsOrphaned++;
      if (tx.isFailure) transactionsOrphanedFailed++;
    }
    else if (tx.state === 'pending') transactionsPending++;
  }

  const callResultRatio = toolCallsDetected > 0
    ? toolResultsDetected / toolCallsDetected
    : 1.0;

  const healthWarnings = [];
  if (callResultRatio < 0.9 && toolCallsDetected > 5) {
    healthWarnings.push(`Low call/result ratio (${callResultRatio.toFixed(2)}): may indicate windowing gap or incomplete session`);
  }
  if (callResultRatio > 1.1 && toolResultsDetected > 5) {
    healthWarnings.push(`High call/result ratio (${callResultRatio.toFixed(2)}): may indicate legacy format or parser issue`);
  }
  if (transactionsOrphaned > 0) {
    healthWarnings.push(`${transactionsOrphaned} orphaned transactions (results without matching calls)`);
  }
  if (transactionsOrphanedFailed > 0) {
    healthWarnings.push(`${transactionsOrphanedFailed} orphaned transactions with failures`);
  }

  return {
    toolCallsDetected,
    toolResultsDetected,
    toolFailuresDetected: transactionsFailed,
    transactionsComplete,
    transactionsOrphaned,
    transactionsOrphanedFailed,
    transactionsPending,
    callResultRatio: Math.round(callResultRatio * 100) / 100,
    healthWarnings
  };
}

// ============================================================================
// Log Discovery
// ============================================================================

/**
 * Recursively find JSONL files in a directory
 * v1.1.0: Added depth limit, directory count limit, and early stop for recent files
 *
 * @param {string} dir - Directory to search
 * @param {object} options - Search options
 * @param {object} state - Internal state for tracking limits (auto-initialized on first call)
 * @param {number} currentDepth - Current recursion depth (auto-tracked)
 */
function findJsonlFiles(dir, options = {}, state = null, currentDepth = 0) {
  // Initialize state on first call
  if (!state) {
    state = {
      directoriesScanned: 0,
      recentFilesFound: 0,
      stopped: false,
      stopReason: null
    };
  }

  // Early exit if stopped
  if (state.stopped) {
    return [];
  }

  const results = [];
  const discovery = options.discovery || {};

  // Check depth limit
  const maxDepth = discovery.maxDepth ?? DEFAULTS.discovery.maxDepth;
  if (maxDepth > 0 && currentDepth > maxDepth) {
    log('verbose', `  Depth limit (${maxDepth}) reached at: ${dir}`);
    return results;
  }

  if (!fs.existsSync(dir)) {
    return results;
  }

  // Track directory count
  state.directoriesScanned++;
  const maxDirectories = discovery.maxDirectories ?? DEFAULTS.discovery.maxDirectories;
  if (maxDirectories > 0 && state.directoriesScanned > maxDirectories) {
    state.stopped = true;
    state.stopReason = `Directory limit (${maxDirectories}) reached`;
    log('verbose', `  ${state.stopReason}`);
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (state.stopped) break;

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

      // Recurse with incremented depth
      results.push(...findJsonlFiles(fullPath, options, state, currentDepth + 1));
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

        // Early stop check for recent files
        const earlyStopCount = discovery.earlyStopCount ?? DEFAULTS.discovery.earlyStopCount;
        if (earlyStopCount > 0) {
          const earlyStopAgeDays = discovery.earlyStopAgeDays ?? DEFAULTS.discovery.earlyStopAgeDays;
          const recentCutoffMs = Date.now() - (earlyStopAgeDays * 86400000);
          if (stat.mtimeMs >= recentCutoffMs) {
            state.recentFilesFound++;
            if (state.recentFilesFound >= earlyStopCount) {
              state.stopped = true;
              state.stopReason = `Early stop: found ${earlyStopCount} recent files`;
              log('verbose', `  ${state.stopReason}`);
            }
          }
        }
      } catch (err) {
        log('verbose', `  Skipping unreadable file: ${fullPath}`);
      }
    }
  }

  return results;
}

/**
 * Discover log files without shell commands
 * v1.1.0: Passes discovery scalability options to findJsonlFiles
 */
function discoverLogs(options) {
  const logDir = expandPath(options.logDir || DEFAULTS.logGlob);

  log('verbose', `Discovering logs in: ${logDir}`);

  if (!fs.existsSync(logDir)) {
    log('warn', `Log directory not found: ${logDir}`);
    return [];
  }

  // v1.1.0: Pass discovery scalability options
  let files = findJsonlFiles(logDir, {
    followSymlinks: options.followSymlinks ?? DEFAULTS.followSymlinks,
    discovery: options.discovery || {}
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
// Two-Window File Reading (v1.1.0)
// ============================================================================

/**
 * Read head window of a log file (first N bytes/events)
 * @param {string} filePath - Path to JSONL file
 * @param {number} maxBytes - Maximum bytes to read
 * @param {number} maxEvents - Maximum events to extract
 * @param {object} compiledRedactions - Redaction patterns
 * @returns {Promise<{events: Array, hashes: Set, bytesRead: number}>}
 */
async function readHeadWindow(filePath, maxBytes, maxEvents, compiledRedactions) {
  const events = [];
  const hashes = new Set();
  let bytesRead = 0;
  let sourceLineIndex = 0; // Track real line number in JSONL file

  const stream = fs.createReadStream(filePath, {
    start: 0,
    end: maxBytes - 1,
    encoding: 'utf-8'
  });

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const currentLineIndex = sourceLineIndex;
    sourceLineIndex++;

    const lineBytes = Buffer.byteLength(line, 'utf8') + 1; // +1 for newline
    bytesRead += lineBytes;

    if (events.length >= maxEvents) break;

    const trimmedLine = line.replace(/\r$/, ''); // Handle CRLF
    if (!trimmedLine.trim()) continue;

    const hash = hashLine(trimmedLine);

    try {
      const raw = JSON.parse(trimmedLine);

      // Handle persisted-output explosion
      const persisted = normalizePersistedOutput(raw, hash);
      if (persisted) {
        for (const ev of persisted) {
          if (events.length >= maxEvents) break;
          ev._hash = hash + '-' + ev._explodedIndex;
          ev._fromWindow = 'head';
          ev._sourceLineIndex = currentLineIndex;
          hashes.add(ev._hash);
          events.push(ev);
        }
        continue;
      }

      // v1.3.0: Handle multi-tool explosion (tool_calls AND tool_results)
      // v1.5.0: Pass lineHash for toolUseId fallback generation
      const toolCallEvents = normalizeToolCalls(raw, hash);
      const toolResultEvents = normalizeToolResults(raw, hash);

      let hasExplosion = false;

      // Process tool calls
      if (Array.isArray(toolCallEvents) && toolCallEvents.length > 0) {
        hasExplosion = true;
        for (const ev of toolCallEvents) {
          if (events.length >= maxEvents) break;
          ev._hash = hash + '-tc' + ev._explodedIndex;
          ev._fromWindow = 'head';
          ev._sourceLineIndex = currentLineIndex;
          hashes.add(ev._hash);
          events.push(ev);
        }
      }

      // Process tool results (v1.3.0: content block support)
      if (Array.isArray(toolResultEvents) && toolResultEvents.length > 0) {
        hasExplosion = true;
        for (const ev of toolResultEvents) {
          if (events.length >= maxEvents) break;
          ev._hash = hash + '-tr' + ev._explodedIndex;
          ev._fromWindow = 'head';
          ev._sourceLineIndex = currentLineIndex;
          hashes.add(ev._hash);
          events.push(ev);
        }
      }

      // Skip normalizeEvent fallback if we exploded
      if (hasExplosion) continue;

      const event = normalizeEvent(raw);
      if (event) {
        event._hash = hash;
        event._fromWindow = 'head';
        event._sourceLineIndex = currentLineIndex;
        hashes.add(hash);
        events.push(event);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  rl.close();
  stream.destroy();

  return { events, hashes, bytesRead, linesRead: sourceLineIndex };
}

/**
 * Count newlines in file from byte 0 up to (but not including) byteOffset.
 * Used to determine the starting source line index for the tail window.
 * @param {string} filePath - Path to file
 * @param {number} byteOffset - Byte offset to count up to
 * @returns {number} Number of newline characters before byteOffset
 */
function countLinesUpTo(filePath, byteOffset) {
  if (byteOffset <= 0) return 0;
  const CHUNK = 64 * 1024; // 64 KB chunks
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(CHUNK);
  let lines = 0;
  let pos = 0;
  try {
    while (pos < byteOffset) {
      const toRead = Math.min(CHUNK, byteOffset - pos);
      const bytesRead = fs.readSync(fd, buf, 0, toRead, pos);
      if (bytesRead === 0) break;
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0x0A) lines++; // newline
      }
      pos += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }
  return lines;
}

/**
 * Read tail window of a log file (last N bytes/events)
 * v1.1.1: Only skip first line if we started mid-line (not on newline boundary)
 * @param {string} filePath - Path to JSONL file
 * @param {number} tailStartByte - Byte offset to start reading
 * @param {number} maxBytes - Maximum bytes to read
 * @param {number} maxEvents - Maximum events to extract
 * @param {object} compiledRedactions - Redaction patterns
 * @param {number} startLineIndex - Source line index at tailStartByte (for provenance)
 * @returns {Promise<{events: Array, hashes: Set, bytesRead: number}>}
 */
async function readTailWindow(filePath, tailStartByte, maxBytes, maxEvents, compiledRedactions, startLineIndex) {
  const events = [];
  const hashes = new Set();
  let bytesRead = 0;
  let isFirstLine = true;
  let sourceLineIndex = startLineIndex || 0;

  // Check if we started mid-line by reading the previous byte
  // If previous byte is \n, we're at a line boundary and first line is complete
  let startedMidLine = false;
  if (tailStartByte > 0) {
    const fd = fs.openSync(filePath, 'r');
    const prevByte = Buffer.alloc(1);
    fs.readSync(fd, prevByte, 0, 1, tailStartByte - 1);
    fs.closeSync(fd);
    startedMidLine = prevByte[0] !== 0x0A; // 0x0A = '\n'
  }

  const stream = fs.createReadStream(filePath, {
    start: tailStartByte,
    encoding: 'utf-8'
  });

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const currentLineIndex = sourceLineIndex;
    sourceLineIndex++;

    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    bytesRead += lineBytes;

    // Skip first line only if we started mid-line (partial line)
    if (isFirstLine && startedMidLine) {
      isFirstLine = false;
      continue;
    }
    isFirstLine = false;

    if (bytesRead > maxBytes) break;
    if (events.length >= maxEvents) break;

    const trimmedLine = line.replace(/\r$/, ''); // Handle CRLF
    if (!trimmedLine.trim()) continue;

    const hash = hashLine(trimmedLine);

    try {
      const raw = JSON.parse(trimmedLine);

      // Handle persisted-output explosion
      const persisted = normalizePersistedOutput(raw, hash);
      if (persisted) {
        for (const ev of persisted) {
          if (events.length >= maxEvents) break;
          ev._hash = hash + '-' + ev._explodedIndex;
          ev._fromWindow = 'tail';
          ev._sourceLineIndex = currentLineIndex;
          hashes.add(ev._hash);
          events.push(ev);
        }
        continue;
      }

      // v1.3.0: Handle multi-tool explosion (tool_calls AND tool_results)
      // v1.5.0: Pass lineHash for toolUseId fallback generation
      const toolCallEvents = normalizeToolCalls(raw, hash);
      const toolResultEvents = normalizeToolResults(raw, hash);

      let hasExplosion = false;

      // Process tool calls
      if (Array.isArray(toolCallEvents) && toolCallEvents.length > 0) {
        hasExplosion = true;
        for (const ev of toolCallEvents) {
          if (events.length >= maxEvents) break;
          ev._hash = hash + '-tc' + ev._explodedIndex;
          ev._fromWindow = 'tail';
          ev._sourceLineIndex = currentLineIndex;
          hashes.add(ev._hash);
          events.push(ev);
        }
      }

      // Process tool results (v1.3.0: content block support)
      if (Array.isArray(toolResultEvents) && toolResultEvents.length > 0) {
        hasExplosion = true;
        for (const ev of toolResultEvents) {
          if (events.length >= maxEvents) break;
          ev._hash = hash + '-tr' + ev._explodedIndex;
          ev._fromWindow = 'tail';
          ev._sourceLineIndex = currentLineIndex;
          hashes.add(ev._hash);
          events.push(ev);
        }
      }

      // Skip normalizeEvent fallback if we exploded
      if (hasExplosion) continue;

      const event = normalizeEvent(raw);
      if (event) {
        event._hash = hash;
        event._fromWindow = 'tail';
        event._sourceLineIndex = currentLineIndex;
        hashes.add(hash);
        events.push(event);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  rl.close();
  stream.destroy();

  return { events, hashes, bytesRead };
}

/**
 * Merge head and tail windows with hash-based deduplication
 * Gap is stored as metadata, NOT as an event
 * @param {object} headResult - Result from readHeadWindow
 * @param {object} tailResult - Result from readTailWindow
 * @param {number} fileSize - Total file size in bytes
 * @param {number} headBytes - Configured head bytes
 * @param {number} tailBytes - Configured tail bytes
 * @returns {{events: Array, windowing: object}}
 */
function mergeWindows(headResult, tailResult, fileSize, headBytes, tailBytes) {
  const merged = [];
  const seenHashes = new Set();

  // Add all head events
  for (const event of headResult.events) {
    seenHashes.add(event._hash);
    merged.push(event);
  }

  // Add tail events, skip duplicates by hash (head wins)
  for (const event of tailResult.events) {
    if (seenHashes.has(event._hash)) continue;
    seenHashes.add(event._hash);
    merged.push(event);
  }

  // Gap as METADATA object, NOT injected as an event
  const overlapped = (headBytes + tailBytes) >= fileSize;
  const windowing = {
    headBytesRead: headResult.bytesRead,
    tailBytesRead: tailResult.bytesRead,
    overlapped,
    bytesSkipped: overlapped ? 0 : Math.max(0, fileSize - headBytes - tailBytes)
  };

  return { events: merged, windowing };
}

/**
 * Fast-path scan: read head+tail 8KB each, detect if full processing needed
 * v1.1.1: Now scans BOTH head and tail to catch resolution markers like "tests pass"
 * @param {string} filePath - Path to JSONL file
 * @param {number} maxBytes - Bytes to scan per window (default 8KB)
 * @returns {Promise<object>} Fast-path scan result
 */
async function fastPathScan(filePath, maxBytes = 8192) {
  let sessionId = null;
  let taskPreview = null;
  let hasToolFailures = false;
  let hasImportanceMarkers = false;
  let headEventCount = 0;
  let tailEventCount = 0;

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Helper to scan a buffer for signals
  function scanBuffer(text, isHead) {
    const lines = text.split('\n');
    let eventCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.replace(/\r$/, '').trim();
      if (!trimmed) continue;

      // Skip first line of tail (likely partial)
      if (!isHead && i === 0) continue;

      eventCount++;

      try {
        const raw = JSON.parse(trimmed);

        // Extract sessionId (head only)
        if (isHead && !sessionId && (raw.sessionId || raw.session_id)) {
          sessionId = raw.sessionId || raw.session_id;
        }

        // Extract taskPreview from first user event (head only)
        if (isHead && !taskPreview && raw.type === 'user') {
          taskPreview = truncate(coerceText(raw.content), 200);
        }

        // Check for tool failures (both head and tail)
        if ((raw.exit_code != null && raw.exit_code !== 0) ||
            (raw.exitCode != null && raw.exitCode !== 0)) {
          hasToolFailures = true;
        }

        // Check for importance markers in assistant text (both head and tail)
        if (raw.type === 'assistant') {
          const assistantText = coerceText(raw.content || raw.message?.content);
          if (IMPORTANCE_REGEX.test(assistantText)) {
            hasImportanceMarkers = true;
          }
        }
      } catch {
        // Skip malformed
      }
    }
    return eventCount;
  }

  // Read head
  const headBuffer = Buffer.alloc(Math.min(maxBytes, fileSize));
  const fd = fs.openSync(filePath, 'r');
  const headBytesRead = fs.readSync(fd, headBuffer, 0, headBuffer.length, 0);
  const headText = headBuffer.toString('utf-8', 0, headBytesRead);
  headEventCount = scanBuffer(headText, true);

  // Read tail (if file is large enough that head and tail don't overlap)
  if (fileSize > maxBytes * 2) {
    const tailStart = fileSize - maxBytes;
    const tailBuffer = Buffer.alloc(maxBytes);
    const tailBytesRead = fs.readSync(fd, tailBuffer, 0, maxBytes, tailStart);
    const tailText = tailBuffer.toString('utf-8', 0, tailBytesRead);
    tailEventCount = scanBuffer(tailText, false);
  }

  fs.closeSync(fd);

  // Estimate total event count from file size
  const totalBytesScanned = headBytesRead + (fileSize > maxBytes * 2 ? maxBytes : 0);
  const totalEventsScanned = headEventCount + tailEventCount;
  const avgLineSize = totalBytesScanned > 0 && totalEventsScanned > 0 ? totalBytesScanned / totalEventsScanned : 500;
  const estimatedEventCount = Math.round(fileSize / avgLineSize);

  const needsFullProcessing = hasToolFailures || hasImportanceMarkers;

  return {
    mode: 'fast',
    sessionId: sessionId || path.basename(filePath, '.jsonl'),
    taskPreview: taskPreview || '[No user message found]',
    hasToolFailures,
    hasImportanceMarkers,
    needsFullProcessing,
    reason: needsFullProcessing
      ? (hasToolFailures ? 'tool failures detected' : 'importance markers detected')
      : null,
    estimatedEventCount,
    scannedHead: true,
    scannedTail: fileSize > maxBytes * 2
  };
}

/**
 * Compute session-level aggregates from events
 * @param {Array} events - Normalized events
 * @param {number} maxLength - Max chars for text fields
 * @returns {object} Session aggregates
 */
function computeSessionAggregates(events, maxLength = 200) {
  const toolNameSet = new Set();
  const kindsCount = {};
  let firstUserText = null;
  let firstAssistantText = null;

  for (const event of events) {
    // Count by kind
    kindsCount[event.kind] = (kindsCount[event.kind] || 0) + 1;

    // Collect distinct tool names
    if (event.toolName) toolNameSet.add(event.toolName);

    // First user message
    if (!firstUserText && event.kind === 'user' && event.text) {
      firstUserText = truncate(event.text, maxLength);
    }

    // First assistant message
    if (!firstAssistantText && event.kind === 'assistant' && event.text) {
      firstAssistantText = truncate(event.text, maxLength);
    }
  }

  return {
    taskPreview: firstUserText || '[No user message found]',
    firstUserText: firstUserText || '[No user message found]',
    firstAssistantText: firstAssistantText || '[No assistant response found]',
    toolNames: Array.from(toolNameSet).sort(),
    kindsCount
  };
}

// ============================================================================
// Extractor Session Detection
// ============================================================================

/**
 * Detect if a session is running the extractor (should be skipped)
 * v1.1.0: Also checks tail events if there's a gap
 * @param {Array} events - Normalized events
 * @param {object} windowing - Windowing metadata (optional)
 */
function isExtractorSession(events, windowing = null) {
  // Check head events (first 20 user/system events from head window)
  const headEvents = events
    .filter(e => e._fromWindow === 'head' && (e.kind === 'user' || e.kind === 'system'))
    .slice(0, 20);

  // If no _fromWindow markers, fall back to checking all events (backward compat)
  const checkEvents = headEvents.length > 0 ? headEvents : events
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

  // v1.1.0: Also check tail events if there's a gap (marker might be missed in head)
  if (windowing && !windowing.overlapped) {
    const tailEvents = events
      .filter(e => e._fromWindow === 'tail' && (e.kind === 'user' || e.kind === 'system'))
      .slice(0, 10);

    for (const event of tailEvents) {
      if (!event.text) continue;
      for (const marker of EXTRACTOR_MARKERS) {
        if (marker.test(event.text)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Detect if a session belongs to story-miner itself (skip to avoid self-referential mining)
 * Uses the same head/tail scanning approach as isExtractorSession
 */
function isMinerSession(events, windowing = null) {
  const headEvents = events
    .filter(e => e._fromWindow === 'head' && (e.kind === 'user' || e.kind === 'system'))
    .slice(0, 20);
  const checkEvents = headEvents.length > 0 ? headEvents : events
    .filter(e => e.kind === 'user' || e.kind === 'system')
    .slice(0, 20);

  for (const event of checkEvents) {
    if (!event.text) continue;
    for (const marker of MINER_MARKERS) {
      if (marker.test(event.text)) return true;
    }
  }

  if (windowing && !windowing.overlapped) {
    const tailEvents = events
      .filter(e => e._fromWindow === 'tail' && (e.kind === 'user' || e.kind === 'system'))
      .slice(0, 10);
    for (const event of tailEvents) {
      if (!event.text) continue;
      for (const marker of MINER_MARKERS) {
        if (marker.test(event.text)) return true;
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
 * @deprecated v1.4.0: Use isToolFailureV2 with tiered detection
 */
function matchesErrorPattern(text) {
  if (!text) return false;
  return ERROR_PATTERNS.some(p => p.test(text));
}

/**
 * v1.4.0: Check if tool is eligible for regex-based failure detection
 * @param {string|null} toolName - Tool name from event
 * @param {object} config - Failure detection configuration
 * @returns {boolean} Whether regex patterns should apply
 */
function isToolEligibleForRegex(toolName, config) {
  if (!toolName) return false;

  const denylist = config.regexToolDenylist || DEFAULT_REGEX_DENYLIST;
  const allowlist = config.regexToolAllowlist || DEFAULT_REGEX_ALLOWLIST;

  // Denylist takes precedence
  if (denylist.some(t => toolName.toLowerCase().includes(t.toLowerCase()))) {
    return false;
  }

  return allowlist.some(t => toolName.toLowerCase().includes(t.toLowerCase()));
}

/**
 * v1.4.0: Check if event is a tool failure with tiered detection
 * @param {object} event - Normalized event
 * @param {object} config - Failure detection configuration
 * @returns {boolean} Whether event represents a failure
 */
function isToolFailureV2(event, config = {}) {
  // Ignore explicit non-tool kinds (user, assistant, system)
  const nonToolKinds = ['user', 'assistant', 'system'];
  if (nonToolKinds.includes(event.kind)) {
    return false;
  }

  // Tier A: exitCode is ALWAYS authoritative for tool_result or unknown kinds
  // This ensures we catch failures even if kind wasn't normalized properly
  if (event.exitCode != null && event.exitCode !== 0) {
    return true;
  }

  // For regex fallback, require tool_result kind
  if (event.kind !== 'tool_result') return false;

  const mode = config.mode || 'strict';

  // Strict mode: exitCode only, no regex fallback
  if (mode === 'strict') {
    return false;
  }

  // Check tool eligibility for regex fallback
  if (!isToolEligibleForRegex(event.toolName, config)) {
    return false;
  }

  // Tier B: Fatal patterns (balanced + heuristic modes)
  if (FATAL_PATTERNS.some(p => p.test(event.text))) {
    return true;
  }

  // Tier C: Broad patterns with threshold (heuristic mode only)
  if (mode === 'heuristic') {
    const minMatches = config.minBroadMatches || 2;
    const matchCount = BROAD_PATTERNS.filter(p => p.test(event.text)).length;
    if (matchCount >= minMatches) {
      return true;
    }
  }

  return false;
}

/**
 * v1.5.0: Check if event is a tool failure with tiered detection and tier reporting
 * @param {object} event - Normalized event
 * @param {object} config - Failure detection configuration
 * @returns {{ isFailure: boolean, tier: 'A'|'B'|'C'|null, pattern: string|null }}
 */
function isToolFailureV3(event, config = {}) {
  // Ignore explicit non-tool kinds (user, assistant, system)
  const nonToolKinds = ['user', 'assistant', 'system'];
  if (nonToolKinds.includes(event.kind)) {
    return { isFailure: false, tier: null, pattern: null };
  }

  // Tier A: is_error flag (highest precedence - authoritative signal)
  if (event.isError === true) {
    return { isFailure: true, tier: 'A', pattern: 'is_error' };
  }

  // Tier A: exitCode is ALWAYS authoritative for tool_result or unknown kinds
  if (event.exitCode != null && event.exitCode !== 0) {
    return { isFailure: true, tier: 'A', pattern: `exit_code:${event.exitCode}` };
  }

  // For regex fallback, require tool_result kind
  if (event.kind !== 'tool_result') {
    return { isFailure: false, tier: null, pattern: null };
  }

  const mode = config.mode || 'strict';

  // Strict mode: exitCode only, no regex fallback
  if (mode === 'strict') {
    return { isFailure: false, tier: null, pattern: null };
  }

  // Check tool eligibility for regex fallback
  if (!isToolEligibleForRegex(event.toolName, config)) {
    return { isFailure: false, tier: null, pattern: null };
  }

  // Tier B: Fatal patterns (balanced + heuristic modes)
  for (const pattern of FATAL_PATTERNS) {
    if (pattern.test(event.text)) {
      return { isFailure: true, tier: 'B', pattern: pattern.source };
    }
  }

  // Tier C: Broad patterns with threshold (heuristic mode only)
  if (mode === 'heuristic') {
    const minMatches = config.minBroadMatches || 2;
    const matches = BROAD_PATTERNS.filter(p => p.test(event.text));
    if (matches.length >= minMatches) {
      return { isFailure: true, tier: 'C', pattern: matches.map(m => m.source).join(',') };
    }
  }

  return { isFailure: false, tier: null, pattern: null };
}

/**
 * Check if an event is a tool failure
 * v1.4.0: Now accepts detectionConfig parameter, defaults to strict mode
 * v1.5.0: Now delegates to V3 for tiered detection
 * @param {object} event - Normalized event
 * @param {object} detectionConfig - Detection configuration (default: strict mode)
 * @returns {boolean} Whether event represents a failure
 */
function isToolFailure(event, detectionConfig = { mode: 'strict' }) {
  return isToolFailureV3(event, detectionConfig).isFailure;
}

/**
 * Extract tool failures from events
 * v1.4.0: Now accepts detectionConfig parameter
 * v1.5.0: Accepts transactionMap for inputSummary, adds toolUseId/isError/detectionTier/patternMatched
 * @param {object[]} events - Normalized events
 * @param {Map|object} transactionMapOrConfig - Transaction map (v1.5.0) OR detection config (backward compat)
 * @param {object} detectionConfig - Detection configuration (default: strict mode)
 * @returns {object[]} Array of failure objects
 */
function extractToolFailures(events, transactionMapOrConfig = null, detectionConfig = { mode: 'strict' }) {
  // Backward compatibility: if second param looks like config, use it as config
  let transactionMap = null;
  if (transactionMapOrConfig instanceof Map) {
    transactionMap = transactionMapOrConfig;
  } else if (transactionMapOrConfig && typeof transactionMapOrConfig === 'object' && !Array.isArray(transactionMapOrConfig)) {
    // Check if it's a config object (has mode property or is plain object without Map methods)
    if (transactionMapOrConfig.mode || !transactionMapOrConfig.has) {
      detectionConfig = transactionMapOrConfig;
      transactionMap = null;
    }
  }

  const failures = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Use V3 for tier reporting
    const detection = isToolFailureV3(event, detectionConfig);
    if (!detection.isFailure) continue;

    // Get transaction for inputSummary
    const tx = (transactionMap && event.toolUseId) ? transactionMap.get(event.toolUseId) : null;

    failures.push({
      tool: event.toolName,
      toolUseId: event.toolUseId || null,
      command: event.command,
      inputSummary: tx?.inputSummary || null,
      exitCode: event.exitCode,
      isError: event.isError || false,
      error: truncate(event.text, 500),
      timestamp: event.timestamp,
      eventIndex: i,
      detectionTier: detection.tier,
      patternMatched: detection.pattern
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
/**
 * Compute sample indices for event selection
 * v1.1.0: Added importance window support, nested config
 * v1.5.0: Added events parameter for transaction coherence
 * @param {number} totalEvents - Total event count
 * @param {number[]} failureIndices - Indices of tool failures
 * @param {number[]} importanceIndices - Indices of importance markers (v1.1.0)
 * @param {object} config - Configuration object
 * @param {Array|null} events - Events array for transaction coherence (v1.5.0, optional)
 * @returns {number[]} Sorted indices to keep
 */
function computeSampleIndices(totalEvents, failureIndices, importanceIndices, config, events = null) {
  const indices = new Set();
  config = config || {};

  // Use nested config or fall back to deprecated flat keys
  const sampling = config.sampling || {};
  const contextCount = sampling.contextEvents ?? config.contextEventsCount ?? DEFAULTS.sampling.contextEvents;
  const resolutionCount = sampling.resolutionEvents ?? config.resolutionEventsCount ?? DEFAULTS.sampling.resolutionEvents;
  const errorWindow = sampling.errorWindowEvents ?? config.errorWindowEvents ?? DEFAULTS.sampling.errorWindowEvents;
  const importanceWindow = sampling.importanceWindowEvents ?? DEFAULTS.sampling.importanceWindowEvents;

  // Phase 1: Standard sampling

  // First N (context)
  for (let i = 0; i < Math.min(contextCount, totalEvents); i++) {
    indices.add(i);
  }

  // Last M (resolution) - now correctly from ACTUAL end of merged events
  for (let i = Math.max(0, totalEvents - resolutionCount); i < totalEvents; i++) {
    indices.add(i);
  }

  // Error windows
  for (const fi of failureIndices) {
    const start = Math.max(0, fi - errorWindow);
    const end = Math.min(totalEvents, fi + errorWindow + 1);
    for (let i = start; i < end; i++) {
      indices.add(i);
    }
  }

  // v1.1.0: Importance marker windows
  for (const ii of (importanceIndices || [])) {
    const start = Math.max(0, ii - importanceWindow);
    const end = Math.min(totalEvents, ii + importanceWindow + 1);
    for (let i = start; i < end; i++) {
      indices.add(i);
    }
  }

  // Phase 2: Transaction coherence (v1.5.0)
  // If any event with a toolUseId is selected, include all events with the same toolUseId
  // NOTE: This may expand indices beyond configured limits - acceptable tradeoff for semantic completeness
  if (events) {
    // Build toolUseId → indices map
    const txToIndices = new Map();
    for (let i = 0; i < events.length; i++) {
      const txId = events[i].toolUseId;
      if (txId) {
        if (!txToIndices.has(txId)) txToIndices.set(txId, []);
        txToIndices.get(txId).push(i);
      }
    }

    // For each selected index with toolUseId, include all indices in that transaction
    const toAdd = [];
    for (const idx of indices) {
      const txId = events[idx]?.toolUseId;
      if (txId && txToIndices.has(txId)) {
        for (const txIdx of txToIndices.get(txId)) {
          toAdd.push(txIdx);
        }
      }
    }
    for (const idx of toAdd) {
      indices.add(idx);
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
 * v1.1.0: Uses two-window mode for large files, tracks importance markers
 * v1.4.0: Accepts detectionConfig for tiered failure detection
 * @param {string} filePath - Path to the log file
 * @param {object} config - Configuration object
 * @param {Array<{regex: RegExp, source: string}>} compiledRedactions - Pre-compiled redaction regexes
 * @param {object} detectionConfig - Failure detection configuration (v1.4.0)
 */
async function processLogFile(filePath, config, compiledRedactions, detectionConfig = { mode: 'strict' }) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Get windowing config (nested or deprecated flat)
  const windowing = config.windowing || {};
  const headBytes = windowing.headBytes ?? Math.round((config.maxBytesPerLog ?? DEFAULTS.windowing.headBytes + DEFAULTS.windowing.tailBytes) * 0.6);
  const tailBytes = windowing.tailBytes ?? Math.round((config.maxBytesPerLog ?? DEFAULTS.windowing.headBytes + DEFAULTS.windowing.tailBytes) * 0.4);
  const headEvents = windowing.headEvents ?? Math.round((config.maxEventsPerLog ?? DEFAULTS.windowing.headEvents + DEFAULTS.windowing.tailEvents) * 0.5);
  const tailEvents = windowing.tailEvents ?? Math.round((config.maxEventsPerLog ?? DEFAULTS.windowing.headEvents + DEFAULTS.windowing.tailEvents) * 0.5);

  let allEvents = [];
  let windowingMeta = null;

  // Decide: two-window mode for large files, single-pass for small
  if (fileSize > headBytes + tailBytes) {
    // Two-window mode
    log('verbose', `  Using two-window mode (file: ${fileSize} bytes > ${headBytes + tailBytes} budget)`);

    const headResult = await readHeadWindow(filePath, headBytes, headEvents, compiledRedactions);
    const tailStartByte = Math.max(0, fileSize - tailBytes);
    // Count lines before tail start to get correct source line indices for tail events
    const tailStartLineIndex = countLinesUpTo(filePath, tailStartByte);
    const tailResult = await readTailWindow(filePath, tailStartByte, tailBytes, tailEvents, compiledRedactions, tailStartLineIndex);

    const merged = mergeWindows(headResult, tailResult, fileSize, headBytes, tailBytes);
    allEvents = merged.events;
    windowingMeta = merged.windowing;

    log('verbose', `  Head: ${headResult.events.length} events, Tail: ${tailResult.events.length} events, Merged: ${allEvents.length} (overlapped: ${windowingMeta.overlapped})`);
  } else {
    // Single-pass mode for small files (backward compatible)
    log('verbose', `  Using single-pass mode (file: ${fileSize} bytes <= ${headBytes + tailBytes} budget)`);
    const headResult = await readHeadWindow(filePath, fileSize, headEvents + tailEvents, compiledRedactions);
    allEvents = headResult.events;
    windowingMeta = {
      headBytesRead: headResult.bytesRead,
      tailBytesRead: 0,
      overlapped: true,
      bytesSkipped: 0
    };
  }

  // Extract session metadata from events
  let sessionId = null;
  let metadata = {};

  for (const event of allEvents) {
    if (!sessionId && event.sessionId) {
      sessionId = event.sessionId;
    }
    if (event.metadata?.cwd && !metadata.cwd) metadata.cwd = event.metadata.cwd;
    if (event.metadata?.gitBranch && !metadata.gitBranch) metadata.gitBranch = event.metadata.gitBranch;
  }

  // Generate session ID if not found
  if (!sessionId) {
    sessionId = path.basename(filePath, '.jsonl');
  }

  // v1.5.0: Build transaction map for call/result linking and backfill
  const transactionMap = buildTransactionMap(allEvents);

  // v1.5.0: Compute transaction stats
  // Note: orphanedFailed tracks orphaned transactions that also failed (isFailure=true)
  const txStats = { complete: 0, orphaned: 0, pending: 0, failed: 0, orphanedFailed: 0 };
  for (const tx of transactionMap.values()) {
    if (tx.state === 'completed') txStats.complete++;
    else if (tx.state === 'failed') { txStats.complete++; txStats.failed++; }
    else if (tx.state === 'orphaned') {
      txStats.orphaned++;
      if (tx.isFailure) txStats.orphanedFailed++;
    }
    else if (tx.state === 'pending') txStats.pending++;
  }

  // Index tool failures and importance markers
  const toolFailureIndices = [];
  const importanceIndices = [];

  for (let i = 0; i < allEvents.length; i++) {
    const event = allEvents[i];

    if (isToolFailure(event, detectionConfig)) {
      toolFailureIndices.push(i);
    }

    // v1.1.0: Track importance markers in assistant text
    if (event.kind === 'assistant' && event.text && IMPORTANCE_REGEX.test(event.text)) {
      importanceIndices.push(i);
    }
  }

  // Compute sample indices with importance markers and transaction coherence (v1.5.0)
  const keepIndices = computeSampleIndices(allEvents.length, toolFailureIndices, importanceIndices, config, allEvents);

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

  // Apply redaction, truncation, story signals, and provenance to kept events
  const truncateLength = config.truncateContentLength ?? DEFAULTS.truncateContentLength;
  const signalPatterns = config.storySignalPatterns || DEFAULT_STORY_SIGNAL_PATTERNS;
  const sampledEvents = keepIndices.map((i, sampledIndex) => {
    let event = { ...allEvents[i] };
    event = applyRedaction(event, compiledRedactions);
    event = truncateEvent(event, truncateLength);
    // story-miner: detect story signals on the event text
    event.storySignals = detectStorySignals(event.text, signalPatterns);
    // story-miner: compute provenance pointer using real source line index
    const realLineIndex = allEvents[i]._sourceLineIndex != null ? allEvents[i]._sourceLineIndex : i;
    event.provenance = computeProvenance(sessionId, realLineIndex, event.text);
    // story-miner: preserve blockType for thinking-policy enforcement
    if (!event.blockType) {
      if (event.kind === 'tool_call') event.blockType = 'tool_use';
      else if (event.kind === 'tool_result') event.blockType = 'tool_result';
      else event.blockType = 'text';
    }
    // Strip all internal preprocessing fields (underscore-prefixed) from output
    for (const key of Object.keys(event)) {
      if (key.startsWith('_')) delete event[key];
    }
    // Deep-clone metadata to break shared reference, then strip path-bearing fields
    if (event.metadata) {
      event.metadata = { ...event.metadata };
      delete event.metadata.cwd;
      delete event.metadata.gitBranch;
      if (Object.keys(event.metadata).length === 0) delete event.metadata;
    }
    return event;
  });

  // Extract and redact tool failures
  // v1.5.0: Pass transactionMap for inputSummary and enhanced failure attribution
  const toolFailures = extractToolFailures(allEvents, transactionMap, detectionConfig).map(f => applyRedaction(f, compiledRedactions));

  // v1.1.0: Compute session aggregates
  const sampling = config.sampling || {};
  const taskPreviewLength = sampling.taskPreviewLength ?? DEFAULTS.sampling.taskPreviewLength;
  const aggregates = computeSessionAggregates(allEvents, taskPreviewLength);

  // Compute timestamps from events
  const timestamps = allEvents.filter(e => e.timestamp).map(e => e.timestamp).sort();
  const firstTimestamp = timestamps[0] || null;
  const lastTimestamp = timestamps[timestamps.length - 1] || null;

  // Build transaction array from transactionMap
  const transactions = [];
  for (const [txId, tx] of transactionMap) {
    transactions.push({
      toolUseId: txId,
      toolName: tx.toolName || null,
      state: tx.state,
      callEventIndex: tx.callEventIndex,
      resultEventIndex: tx.resultEventIndex,
      isFailure: tx.isFailure || false,
      detectionTier: tx.failureDetails?.detectionTier || null
    });
  }

  return {
    sessionId,
    logPath: redactPath(filePath),
    metadata,
    totalEvents: allEvents.length,
    sampledEventCount: sampledEvents.length,
    events: sampledEvents,
    toolFailures,
    transactions,
    evidence: evidenceSnippets,
    isExtractorSession: isExtractorSession(allEvents, windowingMeta),
    isMinerSession: isMinerSession(allEvents, windowingMeta),

    windowing: windowingMeta,
    firstTimestamp,
    lastTimestamp,
    taskPreview: aggregates.taskPreview,
    firstUserText: aggregates.firstUserText,
    firstAssistantText: aggregates.firstAssistantText,
    toolNames: aggregates.toolNames,
    kindsCount: aggregates.kindsCount,

    txStats
  };
}

// ============================================================================
// Cursor Management
// ============================================================================

/**
 * Migrate cursor from schema v1 to v2
 * @param {object} cursorV1 - V1 cursor object
 * @returns {object} V2 cursor with empty index
 */
function migrateCursorV1toV2(cursorV1) {
  return {
    schemaVersion: 2,
    lastRunAt: cursorV1.lastRunAt || new Date().toISOString(),
    lastMtimeCutoffMs: cursorV1.lastMtimeCutoffMs || 0,
    recentFiles: cursorV1.recentFiles || [],
    index: {},
    indexStats: {
      entryCount: 0,
      oldestEntryAt: null,
      newestEntryAt: null,
      lastPrunedAt: null
    }
  };
}

/**
 * Read cursor file for incremental processing
 * Auto-migrates v1 cursors to v2
 */
function readCursor(cursorPath) {
  try {
    if (!fs.existsSync(cursorPath)) return null;
    const data = JSON.parse(fs.readFileSync(cursorPath, 'utf-8'));

    // Auto-migrate v1 to v2
    if (!data.schemaVersion || data.schemaVersion === 1) {
      log('verbose', 'Migrating cursor from v1 to v2');
      return migrateCursorV1toV2(data);
    }

    // Ensure index and indexStats exist for v2
    if (data.schemaVersion === 2) {
      if (!data.index) data.index = {};
      if (!data.indexStats) {
        data.indexStats = {
          entryCount: Object.keys(data.index).length,
          oldestEntryAt: null,
          newestEntryAt: null,
          lastPrunedAt: null
        };
      }
    }

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

/**
 * Read and validate index entry for a session file
 * @param {object} cursor - Loaded cursor object (may be null)
 * @param {string} filePath - Normalized file path (redacted)
 * @param {object} fileStats - { mtimeMs, size } from fs.statSync
 * @returns {{ valid: boolean, entry: object|null, reason: string }}
 */
function readIndexEntry(cursor, filePath, fileStats) {
  if (!cursor || !cursor.index) {
    return { valid: false, entry: null, reason: 'miss_no_cursor' };
  }

  const entry = cursor.index[filePath];
  if (!entry) {
    return { valid: false, entry: null, reason: 'miss_not_found' };
  }

  // Validate mtime
  if (entry.mtimeMs !== fileStats.mtimeMs) {
    return { valid: false, entry, reason: 'stale_mtime' };
  }

  // Validate size
  if (entry.sizeBytes !== fileStats.size) {
    return { valid: false, entry, reason: 'stale_size' };
  }

  return { valid: true, entry, reason: 'hit' };
}

/**
 * Update index with derived session metadata
 * Preserves user fields (tags, notes) if present
 * @param {object} cursor - Cursor object to mutate
 * @param {string} filePath - Normalized file path
 * @param {object} sessionResult - Result from processLogFile() or fastPathScan()
 * @param {object} fileStats - { mtimeMs, size } from fs.statSync
 * @param {string} mode - "full" | "fast" | "cached"
 * @param {boolean} preserveUserFields - Whether to preserve tags/notes
 */
function writeIndexEntry(cursor, filePath, sessionResult, fileStats, mode, preserveUserFields = true) {
  if (!cursor.index) cursor.index = {};

  const existing = cursor.index[filePath] || {};

  // Extract project key from path
  const projectKeyMatch = filePath.match(/projects[/\\]([^/\\]+)[/\\]/);
  const projectKey = projectKeyMatch ? projectKeyMatch[1] : null;

  cursor.index[filePath] = {
    path: filePath,
    mtimeMs: fileStats.mtimeMs,
    sizeBytes: fileStats.size,
    sessionId: sessionResult.sessionId || path.basename(filePath, '.jsonl'),
    projectKey,
    taskPreview: sessionResult.taskPreview || null,
    firstUserText: sessionResult.firstUserText || null,
    firstAssistantText: sessionResult.firstAssistantText || null,
    toolNames: sessionResult.toolNames || [],
    kindsCount: sessionResult.kindsCount || {},
    hasImportanceMarkers: sessionResult.hasImportanceMarkers ?? null,
    hasToolFailures: sessionResult.hasToolFailures ?? (sessionResult.toolFailures?.length ? true : false),
    // v1.2.0: Store counts for accurate summary stats on cached sessions
    totalEvents: sessionResult.totalEvents || Object.values(sessionResult.kindsCount || {}).reduce((a, b) => a + b, 0),
    toolFailuresCount: sessionResult.toolFailures?.length || 0,
    windowing: sessionResult.windowing || null,
    // v1.5.0: Store transaction stats for health metric aggregation
    txStats: sessionResult.txStats || { complete: 0, orphaned: 0, pending: 0, failed: 0 },
    mode,
    lastIndexedAt: new Date().toISOString(),
    // Preserve user fields
    tags: preserveUserFields ? (existing.tags || []) : [],
    notes: preserveUserFields ? (existing.notes || '') : ''
  };
}

/**
 * Prune index to bounded size using configured strategy
 * Never prunes entries with user annotations (tags/notes)
 * @param {object} cursor - Cursor object to mutate
 * @param {object} config - { maxEntries, maxAgeDays, pruneStrategy }
 * @returns {{ pruned: number, remaining: number }}
 */
function pruneIndex(cursor, config = {}) {
  const maxEntries = config.maxEntries ?? INDEX_DEFAULTS.maxEntries;
  const maxAgeDays = config.maxAgeDays ?? INDEX_DEFAULTS.maxAgeDays;
  const strategy = config.pruneStrategy ?? INDEX_DEFAULTS.pruneStrategy;

  if (!cursor.index) {
    return { pruned: 0, remaining: 0 };
  }

  const entries = Object.entries(cursor.index);
  const initialCount = entries.length;

  // Target 80% of max when pruning to avoid pruning on every run
  const targetCount = Math.floor(maxEntries * 0.8);

  // Skip if under target
  if (initialCount <= targetCount) {
    return { pruned: 0, remaining: initialCount };
  }

  const now = Date.now();
  const ageCutoffMs = maxAgeDays > 0 ? now - (maxAgeDays * 24 * 60 * 60 * 1000) : 0;

  // Sort by lastIndexedAt descending (most recent first)
  entries.sort((a, b) => {
    const aTime = new Date(a[1].lastIndexedAt || 0).getTime();
    const bTime = new Date(b[1].lastIndexedAt || 0).getTime();
    return bTime - aTime;
  });

  const newIndex = {};
  let kept = 0;

  for (const [key, entry] of entries) {
    const entryTime = new Date(entry.lastIndexedAt || 0).getTime();
    const hasUserAnnotations = (entry.tags?.length > 0) || (entry.notes?.length > 0);
    const isRecent = ageCutoffMs === 0 || entryTime >= ageCutoffMs;

    // Keep rules (priority order):
    // 1. Always keep entries with user annotations
    // 2. For hybrid/lru: keep up to targetCount recent entries
    // 3. For age: keep all entries within maxAgeDays
    let shouldKeep = false;

    if (hasUserAnnotations) {
      shouldKeep = true;
    } else if (strategy === 'age') {
      shouldKeep = isRecent;
    } else if (strategy === 'lru' || strategy === 'hybrid') {
      // Hybrid: age-filter first (if configured), then LRU
      if (strategy === 'hybrid' && maxAgeDays > 0 && !isRecent) {
        shouldKeep = false;
      } else {
        shouldKeep = kept < targetCount;
      }
    }

    if (shouldKeep) {
      newIndex[key] = entry;
      kept++;
    }
  }

  cursor.index = newIndex;
  cursor.indexStats = cursor.indexStats || {};
  cursor.indexStats.entryCount = kept;
  cursor.indexStats.lastPrunedAt = new Date().toISOString();

  // Update oldest/newest entry times
  const times = Object.values(newIndex).map(e => new Date(e.lastIndexedAt || 0).getTime()).filter(t => t > 0);
  if (times.length > 0) {
    cursor.indexStats.oldestEntryAt = new Date(Math.min(...times)).toISOString();
    cursor.indexStats.newestEntryAt = new Date(Math.max(...times)).toISOString();
  }

  return { pruned: initialCount - kept, remaining: kept };
}

/**
 * Serialize cursor with deterministic key ordering
 * @param {object} cursor - Cursor object
 * @returns {string} JSON string with sorted keys
 */
function serializeCursorDeterministic(cursor) {
  // Sort index keys alphabetically
  if (cursor.index) {
    const sortedIndex = {};
    for (const key of Object.keys(cursor.index).sort()) {
      sortedIndex[key] = cursor.index[key];
    }
    cursor.index = sortedIndex;
  }

  // Sort recentFiles by path for consistency
  if (cursor.recentFiles) {
    cursor.recentFiles.sort((a, b) => a.path.localeCompare(b.path));
  }

  return JSON.stringify(cursor, null, 2) + '\n';
}

/**
 * Write cursor file with atomic semantics (Windows-safe)
 * Uses .bak pattern for crash recovery
 * @param {string} cursorPath - Path to cursor file
 * @param {object} cursor - Cursor object to write
 */
function atomicWriteCursor(cursorPath, cursor) {
  const tmpPath = cursorPath + '.tmp';
  const bakPath = cursorPath + '.bak';

  const content = serializeCursorDeterministic(cursor);

  try {
    // Step 1: Write to temp file
    fs.writeFileSync(tmpPath, content);

    // Step 2: Backup existing (if exists)
    if (fs.existsSync(cursorPath)) {
      try {
        fs.renameSync(cursorPath, bakPath);
      } catch (backupErr) {
        // If backup fails, try direct delete
        fs.unlinkSync(cursorPath);
      }
    }

    // Step 3: Rename temp to target
    fs.renameSync(tmpPath, cursorPath);

    // Step 4: Clean up backup
    if (fs.existsSync(bakPath)) {
      try {
        fs.unlinkSync(bakPath);
      } catch (cleanupErr) {
        // Non-fatal: backup remains but cursor is valid
      }
    }
  } catch (err) {
    // Attempt recovery: restore backup if exists
    if (fs.existsSync(bakPath) && !fs.existsSync(cursorPath)) {
      try {
        fs.renameSync(bakPath, cursorPath);
      } catch (restoreErr) {
        // Recovery failed
      }
    }
    // Clean up temp if it exists
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (tmpCleanupErr) {
        // Non-fatal
      }
    }
    throw err;
  }
}

/**
 * Build a lightweight session object from an index entry (for cache hits)
 * @param {object} indexEntry - Index entry with cached metadata
 * @param {object} fileStats - { mtimeMs } for mtime field
 * @returns {object} Session object suitable for preprocessed.json
 */
function buildCachedSession(indexEntry, fileStats) {
  return {
    sessionId: indexEntry.sessionId,
    logPath: indexEntry.path,
    mtime: new Date(fileStats.mtimeMs).toISOString(),
    mode: 'cached',
    fromIndex: true,

    // Derived fields from index
    taskPreview: indexEntry.taskPreview,
    firstUserText: indexEntry.firstUserText,
    firstAssistantText: indexEntry.firstAssistantText,
    toolNames: indexEntry.toolNames || [],
    kindsCount: indexEntry.kindsCount || {},
    hasToolFailures: indexEntry.hasToolFailures || false,
    hasImportanceMarkers: indexEntry.hasImportanceMarkers || false,
    windowing: indexEntry.windowing,

    // Null for cached sessions (the speed win)
    events: null,
    evidence: null,
    toolFailures: null,
    // v1.2.0: Preserve counts from index for accurate summary stats
    totalEvents: indexEntry.totalEvents || 0,
    eventCount: indexEntry.totalEvents || null,
    sampledEventCount: 0,
    toolFailuresCount: indexEntry.toolFailuresCount || 0,
    // v1.5.0: Transaction stats for health metric aggregation
    txStats: indexEntry.txStats || { complete: 0, orphaned: 0, pending: 0, failed: 0 }
  };
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
 * v1.4.0: Determine run scope for lesson generation guidance
 * @param {object} opts - CLI options
 * @param {object} stats - Run statistics
 * @param {object} scopeConfig - Scope detection configuration
 * @returns {'full' | 'substantial' | 'incremental'}
 */
function determineRunScope(opts, stats, scopeConfig = {}) {
  const threshold = scopeConfig.incrementalThreshold || 5;

  // Full run if explicit flags used
  if (opts.full || opts.reindex || opts.clear) {
    return 'full';
  }

  // Count newly processed sessions (not cached, not fast)
  const newlyProcessed = stats.sessionsWrittenByMode?.full || 0;

  // Substantial if above threshold
  if (newlyProcessed >= threshold) {
    return 'substantial';
  }

  return 'incremental';
}

/**
 * v1.4.0: Get reason for run scope determination
 */
function getRunScopeReason(opts, stats, scopeConfig = {}) {
  if (opts.full) return '--full flag';
  if (opts.reindex) return '--reindex flag';
  if (opts.clear) return '--clear flag';

  const threshold = scopeConfig.incrementalThreshold || 5;
  const newlyProcessed = stats.sessionsWrittenByMode?.full || 0;

  if (newlyProcessed >= threshold) {
    return `${newlyProcessed} new sessions >= threshold (${threshold})`;
  }

  return `${newlyProcessed} new sessions < threshold (${threshold})`;
}

/**
 * Generate preprocessor output
 * v1.4.0: Now accepts opts for runScope detection
 */
function generateOutput(sessions, stats, config, opts = {}) {
  // Compute toolStats from session aggregates (v1.1.0)
  let toolCallsDetected = 0;
  let toolResultsDetected = 0;
  let toolFailuresDetected = 0;

  // v1.5.0: Aggregate transaction stats from sessions
  let totalTxComplete = 0;
  let totalTxOrphaned = 0;
  let totalTxPending = 0;
  let totalTxFailed = 0;
  let totalTxOrphanedFailed = 0;

  for (const session of sessions) {
    const kinds = session.kindsCount || {};
    toolCallsDetected += kinds.tool_call || 0;
    toolResultsDetected += kinds.tool_result || 0;
    toolFailuresDetected += session.toolFailures?.length || 0;

    // v1.5.0: Aggregate txStats (works for both full and cached sessions)
    const txStats = session.txStats || { complete: 0, orphaned: 0, pending: 0, failed: 0, orphanedFailed: 0 };
    totalTxComplete += txStats.complete || 0;
    totalTxOrphaned += txStats.orphaned || 0;
    totalTxPending += txStats.pending || 0;
    totalTxFailed += txStats.failed || 0;
    totalTxOrphanedFailed += txStats.orphanedFailed || 0;
  }

  // v1.5.0: Compute call/result ratio and health warnings
  const callResultRatio = toolCallsDetected > 0
    ? toolResultsDetected / toolCallsDetected
    : 1.0;

  const healthWarnings = [];
  if (callResultRatio < 0.9 && toolCallsDetected > 10) {
    healthWarnings.push(`Low call/result ratio (${callResultRatio.toFixed(2)}): may indicate windowing gaps`);
  }
  if (callResultRatio > 1.1 && toolResultsDetected > 10) {
    healthWarnings.push(`High call/result ratio (${callResultRatio.toFixed(2)}): may indicate legacy formats`);
  }
  if (totalTxOrphaned > 0) {
    healthWarnings.push(`${totalTxOrphaned} total orphaned transactions across all sessions`);
  }
  if (totalTxOrphanedFailed > 0) {
    healthWarnings.push(`${totalTxOrphanedFailed} orphaned transactions with failures (windowing may hide context)`);
  }

  // Group sessions by project path (derived from logPath) (v1.1.0)
  const projects = {};
  for (const session of sessions) {
    if (!session.logPath) continue;
    // Extract project path from ~/.claude/projects/<encoded-path>/conversation.jsonl
    const match = session.logPath.match(/[/\\]projects[/\\]([^/\\]+)[/\\]/);
    if (match) {
      const projectKey = match[1];
      if (!projects[projectKey]) {
        projects[projectKey] = { sessions: [], totalEvents: 0, toolFailures: 0 };
      }
      projects[projectKey].sessions.push(session.sessionId);
      projects[projectKey].totalEvents += session.totalEvents || 0;
      projects[projectKey].toolFailures += session.toolFailures?.length || 0;
    }
  }

  return {
    metadata: {
      preprocessorVersion: TOOL_VERSION,
      generatedAt: new Date().toISOString(),
      runScope: determineRunScope(opts, stats, config.scopeDetection),
      logCount: sessions.length,
      eventCount: sessions.reduce((sum, s) => sum + (s.totalEvents || 0), 0),
      sampledEventCount: sessions.reduce((sum, s) => sum + (s.events?.length || 0), 0)
    },
    summary: {
      logsProcessed: sessions.length,
      totalEvents: sessions.reduce((sum, s) => sum + (s.totalEvents || 0), 0),
      sampledEvents: sessions.reduce((sum, s) => sum + (s.events?.length || 0), 0),
      // v1.2.0: Use toolFailuresCount for cached sessions where toolFailures array is null
      toolFailures: sessions.reduce((sum, s) => sum + (s.toolFailures?.length ?? s.toolFailuresCount ?? 0), 0),
      skipped: stats.skipped,
      // v1.4.0: Enhanced processing counters
      logsDiscovered: stats.logsDiscovered || 0,
      logsSkippedIncremental: stats.logsSkippedIncremental || 0,
      logsAttempted: stats.logsAttempted || 0,
      indexHits: stats.indexHits || 0,
      indexMisses: stats.indexMisses || 0,
      sessionsWrittenByMode: stats.sessionsWrittenByMode || { full: 0, cached: 0, fast: 0 },
      // v1.4.0: Run scope for lesson generation guidance
      runScope: determineRunScope(opts, stats, config.scopeDetection),
      runScopeReason: getRunScopeReason(opts, stats, config.scopeDetection),
      // v1.1.0: Tool counters and project grouping
      // v1.5.0: Added transaction metrics and health warnings
      toolStats: {
        toolCallsDetected,
        toolResultsDetected,
        toolFailuresDetected,
        transactionsComplete: totalTxComplete,
        transactionsOrphaned: totalTxOrphaned,
        transactionsOrphanedFailed: totalTxOrphanedFailed,
        callResultRatio: Math.round(callResultRatio * 100) / 100,
        healthWarnings
      },
      projects
    },
    sessions: sessions.map(s => {
      // Derive projectId and sessionFile from logPath (no machine-specific paths)
      let projectId = '';
      let sessionFile = '';
      if (s.logPath) {
        const projMatch = s.logPath.match(/[/\\]projects[/\\]([^/\\]+)[/\\]/);
        if (projMatch) projectId = projMatch[1];
        sessionFile = path.basename(s.logPath || '');
      }
      return {
        sessionId: s.sessionId,
        projectId,
        sessionFile,
        firstTimestamp: s.firstTimestamp || null,
        lastTimestamp: s.lastTimestamp || null,
        eventCount: s.totalEvents || s.eventCount || 0,
        sampledEventCount: s.events?.length || s.sampledEventCount || 0,
        events: s.events,
        toolFailures: s.toolFailures,
        transactions: s.transactions || null,
        evidence: s.evidence,
        mode: s.mode,
        taskPreview: s.taskPreview,
        toolNames: s.toolNames,
        kindsCount: s.kindsCount,
        toolFailuresCount: s.toolFailures?.length ?? s.toolFailuresCount ?? 0
      };
    })
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
    outputDir: null,
    maxLogs: null,
    full: false,
    clear: false,
    dryRun: false,
    verbose: false,
    config: null,
    cursor: null,
    selfTest: false,
    help: false,
    fast: false,
    fullDetail: false,
    audit: false,
    auditFormat: 'json',
    reindex: false,
    indexMax: null,
    indexDays: null,
    // story-miner additions
    scanDir: null,     // --scan-dir: scan output directory for secrets/policy violations
    dedupe: false      // --dedupe: run deterministic deduplication on candidates.jsonl
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
      // v1.1.0: New flags
      case '--fast':
        opts.fast = true;
        break;
      case '--full-detail':
        opts.fullDetail = true;
        break;
      case '--audit':
        opts.audit = true;
        break;
      case '--audit-format':
        const fmt = args[++i];
        if (fmt !== 'json' && fmt !== 'text') {
          throw new Error(`Invalid --audit-format: ${fmt}. Must be 'json' or 'text'.`);
        }
        opts.auditFormat = fmt;
        break;
      // v1.2.0: Index flags
      case '--reindex':
        opts.reindex = true;
        break;
      case '--index-max':
        const maxVal = parseInt(args[++i], 10);
        if (isNaN(maxVal) || maxVal < 50) {
          throw new Error('--index-max requires a number >= 50');
        }
        opts.indexMax = maxVal;
        break;
      case '--index-days':
        const daysVal = parseInt(args[++i], 10);
        if (isNaN(daysVal) || daysVal < 0) {
          throw new Error('--index-days requires a non-negative number');
        }
        opts.indexDays = daysVal;
        break;
      // story-miner additions
      case '--scan-dir':
        opts.scanDir = args[++i];
        break;
      case '--dedupe':
        opts.dedupe = true;
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
story-preprocessor v${TOOL_VERSION} - Pre-process Claude Code session logs for story mining

USAGE:
  node story-preprocessor.cjs [options]

OPTIONS:
  --since, -s <date>   Only logs modified after date
                       Formats: ISO (2026-01-15), relative (7d, 2w, 1m, 24h)

  --output-dir <dir>   Output directory for all generated files
                       Default: ${DEFAULTS.outputDir}
                       Override: STORY_MINER_OUTPUT_DIR env var

  --output, -o <path>  Output file path (deprecated, use --output-dir)

  --max-logs <n>       Max logs to process (default: ${DEFAULTS.maxLogsPerRun})

  --full, -f           Ignore cursor, process all matching logs

  --clear              Delete generated files from output directory

  --dry-run, -n        Show what would be processed (or deleted with --clear)

  --verbose, -v        Show detailed output

  --config, -c <path>  Path to config.json

  --cursor <path>      Path to cursor file

  --fast               Fast-path mode: quick scan (8KB) to detect failures/markers,
                       only deep-process sessions with signals

  --full-detail        Force full processing for all sessions (default behavior)

  --audit              Print tool/event statistics to stdout, skip file output

  --audit-format <fmt> Format for audit output: json (default) or text

INDEX OPTIONS:
  --reindex            Force refresh index for all processed logs
  --index-max <n>      Maximum index entries (default: ${INDEX_DEFAULTS.maxEntries}, min: 50)
  --index-days <n>     Prune entries not accessed within N days (default: ${INDEX_DEFAULTS.maxAgeDays})

STORY-MINER OPTIONS:
  --scan-dir <dir>     Scan all output files for secret leaks and policy violations.
                       Exits 1 if error-severity findings detected.

  --dedupe             Run deterministic deduplication on candidates.jsonl.
                       Requires --output-dir. 100% deterministic (no LLM).

  --self-test          Run built-in tests

  --help, -h           Show this help

CLEAR MODE:
  --clear removes: preprocessed.json, candidates.jsonl, stories.jsonl,
                   stories.md, digest.md, index.json, .stories-cursor.json
  Directory: --output-dir > STORY_MINER_OUTPUT_DIR > config.outputDir > default (${DEFAULTS.outputDir})
  Use --dry-run to preview. Directory must be inside the repository.

EXAMPLES:
  node story-preprocessor.cjs --since 7d
  node story-preprocessor.cjs --full --verbose
  node story-preprocessor.cjs --scan-dir .story-miner/
  node story-preprocessor.cjs --dedupe --output-dir .story-miner/
  node story-preprocessor.cjs --self-test
`);
}

// ============================================================================
// Self-Test Suite
// ============================================================================

async function runSelfTest() {
  console.log(`story-preprocessor v${TOOL_VERSION} - Self-Test\n`);

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

  // Test 7: Tool failure detection (legacy tests with balanced mode for backward compat)
  console.log('\nTool Failure Detection (legacy):');
  const balancedConfig = { mode: 'balanced' };
  assert(isToolFailure({ kind: 'tool_result', exitCode: 1, text: '' }), 'detects non-zero exitCode');
  assert(isToolFailure({ kind: 'tool_result', toolName: 'Bash', exitCode: null, text: 'command not found: xyz' }, balancedConfig), 'balanced: detects error pattern on Bash');
  assert(!isToolFailure({ kind: 'tool_result', exitCode: 0, text: 'success' }), 'ignores successful result');
  assert(!isToolFailure({ kind: 'user', exitCode: 1, text: '' }), 'ignores non-tool events');

  // Test 7b: v1.4.0 Tiered Failure Detection
  console.log('\nTiered Failure Detection (v1.4.0):');
  {
    const strictConfig = { mode: 'strict' };
    const heuristicConfig = { mode: 'heuristic', minBroadMatches: 2 };

    // False positive prevention - Read tool with "error" text
    const readWithError = { kind: 'tool_result', toolName: 'Read', exitCode: 0, text: '// Error handling\nclass ValidationError {}' };
    assert(!isToolFailureV2(readWithError, strictConfig), 'strict: Read with error text NOT failure (exitCode=0)');
    assert(!isToolFailureV2(readWithError, balancedConfig), 'balanced: Read denylisted from regex');

    // Real failure detection - exitCode takes priority
    const bashFail = { kind: 'tool_result', toolName: 'Bash', exitCode: 1, text: 'some output' };
    assert(isToolFailureV2(bashFail, strictConfig), 'strict: exitCode=1 IS failure');

    // exitCode check is robust regardless of kind
    const unknownKindFail = { kind: 'unknown', exitCode: 127, text: 'command not found' };
    assert(isToolFailureV2(unknownKindFail, strictConfig), 'strict: exitCode != 0 detected regardless of kind');

    // Strict mode - no regex fallback
    const bashCmdNotFound = { kind: 'tool_result', toolName: 'Bash', exitCode: null, text: 'command not found: xyz' };
    assert(!isToolFailureV2(bashCmdNotFound, strictConfig), 'strict: no regex fallback');
    assert(isToolFailureV2(bashCmdNotFound, balancedConfig), 'balanced: fatal pattern on Bash');

    // Heuristic mode - broad patterns with threshold
    const singleBroad = { kind: 'tool_result', toolName: 'Bash', exitCode: null, text: 'Output too large saved to file' };
    const doubleBroad = { kind: 'tool_result', toolName: 'Bash', exitCode: null, text: 'Output too large saved to file\nfailed to compile' };
    assert(!isToolFailureV2(singleBroad, heuristicConfig), 'heuristic: 1 broad match < threshold');
    assert(isToolFailureV2(doubleBroad, heuristicConfig), 'heuristic: 2 broad matches >= threshold');
  }

  // Test 7c: Run Scope Detection (v1.4.0)
  console.log('\nRun Scope Detection (v1.4.0):');
  {
    // Full flags trigger 'full' scope
    assert(determineRunScope({ full: true }, {}) === 'full', '--full => full scope');
    assert(determineRunScope({ reindex: true }, {}) === 'full', '--reindex => full scope');
    assert(determineRunScope({ clear: true }, {}) === 'full', '--clear => full scope');

    // Substantial scope when >= threshold new sessions
    const substantialStats = { sessionsWrittenByMode: { full: 10, cached: 5, fast: 0 } };
    assert(determineRunScope({}, substantialStats) === 'substantial', '10 new sessions => substantial');

    // Incremental scope when < threshold new sessions
    const incrementalStats = { sessionsWrittenByMode: { full: 2, cached: 20, fast: 0 } };
    assert(determineRunScope({}, incrementalStats) === 'incremental', '2 new sessions => incremental');

    // Custom threshold
    const customConfig = { incrementalThreshold: 3 };
    assert(determineRunScope({}, incrementalStats, customConfig) === 'incremental', '2 < threshold 3 => incremental');
    const stats3 = { sessionsWrittenByMode: { full: 3, cached: 5, fast: 0 } };
    assert(determineRunScope({}, stats3, customConfig) === 'substantial', '3 >= threshold 3 => substantial');
  }

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
  // v1.1.0: Updated signature with importanceIndices as third parameter
  const indices = computeSampleIndices(100, [50], [], { contextEventsCount: 10, resolutionEventsCount: 10, errorWindowEvents: 5 });
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
  // v1.2.0: readCursor auto-migrates v1 to v2, so check for v2
  assert(cursor && cursor.schemaVersion === 2, 'writes and reads cursor (auto-migrates to v2)');
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

    const testFiles = ['preprocessed.json', 'stories.jsonl'];
    for (const f of testFiles) {
      fs.writeFileSync(path.join(tempDir, f), 'test');
    }

    clearOutputFiles(tempDir, { dryRun: false, verbose: false });
    assert(!fs.existsSync(path.join(tempDir, 'preprocessed.json')), 'clears preprocessed.json');

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
      assert(result.includes('story-preprocessor'), 'runs in ESM host project');
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

      // Verify text was extracted correctly (v1.1.0: text may be in tool_call events too)
      const eventsWithText = result.events.filter(e => e.kind === 'assistant' || e.kind === 'tool_call');
      assert(
        eventsWithText.some(e => e.text && e.text.includes('Response part 1.')),
        'extracts text from content block arrays'
      );
    } else {
      console.log('  [SKIP] array-content.jsonl fixture not found (lessons-extractor fixture)');
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
      console.log('  [SKIP] tool-failures.jsonl fixture not found (lessons-extractor fixture)');
    }
  }

  // v1.1.0: New tests for windowing, tool normalization, fast-path, etc.

  // Test: Hash function determinism
  console.log('\nHash Function (v1.1.0):');
  {
    const line1 = '{"type":"user","content":"test"}';
    const line2 = '{"type":"user","content":"test"}';
    const line3 = '{"type":"user","content":"different"}';
    const hash1 = hashLine(line1);
    const hash2 = hashLine(line2);
    const hash3 = hashLine(line3);
    assert(hash1 === hash2, 'same line produces same hash');
    assert(hash1 !== hash3, 'different lines produce different hashes');
    assert(hash1.length === 16, 'hash is 16 hex chars');
  }

  // Test: Tool call detection with message.content
  console.log('\nTool Call Detection (v1.1.0):');
  {
    const toolCallsArray = { tool_calls: [{ name: 'Read' }] };
    const toolCallsAlt = { toolCalls: [{ name: 'Bash' }] };
    const messageContent = { message: { content: [{ type: 'tool_use', name: 'Grep' }] } };
    const noToolCall = { type: 'assistant', content: 'Just text' };

    assert(detectEventKind(toolCallsArray) === 'tool_call', 'detects tool_calls array');
    assert(detectEventKind(toolCallsAlt) === 'tool_call', 'detects toolCalls array');
    assert(detectEventKind(messageContent) === 'tool_call', 'detects message.content tool_use');
    assert(detectEventKind(noToolCall) === 'assistant', 'does not false-positive on text');
  }

  // Test: normalizeEvent extracts toolName from various sources
  console.log('\nTool Name Extraction (v1.1.0):');
  {
    const fromToolCalls = normalizeEvent({ type: 'assistant', tool_calls: [{ name: 'Read', arguments: { command: 'cat file.txt' } }] });
    const fromMessageContent = normalizeEvent({ message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } });

    assert(fromToolCalls.toolName === 'Read', 'extracts toolName from tool_calls');
    assert(fromMessageContent.toolName === 'Bash', 'extracts toolName from message.content');
    assert(fromMessageContent.command === 'npm test', 'extracts command from input');
  }

  // Test: computeSessionAggregates
  console.log('\nSession Aggregates (v1.1.0):');
  {
    const testEvents = [
      { kind: 'user', text: 'Help me fix the bug in auth.ts' },
      { kind: 'assistant', text: 'I will help you fix the bug.' },
      { kind: 'tool_result', toolName: 'Read', text: 'file contents' },
      { kind: 'tool_result', toolName: 'Edit', text: 'file edited' },
      { kind: 'tool_call', toolName: 'Read', text: null },
      { kind: 'tool_call', toolName: 'Bash', text: null },
      { kind: 'assistant', text: 'Done!' }
    ];

    const aggregates = computeSessionAggregates(testEvents, 200);

    assert(aggregates.firstUserText === 'Help me fix the bug in auth.ts', 'extracts firstUserText');
    assert(aggregates.firstAssistantText === 'I will help you fix the bug.', 'extracts firstAssistantText');
    assert(aggregates.taskPreview === 'Help me fix the bug in auth.ts', 'taskPreview equals firstUserText');
    assert(Array.isArray(aggregates.toolNames), 'toolNames is array');
    assert(aggregates.toolNames.includes('Read'), 'toolNames includes Read');
    assert(aggregates.toolNames.includes('Edit'), 'toolNames includes Edit');
    assert(aggregates.toolNames.includes('Bash'), 'toolNames includes Bash');
    assert(aggregates.kindsCount.user === 1, 'kindsCount.user correct');
    assert(aggregates.kindsCount.assistant === 2, 'kindsCount.assistant correct');
    assert(aggregates.kindsCount.tool_result === 2, 'kindsCount.tool_result correct');
    assert(aggregates.kindsCount.tool_call === 2, 'kindsCount.tool_call correct');
  }

  // Test: Importance markers detection
  console.log('\nImportance Markers (v1.1.0):');
  {
    const planText = 'Here is my PLAN for this task';
    const acText = 'Acceptance Criteria: user can login';
    const filesText = 'Files to modify: src/auth.ts';
    const testPlanText = 'Test plan: 1. unit tests 2. integration';
    const testPassText = 'All tests pass!';
    const buildText = 'Build passes with no errors';
    const commitText = 'Commit: feat(auth): add login';
    const prText = 'Ready for review. PR ready!';
    const normalText = 'Just regular assistant text';

    assert(IMPORTANCE_REGEX.test(planText), 'detects PLAN marker');
    assert(IMPORTANCE_REGEX.test(acText), 'detects Acceptance Criteria');
    assert(IMPORTANCE_REGEX.test(filesText), 'detects Files to modify');
    assert(IMPORTANCE_REGEX.test(testPlanText), 'detects Test plan');
    assert(IMPORTANCE_REGEX.test(testPassText), 'detects tests pass');
    assert(IMPORTANCE_REGEX.test(buildText), 'detects Build passes');
    assert(IMPORTANCE_REGEX.test(commitText), 'detects Commit:');
    assert(IMPORTANCE_REGEX.test(prText), 'detects PR ready');
    assert(!IMPORTANCE_REGEX.test(normalText), 'does not false-positive on normal text');
  }

  // Test: fastPathScan function
  console.log('\nFast Path Scan (v1.1.0):');
  {
    const fixturesDir = path.join(getSkillRoot(), 'fixtures');

    // Test with importance markers fixture
    const markersPath = path.join(fixturesDir, 'importance-markers.jsonl');
    if (fs.existsSync(markersPath)) {
      const markerResult = await fastPathScan(markersPath);
      assert(markerResult.hasImportanceMarkers === true, 'detects importance markers');
      assert(markerResult.needsFullProcessing === true, 'needs full processing with markers');
      assert(markerResult.taskPreview !== null, 'extracts taskPreview');
    }

    // Test with overlapping (small, no failures/markers)
    const overlapPath = path.join(fixturesDir, 'overlapping-events.jsonl');
    if (fs.existsSync(overlapPath)) {
      const overlapResult = await fastPathScan(overlapPath);
      assert(overlapResult.needsFullProcessing === false, 'small file without failures/markers skipped');
    }
  }

  // Test: Config migration
  console.log('\nConfig Migration (v1.1.0):');
  {
    const oldConfig = {
      preprocessor: {
        maxBytesPerLog: 100000,
        maxEventsPerLog: 500,
        contextEventsCount: 15,
        resolutionEventsCount: 15,
        errorWindowEvents: 3
      }
    };

    const migrated = migrateConfig({ ...oldConfig });

    assert(migrated.preprocessor.windowing !== undefined, 'creates windowing object');
    assert(migrated.preprocessor.windowing.headBytes === 60000, 'migrates headBytes (60% of 100000)');
    assert(migrated.preprocessor.windowing.tailBytes === 40000, 'migrates tailBytes (40% of 100000)');
    assert(migrated.preprocessor.windowing.headEvents === 250, 'migrates headEvents (50% of 500)');
    assert(migrated.preprocessor.sampling !== undefined, 'creates sampling object');
    assert(migrated.preprocessor.sampling.contextEvents === 15, 'migrates contextEvents');
    assert(migrated.preprocessor.sampling.errorWindowEvents === 3, 'migrates errorWindowEvents');
  }

  // Test: Sampling with importance indices
  console.log('\nSampling with Importance (v1.1.0):');
  {
    const indices = computeSampleIndices(100, [30], [60], { sampling: { contextEvents: 5, resolutionEvents: 5, errorWindowEvents: 2, importanceWindowEvents: 3 } });
    assert(indices.includes(0) && indices.includes(4), 'includes context (first 5)');
    assert(indices.includes(95) && indices.includes(99), 'includes resolution (last 5)');
    assert(indices.includes(28) && indices.includes(32), 'includes error window around 30');
    assert(indices.includes(57) && indices.includes(63), 'includes importance window around 60');
  }

  // Test: Tool-calls-shapes fixture
  console.log('\nTool Calls Shapes Fixture (v1.1.0):');
  {
    const fixturesDir = path.join(getSkillRoot(), 'fixtures');
    const shapesPath = path.join(fixturesDir, 'tool-calls-shapes.jsonl');
    if (fs.existsSync(shapesPath)) {
      const lines = fs.readFileSync(shapesPath, 'utf-8').split('\n').filter(Boolean);
      const events = lines.map(line => {
        try {
          const raw = JSON.parse(line);
          return normalizeEvent(raw);
        } catch {
          return null;
        }
      }).filter(Boolean);

      const toolCalls = events.filter(e => e.kind === 'tool_call');
      assert(toolCalls.length >= 4, `detects ${toolCalls.length} tool_calls (expected >= 4)`);
      assert(toolCalls.some(tc => tc.toolName === 'Bash'), 'extracts Bash tool');
      assert(toolCalls.some(tc => tc.toolName === 'Read'), 'extracts Read tool');
      assert(toolCalls.some(tc => tc.toolName === 'Grep'), 'extracts Grep from message.content');
    } else {
      console.log('  [SKIP] tool-calls-shapes.jsonl fixture not found (lessons-extractor fixture)');
    }
  }

  // Test: Discovery scalability defaults
  console.log('\nDiscovery Scalability (v1.1.0):');
  {
    assert(DEFAULTS.discovery.maxDepth === 10, 'default maxDepth is 10');
    assert(DEFAULTS.discovery.maxDirectories === 1000, 'default maxDirectories is 1000');
    assert(DEFAULTS.discovery.earlyStopCount === 0, 'default earlyStopCount is 0 (disabled)');
    assert(DEFAULTS.discovery.earlyStopAgeDays === 7, 'default earlyStopAgeDays is 7');
  }

  // Test: Windowing defaults
  console.log('\nWindowing Defaults (v1.1.0):');
  {
    assert(DEFAULTS.windowing.headBytes === 60000, 'default headBytes is 60000');
    assert(DEFAULTS.windowing.tailBytes === 40000, 'default tailBytes is 40000');
    assert(DEFAULTS.windowing.headEvents === 250, 'default headEvents is 250');
    assert(DEFAULTS.windowing.tailEvents === 250, 'default tailEvents is 250');
  }

  // Test: Path redaction (v1.1.1)
  console.log('\nPath Redaction (v1.1.1):');
  {
    const homeDir = os.homedir();
    const testPath = path.join(homeDir, '.claude', 'projects', 'test', 'conversation.jsonl');
    const redacted = redactPath(testPath);
    assert(redacted.startsWith('~'), 'redacts home directory to ~');
    assert(!redacted.includes(homeDir.replace(/\\/g, '/')), 'home dir not in redacted path');
    assert(redacted.includes('.claude/projects'), 'preserves relative path structure');

    // Test non-home paths are unchanged
    const nonHomePath = '/some/other/path.jsonl';
    assert(redactPath(nonHomePath) === nonHomePath, 'non-home paths unchanged');

    // Test null/empty handling
    assert(redactPath(null) === null, 'null returns null');
    assert(redactPath('') === '', 'empty string returns empty');

    // v1.2.0: Index keying collision sanity check
    // Verify that different paths don't collide when used as index keys
    const path1 = path.join(homeDir, '.claude', 'projects', 'repo-a', 'session1.jsonl');
    const path2 = path.join(homeDir, '.claude', 'projects', 'repo-b', 'session1.jsonl');
    const key1 = redactPath(path1);
    const key2 = redactPath(path2);
    assert(key1 !== key2, 'different paths produce different index keys');
    assert(key1.includes('repo-a'), 'path components preserved in key');
    assert(key2.includes('repo-b'), 'path components preserved in key');
  }

  // v1.2.0: Cursor Index Tests

  // Test: Cursor v1 to v2 Migration
  console.log('\nCursor Migration v1→v2 (v1.2.0):');
  {
    const v1 = {
      schemaVersion: 1,
      lastRunAt: '2026-01-20T10:00:00Z',
      lastMtimeCutoffMs: 1705750800000,
      recentFiles: [{ path: '/test/a.jsonl', mtimeMs: 1000, sizeBytes: 100 }]
    };
    const v2 = migrateCursorV1toV2(v1);
    assert(v2.schemaVersion === 2, 'upgrades schemaVersion');
    assert(v2.lastRunAt === v1.lastRunAt, 'preserves lastRunAt');
    assert(v2.recentFiles.length === 1, 'preserves recentFiles');
    assert(typeof v2.index === 'object', 'creates index object');
    assert(v2.indexStats !== undefined, 'creates indexStats');
    assert(v2.indexStats.entryCount === 0, 'indexStats.entryCount starts at 0');
  }

  // Test: Index Entry Validation
  console.log('\nIndex Entry Reuse (v1.2.0):');
  {
    const cursor = {
      schemaVersion: 2,
      index: {
        '~/test.jsonl': { mtimeMs: 1000, sizeBytes: 500, taskPreview: 'test' }
      }
    };
    const validResult = readIndexEntry(cursor, '~/test.jsonl', { mtimeMs: 1000, size: 500 });
    assert(validResult.valid === true, 'validates matching entry');
    assert(validResult.reason === 'hit', 'reports hit reason');

    const staleMtime = readIndexEntry(cursor, '~/test.jsonl', { mtimeMs: 2000, size: 500 });
    assert(staleMtime.valid === false, 'rejects stale mtime');
    assert(staleMtime.reason === 'stale_mtime', 'reports stale_mtime reason');

    const staleSize = readIndexEntry(cursor, '~/test.jsonl', { mtimeMs: 1000, size: 600 });
    assert(staleSize.valid === false, 'rejects stale size');
    assert(staleSize.reason === 'stale_size', 'reports stale_size reason');

    const missing = readIndexEntry(cursor, '~/other.jsonl', { mtimeMs: 1000, size: 500 });
    assert(missing.valid === false, 'rejects missing entry');
    assert(missing.reason === 'miss_not_found', 'reports miss_not_found reason');

    const noCursor = readIndexEntry(null, '~/test.jsonl', { mtimeMs: 1000, size: 500 });
    assert(noCursor.valid === false, 'rejects null cursor');
  }

  // Test: User Fields Preservation
  console.log('\nUser Fields Preservation (v1.2.0):');
  {
    const cursor = {
      schemaVersion: 2,
      index: { '~/test.jsonl': { tags: ['important'], notes: 'Keep this' } }
    };
    writeIndexEntry(cursor, '~/test.jsonl', { taskPreview: 'new', sessionId: 'abc123' }, { mtimeMs: 2000, size: 200 }, 'full', true);
    assert(cursor.index['~/test.jsonl'].taskPreview === 'new', 'updates derived fields');
    assert(cursor.index['~/test.jsonl'].tags[0] === 'important', 'preserves tags');
    assert(cursor.index['~/test.jsonl'].notes === 'Keep this', 'preserves notes');

    // Test with preserveUserFields = false
    const cursor2 = {
      schemaVersion: 2,
      index: { '~/test2.jsonl': { tags: ['old'], notes: 'Old note' } }
    };
    writeIndexEntry(cursor2, '~/test2.jsonl', { taskPreview: 'new2' }, { mtimeMs: 3000, size: 300 }, 'full', false);
    assert(cursor2.index['~/test2.jsonl'].tags.length === 0, 'clears tags when preserveUserFields=false');
    assert(cursor2.index['~/test2.jsonl'].notes === '', 'clears notes when preserveUserFields=false');
  }

  // Test: Index Pruning
  console.log('\nIndex Pruning (v1.2.0):');
  {
    const cursor = { schemaVersion: 2, index: {}, indexStats: {} };
    for (let i = 0; i < 10; i++) {
      cursor.index[`~/file${i}.jsonl`] = { mtimeMs: i * 1000, lastIndexedAt: new Date(i * 10000).toISOString() };
    }
    const result = pruneIndex(cursor, { maxEntries: 5, pruneStrategy: 'lru' });
    assert(result.remaining === 4, 'prunes to 80% of maxEntries (4)');
    assert(cursor.index['~/file9.jsonl'] !== undefined, 'keeps most recent');
    assert(cursor.index['~/file0.jsonl'] === undefined, 'removes oldest');
    assert(cursor.indexStats.lastPrunedAt !== null, 'updates lastPrunedAt');

    // Test that entries with tags are not pruned
    const cursor2 = { schemaVersion: 2, index: {}, indexStats: {} };
    for (let i = 0; i < 10; i++) {
      cursor2.index[`~/file${i}.jsonl`] = {
        mtimeMs: i * 1000,
        lastIndexedAt: new Date(i * 10000).toISOString(),
        tags: i === 0 ? ['important'] : [],
        notes: ''
      };
    }
    const result2 = pruneIndex(cursor2, { maxEntries: 5, pruneStrategy: 'lru' });
    assert(cursor2.index['~/file0.jsonl'] !== undefined, 'preserves entry with tags even if oldest');
  }

  // Test: Deterministic Output
  console.log('\nDeterministic Output (v1.2.0):');
  {
    const cursor1 = { schemaVersion: 2, index: { '~/b.jsonl': { mtimeMs: 2000 }, '~/a.jsonl': { mtimeMs: 1000 } } };
    const cursor2 = { schemaVersion: 2, index: { '~/a.jsonl': { mtimeMs: 1000 }, '~/b.jsonl': { mtimeMs: 2000 } } };
    const json1 = serializeCursorDeterministic(cursor1);
    const json2 = serializeCursorDeterministic(cursor2);
    assert(json1 === json2, 'deterministic regardless of input order');
    assert(json1.indexOf('~/a.jsonl') < json1.indexOf('~/b.jsonl'), 'sorted alphabetically');
  }

  // Test: Cached Session Output Format
  console.log('\nCached Session Format (v1.2.0):');
  {
    const indexEntry = {
      path: '~/test.jsonl',
      mtimeMs: 1000,
      sizeBytes: 500,
      sessionId: 'abc123',
      taskPreview: 'Test task',
      firstUserText: 'First user message',
      firstAssistantText: 'First assistant response',
      toolNames: ['Read', 'Edit'],
      kindsCount: { user: 2, assistant: 2 },
      hasToolFailures: true,
      hasImportanceMarkers: true,
      windowing: { overlapped: true },
      // v1.2.0: Counts for summary stats
      totalEvents: 105,
      toolFailuresCount: 3
    };
    const session = buildCachedSession(indexEntry, { mtimeMs: 1000 });
    assert(session.fromIndex === true, 'marked as from index');
    assert(session.mode === 'cached', 'mode is cached');
    assert(session.events === null, 'events is null for cached');
    assert(session.evidence === null, 'evidence is null for cached');
    assert(session.toolFailures === null, 'toolFailures is null for cached');
    assert(session.taskPreview === 'Test task', 'derived fields populated');
    assert(session.toolNames.length === 2, 'toolNames from index');
    assert(session.sessionId === 'abc123', 'sessionId from index');
    // v1.2.0: Verify counts preserved for summary
    assert(session.totalEvents === 105, 'totalEvents preserved from index');
    assert(session.toolFailuresCount === 3, 'toolFailuresCount preserved from index');
  }

  // Test: INDEX_DEFAULTS
  console.log('\nIndex Defaults (v1.2.0):');
  {
    assert(INDEX_DEFAULTS.maxEntries === 500, 'default maxEntries is 500');
    assert(INDEX_DEFAULTS.maxAgeDays === 30, 'default maxAgeDays is 30');
    assert(INDEX_DEFAULTS.pruneStrategy === 'hybrid', 'default pruneStrategy is hybrid');
    assert(INDEX_DEFAULTS.preserveUserFields === true, 'default preserveUserFields is true');
  }

  // v1.3.0: Content Block Tool Result Tests

  // Test: normalizeToolResults basic explosion
  console.log('\nnormalizeToolResults Basic (v1.3.0):');
  {
    const rawWithResult = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'output text', exit_code: 0 }
        ]
      },
      timestamp: 1234567890,
      sessionId: 'test-session'
    };
    const exploded = normalizeToolResults(rawWithResult);
    assert(Array.isArray(exploded), 'normalizeToolResults returns array');
    assert(exploded.length === 1, 'normalizeToolResults has 1 event');
    assert(exploded[0].kind === 'tool_result', 'normalizeToolResults kind is tool_result');
    assert(exploded[0].text === 'output text', 'normalizeToolResults extracts text');
    assert(exploded[0].exitCode === 0, 'normalizeToolResults extracts exit code');
    assert(exploded[0]._explodedIndex === 0, 'normalizeToolResults sets _explodedIndex');
  }

  // Test: normalizeToolResults with is_error flag
  console.log('\nnormalizeToolResults is_error (v1.3.0):');
  {
    // Test 1: is_error alone (no exit_code)
    const rawWithError = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'Error occurred', is_error: true }
        ]
      }
    };
    const exploded = normalizeToolResults(rawWithError);
    assert(exploded[0].exitCode === 1, 'is_error converts to exitCode 1');

    // Test 2: is_error overrides exit_code: 0 (authoritative)
    const rawWithBothFlags = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't2', content: 'Error but exit 0', exit_code: 0, is_error: true }
        ]
      }
    };
    const exploded2 = normalizeToolResults(rawWithBothFlags);
    assert(exploded2[0].exitCode === 1, 'is_error overrides exit_code: 0');
  }

  // Test: normalizeToolResults maps tool_use_id to toolName
  console.log('\nnormalizeToolResults toolName mapping (v1.3.0):');
  {
    const rawWithToolUse = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_result', tool_use_id: 't1', content: 'file.txt' }
        ]
      }
    };
    const exploded = normalizeToolResults(rawWithToolUse);
    assert(exploded[0].toolName === 'Bash', 'maps toolName from tool_use_id');
  }

  // Test: normalizeToolResults handles array content
  console.log('\nnormalizeToolResults array content (v1.3.0):');
  {
    const rawArrayContent = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: [
            { type: 'text', text: 'Line 1' },
            { type: 'text', text: 'Line 2' }
          ]}
        ]
      }
    };
    const exploded = normalizeToolResults(rawArrayContent);
    assert(exploded[0].text === 'Line 1\nLine 2', 'joins array content with newlines');
  }

  // Test: normalizeToolResults returns null for non-matching
  console.log('\nnormalizeToolResults non-matching (v1.3.0):');
  {
    const rawNoResults = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello' }] }
    };
    assert(normalizeToolResults(rawNoResults) === null, 'returns null for no tool_result blocks');
    assert(normalizeToolResults({ type: 'user', content: 'text' }) === null, 'returns null for non-array content');
    assert(normalizeToolResults({}) === null, 'returns null for empty object');
  }

  // Test: extractToolResultContent
  console.log('\nextractToolResultContent (v1.3.0):');
  {
    // String content
    assert(extractToolResultContent({ content: 'plain text' }) === 'plain text', 'extracts string content');

    // Array of text blocks
    const arrayBlock = { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] };
    assert(extractToolResultContent(arrayBlock) === 'A\nB', 'extracts array content');

    // Object with text property
    assert(extractToolResultContent({ content: { text: 'obj text' } }) === 'obj text', 'extracts object.text');

    // Falls back to output field
    assert(extractToolResultContent({ output: 'from output' }) === 'from output', 'falls back to output field');

    // Empty block
    assert(extractToolResultContent({}) === '', 'empty block returns empty string');
  }

  // ============================================================================
  // v1.5.0 Tests: Tool Transactions
  // ============================================================================

  console.log('\nnormalizeToolCalls toolUseId (v1.5.0):');
  {
    const raw = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_TEST123', name: 'Bash', input: { command: 'echo hi' } }] },
      timestamp: 1700000000
    };
    const hash = 'abc123';
    const result = normalizeToolCalls(raw, hash);
    assert(Array.isArray(result), 'normalizeToolCalls returns array');
    assert(result[0].toolUseId === 'toolu_TEST123', 'preserves tool_use.id as toolUseId');
    assert(result[0]._inputJson !== null, 'includes _inputJson');
    assert(result[0].isError === false, 'isError defaults to false for tool_call');
  }

  console.log('\nnormalizeToolCalls fallback toolUseId (v1.5.0):');
  {
    const raw = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] },  // No id field
      timestamp: 1700000000
    };
    const hash = 'fallback123';
    const result = normalizeToolCalls(raw, hash);
    assert(result[0].toolUseId === 'fallback123-tc0', 'generates fallback toolUseId from lineHash');
  }

  console.log('\nnormalizeToolResults toolUseId (v1.5.0):');
  {
    const raw = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_RES456', content: 'output', exit_code: 0 }] },
      timestamp: 1700000000
    };
    const hash = 'def456';
    const result = normalizeToolResults(raw, hash);
    assert(Array.isArray(result), 'normalizeToolResults returns array');
    assert(result[0].toolUseId === 'toolu_RES456', 'preserves tool_use_id as toolUseId');
  }

  console.log('\nnormalizeToolResults isError preserved (v1.5.0):');
  {
    const raw = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_ERR', content: 'error', is_error: true }] },
      timestamp: 1700000000
    };
    const hash = 'err789';
    const result = normalizeToolResults(raw, hash);
    assert(result[0].isError === true, 'preserves is_error as isError field');
    assert(result[0].exitCode === 1, 'is_error converts to exitCode 1');
  }

  console.log('\nbuildTransactionMap (v1.5.0):');
  {
    const events = [
      { kind: 'tool_call', toolUseId: 'tx1', toolName: 'Bash', command: 'echo hi', _inputJson: '{"command":"echo hi"}' },
      { kind: 'tool_result', toolUseId: 'tx1', toolName: null, exitCode: 0, isError: false }
    ];
    const txMap = buildTransactionMap(events);
    assert(txMap.size === 1, 'creates one transaction');
    const tx = txMap.get('tx1');
    assert(tx.state === 'completed', 'transaction state is completed');
    assert(tx.callEventIndex === 0, 'callEventIndex is correct');
    assert(tx.resultEventIndex === 1, 'resultEventIndex is correct');
    assert(events[1].toolName === 'Bash', 'backfills toolName from call to result');
  }

  console.log('\nbuildTransactionMap orphaned (v1.5.0):');
  {
    const events = [
      { kind: 'tool_result', toolUseId: 'orphan1', toolName: 'Unknown', exitCode: 0, isError: false }
    ];
    const txMap = buildTransactionMap(events);
    const tx = txMap.get('orphan1');
    assert(tx.state === 'orphaned', 'orphaned result has orphaned state');
    assert(tx.callEventIndex === null, 'orphaned has no call index');
  }

  console.log('\nbuildTransactionMap failed (v1.5.0):');
  {
    const events = [
      { kind: 'tool_call', toolUseId: 'fail1', toolName: 'Bash', _inputJson: '{}' },
      { kind: 'tool_result', toolUseId: 'fail1', exitCode: 1, isError: false, text: 'command failed' }
    ];
    const txMap = buildTransactionMap(events);
    const tx = txMap.get('fail1');
    assert(tx.state === 'failed', 'non-zero exitCode marks transaction as failed');
    assert(tx.isFailure === true, 'isFailure is true');
    assert(tx.failureDetails.detectionTier === 'A', 'detectionTier is A');
  }

  console.log('\ncomputeSampleIndices transaction coherence (v1.5.0):');
  {
    const events = [];
    for (let i = 0; i < 100; i++) {
      events.push({ kind: 'user' });
    }
    // Put tool_call at index 5, tool_result at index 95
    events[5] = { kind: 'tool_call', toolUseId: 'coherence_test' };
    events[95] = { kind: 'tool_result', toolUseId: 'coherence_test' };

    const config = { sampling: { contextEvents: 10, resolutionEvents: 5 } };
    const indices = computeSampleIndices(100, [], [], config, events);

    // Context is 0-9, includes index 5 (tool_call)
    assert(indices.includes(5), 'includes tool_call at index 5');
    // Transaction coherence should pull in index 95 (tool_result)
    assert(indices.includes(95), 'includes paired tool_result at index 95 via coherence');
  }

  console.log('\nisToolFailureV3 tier reporting (v1.5.0):');
  {
    const eventIsError = { kind: 'tool_result', isError: true, exitCode: null };
    const result1 = isToolFailureV3(eventIsError);
    assert(result1.isFailure === true, 'is_error triggers failure');
    assert(result1.tier === 'A', 'is_error is tier A');
    assert(result1.pattern === 'is_error', 'pattern is is_error');

    const eventExitCode = { kind: 'tool_result', isError: false, exitCode: 127 };
    const result2 = isToolFailureV3(eventExitCode);
    assert(result2.isFailure === true, 'non-zero exitCode triggers failure');
    assert(result2.tier === 'A', 'exitCode is tier A');
    assert(result2.pattern === 'exit_code:127', 'pattern includes exit code');
  }

  console.log('\nextractToolFailures enhanced (v1.5.0):');
  {
    const events = [
      { kind: 'tool_result', toolUseId: 'fail_extract', toolName: 'Bash', exitCode: 1, isError: false, text: 'error output', timestamp: '2024-01-01' }
    ];
    const txMap = new Map([['fail_extract', { inputSummary: '{"cmd":"test"}' }]]);
    const failures = extractToolFailures(events, txMap, { mode: 'strict' });
    assert(failures.length === 1, 'extracts one failure');
    assert(failures[0].toolUseId === 'fail_extract', 'includes toolUseId');
    assert(failures[0].inputSummary === '{"cmd":"test"}', 'includes inputSummary from transaction');
    assert(failures[0].detectionTier === 'A', 'includes detectionTier');
    assert(failures[0].patternMatched === 'exit_code:1', 'includes patternMatched');
  }

  console.log('\ncomputeToolMetrics (v1.5.0):');
  {
    const events = [
      { kind: 'tool_call' },
      { kind: 'tool_call' },
      { kind: 'tool_result' },
      { kind: 'tool_result' }
    ];
    const txMap = new Map([
      ['tx1', { state: 'completed', isFailure: false }],
      ['tx2', { state: 'failed', isFailure: true }]
    ]);
    const metrics = computeToolMetrics(events, txMap);
    assert(metrics.toolCallsDetected === 2, 'counts tool calls');
    assert(metrics.toolResultsDetected === 2, 'counts tool results');
    assert(metrics.transactionsComplete === 2, 'counts complete transactions (includes failed)');
    assert(metrics.callResultRatio === 1, 'ratio is 1.0 when equal');
  }

  console.log('\ntransaction-complete fixture (v1.5.0):');
  {
    const fixturePath = path.join(getSkillRoot(), 'fixtures', 'transaction-complete.jsonl');
    if (fs.existsSync(fixturePath)) {
      const result = await processLogFile(fixturePath, { ...DEFAULTS }, [], { mode: 'strict' });
      assert(result.txStats.complete >= 3, 'fixture has 3+ complete transactions');
      assert(result.txStats.orphaned === 0, 'fixture has no orphaned transactions');
    } else {
      console.log('  [SKIP] fixture not found');
    }
  }

  console.log('\ntransaction-orphaned fixture (v1.5.0):');
  {
    const fixturePath = path.join(getSkillRoot(), 'fixtures', 'transaction-orphaned.jsonl');
    if (fs.existsSync(fixturePath)) {
      const result = await processLogFile(fixturePath, { ...DEFAULTS }, [], { mode: 'strict' });
      assert(result.txStats.orphaned >= 2, 'fixture has 2+ orphaned transactions');
      assert(result.txStats.orphanedFailed >= 1, 'fixture has 1+ orphaned transactions with failures');
    } else {
      console.log('  [SKIP] fixture not found');
    }
  }

  console.log('\nis-error-precedence fixture (v1.5.0):');
  {
    const fixturePath = path.join(getSkillRoot(), 'fixtures', 'is-error-precedence.jsonl');
    if (fs.existsSync(fixturePath)) {
      const result = await processLogFile(fixturePath, { ...DEFAULTS }, [], { mode: 'strict' });
      // Should have 1 failure detected via is_error even though exit_code was 0
      assert(result.toolFailures.length >= 1, 'detects failure via is_error');
      assert(result.toolFailures[0].isError === true, 'failure has isError=true');
      assert(result.toolFailures[0].detectionTier === 'A', 'failure is tier A');
    } else {
      console.log('  [SKIP] fixture not found');
    }
  }

  // ============================================================================
  // Story-Miner Specific Tests
  // ============================================================================

  // Test: Story Signal Detection
  console.log('\nStory Signal Detection (story-miner):');
  {
    const signals1 = detectStorySignals('I found the root cause of the bug');
    assert(signals1.includes('root_cause'), 'detects root_cause signal');

    const signals2 = detectStorySignals('Turns out there was a subtle interaction between grep and set -e');
    assert(signals2.includes('twist'), 'detects twist signal');
    assert(signals2.includes('subtle_interaction'), 'detects subtle_interaction signal');

    const signals3 = detectStorySignals('The fix was to add || true to the grep command');
    assert(signals3.includes('fix_description'), 'detects fix_description signal');

    const signals4 = detectStorySignals('This is a normal user message about adding logging');
    assert(signals4.length === 0, 'no signals for generic text');

    const signals5 = detectStorySignals('The issue was in the extractText function');
    assert(signals5.includes('root_cause'), 'detects "the issue was" as root_cause');

    const signals6 = detectStorySignals(null);
    assert(signals6.length === 0, 'handles null input');

    const signals7 = detectStorySignals('');
    assert(signals7.length === 0, 'handles empty string');

    const signals8 = detectStorySignals('edge case with workaround');
    assert(signals8.includes('edge_case'), 'detects edge_case signal');
    assert(signals8.includes('technique'), 'detects technique (workaround) signal');
  }

  // Test: Content Hash Determinism
  console.log('\nContent Hash (story-miner):');
  {
    const hash1 = computeContentHash16('test content for hashing');
    const hash2 = computeContentHash16('test content for hashing');
    const hash3 = computeContentHash16('different content');
    assert(hash1 === hash2, 'same content produces same hash');
    assert(hash1 !== hash3, 'different content produces different hash');
    assert(hash1.length === 16, 'hash is 16 hex chars');
    assert(/^[0-9a-f]{16}$/.test(hash1), 'hash is valid hex');

    const hashNull = computeContentHash16(null);
    assert(hashNull === '0000000000000000', 'null input returns zero hash');

    // First 400 chars only
    const longText = 'a'.repeat(1000);
    const hashLong = computeContentHash16(longText);
    const hashShort = computeContentHash16('a'.repeat(400));
    assert(hashLong === hashShort, 'truncates to first 400 chars');
  }

  // Test: Provenance Pointer
  console.log('\nProvenance Pointer (story-miner):');
  {
    const prov = computeProvenance('session-123', 42, 'test text');
    assert(prov.sessionId === 'session-123', 'preserves sessionId');
    assert(prov.lineIndex === 42, 'preserves lineIndex');
    assert(prov.contentHash16.length === 16, 'contentHash16 is 16 chars');
    assert(/^[0-9a-f]{16}$/.test(prov.contentHash16), 'contentHash16 is valid hex');
    assert(prov.pointer === `session-123/42#${prov.contentHash16}`, 'pointer string is well-formed');

    // Deterministic
    const prov2 = computeProvenance('session-123', 42, 'test text');
    assert(prov.contentHash16 === prov2.contentHash16, 'provenance is deterministic');
    assert(prov.pointer === prov2.pointer, 'pointer is deterministic');
  }

  // Test: Extended Redaction Patterns
  console.log('\nExtended Redaction (story-miner):');
  {
    const { regexes } = compileRedactions(DEFAULT_REDACT_PATTERNS);
    assert(regexes.length >= 17, `compiled ${regexes.length} patterns (expected >= 17)`);

    // Test GitHub PAT
    const ghp = applyRedaction({ text: 'token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789' }, regexes);
    assert(ghp.text.includes('[REDACTED]'), 'redacts GitHub PAT');

    // Test API key
    const sk = applyRedaction({ text: 'key: sk-AbCdEfGhIjKlMnOpQrStUv' }, regexes);
    assert(sk.text.includes('[REDACTED]'), 'redacts sk- API key');

    // Test JWT
    const jwt = applyRedaction({ text: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0' }, regexes);
    assert(jwt.text.includes('[REDACTED]'), 'redacts JWT token');

    // Test AWS key
    const aws = applyRedaction({ text: 'AKIAIOSFODNN7EXAMPLE' }, regexes);
    assert(aws.text.includes('[REDACTED]'), 'redacts AWS access key');

    // Test connection string
    const conn = applyRedaction({ text: 'postgres://user:pass@host:5432/db' }, regexes);
    assert(conn.text.includes('[REDACTED]'), 'redacts connection string');

    // Test auth header
    const auth = applyRedaction({ text: 'Authorization: Bearer sk-test-key-value-12345' }, regexes);
    assert(auth.text.includes('[REDACTED]'), 'redacts auth header');
  }

  // Test: Miner Session Detection
  console.log('\nMiner Session Detection (story-miner):');
  {
    const minerEvents = [
      { kind: 'user', text: '<command-name>/story-miner</command-name>', _fromWindow: 'head' }
    ];
    assert(isMinerSession(minerEvents), 'detects story-miner command marker');

    const normalEvents = [{ kind: 'user', text: 'Help me fix a bug', _fromWindow: 'head' }];
    assert(!isMinerSession(normalEvents), 'allows normal sessions');
  }

  // Test: Tail Window Line Index Correctness (story-miner)
  console.log('\nTail Window Line Indices (story-miner):');
  {
    // Create a temp JSONL file with known lines and verify tail window indices
    const tempFile = path.join(process.cwd(), '.test-tail-lines-' + Date.now() + '.jsonl');
    const lines = [];
    for (let i = 0; i < 10; i++) {
      // Use top-level content field (not message.content) to avoid normalizeToolCalls string filter issue
      lines.push(JSON.stringify({ type: 'user', content: `Line ${i} content padding to ensure sufficient length` }));
    }
    fs.writeFileSync(tempFile, lines.join('\n') + '\n');

    try {
      // Read the full file to know byte offsets
      const fileContent = fs.readFileSync(tempFile, 'utf-8');
      const fileLines = fileContent.split('\n').filter(Boolean);

      // Compute byte offset to middle of line 5 (guaranteed mid-line)
      let byteOffset = 0;
      for (let i = 0; i < 5; i++) {
        byteOffset += Buffer.byteLength(fileLines[i], 'utf-8') + 1; // +1 for \n
      }
      const midLineOffset = byteOffset + 10; // 10 bytes into line 5

      // Verify countLinesUpTo returns 5 (5 newlines before midLineOffset)
      const lineCount = countLinesUpTo(tempFile, midLineOffset);
      assert(lineCount === 5, `countLinesUpTo at mid-line-5 returns ${lineCount} (expected 5)`);

      // Read tail from mid-line position
      const { regexes: noRedact } = compileRedactions([]);
      const tailResult = await readTailWindow(tempFile, midLineOffset, 100000, 100, noRedact, lineCount);

      // Line 5 should be skipped (partial), first event should be line 6
      assert(tailResult.events.length > 0, 'tail window has events');
      assert(tailResult.events[0]._sourceLineIndex === 6, `first tail event lineIndex is ${tailResult.events[0]._sourceLineIndex} (expected 6)`);

      // Verify sequential indices
      for (let i = 1; i < tailResult.events.length; i++) {
        const prev = tailResult.events[i - 1]._sourceLineIndex;
        const curr = tailResult.events[i]._sourceLineIndex;
        assert(curr > prev, `tail event indices are sequential: ${prev} < ${curr}`);
      }

      // Also test reading from exact line boundary (start of line 5)
      const tailFromBoundary = await readTailWindow(tempFile, byteOffset, 100000, 100, noRedact, 5);
      assert(tailFromBoundary.events.length > 0, 'boundary tail has events');
      assert(tailFromBoundary.events[0]._sourceLineIndex === 5, `boundary first event lineIndex is ${tailFromBoundary.events[0]._sourceLineIndex} (expected 5)`);
    } finally {
      fs.rmSync(tempFile, { force: true });
    }
  }

  // Test: Output Scanner
  console.log('\nOutput Scanner (story-miner):');
  {
    const tempDir = path.join(process.cwd(), '.test-scanner-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    // Clean file
    fs.writeFileSync(path.join(tempDir, 'clean.json'), '{"text": "safe content"}');
    const cleanResult = scanDirectory(tempDir);
    assert(cleanResult.clean === true, 'clean file passes scan');

    // File with secret
    fs.writeFileSync(path.join(tempDir, 'dirty.json'), '{"key": "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789Ab"}');
    const dirtyResult = scanDirectory(tempDir);
    assert(dirtyResult.clean === false, 'detects GitHub PAT in file');
    assert(dirtyResult.errorCount >= 1, 'counts error finding');

    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // Test: Key Term Extraction
  console.log('\nKey Term Extraction (story-miner):');
  {
    const terms1 = extractKeyTerms('The extractText() function in lessons-preprocessor.cjs failed with TypeError');
    assert(terms1.includes('extracttext'), 'extracts function name');
    assert(terms1.some(t => t.includes('lessons-preprocessor.cjs')), 'extracts file path');
    assert(terms1.includes('typeerror'), 'extracts error class');

    const terms2 = extractKeyTerms('');
    assert(terms2.length === 0, 'empty input returns empty array');

    const terms3 = extractKeyTerms(null);
    assert(terms3.length === 0, 'null input returns empty array');
  }

  // Test: Dedupe Clustering
  console.log('\nDedupe Clustering (story-miner):');
  {
    const candidates = [
      {
        candidateId: 'cand-001',
        sessionId: 'sess-a',
        status: 'promoted',
        title: 'extractText array bug',
        synopsis: 'The extractText() function crashes when applyRedaction() receives arrays',
        eventIndices: [0],
        firstTimestamp: '2026-01-25T15:00:00.000Z',
        score: 0.9
      },
      {
        candidateId: 'cand-002',
        sessionId: 'sess-b',
        status: 'promoted',
        title: 'extractText returns array',
        synopsis: 'applyRedaction() fails because extractText() returns raw content blocks instead of strings',
        eventIndices: [0],
        firstTimestamp: '2026-01-26T09:00:00.000Z',
        score: 0.8
      },
      {
        candidateId: 'cand-003',
        sessionId: 'sess-c',
        status: 'rejected',
        title: 'Add logging',
        synopsis: 'Generic logging task',
        eventIndices: [0],
        score: 0.2
      }
    ];

    const preprocessed = {
      sessions: [
        { sessionId: 'sess-a', events: [{ text: 'extractText() function applyRedaction() TypeError in lessons-preprocessor.cjs' }] },
        { sessionId: 'sess-b', events: [{ text: 'extractText() returns array applyRedaction() fails lessons-preprocessor.cjs TypeError' }] },
        { sessionId: 'sess-c', events: [{ text: 'Add logging statements' }] }
      ]
    };

    const { clusters, updatedCandidates } = buildDedupeClusters(candidates, preprocessed, { minRareTermOverlap: 3 });
    const clusterCount = Object.keys(clusters).length;
    assert(clusterCount >= 1, `formed ${clusterCount} cluster(s) (expected >= 1)`);

    // Check that cand-001 and cand-002 are in same cluster
    const cand1 = updatedCandidates.find(c => c.candidateId === 'cand-001');
    const cand2 = updatedCandidates.find(c => c.candidateId === 'cand-002');
    if (cand1.dedupeClusterId && cand2.dedupeClusterId) {
      assert(cand1.dedupeClusterId === cand2.dedupeClusterId, 'similar candidates share cluster');
    }

    // Check that rejected candidate is not clustered
    const cand3 = updatedCandidates.find(c => c.candidateId === 'cand-003');
    assert(!cand3.dedupeClusterId, 'rejected candidates not clustered');

    // Check primary selection (earlier timestamp wins)
    if (cand1.dedupeClusterId) {
      assert(cand1.status !== 'deduped', 'earlier candidate is primary');
    }
  }

  // Test: Banned Phrases
  console.log('\nBanned Phrases (story-miner):');
  {
    assert(DEFAULT_BANNED_PHRASES.includes('best practice'), 'includes "best practice"');
    assert(DEFAULT_BANNED_PHRASES.includes('always write tests'), 'includes "always write tests"');
    assert(DEFAULT_BANNED_PHRASES.length >= 10, `has ${DEFAULT_BANNED_PHRASES.length} phrases (expected >= 10)`);
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

    // Resolve output directory: CLI --output-dir > env var > config.outputDir > default
    const repoRoot = findRepoRoot(process.cwd());
    let outputDir = expandPath(
      opts.outputDir || process.env.STORY_MINER_OUTPUT_DIR || config.outputDir || DEFAULTS.outputDir
    );
    if (!path.isAbsolute(outputDir)) {
      outputDir = path.join(repoRoot, outputDir);
    }
    log('verbose', `Repo root: ${repoRoot}`);
    log('verbose', `Output directory: ${outputDir}`);

    // Handle --scan-dir mode (story-miner addition)
    if (opts.scanDir) {
      const scanPath = path.isAbsolute(opts.scanDir) ? opts.scanDir : path.join(repoRoot, opts.scanDir);
      const bannedPhrases = (config.storyMiner && config.storyMiner.bannedPhrases) || DEFAULT_BANNED_PHRASES;
      const result = scanDirectory(scanPath, [], bannedPhrases);
      console.log(JSON.stringify(result, null, 2));
      if (!result.clean) {
        log('error', `Scanner found ${result.errorCount} error(s) and ${result.warnCount} warning(s)`);
        for (const f of result.findings) {
          const prefix = f.severity === 'error' ? '[ERROR]' : '[WARN]';
          log(f.severity === 'error' ? 'error' : 'warn', `${prefix} ${f.file}: ${f.pattern} - ${f.matchPreview}`);
        }
      }
      process.exit(result.errorCount > 0 ? 1 : 0);
    }

    // Handle --dedupe mode (story-miner addition)
    if (opts.dedupe) {
      const dedupeConfig = (config.storyMiner && config.storyMiner.dedupe) || {};
      runDedupeMode(outputDir, dedupeConfig);
      process.exit(0);
    }

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

    // Load cursor (unless --full, but always load for --reindex to preserve user fields)
    let cursor = null;
    const cursorPath = opts.cursor || path.join(outputDir, config.cursorFile || DEFAULTS.cursorFile);
    if (!opts.full || opts.reindex) {
      cursor = readCursor(cursorPath);
      if (cursor) {
        log('verbose', `Loaded cursor from: ${cursorPath} (v${cursor.schemaVersion || 1})`);
        if (cursor.schemaVersion === 2 && cursor.index) {
          log('verbose', `  Index entries: ${Object.keys(cursor.index).length}`);
        }
      }
    }

    // Initialize cursor if needed (for index tracking)
    if (!cursor) {
      cursor = {
        schemaVersion: 2,
        lastRunAt: null,
        lastMtimeCutoffMs: 0,
        recentFiles: [],
        index: {},
        indexStats: { entryCount: 0, oldestEntryAt: null, newestEntryAt: null, lastPrunedAt: null }
      };
    }

    // Build index config from CLI + config + defaults
    const indexConfig = {
      maxEntries: opts.indexMax ?? config.indexing?.maxEntries ?? INDEX_DEFAULTS.maxEntries,
      maxAgeDays: opts.indexDays ?? config.indexing?.maxAgeDays ?? INDEX_DEFAULTS.maxAgeDays,
      pruneStrategy: config.indexing?.pruneStrategy ?? INDEX_DEFAULTS.pruneStrategy,
      preserveUserFields: config.indexing?.preserveUserFields ?? INDEX_DEFAULTS.preserveUserFields
    };

    // Discover logs (v1.1.0: includes discovery scalability options)
    const allLogs = discoverLogs({
      logDir: config.logGlob || DEFAULTS.logGlob,
      since: opts.since,
      maxLogs: config.maxLogsPerRun,
      followSymlinks: config.followSymlinks,
      discovery: config.discovery || {}
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

    // v1.4.0: Initialize failure detection config (defaults to strict mode)
    const detectionConfig = {
      mode: 'strict',
      ...(config.failureDetection || {})
    };

    // Process each log
    const sessions = [];
    const stats = {
      // v1.4.0: Enhanced discovery/processing counters
      logsDiscovered: allLogs.length,
      logsSkippedIncremental: allLogs.length - logsToProcess.length,  // Renamed from 'unchanged'

      skipped: {
        extractorSessions: 0,
        fastPathSkipped: 0  // v1.1.0: Sessions skipped by fast-path mode
      },
      // v1.2.0: Index tracking
      indexHits: 0,
      indexMisses: 0,
      // Run-level error tracking for cursor gating
      logsAttempted: 0,
      logsSucceeded: 0,
      logsFailed: 0,
      processingErrors: [],

      // v1.4.0: Mode breakdown for written sessions
      sessionsWrittenByMode: { full: 0, cached: 0, fast: 0 }
    };

    for (const logFile of logsToProcess) {
      log('verbose', `Processing: ${logFile.path}`);
      stats.logsAttempted++;

      const normalizedPath = redactPath(logFile.path);
      const fileStats = { mtimeMs: logFile.mtimeMs, size: logFile.size };

      try {
        // v1.2.0: Check index for cached entry (unless --full or --reindex)
        if (!opts.full && !opts.reindex) {
          const indexResult = readIndexEntry(cursor, normalizedPath, fileStats);
          if (indexResult.valid) {
            // Index hit: use cached session
            const cachedSession = buildCachedSession(indexResult.entry, fileStats);
            sessions.push(cachedSession);
            stats.sessionsWrittenByMode.cached++;  // v1.4.0
            stats.indexHits++;
            stats.logsSucceeded++;
            log('verbose', `  Index hit: reusing cached metadata`);
            continue;
          }
          stats.indexMisses++;
          log('verbose', `  Index ${indexResult.reason}: full processing`);
        } else {
          stats.indexMisses++;
        }

        // v1.1.0: Fast-path mode - quick scan to detect if full processing needed
        if (opts.fast && !opts.fullDetail) {
          const fastResult = await fastPathScan(logFile.path);
          if (!fastResult.needsFullProcessing) {
            // Skip deep processing, add minimal session entry
            const fastSession = {
              sessionId: fastResult.sessionId || path.basename(logFile.path, '.jsonl'),
              logPath: normalizedPath,
              mtime: logFile.mtime.toISOString(),
              mode: 'fast',
              taskPreview: fastResult.taskPreview,
              hasToolFailures: fastResult.hasToolFailures,
              hasImportanceMarkers: fastResult.hasImportanceMarkers,
              // Minimal data - no deep processing
              totalEvents: 0,
              events: [],
              toolFailures: [],
              toolNames: [],
              kindsCount: {}
            };
            sessions.push(fastSession);
            stats.sessionsWrittenByMode.fast++;  // v1.4.0

            // v1.2.0: Write lightweight index entry for fast-path
            writeIndexEntry(cursor, normalizedPath, fastSession, fileStats, 'fast', indexConfig.preserveUserFields);

            stats.skipped.fastPathSkipped++;
            stats.logsSucceeded++;
            log('verbose', `  Fast-path: skipped (no failures/markers)`);
            continue;
          }
          log('verbose', `  Fast-path: needs full processing (${fastResult.reason})`);
        }

        const result = await processLogFile(logFile.path, processConfig, compiledRedactions, detectionConfig);

        // Skip extractor sessions
        if (result.isExtractorSession && (config.skipExtractorSessions ?? DEFAULTS.skipExtractorSessions)) {
          log('verbose', `  Skipping extractor session`);
          stats.skipped.extractorSessions++;
          stats.logsSucceeded++;
          continue;
        }

        // Skip miner sessions (story-miner addition)
        if (result.isMinerSession && (config.skipMinerSessions ?? DEFAULTS.skipMinerSessions)) {
          log('verbose', `  Skipping miner session`);
          stats.skipped.minerSessions = (stats.skipped.minerSessions || 0) + 1;
          stats.logsSucceeded++;
          continue;
        }

        const fullSession = {
          ...result,
          logPath: normalizedPath,
          mtime: logFile.mtime.toISOString(),
          mode: 'full',
          fromIndex: false
        };
        sessions.push(fullSession);
        stats.sessionsWrittenByMode.full++;  // v1.4.0

        // v1.2.0: Write index entry for fully processed session
        writeIndexEntry(cursor, normalizedPath, result, fileStats, 'full', indexConfig.preserveUserFields);

        stats.logsSucceeded++;
        log('verbose', `  Events: ${result.totalEvents} total, ${result.events.length} sampled, ${result.toolFailures.length} failures`);
      } catch (err) {
        stats.logsFailed++;
        stats.processingErrors.push({ path: logFile.path, error: err.message });
        log('warn', `  Error processing: ${err.message}`);
      }
    }

    // Generate output (v1.4.0: pass opts for runScope detection)
    const output = generateOutput(sessions, stats, config, opts);

    // v1.1.0: Audit mode - print stats to stdout and exit (no file writes)
    if (opts.audit) {
      const auditData = {
        summary: output.summary,
        logsFound: allLogs.length,
        logsProcessed: logsToProcess.length,
        sessionsWritten: sessions.length,
        stats: {
          logsAttempted: stats.logsAttempted,
          logsSucceeded: stats.logsSucceeded,
          logsFailed: stats.logsFailed,
          fastPathSkipped: stats.skipped.fastPathSkipped,
          extractorSessionsSkipped: stats.skipped.extractorSessions,
          // v1.2.0: Index stats
          indexHits: stats.indexHits,
          indexMisses: stats.indexMisses,
          indexEntries: Object.keys(cursor?.index || {}).length
        }
      };

      if (opts.auditFormat === 'text') {
        console.log('=== Story Preprocessor Audit ===\n');
        console.log(`Logs found:              ${auditData.logsFound}`);
        console.log(`Logs processed:          ${auditData.logsProcessed}`);
        console.log(`Sessions written:        ${auditData.sessionsWritten}`);
        console.log(`Logs succeeded:          ${auditData.stats.logsSucceeded}`);
        console.log(`Logs failed:             ${auditData.stats.logsFailed}`);
        console.log(`Fast-path skipped:       ${auditData.stats.fastPathSkipped}`);
        console.log(`Extractor sessions:      ${auditData.stats.extractorSessionsSkipped}`);
        console.log(`Index hits:              ${auditData.stats.indexHits}`);
        console.log(`Index misses:            ${auditData.stats.indexMisses}`);
        console.log(`Index entries:           ${auditData.stats.indexEntries}`);
        console.log('');
        console.log('--- Summary ---');
        console.log(`Total events:            ${auditData.summary.totalEvents}`);
        console.log(`Sampled events:          ${auditData.summary.sampledEvents}`);
        console.log(`Tool failures:           ${auditData.summary.toolFailures}`);
        console.log('');
        console.log('--- Tool Stats ---');
        console.log(`Tool calls detected:     ${auditData.summary.toolStats?.toolCallsDetected || 0}`);
        console.log(`Tool results detected:   ${auditData.summary.toolStats?.toolResultsDetected || 0}`);
        console.log(`Tool failures detected:  ${auditData.summary.toolStats?.toolFailuresDetected || 0}`);
        console.log('');
        console.log('--- Projects ---');
        const projects = auditData.summary.projects || {};
        for (const [key, val] of Object.entries(projects)) {
          console.log(`  ${key}: ${val.sessions?.length || 0} sessions, ${val.totalEvents || 0} events, ${val.toolFailures || 0} failures`);
        }
      } else {
        console.log(JSON.stringify(auditData, null, 2));
      }
      process.exit(0);
    }

    // Write output
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
    log('success', `Output written to: ${outputPath}`);

    // Write cursor (only on successful runs)
    let cursorWritten = false;
    let indexPruned = { pruned: 0, remaining: 0 };
    if (!opts.dryRun) {
      const cursorDecision = shouldWriteCursor(stats, sessions.length, allLogs.length);

      if (cursorDecision.write) {
        // v1.2.0: Prune index before writing
        indexPruned = pruneIndex(cursor, indexConfig);
        if (indexPruned.pruned > 0) {
          log('verbose', `Index pruned: ${indexPruned.pruned} entries removed, ${indexPruned.remaining} remaining`);
        }

        // Update cursor metadata
        cursor.schemaVersion = 2;
        cursor.lastRunAt = new Date().toISOString();
        cursor.lastMtimeCutoffMs = Math.max(...logsToProcess.map(f => f.mtimeMs), cursor.lastMtimeCutoffMs || 0);

        // Update recentFiles (maintain backward compatibility for incremental detection)
        cursor.recentFiles = logsToProcess
          .slice(0, config.maxRecentFiles || DEFAULTS.maxRecentFiles)
          .map(f => ({ path: f.path, mtimeMs: f.mtimeMs, sizeBytes: f.size }));

        // Update indexStats
        cursor.indexStats = cursor.indexStats || {};
        cursor.indexStats.entryCount = Object.keys(cursor.index || {}).length;

        // Write cursor atomically
        atomicWriteCursor(cursorPath, cursor);
        cursorWritten = true;
        log('verbose', `Cursor updated: ${cursorPath}`);
      } else {
        log('warn', `Cursor NOT updated: ${cursorDecision.reason}`);
      }
    }

    // Summary (v1.4.0: Enhanced reporting)
    log('info', `Processing summary:`);
    log('info', `  Logs discovered:       ${stats.logsDiscovered}`);
    if (stats.logsSkippedIncremental > 0) {
      log('info', `  Skipped unchanged:     ${stats.logsSkippedIncremental}  (incremental cursor)`);
    }
    log('info', `  Logs attempted:        ${stats.logsAttempted}`);
    log('info', `  Logs succeeded:        ${stats.logsSucceeded}`);
    if (stats.logsFailed > 0) {
      log('warn', `  Logs failed:           ${stats.logsFailed}`);
    }
    // v1.2.0: Index stats
    if (stats.indexHits > 0 || stats.indexMisses > 0) {
      log('info', `  Index hits:            ${stats.indexHits}   Misses: ${stats.indexMisses}`);
    }
    // v1.4.0: Mode breakdown
    const { full, cached, fast } = stats.sessionsWrittenByMode;
    log('info', `  Sessions written:      ${sessions.length}  (full: ${full}, cached: ${cached}, fast: ${fast})`);
    log('info', `  Total events:          ${output.summary.totalEvents}`);
    log('info', `  Sampled events:        ${output.summary.sampledEvents}`);
    log('info', `  Tool failures:         ${output.summary.toolFailures}`);
    if (stats.skipped.extractorSessions > 0) {
      log('info', `  Skipped extractor:     ${stats.skipped.extractorSessions}`);
    }
    if (indexPruned.pruned > 0) {
      log('info', `  Index pruned:          ${indexPruned.pruned} old entries removed`);
    }
    log('info', `  Cursor written:        ${cursorWritten ? 'Yes' : 'No'}`);
    // v1.4.0: Run scope for lesson generation
    log('info', `  Run scope:             ${output.summary.runScope}  (${output.summary.runScopeReason})`);

  } catch (err) {
    log('error', err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
