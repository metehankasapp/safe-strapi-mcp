import assert from 'node:assert/strict';
import test from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { PostgresAuditStore } from '../src/postgres-audit.js';

async function store() {
  const memory = newDb();
  const adapter = memory.adapters.createPg();
  return PostgresAuditStore.fromPool(new adapter.Pool() as unknown as Pool);
}

test('PostgreSQL audit store persists idempotency and owned draft state', async () => {
  const audit = await store();
  try {
    await audit.health();
    await audit.begin({
      key: 'project:123:1', project: 'example-site', sourceDocumentId: 'source-1',
      cloneSlug: 'source-ai', requestHash: 'a'.repeat(64), intendedHash: 'b'.repeat(64),
      request: { action: 'clone' },
    });
    await audit.recordOwned({
      project: 'example-site', documentId: 'draft-1', locale: 'en', slug: 'source-ai',
      sourceDocumentId: 'source-1', sourceHash: 'c'.repeat(64), createdByJob: 'project:123:1', lastHash: 'd'.repeat(64),
    });
    await audit.complete('project:123:1', { verified: true });

    assert.equal((await audit.get('project:123:1'))?.status, 'completed');
    assert.equal((await audit.getOwned('example-site', 'draft-1', 'en'))?.sourceDocumentId, 'source-1');
    assert.equal((await audit.getOwnedByJob('project:123:1'))?.documentId, 'draft-1');
  } finally {
    await audit.close();
  }
});

test('PostgreSQL audit store rejects an idempotency key collision', async () => {
  const audit = await store();
  try {
    const base = {
      key: 'project:collision:1', project: 'example-site', sourceDocumentId: 'source-1',
      cloneSlug: 'source-ai', intendedHash: 'b'.repeat(64), request: { action: 'clone' },
    };
    await audit.begin({ ...base, requestHash: 'a'.repeat(64) });
    await assert.rejects(
      audit.begin({ ...base, requestHash: 'z'.repeat(64) }),
      (error: any) => error?.code === 'IDEMPOTENCY_CONFLICT',
    );
  } finally {
    await audit.close();
  }
});
