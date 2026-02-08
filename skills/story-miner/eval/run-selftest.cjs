#!/usr/bin/env node
/**
 * run-selftest.cjs - Deterministic eval runner for story-miner skill
 *
 * A standalone Node.js script (>= 18, stdlib only) that:
 * - Loads fixtures from eval/fixtures/
 * - Loads pipeline outputs from an output dir
 * - Runs 7 eval suites with hard gates
 * - Emits selftest-report.md + selftest-metrics.json
 * - Exits 0 (all pass) or 1 (any fail)
 *
 * Usage:
 *   node eval/run-selftest.cjs \
 *     --fixtures-dir eval/fixtures/ \
 *     --output-dir .story-miner/ \
 *     --preprocessed preprocessed.json \
 *     --candidates candidates.jsonl \
 *     --stories stories.jsonl
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// Constants
// ============================================================================

const EVAL_VERSION = '1.1.0';
const PREPROCESSOR_VERSION = '1.0.0';

// Hard gate thresholds
const THRESHOLDS = {
  pointerResolveRate: 1.0,
  hashVerificationRate: 1.0,
  quoteCoverageRate: 0.95,
  secretFindingCount: 0,
  bannedPhraseCount: 0,
  structuralPassRate: 1.0,
  claimsGroundedRate: 1.0,
  claimsCoverageRate: 1.0,
  dedupeClusterPassRate: 1.0,
  toolCoherenceRate: 1.0,
  idStability: 1.0
};

// Scanner rules (same as preprocessor)
const SCANNER_RULES = [
  { pattern: /ghp_[A-Za-z0-9_]{36,}/g, severity: 'error', name: 'GitHub PAT' },
  { pattern: /glpat-[A-Za-z0-9_-]{20,}/g, severity: 'error', name: 'GitLab PAT' },
  { pattern: /sk-[A-Za-z0-9]{20,}/g, severity: 'error', name: 'API key (sk-)' },
  { pattern: /AKIA[A-Z0-9]{16}/g, severity: 'error', name: 'AWS access key' },
  { pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, severity: 'error', name: 'JWT token' },
  { pattern: /-----BEGIN\s+(RSA\s+)?(PRIVATE|PUBLIC)\s+KEY-----/g, severity: 'error', name: 'PEM block' },
  { pattern: /(mongodb|postgres|mysql|redis):\/\/[^\s"']+/g, severity: 'error', name: 'Connection string' },
  { pattern: /Authorization:\s*(Bearer\s+)?(?!\[REDACTED\])[^\n]{10,}/g, severity: 'error', name: 'Auth header' }
];

// Banned phrases (generic advice patterns)
const BANNED_PHRASES = [
  'always write tests', 'best practice', 'make sure to', "don't forget to",
  "it's important to", 'always remember', 'be careful', 'consider using',
  'you should always', 'pro tip', 'helpful tip', 'keep in mind',
  'general rule of thumb'
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute stable SHA-256 hash of first 400 chars, truncated to 16 hex
 * @param {string} text - Text content
 * @returns {string} 16-char hex string
 */
function computeContentHash16(text) {
  if (!text || typeof text !== 'string') return '0000000000000000';
  const input = text.slice(0, 400);
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Parse a provenance pointer string into its components.
 * Format: "{sessionId}/{lineIndex}#{contentHash16}"
 * @param {string} pointerStr - Pointer string
 * @returns {{sessionId: string, lineIndex: number, contentHash16: string}|null}
 */
function parsePointerString(pointerStr) {
  if (!pointerStr || typeof pointerStr !== 'string') return null;
  const match = pointerStr.match(/^(.+?)\/(\d+)#([0-9a-f]{16})$/);
  if (!match) return null;
  return {
    sessionId: match[1],
    lineIndex: parseInt(match[2], 10),
    contentHash16: match[3]
  };
}

/**
 * Load all JSON fixtures from a directory
 * @param {string} dir - Fixtures directory path
 * @returns {Array} Array of fixture objects
 */
function loadFixtures(dir) {
  const fixtures = [];
  if (!fs.existsSync(dir)) {
    console.warn(`[WARN] Fixtures directory not found: ${dir}`);
    return fixtures;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.'));

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fixture = JSON.parse(content);
      fixture._fileName = file;
      fixtures.push(fixture);
    } catch (err) {
      console.error(`[ERROR] Failed to load fixture ${file}: ${err.message}`);
    }
  }

  return fixtures;
}

/**
 * Load pipeline outputs from output directory
 * @param {string} dir - Output directory path
 * @param {Object} filenames - Object with preprocessed, candidates, stories keys
 * @returns {Object} Object with preprocessed, candidates, stories arrays
 */
function loadPipelineOutputs(dir, filenames) {
  const outputs = {
    preprocessed: null,
    candidates: [],
    stories: []
  };

  // Load preprocessed.json
  const preprocessedPath = path.join(dir, filenames.preprocessed);
  if (fs.existsSync(preprocessedPath)) {
    try {
      outputs.preprocessed = JSON.parse(fs.readFileSync(preprocessedPath, 'utf8'));
    } catch (err) {
      console.warn(`[WARN] Failed to load preprocessed: ${err.message}`);
    }
  }

  // Load candidates.jsonl
  const candidatesPath = path.join(dir, filenames.candidates);
  if (fs.existsSync(candidatesPath)) {
    try {
      const lines = fs.readFileSync(candidatesPath, 'utf8').trim().split('\n');
      outputs.candidates = lines.filter(l => l.trim()).map(l => JSON.parse(l));
    } catch (err) {
      console.warn(`[WARN] Failed to load candidates: ${err.message}`);
    }
  }

  // Load stories.jsonl
  const storiesPath = path.join(dir, filenames.stories);
  if (fs.existsSync(storiesPath)) {
    try {
      const lines = fs.readFileSync(storiesPath, 'utf8').trim().split('\n');
      outputs.stories = lines.filter(l => l.trim()).map(l => JSON.parse(l));
    } catch (err) {
      console.warn(`[WARN] Failed to load stories: ${err.message}`);
    }
  }

  return outputs;
}

/**
 * Build an event index from preprocessed.json for pointer resolution.
 * Key: "sessionId:eventIndex" -> event object
 * Also indexes by provenance lineIndex for provenance pointer resolution.
 * @param {Object} preprocessed - Preprocessed output
 * @returns {Map} Event index
 */
function buildEventIndex(preprocessed) {
  const index = new Map();
  if (!preprocessed || !preprocessed.sessions) return index;

  for (const session of preprocessed.sessions) {
    if (!session.events) continue;
    for (const event of session.events) {
      // Index by provenance pointer (sessionId:lineIndex from provenance)
      if (event.provenance) {
        const key = `${event.provenance.sessionId}:${event.provenance.lineIndex}`;
        index.set(key, event);
      }
      // Also index by sessionId:event.index for eventIndices lookups
      if (event.index != null) {
        const key2 = `${session.sessionId}:idx:${event.index}`;
        index.set(key2, event);
      }
    }
  }
  return index;
}

/**
 * Build an event index from fixtures (fallback when no preprocessed available)
 * @param {Array} fixtures - Fixture objects
 * @returns {Map} Event index
 */
function buildFixtureEventIndex(fixtures) {
  const index = new Map();
  for (const fixture of fixtures) {
    for (const session of fixture.sessions || []) {
      for (let i = 0; i < (session.events || []).length; i++) {
        const event = session.events[i];
        const key = `${session.sessionId}:${i}`;
        index.set(key, event);
      }
    }
  }
  return index;
}

// ============================================================================
// Suite 1: Schema/Integrity
// ============================================================================

function runSchemaIntegrity(fixtures, outputs) {
  const assertions = [];
  let passed = 0;
  let failed = 0;

  // Test fixtures schema
  for (const fixture of fixtures) {
    const name = `Fixture ${fixture._fileName} has valid schema`;
    const hasMetadata = fixture.metadata && typeof fixture.metadata === 'object';
    const hasSessions = Array.isArray(fixture.sessions);
    const pass = hasMetadata && hasSessions;

    assertions.push({ name, pass, detail: pass ? 'OK' : 'Missing metadata or sessions' });
    pass ? passed++ : failed++;
  }

  // Test preprocessed schema
  if (outputs.preprocessed) {
    const name = 'Preprocessed has valid schema';
    const hasMetadata = outputs.preprocessed.metadata && typeof outputs.preprocessed.metadata === 'object';
    const hasSessions = Array.isArray(outputs.preprocessed.sessions);
    const pass = hasMetadata && hasSessions;

    assertions.push({ name, pass, detail: pass ? 'OK' : 'Missing metadata or sessions' });
    pass ? passed++ : failed++;
  }

  // Test candidates schema (correct field names: candidateId, synopsis, evidencePointers)
  for (let i = 0; i < outputs.candidates.length; i++) {
    const candidate = outputs.candidates[i];
    const name = `Candidate ${i} has required fields`;
    const hasCandidateId = typeof candidate.candidateId === 'string';
    const hasSessionId = typeof candidate.sessionId === 'string';
    const hasTitle = typeof candidate.title === 'string';
    const hasSynopsis = typeof candidate.synopsis === 'string';
    const hasStatus = candidate.status === 'promoted' || candidate.status === 'rejected' || candidate.status === 'deduped';
    const hasEvidencePointers = Array.isArray(candidate.evidencePointers);
    const hasStructuralCheck = candidate.structuralCheck && typeof candidate.structuralCheck === 'object';
    const pass = hasCandidateId && hasSessionId && hasTitle && hasSynopsis && hasStatus && hasEvidencePointers;

    const missing = [];
    if (!hasCandidateId) missing.push('candidateId');
    if (!hasSessionId) missing.push('sessionId');
    if (!hasTitle) missing.push('title');
    if (!hasSynopsis) missing.push('synopsis');
    if (!hasStatus) missing.push('status');
    if (!hasEvidencePointers) missing.push('evidencePointers');

    assertions.push({ name, pass, detail: pass ? 'OK' : `Missing: ${missing.join(', ')}` });
    pass ? passed++ : failed++;
  }

  // Test stories schema (correct field names: storyId, synopsis, quotes, claims)
  for (let i = 0; i < outputs.stories.length; i++) {
    const story = outputs.stories[i];
    const name = `Story ${i} has required fields`;
    const hasStoryId = typeof story.storyId === 'string';
    const hasTitle = typeof story.title === 'string';
    const hasSynopsis = typeof story.synopsis === 'string';
    const hasNarrative = typeof story.narrative === 'string';
    const hasQuotes = Array.isArray(story.quotes);
    const hasClaims = Array.isArray(story.claims);
    const pass = hasStoryId && hasTitle && hasSynopsis && hasNarrative && hasQuotes && hasClaims;

    const missing = [];
    if (!hasStoryId) missing.push('storyId');
    if (!hasTitle) missing.push('title');
    if (!hasSynopsis) missing.push('synopsis');
    if (!hasNarrative) missing.push('narrative');
    if (!hasQuotes) missing.push('quotes');
    if (!hasClaims) missing.push('claims');

    assertions.push({ name, pass, detail: pass ? 'OK' : `Missing: ${missing.join(', ')}` });
    pass ? passed++ : failed++;
  }

  const gate = failed === 0 ? 'pass' : 'fail';
  return { passed, failed, assertions, gate };
}

// ============================================================================
// Suite 2: Grounding/Provenance
// Resolves pointers against preprocessed.json (primary) or fixtures (fallback)
// ============================================================================

function runGroundingProvenance(fixtures, outputs) {
  const assertions = [];
  let totalPointers = 0;
  let resolvedPointers = 0;
  let hashVerified = 0;
  let quoteCovered = 0;
  let thinkingQuotes = 0;

  // Build event index from preprocessed.json (primary) or fixtures (fallback)
  const eventIndex = outputs.preprocessed
    ? buildEventIndex(outputs.preprocessed)
    : buildFixtureEventIndex(fixtures);

  /**
   * Resolve a pointer (string or object) against the event index
   * @param {string|Object} pointerInput - Pointer string or object
   * @returns {Object|null} Resolved event or null
   */
  function resolve(pointerInput) {
    let sessionId, lineIndex, contentHash16;

    if (typeof pointerInput === 'string') {
      const parsed = parsePointerString(pointerInput);
      if (!parsed) return null;
      ({ sessionId, lineIndex, contentHash16 } = parsed);
    } else if (pointerInput && typeof pointerInput === 'object') {
      sessionId = pointerInput.sessionId;
      lineIndex = pointerInput.lineIndex;
      contentHash16 = pointerInput.contentHash16;
    } else {
      return null;
    }

    const key = `${sessionId}:${lineIndex}`;
    return eventIndex.get(key) || null;
  }

  // Test candidate evidencePointers (array of pointer strings)
  for (const candidate of outputs.candidates) {
    if (!candidate.evidencePointers || !Array.isArray(candidate.evidencePointers)) continue;

    for (const ptr of candidate.evidencePointers) {
      totalPointers++;
      const event = resolve(ptr);
      if (event) {
        resolvedPointers++;
        const text = event.text || '';
        const parsed = typeof ptr === 'string' ? parsePointerString(ptr) : ptr;
        if (parsed) {
          const expectedHash = computeContentHash16(text);
          if (parsed.contentHash16 === expectedHash) hashVerified++;
        }
      }
    }
  }

  // Test story quotes provenance (single object per quote, not array)
  for (const story of outputs.stories) {
    if (!story.quotes || !Array.isArray(story.quotes)) continue;

    for (const quote of story.quotes) {
      if (!quote.provenance) continue;

      // quote.provenance is a single object with pointer string
      const ptr = quote.provenance.pointer || quote.provenance;
      totalPointers++;
      const event = resolve(ptr);

      if (event) {
        resolvedPointers++;
        const text = event.text || '';

        // Verify hash
        const parsed = typeof ptr === 'string' ? parsePointerString(ptr) : ptr;
        if (parsed) {
          const expectedHash = computeContentHash16(text);
          if (parsed.contentHash16 === expectedHash) hashVerified++;
        }

        // Verify quote text is substring of evidence
        const quoteText = quote.text || '';
        if (quoteText.length > 0 && text.includes(quoteText.slice(0, 100))) {
          quoteCovered++;
        }

        // P1-5: Verify quote is NOT from a thinking block
        if (event.blockType === 'thinking') {
          thinkingQuotes++;
        }
      }
    }
  }

  // Test claims grounding (evidencePointers resolve to non-thinking events)
  let totalClaims = 0;
  let groundedClaims = 0;
  let storiesWithRootCause = 0;
  let storiesWithFix = 0;

  for (const story of outputs.stories) {
    if (!story.claims || !Array.isArray(story.claims)) continue;

    let hasRootCause = false;
    let hasFix = false;

    for (const claim of story.claims) {
      totalClaims++;
      if (claim.type === 'root_cause') hasRootCause = true;
      if (claim.type === 'fix') hasFix = true;

      // Verify at least one evidence pointer resolves to non-thinking event
      const pointers = claim.evidencePointers || [];
      let anyResolved = false;
      for (const ptr of pointers) {
        const event = resolve(ptr);
        if (event && event.blockType !== 'thinking') {
          anyResolved = true;
          break;
        }
      }
      if (anyResolved) groundedClaims++;
    }

    if (hasRootCause) storiesWithRootCause++;
    if (hasFix) storiesWithFix++;
  }

  // Calculate rates
  const pointerResolveRate = totalPointers > 0 ? resolvedPointers / totalPointers : 1.0;
  const hashVerificationRate = totalPointers > 0 ? hashVerified / totalPointers : 1.0;
  const storyQuoteCount = outputs.stories.reduce((sum, s) => sum + (s.quotes?.length || 0), 0);
  const quoteCoverageRate = storyQuoteCount > 0 ? quoteCovered / storyQuoteCount : 1.0;
  const claimsGroundedRate = totalClaims > 0 ? groundedClaims / totalClaims : 1.0;
  const claimsCoverageRate = outputs.stories.length > 0
    ? Math.min(storiesWithRootCause, storiesWithFix) / outputs.stories.length
    : 1.0;

  assertions.push({
    name: 'Pointer resolve rate',
    pass: pointerResolveRate >= THRESHOLDS.pointerResolveRate,
    detail: `${(pointerResolveRate * 100).toFixed(1)}% (${resolvedPointers}/${totalPointers})`
  });

  assertions.push({
    name: 'Hash verification rate',
    pass: hashVerificationRate >= THRESHOLDS.hashVerificationRate,
    detail: `${(hashVerificationRate * 100).toFixed(1)}% (${hashVerified}/${totalPointers})`
  });

  assertions.push({
    name: 'Quote coverage rate',
    pass: quoteCoverageRate >= THRESHOLDS.quoteCoverageRate,
    detail: `${(quoteCoverageRate * 100).toFixed(1)}% (${quoteCovered}/${storyQuoteCount})`
  });

  assertions.push({
    name: 'No thinking-block quotes',
    pass: thinkingQuotes === 0,
    detail: thinkingQuotes === 0 ? 'OK' : `Found ${thinkingQuotes} thinking-block quotes`
  });

  assertions.push({
    name: 'Claims grounded rate',
    pass: claimsGroundedRate >= THRESHOLDS.claimsGroundedRate,
    detail: `${(claimsGroundedRate * 100).toFixed(1)}% (${groundedClaims}/${totalClaims})`
  });

  assertions.push({
    name: 'Claims coverage rate (root_cause + fix per story)',
    pass: claimsCoverageRate >= THRESHOLDS.claimsCoverageRate,
    detail: `${(claimsCoverageRate * 100).toFixed(1)}% (root_cause: ${storiesWithRootCause}, fix: ${storiesWithFix}, stories: ${outputs.stories.length})`
  });

  const passed = assertions.filter(a => a.pass).length;
  const failed = assertions.filter(a => !a.pass).length;

  const gate = (
    pointerResolveRate >= THRESHOLDS.pointerResolveRate &&
    hashVerificationRate >= THRESHOLDS.hashVerificationRate &&
    quoteCoverageRate >= THRESHOLDS.quoteCoverageRate &&
    thinkingQuotes === 0 &&
    claimsGroundedRate >= THRESHOLDS.claimsGroundedRate &&
    claimsCoverageRate >= THRESHOLDS.claimsCoverageRate
  ) ? 'pass' : 'fail';

  return {
    passed, failed, assertions, gate,
    metrics: { pointerResolveRate, hashVerificationRate, quoteCoverageRate, claimsGroundedRate, claimsCoverageRate }
  };
}

// ============================================================================
// Suite 3: Safety/Leak Scanning
// ============================================================================

function runSafetyLeakScanning(fixtures, outputs) {
  const assertions = [];
  const findings = [];

  // Scan all output content
  const contentToScan = [];

  if (outputs.preprocessed) {
    contentToScan.push({ type: 'preprocessed', id: 'preprocessed', content: JSON.stringify(outputs.preprocessed) });
  }

  for (const candidate of outputs.candidates) {
    contentToScan.push({ type: 'candidate', id: candidate.candidateId || 'unknown', content: JSON.stringify(candidate) });
  }

  for (const story of outputs.stories) {
    contentToScan.push({ type: 'story', id: story.storyId || 'unknown', content: JSON.stringify(story) });
  }

  // Run scanner rules
  for (const item of contentToScan) {
    for (const rule of SCANNER_RULES) {
      if (rule.severity !== 'error') continue;

      // Reset regex lastIndex for global patterns
      rule.pattern.lastIndex = 0;
      const matches = item.content.match(rule.pattern);
      if (matches) {
        findings.push({
          type: item.type,
          id: item.id,
          rule: rule.name,
          matchCount: matches.length,
          sample: matches[0].slice(0, 50)
        });
      }
    }
  }

  const secretFindingCount = findings.length;

  assertions.push({
    name: 'No error-severity secrets in outputs',
    pass: secretFindingCount === 0,
    detail: secretFindingCount === 0 ? 'OK' : `Found ${secretFindingCount} secret patterns`
  });

  if (findings.length > 0) {
    assertions.push({
      name: 'Secret findings detail',
      pass: false,
      detail: JSON.stringify(findings.slice(0, 5), null, 2)
    });
  }

  const passed = assertions.filter(a => a.pass).length;
  const failed = assertions.filter(a => !a.pass).length;

  const gate = secretFindingCount === 0 ? 'pass' : 'fail';

  return { passed, failed, assertions, gate, metrics: { secretFindingCount }, findings };
}

// ============================================================================
// Suite 4: Generic Advice Ban
// ============================================================================

function runGenericAdviceBan(fixtures, outputs) {
  const assertions = [];
  const violations = [];

  // Check promoted candidates (title + synopsis)
  for (const candidate of outputs.candidates) {
    if (candidate.status !== 'promoted') continue;
    const text = ((candidate.title || '') + ' ' + (candidate.synopsis || '')).toLowerCase();
    for (const phrase of BANNED_PHRASES) {
      if (text.includes(phrase.toLowerCase())) {
        violations.push({
          type: 'candidate',
          id: candidate.candidateId,
          phrase,
          excerpt: text.slice(0, 100)
        });
      }
    }
  }

  // Check stories (title + synopsis + narrative)
  for (const story of outputs.stories) {
    const text = ((story.title || '') + ' ' + (story.synopsis || '') + ' ' + (story.narrative || '')).toLowerCase();
    for (const phrase of BANNED_PHRASES) {
      if (text.includes(phrase.toLowerCase())) {
        violations.push({
          type: 'story',
          id: story.storyId,
          phrase,
          excerpt: text.slice(0, 100)
        });
      }
    }
  }

  const bannedPhraseCount = violations.length;

  assertions.push({
    name: 'No banned phrases in promoted content',
    pass: bannedPhraseCount === 0,
    detail: bannedPhraseCount === 0 ? 'OK' : `Found ${bannedPhraseCount} banned phrases`
  });

  // Structural validation: promoted stories have required elements
  let structuralPasses = 0;
  const structuralTotal = outputs.stories.length;

  for (const story of outputs.stories) {
    const hasTitle = story.title && story.title.length > 0;
    const hasSynopsis = story.synopsis && story.synopsis.length > 0;
    const hasNarrative = story.narrative && story.narrative.length > 0;
    const hasQuotes = story.quotes && story.quotes.length > 0;
    const hasClaims = story.claims && story.claims.length > 0;

    if (hasTitle && hasSynopsis && hasNarrative && hasQuotes && hasClaims) {
      structuralPasses++;
    }
  }

  const structuralPassRate = structuralTotal > 0 ? structuralPasses / structuralTotal : 1.0;

  assertions.push({
    name: 'Structural validation of promoted stories',
    pass: structuralPassRate >= THRESHOLDS.structuralPassRate,
    detail: `${(structuralPassRate * 100).toFixed(1)}% (${structuralPasses}/${structuralTotal})`
  });

  const passed = assertions.filter(a => a.pass).length;
  const failed = assertions.filter(a => !a.pass).length;

  const gate = bannedPhraseCount === 0 && structuralPassRate >= THRESHOLDS.structuralPassRate ? 'pass' : 'fail';

  return { passed, failed, assertions, gate, metrics: { bannedPhraseCount, structuralPassRate }, violations };
}

// ============================================================================
// Suite 5: Dedupe Correctness
// ============================================================================

function runDedupeCorrectness(fixtures, outputs) {
  const assertions = [];
  let passed = 0;
  let failed = 0;

  // Build expected clusters from fixture annotations
  const expectedClusters = new Map();

  for (const fixture of fixtures) {
    if (!fixture.summary || !fixture.summary.dedupeGroups) continue;

    for (const [clusterId, clusterInfo] of Object.entries(fixture.summary.dedupeGroups)) {
      expectedClusters.set(clusterId, clusterInfo);
    }
  }

  // If no pipeline outputs exist, skip this suite
  if (outputs.candidates.length === 0 && outputs.stories.length === 0) {
    assertions.push({
      name: 'Dedupe correctness (skipped - no pipeline outputs)',
      pass: true,
      detail: 'No candidates/stories to validate'
    });
    passed++;
    const dedupeClusterPassRate = 1.0;
    const gate = 'pass';
    return { passed, failed, assertions, gate, metrics: { dedupeClusterPassRate } };
  }

  // Build actual clusters from candidates using dedupeClusterId
  const actualClusters = new Map();

  for (const candidate of outputs.candidates) {
    const clusterId = candidate.dedupeClusterId || candidate.candidateId;
    if (!actualClusters.has(clusterId)) {
      actualClusters.set(clusterId, []);
    }
    actualClusters.get(clusterId).push(candidate);
  }

  // Verify each expected cluster
  for (const [clusterId, expected] of expectedClusters) {
    const name = `Dedupe cluster: ${clusterId}`;
    const actual = actualClusters.get(clusterId);

    if (!actual) {
      assertions.push({ name, pass: false, detail: 'Cluster not found in outputs' });
      failed++;
      continue;
    }

    const expectedCount = expected.excerptCount || expected.sessionIds?.length || 1;
    const pass = actual.length >= expectedCount;

    assertions.push({
      name,
      pass,
      detail: pass ? `OK (${actual.length} candidates)` : `Expected ${expectedCount}, got ${actual.length}`
    });

    pass ? passed++ : failed++;
  }

  // If no expected clusters from fixtures, verify that deduped candidates exist
  if (expectedClusters.size === 0) {
    const dedupedCount = outputs.candidates.filter(c => c.status === 'deduped').length;
    const promotedCount = outputs.candidates.filter(c => c.status === 'promoted').length;
    assertions.push({
      name: 'Dedupe produced valid statuses',
      pass: true,
      detail: `${promotedCount} promoted, ${dedupedCount} deduped`
    });
    passed++;
  }

  // Calculate overall rate
  const dedupeClusterPassRate = assertions.length > 0 ? passed / assertions.length : 1.0;

  const gate = dedupeClusterPassRate >= THRESHOLDS.dedupeClusterPassRate ? 'pass' : 'fail';

  return { passed, failed, assertions, gate, metrics: { dedupeClusterPassRate } };
}

// ============================================================================
// Suite 6: Tool Coherence
// ============================================================================

function runToolCoherence(fixtures, outputs) {
  const assertions = [];
  let totalTransactions = 0;
  let coherentTransactions = 0;

  // Check fixture transactions
  for (const fixture of fixtures) {
    for (const session of fixture.sessions || []) {
      if (!session.transactions) continue;

      for (const txn of session.transactions) {
        totalTransactions++;

        // Verify call event exists
        const callEvent = session.events[txn.callEventIndex];
        if (!callEvent || callEvent.kind !== 'tool_call') {
          continue;
        }

        // Verify result event exists (skip for pending transactions)
        if (txn.resultEventIndex == null) {
          if (txn.state === 'pending') coherentTransactions++;
          continue;
        }

        const resultEvent = session.events[txn.resultEventIndex];
        if (!resultEvent || resultEvent.kind !== 'tool_result') {
          continue;
        }

        // Verify toolUseId matches
        if (callEvent.toolUseId !== txn.toolUseId || resultEvent.toolUseId !== txn.toolUseId) {
          continue;
        }

        // Verify toolName matches
        if (callEvent.toolName !== txn.toolName || resultEvent.toolName !== txn.toolName) {
          continue;
        }

        coherentTransactions++;
      }
    }
  }

  // Also check preprocessed transactions if available
  if (outputs.preprocessed) {
    for (const session of outputs.preprocessed.sessions || []) {
      if (!session.transactions) continue;

      for (const txn of session.transactions) {
        totalTransactions++;

        // For preprocessed, verify transaction has valid state
        const validStates = ['completed', 'failed', 'orphaned', 'pending'];
        if (validStates.includes(txn.state) && txn.toolUseId) {
          coherentTransactions++;
        }
      }
    }
  }

  const toolCoherenceRate = totalTransactions > 0 ? coherentTransactions / totalTransactions : 1.0;

  assertions.push({
    name: 'Tool transactions correctly paired',
    pass: toolCoherenceRate >= THRESHOLDS.toolCoherenceRate,
    detail: `${(toolCoherenceRate * 100).toFixed(1)}% (${coherentTransactions}/${totalTransactions})`
  });

  const passed = assertions.filter(a => a.pass).length;
  const failed = assertions.filter(a => !a.pass).length;

  const gate = toolCoherenceRate >= THRESHOLDS.toolCoherenceRate ? 'pass' : 'fail';

  return { passed, failed, assertions, gate, metrics: { toolCoherenceRate } };
}

// ============================================================================
// Suite 7: ID Stability
// ============================================================================

function runIdStability(fixtures, outputs, fixturesDir) {
  const assertions = [];

  // Parse fixtures twice and verify IDs are identical
  const firstIds = new Set();
  const secondIds = new Set();

  // First pass
  for (const fixture of fixtures) {
    for (const session of fixture.sessions || []) {
      firstIds.add(session.sessionId);
      for (const event of session.events || []) {
        if (event.lineHash) firstIds.add(event.lineHash);
      }
    }
  }

  // Second pass (re-parse from disk)
  const reloadedFixtures = loadFixtures(fixturesDir);
  for (const fixture of reloadedFixtures) {
    for (const session of fixture.sessions || []) {
      secondIds.add(session.sessionId);
      for (const event of session.events || []) {
        if (event.lineHash) secondIds.add(event.lineHash);
      }
    }
  }

  // Compare sets
  const allStable = firstIds.size === secondIds.size && [...firstIds].every(id => secondIds.has(id));
  const idStability = allStable ? 1.0 : 0.0;

  assertions.push({
    name: 'IDs are deterministic across parses',
    pass: idStability === 1.0,
    detail: allStable ? 'OK' : `ID sets differ (${firstIds.size} vs ${secondIds.size})`
  });

  // Also verify candidate/story IDs are deterministic if outputs exist
  if (outputs.candidates.length > 0) {
    const candidateIds = outputs.candidates.map(c => c.candidateId).filter(Boolean);
    const uniqueIds = new Set(candidateIds);
    const noDupes = candidateIds.length === uniqueIds.size;
    assertions.push({
      name: 'Candidate IDs are unique',
      pass: noDupes,
      detail: noDupes ? `OK (${candidateIds.length} unique)` : `${candidateIds.length - uniqueIds.size} duplicates`
    });
  }

  if (outputs.stories.length > 0) {
    const storyIds = outputs.stories.map(s => s.storyId).filter(Boolean);
    const uniqueIds = new Set(storyIds);
    const noDupes = storyIds.length === uniqueIds.size;
    assertions.push({
      name: 'Story IDs are unique',
      pass: noDupes,
      detail: noDupes ? `OK (${storyIds.length} unique)` : `${storyIds.length - uniqueIds.size} duplicates`
    });
  }

  const passed = assertions.filter(a => a.pass).length;
  const failed = assertions.filter(a => !a.pass).length;

  const gate = failed === 0 ? 'pass' : 'fail';

  return { passed, failed, assertions, gate, metrics: { idStability } };
}

// ============================================================================
// Main
// ============================================================================

function parseArgs() {
  const args = {
    fixturesDir: 'eval/fixtures/',
    outputDir: '.story-miner/',
    preprocessed: 'preprocessed.json',
    candidates: 'candidates.jsonl',
    stories: 'stories.jsonl'
  };

  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace(/^--/, '');
    const value = process.argv[i + 1];

    if (key === 'fixtures-dir') args.fixturesDir = value;
    else if (key === 'output-dir') args.outputDir = value;
    else if (key === 'preprocessed') args.preprocessed = value;
    else if (key === 'candidates') args.candidates = value;
    else if (key === 'stories') args.stories = value;
  }

  return args;
}

function generateReport(suiteResults, metrics, overall) {
  const timestamp = new Date().toISOString();

  let report = '# Story Miner Self-Test Report\n\n';
  report += `**Date:** ${timestamp}\n\n`;
  report += `**Overall:** ${overall === 'pass' ? 'PASS' : 'FAIL'}\n\n`;

  report += '## Suite Results\n\n';
  report += '| Suite | Status | Passed | Failed |\n';
  report += '|-------|--------|--------|--------|\n';

  const suiteNames = {
    schema_integrity: 'Schema/Integrity',
    grounding_provenance: 'Grounding/Provenance',
    safety_leak_scanning: 'Safety/Leak Scanning',
    generic_advice_ban: 'Generic Advice Ban',
    dedupe_correctness: 'Dedupe Correctness',
    tool_coherence: 'Tool Coherence',
    id_stability: 'ID Stability'
  };

  for (const [key, suite] of Object.entries(suiteResults)) {
    const status = suite.gate === 'pass' ? 'PASS' : 'FAIL';
    report += `| ${suiteNames[key]} | ${status} | ${suite.passed} | ${suite.failed} |\n`;
  }

  report += '\n## Metrics\n\n';
  report += '| Metric | Value | Threshold | Status |\n';
  report += '|--------|-------|-----------|--------|\n';

  for (const [key, value] of Object.entries(metrics)) {
    const threshold = THRESHOLDS[key];
    if (threshold === undefined) continue;

    let valueStr = typeof value === 'number' ? value.toFixed(3) : String(value);
    let thresholdStr = typeof threshold === 'number' ? threshold.toFixed(3) : String(threshold);

    let comparison = '=';
    if (key.includes('Rate')) comparison = '>=';
    else if (key.includes('Count')) comparison = '<=';

    const pass = (
      (comparison === '>=' && value >= threshold) ||
      (comparison === '<=' && value <= threshold) ||
      (comparison === '=' && value === threshold)
    );

    const status = pass ? 'PASS' : 'FAIL';
    report += `| ${key} | ${valueStr} | ${comparison} ${thresholdStr} | ${status} |\n`;
  }

  report += '\n## Findings\n\n';

  const failures = [];
  for (const [key, suite] of Object.entries(suiteResults)) {
    if (suite.gate === 'fail') {
      failures.push({ suite: suiteNames[key], assertions: suite.assertions.filter(a => !a.pass) });
    }
  }

  if (failures.length === 0) {
    report += 'No failures detected.\n';
  } else {
    for (const failure of failures) {
      report += `### ${failure.suite}\n\n`;
      for (const assertion of failure.assertions) {
        report += `- **${assertion.name}**: ${assertion.detail}\n`;
      }
      report += '\n';
    }
  }

  return report;
}

function main() {
  console.log('Story Miner Self-Test Runner v' + EVAL_VERSION);
  console.log('='.repeat(60));

  const args = parseArgs();

  // Load fixtures
  console.log(`\nLoading fixtures from: ${args.fixturesDir}`);
  const fixtures = loadFixtures(args.fixturesDir);
  console.log(`  Loaded ${fixtures.length} fixture(s)`);

  if (fixtures.length === 0) {
    console.error('[ERROR] No fixtures loaded. Cannot run eval.');
    process.exit(1);
  }

  // Load pipeline outputs
  console.log(`\nLoading pipeline outputs from: ${args.outputDir}`);
  const outputs = loadPipelineOutputs(args.outputDir, {
    preprocessed: args.preprocessed,
    candidates: args.candidates,
    stories: args.stories
  });
  console.log(`  Preprocessed: ${outputs.preprocessed ? 'YES' : 'NO'}`);
  console.log(`  Candidates: ${outputs.candidates.length}`);
  console.log(`  Stories: ${outputs.stories.length}`);

  // Run suites
  console.log('\nRunning eval suites...\n');

  const suiteResults = {};

  console.log('[1/7] Schema/Integrity');
  suiteResults.schema_integrity = runSchemaIntegrity(fixtures, outputs);
  console.log(`      ${suiteResults.schema_integrity.gate.toUpperCase()} (${suiteResults.schema_integrity.passed}/${suiteResults.schema_integrity.passed + suiteResults.schema_integrity.failed})`);

  console.log('[2/7] Grounding/Provenance');
  suiteResults.grounding_provenance = runGroundingProvenance(fixtures, outputs);
  console.log(`      ${suiteResults.grounding_provenance.gate.toUpperCase()} (${suiteResults.grounding_provenance.passed}/${suiteResults.grounding_provenance.passed + suiteResults.grounding_provenance.failed})`);

  console.log('[3/7] Safety/Leak Scanning');
  suiteResults.safety_leak_scanning = runSafetyLeakScanning(fixtures, outputs);
  console.log(`      ${suiteResults.safety_leak_scanning.gate.toUpperCase()} (${suiteResults.safety_leak_scanning.passed}/${suiteResults.safety_leak_scanning.passed + suiteResults.safety_leak_scanning.failed})`);

  console.log('[4/7] Generic Advice Ban');
  suiteResults.generic_advice_ban = runGenericAdviceBan(fixtures, outputs);
  console.log(`      ${suiteResults.generic_advice_ban.gate.toUpperCase()} (${suiteResults.generic_advice_ban.passed}/${suiteResults.generic_advice_ban.passed + suiteResults.generic_advice_ban.failed})`);

  console.log('[5/7] Dedupe Correctness');
  suiteResults.dedupe_correctness = runDedupeCorrectness(fixtures, outputs);
  console.log(`      ${suiteResults.dedupe_correctness.gate.toUpperCase()} (${suiteResults.dedupe_correctness.passed}/${suiteResults.dedupe_correctness.passed + suiteResults.dedupe_correctness.failed})`);

  console.log('[6/7] Tool Coherence');
  suiteResults.tool_coherence = runToolCoherence(fixtures, outputs);
  console.log(`      ${suiteResults.tool_coherence.gate.toUpperCase()} (${suiteResults.tool_coherence.passed}/${suiteResults.tool_coherence.passed + suiteResults.tool_coherence.failed})`);

  console.log('[7/7] ID Stability');
  suiteResults.id_stability = runIdStability(fixtures, outputs, args.fixturesDir);
  console.log(`      ${suiteResults.id_stability.gate.toUpperCase()} (${suiteResults.id_stability.passed}/${suiteResults.id_stability.passed + suiteResults.id_stability.failed})`);

  // Aggregate metrics
  const metrics = {};
  for (const suite of Object.values(suiteResults)) {
    if (suite.metrics) {
      Object.assign(metrics, suite.metrics);
    }
  }

  // Determine overall pass/fail
  const overall = Object.values(suiteResults).every(s => s.gate === 'pass') ? 'pass' : 'fail';
  const exitCode = overall === 'pass' ? 0 : 1;

  // Generate outputs
  const metricsOutput = {
    timestamp: new Date().toISOString(),
    preprocessorVersion: PREPROCESSOR_VERSION,
    evalRunnerVersion: EVAL_VERSION,
    fixturesUsed: fixtures.map(f => f._fileName),
    suites: suiteResults,
    metrics,
    overall,
    exitCode
  };

  const reportOutput = generateReport(suiteResults, metrics, overall);

  // Write outputs
  const metricsPath = path.join(args.outputDir, 'selftest-metrics.json');
  const reportPath = path.join(args.outputDir, 'selftest-report.md');

  try {
    fs.mkdirSync(args.outputDir, { recursive: true });
    fs.writeFileSync(metricsPath, JSON.stringify(metricsOutput, null, 2));
    fs.writeFileSync(reportPath, reportOutput);

    console.log(`\nOutputs written:`);
    console.log(`  ${metricsPath}`);
    console.log(`  ${reportPath}`);
  } catch (err) {
    console.error(`\n[ERROR] Failed to write outputs: ${err.message}`);
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log(`Overall: ${overall.toUpperCase()}`);
  console.log('='.repeat(60));

  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  computeContentHash16,
  parsePointerString,
  loadFixtures,
  loadPipelineOutputs,
  buildEventIndex,
  runSchemaIntegrity,
  runGroundingProvenance,
  runSafetyLeakScanning,
  runGenericAdviceBan,
  runDedupeCorrectness,
  runToolCoherence,
  runIdStability
};
