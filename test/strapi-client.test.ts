import assert from 'node:assert/strict';
import test from 'node:test';
import { contentHash, idempotentSlug } from '../src/strapi-client.js';

test('content hash is stable across object key ordering', () => {
  assert.equal(contentHash({ a: 1, b: { c: 2 } }), contentHash({ b: { c: 2 }, a: 1 }));
  assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
});

test('idempotent slug is deterministic', () => {
  const first = idempotentSlug('home', 'project:123:1');
  assert.equal(first, idempotentSlug('home', 'project:123:1'));
  assert.notEqual(first, idempotentSlug('home', 'project:123:2'));
  assert.equal(idempotentSlug(first, 'project:123:1'), first);
});
