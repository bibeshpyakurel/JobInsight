/**
 * Smoke and access-control tests for the JobInsight proxy.
 *
 * The proxy exists so the OpenAI key never ships inside the extension. The
 * thing worth testing is therefore not the analysis itself but the gate in
 * front of it: only the configured extension origin may reach /api/analyze.
 * These tests pin that behaviour so a future CORS refactor cannot quietly
 * open the proxy to any caller.
 *
 * Uses the Node built-in test runner and fetch — no test dependencies.
 * Run with: npm test
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 45871;
const BASE = `http://127.0.0.1:${PORT}`;
const EXTENSION_ID = 'aaaabbbbccccddddeeeeffffgggghhhh';

let server;

/** Poll the health endpoint until the server answers or we give up. */
async function waitForReady(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      EXTENSION_ID,
      // Deliberately no OPENAI_API_KEY: these tests must never reach OpenAI.
      OPENAI_API_KEY: '',
    },
    stdio: 'ignore',
  });
  await waitForReady();
});

after(() => {
  if (server) server.kill();
});

describe('health', () => {
  test('GET /api/health reports ok', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  test('GET / advertises where the health endpoint lives', async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(
      body.health,
      '/api/health',
      'the root document must point at the real health path',
    );
  });
});

describe('/api/analyze access control', () => {
  test('rejects a request with no Origin header', async () => {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobDescription: 'hello' }),
    });
    assert.equal(res.status, 403, 'a caller with no Origin is not the extension');
  });

  test('rejects a request from a different extension id', async () => {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'chrome-extension://someoneelsesextensionidhere00',
      },
      body: JSON.stringify({ jobDescription: 'hello' }),
    });
    assert.equal(res.status, 403);
  });

  test('rejects a request from an ordinary web page', async () => {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://example.com',
      },
      body: JSON.stringify({ jobDescription: 'hello' }),
    });
    assert.equal(res.status, 403);
  });

  test('lets the configured extension origin past the gate', async () => {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `chrome-extension://${EXTENSION_ID}`,
      },
      body: JSON.stringify({ jobDescription: 'hello' }),
    });
    // It gets past the origin check, then fails further in because this test
    // run has no OpenAI key and sends no auth token. Anything other than 403
    // proves the gate opened for the right caller.
    assert.notEqual(res.status, 403, 'the configured extension must not be blocked');
  });
});

describe('request limits', () => {
  test('rejects a body over the 16kb JSON limit', async () => {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `chrome-extension://${EXTENSION_ID}`,
      },
      body: JSON.stringify({ jobDescription: 'x'.repeat(40_000) }),
    });
    assert.equal(res.status, 413, 'oversized payloads must be refused, not proxied');
  });
});
