import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedBody, checkOrigin, SerialQueue } from '../worker/src/request-security.js';
import { toStructuredError } from '../src/errors.js';

test('Worker measures streamed body without trusting Content-Length', async () => {
  for (const headers of [new Headers(), new Headers({ 'content-length': '1' })]) {
    const request = new Request('https://example.com/mcp', { method: 'POST', headers, body: '123456' });
    await assert.rejects(boundedBody(request, 5), { code: 'REQUEST_TOO_LARGE', status: 413 });
  }
  const request = new Request('https://example.com/mcp', { method: 'POST', body: '12345' });
  assert.equal(new TextDecoder().decode(await boundedBody(request, 5)), '12345');
});

test('Worker rejects browser origins except exact allowlist matches', () => {
  checkOrigin(new Request('https://example.com/mcp'));
  checkOrigin(new Request('https://example.com/mcp', { headers: { origin: 'https://client.example' } }), 'https://client.example');
  for (const origin of ['null', 'https://client.example.evil.test']) {
    assert.throws(() => checkOrigin(new Request('https://example.com/mcp', { headers: { origin } }), 'https://client.example'), { code: 'FORBIDDEN_ORIGIN' });
  }
});

test('Worker queue holds lock until asynchronous operation finishes and recovers after rejection', async () => {
  const queue = new SerialQueue();
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = queue.run(async () => { events.push('first'); await gate; events.push('done'); });
  const second = queue.run(async () => { events.push('second'); });
  await Promise.resolve();
  assert.deepEqual(events, ['first']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first', 'done', 'second']);
  await assert.rejects(queue.run(async () => { throw new Error('failure'); }));
  assert.equal(await queue.run(async () => 42), 42);
});

test('Worker bounds pending requests instead of accumulating unlimited work', async () => {
  const queue = new SerialQueue();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = Array.from({ length: 32 }, () => queue.run(() => gate));
  await assert.rejects(queue.run(async () => {}), { code: 'RATE_LIMITED' });
  release();
  await Promise.all(pending);
});

test('Unexpected internal errors never expose secrets to clients', () => {
  assert.deepEqual(toStructuredError(new Error('database password=secret')), { code: 'INTERNAL_ERROR', message: 'Internal server error' });
});
