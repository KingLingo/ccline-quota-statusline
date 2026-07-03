import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

const WRAPPER = new URL('../quota-wrapper.mjs', import.meta.url).pathname;

async function withUsageServer(handler, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await fn({ baseUrl: `http://127.0.0.1:${port}`, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runQuota(env) {
  const child = spawn(process.execPath, [WRAPPER, '--quota'], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      QUOTA_MODE: 'stacked',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, stdout, stderr };
}

test('standalone quota reads Claude settings.local.json credentials', async () => {
  await withUsageServer((req, res) => {
    assert.equal(req.url, '/v1/usage');
    assert.equal(req.headers.authorization, 'Bearer claude-test-key');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        remaining: 42.5,
        unit: 'USD',
        planName: 'Claude - Pro',
        subscription: {
          daily_usage_usd: 5,
          daily_limit_usd: 10,
          weekly_usage_usd: 7,
          weekly_limit_usd: 70,
        },
      }),
    );
  }, async ({ baseUrl, requests }) => {
    const home = await mkdtemp(join(tmpdir(), 'ccline-quota-claude-'));
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(
      join(home, '.claude', 'settings.local.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: baseUrl,
          ANTHROPIC_API_KEY: 'claude-test-key',
        },
      }),
    );

    const result = await runQuota({ HOME: home, USERPROFILE: home });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.match(result.stdout, /Daily\s+/);
    assert.match(result.stdout, /Weekly\s+/);
    assert.match(result.stdout, /\$42\.50 left/);
    assert.match(result.stdout, /Claude - Pro/);
  });
});

test('standalone quota ignores Codex OpenAI config without Claude credentials', async () => {
  await withUsageServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ remaining: 99, unit: 'USD', planName: 'Codex - Pro' }));
  }, async ({ baseUrl, requests }) => {
    const home = await mkdtemp(join(tmpdir(), 'ccline-quota-no-codex-'));
    await mkdir(join(home, '.codex'), { recursive: true });
    await writeFile(
      join(home, '.codex', 'config.toml'),
      [
        'model_provider = "custom"',
        '',
        '[model_providers.custom]',
        `base_url = "${baseUrl}/v1"`,
        'wire_api = "responses"',
      ].join('\n'),
    );
    await writeFile(
      join(home, '.codex', 'auth.json'),
      JSON.stringify({ OPENAI_API_KEY: 'codex-test-key' }),
    );

    const result = await runQuota({ HOME: home, USERPROFILE: home });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests.length, 0);
    assert.equal(result.stdout, '');
  });
});

test('quota_limited Sub2API rate_limits render as quota bars', async () => {
  await withUsageServer((req, res) => {
    assert.equal(req.url, '/v1/usage');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        mode: 'quota_limited',
        remaining: 12,
        unit: 'USD',
        quota: { limit: 20, used: 8, remaining: 12, unit: 'USD' },
        rate_limits: [
          { window: '5h', limit: 100, used: 25, remaining: 75 },
          { window: '1d', limit: 200, used: 100, remaining: 100 },
          { window: '7d', limit: 700, used: 35, remaining: 665 },
        ],
      }),
    );
  }, async ({ baseUrl }) => {
    const home = await mkdtemp(join(tmpdir(), 'ccline-quota-rates-'));
    const result = await runQuota({
      HOME: home,
      USERPROFILE: home,
      QUOTA_BASE_URL: baseUrl,
      QUOTA_API_KEY: 'rate-test-key',
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^5h\s+/m);
    assert.match(result.stdout, /^Daily\s+/m);
    assert.match(result.stdout, /^Weekly\s+/m);
    assert.match(result.stdout, /\$12\.00 left/);
  });
});
