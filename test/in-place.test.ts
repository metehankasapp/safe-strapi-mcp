import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { AuditStore } from '../src/audit.js';
import { ContentService, type ModifyPagePreviewRequest } from '../src/service.js';
import { contentHash } from '../src/strapi-client.js';
import { runAsPrincipal, type Principal } from '../src/auth.js';
import type { AppConfig, JsonObject, ProjectConfig } from '../src/types.js';
import { startMockStrapi } from './mock-strapi.js';

function page(count = 4): JsonObject {
  return { documentId: 'existing', id: 1, title: 'Existing', slug: 'existing', locale: 'en', publishedAt: null,
    blocks: Array.from({ length: count }, (_, i) => ({ id: i + 10, __component: 'shared.block', title: `Block ${i}`,
      image: { id: 99, url: '/image.jpg', mime: 'image/jpeg' }, related: { documentId: 'related' },
      settings: { theme: 'light', enabled: true, ids: [1, 2] },
      child: { id: i + 100, label: 'Child', image: null },
      items: [{ id: i + 200, label: 'One', image: null }, { id: i + 300, label: 'Two', image: null }] })) };
}

function project(baseUrl: string): ProjectConfig {
  return { baseUrl, tokenEnv: 'IN_PLACE_TEST_TOKEN', collection: 'pages', slugField: 'slug', blocksField: 'blocks',
    defaultLocale: 'en', allowInPlaceEditing: true, populate: 'deep',
    contentTypeSchema: { kind: 'collectionType', options: { draftAndPublish: true }, attributes: {
      title: { type: 'string' }, slug: { type: 'uid' }, blocks: { type: 'dynamiczone', components: ['shared.block'] },
    } },
    componentSchemas: {
      'shared.block': { attributes: { title: { type: 'string', required: true }, image: { type: 'media' },
        related: { type: 'relation' }, settings: { type: 'json' },
        child: { type: 'component', component: 'shared.child' },
        items: { type: 'component', component: 'shared.child', repeatable: true } } },
      'shared.child': { attributes: { label: { type: 'string' }, image: { type: 'media' } } },
    } };
}

async function fixture(original = page(), override: Partial<ProjectConfig> = {}) {
  const mock = await startMockStrapi(original);
  process.env.IN_PLACE_TEST_TOKEN = 'fixture-only';
  const config: AppConfig = { projects: { test: { ...project(mock.baseUrl), ...override } } };
  const path = resolve(tmpdir(), `in-place-${randomUUID()}.sqlite`);
  const audit = new AuditStore(path);
  const service = new ContentService(config, audit);
  return { mock, audit, service, config, path,
    close: async () => { audit.close(); await mock.close(); } };
}

function request(changes: JsonObject = { title: 'Updated' }): ModifyPagePreviewRequest {
  return { project: 'test', documentId: 'existing', operations: [{ type: 'patch', selector: { index: 1 }, changes }] };
}

async function write(f: Awaited<ReturnType<typeof fixture>>, input = request(), key = 'edit-existing') {
  const preview = await f.service.previewModifyPage(input);
  assert.equal(f.mock.writePayloads.length, 0);
  return { input: { ...input, expectedPageHash: String(preview.pageHash), expectedOperationHash: String(preview.operationHash), idempotencyKey: key }, preview };
}

test('edits a middle component on the same document; preserves 99 other blocks, IDs, nested values and top-level fields', async () => {
  const original = page(100);
  const f = await fixture(original);
  try {
    const prepared = await write(f, { ...request(), operations: [{ type: 'patch', selector: { index: 49 }, changes: { title: 'Changed', child: { label: 'Updated nested' }, settings: { theme: 'dark' } } }] });
    const result = await f.service.modifyPage(prepared.input);
    assert.equal(result.verified, true);
    assert.equal(result.documentId, 'existing');
    assert.equal(f.mock.documents.size, 1);
    assert.deepEqual(Object.keys(f.mock.writePayloads[0]), ['blocks']);
    const fetched = f.mock.documents.get('existing')!;
    const blocks = fetched.blocks as JsonObject[];
    const expected = structuredClone(original.blocks) as JsonObject[];
    expected[49].title = 'Changed';
    (expected[49].child as JsonObject).label = 'Updated nested';
    (expected[49].settings as JsonObject).theme = 'dark';
    assert.deepEqual(blocks.map(b => ({ ...b, image: 99, related: 'related' })), expected.map(b => ({ ...b, image: 99, related: 'related' })));
    assert.equal(fetched.title, original.title);
    assert.equal(fetched.slug, original.slug);
    assert.equal(fetched.publishedAt, null);
    assert.equal(f.mock.requests.some(r => r.method === 'POST' || r.method === 'DELETE'), false);
    const replay = await f.service.modifyPage(prepared.input);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(f.mock.writePayloads.length, 1);
  } finally { await f.close(); }
});

test('inserts between existing blocks while preserving their IDs and relative order', async () => {
  const f = await fixture();
  try {
    const prepared = await write(f, { ...request(), operations: [{ type: 'insert', component: { __component: 'shared.block', title: 'New',
      image: 99, related: 'related', settings: { id: 'application-id' }, child: { label: 'New child', image: null }, items: [] }, position: { after: { index: 1 } } }] });
    f.mock.setTransformNextWrite(doc => {
      const inserted = (doc.blocks as JsonObject[])[2];
      inserted.id = 999;
      (inserted.child as JsonObject).id = 998;
      return doc;
    });
    const result = await f.service.modifyPage(prepared.input);
    assert.equal(result.verified, true);
    assert.deepEqual((f.mock.documents.get('existing')!.blocks as JsonObject[]).map(b => b.id), [10, 11, 999, 12, 13]);
    assert.equal(f.mock.documents.size, 1);
  } finally { await f.close(); }
});

test('rejects destructive and ambiguous operations without a write', async () => {
  const f = await fixture();
  try {
    for (const changes of [{ title: '' }, { title: '  ' }, { title: null }, { id: 999 }, { __component: 'shared.other' },
      { child: null }, { items: [] }, { items: [{ id: 200, label: 'Other', image: null }, { id: 300, label: 'Two', image: null }] },
      { settings: { ids: [1, 3] } }, { image: { id: 98 } }, { related: { documentId: 'other' } }]) {
      await assert.rejects(f.service.previewModifyPage(request(changes)), { code: 'CONTENT_REMOVAL_BLOCKED' });
    }
    for (const type of ['remove', 'replace', 'move', 'duplicate']) {
      await assert.rejects(f.service.previewModifyPage({ ...request(), operations: [{ type, selector: { index: 1 } }] as any }), { code: 'CONTENT_REMOVAL_BLOCKED' });
    }
    await assert.rejects(f.service.previewModifyPage({ ...request(), operations: [{ type: 'patch', selector: { component: 'shared.block' }, changes: { title: 'Other' } }] }), { code: 'AMBIGUOUS_SELECTOR' });
    assert.equal(f.mock.writePayloads.length, 0);
  } finally { await f.close(); }
});

test('rejects opt-out, unsupported schemas, missing population, wrong locale and published entries', async () => {
  for (const [original, override, code] of [
    [page(), { allowInPlaceEditing: false }, 'IN_PLACE_DISABLED'],
    [page(), { contentTypeSchema: { kind: 'singleType' } }, 'CONFIG_ERROR'],
    [{ ...page(), publishedAt: '2026-01-01' }, {}, 'INVALID_DRAFT'],
    [{ ...page(), locale: 'fr' }, {}, 'INVALID_DRAFT'],
    [{ ...page(), title: undefined }, {}, 'INCOMPLETE_CONTENT'],
  ] as Array<[JsonObject, Partial<ProjectConfig>, string]>) {
    const f = await fixture(original, override);
    try { await assert.rejects(f.service.previewModifyPage(request()), { code }); assert.equal(f.mock.writePayloads.length, 0); }
    finally { await f.close(); }
  }
  for (const field of ['child', 'image', 'items']) {
    const original = page();
    delete (original.blocks as JsonObject[])[0][field];
    const f = await fixture(original);
    try { await assert.rejects(f.service.previewModifyPage(request()), { code: 'INCOMPLETE_CONTENT' }); }
    finally { await f.close(); }
  }
});

test('rejects unknown fields, invalid types and inserted component IDs', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.previewModifyPage(request({ unknown: 'value' })), { code: 'SCHEMA_VALIDATION_FAILED' });
    await assert.rejects(f.service.previewModifyPage(request({ title: 42 })), { code: 'SCHEMA_VALIDATION_FAILED' });
    for (const component of [{ __component: 'shared.other', title: 'Other' }, { __component: 'shared.block', id: 999, title: 'New' }]) {
      await assert.rejects(f.service.previewModifyPage({ ...request(), operations: [{ type: 'insert', component, position: { end: true } }] }),
        { code: component.id ? 'INVALID_REQUEST' : 'SCHEMA_VALIDATION_FAILED' });
    }
  } finally { await f.close(); }
});

test('requires a persisted preview, rejects changed operations and stale page revisions', async () => {
  const f = await fixture();
  try {
    const prepared = await write(f);
    const otherAudit = new AuditStore(resolve(tmpdir(), `unpreviewed-${randomUUID()}.sqlite`));
    try { await assert.rejects(new ContentService(f.config, otherAudit).modifyPage(prepared.input), { code: 'PREVIEW_REQUIRED' }); }
    finally { otherAudit.close(); }
    await assert.rejects(f.service.modifyPage({ ...prepared.input, operations: request({ title: 'Different' }).operations }), { code: 'PREVIEW_MISMATCH' });
    f.mock.documents.set('existing', { ...f.mock.documents.get('existing')!, title: 'Human edit' });
    await assert.rejects(f.service.modifyPage(prepared.input), { code: 'PAGE_CHANGED' });
    assert.equal(f.mock.writePayloads.length, 0);
  } finally { await f.close(); }
});

test('recovers a lost update response once without issuing a second write', async () => {
  const f = await fixture();
  try {
    const prepared = await write(f);
    f.mock.setDropNextWriteResponse(true);
    await assert.rejects(f.service.modifyPage(prepared.input));
    const recovered = await f.service.modifyPage(prepared.input);
    assert.equal(recovered.recovered, true);
    assert.equal(f.mock.writePayloads.length, 1);
    await assert.rejects(f.service.modifyPage({ ...prepared.input, idempotencyKey: 'different-key' }), { code: 'PAGE_CHANGED' });
  } finally { await f.close(); }
});

test('rechecks revision immediately before writing and preserves intervening human edits', async () => {
  const f = await fixture();
  try {
    const prepared = await write(f);
    f.mock.setAfterNextGet(() => f.mock.documents.set('existing', { ...f.mock.documents.get('existing')!, title: 'Human edit during planning' }));
    await assert.rejects(f.service.modifyPage(prepared.input), { code: 'PAGE_CHANGED' });
    assert.equal(f.mock.writePayloads.length, 0);
    assert.equal(f.mock.documents.get('existing')!.title, 'Human edit during planning');
  } finally { await f.close(); }
});

test('REST limitation: an external zone edit between the final GET and PUT cannot be detected atomically', async () => {
  const f = await fixture();
  try {
    const prepared = await write(f);
    f.mock.setBeforeNextWrite(() => {
      (f.mock.documents.get('existing')!.blocks as JsonObject[])[0].title = 'External edit in the REST race window';
    });
    const result = await f.service.modifyPage(prepared.input);
    assert.equal(result.verified, true);
    assert.match(String(result.concurrency), /not atomic/);
    assert.equal((f.mock.documents.get('existing')!.blocks as JsonObject[])[0].title, 'Block 0');
  } finally { await f.close(); }
});

test('uncertain writes modified by a human are never blindly retried', async () => {
  const f = await fixture();
  try {
    const prepared = await write(f);
    f.mock.setDropNextWriteResponse(true);
    await assert.rejects(f.service.modifyPage(prepared.input));
    (f.mock.documents.get('existing')!.blocks as JsonObject[])[2].title = 'Human follow-up';
    await assert.rejects(f.service.modifyPage(prepared.input), { code: 'WRITE_OUTCOME_UNKNOWN' });
    assert.equal(f.mock.writePayloads.length, 1);
    assert.equal((f.mock.documents.get('existing')!.blocks as JsonObject[])[2].title, 'Human follow-up');
  } finally { await f.close(); }
});

test('rejects mismatched idempotency keys and serializes conflicting revisions across instances', async () => {
  const f = await fixture();
  const secondAudit = new AuditStore(f.path);
  try {
    const prepared = await write(f);
    const other = await write(f, request({ title: 'Second writer' }), 'second-writer');
    const results = await Promise.allSettled([f.service.modifyPage(prepared.input), new ContentService(f.config, secondAudit).modifyPage(other.input)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'PAGE_CHANGED');
    await assert.rejects(f.service.modifyPage({ ...other.input, idempotencyKey: prepared.input.idempotencyKey }), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal(f.mock.writePayloads.length, 1);
  } finally { secondAudit.close(); await f.close(); }
});

test('detects post-write content corruption and component ID regeneration; never auto-rolls back or retries', async () => {
  for (const corrupt of [(doc: JsonObject) => ({ ...doc, title: 'CORRUPT' }), (doc: JsonObject) => {
    ((doc.blocks as JsonObject[])[0].child as JsonObject).id = 999; return doc;
  }]) {
    const f = await fixture();
    try {
      const prepared = await write(f);
      f.mock.setTransformNextWrite(corrupt);
      await assert.rejects(f.service.modifyPage(prepared.input), { code: 'VERIFICATION_FAILED' });
      await assert.rejects(f.service.modifyPage(prepared.input), { code: 'WRITE_OUTCOME_UNKNOWN' });
      assert.equal(f.mock.writePayloads.length, 1);
    } finally { await f.close(); }
  }
});

test('previews and writes remain isolated by authenticated project and tenant', async () => {
  const f = await fixture();
  const principal = (tenant: string, projects = ['test']): Principal => ({ subject: tenant, tenant, authentication: 'oidc',
    scopes: new Set(['mcp:read', 'mcp:write']), projects: new Set(projects) });
  try {
    const prepared = await runAsPrincipal(principal('one'), () => write(f));
    await assert.rejects(runAsPrincipal(principal('two'), () => f.service.modifyPage(prepared.input)), { code: 'PREVIEW_REQUIRED' });
    await assert.rejects(runAsPrincipal(principal('one', []), () => f.service.modifyPage(prepared.input)), { code: 'PROJECT_FORBIDDEN' });
    const result = await runAsPrincipal(principal('one'), () => f.service.modifyPage(prepared.input));
    assert.equal(result.verified, true);
    assert.equal(await f.audit.getOwned('one:test', 'existing', 'en'), null);
    assert.equal(contentHash(f.mock.writePayloads[0].blocks), contentHash((f.mock.documents.get('existing')!).blocks));
  } finally { await f.close(); }
});

test('tenants with separate service instances share the same physical write lock', async () => {
  const f = await fixture();
  const otherAudit = new AuditStore(f.path);
  const principal = (tenant: string): Principal => ({ subject: tenant, tenant, authentication: 'oidc',
    scopes: new Set(['mcp:read', 'mcp:write']), projects: new Set(['test']) });
  try {
    const first = await runAsPrincipal(principal('one'), () => write(f));
    const second = new ContentService(f.config, otherAudit);
    const secondPreview = await runAsPrincipal(principal('two'), () => second.previewModifyPage(request({ title: 'Second tenant' })));
    const secondRequest = { ...request({ title: 'Second tenant' }), expectedPageHash: String(secondPreview.pageHash),
      expectedOperationHash: String(secondPreview.operationHash), idempotencyKey: 'second-tenant' };
    const results = await Promise.allSettled([
      runAsPrincipal(principal('one'), () => f.service.modifyPage(first.input)),
      runAsPrincipal(principal('two'), () => second.modifyPage(secondRequest)),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'PAGE_CHANGED');
    assert.equal(f.mock.writePayloads.length, 1);
  } finally { otherAudit.close(); await f.close(); }
});
