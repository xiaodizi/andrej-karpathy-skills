#!/usr/bin/env node

/**
 * install-karpathy.mjs
 *
 * Install Karpathy behavioral guidelines globally for:
 *   - Codex      (~/.codex/AGENTS.md)
 *   - OpenCode   (~/.config/opencode/AGENTS.md + opencode.json instructions)
 *   - Cursor     (~/.cursor/rules/karpathy-guidelines.mdc)
 *   - Claude Code (~/.claude/CLAUDE.md)
 *
 * Idempotent – uses HTML comment markers so it never duplicates content.
 *
 * Usage:
 *   node install-karpathy.mjs
 *   npx github:xiaodizi/andrej-karpathy-skills
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { argv, exit } from 'process';

// ---- paths ----

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const MARKER_START = '<!-- KARPATHY_GUIDELINES_START -->';
const MARKER_END   = '<!-- KARPATHY_GUIDELINES_END -->';

// ---- read source content ----

let principlesSource;

// 1. Try sibling CLAUDE.md (works from repo checkout, npx github:, npm publish)
const localClaude = resolve(__dirname, 'CLAUDE.md');
if (existsSync(localClaude)) {
  principlesSource = readFileSync(localClaude, 'utf-8');
  console.log(`  📖 Reading principles from ${localClaude}`);
} else {
  console.error('  ❌ CLAUDE.md not found alongside this script.');
  console.error('     Make sure it is in the same directory as install-karpathy.mjs.');
  exit(1);
}

// Normalise: replace "# CLAUDE.md" title with generic title for global install
principlesSource = principlesSource.replace(/^#\s+CLAUDE\.md/m, '# Karpathy Behavioral Guidelines');

// Derive the Cursor-ready content (with frontmatter)
const cursorFrontmatter = `---
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
alwaysApply: true
---`;

// ---- content detection ----

/**
 * Classify how the principles appear in an existing file.
 *
 *   marker    → markers are present (managed by this script)
 *   complete  → all 4 principles found without markers
 *   partial   → some (1-3) of the 4 principles found
 *   absent    → none detected
 */
function getPrinciplesState(text) {
  if (!text) return 'absent';
  if (text.includes(MARKER_START)) return 'marker';

  const sections = [
    { heading: 'Think Before Coding', statement: "Don't assume. Don't hide confusion" },
    { heading: 'Simplicity First',    statement: 'Minimum code that solves the problem' },
    { heading: 'Surgical Changes',    statement: 'Touch only what you must' },
    { heading: 'Goal-Driven Execution', statement: 'Define success criteria. Loop until verified' },
  ];

  const presentCount = sections.filter(
    s => text.includes(s.heading) || text.includes(s.statement),
  ).length;

  if (presentCount === 0)                return 'absent';
  if (presentCount < sections.length)    return 'partial';
  return 'complete';
}

// ---- helpers ----

/**
 * Write (or update) a file with marker-delimited content.
 *
 *   absent    → create / append with markers
 *   marker    → replace content between markers (always up-to-date)
 *   complete  → skip – already present
 *   partial   → skip – present but incomplete; adding more risks duplication
 */
function upsertContent(filePath, bodyContent, prependHeader = '') {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  let existing = '';
  if (existsSync(filePath)) {
    existing = readFileSync(filePath, 'utf-8');
  }

  const state = getPrinciplesState(existing);
  let result;
  let action;

  if (state === 'marker') {
    // Replace content between existing markers (always clean update)
    const before = existing.split(MARKER_START)[0];
    const after  = existing.includes(MARKER_END) ? existing.split(MARKER_END).slice(1).join(MARKER_END) : '';
    const wrapped = `${MARKER_START}\n${bodyContent}\n${MARKER_END}`;
    result = `${before}${wrapped}${after}`;
    action = 'updated';
  } else if (state === 'complete') {
    // Already fully present – skip
    return 'exists';
  } else if (state === 'partial') {
    // Partially present – skip to avoid any risk of duplication
    return 'partial';
  } else {
    // absent – fresh install (new file or no trace of the content)
    const wrapped = `${MARKER_START}\n${bodyContent}\n${MARKER_END}`;
    if (!existing) {
      result = prependHeader
        ? `${prependHeader}\n\n${wrapped}\n`
        : `${wrapped}\n`;
      action = 'created';
    } else {
      const sep = existing.endsWith('\n') ? '' : '\n';
      result = `${existing}${sep}\n${wrapped}\n`;
      action = 'appended';
    }
  }

  writeFileSync(filePath, result, 'utf-8');
  return action;
}

/** Update the `instructions` array in opencode.json so it references AGENTS.md. */
function ensureOpencodeInstructions(configDir, agentsFilename) {
  const configPath = join(configDir, 'opencode.json');
  const instructionsPath = agentsFilename; // relative to configDir

  let config = {};

  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  }

  // Ensure $schema
  if (!config.$schema) {
    config.$schema = 'https://opencode.ai/config.json';
  }

  if (!Array.isArray(config.instructions)) {
    config.instructions = [];
  }

  const alreadyIncluded = config.instructions.some(
    p => p === instructionsPath || p.endsWith('/' + instructionsPath) || p.endsWith('\\' + instructionsPath)
  );

  if (!alreadyIncluded) {
    config.instructions.push(instructionsPath);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return 'updated';
  }

  return 'unchanged';
}

// ---- detection ----

/**
 * Check whether a tool appears to be installed on this machine.
 * Looks for the presence of its config directory AND its CLI command.
 */
function isDetected(name, configDirPaths, cliCommands) {
  // Config directory check
  for (const p of configDirPaths) {
    if (existsSync(p)) return true;
  }
  // CLI check
  for (const cmd of cliCommands) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch { /* not found */ }
  }
  return false;
}

// ---- targets ----

const targets = [];

// 1. Codex (~/.codex/AGENTS.md)
targets.push({
  name: 'Codex',
  detect: () => isDetected('Codex', [join(HOME, '.codex')], ['codex']),
  file: join(HOME, '.codex', 'AGENTS.md'),
  install: () => upsertContent(join(HOME, '.codex', 'AGENTS.md'), principlesSource),
});

// 2. OpenCode (~/.config/opencode/AGENTS.md + opencode.json)
targets.push({
  name: 'OpenCode (AGENTS.md)',
  detect: () => isDetected('OpenCode', [join(HOME, '.config', 'opencode')], ['opencode']),
  file: join(HOME, '.config', 'opencode', 'AGENTS.md'),
  install: () => upsertContent(join(HOME, '.config', 'opencode', 'AGENTS.md'), principlesSource),
});
targets.push({
  name: 'OpenCode (opencode.json)',
  detect: () => isDetected('OpenCode', [join(HOME, '.config', 'opencode')], ['opencode']),
  file: join(HOME, '.config', 'opencode', 'opencode.json'),
  install: () => ensureOpencodeInstructions(join(HOME, '.config', 'opencode'), 'AGENTS.md'),
});

// 3. Cursor (~/.cursor/rules/karpathy-guidelines.mdc)
targets.push({
  name: 'Cursor',
  detect: () => isDetected('Cursor', [join(HOME, '.cursor'), '/Applications/Cursor.app'], ['cursor']),
  file: join(HOME, '.cursor', 'rules', 'karpathy-guidelines.mdc'),
  install: () => upsertContent(
    join(HOME, '.cursor', 'rules', 'karpathy-guidelines.mdc'),
    principlesSource,
    cursorFrontmatter,
  ),
});

// 4. Claude Code (~/.claude/CLAUDE.md)
targets.push({
  name: 'Claude Code',
  detect: () => isDetected('Claude Code', [join(HOME, '.claude')], ['claude', 'claude-code']),
  file: join(HOME, '.claude', 'CLAUDE.md'),
  install: () => upsertContent(join(HOME, '.claude', 'CLAUDE.md'), principlesSource),
});

// ---- run ----

console.log('');
console.log('  Installing Karpathy Behavioral Guidelines globally…\n');

let ok = 0;
let skip = 0;
let fail = 0;

for (const t of targets) {
  if (!t.detect()) {
    console.log(`  ⏭️  ${t.name}: not detected, skipped`);
    skip++;
    continue;
  }
  try {
    const verb = t.install();
    const label = verb === 'created' ? '✅' : verb === 'updated' ? '🔄' : verb === 'appended' ? '➕' : verb === 'exists' ? '✓' : verb === 'partial' ? '⚠️' : '✓';
    const msg = verb === 'partial'
      ? `${label} ${t.name}: ${t.file.replace(HOME, '~')}  (partial content exists – skipped to avoid duplication)`
      : `${label} ${t.name}: ${t.file.replace(HOME, '~')}  (${verb})`;
    console.log(`  ${msg}`);
    ok++;
  } catch (err) {
    console.error(`  ❌ ${t.name}: ${err.message}`);
    fail++;
  }
}

console.log('');
if (fail === 0) {
  console.log(`  ✅ Done! (${ok} installed, ${skip} skipped) Restart each tool for changes to take effect.\n`);
} else {
  console.log(`  ⚠️  Done with ${fail} error(s). (${ok} installed, ${skip} skipped)\n`);
}
