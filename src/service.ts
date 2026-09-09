import type { AppConfig, ChangeSummary, JsonObject, Operation } from './types.js';
import { resolveProject } from './config.js';
import type { AuditRepository, OwnedDraft } from './audit.js';
import { applyOperations } from './operations.js';
import { contentHash, idempotentSlug, StrapiClient } from './strapi-client.js';
import { SchemaCatalog } from './schema-catalog.js';
import { AppError } from './errors.js';
import { canAccessProject, currentTenant, requireProject } from './auth.js';

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
      return await (this.audit.withLock ? this.audit.withLock(`${currentTenant()}:${key}`, callback) : callback());
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  listProjects(): JsonObject[] {
    return Object.entries(this.config.projects).filter(([name]) => canAccessProject(name)).map(([name, project]) => ({
      name, baseUrl: project.baseUrl, collection: project.collection,
      blocksField: project.blocksField, defaultLocale: project.defaultLocale,
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

  async preview(request: CloneRequest): Promise<JsonObject> {
    const context = await this.source(request);
    const { blocks, changes } = await this.plan(context.source, context.project, request.operations);
    const sourceSlug = String(context.source[context.project.slugField] ?? context.documentId);
    const operationHash = requestHash('clone', { ...request, expectedSourceHash: context.sourceHash });
    return {
      sourceDocumentId: context.documentId, sourceHash: context.sourceHash, operationHash, sourceSlug,
      proposedSlug: request.cloneSlug ?? idempotentSlug(sourceSlug, request.idempotencyKey ?? operationHash),
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
    const operationHash = requestHash('clone', request);
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
    const createData = await catalog.normalizeDocumentForWrite(context.source);
    createData[context.project.slugField] = cloneSlug;
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
        const result = { documentId: recoveredId, slug: cloneSlug, sourceDocumentId: context.documentId, sourceHash: context.sourceHash, draftHash: contentHash(recovered), operationHash, changes, recovered: true, status: 'draft' };
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
      const result = { documentId: createdId, slug: cloneSlug, sourceDocumentId: context.documentId, sourceHash: context.sourceHash, draftHash, operationHash, status: 'draft', changes, verified: true };
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
