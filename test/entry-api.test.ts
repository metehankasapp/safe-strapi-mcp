import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditStore } from '../src/audit.js';
import { ContentService } from '../src/service.js';
import { EntrySchema, localizedField } from '../src/entry-schema.js';
import { describeContentType } from '../src/content-types.js';
import type { AppConfig, JsonObject } from '../src/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';
import { requestStrapi } from '../src/api-request.js';

const localized = { i18n: { localized: true } };
const newsUid = 'api::news-post.news-post';
const components = { 'shared.summary': { attributes: { text: { type: 'text', required: true } } },
  'shared.hero': { attributes: { title: { type: 'string', required: true }, image: { type: 'media', allowedTypes: ['images'] } } } };
const news: JsonObject = { kind: 'collectionType', info: { singularName: 'news-post', pluralName: 'news-posts', displayName: 'News' },
  options: { draftAndPublish: true }, pluginOptions: localized, attributes: {
    title: { type: 'string', required: true, maxLength: 200, pluginOptions: localized }, slug: { type: 'uid', required: true },
    date: { type: 'date', required: true }, heroImage: { type: 'media', required: true, allowedTypes: ['images'] },
    category: { type: 'relation', relation: 'manyToOne', target: 'api::category.category' },
    summary: { type: 'component', component: 'shared.summary', repeatable: true, pluginOptions: localized },
    body: { type: 'richtext', pluginOptions: localized }, blocks: { type: 'dynamiczone', components: ['shared.hero'], pluginOptions: localized },
    metadata: { type: 'json', pluginOptions: localized }, enabled: { type: 'boolean', default: true }, secret: { type: 'password', private: true },
  } };
const category: JsonObject = { kind: 'collectionType', info: { singularName: 'category', pluralName: 'categories' }, options: { draftAndPublish: true }, attributes: { name: { type: 'string', required: true } } };
const setting: JsonObject = { kind: 'singleType', info: { singularName: 'setting', pluralName: 'settings' }, options: { draftAndPublish: true }, attributes: { title: { type: 'string', required: true } } };
const form: JsonObject = { kind: 'collectionType', info: { singularName: 'lead', pluralName: 'leads' }, options: { draftAndPublish: false }, attributes: { email: { type: 'email', required: true } } };
const types = { [newsUid]: news, 'api::category.category': category, 'api::setting.setting': setting, 'api::lead.lead': form };
const createData = () => ({ title: 'User summit', slug: 'user-summit', date: '2026-10-13', heroImage: 10, category: 'category1',
  summary: [{ text: 'Introduction' }], body: 'Body with ![image](/uploads/hero.png)', blocks: [{ __component: 'shared.hero', title: 'Design', image: 10 }], metadata: { id: 'application-id', nested: { documentId: 'keep-json-id' } } });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'safe-entry-'));
  const rows = new Map<string, JsonObject>();
  const media = new Map<number, JsonObject>([[10, { id: 10, name: 'hero.png', mime: 'image/png', url: '/uploads/hero.png' }]]);
  const writes: { method: string; path: string; data: JsonObject }[] = [];
  let sequence = 100; let componentSequence = 500; let drop = false; let block = false;
  const key = (uid: string, id: string, locale = '', status = 'draft') => `${uid}:${id}:${locale}:${status}`;
  const schemas = Object.fromEntries(Object.entries(types).map(([uid, schema]) => [uid, describeContentType(uid, schema)]));
  const seed = (uid: string, id: string, data: JsonObject, locale = '', status = 'draft') => rows.set(key(uid, id, locale, status), {
    ...structuredClone(data), id: ++sequence, documentId: id, locale: locale || undefined, publishedAt: status === 'published' ? '2026-10-01T00:00:00.000Z' : schemas[uid].draftAndPublish ? null : undefined,
  });
  seed('api::category.category', 'category1', { name: 'News' });
  const hydrate = (row: JsonObject, uid: string): JsonObject => {
    const data = structuredClone(row); const schema = schemas[uid];
    if (data.heroImage) data.heroImage = structuredClone(media.get(Number(data.heroImage)));
    if (data.category) data.category = { documentId: data.category, name: 'News' };
    if (schema.localized) data.localizations = [...rows.values()].filter(x => x.documentId === row.documentId && x.locale !== row.locale && x.publishedAt === null).map(x => ({ documentId: x.documentId, locale: x.locale }));
    return data;
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost'); response.setHeader('content-type', 'application/json');
    const send = (data: unknown, status = 200) => { response.statusCode = status; response.end(JSON.stringify(data)); };
    if (url.pathname === '/api/upload/files/page') return send({ data: [...media.values()], meta: { pagination: { total: media.size } } });
    if (/^\/api\/upload\/files\/\d+$/.test(url.pathname)) { const data = media.get(Number(url.pathname.split('/').at(-1))); return send(data ?? { error: { message: 'missing' } }, data ? 200 : 404); }
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      assert.match(String(request.headers['content-type']), /^multipart\/form-data; boundary=/);
      assert.match(raw, /name="files"/);
      const info = JSON.parse(raw.match(/name="fileInfo"\r\n\r\n([^\r]+)/)![1]);
      const id = ++sequence; const data = { ...info, id, mime: 'image/png', url: `/uploads/${info.name}` }; media.set(id, data);
      writes.push({ method: 'POST', path: url.pathname, data: info }); return send([data]);
    }
    const selected = Object.values(schemas).find(schema => url.pathname === schema.endpoint || url.pathname.startsWith(schema.endpoint + '/'));
    if (!selected) return send({ error: { message: 'missing' } }, 404);
    const locale = selected.localized ? url.searchParams.get('locale') ?? 'en' : '';
    const status = selected.draftAndPublish ? url.searchParams.get('status') ?? 'published' : 'draft';
    const id = selected.kind === 'singleType' ? 'singleton' : url.pathname.slice(selected.endpoint.length + 1);
    const current = rows.get(key(selected.uid, id, locale, status));
    if (request.method === 'GET') {
      if (selected.kind === 'singleType' || id) return send(current ? { data: hydrate(current, selected.uid) } : { data: null, error: { message: 'missing' } }, current ? 200 : 404);
      const matches = [...rows.entries()].filter(([k, row]) => k.startsWith(selected.uid + ':') && (row.locale ?? '') === locale && k.endsWith(':' + status) &&
        [...url.searchParams].filter(([name]) => /^filters\[\w+\]\[\$eq\]$/.test(name)).every(([name, value]) => String(row[name.match(/^filters\[(\w+)\]/)![1]]) === value));
      return send({ data: matches.map(([, row]) => hydrate(row, selected.uid)), meta: { pagination: { total: matches.length, pageCount: 1 } } });
    }
    if (!['POST', 'PUT'].includes(request.method!)) return send({ error: { message: 'missing' } }, 404);
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')).data as JsonObject;
    writes.push({ method: request.method!, path: url.pathname + url.search, data: structuredClone(data) });
    if (block) { response.statusCode = 403; response.setHeader('content-type', 'text/html'); response.setHeader('server', 'awselb/2.0'); response.end('<html>Forbidden</html>'); return; }
    const writtenId = request.method === 'POST' ? `doc${++sequence}` : id;
    const shared: JsonObject = {};
    if (!current && selected.localized) {
      const source = [...rows.values()].find(row => row.documentId === writtenId && row.publishedAt === null);
      if (source) for (const [name, field] of Object.entries(selected.schema.attributes as JsonObject)) if (!localizedField(field as JsonObject)) shared[name] = structuredClone(source[name]);
    }
    const stored: JsonObject = { ...shared, ...(current ?? {}), ...structuredClone(data), id: current?.id ?? ++sequence, documentId: writtenId,
      ...(selected.localized ? { locale } : {}), ...(selected.draftAndPublish ? { publishedAt: null } : {}) };
    if (Array.isArray(stored.summary)) stored.summary = (stored.summary as JsonObject[]).map(x => ({ ...x, id: x.id ?? ++componentSequence }));
    if (Array.isArray(stored.blocks)) stored.blocks = (stored.blocks as JsonObject[]).map(x => ({ ...x, id: x.id ?? ++componentSequence }));
    rows.set(key(selected.uid, writtenId, locale), stored);
    if (drop) { drop = false; response.destroy(); } else send({ data: hydrate(stored, selected.uid) });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ENTRY_TEST_TOKEN = 'mock-entry-token';
  const config: AppConfig = { projects: { site: { baseUrl, tokenEnv: 'ENTRY_TEST_TOKEN', collection: 'news-posts', blocksField: '', slugField: 'slug',
    defaultLocale: 'en', contentTypeSchemas: types, componentSchemas: components, allowEntryEditing: true } } };
  const audit = new AuditStore(join(root, 'audit.sqlite'));
  const service = new ContentService(config, audit);
  const inspect = async (uid = newsUid, locale?: string) => (await service.entries.inspectContentType('site', uid, locale)).inspectionId as string;
  const apply = (preview: JsonObject, key = 'entry-test-operation') => service.entries.applyEntryWrite('site', String(preview.previewId), String((preview.revision as JsonObject).operationHash), key);
  return { root, rows, media, writes, service, config, seed, inspect, apply, dropNextResponse: () => { drop = true; }, blockWrites: () => { block = true; },
    close: async () => { audit.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); } };
}

test('schema/API inspection is enforced; news creates and exact retries never duplicate', async () => {
  const f = await fixture(); try {
    assert.equal((await f.service.entries.listContentTypes('site')).length, 4);
    await assert.rejects(f.service.entries.previewEntryWrite({ project: 'site', uid: newsUid, inspectionId: 'missing', action: 'create', data: createData() }), { code: 'PREVIEW_REQUIRED' });
    const preview = await f.service.entries.previewEntryWrite({ project: 'site', uid: newsUid, inspectionId: await f.inspect(), action: 'create', data: createData() });
    assert.equal(f.writes.length, 0);
    const result = await f.apply(preview); assert.equal(result.verified, true);
    assert.equal((await f.apply(preview)).idempotentReplay, true); assert.equal(f.writes.length, 1);
    assert.match(f.writes[0].path, /status=draft/);
    assert.deepEqual(f.writes[0].data.metadata, createData().metadata);
  } finally { await f.close(); }
});

test('field edits preserve unrelated data, component IDs and published entries; stale previews stop', async () => {
  const f = await fixture(); try {
    const data = { ...createData(), summary: [{ id: 42, text: 'Original' }], blocks: [] };
    f.seed(newsUid, 'existing', data, 'en'); f.seed(newsUid, 'existing', data, 'en', 'published');
    const published = structuredClone([...f.rows.values()].find(x => x.documentId === 'existing' && x.publishedAt)!);
    const inspectionId = await f.inspect();
    const preview = await f.service.entries.previewEntryWrite({ project: 'site', uid: newsUid, inspectionId, action: 'update', documentId: 'existing', data: { body: 'Revised' } });
    await f.apply(preview);
    const draft = [...f.rows.values()].find(x => x.documentId === 'existing' && x.publishedAt === null)!;
    assert.deepEqual(draft.summary, data.summary); assert.equal(draft.heroImage, 10);
    assert.deepEqual([...f.rows.values()].find(x => x.documentId === 'existing' && x.publishedAt), published);
    const stale = await f.service.entries.previewEntryWrite({ project: 'site', uid: newsUid, inspectionId, action: 'update', documentId: 'existing', data: { body: 'Later' } });
    draft.title = 'External edit';
    await assert.rejects(f.apply(stale, 'stale-operation'), { code: 'DRAFT_CHANGED' });
    assert.equal(f.writes.length, 1);
  } finally { await f.close(); }
});

test('localization uses PUT and the same documentId/slug; shared fields cannot be overwritten', async () => {
  const f = await fixture(); try {
    f.seed(newsUid, 'original', createData(), 'en');
    const inspectionId = await f.inspect();
    const input = { project: 'site', uid: newsUid, inspectionId, action: 'localize' as const, documentId: 'original', locale: 'ar', data: { title: 'Localized', body: 'Arabic article' } };
    await assert.rejects(f.service.entries.previewEntryWrite({ ...input, data: { ...input.data, slug: 'user-summit-ar' } }), { code: 'INVALID_REQUEST' });
    await assert.rejects(f.service.entries.previewEntryWrite({ ...input, data: { ...input.data, date: '2026-10-14' } }), { code: 'INVALID_REQUEST' });
    const preview = await f.service.entries.previewEntryWrite(input); const result = await f.apply(preview);
    assert.equal(result.documentId, 'original'); assert.equal(f.writes[0].method, 'PUT'); assert.equal(f.writes[0].data.slug, 'user-summit'); assert.equal(f.writes[0].data.date, undefined);
    assert.equal([...f.rows.values()].find(x => x.documentId === 'original' && x.locale === 'ar')!.heroImage, 10);
  } finally { await f.close(); }
});

test('single types use PUT on singular endpoint; non-draft types require explicit immediate visibility', async () => {
  const f = await fixture(); try {
    const uid = 'api::setting.setting'; const inspectionId = await f.inspect(uid);
    const p = await f.service.entries.previewEntryWrite({ project: 'site', uid, inspectionId, action: 'create', data: { title: 'Settings' } });
    await f.apply(p); assert.equal(f.writes[0].method, 'PUT'); assert.equal(f.writes[0].path, '/api/setting?status=draft');
    const update = await f.service.entries.previewEntryWrite({ project: 'site', uid, inspectionId, action: 'update', data: { title: 'Updated settings' } });
    assert.equal((await f.apply(update, 'single-update-op')).verified, true);
    const formUid = 'api::lead.lead'; const formInspection = await f.inspect(formUid);
    await assert.rejects(f.service.entries.previewEntryWrite({ project: 'site', uid: formUid, inspectionId: formInspection, action: 'create', data: { email: 'test@example.com' } }), { code: 'INVALID_REQUEST' });
    const live = await f.service.entries.previewEntryWrite({ project: 'site', uid: formUid, inspectionId: formInspection, action: 'create', allowImmediateWrite: true, data: { email: 'test@example.com' } });
    assert.equal((live.safety as JsonObject).publishes, true); const result = await f.apply(live, 'immediate-operation'); assert.equal(result.status, 'immediate');
  } finally { await f.close(); }
});

test('lost create responses never retry; lost update responses reconcile without another PUT', async () => {
  const f = await fixture(); try {
    const inspectionId = await f.inspect(); const p = await f.service.entries.previewEntryWrite({ project: 'site', uid: newsUid, inspectionId, action: 'create', data: createData() });
    f.dropNextResponse(); await assert.rejects(f.apply(p)); await assert.rejects(f.apply(p), { code: 'WRITE_OUTCOME_UNKNOWN' }); assert.equal(f.writes.length, 1);
    const created = [...f.rows.values()].find(x => x.title === 'User summit')!;
    const update = await f.service.entries.previewEntryWrite({ project: 'site', uid: newsUid, inspectionId, action: 'update', documentId: String(created.documentId), data: { body: 'After lost response' } });
    f.dropNextResponse(); await assert.rejects(f.apply(update, 'lost-update-op')); const recovered = await f.apply(update, 'lost-update-op'); assert.equal(recovered.verified, true); assert.equal(recovered.recovered, true); assert.equal(f.writes.length, 2);
  } finally { await f.close(); }
});

test('unknown fields, invalid data, missing references and forged component IDs fail before writes', async () => {
  const f = await fixture(); try {
    const inspectionId = await f.inspect();
    for (const patch of [{ enabled: 'true' }, { date: '2026-02-30' }, { secret: 'not-allowed' }, { unknown: 1 }, { heroImage: 999 }, { category: 'missing' }, { summary: [{ id: 99, text: 'Forged' }] }]) {
      await assert.rejects(f.service.entries.previewEntryWrite({ project: 'site', uid: newsUid, inspectionId, action: 'create', data: { ...createData(), ...patch } }));
    }
    const schema = new EntrySchema(describeContentType(newsUid, news), { types, components });
    await assert.rejects(schema.normalize({ ...createData(), blocks: [{ __component: 'shared.not-allowed' }] }), { code: 'SCHEMA_VALIDATION_FAILED' });
    assert.equal(f.writes.length, 0);
  } finally { await f.close(); }
});

test('schema drift and revoked entry opt-in invalidate existing previews', async () => {
  const f = await fixture(); try {
    f.seed(newsUid, 'existing', createData(), 'en'); const inspectionId = await f.inspect();
    const p = await f.service.entries.previewEntryWrite({ project: 'site', uid: newsUid, inspectionId, action: 'update', documentId: 'existing', data: { body: 'New' } });
    f.config.projects.site.allowEntryEditing = false; await assert.rejects(f.apply(p), { code: 'IN_PLACE_DISABLED' });
    f.config.projects.site.allowEntryEditing = true;
    const own = structuredClone(news); (own.attributes as JsonObject).newField = { type: 'string' };
    f.config.projects.site.contentTypeSchemas = { ...types, [newsUid]: own };
    await assert.rejects(f.apply(p), { code: 'PREVIEW_MISMATCH' }); assert.equal(f.writes.length, 0);
  } finally { await f.close(); }
});

test('WAF HTML failures are diagnosed and never fall back or automatically re-send', async () => {
  const f = await fixture(); try {
    const p = await f.service.entries.previewEntryWrite({ project: 'site', uid: newsUid, inspectionId: await f.inspect(), action: 'create', data: createData() }); f.blockWrites();
    await assert.rejects(f.apply(p), (error: any) => error.code === 'STRAPI_ERROR' && error.details.upstreamBlocked === true && error.details.server === 'awselb/2.0');
    await assert.rejects(f.apply(p), { code: 'WRITE_OUTCOME_UNKNOWN' }); assert.equal(f.writes.length, 1);
  } finally { await f.close(); }
});

test('Strapi validation errors expose useful diagnostics while redacting credentials', async () => {
  const token = 'private-validation-token';
  const server = createServer((_request, response) => {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `Invalid title; ${token}; Bearer other-secret` } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(requestStrapi({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token }, '/api/news-posts'), (error: any) => {
      assert.equal(error.details.validationMessage, 'Invalid title; [redacted]; Bearer [redacted]');
      assert.ok(!JSON.stringify(error).includes(token));
      return error.code === 'STRAPI_ERROR';
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('media uploads use multipart, verify metadata and never upload twice on replay', async () => {
  const f = await fixture(); try {
    const path = join(f.root, 'image.png'); await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]));
    const p = await f.service.media.preview('site', path, 'Design sketch');
    const hash = String((p.revision as JsonObject).operationHash);
    const uploaded = await f.service.media.upload('site', String(p.previewId), hash, 'media-upload-op'); assert.equal(uploaded.verified, true);
    assert.equal((await f.service.media.upload('site', String(p.previewId), hash, 'media-upload-op')).idempotentReplay, true); assert.equal(f.writes.length, 1);
    const changed = await f.service.media.preview('site', path);
    await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 5]));
    await assert.rejects(f.service.media.upload('site', String(changed.previewId), String((changed.revision as JsonObject).operationHash), 'media-changed-op'), { code: 'SOURCE_CHANGED' });
    const fake = join(f.root, 'secret.png'); await writeFile(fake, 'TOKEN=secret'); await assert.rejects(f.service.media.preview('site', fake), { code: 'INVALID_REQUEST' });
  } finally { await f.close(); }
});

test('the actual MCP protocol exposes schema-first entry tools and enforces inspection', async () => {
  const f = await fixture(); const server = createMcpServer(f.service); const client = new Client({ name: 'entry-contract-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const inspected = await client.callTool({ name: 'inspect_content_type', arguments: { project: 'site', uid: newsUid } });
    assert.equal((inspected.structuredContent as any).ok, true);
    const inspectionId = (inspected.structuredContent as any).data.inspectionId;
    const preview = await client.callTool({ name: 'preview_entry_write', arguments: { project: 'site', uid: newsUid, inspectionId, action: 'create', data: createData() } });
    assert.equal((preview.structuredContent as any).ok, true); assert.equal(f.writes.length, 0);
    const data = (preview.structuredContent as any).data;
    const written = await client.callTool({ name: 'apply_entry_write', arguments: { project: 'site', previewId: data.previewId, expectedOperationHash: data.revision.operationHash, idempotencyKey: 'mcp-news-create' } });
    assert.equal((written.structuredContent as any).data.verified, true); assert.equal(f.writes.length, 1);
  } finally { await client.close(); await server.close(); await f.close(); }
});
