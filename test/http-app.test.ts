import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createHttpApp } from '../src/http-app.js';
import type { ContentService } from '../src/service.js';

async function withServer(callback: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = createHttpApp({ readiness: async () => undefined } as ContentService, 'a'.repeat(32), '100b');
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('HTTP MCP rejects missing and invalid bearer tokens with structured errors', async () => {
  await withServer(async (baseUrl) => {
    for (const authorization of [undefined, 'Bearer wrong']) {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
        body: '{}',
      });
      assert.equal(response.status, 401);
      const body = await response.json() as any;
      assert.equal(body.error.code, 'UNAUTHORIZED');
    }
  });
});

test('HTTP MCP enforces request body limit with structured error', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${'a'.repeat(32)}` },
      body: JSON.stringify({ payload: 'x'.repeat(200) }),
    });
    assert.equal(response.status, 413);
    const body = await response.json() as any;
    assert.equal(body.error.code, 'REQUEST_TOO_LARGE');
  });
});

test('HTTP MCP rejects browser origins unless explicitly allowlisted', async () => {
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'https://console.example.com';
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${'a'.repeat(32)}`,
          origin: 'https://evil.example.com',
        },
        body: '{}',
      });
      assert.equal(response.status, 403);
      const body = await response.json() as any;
      assert.equal(body.error.code, 'FORBIDDEN_ORIGIN');
    });
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous;
  }
});

test('health endpoints include hardened response headers', async () => {
  await withServer(async (baseUrl) => {
    for (const path of ['/health', '/ready']) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });
});

test('HTTP MCP applies a structured per-client rate limit', async () => {
  const previous = process.env.RATE_LIMIT_MAX;
  process.env.RATE_LIMIT_MAX = '1';
  try {
    await withServer(async (baseUrl) => {
      const request = () => fetch(`${baseUrl}/mcp`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal((await request()).status, 401);
      const limited = await request();
      assert.equal(limited.status, 429);
      assert.equal(((await limited.json()) as any).error.code, 'RATE_LIMITED');
    });
  } finally {
    if (previous === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = previous;
  }
});
