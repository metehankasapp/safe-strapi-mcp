import { AppError } from '../../src/errors.js';
import type { AuditRecord, AuditRepository, OwnedDraft } from '../../src/audit.js';
import type { JsonObject } from '../../src/types.js';

type Row = Record<string, unknown>;

function auditRecord(row: Row): AuditRecord {
  return {
    idempotencyKey: String(row.idempotency_key), status: row.status as AuditRecord['status'],
    project: String(row.project), sourceDocumentId: String(row.source_document_id), cloneSlug: String(row.clone_slug),
    requestHash: String(row.request_hash), intendedHash: row.intended_hash ? String(row.intended_hash) : null,
    request: JSON.parse(String(row.request_json)) as JsonObject,
    result: row.result_json ? JSON.parse(String(row.result_json)) as JsonObject : null,
  };
}

function ownedDraft(row: Row): OwnedDraft {
  return {
    project: String(row.project), documentId: String(row.document_id), locale: String(row.locale), slug: String(row.slug),
    sourceDocumentId: String(row.source_document_id), sourceHash: String(row.source_hash),
    createdByJob: String(row.created_by_job), lastHash: String(row.last_hash),
  };
}

export class D1AuditStore implements AuditRepository {
  constructor(private readonly db: D1Database) {}

  async health(): Promise<void> { await this.db.prepare('SELECT 1').first(); }
  async withLock<T>(_key: string, callback: () => Promise<T>): Promise<T> { return callback(); }

  async get(key: string): Promise<AuditRecord | null> {
    const row = await this.db.prepare('SELECT * FROM content_jobs WHERE idempotency_key = ?').bind(key).first<Row>();
    return row ? auditRecord(row) : null;
  }

  async begin(input: { key: string; project: string; sourceDocumentId: string; cloneSlug: string; requestHash: string; intendedHash: string; request: unknown }): Promise<void> {
    const existing = await this.get(input.key);
    if (existing && existing.requestHash !== input.requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different operation', { existingHash: existing.requestHash, receivedHash: input.requestHash }, 409);
    }
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO content_jobs
      (idempotency_key,status,project,source_document_id,clone_slug,request_json,request_hash,intended_hash,created_at,updated_at)
      VALUES (?,'pending',?,?,?,?,?,?,?,?)
      ON CONFLICT(idempotency_key) DO UPDATE SET status='pending', error=NULL, updated_at=excluded.updated_at
      WHERE content_jobs.status='failed'`)
      .bind(input.key, input.project, input.sourceDocumentId, input.cloneSlug, JSON.stringify(input.request), input.requestHash, input.intendedHash, now, now).run();
  }

  async complete(key: string, result: JsonObject): Promise<void> {
    await this.db.prepare("UPDATE content_jobs SET status='completed', result_json=?, updated_at=? WHERE idempotency_key=?")
      .bind(JSON.stringify(result), new Date().toISOString(), key).run();
  }
  async fail(key: string, error: unknown): Promise<void> {
    await this.db.prepare("UPDATE content_jobs SET status='failed', error=?, updated_at=? WHERE idempotency_key=?")
      .bind(error instanceof Error ? error.message : String(error), new Date().toISOString(), key).run();
  }
  async recordOwned(input: OwnedDraft): Promise<void> {
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO owned_drafts
      (project,document_id,locale,slug,source_document_id,source_hash,created_by_job,last_hash,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project,document_id,locale)
      DO UPDATE SET last_hash=excluded.last_hash, updated_at=excluded.updated_at`)
      .bind(input.project, input.documentId, input.locale, input.slug, input.sourceDocumentId, input.sourceHash, input.createdByJob, input.lastHash, now, now).run();
  }
  async getOwned(project: string, documentId: string, locale: string): Promise<OwnedDraft | null> {
    const row = await this.db.prepare('SELECT * FROM owned_drafts WHERE project=? AND document_id=? AND locale=?').bind(project, documentId, locale).first<Row>();
    return row ? ownedDraft(row) : null;
  }
  async getOwnedByJob(jobKey: string): Promise<OwnedDraft | null> {
    const row = await this.db.prepare('SELECT * FROM owned_drafts WHERE created_by_job=?').bind(jobKey).first<Row>();
    return row ? ownedDraft(row) : null;
  }
  async updateOwnedHash(project: string, documentId: string, locale: string, lastHash: string): Promise<void> {
    await this.db.prepare('UPDATE owned_drafts SET last_hash=?, updated_at=? WHERE project=? AND document_id=? AND locale=?')
      .bind(lastHash, new Date().toISOString(), project, documentId, locale).run();
  }
  close(): void {}
}
