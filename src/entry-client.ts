import type { JsonObject, ProjectConfig } from './types.js';
import type { ContentType, ContentRegistry } from './content-types.js';
import { population } from './content-types.js';
import { requestStrapi } from './api-request.js';
import { AppError } from './errors.js';

export class EntryClient {
  constructor(readonly project: ProjectConfig & { token: string }, readonly type: ContentType, readonly registry: ContentRegistry) {}

  query(locale: string, status: 'draft' | 'published' = 'draft', populate = true): URLSearchParams {
    const params = populate ? population(this.type.schema, this.registry.components) : new URLSearchParams();
    if (this.type.draftAndPublish) params.set('status', status);
    if (this.type.localized) { params.set('locale', locale); if (populate) params.set('populate[localizations]', 'true'); }
    return params;
  }

  path(documentId?: string): string {
    if (this.type.kind === 'singleType') {
      if (documentId) throw new AppError('INVALID_REQUEST', 'Single types use their singular endpoint without a documentId');
      return this.type.endpoint;
    }
    if (documentId && !/^[a-zA-Z0-9_-]+$/.test(documentId)) throw new AppError('INVALID_REQUEST', 'Invalid Strapi documentId');
    return this.type.endpoint + (documentId ? `/${encodeURIComponent(documentId)}` : '');
  }

  async get(documentId: string | undefined, locale: string, status: 'draft' | 'published' = 'draft'): Promise<JsonObject | null> {
    if (this.type.kind === 'collectionType' && !documentId) throw new AppError('INVALID_REQUEST', 'documentId is required for collection entries');
    try {
      const body = await requestStrapi(this.project, `${this.path(documentId)}?${this.query(locale, status)}`) as JsonObject;
      if (body.data === null) return null;
      if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new AppError('STRAPI_ERROR', 'Strapi returned an invalid entry response', undefined, 502);
      return body.data as JsonObject;
    } catch (error) {
      if (error instanceof AppError && (error.details as JsonObject | undefined)?.status === 404) return null;
      throw error;
    }
  }

  async list(locale: string, page = 1, pageSize = 20, filters: JsonObject = {}, status: 'draft' | 'published' = 'draft'): Promise<JsonObject> {
    if (this.type.kind === 'singleType') return { data: await this.get(undefined, locale, status), meta: {} };
    const params = this.query(locale, status, false);
    params.set('pagination[page]', String(page)); params.set('pagination[pageSize]', String(pageSize));
    const attributes = this.type.schema.attributes as JsonObject;
    const filter = (key: string, value: unknown, depth: number) => {
      if (depth > 5) throw new AppError('INVALID_REQUEST', 'Filter nesting is too deep');
      if (Array.isArray(value)) { value.forEach((v, i) => filter(`${key}[${i}]`, v, depth + 1)); return; }
      if (value && typeof value === 'object') {
        for (const [name, child] of Object.entries(value as JsonObject)) {
          if (!/^(?:\$(?:eq|eqi|ne|nei|lt|lte|gt|gte|in|notIn|contains|notContains|containsi|notContainsi|startsWith|endsWith|null|notNull|and|or|not)|[a-zA-Z][a-zA-Z0-9_]*)$/.test(name)) throw new AppError('INVALID_REQUEST', `Invalid filter: ${name}`);
          if (!name.startsWith('$') && name !== 'documentId' && !Object.hasOwn(attributes, name)) throw new AppError('INVALID_REQUEST', `Unknown filter field: ${name}`);
          if ((attributes[name] as JsonObject | undefined)?.private === true || (attributes[name] as JsonObject | undefined)?.type === 'password') throw new AppError('INVALID_REQUEST', 'Private fields cannot be filtered');
          filter(`${key}[${name}]`, child, depth + 1);
        }
      } else { if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) throw new AppError('INVALID_REQUEST', 'Invalid filter value'); params.set(key, String(value)); }
    };
    filter('filters', filters, 0);
    return await requestStrapi(this.project, `${this.type.endpoint}?${params}`) as JsonObject;
  }

  async write(action: 'create' | 'update' | 'localize', data: JsonObject, documentId: string | undefined, locale: string): Promise<JsonObject> {
    const params = this.query(locale, 'draft', false);
    const createsCollection = action === 'create' && this.type.kind === 'collectionType';
    const body = await requestStrapi(this.project, `${this.path(createsCollection ? undefined : documentId)}?${params}`, {
      method: createsCollection ? 'POST' : 'PUT', body: JSON.stringify({ data }),
    }) as JsonObject;
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new AppError('STRAPI_ERROR', 'Strapi write returned no document', undefined, 502);
    return body.data as JsonObject;
  }
}
