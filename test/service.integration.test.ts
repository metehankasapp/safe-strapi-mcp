import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { AuditStore } from '../src/audit.js';
import { AppError } from '../src/errors.js';
import { ContentService } from '../src/service.js';
import { contentHash } from '../src/strapi-client.js';
import { normalizeForCreate } from '../src/operations.js';
import type { AppConfig, JsonObject } from '../src/types.js';
import { startMockStrapi } from './mock-strapi.js';
import { runAsPrincipal, type Principal } from '../src/auth.js';

function sourcePage(count = 3): JsonObject {
  return {
    id: 1,
    documentId: 'source-page',
    title: 'Source Page',
    slug: 'source-page',
    description: 'Must remain intact',
    locale: 'en',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    publishedAt: '2025-01-02T00:00:00.000Z',
    blocks: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      __component: 'fixture.block',
      fixtureKey: `block-${index + 1}`,
      title: `Title ${index + 1}`,
      body: `Body ${index + 1}`,
      settings: { color: `#${String(index).padStart(6, '0')}`, enabled: index % 2 === 0 },
      items: [{ id: index * 10 + 1, label: 'A' }, { id: index * 10 + 2, label: 'B' }],
    })),
  };
}

function setup(baseUrl: string): { service: ContentService; audit: AuditStore } {
  process.env.TEST_STRAPI_TOKEN = 'mock-token';
  const config: AppConfig = { projects: { test: {
    baseUrl, tokenEnv: 'TEST_STRAPI_TOKEN', collection: 'pages', blocksField: 'blocks',
    slugField: 'slug', titleField: 'title', populate: 'deep', defaultLocale: 'en',
  } } };
  const audit = new AuditStore(resolve(tmpdir(), `safe-strapi-${randomUUID()}.sqlite`));
  return { service: new ContentService(config, audit), audit };
}

test('lost POST response never retries a create or adopts an unowned matching page', async () => {
  const mock = await startMockStrapi(sourcePage());
  const { service, audit } = setup(mock.baseUrl);
  try {
    const request = { project: 'test', sourceDocumentId: 'source-page', expectedSourceHash: contentHash(sourcePage()), idempotencyKey: 'lost-create', operations: [] };
    mock.setDropNextWriteResponse(true);
    await assert.rejects(service.cloneAndModify(request));
    await assert.rejects(service.cloneAndModify(request), { code: 'WRITE_OUTCOME_UNKNOWN' });
    assert.equal(mock.requests.filter(r => r.method === 'POST').length, 1);
    await assert.rejects(service.inspectOwnedDraft('test', 'owned-1'), { code: 'DRAFT_NOT_OWNED' });
  } finally { audit.close(); await mock.close(); }
});

test('lost PUT response is reconciled from persisted intent without a second write', async () => {
  const mock = await startMockStrapi(sourcePage());
  const { service, audit } = setup(mock.baseUrl);
  try {
    const clone = await service.cloneAndModify({ project: 'test', sourceDocumentId: 'source-page', expectedSourceHash: contentHash(sourcePage()), idempotencyKey: 'create-recovery', operations: [] });
    const request = { project: 'test', documentId: String(clone.documentId), expectedDraftHash: String(clone.draftHash), idempotencyKey: 'lost-update', operations: [{ type: 'patch' as const, selector: { index: 0 }, changes: { title: 'Recovered title' } }] };
    mock.setDropNextWriteResponse(true);
    await assert.rejects(service.modifyOwnedDraft(request));
    const replay = await service.modifyOwnedDraft(request);
    assert.equal(replay.recovered, true);
    assert.equal(mock.requests.filter(r => r.method === 'PUT').length, 1);
    assert.equal(contentHash(mock.documents.get('source-page')), contentHash(sourcePage()));
  } finally { audit.close(); await mock.close(); }
});

test('separate service instances sharing SQLite serialize conflicting draft revisions', async () => {
  const mock = await startMockStrapi(sourcePage());
  const config: AppConfig = { projects: { test: { baseUrl: mock.baseUrl, tokenEnv: 'TEST_STRAPI_TOKEN', collection: 'pages', blocksField: 'blocks', slugField: 'slug' } } };
  process.env.TEST_STRAPI_TOKEN = 'mock-token';
  const auditPath = resolve(tmpdir(), `safe-strapi-shared-${randomUUID()}.sqlite`);
  const audit = new AuditStore(auditPath);
  const secondAudit = new AuditStore(auditPath);
  const service = new ContentService(config, audit);
  const second = new ContentService(config, secondAudit);
  try {
    const clone = await service.cloneAndModify({ project: 'test', sourceDocumentId: 'source-page', expectedSourceHash: contentHash(sourcePage()), idempotencyKey: 'concurrent-create', operations: [] });
    const request = { project: 'test', documentId: String(clone.documentId), expectedDraftHash: String(clone.draftHash), operations: [{ type: 'patch' as const, selector: { index: 0 }, changes: { title: 'Concurrent' } }] };
    const results = await Promise.allSettled([service.modifyOwnedDraft({ ...request, idempotencyKey: 'writer-a' }), second.modifyOwnedDraft({ ...request, idempotencyKey: 'writer-b' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, 'DRAFT_CHANGED');
    assert.equal(mock.requests.filter(r => r.method === 'PUT').length, 1);
  } finally { secondAudit.close(); audit.close(); await mock.close(); }
});

test('100-component clone preserves every non-patched field and source hash', async () => {
  const original = sourcePage(100);
  const mock = await startMockStrapi(original);
  const { service, audit } = setup(mock.baseUrl);
  try {
    const operations = [
      { type: 'patch' as const, selector: { index: 49 }, changes: { title: 'PATCHED 50' } },
      { type: 'move' as const, selector: { index: 79 }, position: { after: { index: 9 } } as const },
      { type: 'insert' as const, component: { __component: 'fixture.block', fixtureKey: 'inserted', title: 'Inserted', body: 'New', settings: { color: '#fff', enabled: true }, items: [] }, position: { after: { index: 24 } } as const },
    ];
    const sourceHashBefore = contentHash(mock.documents.get('source-page'));
    const preview = await service.preview({ project: 'test', sourceDocumentId: 'source-page', operations });
    const result = await service.cloneAndModify({
      project: 'test', sourceDocumentId: 'source-page', expectedSourceHash: String(preview.sourceHash),
      idempotencyKey: 'project:fixture-100:v1', operations,
    });
    const draft = mock.documents.get(String(result.documentId)) as JsonObject;
    const finalBlocks = draft.blocks as JsonObject[];
    assert.equal(finalBlocks.length, 101);
    assert.equal(finalBlocks[25].fixtureKey, 'inserted');
    assert.ok(finalBlocks.findIndex((item) => item.fixtureKey === 'block-80') < 20);

    const originals = original.blocks as JsonObject[];
    let unchanged = 0;
    for (const sourceBlock of originals) {
      const finalBlock = finalBlocks.find((item) => item.fixtureKey === sourceBlock.fixtureKey);
      assert.ok(finalBlock, `missing ${sourceBlock.fixtureKey}`);
      const withoutId = normalizeForCreate(sourceBlock, false) as JsonObject;
      const finalCopy = normalizeForCreate(finalBlock, false) as JsonObject;
      if (sourceBlock.fixtureKey === 'block-50') {
        assert.equal(finalCopy.title, 'PATCHED 50');
        finalCopy.title = sourceBlock.title;
        assert.deepEqual(finalCopy, withoutId);
      } else {
        assert.deepEqual(finalCopy, withoutId);
        unchanged += 1;
      }
    }
    assert.equal(unchanged, 99);
    assert.equal(contentHash(mock.documents.get('source-page')), sourceHashBefore);
    assert.equal(result.verified, true);
    assert.equal(result.operationHash, preview.operationHash);
    assert.ok(mock.requests.some((item) => item.method === 'GET' && item.path.startsWith(`/api/pages/${result.documentId}`)));
  } finally {
    audit.close();
    await mock.close();
  }
});

test('owned draft can be inspected, modified, validated and compared; foreign draft is rejected', async () => {
  const mock = await startMockStrapi(sourcePage());
  const { service, audit } = setup(mock.baseUrl);
  try {
    const preview = await service.preview({ project: 'test', sourceDocumentId: 'source-page', operations: [] });
    const clone = await service.cloneAndModify({ project: 'test', sourceDocumentId: 'source-page', expectedSourceHash: String(preview.sourceHash), idempotencyKey: 'project:owned:v1', operations: [] });
    const inspection = await service.inspectOwnedDraft('test', String(clone.documentId));
    assert.equal(inspection.owned, true);
    const modified = await service.modifyOwnedDraft({
      project: 'test', documentId: String(clone.documentId), expectedDraftHash: String(inspection.contentHash),
      idempotencyKey: 'project:owned:v2', operations: [{ type: 'duplicate', selector: { index: 0 }, position: { end: true } }],
    });
    assert.equal(modified.verified, true);
    const validation = await service.validateDraft('test', String(clone.documentId));
    assert.deepEqual({ valid: validation.valid, owned: validation.owned, sourceUnchanged: validation.sourceUnchanged }, { valid: true, owned: true, sourceUnchanged: true });
    const comparison = await service.comparePages('test', 'source-page', String(clone.documentId));
    assert.equal(comparison.equal, false);
    await assert.rejects(() => service.inspectOwnedDraft('test', 'source-page'), (error: unknown) => error instanceof AppError && error.code === 'DRAFT_NOT_OWNED');
  } finally {
    audit.close();
    await mock.close();
  }
});

test('idempotency replays identical operation and rejects key collision', async () => {
  const mock = await startMockStrapi(sourcePage());
  const { service, audit } = setup(mock.baseUrl);
  try {
    const preview = await service.preview({ project: 'test', sourceDocumentId: 'source-page', operations: [] });
    const request = { project: 'test', sourceDocumentId: 'source-page', expectedSourceHash: String(preview.sourceHash), idempotencyKey: 'project:idempotent:v1', operations: [] };
    const [first, replay] = await Promise.all([
      service.cloneAndModify(request),
      service.cloneAndModify(request),
    ]);
    assert.equal(replay.documentId, first.documentId);
    assert.equal(replay.idempotentReplay, true);
    await assert.rejects(
      () => service.cloneAndModify({ ...request, operations: [{ type: 'remove', selector: { index: 0 } }] }),
      (error: unknown) => error instanceof AppError && error.code === 'IDEMPOTENCY_CONFLICT',
    );
    assert.equal([...mock.documents.keys()].filter((key) => key.startsWith('owned-')).length, 1);
  } finally {
    audit.close();
    await mock.close();
  }
});

test('detects source mutation during create and corrupted post-create content', async () => {
  for (const failure of ['source', 'draft'] as const) {
    const mock = await startMockStrapi(sourcePage());
    const { service, audit } = setup(mock.baseUrl);
    try {
      const preview = await service.preview({ project: 'test', sourceDocumentId: 'source-page', operations: [] });
      if (failure === 'source') mock.setMutateSourceAfterWrite(true);
      else mock.setCorruptNextWrite(true);
      await assert.rejects(
        () => service.cloneAndModify({ project: 'test', sourceDocumentId: 'source-page', expectedSourceHash: String(preview.sourceHash), idempotencyKey: `project:failure:${failure}`, operations: [] }),
        (error: unknown) => error instanceof AppError && error.code === (failure === 'source' ? 'SOURCE_CHANGED' : 'VERIFICATION_FAILED'),
      );
    } finally {
      audit.close();
      await mock.close();
    }
  }
});

test('owned drafts are isolated between authenticated tenants', async () => {
  const mock = await startMockStrapi(sourcePage());
  const { service, audit } = setup(mock.baseUrl);
  const principal = (tenant: string): Principal => ({
    subject: `${tenant}-user`, tenant, authentication: 'oidc',
    scopes: new Set(['mcp:read', 'mcp:write']), projects: new Set(['test']),
  });
  try {
    const clone = await runAsPrincipal(principal('tenant-a'), async () => {
      const preview = await service.preview({ project: 'test', sourceDocumentId: 'source-page', operations: [] });
      return service.cloneAndModify({
        project: 'test', sourceDocumentId: 'source-page', expectedSourceHash: String(preview.sourceHash),
        idempotencyKey: 'project:tenant:v1', operations: [],
      });
    });
    await assert.rejects(
      runAsPrincipal(principal('tenant-b'), () => service.inspectOwnedDraft('test', String(clone.documentId))),
      (error: unknown) => error instanceof AppError && error.code === 'DRAFT_NOT_OWNED',
    );
    const owned = await runAsPrincipal(principal('tenant-a'), () => service.inspectOwnedDraft('test', String(clone.documentId)));
    assert.equal(owned.owned, true);
  } finally {
    audit.close();
    await mock.close();
  }
});
