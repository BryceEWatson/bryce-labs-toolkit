#!/usr/bin/env node
/**
 * test-parser.js - Tests for parse-transcripts.js
 *
 * Run with: node tests/test-parser.js
 * Exit code: 0 on all pass, 1 on any failure.
 * No external dependencies — uses Node.js built-in assert module.
 */

const assert = require('assert');
const path = require('path');

const {
  parseSession,
  extractSummary,
  extractWrites,
  extractCosts,
  extractToolUsage,
  findSessionDirs,
  decodeProjectPath,
  getClaudeHome,
} = require(path.join(__dirname, '..', 'tools', 'parse-transcripts.js'));

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'test-session.jsonl');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

console.log('\nparse-transcripts.js test suite\n');

// --- parseSession ---

const records = parseSession(FIXTURE_PATH);

test('parseSession: returns correct number of records', () => {
  assert.strictEqual(records.length, 6, `Expected 6 records, got ${records.length}`);
});

test('parseSession: first record is a user message', () => {
  assert.strictEqual(records[0].type, 'user');
});

test('parseSession: handles non-existent file gracefully', () => {
  const result = parseSession(path.join(__dirname, 'nonexistent.jsonl'));
  assert.strictEqual(result.length, 0);
});

// --- extractSummary ---

const fileInfo = {
  path: FIXTURE_PATH,
  sessionId: 'test-session-001',
  mtime: new Date('2026-03-10T14:00:00.000Z'),
  size: 1234,
};

const summary = extractSummary(records, fileInfo);

test('extractSummary: correct user message count (excludes sidechain)', () => {
  // 2 user messages (records 0 and 3), neither is sidechain
  assert.strictEqual(summary.userMessages, 2);
});

test('extractSummary: correct assistant message count (excludes sidechain)', () => {
  // Records 1, 2 are main-chain assistant messages
  // Record 4 is sidechain (excluded), record 5 is API error (not sidechain but is assistant)
  // extractSummary filters by !isSidechain — record 5 has isApiErrorMessage but no isSidechain
  assert.strictEqual(summary.assistantMessages, 3);
});

test('extractSummary: extracts topic from first user message', () => {
  assert.ok(summary.topic.includes('greeting'), `Topic should mention greeting: ${summary.topic}`);
});

test('extractSummary: detects model', () => {
  assert.ok(summary.models.includes('claude-sonnet-4-6-20260310'), `Models: ${summary.models}`);
});

test('extractSummary: calculates duration', () => {
  assert.ok(summary.durationMs > 0, `Duration should be > 0: ${summary.durationMs}`);
});

test('extractSummary: detects git branch', () => {
  assert.ok(summary.gitBranches.includes('feature/greeting'));
});

test('extractSummary: counts tool calls (excludes sidechain)', () => {
  // Records 1 (Write) and 2 (Read) are main-chain, record 4 (Glob) is sidechain
  // Record 5 has no tool_use
  assert.strictEqual(summary.toolCallCount, 2);
});

test('extractSummary: includes sessionId from fileInfo', () => {
  assert.strictEqual(summary.sessionId, 'test-session-001');
});

// --- extractWrites ---

const writes = extractWrites(records);

test('extractWrites: finds Write tool call', () => {
  assert.strictEqual(writes.length, 1, `Expected 1 write, got ${writes.length}`);
});

test('extractWrites: correct file path', () => {
  assert.strictEqual(writes[0].filePath, 'src/utils.js');
});

test('extractWrites: correct tool name', () => {
  assert.strictEqual(writes[0].tool, 'Write');
});

test('extractWrites: excludes sidechain writes', () => {
  // Record 4 is sidechain with a Glob call (not a write, but verifies filtering)
  const sidechainWrites = writes.filter(w => w.tool === 'Glob');
  assert.strictEqual(sidechainWrites.length, 0);
});

// --- extractCosts ---

const costs = extractCosts(records);

test('extractCosts: filters out sidechain records', () => {
  // Record 4 (sidechain) has 500 input + 80 output tokens
  // These should NOT be in the totals
  // Main-chain assistant records (1, 2) have 1500+1800=3300 input and 200+100=300 output
  // Record 5 (API error) also filtered: 300 input + 10 output
  assert.strictEqual(costs.totals.inputTokens, 3300, `Input tokens: ${costs.totals.inputTokens}`);
});

test('extractCosts: filters out API error records', () => {
  // Record 5 has isApiErrorMessage: true, its 300+10 tokens should be excluded
  assert.strictEqual(costs.totals.outputTokens, 300, `Output tokens: ${costs.totals.outputTokens}`);
});

test('extractCosts: correct cache token counts', () => {
  // Record 1: cache_creation=100, cache_read=50
  // Record 2: cache_creation=0, cache_read=200
  assert.strictEqual(costs.totals.cacheWriteTokens, 100);
  assert.strictEqual(costs.totals.cacheReadTokens, 250);
});

test('extractCosts: calculates estimated cost', () => {
  assert.ok(costs.totals.estimatedCostUSD > 0, `Cost should be > 0: ${costs.totals.estimatedCostUSD}`);
});

test('extractCosts: has pricing note', () => {
  assert.ok(costs.totals.pricingNote.includes('claude.com/pricing'));
});

test('extractCosts: correct turn count (excludes sidechain and errors)', () => {
  assert.strictEqual(costs.turns.length, 2, `Expected 2 turns, got ${costs.turns.length}`);
});

// --- extractToolUsage ---

const toolUsage = extractToolUsage(records);

test('extractToolUsage: correct total tool calls (excludes sidechain)', () => {
  // Record 1: Write, Record 2: Read — main-chain
  // Record 4: Glob — sidechain (excluded)
  assert.strictEqual(toolUsage.totalToolCalls, 2, `Total: ${toolUsage.totalToolCalls}`);
});

test('extractToolUsage: correct frequency breakdown', () => {
  const writeEntry = toolUsage.toolFrequency.find(f => f.tool === 'Write');
  const readEntry = toolUsage.toolFrequency.find(f => f.tool === 'Read');
  assert.ok(writeEntry && writeEntry.count === 1, 'Write count should be 1');
  assert.ok(readEntry && readEntry.count === 1, 'Read count should be 1');
});

test('extractToolUsage: does not include sidechain tool calls', () => {
  const globEntry = toolUsage.toolFrequency.find(f => f.tool === 'Glob');
  assert.strictEqual(globEntry, undefined, 'Glob (sidechain) should not appear');
});

// --- findSessionDirs ---

test('findSessionDirs: returns an array', () => {
  const dirs = findSessionDirs();
  assert.ok(Array.isArray(dirs), 'findSessionDirs should return an array');
});

// --- decodeProjectPath ---

test('decodeProjectPath: decodes Unix-style paths', () => {
  const decoded = decodeProjectPath('-home-user-myapp');
  assert.strictEqual(decoded, '/home/user/myapp');
});

test('decodeProjectPath: decodes Windows-style paths', () => {
  const decoded = decodeProjectPath('c--Users-Bryce-Projects-foo');
  assert.strictEqual(decoded, 'C:/Users/Bryce/Projects/foo');
});

// --- getClaudeHome ---

test('getClaudeHome: returns a string', () => {
  const home = getClaudeHome();
  assert.strictEqual(typeof home, 'string');
  assert.ok(home.length > 0);
});

// --- Summary ---

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
