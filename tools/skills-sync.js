#!/usr/bin/env node
/**
 * skills-sync - Install Claude Code skills from bryce-labs-toolkit
 *
 * A cross-platform CLI tool for installing, updating, and verifying
 * Claude Code skills from this toolkit repo into target projects.
 *
 * Usage:
 *   skills-sync --project <path> --skill <name> [options]
 *   skills-sync --project <path> --all [options]
 *   skills-sync --list
 *   skills-sync --self-test
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const os = require('os');

// ============================================================================
// Constants
// ============================================================================

const TOOL_VERSION = '1.0.0';
const MIN_NODE_VERSION = 14;
const STAMP_FILENAME = '.installed-from.json';

// Exclusion patterns
const EXCLUDE_DIRS = ['node_modules', '.git', '__pycache__'];
const EXCLUDE_FILES = ['.DS_Store', STAMP_FILENAME];
const EXCLUDE_EXTENSIONS = ['.log', '.pyc'];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check Node.js version meets minimum requirement
 */
function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE_VERSION) {
    console.error(`[ERROR] Node.js >= ${MIN_NODE_VERSION} required (found ${process.versions.node})`);
    process.exit(1);
  }
}

/**
 * Log output with level prefix
 */
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

/**
 * Get the repository root directory
 */
function getRepoRoot() {
  // Script is at tools/skills-sync.js, repo root is one level up
  return path.resolve(__dirname, '..');
}

/**
 * Get current git commit SHA
 */
function getGitCommitSha(repoRoot) {
  try {
    const sha = execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return sha;
  } catch {
    return 'unknown';
  }
}

/**
 * Check if a path is safe to operate on (not root)
 */
function isPathSafe(targetPath) {
  const resolved = path.resolve(targetPath);

  // Unix root
  if (resolved === '/') {
    return false;
  }

  // Windows drive root (C:\, D:\, C:, D:, c:\, etc.)
  // After path.resolve, "C:" becomes "C:\current\dir" so check original too
  if (/^[A-Za-z]:[\\/]?$/.test(targetPath) || /^[A-Za-z]:[\\/]?$/.test(resolved)) {
    return false;
  }

  // UNC root (\\server\share or \\server)
  // Use double-escaped backslashes for the regex
  if (/^[\\/]{2}[^\\/]+[\\/]?[^\\/]*$/.test(targetPath) ||
      /^[\\/]{2}[^\\/]+[\\/]?[^\\/]*$/.test(resolved)) {
    return false;
  }

  return true;
}

/**
 * Resolve target path for a skill
 */
function resolveTargetPath(projectPath, skillName) {
  const resolved = path.resolve(projectPath);
  return path.join(resolved, '.claude', 'skills', skillName);
}

/**
 * Check if deletion target is safe (within allowed root)
 */
function isDeleteSafe(allowedRoot, targetPath) {
  const rel = path.relative(allowedRoot, targetPath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Check if a file/directory should be excluded
 */
function shouldExclude(name, isDir) {
  // Directory exclusions (exact match)
  if (isDir && EXCLUDE_DIRS.includes(name)) {
    return true;
  }

  // File exclusions (exact match)
  if (!isDir && EXCLUDE_FILES.includes(name)) {
    return true;
  }

  // Extension exclusions
  if (!isDir) {
    for (const ext of EXCLUDE_EXTENSIONS) {
      if (name.endsWith(ext)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Discover all skills in the skills/ directory
 */
function discoverSkills(repoRoot) {
  const skillsDir = path.join(repoRoot, 'skills');

  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  return entries
    .filter(e => e.isDirectory())
    .filter(e => {
      // Must have SKILL.md (direct child only)
      const skillPath = path.join(skillsDir, e.name, 'SKILL.md');
      return fs.existsSync(skillPath);
    })
    .map(e => e.name);
}

/**
 * Hash a single file using SHA256
 */
function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Recursively hash all files in a directory
 */
function hashDirectory(dirPath, prefix = '') {
  const hashes = {};
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldExclude(entry.name, entry.isDirectory())) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      Object.assign(hashes, hashDirectory(fullPath, relativePath));
    } else {
      hashes[relativePath] = hashFile(fullPath);
    }
  }

  return hashes;
}

/**
 * Copy a directory recursively
 */
function copyDirectoryRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  let fileCount = 0;

  for (const entry of entries) {
    if (shouldExclude(entry.name, entry.isDirectory())) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fileCount += copyDirectoryRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      fileCount++;
    }
  }

  return fileCount;
}

/**
 * Write stamp file
 */
function writeStampFile(targetDir, data) {
  const stampPath = path.join(targetDir, STAMP_FILENAME);
  fs.writeFileSync(stampPath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Read stamp file
 */
function readStampFile(targetDir) {
  const stampPath = path.join(targetDir, STAMP_FILENAME);
  if (!fs.existsSync(stampPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(stampPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ============================================================================
// CLI Parsing
// ============================================================================

/**
 * Parse command-line arguments
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    project: null,
    skill: null,
    all: false,
    list: false,
    dryRun: false,
    force: false,
    merge: false,
    check: false,
    uninstall: false,
    verbose: false,
    selfTest: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--project':
      case '-p':
        opts.project = args[++i];
        break;
      case '--skill':
      case '-s':
        opts.skill = args[++i];
        break;
      case '--all':
      case '-a':
        opts.all = true;
        break;
      case '--list':
      case '-l':
        opts.list = true;
        break;
      case '--dry-run':
      case '-n':
        opts.dryRun = true;
        break;
      case '--force':
      case '-f':
        opts.force = true;
        break;
      case '--merge':
      case '-m':
        opts.merge = true;
        break;
      case '--check':
      case '-c':
        opts.check = true;
        break;
      case '--uninstall':
        opts.uninstall = true;
        break;
      case '--verbose':
      case '-v':
        opts.verbose = true;
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
        // Positional arg - could be project path shorthand
        if (!opts.project) {
          opts.project = arg;
        } else {
          throw new Error(`Unexpected argument: ${arg}`);
        }
    }
  }

  return opts;
}

/**
 * Validate parsed arguments
 */
function validateArgs(opts) {
  // Self-test and list bypass other validation
  if (opts.selfTest || opts.list || opts.help) {
    return;
  }

  // --project is required for operations
  if (!opts.project) {
    throw new Error('--project <path> is required');
  }

  // Validate project path safety
  if (!isPathSafe(opts.project)) {
    throw new Error(`Refusing to operate on unsafe path: ${opts.project}`);
  }

  // --skill and --all are mutually exclusive
  if (opts.skill && opts.all) {
    throw new Error('--skill and --all are mutually exclusive');
  }

  // Must specify --skill or --all (unless check with neither means nothing to do)
  if (!opts.skill && !opts.all) {
    throw new Error('Must specify either --skill <name> or --all');
  }

  // --force and --merge are mutually exclusive
  if (opts.force && opts.merge) {
    throw new Error('--force and --merge are mutually exclusive');
  }

  // --uninstall requires --skill (no --all uninstall for safety)
  if (opts.uninstall && !opts.skill) {
    throw new Error('--uninstall requires --skill <name> (no --all uninstall for safety)');
  }
}

/**
 * Print help text
 */
function printHelp() {
  console.log(`
skills-sync v${TOOL_VERSION} - Install Claude Code skills from bryce-labs-toolkit

USAGE:
  skills-sync --project <path> --skill <name> [options]
  skills-sync --project <path> --all [options]
  skills-sync --list
  skills-sync --self-test

OPTIONS:
  --project, -p <path>   Target project directory (required for install/check)
  --skill, -s <name>     Install/check/uninstall specific skill
  --all, -a              Install/check all available skills

  --list, -l             List available skills in this toolkit
  --dry-run, -n          Show what would be done without making changes
  --force, -f            Delete target directory before copying
  --merge, -m            Copy over existing (keeps extra files in target)
  --check, -c            Verify installed matches source via file hashes
  --uninstall            Remove installed skill (requires --skill and --force)

  --verbose, -v          Show detailed output
  --self-test            Run built-in tests
  --help, -h             Show this help

EXAMPLES:
  # List available skills
  skills-sync --list

  # Install lessons-extractor to a project
  skills-sync --project ../myproject --skill lessons-extractor

  # Install all skills with force overwrite
  skills-sync --project ~/myproject --all --force

  # Check if installed skills are up to date
  skills-sync --project ./myproject --all --check

  # Dry run to see what would happen
  skills-sync --project ./myproject --all --dry-run

  # Uninstall a skill
  skills-sync --project ./myproject --skill lessons-extractor --uninstall --force

TARGET LOCATION:
  Skills are installed to: <project>/.claude/skills/<skill-name>/

NOTE:
  - Use --force for clean updates (deletes target first)
  - Use --merge only if you intentionally keep local additions
  - Requires Node.js >= ${MIN_NODE_VERSION}
`);
}

// ============================================================================
// Main Operations
// ============================================================================

/**
 * List available skills
 */
function listSkills() {
  const repoRoot = getRepoRoot();
  const skills = discoverSkills(repoRoot);

  if (skills.length === 0) {
    console.log('No skills found in skills/ directory');
    return;
  }

  console.log('Available skills:\n');
  for (const skill of skills) {
    const skillDir = path.join(repoRoot, 'skills', skill);
    const skillMd = path.join(skillDir, 'SKILL.md');

    // Try to extract description from SKILL.md frontmatter
    let description = '';
    try {
      const content = fs.readFileSync(skillMd, 'utf-8');
      const match = content.match(/description:\s*(.+)/i);
      if (match) {
        description = match[1].trim();
      }
    } catch {
      // Ignore errors
    }

    console.log(`  ${skill}`);
    if (description) {
      console.log(`    ${description}`);
    }
  }
  console.log('');
}

/**
 * Copy/install a skill
 */
function copySkill(skillName, opts) {
  const repoRoot = getRepoRoot();
  const sourceDir = path.join(repoRoot, 'skills', skillName);
  const targetDir = resolveTargetPath(opts.project, skillName);

  // Check if source exists
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  // Check if target exists
  const targetExists = fs.existsSync(targetDir);

  if (targetExists && !opts.force && !opts.merge) {
    throw new Error(
      `Target exists: ${targetDir}\n` +
      `Use --force to delete and replace, or --merge to copy over existing files`
    );
  }

  // Dry run
  if (opts.dryRun) {
    log('info', `[DRY-RUN] Would install ${skillName}`);
    log('info', `  Source: ${sourceDir}`);
    log('info', `  Target: ${targetDir}`);
    if (opts.force && targetExists) {
      log('info', `  Would DELETE existing directory first`);
    } else if (opts.merge && targetExists) {
      log('info', `  Would MERGE over existing files (keeping extras)`);
    }
    return;
  }

  // Force mode: delete target first
  if (opts.force && targetExists) {
    // Safety check
    const projectClaudeSkills = path.join(path.resolve(opts.project), '.claude', 'skills');
    if (!isDeleteSafe(projectClaudeSkills, targetDir)) {
      throw new Error(`Safety check failed: refusing to delete ${targetDir}`);
    }

    log('verbose', `Deleting existing: ${targetDir}`);
    fs.rmSync(targetDir, { recursive: true });
  }

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  // Copy files
  const fileCount = copyDirectoryRecursive(sourceDir, targetDir);

  // Write stamp file
  const commitSha = getGitCommitSha(repoRoot);
  const hashes = hashDirectory(sourceDir);

  const stampData = {
    repo: 'bryce-labs-toolkit',
    repoUrl: 'https://github.com/BryceEWatson/bryce-labs-toolkit',
    sourcePath: `skills/${skillName}`,
    commitSha,
    installedAt: new Date().toISOString(),
    skillName,
    toolVersion: TOOL_VERSION,
    fileHashes: hashes
  };

  writeStampFile(targetDir, stampData);

  const mode = opts.force ? 'FORCE' : opts.merge ? 'MERGE' : 'INSTALL';
  log('success', `${skillName}: ${mode} complete (${fileCount} files)`);
  log('verbose', `  Source: ${sourceDir}`);
  log('verbose', `  Target: ${targetDir}`);
}

/**
 * Check if installed skill matches source
 */
function checkSkill(skillName, opts) {
  const repoRoot = getRepoRoot();
  const sourceDir = path.join(repoRoot, 'skills', skillName);
  const targetDir = resolveTargetPath(opts.project, skillName);

  // Check if source exists
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Skill not found in toolkit: ${skillName}`);
  }

  // Check if target exists
  if (!fs.existsSync(targetDir)) {
    log('warn', `${skillName}: NOT INSTALLED`);
    return false;
  }

  // Read stamp file
  const stamp = readStampFile(targetDir);
  if (!stamp) {
    log('warn', `${skillName}: No stamp file (manually installed?)`);
  }

  // Verbose: show stamp metadata
  if (opts.verbose && stamp) {
    log('verbose', `  Installed from commit: ${stamp.commitSha || 'unknown'}`);
    log('verbose', `  Installed at: ${stamp.installedAt || 'unknown'}`);
  }

  // Hash source and installed
  const sourceHashes = hashDirectory(sourceDir);
  const installedHashes = hashDirectory(targetDir);

  // Compare
  const allFiles = new Set([
    ...Object.keys(sourceHashes),
    ...Object.keys(installedHashes)
  ]);

  const diffs = {
    added: [],    // In source, not installed
    removed: [],  // In installed, not in source
    modified: []  // Different hashes
  };

  for (const file of allFiles) {
    const srcHash = sourceHashes[file];
    const instHash = installedHashes[file];

    if (!instHash) {
      diffs.added.push(file);
    } else if (!srcHash) {
      diffs.removed.push(file);
    } else if (srcHash !== instHash) {
      diffs.modified.push(file);
    }
  }

  const hasDiff = diffs.added.length > 0 || diffs.removed.length > 0 || diffs.modified.length > 0;

  if (hasDiff) {
    log('warn', `${skillName}: OUT OF DATE`);

    if (diffs.added.length > 0) {
      log('info', '  ADDED (in source, not installed):');
      for (const file of diffs.added) {
        log('info', `    + ${file}`);
      }
    }

    if (diffs.removed.length > 0) {
      log('info', '  REMOVED (in installed, not in source):');
      for (const file of diffs.removed) {
        log('info', `    - ${file}`);
      }
    }

    if (diffs.modified.length > 0) {
      log('info', '  MODIFIED:');
      for (const file of diffs.modified) {
        log('info', `    ~ ${file}`);
      }
    }

    return false;
  }

  log('success', `${skillName}: UP TO DATE`);
  return true;
}

/**
 * Uninstall a skill
 */
function uninstallSkill(skillName, opts) {
  const targetDir = resolveTargetPath(opts.project, skillName);

  // Check if target exists
  if (!fs.existsSync(targetDir)) {
    log('warn', `${skillName}: Not installed (nothing to uninstall)`);
    return;
  }

  // Safety check
  const projectClaudeSkills = path.join(path.resolve(opts.project), '.claude', 'skills');
  if (!isDeleteSafe(projectClaudeSkills, targetDir)) {
    throw new Error(`Safety check failed: refusing to delete ${targetDir}`);
  }

  // Dry run
  if (opts.dryRun) {
    log('info', `[DRY-RUN] Would uninstall ${skillName}`);
    log('info', `  Would DELETE: ${targetDir}`);
    return;
  }

  // Require --force
  if (!opts.force) {
    log('error', `${skillName}: Use --force to confirm uninstall`);
    log('info', `  Would DELETE: ${targetDir}`);
    log('info', `  Use --dry-run to preview, or --force to confirm`);
    throw new Error('Uninstall requires --force');
  }

  // Delete
  log('verbose', `Deleting: ${targetDir}`);
  fs.rmSync(targetDir, { recursive: true });
  log('success', `${skillName}: Uninstalled`);
}

// ============================================================================
// Self-Test
// ============================================================================

/**
 * Run built-in self-tests
 */
function runSelfTest() {
  console.log(`skills-sync v${TOOL_VERSION} - Self-Test\n`);

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

  // Test 2: Argument parsing
  console.log('\nArgument Parsing:');
  {
    const opts = parseArgs(['node', 'script', '--project', '/tmp/test', '--skill', 'foo']);
    assert(opts.project === '/tmp/test', 'parses --project');
    assert(opts.skill === 'foo', 'parses --skill');
  }
  {
    const opts = parseArgs(['node', 'script', '-p', '/tmp', '-a', '-f', '-v']);
    assert(opts.project === '/tmp', 'parses short -p');
    assert(opts.all === true, 'parses short -a');
    assert(opts.force === true, 'parses short -f');
    assert(opts.verbose === true, 'parses short -v');
  }
  {
    const opts = parseArgs(['node', 'script', '--list']);
    assert(opts.list === true, 'parses --list');
  }
  {
    const opts = parseArgs(['node', 'script', '--uninstall', '-p', '/tmp', '-s', 'x']);
    assert(opts.uninstall === true, 'parses --uninstall');
  }

  // Test 3: Path safety
  console.log('\nPath Safety:');
  assert(!isPathSafe('/'), 'rejects Unix root /');
  assert(!isPathSafe('C:\\'), 'rejects Windows drive root C:\\');
  assert(!isPathSafe('C:'), 'rejects Windows drive C:');
  assert(!isPathSafe('D:\\'), 'rejects Windows drive root D:\\');
  assert(!isPathSafe('\\\\server\\share'), 'rejects UNC root \\\\server\\share');
  assert(isPathSafe('/home/user/project'), 'accepts valid Unix path');
  assert(isPathSafe('C:\\Users\\test\\project'), 'accepts valid Windows path');
  assert(isPathSafe('./relative/path'), 'accepts relative path');

  // Test 4: Exclusion patterns
  console.log('\nExclusion Patterns:');
  assert(shouldExclude('node_modules', true), 'excludes node_modules dir');
  assert(shouldExclude('.git', true), 'excludes .git dir');
  assert(shouldExclude('__pycache__', true), 'excludes __pycache__ dir');
  assert(shouldExclude('.DS_Store', false), 'excludes .DS_Store file');
  assert(shouldExclude(STAMP_FILENAME, false), 'excludes stamp file');
  assert(shouldExclude('debug.log', false), 'excludes *.log files');
  assert(shouldExclude('cache.pyc', false), 'excludes *.pyc files');
  assert(!shouldExclude('SKILL.md', false), 'keeps SKILL.md');
  assert(!shouldExclude('config.json', false), 'keeps config.json');
  assert(!shouldExclude('prompts', true), 'keeps prompts dir');

  // Test 5: Skill discovery
  console.log('\nSkill Discovery:');
  const repoRoot = getRepoRoot();
  const skills = discoverSkills(repoRoot);
  assert(skills.includes('lessons-extractor'), 'finds lessons-extractor skill');
  assert(skills.length >= 1, 'finds at least one skill');

  // Test 6: Hash function
  console.log('\nHashing:');
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `skills-sync-test-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, 'test content for hashing');
  const hash = hashFile(tempFile);
  assert(hash.startsWith('sha256:'), 'hash has sha256 prefix');
  assert(hash.length === 7 + 64, 'hash has correct length (sha256: + 64 hex)');
  fs.unlinkSync(tempFile);

  // Test 7: Target path resolution
  console.log('\nTarget Path Resolution:');
  const target = resolveTargetPath('/home/user/myproject', 'test-skill');
  assert(target.includes('.claude'), 'target includes .claude');
  assert(target.includes('skills'), 'target includes skills');
  assert(target.includes('test-skill'), 'target includes skill name');

  // Test 8: Delete safety
  console.log('\nDelete Safety:');
  const allowedRoot = '/project/.claude/skills';
  assert(isDeleteSafe(allowedRoot, '/project/.claude/skills/foo'), 'allows delete in allowed root');
  assert(!isDeleteSafe(allowedRoot, '/project/.claude'), 'rejects delete outside allowed root');
  assert(!isDeleteSafe(allowedRoot, '/other/path'), 'rejects delete in different tree');

  // Test 9: Validation
  console.log('\nValidation:');
  try {
    validateArgs({ skill: 'x', all: true, project: '/tmp' });
    assert(false, 'rejects --skill with --all');
  } catch {
    assert(true, 'rejects --skill with --all');
  }
  try {
    validateArgs({ force: true, merge: true, project: '/tmp', skill: 'x' });
    assert(false, 'rejects --force with --merge');
  } catch {
    assert(true, 'rejects --force with --merge');
  }
  try {
    validateArgs({ uninstall: true, all: true, project: '/tmp' });
    assert(false, 'rejects --uninstall with --all');
  } catch {
    assert(true, 'rejects --uninstall with --all');
  }
  try {
    validateArgs({ project: '/', skill: 'x' });
    assert(false, 'rejects unsafe project path');
  } catch {
    assert(true, 'rejects unsafe project path');
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

    if (opts.help) {
      printHelp();
      process.exit(0);
    }

    if (opts.selfTest) {
      runSelfTest();
      return;
    }

    if (opts.list) {
      listSkills();
      process.exit(0);
    }

    verboseEnabled = opts.verbose;
    validateArgs(opts);

    const repoRoot = getRepoRoot();
    const availableSkills = discoverSkills(repoRoot);
    const skills = opts.all ? availableSkills : [opts.skill];

    // Validate specified skill exists
    if (opts.skill && !availableSkills.includes(opts.skill)) {
      throw new Error(`Unknown skill: ${opts.skill}\nAvailable: ${availableSkills.join(', ')}`);
    }

    // Handle uninstall
    if (opts.uninstall) {
      uninstallSkill(opts.skill, opts);
      process.exit(0);
    }

    // Handle check mode
    if (opts.check) {
      let allOk = true;
      for (const skill of skills) {
        if (!checkSkill(skill, opts)) {
          allOk = false;
        }
      }
      process.exit(allOk ? 0 : 1);
    }

    // Handle install/update
    for (const skill of skills) {
      copySkill(skill, opts);
    }

  } catch (err) {
    log('error', err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
