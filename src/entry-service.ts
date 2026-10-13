import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AppConfig, JsonObject } from './types.js';
import type { AuditRepository } from './audit.js';
import { resolveProject } from './config.js';
import { currentTenant, requireProject } from './auth.js';
import { describeContentType, registryFor, type ContentType, type ContentRegistry } from './content-types.js';
import { EntryClient } from './entry-client.js';
import { EntrySchema, localizedField, manyRelation } from './entry-schema.js';
import { contentHash } from './strapi-client.js';
import { requestStrapi } from './api-request.js';
import { AppError } from './errors.js';

export interface EntryWriteInput {
  project: string; uid: string; inspectionId: string; action: 'create' | 'update' | 'localize';
  documentId?: string; locale?: string; sourceLocale?: string; data: JsonObject; allowImmediateWrite?: boolean;
}

interface EntryPlan extends EntryWriteInput {
  locale: string; data: JsonObject; schemaHash: string; binding: string;
  before: Record<string, { draft: JsonObject | null; published: JsonObject | null }>;
}

export class EntryService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly config: AppConfig, private readonly audit: AuditRepository,
    private readonly resolver: typeof resolveProject = resolveProject) {}

  private key(value: string): string { return `${currentTenant()}:entries:${value}`; }
  private async lock<T>(callback: () => Promise<T>): Promise<T> {
    if (!this.audit.withLock) throw new AppError('CONFIG_ERROR', 'Entry writes require an audit store with durable write locking');
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await this.audit.withLock('writes', callback); }
    finally { release(); }
  }

  private async context(projectName: string, uid: string) {
    requireProject(projectName);
    const project = this.resolver(this.config, projectName);
    const registry = await registryFor(project);
    const raw = registry.types[uid];
    if (!raw) throw new AppError('CONFIG_ERROR', `Unknown content type: ${uid}. Call list_content_types first.`);
    const type = describeContentType(uid, raw);
    const schema = new EntrySchema(type, registry);
    const schemaHash = contentHash({ uid, schema: raw, components: registry.components, relatedTypes: registry.types, customFieldTypes: registry.customFieldTypes ?? {} });
    const binding = contentHash({ project: projectName, baseUrl: project.baseUrl, tokenHash: contentHash(project.token), uid, endpoint: type.endpoint });
    return { project, registry, type, schema, schemaHash, binding, client: new EntryClient(project, type, registry) };
  }

  async listContentTypes(projectName: string): Promise<JsonObject[]> {
    requireProject(projectName);
    const registry = await registryFor(this.resolver(this.config, projectName));
    return Object.entries(registry.types).map(([uid, raw]) => {
      const type = describeContentType(uid, raw);
      return { uid, kind: type.kind, displayName: (raw.info as JsonObject).displayName, endpoint: type.endpoint,
        localized: type.localized, draftAndPublish: type.draftAndPublish };
    }).sort((a, b) => a.uid.localeCompare(b.uid));
  }

  private locale(type: ContentType, projectLocale: string | undefined, locale?: string): string {
    if (locale && !type.localized) throw new AppError('INVALID_REQUEST', 'This content type is not localized; omit locale');
    const value = type.localized ? locale ?? projectLocale ?? 'en' : '';
    if (value && !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(value)) throw new AppError('INVALID_REQUEST', 'Invalid locale code');
    return value;
  }

  private exposeSchema(schema: JsonObject): JsonObject {
    const result = structuredClone(schema);
    for (const [name, raw] of Object.entries(result.attributes as JsonObject)) {
      const field = raw as JsonObject;
      if (field.private === true || field.type === 'password') (result.attributes as JsonObject)[name] = { type: field.type, private: true, required: field.required === true, writable: false };
    }
    return result;
  }

  async inspectContentType(projectName: string, uid: string, locale?: string, sampleSize = 2): Promise<JsonObject> {
    const ctx = await this.context(projectName, uid);
    const resolvedLocale = this.locale(ctx.type, ctx.project.defaultLocale, locale);
    const sample = await ctx.client.list(resolvedLocale, 1, Math.max(1, sampleSize));
    const components: Record<string, JsonObject> = {};
    const visit = (attributes: JsonObject) => {
      for (const raw of Object.values(attributes)) {
        const field = raw as JsonObject;
        const uids = field.type === 'component' ? [String(field.component)] : field.type === 'dynamiczone' ? field.components as string[] : [];
        for (const id of uids) {
          if (components[id]) continue;
          const component = ctx.registry.components[id];
          if (!component) throw new AppError('CONFIG_ERROR', `Missing component schema: ${id}`);
          components[id] = this.exposeSchema(component); visit(component.attributes as JsonObject);
        }
      }
    };
    visit(ctx.type.schema.attributes as JsonObject);
    const sampleRows = sampleSize === 0 ? [] : Array.isArray(sample.data) ? sample.data.slice(0, sampleSize) : sample.data ? [sample.data] : [];
    const brief = (value: unknown, depth = 0): unknown => typeof value === 'string' ? value.slice(0, 500) :
      Array.isArray(value) ? value.slice(0, 2).map(x => brief(x, depth + 1)) : value && typeof value === 'object' ?
        depth > 4 ? '[nested object]' : Object.fromEntries(Object.entries(value as JsonObject).map(([key, child]) => [key, brief(child, depth + 1)])) : value;
    const inspectionId = randomUUID();
    const result = {
      inspectionId, schemaHash: ctx.schemaHash, uid, kind: ctx.type.kind,
      schema: this.exposeSchema(ctx.type.schema), components,
      customFieldTypes: ctx.registry.customFieldTypes ?? {},
      source: ctx.project.schemaRoot ? {
        apiDirectory: resolve(ctx.project.schemaRoot, 'src/api', uid.slice(5).split('.')[0]),
        schemaFile: resolve(ctx.project.schemaRoot, 'src/api', uid.slice(5).split('.')[0], 'content-types', uid.split('.')[1], 'schema.json'),
        research: 'Read routes, controllers, services and lifecycle hooks here before using the standard REST contract; verify any custom behavior separately.',
      } : { research: 'Obtain and verify custom route/controller/plugin contracts from the project owner; embedded schemas describe the standard Content API only.' },
      api: { origin: ctx.project.baseUrl, endpoint: ctx.type.endpoint,
        read: ctx.type.kind === 'singleType' ? 'GET singular endpoint' : 'GET collection or /:documentId',
        create: ctx.type.kind === 'singleType' ? 'PUT singular endpoint' : 'POST collection',
        update: ctx.type.kind === 'singleType' ? 'PUT singular endpoint' : 'PUT /:documentId',
        localization: ctx.type.localized ? 'PUT the SAME documentId with locale; never POST a translation' : null,
        body: '{ "data": { schema fields } }', status: ctx.type.draftAndPublish ? 'Always pass status=draft; never omit it on writes' : 'No draft state: writes are immediately visible and need allowImmediateWrite=true',
        readPermissionVerified: true, writePermissionVerified: false,
        requiredPermissions: ['find', 'findOne', 'create for new entries', 'update for existing entries and locales', 'read populated relations/media', 'upload for new media'],
        documentation: ['https://docs.strapi.io/cms/api/rest', 'https://docs.strapi.io/cms/api/rest/locale', 'https://docs.strapi.io/cms/api/rest/status', 'https://docs.strapi.io/cms/api/rest/relations', 'https://docs.strapi.io/cms/api/rest/upload'] },
      routing: { rule: 'Read the frontend route and language selector before choosing slugs. Locale prefixes commonly share one slug. Localization defaults to copying the source slug.',
        localeSlugPolicy: ctx.project.localeSlugPolicy ?? 'shared',
        slugField: ctx.project.slugField || ((ctx.type.schema.attributes as JsonObject).slug ? 'slug' : null), routeField: ctx.project.routeField ?? null },
      allowEntryEditing: ctx.project.allowEntryEditing === true,
      samples: sampleRows.map(row => brief(ctx.schema.snapshot(row as JsonObject))),
      workflow: ['Inspect this schema, nested components and sample/API contract', 'Research source routes/controllers/services/hooks and frontend routing; verify custom behavior', 'Find referenced media and related documents; do not invent IDs', 'Inspect an existing entry before editing', 'preview_entry_write', 'Review exact fields, shared-locale effects and publication state', 'apply_entry_write with persisted preview and idempotency key', 'Re-fetch and verify; never fall back to browser or direct shell writes'],
    };
    const key = this.key(`inspection:${inspectionId}`);
    await this.audit.begin({ key, project: this.key(projectName), sourceDocumentId: uid, cloneSlug: '', requestHash: ctx.schemaHash, intendedHash: ctx.schemaHash,
      request: { action: 'inspect-content-type', project: projectName, uid, binding: ctx.binding } });
    await this.audit.complete(key, { inspectionId, schemaHash: ctx.schemaHash, binding: ctx.binding });
    return result;
  }

  async findEntries(projectName: string, uid: string, locale?: string, page = 1, pageSize = 20, filters: JsonObject = {}, status: 'draft' | 'published' = 'draft'): Promise<JsonObject> {
    const ctx = await this.context(projectName, uid);
    const result = await ctx.client.list(this.locale(ctx.type, ctx.project.defaultLocale, locale), page, pageSize, filters, status);
    const expose = (row: JsonObject) => ({ documentId: row.documentId, locale: row.locale, publishedAt: row.publishedAt, ...ctx.schema.snapshot(row) });
    return { ...result, data: Array.isArray(result.data) ? (result.data as JsonObject[]).map(expose) : result.data ? expose(result.data as JsonObject) : null };
  }

  private state(schema: EntrySchema, entry: JsonObject | null): JsonObject | null {
    return entry ? { documentId: entry.documentId,
      ...(entry.locale !== undefined ? { locale: entry.locale } : {}),
      ...(entry.publishedAt !== undefined ? { publishedAt: entry.publishedAt } : {}), data: schema.snapshot(entry) } : null;
  }

  async getEntry(projectName: string, uid: string, documentId?: string, locale?: string, status: 'draft' | 'published' = 'draft'): Promise<JsonObject> {
    const ctx = await this.context(projectName, uid);
    const entry = await ctx.client.get(documentId, this.locale(ctx.type, ctx.project.defaultLocale, locale), status);
    if (!entry) throw new AppError('SOURCE_NOT_FOUND', 'Entry not found', undefined, 404);
    return { entry: this.state(ctx.schema, entry), entryHash: contentHash(this.state(ctx.schema, entry)), schemaHash: ctx.schemaHash,
      availableLocales: ctx.type.localized ? [entry.locale, ...((entry.localizations ?? []) as JsonObject[]).map(x => x.locale)] : [] };
  }

  private async validateReferences(data: JsonObject, attributes: JsonObject, registry: ContentRegistry, ctx: Awaited<ReturnType<EntryService['context']>>, locale: string): Promise<void> {
    for (const [name, value] of Object.entries(data)) {
      if (name === 'id' || name === '__component' || value === null) continue;
      const field = attributes[name] as JsonObject;
      if (field.type === 'component' || field.type === 'dynamiczone') {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items as JsonObject[]) {
          const uid = field.type === 'dynamiczone' ? String(item.__component) : String(field.component);
          await this.validateReferences(item, registry.components[uid].attributes as JsonObject, registry, ctx, locale);
        }
      } else if (field.type === 'media') {
        for (const id of (Array.isArray(value) ? value : [value])) {
          const file = await requestStrapi(ctx.project, `/api/upload/files/${id}`) as JsonObject;
          const category = String(file.mime).startsWith('image/') ? 'images' : String(file.mime).startsWith('video/') ? 'videos' : String(file.mime).startsWith('audio/') ? 'audios' : 'files';
          if (Array.isArray(field.allowedTypes) && !field.allowedTypes.includes(category)) throw new AppError('SCHEMA_VALIDATION_FAILED', `Media type not allowed: ${name} (${category})`);
        }
      } else if (field.type === 'relation') {
        const uid = String(field.target);
        if (!registry.types[uid]) throw new AppError('CONFIG_ERROR', `Relation target schema required: ${uid}`);
        const target = describeContentType(uid, registry.types[uid]);
        if (target.kind !== 'collectionType') throw new AppError('CONFIG_ERROR', 'Relations to single types are unsupported by Strapi');
        for (const id of (manyRelation(field) ? value as unknown[] : [value])) {
          if (!await new EntryClient(ctx.project, target, registry).get(String(id), target.localized ? locale : '')) throw new AppError('SCHEMA_VALIDATION_FAILED', `Referenced document not found: ${uid}/${id}`);
        }
      }
    }
  }

  async previewEntryWrite(input: EntryWriteInput): Promise<JsonObject> {
    if (Buffer.byteLength(JSON.stringify(input.data)) > 1_048_576) throw new AppError('REQUEST_TOO_LARGE', 'Entry payload exceeds 1 MiB');
    const ctx = await this.context(input.project, input.uid);
    const inspection = await this.audit.get(this.key(`inspection:${input.inspectionId}`));
    if (inspection?.status !== 'completed' || inspection.result?.schemaHash !== ctx.schemaHash || inspection.result?.binding !== ctx.binding) throw new AppError('PREVIEW_REQUIRED', 'Inspect this content type and API contract with inspect_content_type first; the schema/target may have changed');
    if (!ctx.type.draftAndPublish && input.allowImmediateWrite !== true) throw new AppError('INVALID_REQUEST', 'This type has no draft state. Explicit allowImmediateWrite=true is required and the preview must disclose immediate visibility');
    if (input.action === 'update' && ctx.project.allowEntryEditing !== true) throw new AppError('IN_PLACE_DISABLED', 'Enable allowEntryEditing or --allow-entry-editing explicitly for existing-entry updates');
    const locale = this.locale(ctx.type, ctx.project.defaultLocale, input.locale);
    let current: JsonObject | null = null;
    if (input.action !== 'create' || ctx.type.kind === 'singleType') current = await ctx.client.get(input.documentId, locale);
    if (input.action === 'create' && (input.documentId || current)) throw new AppError('INVALID_REQUEST', 'Create requires a new entry; use update for an existing single type');
    if (input.action === 'update' && !current) throw new AppError('SOURCE_NOT_FOUND', 'Target locale/entry does not exist; use explicit localize for a new translation');
    let data = structuredClone(input.data);
    let source: JsonObject | null = null;
    let sourceLocale: string | undefined;
    if (input.action === 'localize') {
      if (!ctx.type.localized || current) throw new AppError('INVALID_REQUEST', 'Localize requires a localized type and an absent target locale');
      sourceLocale = input.sourceLocale ?? ctx.project.defaultLocale ?? 'en';
      if (sourceLocale === locale) throw new AppError('INVALID_REQUEST', 'Source and target locale must differ');
      source = await ctx.client.get(input.documentId, sourceLocale);
      if (!source) throw new AppError('SOURCE_NOT_FOUND', 'Source locale not found');
      const inherited = ctx.schema.snapshot(source); delete inherited.id;
      const attributes = ctx.type.schema.attributes as JsonObject;
      const slugField = Object.hasOwn(attributes, 'slug') ? 'slug' : ctx.project.slugField;
      if (slugField && (ctx.project.localeSlugPolicy ?? 'shared') === 'shared' && data[slugField] !== undefined && data[slugField] !== inherited[slugField]) throw new AppError('INVALID_REQUEST', 'Translations share the source slug; do not append locale suffixes. Set localeSlugPolicy=localized only when the frontend resolves translated slugs');
      if (slugField && data[slugField] === undefined && inherited[slugField] !== undefined) data[slugField] = inherited[slugField];
      for (const [name, field] of Object.entries(attributes)) {
        if (!localizedField(field as JsonObject)) {
          if (data[name] !== undefined && contentHash(data[name]) !== contentHash(inherited[name])) throw new AppError('INVALID_REQUEST', `Localization cannot change shared field ${name}; preview a separate update first`);
          delete data[name];
        }
      }
      const shared = Object.fromEntries(Object.entries(inherited).filter(([name]) => !localizedField(attributes[name] as JsonObject)));
      const normalized = await ctx.schema.normalize({ ...shared, ...data });
      data = Object.fromEntries(Object.entries(normalized).filter(([name]) => localizedField(attributes[name] as JsonObject)));
    } else data = await ctx.schema.normalize(data, current ?? undefined);
    if (Object.keys(data).length === 0) throw new AppError('INVALID_REQUEST', 'No writable fields provided');
    await this.validateReferences(data, ctx.type.schema.attributes as JsonObject, ctx.registry, ctx, locale);
    const attributes = ctx.type.schema.attributes as JsonObject;
    for (const [name, value] of Object.entries(data)) {
      const field = attributes[name] as JsonObject;
      if ((field.type === 'uid' || field.unique === true) && value !== null) {
        const found = await ctx.client.list(locale, 1, 2, { [name]: { $eq: value } });
        if ((found.data as JsonObject[]).some(row => row.documentId !== input.documentId)) throw new AppError('INVALID_REQUEST', `Unique field already used: ${name}`);
      }
    }
    const affectedLocales = new Set<string>([locale]);
    for (const entry of [current, source]) if (entry && ctx.type.localized) {
      affectedLocales.add(String(entry.locale));
      for (const localized of (entry.localizations ?? []) as JsonObject[]) affectedLocales.add(String(localized.locale));
    }
    const before: EntryPlan['before'] = {};
    for (const affected of affectedLocales) {
      const targetId = input.action === 'create' && ctx.type.kind === 'collectionType' ? null : input.documentId;
      const draft = targetId === null ? null : await ctx.client.get(targetId, affected);
      const published = targetId === null || !ctx.type.draftAndPublish ? null : await ctx.client.get(targetId, affected, 'published');
      before[affected] = { draft: this.state(ctx.schema, draft), published: this.state(ctx.schema, published) };
    }
    // Hash the same JSON representation that survives persistence/restarts.
    const plan: EntryPlan = JSON.parse(JSON.stringify({ ...input, sourceLocale, locale, data, schemaHash: ctx.schemaHash, binding: ctx.binding, before }));
    const operationHash = contentHash(plan);
    const previewId = randomUUID();
    const changes = Object.keys(data).map(name => ({ path: name, before: (before[locale]?.draft?.data as JsonObject | undefined)?.[name] ?? null,
      after: data[name], beforeExists: Object.hasOwn((before[locale]?.draft?.data as JsonObject | undefined) ?? {}, name), afterExists: true }));
    const result = { contractVersion: '2', kind: 'preview', action: input.action, previewId,
      target: { project: input.project, uid: input.uid, documentId: input.documentId ?? null, locale: locale || null, status: ctx.type.draftAndPublish ? 'draft' : 'immediate' },
      api: { method: input.action === 'create' && ctx.type.kind === 'collectionType' ? 'POST' : 'PUT', path: `${ctx.client.path(input.documentId)}?${ctx.client.query(locale, 'draft', false)}`, body: { data } },
      fieldChanges: changes, affectedLocales: [...affectedLocales],
      sharedFields: ctx.type.localized ? Object.keys(data).filter(name => !localizedField(attributes[name] as JsonObject)) : [],
      relationEffects: Object.keys(data).filter(name => (attributes[name] as JsonObject).type === 'relation').map(name => ({
        field: name, relation: (attributes[name] as JsonObject).relation,
        effect: 'Strapi also updates inverse relations; one-to-one/one-to-many assignment can detach another document. Review related records before approval.',
      })),
      safety: { writesDuringPreview: false, publishes: !ctx.type.draftAndPublish, draftAndPublish: ctx.type.draftAndPublish,
        existingEntryEditing: input.action === 'update', unchangedFieldsPreserved: true, atomic: false, concurrency: 'REST revision checks; external writers can race the final write' },
      revision: { schemaHash: ctx.schemaHash, entryHash: contentHash(before), operationHash },
      nextAction: { tool: 'apply_entry_write', requiresUserApproval: true, requiresIdempotencyKey: true },
    };
    const key = this.key(`preview:${previewId}`);
    await this.audit.begin({ key, project: this.key(input.project), sourceDocumentId: input.documentId ?? input.uid, cloneSlug: '', requestHash: operationHash, intendedHash: contentHash(data), request: { action: 'preview-entry', plan } });
    await this.audit.complete(key, result);
    return result;
  }

  async applyEntryWrite(projectName: string, previewId: string, expectedOperationHash: string, idempotencyKey: string): Promise<JsonObject> {
    return this.lock(async () => {
      requireProject(projectName);
      const preview = await this.audit.get(this.key(`preview:${previewId}`));
      if (preview?.status !== 'completed' || preview.requestHash !== expectedOperationHash || preview.request.action !== 'preview-entry') throw new AppError('PREVIEW_MISMATCH', 'Matching persisted entry preview required');
      const plan = preview.request.plan as unknown as EntryPlan;
      if (contentHash(plan) !== expectedOperationHash) throw new AppError('PREVIEW_MISMATCH', 'Persisted entry plan differs from the approved preview');
      if (plan.project !== projectName) throw new AppError('PROJECT_FORBIDDEN', 'Preview belongs to another project');
      const ctx = await this.context(projectName, plan.uid);
      if (ctx.binding !== plan.binding || ctx.schemaHash !== plan.schemaHash) throw new AppError('PREVIEW_MISMATCH', 'Target configuration or schema changed; inspect and preview again');
      if (plan.action === 'update' && ctx.project.allowEntryEditing !== true) throw new AppError('IN_PLACE_DISABLED', 'Existing-entry editing is disabled');
      const key = this.key(`write:${idempotencyKey}`);
      const previous = await this.audit.get(key);
      if (previous && previous.requestHash !== expectedOperationHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key belongs to a different preview');
      if (previous?.result?.verified === true) return { ...previous.result, idempotentReplay: true };
      const recoveredId = previous?.result?.documentId as string | undefined;
      if (previous && !recoveredId && !plan.documentId && ctx.type.kind !== 'singleType') throw new AppError('WRITE_OUTCOME_UNKNOWN', 'Previous write outcome is unknown. Inspect the CMS; never retry creation or adopt a record by slug');
      let documentId = recoveredId ?? plan.documentId;
      if (!previous) {
        for (const [locale, before] of Object.entries(plan.before)) {
          const actual = plan.action === 'create' && ctx.type.kind === 'collectionType' ? null : await ctx.client.get(plan.documentId, locale);
          if (contentHash(this.state(ctx.schema, actual)) !== contentHash(before.draft)) throw new AppError('DRAFT_CHANGED', `Entry changed after preview: ${locale || 'default'}`);
          if (ctx.type.draftAndPublish && !(plan.action === 'create' && ctx.type.kind === 'collectionType')) {
            const published = await ctx.client.get(plan.documentId, locale, 'published');
            if (contentHash(this.state(ctx.schema, published)) !== contentHash(before.published)) throw new AppError('DRAFT_CHANGED', 'Published version changed after preview');
          }
        }
        await this.validateReferences(plan.data, ctx.type.schema.attributes as JsonObject, ctx.registry, ctx, plan.locale);
        for (const [locale, before] of Object.entries(plan.before)) {
          if (plan.action === 'create' && ctx.type.kind === 'collectionType') continue;
          if (contentHash(this.state(ctx.schema, await ctx.client.get(plan.documentId, locale))) !== contentHash(before.draft)) throw new AppError('DRAFT_CHANGED', 'Entry changed while validating references');
        }
        // No creation request has been sent before this durable record.
        await this.audit.begin({ key, project: this.key(projectName), sourceDocumentId: plan.documentId ?? plan.uid, cloneSlug: '', requestHash: expectedOperationHash, intendedHash: contentHash(plan.data), request: { action: 'write-entry', previewId, plan } });
        try {
          const created = await ctx.client.write(plan.action, plan.data, plan.documentId, plan.locale);
          documentId = String(created.documentId ?? '');
          if (!documentId || (plan.documentId && documentId !== plan.documentId) || (ctx.type.draftAndPublish && created.publishedAt !== null)) throw new AppError('VERIFICATION_FAILED', 'Unexpected document identity/publication state in write response');
          await this.audit.complete(key, { documentId, verified: false, writeSubmitted: true });
        } catch (error) { await this.audit.fail(key, error); throw error; }
      }
      try {
        const actual = await ctx.client.get(ctx.type.kind === 'singleType' ? undefined : documentId, plan.locale);
        if (!actual) throw new AppError('VERIFICATION_FAILED', 'Written entry cannot be re-fetched');
        const snapshot = ctx.schema.snapshot(actual);
        for (const [name, value] of Object.entries(plan.data)) ctx.schema.assertWritten(value, snapshot[name], name);
        if (ctx.type.draftAndPublish && actual.publishedAt !== null) throw new AppError('VERIFICATION_FAILED', 'Write unexpectedly published content');
        const attributes = ctx.type.schema.attributes as JsonObject;
        for (const [locale, before] of Object.entries(plan.before)) {
          if (ctx.type.draftAndPublish) {
            const published = await ctx.client.get(ctx.type.kind === 'singleType' ? undefined : documentId, locale, 'published');
            if (contentHash(this.state(ctx.schema, published)) !== contentHash(before.published)) throw new AppError('VERIFICATION_FAILED', `Published version changed: ${locale}`);
          }
          if (!before.draft) continue;
          const after = await ctx.client.get(ctx.type.kind === 'singleType' ? undefined : documentId, locale);
          if (!after) throw new AppError('VERIFICATION_FAILED', `Existing locale disappeared: ${locale}`);
          const afterData = ctx.schema.snapshot(after); const beforeData = before.draft.data as JsonObject;
          for (const [name, value] of Object.entries(beforeData)) {
            const changedHere = Object.hasOwn(plan.data, name) && (locale === plan.locale || (ctx.type.localized && !localizedField(attributes[name] as JsonObject)));
            if (changedHere) ctx.schema.assertWritten(plan.data[name], afterData[name], `${locale}.${name}`);
            else if (contentHash(value) !== contentHash(afterData[name])) throw new AppError('VERIFICATION_FAILED', `Unrelated field changed: ${locale}.${name}`);
          }
        }
        const result = { project: projectName, uid: plan.uid, documentId: actual.documentId, locale: plan.locale || null,
          action: plan.action, status: ctx.type.draftAndPublish ? 'draft' : 'immediate', entryHash: contentHash(this.state(ctx.schema, actual)),
          operationHash: expectedOperationHash, changedFields: Object.keys(plan.data), verified: true,
          publishedVersionsUnchanged: ctx.type.draftAndPublish, idempotencyKey, recovered: Boolean(previous),
          verifiedAt: new Date().toISOString(), concurrency: 'REST revision checks are not atomic against external writers' };
        await this.audit.complete(key, result); return result;
      } catch (error) { await this.audit.fail(key, error); throw error; }
    });
  }
}
