import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AppError } from '../src/errors.js';
import { SchemaCatalog } from '../src/schema-catalog.js';

async function fixtureCatalog(): Promise<SchemaCatalog> {
  const root = await mkdtemp(join(tmpdir(), 'safe-strapi-schema-'));
  const directory = join(root, 'src/components/fixture');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'child.json'), JSON.stringify({
    info: { displayName: 'Child' },
    attributes: { label: { type: 'string', required: true }, media: { type: 'media' } },
  }));
  await writeFile(join(directory, 'container.json'), JSON.stringify({
    info: { displayName: 'Container' },
    attributes: {
      title: { type: 'string', required: true },
      items: { type: 'component', repeatable: true, component: 'fixture.child' },
      primary: { type: 'component', repeatable: false, component: 'fixture.child' },
    },
  }));
  return new SchemaCatalog({ baseUrl: 'http://localhost', tokenEnv: 'TOKEN', collection: 'pages', blocksField: 'blocks', slugField: 'slug', schemaRoot: root });
}

test('validates nested and repeatable components recursively', async () => {
  const catalog = await fixtureCatalog();
  await catalog.validateBlocks([{
    __component: 'fixture.container',
    title: 'Container',
    items: [{ id: 1, label: 'One', media: 9 }, { id: 2, label: 'Two' }],
    primary: { id: 3, label: 'Primary' },
  }]);
});

test('normalizes dynamic-zone discriminator first and removes nested discriminators', async () => {
  const catalog = await fixtureCatalog();
  const normalized = await catalog.normalizeDynamicZoneForWrite([{
    title: 'Container',
    __component: 'fixture.container',
    items: [{ id: 1, __component: 'fixture.child', label: 'One' }],
  }]) as any[];
  assert.equal(Object.keys(normalized[0])[0], '__component');
  assert.equal(normalized[0].items[0].__component, undefined);
  assert.equal(normalized[0].items[0].id, undefined);
});

test('rejects unknown nested fields and missing required values', async () => {
  const catalog = await fixtureCatalog();
  await assert.rejects(
    () => catalog.validateBlocks([{ __component: 'fixture.container', title: 'Container', items: [{ label: 'One', accidental: true }] }]),
    (error: unknown) => error instanceof AppError && error.code === 'SCHEMA_VALIDATION_FAILED',
  );
  await assert.rejects(
    () => catalog.validateBlocks([{ __component: 'fixture.container', items: [] }]),
    (error: unknown) => error instanceof AppError && error.code === 'SCHEMA_VALIDATION_FAILED',
  );
});
