import { createHash } from 'node:crypto';
import type { JsonObject, ProjectConfig } from './types.js';
import { AppError } from './errors.js';

type RuntimeProject = ProjectConfig & { token: string };

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function idempotentSlug(sourceSlug: string, key: string): string {
  const suffix = createHash('sha256').update(key).digest('hex').slice(0, 10);
  return `${sourceSlug.replace(/-ai-[a-f0-9]{10}$/i, '')}-ai-${suffix}`;
}

export class StrapiClient {
  constructor(private readonly project: RuntimeProject) {}

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.project.baseUrl}${path}`, {
      ...init,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${this.project.token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json().catch(() => null) as JsonObject | null;
    if (!response.ok) {
      throw new AppError('STRAPI_ERROR', `Strapi request failed with status ${response.status}`, { status: response.status }, 502);
    }
    return body;
  }

  private query(locale?: string): string {
    const params = new URLSearchParams();
    params.set('status', 'draft');
    if (this.project.populate?.startsWith('populate%5B') || this.project.populate?.startsWith('populate[')) {
      for (const [key, value] of new URLSearchParams(this.project.populate)) params.set(key, value);
    } else params.set('populate', this.project.populate ?? '*');
    params.set('locale', locale ?? this.project.defaultLocale ?? 'en');
    return params.toString();
  }

  async get(documentId: string, locale?: string): Promise<JsonObject> {
    const body = await this.request(`/api/${this.project.collection}/${encodeURIComponent(documentId)}?${this.query(locale)}`) as JsonObject;
    if (!body.data || typeof body.data !== 'object') throw new AppError('SOURCE_NOT_FOUND', `Page not found: ${documentId}`, { documentId }, 404);
    return body.data as JsonObject;
  }

  async findBySlug(slug: string, locale?: string): Promise<JsonObject | null> {
    const params = new URLSearchParams(this.query(locale));
    params.set(`filters[${this.project.slugField}][$eq]`, slug);
    params.set('pagination[pageSize]', '1');
    const body = await this.request(`/api/${this.project.collection}?${params}`) as JsonObject;
    const data = body.data;
    return Array.isArray(data) && data[0] && typeof data[0] === 'object' ? data[0] as JsonObject : null;
  }

  async list(search?: string, locale?: string, pageSize = 20): Promise<JsonObject[]> {
    const params = new URLSearchParams(this.query(locale));
    for (const key of [...params.keys()]) if (key === 'populate' || key.startsWith('populate[')) params.delete(key);
    params.set('fields[0]', this.project.slugField);
    if (this.project.titleField) params.set('fields[1]', this.project.titleField);
    params.set('pagination[pageSize]', String(Math.min(Math.max(pageSize, 1), 100)));
    if (search) {
      params.set(`filters[$or][0][${this.project.slugField}][$containsi]`, search);
      if (this.project.titleField) params.set(`filters[$or][1][${this.project.titleField}][$containsi]`, search);
    }
    const body = await this.request(`/api/${this.project.collection}?${params}`) as JsonObject;
    return Array.isArray(body.data) ? body.data as JsonObject[] : [];
  }

  async create(data: JsonObject, locale?: string): Promise<JsonObject> {
    const params = new URLSearchParams();
    params.set('status', 'draft');
    params.set('locale', locale ?? this.project.defaultLocale ?? 'en');
    const body = await this.request(`/api/${this.project.collection}?${params}`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    }) as JsonObject;
    if (!body.data || typeof body.data !== 'object') throw new AppError('STRAPI_ERROR', 'Strapi create returned no document', undefined, 502);
    return body.data as JsonObject;
  }

  async update(documentId: string, data: JsonObject, locale?: string): Promise<JsonObject> {
    const params = new URLSearchParams();
    params.set('status', 'draft');
    params.set('locale', locale ?? this.project.defaultLocale ?? 'en');
    const body = await this.request(`/api/${this.project.collection}/${encodeURIComponent(documentId)}?${params}`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    }) as JsonObject;
    if (!body.data || typeof body.data !== 'object') throw new AppError('STRAPI_ERROR', 'Strapi update returned no document', undefined, 502);
    return body.data as JsonObject;
  }
}
