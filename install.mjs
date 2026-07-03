#!/usr/bin/env node
// Cross-platform installer for ccline-quota-statusline (macOS / Linux / Windows).
//
// What it does:
//   1. Ensures `@nekoline/ccline` (CCometixLine) is installed (npm -g) if missing.
//   2. Copies quota-wrapper.mjs (+ config.toml on first install) into ~/.claude/ccline/.
//   3. Wires the wrapper into Claude Code's status line by writing `statusLine`
//      into ~/.claude/settings.local.json (NOT settings.json — Claude Code rewrites
//      settings.json and drops the statusLine key; the .local override survives).
//
// Usage:  node install.mjs
// Then FULLY quit and relaunch Claude Code (a new session in a running app is not enough).

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const CCLINE_DIR = join(HOME, '.claude', 'ccline');
const CLAUDE_DIR = join(HOME, '.claude');
const isWin = platform() === 'win32';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function stamp() {
  // Avoid characters that are illegal in Windows filenames (":").
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// 1) Ensure ccline is installed ------------------------------------------------
function cclineInstalled() {
  const local = join(CCLINE_DIR, isWin ? 'ccline.exe' : 'ccline');
  if (existsSync(local)) return true;
  try {
    execSync(isWin ? 'where ccline' : 'command -v ccline', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!cclineInstalled()) {
  log('• @nekoline/ccline not found — installing globally via npm …');
  try {
    execSync('npm install -g @nekoline/ccline', { stdio: 'inherit' });
  } catch {
    log('  ⚠  npm install failed. Install it yourself, then re-run:');
    log('       npm install -g @nekoline/ccline');
  }
} else {
  log('• ccline already installed ✓');
}

// 2) Copy wrapper (+ config on first install) ---------------------------------
mkdirSync(CCLINE_DIR, { recursive: true });

copyFileSync(join(HERE, 'quota-wrapper.mjs'), join(CCLINE_DIR, 'quota-wrapper.mjs'));
log(`• Copied quota-wrapper.mjs -> ${join(CCLINE_DIR, 'quota-wrapper.mjs')}`);

const cfgDest = join(CCLINE_DIR, 'config.toml');
if (!existsSync(cfgDest)) {
  copyFileSync(join(HERE, 'config.toml'), cfgDest);
  log(`• Installed default config.toml -> ${cfgDest}`);
} else {
  log('• Kept existing config.toml (not overwritten)');
}

// 3) Wire statusLine into settings.local.json ---------------------------------
const wrapperPath = join(CCLINE_DIR, 'quota-wrapper.mjs');
const quote = (s) => `"${s}"`; // keep native separators; JSON.stringify escapes them
// Prefer bare `node` (on PATH, survives Node upgrades, works on Windows too).
// If your status-line subprocess has no `node` on PATH, swap in an absolute path.
const command = `node ${quote(wrapperPath)}`;

const settingsPath = join(CLAUDE_DIR, 'settings.local.json');
let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    copyFileSync(settingsPath, `${settingsPath}.bak-${stamp()}`);
  } catch {
    log('  ⚠  Existing settings.local.json is not valid JSON — leaving it untouched.');
    log('     Add this statusLine block manually:');
    log(`       ${JSON.stringify({ statusLine: { type: 'command', command, padding: 0 } })}`);
    process.exit(1);
  }
}

settings.statusLine = { type: 'command', command, padding: 0 };
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
log(`• Wrote statusLine -> ${settingsPath}`);
log(`    command: ${command}`);

log('');
log('✅ Done. Now FULLY quit and relaunch Claude Code (not just a new session).');
log('   Toggle layout anytime with env QUOTA_MODE=stacked|compact|off');
