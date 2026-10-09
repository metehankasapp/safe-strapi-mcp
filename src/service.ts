import type { AppConfig, ChangeSummary, JsonObject, Operation } from './types.js';
import { resolveProject } from './config.js';
import type { AuditRepository, OwnedDraft } from './audit.js';
import { applyOperations } from './operations.js';
import { contentHash, idempotentSlug, StrapiClient } from './strapi-client.js';
import { SchemaCatalog } from './schema-catalog.js';
import { AppError } from './errors.js';
import { canAccessProject, currentTenant, requireProject } from './auth.js';
import { planInPlace, type InPlaceOperation } from './in-place.js';

export interface ModifyPagePreviewRequest {
  project: string;
  documentId: string;
  locale?: string;
  operations: InPlaceOperation[];
}

export interface ModifyPageRequest extends ModifyPagePreviewRequest {
  expectedPageHash: string;
  expectedOperationHash: string;
  idempotencyKey: string;
}

export interface CloneRequest {
  project: string;
  sourceDocumentId?: string;
  sourceSlug?: string;
  locale?: string;
  expectedSourceHash?: string;
  cloneSlug?: string;
  titleSuffix?: string;
  idempotencyKey?: string;
  operations: Operation[];
}

export interface ModifyOwnedRequest {
  project: string;
  documentId: string;
  locale?: string;
  expectedDraftHash: string;
  idempotencyKey: string;
  operations: Operation[];
}

interface SourceContext {
  source: JsonObject;
  documentId: string;
  sourceHash: string;
  client: StrapiClient;
  project: ReturnType<typeof resolveProject>;
  locale: string;
}

function requestHash(action: string, request: object): string {
  const { idempotencyKey: _ignored, ...content } = request as Record<string, unknown>;
  return contentHash({ action, ...content });
}

function deepDifferences(left: unknown, right: unknown, path = '', output: JsonObject[] = []): JsonObject[] {
  if (output.length >= 500 || Object.is(left, right)) return output;
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      deepDifferences(left[index], right[index], `${path}[${index}]`, output);
    }
    return output;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const keys = new Set([...Object.keys(left as JsonObject), ...Object.keys(right as JsonObject)]);
    for (const key of [...keys].sort()) {
      deepDifferences((left as JsonObject)[key], (right as JsonObject)[key], path ? `${path}.${key}` : key, output);
    }
    return output;
  }
  output.push({ path: path || '$', left, right });
  return output;
}

export class ContentService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly config: AppConfig,
    private readonly audit: AuditRepository,
    private readonly projectResolver: (config: AppConfig, name: string) => ReturnType<typeof resolveProject> = (config, name) => resolveProject(config, name),
  ) {}

  async readiness(): Promise<void> { await this.audit.health(); }

  private auditKey(value: string): string { return `${currentTenant()}:${value}`; }
  private auditProject(value: string): string { return `${currentTenant()}:${value}`; }

  private async withLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.locks.set(key, tail);
    await previous;
    try {
      // Writes sharing a database also share the physical Strapi resources.
      // Tenant isolation applies to audit records, not the serialization lock.
      return await (this.audit.withLock ? this.audit.withLock(key, callback) : callback());
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  listProjects(): JsonObject[] {
    return Object.entries(this.config.projects).filter(([name]) => canAccessProject(name)).map(([name, project]) => ({
      name, baseUrl: project.baseUrl, collection: project.collection,
      blocksField: project.blocksField, defaultLocale: project.defaultLocale,
      allowInPlaceEditing: project.allowInPlaceEditing === true,
    }));
  }

  private client(projectName: string): { client: StrapiClient; project: ReturnType<typeof resolveProject> } {
    requireProject(projectName);
    const project = this.projectResolver(this.config, projectName);
    return { client: new StrapiClient(project), project };
  }

  private locale(project: ReturnType<typeof resolveProject>, locale?: string): string {
    return locale ?? project.defaultLocale ?? 'en';
  }

  private async writableHash(project: ReturnType<typeof resolveProject>, value: JsonObject): Promise<string> {
    return contentHash(await new SchemaCatalog(project).normalizeDocumentForWrite(value));
  }

  async listPages(projectName: string, search?: string, locale?: string, pageSize?: number): Promise<JsonObject[]> {
    return this.client(projectName).client.list(search, locale, pageSize);
  }

  private inPlaceContext(request: ModifyPagePreviewRequest) {
    const context = this.client(request.project);
    if (!context.project.allowInPlaceEditing) throw new AppError('IN_PLACE_DISABLED', 'Enable allowInPlaceEditing explicitly for this project', undefined, 403);
    if (!request.documentId) throw new AppError('INVALID_REQUEST', 'documentId is required');
    return { ...context, locale: this.locale(context.project, request.locale) };
  }

  private inPlaceOperationHash(request: ModifyPagePreviewRequest, pageHash: string): string {
    const { project, locale } = this.inPlaceContext(request);
    return contentHash({ action: 'modify-page', project: request.project, documentId: request.documentId,
      locale, operations: request.operations, pageHash, baseUrl: project.baseUrl,
      collection: project.collection, blocksField: project.blocksField });
  }

  private async inPlaceContentHash(catalog: SchemaCatalog, page: JsonObject): Promise<string> {
    return contentHash({ data: await catalog.normalizeDocumentForWrite(page),
      documentId: page.documentId, locale: page.locale, publishedAt: page.publishedAt });
  }

  private async inPlacePlan(request: ModifyPagePreviewRequest, page: JsonObject) {
    const { project, locale } = this.inPlaceContext(request);
    const catalog = new SchemaCatalog(project);
    const schema = await catalog.inPlaceSchema();
    const localized = ((schema.pluginOptions as JsonObject | undefined)?.i18n as JsonObject | undefined)?.localized === true;
    if (page.documentId !== request.documentId || (localized ? page.locale !== locale : page.locale !== undefined && page.locale !== locale) || page.publishedAt !== null) {
      throw new AppError('INVALID_DRAFT', 'An existing draft in the requested locale is required');
    }
    for (const [field, definition] of Object.entries(schema.attributes as JsonObject)) {
      if ((definition as JsonObject).private === true || page[field] === undefined) {
        throw new AppError('INCOMPLETE_CONTENT', `Cannot preserve unreadable page field: ${field}`);
      }
    }
    const original = page[project.blocksField];
    if (!Array.isArray(original)) throw new AppError('INCOMPLETE_CONTENT', 'Dynamic zone was not populated');
    await catalog.normalizeDynamicZoneForUpdate(original, true);
    for (const operation of request.operations) {
      if (operation.type === 'insert') await catalog.normalizeDynamicZoneForUpdate([operation.component], false, true);
    }
    const plan = planInPlace(original, request.operations);
    await catalog.assertReferencesPreserved(original, plan.blocks);
    const updateBlocks = await catalog.normalizeDynamicZoneForUpdate(plan.blocks);
    const intended = { ...page, [project.blocksField]: plan.blocks };
    return { ...plan, updateBlocks, catalog, intendedHash: await this.inPlaceContentHash(catalog, intended) };
  }

  async previewModifyPage(request: ModifyPagePreviewRequest): Promise<JsonObject> {
    const { client, project, locale } = this.inPlaceContext(request);
    const page = await client.get(request.documentId, locale);
    const plan = await this.inPlacePlan(request, page);
    const pageHash = contentHash(page);
    const operationHash = this.inPlaceOperationHash(request, pageHash);
    const result = { documentId: request.documentId, locale, pageHash, operationHash,
      beforeCount: (page[project.blocksField] as unknown[]).length, afterCount: plan.blocks.length,
      changes: plan.changes, differences: deepDifferences(page[project.blocksField], plan.blocks),
      status: 'draft', concurrency: 'REST revision checks; external writes are not atomic' };
    const previewKey = this.auditKey(`preview-modify-page:${operationHash}`);
    // Persist the server-generated plan. A write cannot bypass preview by merely
    // supplying two syntactically valid hashes.
    await this.audit.begin({ key: previewKey, project: this.auditProject(request.project),
      sourceDocumentId: request.documentId, cloneSlug: String(page[project.slugField]),
      requestHash: operationHash, intendedHash: plan.intendedHash, request: { action: 'preview-modify-page', page, blocks: plan.blocks } });
    await this.audit.complete(previewKey, result);
    return result;
  }

  async modifyPage(request: ModifyPageRequest): Promise<JsonObject> {
    return this.withLock('writes', () => this.modifyPageLocked(request));
  }

  private async modifyPageLocked(request: ModifyPageRequest): Promise<JsonObject> {
    const { client, project, locale } = this.inPlaceContext(request);
    if (!request.idempotencyKey || request.idempotencyKey.length < 8 || request.idempotencyKey.length > 200 ||
      !/^[a-f0-9]{64}$/.test(request.expectedPageHash) || !/^[a-f0-9]{64}$/.test(request.expectedOperationHash)) {
      throw new AppError('INVALID_REQUEST', 'Valid preview hashes and an 8–200 character idempotencyKey are required');
    }
    const operationHash = this.inPlaceOperationHash(request, request.expectedPageHash);
    if (operationHash !== request.expectedOperationHash) throw new AppError('PREVIEW_MISMATCH', 'Operations differ from preview', undefined, 409);
    const preview = await this.audit.get(this.auditKey(`preview-modify-page:${operationHash}`));
    if (preview?.status !== 'completed' || !preview.intendedHash || !preview.result) {
      throw new AppError('PREVIEW_REQUIRED', 'Run preview_modify_page in this installation before writing', undefined, 409);
    }
    const key = this.auditKey(request.idempotencyKey);
    const jobHash = requestHash('modify-page', { ...request, locale });
    const existing = await this.audit.get(key);
    if (existing && existing.requestHash !== jobHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different inputs', undefined, 409);
    if (existing?.status === 'completed' && existing.result) return { ...existing.result, idempotentReplay: true };
    const page = await client.get(request.documentId, locale);
    const catalog = new SchemaCatalog(project);
    const expectedBlocks = preview.request.blocks as unknown[];
    const verify = async (fetched: JsonObject) => {
      // Require complete populated data again; normalization must not conceal a
      // missing field or regenerated ID during post-write verification.
      await catalog.normalizeDynamicZoneForUpdate(fetched[project.blocksField] as unknown[], true);
      if (await this.inPlaceContentHash(catalog, fetched) !== preview.intendedHash) {
        throw new AppError('VERIFICATION_FAILED', 'Page differs from preview after re-fetch', undefined, 409);
      }
      await catalog.assertComponentIds(expectedBlocks, fetched[project.blocksField] as unknown[]);
    };
    const result = (fetched: JsonObject, recovered = false): JsonObject => ({ documentId: request.documentId, locale,
      pageHash: contentHash(fetched), operationHash, changes: preview.result?.changes,
      verified: true, recovered, status: 'draft', concurrency: preview.result?.concurrency });
    if (existing) {
      try {
        await verify(page);
        const recovered = result(page, true);
        await this.audit.complete(key, recovered);
        return recovered;
      } catch {
        throw new AppError('WRITE_OUTCOME_UNKNOWN', 'Previous update could not be verified; inspect the page before starting a new operation', undefined, 409);
      }
    }
    if (contentHash(page) !== request.expectedPageHash) throw new AppError('PAGE_CHANGED', 'Page changed after preview; preview again', undefined, 409);
    const plan = await this.inPlacePlan(request, page);
    if (plan.intendedHash !== preview.intendedHash) throw new AppError('PREVIEW_MISMATCH', 'Schema or write plan changed after preview', undefined, 409);
    const latest = await client.get(request.documentId, locale);
    if (contentHash(latest) !== request.expectedPageHash) throw new AppError('PAGE_CHANGED', 'Page changed while preparing the update', undefined, 409);
    await this.audit.begin({ key, project: this.auditProject(request.project), sourceDocumentId: request.documentId,
      cloneSlug: String(page[project.slugField]), requestHash: jobHash, intendedHash: plan.intendedHash,
      request: { action: 'modify-page', ...request } });
    try {
      await client.update(request.documentId, { [project.blocksField]: plan.updateBlocks }, locale);
      const fetched = await client.get(request.documentId, locale);
      await verify(fetched);
      const completed = result(fetched);
      await this.audit.complete(key, completed);
      return completed;
    } catch (error) { await this.audit.fail(key, error); throw error; }
  }

  async listComponents(projectName: string): Promise<JsonObject[]> {
    requireProject(projectName);
    return new SchemaCatalog(this.projectResolver(this.config, projectName)).list();
  }

  async componentSchema(projectName: string, uid: string): Promise<JsonObject> {
    requireProject(projectName);
    return new SchemaCatalog(this.projectResolver(this.config, projectName)).get(uid);
  }

  private async source(request: Pick<CloneRequest, 'project' | 'sourceDocumentId' | 'sourceSlug' | 'locale' | 'expectedSourceHash'>): Promise<SourceContext> {
    if (Boolean(request.sourceDocumentId) === Boolean(request.sourceSlug)) {
      throw new AppError('INVALID_REQUEST', 'Provide exactly one of sourceDocumentId or sourceSlug');
    }
    const { client, project } = this.client(request.project);
    const locale = this.locale(project, request.locale);
    const source = request.sourceDocumentId
      ? await client.get(request.sourceDocumentId, locale)
      : await client.findBySlug(String(request.sourceSlug), locale);
    if (!source) throw new AppError('SOURCE_NOT_FOUND', 'Source page not found');
    const documentId = String(source.documentId ?? '');
    if (!documentId) throw new AppError('SOURCE_NOT_FOUND', 'Source page has no documentId');
    const sourceHash = contentHash(source);
    if (request.expectedSourceHash && request.expectedSourceHash !== sourceHash) {
      throw new AppError('SOURCE_CHANGED', 'Source page changed after preview; preview again', { expected: request.expectedSourceHash, actual: sourceHash }, 409);
    }
    return { source, documentId, sourceHash, client, project, locale };
  }

  private async assertSourceHash(client: StrapiClient, documentId: string, locale: string, expected: string): Promise<void> {
    const actual = contentHash(await client.get(documentId, locale));
    if (actual !== expected) throw new AppError('SOURCE_CHANGED', 'Source page changed during operation', { expected, actual }, 409);
  }

  private async requireOwned(project: string, documentId: string, locale: string): Promise<OwnedDraft> {
    const owned = await this.audit.getOwned(this.auditProject(project), documentId, locale);
    if (!owned) throw new AppError('DRAFT_NOT_OWNED', 'Draft was not created by this MCP service', { project, documentId, locale }, 403);
    return owned;
  }

  private pageInspection(page: JsonObject, project: ReturnType<typeof resolveProject>, hash = contentHash(page)): JsonObject {
    const blocks = page[project.blocksField];
    return {
      contentHash: hash,
      documentId: page.documentId,
      slug: page[project.slugField],
      title: project.titleField ? page[project.titleField] : undefined,
      blocks: Array.isArray(blocks) ? blocks.map((block, index) => ({
        index,
        component: block && typeof block === 'object' ? (block as JsonObject).__component : 'unknown',
        data: block,
      })) : [],
    };
  }

  async inspect(projectName: string, documentId?: string, slug?: string, locale?: string): Promise<JsonObject> {
    const context = await this.source({ project: projectName, sourceDocumentId: documentId, sourceSlug: slug, locale });
    return this.pageInspection(context.source, context.project, context.sourceHash);
  }

  async inspectOwnedDraft(projectName: string, documentId: string, locale?: string): Promise<JsonObject> {
    const { client, project } = this.client(projectName);
    const resolvedLocale = this.locale(project, locale);
    const owned = await this.requireOwned(projectName, documentId, resolvedLocale);
    const draft = await client.get(documentId, resolvedLocale);
    const source = await client.get(owned.sourceDocumentId, resolvedLocale);
    return { owned: true, sourceDocumentId: owned.sourceDocumentId, sourceUnchanged: contentHash(source) === owned.sourceHash, ...this.pageInspection(draft, project) };
  }

  private async plan(page: JsonObject, project: ReturnType<typeof resolveProject>, operations: Operation[]): Promise<{ blocks: unknown[]; changes: ChangeSummary[] }> {
    const currentBlocks = page[project.blocksField];
    if (!Array.isArray(currentBlocks)) throw new AppError('INVALID_REQUEST', `${project.blocksField} is not an array`);
    const result = applyOperations(currentBlocks, operations);
    await new SchemaCatalog(project).validateBlocks(result.blocks);
    return { blocks: result.blocks, changes: result.changes };
  }

  private async cloneTopLevelChanges(source: JsonObject, project: ReturnType<typeof resolveProject>, cloneSlug: string, titleSuffix?: string): Promise<JsonObject[]> {
    const changes: JsonObject[] = [{ field: project.slugField, from: source[project.slugField], to: cloneSlug }];
    if (project.routeField && project.routeField !== project.slugField) {
      await new SchemaCatalog(project).validateTopLevelStringField(project.routeField);
      changes.push({ field: project.routeField, from: source[project.routeField], to: cloneSlug });
    }
    if (project.titleField && typeof source[project.titleField] === 'string') {
      changes.push({ field: project.titleField, from: source[project.titleField], to: `${source[project.titleField]}${titleSuffix ?? ' (AI Draft)'}` });
    }
    return changes.filter(change => change.from !== change.to);
  }

  async preview(request: CloneRequest): Promise<JsonObject> {
    const context = await this.source(request);
    const { blocks, changes } = await this.plan(context.source, context.project, request.operations);
    const sourceSlug = String(context.source[context.project.slugField] ?? context.documentId);
    const operationHash = requestHash('clone', { ...request, expectedSourceHash: context.sourceHash, routeField: context.project.routeField });
    const proposedSlug = request.cloneSlug ?? idempotentSlug(sourceSlug, request.idempotencyKey ?? operationHash);
    const topLevelChanges = await this.cloneTopLevelChanges(context.source, context.project, proposedSlug, request.titleSuffix);
    return {
      sourceDocumentId: context.documentId, sourceHash: context.sourceHash, operationHash, sourceSlug,
      proposedSlug, topLevelChanges,
      beforeCount: (context.source[context.project.blocksField] as unknown[]).length,
      afterCount: blocks.length, changes,
    };
  }

  async cloneAndModify(request: CloneRequest): Promise<JsonObject> {
    if (!request.idempotencyKey) throw new AppError('INVALID_REQUEST', 'idempotencyKey is required for write operations');
    return this.withLock('writes', () => this.cloneAndModifyLocked(request));
  }

  private async cloneAndModifyLocked(request: CloneRequest): Promise<JsonObject> {
    if (!request.idempotencyKey) throw new AppError('INVALID_REQUEST', 'idempotencyKey is required for write operations');
    if (!request.expectedSourceHash) throw new AppError('INVALID_REQUEST', 'expectedSourceHash is required for write operations');
    const operationHash = requestHash('clone', { ...request, routeField: this.client(request.project).project.routeField });
    const auditKey = this.auditKey(request.idempotencyKey);
    const auditProject = this.auditProject(request.project);
    const existing = await this.audit.get(auditKey);
    if (existing && existing.requestHash !== operationHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different operation hash', { existingHash: existing.requestHash, receivedHash: operationHash }, 409);
    }
    if (existing?.status === 'completed' && existing.result) return { ...existing.result, idempotentReplay: true };

    const context = await this.source(request);
    const { blocks, changes } = await this.plan(context.source, context.project, request.operations);
    const sourceSlug = String(context.source[context.project.slugField] ?? context.documentId);
    const cloneSlug = request.cloneSlug ?? idempotentSlug(sourceSlug, request.idempotencyKey);
    const catalog = new SchemaCatalog(context.project);
    const topLevelChanges = await this.cloneTopLevelChanges(context.source, context.project, cloneSlug, request.titleSuffix);
    const createData = await catalog.normalizeDocumentForWrite(context.source);
    createData[context.project.slugField] = cloneSlug;
    if (context.project.routeField) createData[context.project.routeField] = cloneSlug;
    createData[context.project.blocksField] = await catalog.normalizeDynamicZoneForWrite(blocks);
    if (context.project.titleField && typeof createData[context.project.titleField] === 'string') {
      createData[context.project.titleField] = `${createData[context.project.titleField]}${request.titleSuffix ?? ' (AI Draft)'}`;
    }
    const intendedHash = contentHash(createData);

    await this.audit.begin({ key: auditKey, project: auditProject, sourceDocumentId: context.documentId, cloneSlug, requestHash: operationHash, intendedHash, request: { action: 'clone', ...request } });
    try {
      const ownedByJob = await this.audit.getOwnedByJob(auditKey);
      // A matching slug/payload is not proof of ownership. If the process died
      // before recording the returned ID, REST cannot safely reconcile the POST.
      if (existing && !ownedByJob) {
        throw new AppError('WRITE_OUTCOME_UNKNOWN', 'A previous create attempt has no recorded document ID. Automatic retry is blocked to avoid duplicates or claiming another page.', { cloneSlug }, 409);
      }
      const recovered = ownedByJob ? await context.client.get(ownedByJob.documentId, context.locale) : null;
      if (recovered) {
        const recoveredHash = await this.writableHash(context.project, recovered);
        if (recoveredHash !== intendedHash) throw new AppError('VERIFICATION_FAILED', 'Recovered draft does not match intended content', { intendedHash, recoveredHash }, 409);
        await this.assertSourceHash(context.client, context.documentId, context.locale, context.sourceHash);
        const recoveredId = String(recovered.documentId);
        await this.audit.recordOwned({ project: auditProject, documentId: recoveredId, locale: context.locale, slug: cloneSlug, sourceDocumentId: context.documentId, sourceHash: context.sourceHash, createdByJob: auditKey, lastHash: contentHash(recovered) });
        const result = { documentId: recoveredId, slug: cloneSlug, sourceDocumentId: context.documentId, sourceHash: context.sourceHash, draftHash: contentHash(recovered), operationHash, changes, topLevelChanges, recovered: true, status: 'draft' };
        await this.audit.complete(auditKey, result);
        return result;
      }

      await this.assertSourceHash(context.client, context.documentId, context.locale, context.sourceHash);
      if (await context.client.findBySlug(cloneSlug, context.locale)) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'Clone slug already exists; existing pages are never adopted', { cloneSlug }, 409);
      }
      const created = await context.client.create(createData, context.locale);
      const createdId = String(created.documentId ?? '');
      if (!createdId) throw new AppError('VERIFICATION_FAILED', 'Created draft has no documentId');
      await this.audit.recordOwned({ project: auditProject, documentId: createdId, locale: context.locale, slug: cloneSlug, sourceDocumentId: context.documentId, sourceHash: context.sourceHash, createdByJob: auditKey, lastHash: contentHash(created) });
      const fetched = await context.client.get(createdId, context.locale);
      const fetchedHash = await this.writableHash(context.project, fetched);
      if (fetchedHash !== intendedHash) throw new AppError('VERIFICATION_FAILED', 'Created draft differs from intended content after re-fetch', { intendedHash, fetchedHash, documentId: createdId }, 409);
      await this.assertSourceHash(context.client, context.documentId, context.locale, context.sourceHash);
      const draftHash = contentHash(fetched);
      await this.audit.updateOwnedHash(auditProject, createdId, context.locale, draftHash);
      const result = { documentId: createdId, slug: cloneSlug, sourceDocumentId: context.documentId, sourceHash: context.sourceHash, draftHash, operationHash, status: 'draft', changes, topLevelChanges, verified: true };
      await this.audit.complete(auditKey, result);
      return result;
    } catch (error) {
      await this.audit.fail(auditKey, error);
      throw error;
    }
  }

  async modifyOwnedDraft(request: ModifyOwnedRequest): Promise<JsonObject> {
    return this.withLock('writes', () => this.modifyOwnedDraftLocked(request));
  }

  private async modifyOwnedDraftLocked(request: ModifyOwnedRequest): Promise<JsonObject> {
    const { client, project } = this.client(request.project);
    const locale = this.locale(project, request.locale);
    const owned = await this.requireOwned(request.project, request.documentId, locale);
    const auditKey = this.auditKey(request.idempotencyKey);
    const auditProject = this.auditProject(request.project);
    const operationHash = requestHash('modify-owned', request);
    const existing = await this.audit.get(auditKey);
    if (existing && existing.requestHash !== operationHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different operation hash', { existingHash: existing.requestHash, receivedHash: operationHash }, 409);
    if (existing?.status === 'completed' && existing.result) return { ...existing.result, idempotentReplay: true };

    await this.assertSourceHash(client, owned.sourceDocumentId, locale, owned.sourceHash);
    const draft = await client.get(request.documentId, locale);
    const draftHashBefore = contentHash(draft);
    if (existing && existing.intendedHash && await this.writableHash(project, draft) === existing.intendedHash) {
      await this.assertSourceHash(client, owned.sourceDocumentId, locale, owned.sourceHash);
      await this.audit.updateOwnedHash(auditProject, request.documentId, locale, draftHashBefore);
      const result = { documentId: request.documentId, draftHash: draftHashBefore, operationHash, recovered: true, verified: true };
      await this.audit.complete(auditKey, result);
      return result;
    }
    if (draftHashBefore !== request.expectedDraftHash) throw new AppError('DRAFT_CHANGED', 'Owned draft changed after inspection', { expected: request.expectedDraftHash, actual: draftHashBefore }, 409);
    const { blocks, changes } = await this.plan(draft, project, request.operations);
    const catalog = new SchemaCatalog(project);
    const updateData = await catalog.normalizeDocumentForWrite(draft);
    updateData[project.blocksField] = await catalog.normalizeDynamicZoneForWrite(blocks);
    const intendedHash = contentHash(updateData);
    await this.audit.begin({ key: auditKey, project: auditProject, sourceDocumentId: owned.sourceDocumentId, cloneSlug: owned.slug, requestHash: operationHash, intendedHash, request: { action: 'modify-owned', ...request } });
    try {
      // Recheck immediately before sending, and do not resend unrelated fields.
      // This detects intervening edits, but REST has no atomic compare-and-swap.
      const latest = await client.get(request.documentId, locale);
      if (contentHash(latest) !== draftHashBefore) throw new AppError('DRAFT_CHANGED', 'Owned draft changed while preparing the update', undefined, 409);
      await this.assertSourceHash(client, owned.sourceDocumentId, locale, owned.sourceHash);
      await client.update(request.documentId, { [project.blocksField]: updateData[project.blocksField] }, locale);
      const fetched = await client.get(request.documentId, locale);
      const fetchedHash = await this.writableHash(project, fetched);
      if (fetchedHash !== intendedHash) throw new AppError('VERIFICATION_FAILED', 'Updated draft differs from intended content after re-fetch', { intendedHash, fetchedHash }, 409);
      await this.assertSourceHash(client, owned.sourceDocumentId, locale, owned.sourceHash);
      const draftHash = contentHash(fetched);
      await this.audit.updateOwnedHash(auditProject, request.documentId, locale, draftHash);
      const result = { documentId: request.documentId, draftHash, operationHash, changes, verified: true };
      await this.audit.complete(auditKey, result);
      return result;
    } catch (error) {
      await this.audit.fail(auditKey, error);
      throw error;
    }
  }

  async validateDraft(projectName: string, documentId: string, locale?: string): Promise<JsonObject> {
    const { client, project } = this.client(projectName);
    const resolvedLocale = this.locale(project, locale);
    const owned = await this.requireOwned(projectName, documentId, resolvedLocale);
    const draft = await client.get(documentId, resolvedLocale);
    const blocks = draft[project.blocksField];
    if (!Array.isArray(blocks)) throw new AppError('SCHEMA_VALIDATION_FAILED', `${project.blocksField} is not an array`);
    await new SchemaCatalog(project).validateBlocks(blocks);
    const source = await client.get(owned.sourceDocumentId, resolvedLocale);
    return { valid: true, owned: true, documentId, draftHash: contentHash(draft), componentCount: blocks.length, sourceUnchanged: contentHash(source) === owned.sourceHash };
  }

  async comparePages(projectName: string, leftDocumentId: string, rightDocumentId: string, locale?: string): Promise<JsonObject> {
    const { client, project } = this.client(projectName);
    const [left, right] = await Promise.all([client.get(leftDocumentId, locale), client.get(rightDocumentId, locale)]);
    const catalog = new SchemaCatalog(project);
    const [leftWritable, rightWritable] = await Promise.all([
      catalog.normalizeDocumentForWrite(left), catalog.normalizeDocumentForWrite(right),
    ]);
    const differences = deepDifferences(leftWritable, rightWritable);
    return {
      equal: differences.length === 0, leftDocumentId, rightDocumentId,
      leftHash: contentHash(left), rightHash: contentHash(right),
      differenceCount: differences.length, truncated: differences.length >= 500, differences,
    };
  }
}
