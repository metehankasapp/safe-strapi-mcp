// Reuses installed dependencies only. All schemas, DB, media and credentials
// below belong to a disposable local Strapi app, never the supplied project.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dependencyRoot = process.argv[2];
if (!dependencyRoot) throw new Error('Supply a Strapi project with installed dependencies');
const require = createRequire(resolve(dependencyRoot, 'package.json'));
const { createStrapi } = require('@strapi/strapi');
const version = require('@strapi/strapi/package.json').version;
const entry = resolve('dist/src/index.js');
const root = await mkdtemp(join(tmpdir(), 'safe-entry-real-'));
const originalCwd = process.cwd();
let strapi; let client;
const put = async (path, content) => {
  const file = join(root, path); await mkdir(dirname(file), { recursive: true });
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
};
const localized = { i18n: { localized: true } };
try {
  await symlink(resolve(dependencyRoot, 'node_modules'), join(root, 'node_modules'));
  await mkdir(join(root, 'public/uploads'), { recursive: true });
  await put('package.json', { name: 'isolated-entry-test', version: '1.0.0', dependencies: { '@strapi/strapi': version } });
  await put('config/server.js', `module.exports={host:'127.0.0.1',port:0,app:{keys:[${JSON.stringify(randomUUID())}]},cron:{enabled:false}};`);
  await put('config/admin.js', `module.exports={serveAdminPanel:false,auth:{secret:${JSON.stringify(randomUUID())}},apiToken:{salt:${JSON.stringify(randomUUID())}},transfer:{token:{salt:${JSON.stringify(randomUUID())}}},secrets:{encryptionKey:${JSON.stringify(randomUUID())}}};`);
  await put('config/database.js', `module.exports={connection:{client:'sqlite',connection:{filename:${JSON.stringify(join(root, 'test.sqlite'))}},useNullAsDefault:true}};`);
  await put('src/components/shared/summary.json', { collectionName: 'acceptance_summaries', info: { displayName: 'Summary' }, attributes: { text: { type: 'text', required: true } } });
  const schemas = {
    article: { kind: 'collectionType', collectionName: 'acceptance_articles', info: { singularName: 'article', pluralName: 'articles', displayName: 'Article' }, options: { draftAndPublish: true }, pluginOptions: localized, attributes: {
      title: { type: 'string', required: true, pluginOptions: localized }, slug: { type: 'uid', targetField: 'title', required: true }, date: { type: 'date', required: true },
      heroImage: { type: 'media', required: true, allowedTypes: ['images'] }, category: { type: 'relation', relation: 'manyToOne', target: 'api::category.category' },
      summary: { type: 'component', component: 'shared.summary', repeatable: true, pluginOptions: localized }, body: { type: 'richtext', pluginOptions: localized },
      richBlocks: { type: 'blocks', pluginOptions: localized }, metadata: { type: 'json' }, enabled: { type: 'boolean', default: true },
      amount: { type: 'decimal' }, count: { type: 'integer' }, large: { type: 'biginteger' }, timestamp: { type: 'datetime' }, clock: { type: 'time' },
    } },
    category: { kind: 'collectionType', collectionName: 'acceptance_categories', info: { singularName: 'category', pluralName: 'categories', displayName: 'Category' }, options: { draftAndPublish: true }, attributes: { name: { type: 'string', required: true } } },
    setting: { kind: 'singleType', collectionName: 'acceptance_settings', info: { singularName: 'setting', pluralName: 'settings', displayName: 'Setting' }, options: { draftAndPublish: true }, attributes: { title: { type: 'string', required: true } } },
    lead: { kind: 'collectionType', collectionName: 'acceptance_leads', info: { singularName: 'lead', pluralName: 'leads', displayName: 'Lead' }, options: { draftAndPublish: false }, attributes: { email: { type: 'email', required: true } } },
  };
  for (const [name, schema] of Object.entries(schemas)) {
    await put(`src/api/${name}/content-types/${name}/schema.json`, schema);
    for (const [folder, factory] of [['routes', 'createCoreRouter'], ['controllers', 'createCoreController'], ['services', 'createCoreService']]) {
      await put(`src/api/${name}/${folder}/${name}.js`, `module.exports=require('@strapi/strapi').factories.${factory}('api::${name}.${name}');`);
    }
  }
  process.chdir(root); strapi = createStrapi({ appDir: root, distDir: root }); await strapi.load(); await strapi.server.listen();
  const baseUrl = `http://127.0.0.1:${strapi.server.httpServer.address().port}`;
  const locales = strapi.plugin('i18n').service('locales');
  for (const code of ['ar', 'ckb']) if (!await locales.findByCode(code)) await locales.create({ name: code, code });
  const token = await strapi.service('admin::api-token').create({ name: 'isolated-entry-acceptance', type: 'full-access', lifespan: null });
  const category = await strapi.documents('api::category.category').create({ data: { name: 'Synthetic category' } });
  const filePath = join(root, 'pixel.png');
  await require('sharp')({ create: { width: 2, height: 2, channels: 4, background: { r: 20, g: 60, b: 100, alpha: 1 } } }).png().toFile(filePath);
  client = new Client({ name: 'isolated-entry-acceptance', version: '1' });
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(STRAPI_|PROJECTS_CONFIG|AUDIT_DB|DATABASE_|DOTENV_)/.test(key)));
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, '--project-root', root, '--allow-entry-editing'],
    env: { ...cleanEnv, STRAPI_URL: baseUrl, STRAPI_API_TOKEN: token.accessKey, AUDIT_DB: join(root, 'audit.sqlite') } }));
  const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent.data; };
  const apply = async (preview, key) => call('apply_entry_write', { project: 'article', previewId: preview.previewId, expectedOperationHash: preview.revision.operationHash, idempotencyKey: key });
  const types = await call('list_content_types', { project: 'article' }); assert.equal(types.length, 4);
  const inspection = await call('inspect_content_type', { project: 'article', uid: 'api::article.article' });
  const upload = await call('preview_media_upload', { project: 'article', filePath, alternativeText: 'Synthetic acceptance image' });
  const media = await call('upload_media', { project: 'article', previewId: upload.previewId, expectedOperationHash: upload.revision.operationHash, idempotencyKey: 'real-media-upload' });
  assert.equal(media.verified, true);
  const input = { project: 'article', uid: 'api::article.article', inspectionId: inspection.inspectionId, action: 'create', data: {
    title: 'Synthetic user summit', slug: 'synthetic-user-summit', date: '2026-10-13', heroImage: media.id, category: category.documentId,
    summary: [{ text: 'Synthetic introduction' }], body: '## Test section\n\nOnly fixture content.', metadata: { id: 'application-id', nested: { documentId: 'keep-json-id' } },
    richBlocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Structured rich text' }] }], enabled: false,
    amount: 12.5, count: 3, large: '9007199254740991', timestamp: '2026-10-13T10:00:00+03:00', clock: '09:30',
  } };
  const created = await apply(await call('preview_entry_write', input), 'real-article-create'); assert.equal(created.verified, true);
  const documentId = created.documentId;
  const documents = strapi.documents('api::article.article');
  await documents.publish({ documentId, locale: 'en' }); // Fixture baseline only, outside the MCP.
  const publishedBefore = await documents.findOne({ documentId, locale: 'en', status: 'published' });
  const before = await call('get_entry', { project: 'article', uid: input.uid, documentId, locale: 'en' });
  const updated = await apply(await call('preview_entry_write', { ...input, action: 'update', documentId, data: { body: 'Updated fixture body' } }), 'real-article-update'); assert.equal(updated.verified, true);
  const after = await call('get_entry', { project: 'article', uid: input.uid, documentId, locale: 'en' });
  assert.deepEqual(after.entry.data.summary, before.entry.data.summary);
  assert.deepEqual(after.entry.data.metadata, input.data.metadata);
  assert.deepEqual(await documents.findOne({ documentId, locale: 'en', status: 'published' }), publishedBefore);
  for (const locale of ['ar', 'ckb']) {
    const preview = await call('preview_entry_write', { project: 'article', uid: input.uid, inspectionId: inspection.inspectionId,
      action: 'localize', documentId, locale, data: { title: `Synthetic ${locale}`, body: `Fixture ${locale}`, summary: [{ text: `Introduction ${locale}` }] } });
    assert.equal((await apply(preview, `real-localize-${locale}`)).documentId, documentId);
    const localizedEntry = await call('get_entry', { project: 'article', uid: input.uid, documentId, locale });
    assert.equal(localizedEntry.entry.data.slug, input.data.slug); assert.equal(localizedEntry.entry.data.heroImage, media.id);
  }
  const single = await call('inspect_content_type', { project: 'article', uid: 'api::setting.setting' });
  await apply(await call('preview_entry_write', { project: 'article', uid: 'api::setting.setting', inspectionId: single.inspectionId, action: 'create', data: { title: 'Synthetic setting' } }), 'real-single-create');
  await apply(await call('preview_entry_write', { project: 'article', uid: 'api::setting.setting', inspectionId: single.inspectionId, action: 'update', data: { title: 'Updated setting' } }), 'real-single-update');
  const lead = await call('inspect_content_type', { project: 'article', uid: 'api::lead.lead' });
  const immediate = await apply(await call('preview_entry_write', { project: 'article', uid: 'api::lead.lead', inspectionId: lead.inspectionId,
    action: 'create', allowImmediateWrite: true, data: { email: 'synthetic@example.com' } }), 'real-no-draft-create'); assert.equal(immediate.status, 'immediate');
  console.log(JSON.stringify({ ok: true, strapiVersion: version, allTypeDiscovery: true, mediaUploadViaStdio: true,
    collectionCreateUpdate: true, componentIdsPreserved: true, applicationJsonPreserved: true, blocksRichText: true,
    numericDateTimeFields: true, linkedThreeLocales: true, sharedSlugs: true, singleTypeCreateUpdate: true,
    immediateVisibilityExplicit: true, publishedUnchanged: true, isolatedDatabase: true }));
} finally {
  if (client) await client.close(); if (strapi) await strapi.destroy(); process.chdir(originalCwd); await rm(root, { recursive: true, force: true });
}
