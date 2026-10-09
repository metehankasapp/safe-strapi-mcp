import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { JsonObject, ProjectConfig } from './types.js';
import { AppError } from './errors.js';
import { normalizeForCreate } from './operations.js';
import { contentHash } from './strapi-client.js';

const systemKeys = new Set(['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'localizations', 'locale']);

export class SchemaCatalog {
  constructor(private readonly project: ProjectConfig) {}

  async inPlaceSchema(): Promise<JsonObject> {
    const schema = this.project.contentTypeSchema ?? (this.project.schemaRoot && this.project.contentType
      ? JSON.parse(await readFile(resolve(this.project.schemaRoot, 'src/api', this.project.contentType,
        'content-types', this.project.contentType, 'schema.json'), 'utf8')) as JsonObject : undefined);
    const zone = (schema?.attributes as JsonObject | undefined)?.[this.project.blocksField] as JsonObject | undefined;
    if (schema?.kind !== 'collectionType' || (schema.options as JsonObject | undefined)?.draftAndPublish !== true ||
      zone?.type !== 'dynamiczone' || !Array.isArray(zone.components)) {
      throw new AppError('CONFIG_ERROR', 'In-place editing requires a collection type with Draft & Publish and an explicit dynamic-zone schema');
    }
    return schema;
  }

  async normalizeDynamicZoneForUpdate(blocks: unknown[], requireExistingIds = false, rejectComponentIds = false): Promise<unknown[]> {
    const schema = await this.inPlaceSchema();
    const allowed = ((schema.attributes as JsonObject)[this.project.blocksField] as JsonObject).components as string[];
    return Promise.all(blocks.map(async (value, index) => {
      const block = value as JsonObject;
      if (!block || typeof block !== 'object' || Array.isArray(block) || !allowed.includes(String(block.__component))) {
        throw new AppError('SCHEMA_VALIDATION_FAILED', `Unsupported component at ${this.project.blocksField}[${index}]`);
      }
      return this.updateComponent(String(block.__component), block, true, requireExistingIds, rejectComponentIds);
    }));
  }

  private async updateComponent(uid: string, value: JsonObject, discriminator: boolean, requireId: boolean, rejectIds = false): Promise<JsonObject> {
    await this.validateComponent(uid, value, uid);
    if (rejectIds && value.id !== undefined) throw new AppError('INVALID_REQUEST', `Inserted component cannot supply an ID: ${uid}`);
    if ((requireId || value.id !== undefined) && (!Number.isSafeInteger(value.id) || Number(value.id) < 1)) {
      throw new AppError('INCOMPLETE_CONTENT', `Missing or invalid component ID: ${uid}`);
    }
    const attributes = (await this.get(uid)).attributes as JsonObject;
    const output: JsonObject = discriminator ? { __component: uid } : {};
    if (value.id !== undefined) output.id = value.id;
    for (const [name, raw] of Object.entries(attributes)) {
      const definition = raw as JsonObject;
      const item = value[name];
      if (definition.private === true || item === undefined) {
        throw new AppError('INCOMPLETE_CONTENT', `Cannot preserve unreadable field: ${uid}.${name}`);
      }
      if (item === null) { output[name] = null; continue; }
      if (definition.type === 'component') {
        const nestedUid = String(definition.component);
        output[name] = definition.repeatable === true
          ? await Promise.all((item as JsonObject[]).map(child => this.updateComponent(nestedUid, child, false, requireId, rejectIds)))
          : await this.updateComponent(nestedUid, item as JsonObject, false, requireId, rejectIds);
      } else if (definition.type === 'dynamiczone') {
        const allowed = definition.components as string[];
        output[name] = await Promise.all((item as JsonObject[]).map(child => {
          if (!allowed?.includes(String(child.__component))) throw new AppError('SCHEMA_VALIDATION_FAILED', `Unsupported nested component: ${uid}.${name}`);
          return this.updateComponent(String(child.__component), child, true, requireId, rejectIds);
        }));
      } else {
        this.validateUpdateValue(definition, item, `${uid}.${name}`);
        output[name] = await this.normalizeAttribute(definition, item, `${uid}.${name}`);
      }
    }
    return output;
  }

  private validateUpdateValue(definition: JsonObject, value: unknown, path: string): void {
    const type = definition.type;
    const fail = () => { throw new AppError('SCHEMA_VALIDATION_FAILED', `Invalid or unsupported value at ${path} (${String(type)})`); };
    if (['string', 'text', 'richtext', 'email', 'uid', 'enumeration', 'date', 'time', 'datetime'].includes(String(type))) {
      if (typeof value !== 'string') fail();
      if (type === 'enumeration' && !(definition.enum as unknown[])?.includes(value)) fail();
      if (typeof definition.minLength === 'number' && (value as string).length < definition.minLength) fail();
      if (typeof definition.maxLength === 'number' && (value as string).length > definition.maxLength) fail();
    } else if (['integer', 'biginteger', 'float', 'decimal'].includes(String(type))) {
      if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isSafeInteger(value))) fail();
      if (typeof definition.min === 'number' && Number(value) < definition.min) fail();
      if (typeof definition.max === 'number' && Number(value) > definition.max) fail();
    } else if (type === 'boolean') { if (typeof value !== 'boolean') fail(); }
    else if (type === 'blocks') { if (!Array.isArray(value)) fail(); }
    else if (type === 'json') { /* Preserve JSON verbatim, including application IDs. */ }
    else if (type === 'media' || type === 'relation') {
      const reference = (item: unknown) => {
        const ref = item && typeof item === 'object'
          ? (type === 'media' ? (item as JsonObject).id : (item as JsonObject).documentId) : item;
        if (type === 'media' ? !Number.isSafeInteger(ref) || Number(ref) < 1 : typeof ref !== 'string' || !ref.length) fail();
      };
      if (Array.isArray(value)) value.forEach(reference); else reference(value);
    } else fail();
  }

  async assertComponentIds(expected: unknown[], fetched: unknown[]): Promise<void> {
    if (expected.length !== fetched.length) throw new AppError('VERIFICATION_FAILED', 'Component count changed');
    for (let index = 0; index < expected.length; index += 1) {
      const before = expected[index] as JsonObject;
      const after = fetched[index] as JsonObject;
      if (!after || before.__component !== after.__component) throw new AppError('VERIFICATION_FAILED', 'Component type/order changed');
      await this.assertNestedIdentity(String(before.__component), before, after);
    }
  }

  private async assertNestedIdentity(uid: string, expected: JsonObject, fetched: JsonObject): Promise<void> {
    if (!Number.isSafeInteger(fetched.id) || (expected.id !== undefined && expected.id !== fetched.id)) {
      throw new AppError('VERIFICATION_FAILED', `Component identity changed: ${uid}`);
    }
    const attributes = (await this.get(uid)).attributes as JsonObject;
    for (const [name, raw] of Object.entries(attributes)) {
      const definition = raw as JsonObject;
      if (!expected[name]) continue;
      if (definition.type === 'component') {
        const oldItems = definition.repeatable ? expected[name] as JsonObject[] : [expected[name] as JsonObject];
        const newItems = definition.repeatable ? fetched[name] as JsonObject[] : [fetched[name] as JsonObject];
        if (!Array.isArray(newItems) || oldItems.length !== newItems.length) throw new AppError('VERIFICATION_FAILED', `Nested component count changed: ${uid}.${name}`);
        for (let i = 0; i < oldItems.length; i += 1) {
          if (!newItems[i]) throw new AppError('VERIFICATION_FAILED', `Missing nested component: ${uid}.${name}`);
          await this.assertNestedIdentity(String(definition.component), oldItems[i], newItems[i]);
        }
      } else if (definition.type === 'dynamiczone') {
        await this.assertComponentIds(expected[name] as unknown[], (fetched[name] ?? []) as unknown[]);
      }
    }
  }

  async assertReferencesPreserved(before: unknown[], after: unknown[]): Promise<void> {
    const originals = new Map((before as JsonObject[]).map(block => [`${block.__component}:${block.id}`, block]));
    for (const block of after as JsonObject[]) {
      const original = originals.get(`${block.__component}:${block.id}`);
      if (original) await this.checkReferences(String(block.__component), original, block);
    }
  }

  private async checkReferences(uid: string, before: JsonObject, after: JsonObject): Promise<void> {
    for (const [name, raw] of Object.entries((await this.get(uid)).attributes as JsonObject)) {
      const definition = raw as JsonObject;
      if (definition.type === 'media' || definition.type === 'relation') {
        if (before[name] !== undefined && before[name] !== null && contentHash(before[name]) !== contentHash(after[name])) {
          throw new AppError('CONTENT_REMOVAL_BLOCKED', `Existing media/relation is read-only: ${uid}.${name}`);
        }
      } else if (definition.type === 'component' && before[name]) {
        if (definition.repeatable) {
          for (let i = 0; i < (before[name] as unknown[]).length; i += 1) {
            await this.checkReferences(String(definition.component), (before[name] as JsonObject[])[i], (after[name] as JsonObject[])[i]);
          }
        } else await this.checkReferences(String(definition.component), before[name] as JsonObject, after[name] as JsonObject);
      } else if (definition.type === 'dynamiczone' && before[name]) {
        await this.assertReferencesPreserved(before[name] as unknown[], after[name] as unknown[]);
      }
    }
  }

  private requireRoot(): string {
    if (!this.project.schemaRoot) throw new AppError('CONFIG_ERROR', 'schemaRoot is not configured for this project');
    return resolve(this.project.schemaRoot, 'src/components');
  }

  async list(): Promise<JsonObject[]> {
    if (this.project.componentSchemas) {
      return Object.entries(this.project.componentSchemas).map(([uid, schema]) => {
        const info = schema.info as JsonObject | undefined;
        return { uid, displayName: info?.displayName ?? uid, description: info?.description };
      }).sort((a, b) => String(a.uid).localeCompare(String(b.uid)));
    }
    const root = this.requireRoot();
    const categories = await readdir(root, { withFileTypes: true });
    const result: JsonObject[] = [];
    for (const category of categories.filter((entry) => entry.isDirectory())) {
      const files = await readdir(resolve(root, category.name), { withFileTypes: true });
      for (const file of files.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))) {
        const uid = `${category.name}.${file.name.slice(0, -5)}`;
        const schema = await this.get(uid);
        const info = schema.info as JsonObject | undefined;
        result.push({ uid, displayName: info?.displayName ?? uid, description: info?.description });
      }
    }
    return result.sort((a, b) => String(a.uid).localeCompare(String(b.uid)));
  }

  async get(uid: string): Promise<JsonObject> {
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(uid)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Invalid component UID: ${uid}`);
    const embedded = this.project.componentSchemas?.[uid];
    if (embedded) return { uid, ...structuredClone(embedded) };
    const [category, name] = uid.split('.');
    const path = resolve(this.requireRoot(), category, `${name}.json`);
    try {
      const schema = JSON.parse(await readFile(path, 'utf8')) as JsonObject;
      return { uid, ...schema };
    } catch (error) {
      throw new AppError('SCHEMA_VALIDATION_FAILED', `Component schema not found: ${uid}`, { cause: error instanceof Error ? error.message : String(error) });
    }
  }

  async validateBlocks(blocks: unknown[]): Promise<void> {
    if (!this.project.schemaRoot && !this.project.componentSchemas) return;
    for (const [index, value] of blocks.entries()) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Invalid component at index ${index}`);
      const block = value as JsonObject;
      const uid = block.__component;
      if (typeof uid !== 'string') throw new AppError('SCHEMA_VALIDATION_FAILED', `Missing __component at index ${index}`);
      await this.validateComponent(uid, block, `${this.project.blocksField}[${index}]`);
    }
  }

  async normalizeDocumentForWrite(value: JsonObject): Promise<JsonObject> {
    if (!this.project.contentTypeSchema && (!this.project.schemaRoot || !this.project.contentType)) return normalizeForCreate(value) as JsonObject;
    const schema = this.project.contentTypeSchema ?? JSON.parse(await readFile(resolve(
      this.project.schemaRoot as string,
      'src/api', this.project.contentType as string, 'content-types', this.project.contentType as string, 'schema.json',
    ), 'utf8')) as JsonObject;
    return this.normalizeObject(value, schema.attributes as JsonObject, this.project.contentType ?? 'document');
  }

  async validateTopLevelStringField(field: string): Promise<void> {
    let schema = this.project.contentTypeSchema;
    if (!schema && this.project.schemaRoot && this.project.contentType) {
      schema = JSON.parse(await readFile(resolve(
        this.project.schemaRoot, 'src/api', this.project.contentType, 'content-types', this.project.contentType, 'schema.json',
      ), 'utf8')) as JsonObject;
    }
    if (!schema) throw new AppError('CONFIG_ERROR', `Cannot validate routeField without a content-type schema: ${field}`);
    const definition = (schema.attributes as JsonObject | undefined)?.[field] as JsonObject | undefined;
    if (!definition) throw new AppError('CONFIG_ERROR', `Configured routeField does not exist in the content-type schema: ${field}`);
    if (!['string', 'text', 'uid'].includes(String(definition.type))) {
      throw new AppError('CONFIG_ERROR', `Configured routeField must be a string, text, or uid field: ${field}`);
    }
  }

  async normalizeDynamicZoneForWrite(blocks: unknown[]): Promise<unknown[]> {
    if (!this.project.schemaRoot && !this.project.componentSchemas) return normalizeForCreate(blocks, false) as unknown[];
    const output: unknown[] = [];
    for (const [index, item] of blocks.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof (item as JsonObject).__component !== 'string') {
        throw new AppError('SCHEMA_VALIDATION_FAILED', `Invalid dynamic-zone item at index ${index}`);
      }
      output.push(await this.normalizeComponent(String((item as JsonObject).__component), item as JsonObject, true));
    }
    return output;
  }

  private async normalizeObject(value: JsonObject, attributes: JsonObject, path: string): Promise<JsonObject> {
    const result: JsonObject = {};
    for (const [name, definition] of Object.entries(attributes)) {
      if (value[name] === undefined) continue;
      result[name] = await this.normalizeAttribute(definition as JsonObject, value[name], `${path}.${name}`);
    }
    return result;
  }

  private async normalizeComponent(uid: string, value: JsonObject, includeDiscriminator: boolean): Promise<JsonObject> {
    const schema = await this.get(uid);
    const attributes = schema.attributes as JsonObject;
    const result = await this.normalizeObject(value, attributes, uid);
    return includeDiscriminator ? { __component: uid, ...result } : result;
  }

  private async normalizeAttribute(definition: JsonObject, value: unknown, path: string): Promise<unknown> {
    if (value === null) return null;
    if (definition.type === 'component') {
      const uid = String(definition.component);
      if (definition.repeatable === true) {
        if (!Array.isArray(value)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Expected array at ${path}`);
        return Promise.all(value.map((item) => this.normalizeComponent(uid, item as JsonObject, false)));
      }
      return this.normalizeComponent(uid, value as JsonObject, false);
    }
    if (definition.type === 'dynamiczone') {
      if (!Array.isArray(value)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Expected array at ${path}`);
      return this.normalizeDynamicZoneForWrite(value);
    }
    if (definition.type === 'media') {
      const reference = (item: unknown): unknown => {
        if (!item || typeof item !== 'object') return item;
        return (item as JsonObject).id ?? (item as JsonObject).documentId;
      };
      return Array.isArray(value) ? value.map(reference) : reference(value);
    }
    if (definition.type === 'relation') {
      const reference = (item: unknown): unknown => {
        if (!item || typeof item !== 'object') return item;
        return (item as JsonObject).documentId ?? (item as JsonObject).id;
      };
      return Array.isArray(value) ? value.map(reference) : reference(value);
    }
    if (definition.type === 'json' || definition.type === 'blocks') return structuredClone(value);
    if (Array.isArray(value)) return value.map((item) => normalizeForCreate(item, false));
    if (value && typeof value === 'object') {
      const result: JsonObject = {};
      for (const [key, nested] of Object.entries(value as JsonObject)) {
        if (!systemKeys.has(key) && key !== '__component') result[key] = normalizeForCreate(nested, false);
      }
      return result;
    }
    return value;
  }

  private async validateComponent(uid: string, value: JsonObject, path: string): Promise<void> {
    const schema = await this.get(uid);
    const attributes = schema.attributes as JsonObject | undefined;
    if (!attributes) throw new AppError('SCHEMA_VALIDATION_FAILED', `Component schema has no attributes: ${uid}`);

    for (const key of Object.keys(value)) {
      if (key === 'id' || key === '__component') continue;
      if (!(key in attributes)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Unknown field ${path}.${key}`, { uid, field: key });
    }

    for (const [name, rawDefinition] of Object.entries(attributes)) {
      const definition = rawDefinition as JsonObject;
      const nested = value[name];
      if (definition.required === true && (nested === undefined || nested === null || nested === '')) {
        throw new AppError('SCHEMA_VALIDATION_FAILED', `Required field missing: ${path}.${name}`);
      }
      if (nested === undefined || nested === null) continue;

      if (definition.type === 'component') {
        const nestedUid = String(definition.component ?? '');
        if (definition.repeatable === true) {
          if (!Array.isArray(nested)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Expected repeatable component array: ${path}.${name}`);
          for (const [index, item] of nested.entries()) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Invalid nested component: ${path}.${name}[${index}]`);
            await this.validateComponent(nestedUid, item as JsonObject, `${path}.${name}[${index}]`);
          }
        } else {
          if (!nested || typeof nested !== 'object' || Array.isArray(nested)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Invalid nested component: ${path}.${name}`);
          await this.validateComponent(nestedUid, nested as JsonObject, `${path}.${name}`);
        }
      }

      if (definition.type === 'dynamiczone') {
        if (!Array.isArray(nested)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Expected dynamic zone array: ${path}.${name}`);
        for (const [index, item] of nested.entries()) {
          if (!item || typeof item !== 'object' || Array.isArray(item) || typeof (item as JsonObject).__component !== 'string') {
            throw new AppError('SCHEMA_VALIDATION_FAILED', `Invalid dynamic-zone item: ${path}.${name}[${index}]`);
          }
          await this.validateComponent(String((item as JsonObject).__component), item as JsonObject, `${path}.${name}[${index}]`);
        }
      }
    }
  }
}
