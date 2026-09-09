import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOperations, normalizeForCreate } from '../src/operations.js';

const blocks = [
  { id: 1, __component: 'homepage.hero', title: 'Hero', button: { color: '#000' } },
  { id: 2, __component: 'homepage.features', title: 'Features' },
  { id: 3, __component: 'shared.faq', title: 'FAQ' },
];

test('inserts, patches and moves without mutating source', () => {
  const source = structuredClone(blocks);
  const result = applyOperations(source, [
    { type: 'insert', component: { __component: 'homepage.cta', title: 'CTA' }, position: { after: { component: 'homepage.hero' } } },
    { type: 'patch', selector: { component: 'homepage.hero' }, changes: { button: { color: '#f00' } } },
    { type: 'move', selector: { component: 'shared.faq' }, position: { start: true } },
  ]);

  assert.deepEqual(source, blocks);
  assert.deepEqual(result.blocks.map((item) => (item as Record<string, unknown>).__component), [
    'shared.faq', 'homepage.hero', 'homepage.cta', 'homepage.features',
  ]);
  assert.equal(((result.blocks[1] as any).button.color), '#f00');
});

test('rejects invalid selectors', () => {
  assert.throws(() => applyOperations(blocks, [
    { type: 'remove', selector: { component: 'missing.component' } },
  ]), /Component not found/);
  assert.throws(() => applyOperations(blocks, [
    { type: 'patch', selector: { index: 99 }, changes: {} },
  ]), /out of range/);
});

test('rejects ambiguous component selectors unless occurrence is explicit', () => {
  const repeated = [
    { __component: 'shared.card', value: 1 },
    { __component: 'shared.card', value: 2 },
  ];
  assert.throws(
    () => applyOperations(repeated, [{ type: 'patch', selector: { component: 'shared.card' }, changes: { value: 3 } }]),
    (error: any) => error.code === 'AMBIGUOUS_SELECTOR',
  );
  const result = applyOperations(repeated, [{ type: 'patch', selector: { component: 'shared.card', occurrence: 1 }, changes: { value: 3 } }]);
  assert.equal((result.blocks[1] as any).value, 3);
});

test('duplicates without ids and replaces exactly one component', () => {
  const result = applyOperations(blocks, [
    { type: 'duplicate', selector: { index: 0 }, position: { after: { index: 0 } } },
    { type: 'replace', selector: { index: 2 }, component: { __component: 'homepage.replacement', title: 'New' } },
  ]);
  assert.equal((result.blocks[1] as any).id, undefined);
  assert.equal((result.blocks[1] as any).__component, 'homepage.hero');
  assert.deepEqual(result.blocks[2], { __component: 'homepage.replacement', title: 'New' });
});

test('normalizes system fields, media and relations for create', () => {
  const result = normalizeForCreate({
    id: 1,
    documentId: 'source',
    title: 'Page',
    blocks: [{
      id: 20,
      __component: 'homepage.hero',
      image: { id: 9, documentId: 'asset-doc', url: '/image.jpg', mime: 'image/jpeg' },
      relatedPage: { id: 8, documentId: 'related-doc', title: 'Related' },
    }],
  }) as any;

  assert.equal(result.id, undefined);
  assert.equal(result.documentId, undefined);
  assert.equal(result.blocks[0].id, undefined);
  assert.equal(result.blocks[0].image, 9);
  assert.equal(result.blocks[0].relatedPage, 'related-doc');
});

test('normalizes media/relation arrays while preserving nested component data', () => {
  const result = normalizeForCreate({
    blocks: [{
      id: 1,
      __component: 'fixture.container',
      gallery: [
        { id: 10, documentId: 'media-10', url: '/10.jpg', mime: 'image/jpeg' },
        { id: 11, documentId: 'media-11', url: '/11.jpg', mime: 'image/jpeg' },
      ],
      related: [{ id: 20, documentId: 'relation-20', title: 'R1' }],
      items: [{ id: 30, label: 'Nested', children: [{ id: 31, label: 'Repeatable' }] }],
    }],
  }) as any;
  assert.deepEqual(result.blocks[0].gallery, [10, 11]);
  assert.deepEqual(result.blocks[0].related, ['relation-20']);
  assert.deepEqual(result.blocks[0].items, [{ label: 'Nested', children: [{ label: 'Repeatable' }] }]);
});
