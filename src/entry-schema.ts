import type { JsonObject } from './types.js';
import type { ContentRegistry, ContentType } from './content-types.js';
import { AppError } from './errors.js';

const system = new Set(['id', 'documentId', 'locale', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'localizations']);
const strings = new Set(['string', 'text', 'richtext', 'email', 'uid', 'enumeration', 'date', 'datetime', 'time']);
export const manyRelation = (field: JsonObject) => ['oneToMany', 'manyToMany', 'manyWay'].includes(String(field.relation));
export const localizedField = (field: JsonObject) => field.type === 'uid' || ((field.pluginOptions as JsonObject | undefined)?.i18n as JsonObject | undefined)?.localized === true;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (path: string, message: string): never => { throw new AppError('SCHEMA_VALIDATION_FAILED', `${path}: ${message}`); };

export class EntrySchema {
  constructor(readonly type: ContentType, readonly registry: ContentRegistry) {}

  async normalize(data: JsonObject, existing?: JsonObject): Promise<JsonObject> {
    return this.normalizeObject(data, this.type.schema.attributes as JsonObject, this.type.uid, existing, !existing);
  }

  private normalizeObject(data: JsonObject, attributes: JsonObject, path: string, existing?: JsonObject, complete = true): JsonObject {
    if (!object(data)) fail(path, 'expected an object');
    const output: JsonObject = {};
    for (const key of Object.keys(data)) {
      if (system.has(key) || key === '__component' || !Object.hasOwn(attributes, key)) fail(`${path}.${key}`, 'unknown or system-managed field');
    }
    for (const [name, raw] of Object.entries(attributes)) {
      const field = raw as JsonObject;
      let value = data[name];
      if (value === undefined && complete && field.default !== undefined) value = structuredClone(field.default);
      if (value === undefined && !complete) continue;
      if (field.private === true || field.type === 'password') {
        if (value !== undefined || (complete && field.required === true)) fail(`${path}.${name}`, 'private/password fields are not writable through content tools');
        continue;
      }
      if (value === undefined) { if (field.required === true) fail(`${path}.${name}`, 'required field missing'); continue; }
      if (value === null) { if (field.required === true) fail(`${path}.${name}`, 'required field cannot be null'); output[name] = null; continue; }
      output[name] = this.value(value, field, `${path}.${name}`, existing?.[name]);
    }
    return output;
  }

  private value(value: unknown, field: JsonObject, path: string, before?: unknown): unknown {
    if (field.type === 'customField') {
      const storageType = this.registry.customFieldTypes?.[String(field.customField)];
      if (!storageType) fail(path, 'custom field requires its verified storage type in customFieldTypes');
      return this.value(value, { ...field, type: storageType }, path, before);
    }
    const type = String(field.type);
    if (strings.has(type)) {
      if (typeof value !== 'string') fail(path, `expected ${type} string`);
      const text = value as string;
      if (field.required && text.length === 0) fail(path, 'required string cannot be empty');
      if (typeof field.minLength === 'number' && text.length < field.minLength) fail(path, 'shorter than minLength');
      if (typeof field.maxLength === 'number' && text.length > field.maxLength) fail(path, 'longer than maxLength');
      if (typeof field.regex === 'string' && !new RegExp(field.regex).test(text)) fail(path, 'does not match schema regex');
      if (type === 'enumeration' && !(field.enum as unknown[]).includes(text)) fail(path, 'not an allowed enum value');
      if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) fail(path, 'invalid email');
      if (type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)) fail(path, 'invalid ISO date');
      if (type === 'datetime' && (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text)))) fail(path, 'invalid ISO datetime');
      if (type === 'time' && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(text)) fail(path, 'invalid time');
      if (type === 'datetime') return new Date(text).toISOString();
      if (type === 'time') return text.length === 5 ? `${text}:00.000` : `${text.split('.')[0]}.${(text.split('.')[1] ?? '').padEnd(3, '0')}`;
      return text;
    }
    if (['integer', 'float', 'decimal', 'biginteger'].includes(type)) {
      if (type === 'biginteger') {
        if (!(typeof value === 'number' && Number.isSafeInteger(value)) && !(typeof value === 'string' && /^-?\d+$/.test(value))) fail(path, 'expected safe integer or integer string');
        const number = BigInt(value as string | number);
        if (number < -(2n ** 63n) || number > 2n ** 63n - 1n) fail(path, 'outside signed 64-bit range');
        if (typeof field.min === 'number' && number < BigInt(field.min)) fail(path, 'below min');
        if (typeof field.max === 'number' && number > BigInt(field.max)) fail(path, 'above max');
        return number.toString();
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isSafeInteger(value))) fail(path, `expected finite ${type}`);
      if (typeof field.min === 'number' && Number(value) < field.min) fail(path, 'below min');
      if (typeof field.max === 'number' && Number(value) > field.max) fail(path, 'above max');
      return value;
    }
    if (type === 'boolean') { if (typeof value !== 'boolean') fail(path, 'expected boolean'); return value; }
    if (type === 'json') return structuredClone(value);
    if (type === 'blocks') { this.blocks(value, path); return structuredClone(value); }
    if (type === 'component') {
      const uid = String(field.component);
      const schema = this.registry.components[uid];
      if (!schema) fail(path, `component schema not found: ${uid}`);
      const component = (item: unknown, original?: unknown): JsonObject => {
        if (!object(item)) fail(path, 'expected component object');
        const input = { ...(item as JsonObject) };
        const originalObject = object(original) ? original : undefined;
        const id = input.id;
        delete input.id;
        if (id !== undefined && (!Number.isSafeInteger(id) || Number(id) < 1 || originalObject?.id !== id)) fail(path, 'component ID does not belong to the current field');
        const merged = originalObject ? { ...this.snapshotObject(originalObject, schema.attributes as JsonObject), ...input } : input;
        delete merged.id;
        const result = this.normalizeObject(merged, schema.attributes as JsonObject, path, originalObject, true);
        if (originalObject?.id !== undefined) result.id = originalObject.id;
        return result;
      };
      if (field.repeatable !== true) return component(value, before);
      if (!Array.isArray(value)) fail(path, 'expected repeatable component array');
      this.length(value as unknown[], field, path);
      const originals = Array.isArray(before) ? before : [];
      const ids = new Set<unknown>();
      return (value as unknown[]).map(item => {
        const id = object(item) ? item.id : undefined;
        if (id !== undefined && ids.has(id)) fail(path, 'duplicate component ID');
        ids.add(id);
        return component(item, id === undefined ? undefined : originals.find(old => object(old) && old.id === id));
      });
    }
    if (type === 'dynamiczone') {
      if (!Array.isArray(value)) fail(path, 'expected dynamic-zone array');
      this.length(value as unknown[], field, path);
      const ids = new Set<unknown>();
      return (value as unknown[]).map((item, index) => {
        if (!object(item) || !(field.components as string[])?.includes(String(item.__component))) fail(`${path}[${index}]`, 'component not allowed in this dynamic zone');
        const input = { ...(item as JsonObject) }; const uid = String(input.__component); delete input.__component;
        const id = input.id;
        if (id !== undefined && ids.has(id)) fail(path, 'duplicate component ID');
        ids.add(id);
        const original = Array.isArray(before) ? before.find(old => object(old) && old.id === id && old.__component === uid) : undefined;
        return { __component: uid, ...(this.value(input, { type: 'component', component: uid }, `${path}[${index}]`, original) as JsonObject) };
      });
    }
    if (type === 'media' || type === 'relation') {
      const many = type === 'media' ? field.multiple === true : manyRelation(field);
      if (type === 'relation' && (typeof field.target !== 'string' || String(field.relation).startsWith('morph'))) fail(path, 'polymorphic relations require a dedicated API contract');
      let refs = value;
      if (type === 'relation' && object(value)) {
        if (Object.keys(value).length !== 1 || !Object.hasOwn(value, 'set')) fail(path, 'use documentId references or an explicit set array');
        refs = value.set;
        if (!many && Array.isArray(refs)) { if (refs.length > 1) fail(path, 'single relation accepts one document'); refs = refs[0] ?? null; }
      }
      const reference = (ref: unknown) => {
        if (type === 'media') { if (!Number.isSafeInteger(ref) || Number(ref) < 1) fail(path, 'media requires a numeric Media Library ID'); }
        else if (typeof ref !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(ref)) fail(path, 'relation requires a Strapi documentId');
        return ref;
      };
      if (!many) { if (refs === null && !field.required) return null; return reference(refs); }
      if (!Array.isArray(refs)) fail(path, 'expected reference array');
      this.length(refs as unknown[], field, path);
      const normalized = (refs as unknown[]).map(reference);
      if (new Set(normalized).size !== normalized.length) fail(path, 'duplicate references');
      return normalized;
    }
    return fail(path, `unsupported field type ${type}; obtain its storage/API contract before writing`);
  }

  private length(value: unknown[], field: JsonObject, path: string): void {
    if (field.required && value.length === 0) fail(path, 'required array cannot be empty');
    if (typeof field.min === 'number' && value.length < field.min) fail(path, 'fewer than minimum items');
    if (typeof field.max === 'number' && value.length > field.max) fail(path, 'more than maximum items');
  }

  private blocks(value: unknown, path: string): void {
    if (!Array.isArray(value)) fail(path, 'expected Blocks rich-text array');
    const visit = (node: unknown, depth: number): void => {
      if (!object(node) || depth > 40 || !['paragraph', 'heading', 'list', 'list-item', 'quote', 'code', 'image', 'link', 'text'].includes(String(node.type))) fail(path, 'invalid Blocks node');
      const item = node as JsonObject;
      if (item.type === 'text') { if (typeof item.text !== 'string') fail(path, 'text node requires text'); return; }
      if (item.type === 'heading' && (!Number.isInteger(item.level) || Number(item.level) < 1 || Number(item.level) > 6)) fail(path, 'heading level must be 1–6');
      if (item.type === 'list' && !['ordered', 'unordered'].includes(String(item.format))) fail(path, 'invalid list format');
      if (item.type === 'link' && typeof item.url !== 'string') fail(path, 'link requires URL');
      if (item.type === 'image') { if (!object(item.image) || typeof item.image.url !== 'string') fail(path, 'image requires image metadata and URL'); }
      if (!Array.isArray(item.children)) fail(path, 'node requires children');
      (item.children as unknown[]).forEach(child => visit(child, depth + 1));
    };
    (value as unknown[]).forEach(node => visit(node, 0));
  }

  snapshot(data: JsonObject): JsonObject { return this.snapshotObject(data, this.type.schema.attributes as JsonObject); }

  private snapshotObject(data: JsonObject, attributes: JsonObject): JsonObject {
    const result: JsonObject = {};
    if (data.id !== undefined) result.id = data.id;
    for (const [name, raw] of Object.entries(attributes)) {
      const originalField = raw as JsonObject;
      const field = originalField.type === 'customField' && this.registry.customFieldTypes?.[String(originalField.customField)]
        ? { ...originalField, type: this.registry.customFieldTypes[String(originalField.customField)] } : originalField;
      if (field.private === true || field.type === 'password' || data[name] === undefined) continue;
      const value = data[name];
      if (value === null) { result[name] = null; continue; }
      if (field.type === 'component' || field.type === 'dynamiczone') {
        const item = (v: unknown) => {
          if (!object(v)) fail(name, 'component was not completely populated');
          const uid = field.type === 'dynamiczone' ? String((v as JsonObject).__component) : String(field.component);
          if (!this.registry.components[uid]) fail(name, `component schema missing: ${uid}`);
          const snapshot = this.snapshotObject(v as JsonObject, this.registry.components[uid].attributes as JsonObject);
          return field.type === 'dynamiczone' ? { __component: uid, ...snapshot } : snapshot;
        };
        result[name] = Array.isArray(value) ? value.map(item) : item(value);
      } else if (field.type === 'media' || field.type === 'relation') {
        const ref = (v: unknown) => object(v) ? (field.type === 'media' ? v.id : v.documentId) : v;
        result[name] = Array.isArray(value) ? value.map(ref) : ref(value);
      } else if (field.type === 'biginteger') result[name] = BigInt(value as string | number).toString();
      else if (['decimal', 'float', 'integer'].includes(String(field.type))) result[name] = Number(value);
      else if (field.type === 'datetime') result[name] = new Date(String(value)).toISOString();
      else if (field.type === 'time') { const text = String(value); result[name] = text.length === 5 ? `${text}:00.000` : `${text.split('.')[0]}.${(text.split('.')[1] ?? '').padEnd(3, '0')}`; }
      else result[name] = structuredClone(value);
    }
    return result;
  }

  /** Match supplied fields; generated component IDs are checked only when retained explicitly. */
  assertWritten(expected: unknown, actual: unknown, path = '$'): void {
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || expected.length !== actual.length) throw new AppError('VERIFICATION_FAILED', `Array differs: ${path}`);
      expected.forEach((value, index) => this.assertWritten(value, (actual as unknown[])[index], `${path}[${index}]`));
    } else if (object(expected)) {
      if (!object(actual)) throw new AppError('VERIFICATION_FAILED', `Object differs: ${path}`);
      for (const [key, value] of Object.entries(expected)) this.assertWritten(value, (actual as JsonObject)[key], `${path}.${key}`);
      for (const [key, value] of Object.entries(actual as JsonObject)) if (!Object.hasOwn(expected, key) && key !== 'id' && value !== null && !(Array.isArray(value) && value.length === 0)) throw new AppError('VERIFICATION_FAILED', `Unexpected component field: ${path}.${key}`);
    } else if (!Object.is(expected, actual)) throw new AppError('VERIFICATION_FAILED', `Value differs: ${path}`);
  }
}
