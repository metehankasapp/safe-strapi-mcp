import type { ChangeSummary, JsonObject, Operation, Position, Selector } from './types.js';
import { AppError } from './errors.js';

const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);

function componentName(value: unknown): string {
  if (!value || typeof value !== 'object') return 'unknown';
  const name = (value as JsonObject).__component;
  return typeof name === 'string' ? name : 'unknown';
}

export function resolveIndex(blocks: unknown[], selector: Selector): number {
  if (selector.index !== undefined && selector.component !== undefined) {
    throw new AppError('INVALID_REQUEST', 'Selector cannot contain both index and component');
  }
  if (selector.index !== undefined) {
    if (!Number.isInteger(selector.index) || selector.index < 0 || selector.index >= blocks.length) {
      throw new AppError('INDEX_OUT_OF_RANGE', `Component index out of range: ${selector.index}`, { index: selector.index, length: blocks.length });
    }
    return selector.index;
  }

  if (!selector.component) throw new AppError('INVALID_REQUEST', 'Selector requires index or component');
  const occurrence = selector.occurrence ?? 0;
  if (!Number.isInteger(occurrence) || occurrence < 0) throw new AppError('INVALID_REQUEST', 'Occurrence must be a non-negative integer');
  const matches = blocks.flatMap((block, index) => componentName(block) === selector.component ? [index] : []);
  if (selector.occurrence === undefined && matches.length > 1) {
    throw new AppError('AMBIGUOUS_SELECTOR', `Multiple ${selector.component} components found; provide occurrence or index`, { matches });
  }
  if (matches[occurrence] === undefined) {
    throw new AppError('SELECTOR_NOT_FOUND', `Component not found: ${selector.component} occurrence ${occurrence}`);
  }
  return matches[occurrence];
}

function insertionIndex(blocks: unknown[], position: Position): number {
  if ('start' in position) return 0;
  if ('end' in position) return blocks.length;
  if ('before' in position) return resolveIndex(blocks, position.before);
  return resolveIndex(blocks, position.after) + 1;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function merge(target: JsonObject, changes: JsonObject, path = '', changed: string[] = []): JsonObject {
  for (const [key, value] of Object.entries(changes)) {
    if (forbiddenKeys.has(key)) throw new AppError('INVALID_REQUEST', `Forbidden patch key: ${key}`);
    const nextPath = path ? `${path}.${key}` : key;
    const current = target[key];
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      current && typeof current === 'object' && !Array.isArray(current)
    ) {
      merge(current as JsonObject, value as JsonObject, nextPath, changed);
    } else {
      target[key] = clone(value);
      changed.push(nextPath);
    }
  }
  return target;
}

export function applyOperations(input: unknown[], operations: Operation[]): {
  blocks: unknown[];
  changes: ChangeSummary[];
} {
  const blocks = clone(input);
  const changes: ChangeSummary[] = [];

  for (const operation of operations) {
    if (operation.type === 'insert') {
      if (typeof operation.component.__component !== 'string') {
        throw new AppError('INVALID_REQUEST', 'Inserted component requires a __component string');
      }
      const to = insertionIndex(blocks, operation.position);
      blocks.splice(to, 0, clone(operation.component));
      changes.push({ type: 'insert', component: componentName(operation.component), to });
      continue;
    }

    const from = resolveIndex(blocks, operation.selector);
    const selected = blocks[from];
    const name = componentName(selected);

    if (operation.type === 'duplicate') {
      const copy = normalizeForCreate(selected, false);
      const to = insertionIndex(blocks, operation.position);
      blocks.splice(to, 0, copy);
      changes.push({ type: 'duplicate', component: name, from, to });
      continue;
    }

    if (operation.type === 'replace') {
      if (typeof operation.component.__component !== 'string') {
        throw new AppError('INVALID_REQUEST', 'Replacement component requires a __component string');
      }
      blocks.splice(from, 1, clone(operation.component));
      changes.push({ type: 'replace', component: componentName(operation.component), from, to: from });
      continue;
    }

    if (operation.type === 'remove') {
      blocks.splice(from, 1);
      changes.push({ type: 'remove', component: name, from });
      continue;
    }

    if (operation.type === 'patch') {
      if (!selected || typeof selected !== 'object' || Array.isArray(selected)) {
        throw new AppError('INVALID_REQUEST', `Cannot patch component at index ${from}`);
      }
      const changedPaths: string[] = [];
      merge(selected as JsonObject, operation.changes, '', changedPaths);
      changes.push({ type: 'patch', component: name, from, changedPaths });
      continue;
    }

    const [moving] = blocks.splice(from, 1);
    const to = insertionIndex(blocks, operation.position);
    blocks.splice(to, 0, moving);
    changes.push({ type: 'move', component: name, from, to });
  }

  return { blocks, changes };
}

const systemKeys = new Set([
  'id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy',
  'localizations', 'locale',
]);

function looksLikeMedia(value: JsonObject): boolean {
  return typeof value.url === 'string' && typeof value.mime === 'string' && typeof value.id === 'number';
}

export function normalizeForCreate(value: unknown, root = true): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeForCreate(item, false));
  if (!value || typeof value !== 'object') return value;

  const object = value as JsonObject;
  if (!root && looksLikeMedia(object)) return object.id;
  if (!root && typeof object.documentId === 'string' && typeof object.__component !== 'string') {
    return object.documentId;
  }

  const result: JsonObject = {};
  for (const [key, nested] of Object.entries(object)) {
    if (systemKeys.has(key)) continue;
    result[key] = normalizeForCreate(nested, false);
  }
  return result;
}
