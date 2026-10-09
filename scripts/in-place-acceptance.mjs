// Run after npm run build: node scripts/in-place-acceptance.mjs /path/to/installed/strapi-project
// Only reuses installed dependencies. Creates a temporary app, SQLite DB and
// credentials; never loads the supplied project's config, env, or customer data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { AuditStore } from '../dist/src/audit.js';
import { ContentService } from '../dist/src/service.js';
import { localProject } from '../dist/src/local-project.js';
import { contentHash } from '../dist/src/strapi-client.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dependencyRoot = process.argv[2];
if (!dependencyRoot) throw new Error('Supply a Strapi project with installed dependencies');
const require = createRequire(resolve(dependencyRoot, 'package.json'));
const { createStrapi } = require('@strapi/strapi');
const version = require('@strapi/strapi/package.json').version;
const entry = resolve('dist/src/index.js');
const root = await mkdtemp(join(tmpdir(), 'safe-in-place-real-'));
const originalCwd = process.cwd();
let strapi;
let audit;
let client;
const put = async (path, content) => {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
};
try {
  await symlink(resolve(dependencyRoot, 'node_modules'), join(root, 'node_modules'));
  await mkdir(join(root, 'public/uploads'), { recursive: true });
  await put('package.json', { name: 'isolated-in-place-test', version: '1.0.0', dependencies: { '@strapi/strapi': version } });
  await put('config/server.js', `module.exports = {host:'127.0.0.1', port:0, app:{keys:[${JSON.stringify(randomUUID())}]}, cron:{enabled:false}};`);
  await put('config/admin.js', `module.exports = {serveAdminPanel:false, auth:{secret:${JSON.stringify(randomUUID())}}, apiToken:{salt:${JSON.stringify(randomUUID())}}, transfer:{token:{salt:${JSON.stringify(randomUUID())}}}, secrets:{encryptionKey:${JSON.stringify(randomUUID())}}};`);
  await put('config/database.js', `module.exports = {connection:{client:'sqlite',connection:{filename:${JSON.stringify(join(root, 'test.sqlite'))}},useNullAsDefault:true}};`);
  await put('src/api/page/content-types/page/schema.json', { kind: 'collectionType', collectionName: 'test_pages',
    info: { singularName: 'page', pluralName: 'pages', displayName: 'Page' }, options: { draftAndPublish: true }, attributes: {
      title: { type: 'string' }, slug: { type: 'uid', targetField: 'title' },
      blocks: { type: 'dynamiczone', components: ['shared.block'] },
    } });
  await put('src/components/shared/block.json', { collectionName: 'test_blocks', info: { displayName: 'Block' }, attributes: {
    title: { type: 'string' }, child: { type: 'component', component: 'shared.child' },
    items: { type: 'component', component: 'shared.child', repeatable: true },
    image: { type: 'media' }, related: { type: 'relation', relation: 'manyToOne', target: 'api::page.page' }, settings: { type: 'json' },
  } });
  await put('src/components/shared/child.json', { collectionName: 'test_children', info: { displayName: 'Child' }, attributes: { label: { type: 'string' } } });
  for (const [folder, factory] of [['routes', 'createCoreRouter'], ['controllers', 'createCoreController'], ['services', 'createCoreService']]) {
    await put(`src/api/page/${folder}/page.js`, `module.exports = require('@strapi/strapi').factories.${factory}('api::page.page');`);
  }
  process.chdir(root);
  strapi = createStrapi({ appDir: root, distDir: root });
  await strapi.load();
  await strapi.server.listen();
  const baseUrl = `http://127.0.0.1:${strapi.server.httpServer.address().port}`;
  const token = await strapi.service('admin::api-token').create({ name: 'isolated-test', type: 'full-access', lifespan: null });
  const env = { STRAPI_URL: baseUrl, STRAPI_API_TOKEN: token.accessKey, STRAPI_PROJECT_ROOT: root, STRAPI_ALLOW_IN_PLACE_EDITING: 'true' };
  process.env.STRAPI_API_TOKEN = token.accessKey;
  const config = await localProject(env);
  audit = new AuditStore(join(root, 'audit.sqlite'));
  const service = new ContentService(config, audit);
  const documents = strapi.documents('api::page.page');
  const related = await documents.create({ data: { title: 'Related', slug: 'related', blocks: [] } });
  const media = await strapi.db.query('plugin::upload.file').create({ data: { name: 'fixture.png', hash: 'fixture',
    ext: '.png', mime: 'image/png', size: 1, url: '/uploads/fixture.png', provider: 'local' } });
  const created = await documents.create({ data: { title: 'Fixture', slug: 'fixture', blocks: Array.from({ length: 4 }, (_, i) => ({
    __component: 'shared.block', title: `Block ${i}`, child: { label: `Child ${i}` }, items: [{ label: 'One' }, { label: 'Two' }],
    image: media.id, related: related.documentId, settings: { id: 'application-id', active: true },
  })) } });
  await documents.publish({ documentId: created.documentId });
  const read = status => documents.findOne({ documentId: created.documentId, status,
    populate: { blocks: { on: { 'shared.block': { populate: { child: true, items: true, image: true, related: true } } } } } });
  const before = await read('draft');
  const publishedBefore = await read('published');
  const publishedHash = contentHash(publishedBefore);
  const input = { project: 'page:blocks', documentId: created.documentId, operations: [{ type: 'patch', selector: { index: 1 }, changes: { title: 'Edited middle', child: { label: 'Edited child' } } }] };
  const preview = await service.previewModifyPage(input);
  await service.modifyPage({ ...input, expectedPageHash: preview.pageHash, expectedOperationHash: preview.operationHash, idempotencyKey: 'real-middle-edit' });
  const after = await read('draft');
  assert.equal(after.blocks[1].title, 'Edited middle');
  assert.equal(after.blocks[1].child.label, 'Edited child');
  for (let i = 0; i < before.blocks.length; i += 1) {
    assert.equal(after.blocks[i].id, before.blocks[i].id);
    assert.equal(after.blocks[i].child.id, before.blocks[i].child.id);
    assert.deepEqual(after.blocks[i].items, before.blocks[i].items);
    if (i !== 1) assert.deepEqual(after.blocks[i], before.blocks[i]);
  }
  assert.equal(contentHash(await read('published')), publishedHash);
  // Exercise the new surface via real MCP stdio and real REST too.
  client = new Client({ name: 'isolated-in-place-acceptance', version: '1' });
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(STRAPI_|PROJECTS_CONFIG|AUDIT_DB|DATABASE_|DOTENV_)/.test(key)));
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, '--project-root', root, '--allow-in-place-editing'],
    env: { ...childEnv, ...env, AUDIT_DB: join(root, 'stdio-audit.sqlite') } }));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent.data;
  };
  const stdioPatch = { ...input, operations: [{ type: 'patch', selector: { index: 1 },
    changes: { title: 'Temporary stdio change', child: { label: 'Temporary nested change' } } }] };
  const stdioPreview = await call('preview_modify_page', stdioPatch);
  assert.equal(stdioPreview.contractVersion, '1');
  assert.equal(stdioPreview.fieldChanges.length, 2);
  const stdioResult = await call('modify_page', { ...stdioPatch, expectedPageHash: stdioPreview.pageHash,
    expectedOperationHash: stdioPreview.operationHash, idempotencyKey: 'real-stdio-patch' });
  assert.equal(stdioResult.rollbackSupported, true);
  const undo = { project: input.project, documentId: input.documentId, operationId: stdioResult.operationId };
  const undoPreview = await call('preview_rollback_page', undo);
  assert.equal(undoPreview.contractVersion, '1');
  assert.equal(undoPreview.action, 'rollback_page');
  assert.equal(undoPreview.fieldChanges.length, 2);
  const undoResult = await call('rollback_page', { ...undo, expectedPageHash: undoPreview.pageHash,
    expectedOperationHash: undoPreview.operationHash, idempotencyKey: 'real-stdio-rollback' });
  assert.equal(undoResult.verified, true);
  assert.deepEqual((await read('draft')).blocks, after.blocks);
  assert.equal(contentHash(await read('published')), publishedHash);
  const history = await call('list_page_operations', { project: input.project, documentId: input.documentId });
  assert.deepEqual(history.operations.map(operation => operation.operationId), ['real-stdio-rollback', 'real-stdio-patch']);
  const inserted = { ...input, operations: [{ type: 'insert', component: { __component: 'shared.block', title: 'Inserted',
    child: { label: 'New' }, items: [], image: media.id, related: related.documentId, settings: { id: 'new-application-id' } }, position: { after: { index: 1 } } }] };
  const insertionPreview = await call('preview_modify_page', inserted);
  const insertionResult = await call('modify_page', { ...inserted, expectedPageHash: insertionPreview.pageHash, expectedOperationHash: insertionPreview.operationHash, idempotencyKey: 'real-stdio-insert' });
  assert.equal(insertionResult.verified, true);
  const final = await read('draft');
  assert.equal(final.blocks.length, 5);
  assert.deepEqual(final.blocks.filter(b => b.title !== 'Inserted'), after.blocks);
  assert.equal(contentHash(await read('published')), publishedHash);
  console.log(JSON.stringify({ ok: true, strapiVersion: version, middlePatch: true, nestedIdsPreserved: true,
    insertionViaStdio: true, rollbackViaStdio: true, versionedPreviews: true,
    mediaRelationsPreserved: true, publishedUnchanged: true, isolatedDatabase: true }));
} finally {
  if (client) await client.close();
  if (audit) audit.close();
  if (strapi) await strapi.destroy();
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
}
