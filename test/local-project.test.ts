import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { localProject } from '../src/local-project.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startMockStrapi } from './mock-strapi.js';

test('env-file onboarding discovers schema and clones through the real stdio protocol', async () => {
  const root = await mkdtemp(join(tmpdir(), 'safe-local-'));
  const mock = await startMockStrapi({ documentId: 'source', slug: 'home', title: 'Home', blocks: [{ __component: 'shared.hero', title: 'Before' }] });
  const client = new Client({ name: 'local-onboarding-test', version: '1' });
  try {
    await mkdir(join(root, 'src/api/page/content-types/page'), { recursive: true });
    await mkdir(join(root, 'src/components/shared'), { recursive: true });
    await writeFile(join(root, 'src/components/shared/hero.json'), JSON.stringify({ attributes: { title: { type: 'string' }, image: { type: 'media' } } }));
    await writeFile(join(root, 'src/api/page/content-types/page/schema.json'), JSON.stringify({ kind: 'collectionType', options: { draftAndPublish: true }, info: { pluralName: 'pages' }, attributes: { title: { type: 'string' }, slug: { type: 'uid' }, blocks: { type: 'dynamiczone', components: ['shared.hero'] } } }));
    const config = await localProject({ STRAPI_PROJECT_ROOT: root, STRAPI_URL: mock.baseUrl });
    assert.equal(config.projects['page:blocks'].collection, 'pages');
    assert.ok(!decodeURIComponent(config.projects['page:blocks'].populate!).includes('[populate][0]'));
    assert.equal(new URLSearchParams(config.projects['page:blocks'].populate).get('populate[blocks][on][shared.hero][populate][image]'), 'true');
    await writeFile(join(root, '.env'), `STRAPI_URL=${mock.baseUrl}\nSTRAPI_API_TOKEN=test-local-token\nDATABASE_URL=postgresql://unused:unused@127.0.0.1:1/cms\n`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(STRAPI_|PROJECTS_CONFIG|AUDIT_DB|TRANSPORT|DATABASE_URL)/.test(key))) as Record<string, string>;
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.env.MCP_TEST_ENTRY ?? resolve('dist/src/index.js'), '--env-file', join(root, '.env')], env }));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return (result.structuredContent as any).data;
    };
    const projects = await call('list_projects', {});
    assert.equal(projects[0].name, 'page:blocks');
    assert.ok(!JSON.stringify(projects).includes('test-local-token'));
    const source = await call('inspect_page', { project: 'page:blocks', documentId: 'source' });
    await call('clone_page_and_modify', { project: 'page:blocks', sourceDocumentId: 'source', expectedSourceHash: source.contentHash, idempotencyKey: 'onboarding', operations: [{ type: 'patch', selector: { index: 0 }, changes: { title: 'After' } }] });
    assert.equal((mock.documents.get('source')!.blocks as any[])[0].title, 'Before');
    assert.equal(mock.documents.size, 2);
    const after = await call('inspect_page', { project: 'page:blocks', documentId: 'source' });
    assert.equal(after.contentHash, source.contentHash);
  } finally { await client.close(); await mock.close(); await rm(root, { recursive: true, force: true }); }
});

test('local onboarding refuses to guess when schemas are unavailable', async () => {
  await assert.rejects(localProject({ STRAPI_URL: 'https://cms.example.com', STRAPI_PROJECT_ROOT: '/nonexistent-safe-strapi-test' }), { code: 'CONFIG_ERROR' });
});
