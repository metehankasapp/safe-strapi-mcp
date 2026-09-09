import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { JsonObject, ProjectConfig } from './types.js';
import { AppError } from './errors.js';
import { normalizeForCreate } from './operations.js';

const systemKeys = new Set(['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'localizations', 'locale']);

export class SchemaCatalog {
  constructor(private readonly project: ProjectConfig) {}

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
    if (definition.type === 'json') return structuredClone(value);
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
