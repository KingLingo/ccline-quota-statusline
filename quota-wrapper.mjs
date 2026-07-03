#!/usr/bin/env node
// ccline-quota-statusline — wraps the `@nekoline/ccline` (CCometixLine) binary and
// appends API spend-quota progress bars, sourced from a Sub2API-style gateway's
// self-service `GET /v1/usage` endpoint (Authorization: Bearer <ANTHROPIC_API_KEY>).
// No admin credentials required.
//
// Cross-platform (macOS / Linux / Windows). Renders under ccline's normal line:
//    <ccline: model | dir | git | context | cost>
//    Daily   █░░░░░░░░░░░░░   3%  $67.8 left  Claude - 300档
//    Weekly  █░░░░░░░░░░░░░   1%
//    Monthly ░░░░░░░░░░░░░░  <1%
//
// Bar coloring follows claude-hud semantics; layout + color scheme designed with
// GPT-5.5. Alignment: Claude Code strips each row's leading whitespace and applies
// its own uniform indent, so rows carry NO leading spaces and start directly with
// an equal-width (padEnd) label — bars line up whether or not the host re-indents,
// with no dependence on emoji/font width. Empty cells dim-gray; labels/metadata
// stay terminal-default for legibility on light and dark backgrounds (incl. Windows).
//
// Env toggles:
//   QUOTA_MODE=stacked|compact|off   force a layout (default: auto by width)
//   QUOTA_BASE_URL / QUOTA_API_KEY   override gateway creds (else read from
//                                    ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY)

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const CCLINE_DIR = join(HOME, '.claude', 'ccline');
const CACHE_PATH = join(CCLINE_DIR, '.quota_cache.json');
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 2500;
const NARROW_COLS = 72; // below this terminal width -> compact single row

// ---------- ANSI ----------
const E = '\x1b';
const RESET = `${E}[0m`;
const RED = `${E}[31m`;
const BRIGHT_MAGENTA = `${E}[95m`;
const BRIGHT_BLUE = `${E}[94m`;
const DIM_GRAY = `${E}[2;90m`;

// ---------- locate the real ccline binary (platform-aware) ----------
function cclineTarget() {
  const name = platform() === 'win32' ? 'ccline.exe' : 'ccline';
  const local = join(CCLINE_DIR, name);
  if (existsSync(local)) return { cmd: local, shell: false };
  return { cmd: 'ccline', shell: true }; // fall back to the npm global shim on PATH
}

function runCcline(inputJson) {
  const { cmd, shell } = cclineTarget();
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, [], { stdio: ['pipe', 'pipe', 'ignore'], shell });
    } catch {
      return resolve('');
    }
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => resolve(out));
    child.on('error', () => resolve(''));
    try {
      child.stdin.write(inputJson);
      child.stdin.end();
    } catch {
      /* ignore */
    }
  });
}

// ---------- gateway creds ----------
function readJsonSafe(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function firstValue(...values) {
  return values.find((v) => typeof v === 'string' && v.trim() !== '');
}

function loadGatewayEnv() {
  const settingsEnv = readJsonSafe(join(HOME, '.claude', 'settings.json')).env || {};
  const localEnv = readJsonSafe(join(HOME, '.claude', 'settings.local.json')).env || {};

  const claudeBaseUrl = firstValue(
    process.env.ANTHROPIC_BASE_URL,
    localEnv.ANTHROPIC_BASE_URL,
    settingsEnv.ANTHROPIC_BASE_URL,
  );
  const claudeApiKey = firstValue(
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
    localEnv.ANTHROPIC_API_KEY,
    localEnv.ANTHROPIC_AUTH_TOKEN,
    settingsEnv.ANTHROPIC_API_KEY,
    settingsEnv.ANTHROPIC_AUTH_TOKEN,
  );

  return {
    baseUrl: process.env.QUOTA_BASE_URL || claudeBaseUrl,
    apiKey: process.env.QUOTA_API_KEY || claudeApiKey,
  };
}

const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

function usageEndpoint(baseUrl) {
  const b = cleanInline(baseUrl).replace(/\/+$/, '');
  if (!b) return '';
  return /\/v1$/i.test(b) ? `${b}/usage` : `${b}/v1/usage`;
}

function normalizeRateLimits(d) {
  const src = Array.isArray(d.rate_limits) ? d.rate_limits : [];
  return src
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const limit = num(r.limit);
      const used = num(r.used);
      if (limit === undefined || used === undefined || limit <= 0) return null;
      return {
        window: cleanInline(r.window || r.name || r.label),
        used,
        limit,
      };
    })
    .filter(Boolean);
}

async function fetchQuota(baseUrl, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(usageEndpoint(baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const d = await res.json();
    const sub = d.subscription && typeof d.subscription === 'object' ? d.subscription : {};
    const quota = d.quota && typeof d.quota === 'object' ? d.quota : {};
    const snap = {
      remaining: num(d.remaining) ?? num(quota.remaining),
      unit: d.unit || quota.unit || 'USD',
      planName: typeof d.planName === 'string' ? d.planName : null,
      subscription: {
        daily_usage_usd: num(sub.daily_usage_usd),
        daily_limit_usd: num(sub.daily_limit_usd),
        weekly_usage_usd: num(sub.weekly_usage_usd),
        weekly_limit_usd: num(sub.weekly_limit_usd),
        monthly_usage_usd: num(sub.monthly_usage_usd),
        monthly_limit_usd: num(sub.monthly_limit_usd),
      },
      rate_limits: normalizeRateLimits(d),
      quota: {
        used: num(quota.used),
        limit: num(quota.limit),
      },
      fetchedAt: Date.now(),
    };
    const s = snap.subscription;
    const hasWindow = s.daily_limit_usd || s.weekly_limit_usd || s.monthly_limit_usd;
    const hasRateLimit = snap.rate_limits.length > 0;
    const hasQuota = snap.quota.used !== undefined && snap.quota.limit !== undefined && snap.quota.limit > 0;
    if (!hasWindow && !hasRateLimit && !hasQuota && snap.remaining === undefined) return null;
    return snap;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getQuota(baseUrl, apiKey) {
  let cache = null;
  try {
    cache = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
  } catch {
    /* no cache yet */
  }
  if (cache && typeof cache.fetchedAt === 'number' && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  const fresh = await fetchQuota(baseUrl, apiKey);
  if (fresh) {
    writeFile(CACHE_PATH, JSON.stringify(fresh)).catch(() => {});
    return fresh;
  }
  return cache; // serve stale rather than nothing on a transient failure
}

// ---------- rendering (design: claude-hud semantics + GPT-5.5 layout) ----------
const WIDTH = 14; // stacked bar width in cells
const WIDTH_COMPACT = 6; // compact bar width in cells
const LABEL_WIDTH = 7; // "Monthly" is the longest window label
// NB: Claude Code strips leading whitespace from each status-line row and applies
// its own uniform indent, so alignment must NOT rely on leading spaces. Every row
// therefore starts directly with its equal-width (padEnd) label — no gutter.

const WINDOWS = [
  ['Daily', 'daily_usage_usd', 'daily_limit_usd'],
  ['Weekly', 'weekly_usage_usd', 'weekly_limit_usd'],
  ['Monthly', 'monthly_usage_usd', 'monthly_limit_usd'],
];

function cleanInline(v) {
  return String(v == null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fillColor(pct) {
  if (pct >= 90) return RED;
  if (pct >= 75) return BRIGHT_MAGENTA;
  return BRIGHT_BLUE;
}

function formatPercent(pct) {
  if (!Number.isFinite(pct)) return '';
  if (pct > 999) return '999%';
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

function formatMoney(amount, unit) {
  const u = cleanInline(unit || 'USD');
  return u === 'USD' ? `$${amount.toFixed(2)}` : `${amount.toFixed(2)} ${u}`;
}

function bar(pct, width) {
  const p = Math.max(0, Math.min(100, pct));
  let filled = Math.round((p / 100) * width);
  if (p >= 1 && filled === 0) filled = 1; // keep low-but-nonzero usage visible
  const empty = width - filled;
  const filledPart = filled > 0 ? `${fillColor(pct)}${'█'.repeat(filled)}${RESET}` : '';
  const emptyPart = empty > 0 ? `${DIM_GRAY}${'░'.repeat(empty)}${RESET}` : '';
  return filledPart + emptyPart;
}

function windowsFrom(q) {
  const sub = (q && q.subscription) || {};
  const out = [];
  for (const [label, usedKey, limitKey] of WINDOWS) {
    const used = num(sub[usedKey]);
    const limit = num(sub[limitKey]);
    if (used === undefined || limit === undefined || limit <= 0) continue;
    out.push({ label, pct: Math.max(0, (used / limit) * 100) });
  }
  if (out.length) return out;
  for (const r of Array.isArray(q?.rate_limits) ? q.rate_limits : []) {
    const label = rateLimitLabel(r.window);
    out.push({ label, pct: Math.max(0, (r.used / r.limit) * 100) });
  }
  if (out.length) return out;
  const quotaUsed = num(q?.quota?.used);
  const quotaLimit = num(q?.quota?.limit);
  if (quotaUsed !== undefined && quotaLimit !== undefined && quotaLimit > 0) {
    out.push({ label: 'Quota', pct: Math.max(0, (quotaUsed / quotaLimit) * 100) });
  }
  return out;
}

function rateLimitLabel(window) {
  const w = cleanInline(window).toLowerCase();
  if (w === '1d' || w === '24h' || w === 'day' || w === 'daily') return 'Daily';
  if (w === '7d' || w === 'week' || w === 'weekly') return 'Weekly';
  if (w === '30d' || w === 'month' || w === 'monthly') return 'Monthly';
  return cleanInline(window || 'Limit').slice(0, LABEL_WIDTH) || 'Limit';
}

function metaFrom(q) {
  const meta = [];
  if (num(q.remaining) !== undefined) meta.push(`${formatMoney(q.remaining, q.unit)} left`);
  const plan = cleanInline(q.planName || '');
  if (plan) meta.push(plan);
  return meta;
}

function renderStacked(q) {
  const wins = windowsFrom(q);
  const meta = metaFrom(q);
  if (!wins.length) return meta.length ? [meta.join('  ')] : [];
  const rows = wins.map(({ label, pct }) => {
    const pctStr = formatPercent(pct).padStart(4, ' ');
    return `${label.padEnd(LABEL_WIDTH)} ${bar(pct, WIDTH)} ${pctStr}`;
  });
  if (meta.length) rows[0] += `  ${meta.join('  ')}`;
  return rows;
}

function renderCompact(q) {
  const wins = windowsFrom(q);
  const meta = metaFrom(q);
  const short = { Daily: 'D', Weekly: 'W', Monthly: 'M', Quota: 'Q' };
  const parts = wins.map(
    ({ label, pct }) => `${short[label] || label} ${bar(pct, WIDTH_COMPACT)} ${formatPercent(pct)}`,
  );
  if (!parts.length && !meta.length) return [];
  const segs = [];
  if (parts.length) segs.push(parts.join(`${DIM_GRAY} · ${RESET}`));
  if (meta.length) segs.push(meta.join('  '));
  return [segs.join('  ')];
}

function terminalCols() {
  const c = Number(process.env.COLUMNS) || process.stdout.columns;
  return Number.isFinite(c) && c > 0 ? c : null;
}

function renderQuotaRows(q, standalone = false) {
  if (!q) return [];
  try {
    let mode = (process.env.QUOTA_MODE || '').toLowerCase();
    // In standalone (`--quota`) mode the user asked to see quota, so never hide it.
    if (standalone && (mode === '' || mode === 'off')) mode = 'stacked';
    if (mode === 'off') return [];
    if (mode === 'compact') return renderCompact(q);
    if (mode === 'stacked') return renderStacked(q);
    const cols = terminalCols();
    return cols != null && cols < NARROW_COLS ? renderCompact(q) : renderStacked(q);
  } catch {
    return [];
  }
}

// ---------- main ----------
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    [
      'ccline-quota-statusline — API spend-quota progress bars',
      '',
      'As a Claude Code status line (stdin = status JSON):',
      '  set settings.local.json statusLine.command = node "<path>/quota-wrapper.mjs"',
      '',
      'Standalone (print quota bars in any terminal):',
      '  node quota-wrapper.mjs --quota',
      '',
      'Env: QUOTA_MODE=stacked|compact|off  QUOTA_BASE_URL=  QUOTA_API_KEY=',
    ].join('\n') + '\n',
  );
  process.exit(0);
}

// Standalone mode: explicit --quota/--standalone, or an interactive TTY (no piped
// status JSON). Prints only the quota bars — skips ccline and the stdin wait.
const standalone =
  argv.includes('--quota') || argv.includes('--standalone') || Boolean(process.stdin.isTTY);

const { baseUrl, apiKey } = loadGatewayEnv();
const stdinData = standalone ? '' : await readStdin();

const [baseLine, quota] = await Promise.all([
  standalone ? Promise.resolve('') : runCcline(stdinData),
  baseUrl && apiKey ? getQuota(baseUrl, apiKey) : Promise.resolve(null),
]);

const rows = renderQuotaRows(quota, standalone);
const lines = standalone ? rows : [baseLine.replace(/\n+$/, ''), ...rows];
process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
