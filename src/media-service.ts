import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig, JsonObject } from './types.js';
import type { AuditRepository } from './audit.js';
import { resolveProject } from './config.js';
import { currentTenant, requireProject } from './auth.js';
import { contentHash } from './strapi-client.js';
import { requestStrapi } from './api-request.js';
import { AppError } from './errors.js';

const mimeTypes: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

export class MediaService {
  constructor(private readonly config: AppConfig, private readonly audit: AuditRepository, private readonly resolver: typeof resolveProject = resolveProject) {}
  private key(value: string): string { return `${currentTenant()}:media:${value}`; }
  private project(name: string) { requireProject(name); return this.resolver(this.config, name); }
  private binding(project: ReturnType<typeof resolveProject>) { return contentHash({ baseUrl: project.baseUrl, tokenHash: contentHash(project.token) }); }

  async list(projectName: string, search?: string, page = 1, pageSize = 20): Promise<JsonObject> {
    const project = this.project(projectName);
    const params = new URLSearchParams({ 'pagination[page]': String(page), 'pagination[pageSize]': String(pageSize) });
    if (search) params.set('filters[name][$containsi]', search);
    try { return await requestStrapi(project, `/api/upload/files/page?${params}`) as JsonObject; }
    catch (error) {
      if (!(error instanceof AppError) || (error.details as JsonObject | undefined)?.status !== 404) throw error;
      // Older Strapi 5 releases expose only the flat endpoint and ignore pagination.
      const data = await requestStrapi(project, `/api/upload/files?${search ? new URLSearchParams({ 'filters[name][$containsi]': search }) : ''}`);
      if (!Array.isArray(data)) throw new AppError('STRAPI_ERROR', 'Invalid Media Library response');
      return { data: data.slice((page - 1) * pageSize, page * pageSize), meta: { pagination: { page, pageSize, total: data.length, pageCount: Math.ceil(data.length / pageSize) } }, legacyFlatEndpoint: true };
    }
  }

  private async file(path: string) {
    if (!isAbsolute(path)) throw new AppError('INVALID_REQUEST', 'Media upload requires an absolute local file path');
    const resolved = await realpath(path);
    const metadata = await stat(resolved);
    const mime = mimeTypes[extname(resolved).toLowerCase()];
    if (!mime || !metadata.isFile() || metadata.size === 0 || metadata.size > 20 * 1024 * 1024) throw new AppError('INVALID_REQUEST', 'Upload requires a supported media/document file between 1 byte and 20 MiB');
    const bytes = await readFile(resolved);
    const header = bytes.subarray(0, 16);
    const valid = mime === 'image/jpeg' ? header[0] === 255 && header[1] === 216 && header[2] === 255 :
      mime === 'image/png' ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
      mime === 'image/gif' ? header.toString('ascii').startsWith('GIF8') :
      mime === 'image/webp' ? header.toString('ascii').startsWith('RIFF') && header.toString('ascii', 8, 12) === 'WEBP' :
      mime === 'application/pdf' ? header.toString('ascii').startsWith('%PDF-') :
      mime === 'audio/wav' ? header.toString('ascii').startsWith('RIFF') && header.toString('ascii', 8, 12) === 'WAVE' :
      mime === 'audio/mpeg' ? header.toString('ascii').startsWith('ID3') || header[0] === 255 && (header[1] & 224) === 224 :
      mime.startsWith('application/vnd.') ? header[0] === 80 && header[1] === 75 && header[2] === 3 && header[3] === 4 :
      header.toString('ascii', 4, 8) === 'ftyp';
    if (!valid) throw new AppError('INVALID_REQUEST', 'File signature does not match the declared media type');
    return { path: resolved, name: basename(resolved), mime, bytes, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  async preview(projectName: string, filePath: string, alternativeText?: string, caption?: string): Promise<JsonObject> {
    const project = this.project(projectName);
    const file = await this.file(filePath);
    const plan = { project: projectName, path: file.path, name: file.name, mime: file.mime, size: file.size, sha256: file.sha256,
      alternativeText: alternativeText ?? null, caption: caption ?? null, binding: this.binding(project) };
    const operationHash = contentHash(plan); const previewId = randomUUID();
    const result = { contractVersion: '2', kind: 'preview', action: 'upload_media', previewId,
      target: { project: projectName, origin: project.baseUrl, endpoint: '/api/upload' },
      file: { name: file.name, localPath: file.path, mime: file.mime, bytes: file.size, sha256: file.sha256 },
      metadata: { alternativeText: plan.alternativeText, caption: plan.caption },
      safety: { writesDuringPreview: false, existingMediaPreserved: true, immediateVisibility: true, rollbackSupported: false },
      revision: { operationHash }, nextAction: { tool: 'upload_media', requiresUserApproval: true, requiresIdempotencyKey: true } };
    const key = this.key(`preview:${previewId}`);
    await this.audit.begin({ key, project: this.key(projectName), sourceDocumentId: '', cloneSlug: '', requestHash: operationHash, intendedHash: file.sha256, request: { action: 'preview-media', plan } });
    await this.audit.complete(key, result); return result;
  }

  async upload(projectName: string, previewId: string, expectedOperationHash: string, idempotencyKey: string): Promise<JsonObject> {
    // AuditStore provides the same cross-process write lock used by entry/page writes.
    if (!this.audit.withLock) throw new AppError('CONFIG_ERROR', 'Media uploads require an audit store with durable write locking');
    return this.audit.withLock('writes', async () => {
      const project = this.project(projectName);
      const preview = await this.audit.get(this.key(`preview:${previewId}`));
      if (preview?.status !== 'completed' || preview.request.action !== 'preview-media' || preview.requestHash !== expectedOperationHash) throw new AppError('PREVIEW_MISMATCH', 'Matching persisted media preview required');
      const plan = preview.request.plan as JsonObject;
      if (contentHash(plan) !== expectedOperationHash) throw new AppError('PREVIEW_MISMATCH', 'Persisted media plan differs from its approved hash');
      if (plan.project !== projectName || plan.binding !== this.binding(project)) throw new AppError('PREVIEW_MISMATCH', 'Upload target changed after preview');
      const key = this.key(`upload:${idempotencyKey}`);
      const previous = await this.audit.get(key);
      if (previous && previous.requestHash !== expectedOperationHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'Upload key belongs to another preview');
      if (previous?.result?.verified === true) return { ...previous.result, idempotentReplay: true };
      let id = previous?.result?.id as number | undefined;
      if (previous && !id) throw new AppError('WRITE_OUTCOME_UNKNOWN', 'Upload outcome is unknown; inspect the library before starting a new operation. Never upload twice automatically');
      if (!previous) {
        const file = await this.file(String(plan.path));
        if (file.sha256 !== plan.sha256 || file.mime !== plan.mime) throw new AppError('SOURCE_CHANGED', 'Local media file changed after preview');
        const form = new FormData(); form.append('files', new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.name);
        form.append('fileInfo', JSON.stringify({ name: plan.name, alternativeText: plan.alternativeText, caption: plan.caption }));
        await this.audit.begin({ key, project: this.key(projectName), sourceDocumentId: '', cloneSlug: '', requestHash: expectedOperationHash, intendedHash: file.sha256, request: { action: 'upload-media', previewId, plan } });
        try {
          const response = await requestStrapi(project, '/api/upload', { method: 'POST', body: form });
          const created = Array.isArray(response) && response.length === 1 ? response[0] as JsonObject : null;
          if (!created || !Number.isSafeInteger(created.id) || Number(created.id) < 1) throw new AppError('VERIFICATION_FAILED', 'Upload response returned no unique media ID');
          id = Number(created.id); await this.audit.complete(key, { id, verified: false });
        } catch (error) { await this.audit.fail(key, error); throw error; }
      }
      try {
        const media = await requestStrapi(project, `/api/upload/files/${id}`) as JsonObject;
        if (media.id !== id || media.name !== plan.name || media.mime !== plan.mime || media.alternativeText !== plan.alternativeText || media.caption !== plan.caption || typeof media.url !== 'string') throw new AppError('VERIFICATION_FAILED', 'Uploaded media metadata differs from the preview');
        const result = { project: projectName, id, media, verified: true, operationHash: expectedOperationHash, idempotencyKey, recovered: Boolean(previous) };
        await this.audit.complete(key, result); return result;
      } catch (error) { await this.audit.fail(key, error); throw error; }
    });
  }
}
