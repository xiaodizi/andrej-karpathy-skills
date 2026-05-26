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

/** Key phrases that indicate the principles are already present in a file. */
const PRINCIPLES_SIGNALS = [
  'Think Before Coding',
  'Simplicity First',
  'Surgical Changes',
  'Goal-Driven Execution',
  "Don't assume. Don't hide confusion",
  'Minimum code that solves the problem',
  'Touch only what you must',
  'Define success criteria. Loop until verified',
];

function principlesExist(text) {
  const hits = PRINCIPLES_SIGNALS.filter(s => text.includes(s)).length;
  return hits >= 2;  // 2+ matches → likely already there
}

// ---- helpers ----

/**
 * Write (or update) a file with marker-delimited content.
 *   - If file is absent → create with markers.
 *   - If markers exist  → replace content between them (update).
 *   - If file exists but no markers → append.
 */
function upsertContent(filePath, bodyContent, prependHeader = '') {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  let existing = '';
  if (existsSync(filePath)) {
    existing = readFileSync(filePath, 'utf-8');
  }

  const wrapped = `${MARKER_START}\n${bodyContent}\n${MARKER_END}`;
  let result;
  let action;

  if (!existing) {
    // Brand new file
    result = prependHeader
      ? `${prependHeader}\n\n${wrapped}\n`
      : `${wrapped}\n`;
    action = 'created';
  } else if (existing.includes(MARKER_START)) {
    // Replace content between markers
    const before = existing.split(MARKER_START)[0];
    const after  = existing.includes(MARKER_END) ? existing.split(MARKER_END).slice(1).join(MARKER_END) : '';
    result = `${before}${wrapped}${after}`;
    action = 'updated';
  } else if (principlesExist(existing)) {
    // Content already present without markers – skip to avoid duplication
    action = 'exists';
    return action; // early return – don't touch the file
  } else {
    // Append
    const sep = existing.endsWith('\n') ? '' : '\n';
    result = `${existing}${sep}\n${wrapped}\n`;
    action = 'appended';
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
    const icon = verb === 'created' ? '✅' : verb === 'updated' ? '🔄' : verb === 'appended' ? '➕' : verb === 'exists' ? '✓' : '✓';
    console.log(`  ${icon} ${t.name}: ${t.file.replace(HOME, '~')}  (${verb})`);
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
