import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('stdio server exposes only the safe tool surface', async () => {
  const client = new Client({ name: 'safe-strapi-test', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/src/index.js')],
    env: {
      ...process.env,
      TRANSPORT: 'stdio',
      PROJECTS_CONFIG: resolve('config/projects.example.json'),
      AUDIT_DB: resolve('data/test-audit.sqlite'),
    } as Record<string, string>,
  });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      'clone_page_and_modify',
      'compare_pages',
      'duplicate_component',
      'find_pages',
      'get_component_schema',
      'inspect_owned_draft',
      'inspect_page',
      'list_components',
      'list_projects',
      'modify_owned_draft',
      'preview_clone_and_modify',
      'replace_component',
      'validate_draft',
    ]);
    assert.equal(names.some((name) => /delete|publish|update_source/.test(name)), false);
    const failed = await client.callTool({
      name: 'inspect_page',
      arguments: { project: 'my-site', documentId: 'any-document' },
    });
    assert.equal(failed.isError, true);
    assert.equal((failed.structuredContent as any).ok, false);
    assert.equal((failed.structuredContent as any).error.code, 'TOKEN_MISSING');
  } finally {
    await client.close();
  }
});
