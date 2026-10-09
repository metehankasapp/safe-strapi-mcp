import { AppError } from './errors.js';
import { applyOperations, resolveIndex } from './operations.js';
import { contentHash } from './strapi-client.js';
import type { JsonObject, Operation } from './types.js';

export type InPlaceOperation = Extract<Operation, { type: 'patch' | 'insert' }>;
const protectedKeys = new Set(['id', 'documentId', '__component', '__proto__', 'constructor', 'prototype']);

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function checkPatch(before: JsonObject, changes: JsonObject, path = ''): void {
  for (const [key, value] of Object.entries(changes)) {
    const field = path ? `${path}.${key}` : key;
    if (protectedKeys.has(key)) throw new AppError('CONTENT_REMOVAL_BLOCKED', `Protected patch field: ${field}`);
    const current = before[key];
    // Arrays are atomic in the existing operation engine. Refuse replacement,
    // including equal-length substitutions that could silently drop an item.
    if (Array.isArray(current) || Array.isArray(value)) {
      if (contentHash(current ?? null) !== contentHash(value)) {
        throw new AppError('CONTENT_REMOVAL_BLOCKED', `Array replacement is unsupported: ${field}`);
      }
    } else if (object(value) && object(current)) {
      checkPatch(current, value, field);
    } else if (object(value) || object(current)) {
      throw new AppError('CONTENT_REMOVAL_BLOCKED', `Object replacement is unsupported: ${field}`);
    } else if (current !== undefined && current !== null && current !== '' &&
      (value === undefined || value === null || (typeof value === 'string' && value.trim() === ''))) {
      throw new AppError('CONTENT_REMOVAL_BLOCKED', `Cannot clear existing content: ${field}`);
    }
  }
}

function checkInsert(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(checkInsert); return; }
  if (!object(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype', 'documentId'].includes(key)) {
      throw new AppError('INVALID_REQUEST', `Forbidden inserted field: ${key}`);
    }
    checkInsert(nested);
  }
}

export function planInPlace(input: unknown[], operations: InPlaceOperation[]) {
  if (!operations.length || operations.length > 100) throw new AppError('INVALID_REQUEST', 'Provide 1 to 100 operations');
  let blocks = structuredClone(input);
  const changes = [];
  for (const operation of operations) {
    if (operation.type === 'patch') {
      const selected = blocks[resolveIndex(blocks, operation.selector)];
      if (!object(selected)) throw new AppError('INVALID_REQUEST', 'Invalid target component');
      checkPatch(selected, operation.changes);
    } else if (operation.type === 'insert') checkInsert(operation.component);
    else throw new AppError('CONTENT_REMOVAL_BLOCKED', 'In-place editing only supports patch and insert');
    const result = applyOperations(blocks, [operation]);
    blocks = result.blocks;
    changes.push(...result.changes);
  }
  return { blocks, changes };
}
