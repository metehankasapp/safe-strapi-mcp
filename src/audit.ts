import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import type { JsonObject } from './types.js';
import { AppError } from './errors.js';

export interface AuditRecord {
  idempotencyKey: string;
  status: 'pending' | 'completed' | 'failed';
  project: string;
  sourceDocumentId: string;
  cloneSlug: string;
  requestHash: string;
  intendedHash: string | null;
  request: JsonObject;
  result: JsonObject | null;
}

export interface OwnedDraft {
  project: string;
  documentId: string;
  locale: string;
  slug: string;
  sourceDocumentId: string;
  sourceHash: string;
  createdByJob: string;
  lastHash: string;
}

export interface AuditRepository {
  health(): void | Promise<void>;
  withLock?<T>(key: string, callback: () => Promise<T>): Promise<T>;
  get(key: string): AuditRecord | null | Promise<AuditRecord | null>;
  begin(input: { key: string; project: string; sourceDocumentId: string; cloneSlug: string; requestHash: string; intendedHash: string; request: unknown }): void | Promise<void>;
  complete(key: string, result: JsonObject): void | Promise<void>;
  fail(key: string, error: unknown): void | Promise<void>;
  recordOwned(input: OwnedDraft): void | Promise<void>;
  getOwned(project: string, documentId: string, locale: string): OwnedDraft | null | Promise<OwnedDraft | null>;
  getOwnedByJob(jobKey: string): OwnedDraft | null | Promise<OwnedDraft | null>;
  updateOwnedHash(project: string, documentId: string, locale: string, lastHash: string): void | Promise<void>;
  close(): void | Promise<void>;
}

export class AuditStore implements AuditRepository {
  private readonly db: Database.Database;

  constructor(path = process.env.AUDIT_DB ?? './data/audit.sqlite') {
    const absolute = resolve(path);
    mkdirSync(dirname(absolute), { recursive: true });
    this.db = new Database(absolute);
    chmodSync(absolute, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS operation_locks (
        lock_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        pid INTEGER NOT NULL,
        host TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_jobs (
        idempotency_key TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        project TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        clone_slug TEXT NOT NULL,
        request_json TEXT NOT NULL,
        request_hash TEXT NOT NULL DEFAULT '',
        intended_hash TEXT,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS owned_drafts (
        project TEXT NOT NULL,
        document_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        slug TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        created_by_job TEXT NOT NULL,
        last_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project, document_id, locale),
        UNIQUE (created_by_job),
        FOREIGN KEY (created_by_job) REFERENCES content_jobs(idempotency_key)
      );
    `);
    this.ensureColumn('content_jobs', 'request_hash', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('content_jobs', 'intended_hash', 'TEXT');
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  health(): void { this.db.prepare('SELECT 1').get(); }

  // SQLite is a single-host store. Never expire a live process's lock: a slow
  // REST request must not allow a second writer to enter the critical section.
  async withLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    const host = hostname();
    const acquire = this.db.transaction(() => {
      const row = this.db.prepare('SELECT owner, pid, host FROM operation_locks WHERE lock_key = ?').get(key) as { owner: string; pid: number; host: string } | undefined;
      if (row) {
        if (row.host !== host) return false;
        try { process.kill(row.pid, 0); return false; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false; }
        this.db.prepare('DELETE FROM operation_locks WHERE lock_key = ? AND owner = ?').run(key, row.owner);
      }
      this.db.prepare('INSERT INTO operation_locks (lock_key, owner, pid, host) VALUES (?, ?, ?, ?)').run(key, owner, process.pid, host);
      return true;
    });
    const deadline = Date.now() + 10_000;
    while (!acquire.immediate()) {
      if (Date.now() >= deadline) throw new AppError('OPERATION_BUSY', 'Another MCP process is operating on this resource; retry later', undefined, 409);
      await setTimeout(25);
    }
    try { return await callback(); }
    finally { this.db.prepare('DELETE FROM operation_locks WHERE lock_key = ? AND owner = ?').run(key, owner); }
  }

  get(key: string): AuditRecord | null {
    const row = this.db.prepare(`
      SELECT idempotency_key, status, project, source_document_id, clone_slug,
             request_hash, intended_hash, request_json, result_json
      FROM content_jobs WHERE idempotency_key = ?
    `).get(key) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      idempotencyKey: String(row.idempotency_key),
      status: row.status as AuditRecord['status'],
      project: String(row.project),
      sourceDocumentId: String(row.source_document_id),
      cloneSlug: String(row.clone_slug),
      requestHash: String(row.request_hash),
      intendedHash: row.intended_hash ? String(row.intended_hash) : null,
      request: JSON.parse(String(row.request_json)) as JsonObject,
      result: row.result_json ? JSON.parse(String(row.result_json)) as JsonObject : null,
    };
  }

  begin(input: {
    key: string;
    project: string;
    sourceDocumentId: string;
    cloneSlug: string;
    requestHash: string;
    intendedHash: string;
    request: unknown;
  }): void {
    const existing = this.get(input.key);
    if (existing && existing.requestHash !== input.requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different operation', {
        idempotencyKey: input.key,
        existingHash: existing.requestHash,
        receivedHash: input.requestHash,
      }, 409);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO content_jobs (
        idempotency_key, status, project, source_document_id, clone_slug,
        request_json, request_hash, intended_hash, created_at, updated_at
      ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        status = 'pending', error = NULL, updated_at = excluded.updated_at
      WHERE content_jobs.status = 'failed'
    `).run(
      input.key, input.project, input.sourceDocumentId, input.cloneSlug,
      JSON.stringify(input.request), input.requestHash, input.intendedHash, now, now,
    );
  }

  complete(key: string, result: JsonObject): void {
    this.db.prepare(`
      UPDATE content_jobs SET status = 'completed', result_json = ?, updated_at = ?
      WHERE idempotency_key = ?
    `).run(JSON.stringify(result), new Date().toISOString(), key);
  }

  fail(key: string, error: unknown): void {
    this.db.prepare(`
      UPDATE content_jobs SET status = 'failed', error = ?, updated_at = ?
      WHERE idempotency_key = ?
    `).run(error instanceof Error ? error.message : String(error), new Date().toISOString(), key);
  }

  recordOwned(input: OwnedDraft): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO owned_drafts (
        project, document_id, locale, slug, source_document_id, source_hash,
        created_by_job, last_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project, document_id, locale) DO UPDATE SET
        last_hash = excluded.last_hash, updated_at = excluded.updated_at
    `).run(
      input.project, input.documentId, input.locale, input.slug, input.sourceDocumentId,
      input.sourceHash, input.createdByJob, input.lastHash, now, now,
    );
  }

  getOwned(project: string, documentId: string, locale: string): OwnedDraft | null {
    const row = this.db.prepare(`
      SELECT project, document_id, locale, slug, source_document_id, source_hash, created_by_job, last_hash
      FROM owned_drafts WHERE project = ? AND document_id = ? AND locale = ?
    `).get(project, documentId, locale) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      project: String(row.project),
      documentId: String(row.document_id),
      locale: String(row.locale),
      slug: String(row.slug),
      sourceDocumentId: String(row.source_document_id),
      sourceHash: String(row.source_hash),
      createdByJob: String(row.created_by_job),
      lastHash: String(row.last_hash),
    };
  }

  getOwnedByJob(jobKey: string): OwnedDraft | null {
    const row = this.db.prepare(`
      SELECT project, document_id, locale, slug, source_document_id, source_hash, created_by_job, last_hash
      FROM owned_drafts WHERE created_by_job = ?
    `).get(jobKey) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      project: String(row.project),
      documentId: String(row.document_id),
      locale: String(row.locale),
      slug: String(row.slug),
      sourceDocumentId: String(row.source_document_id),
      sourceHash: String(row.source_hash),
      createdByJob: String(row.created_by_job),
      lastHash: String(row.last_hash),
    };
  }

  updateOwnedHash(project: string, documentId: string, locale: string, lastHash: string): void {
    this.db.prepare(`
      UPDATE owned_drafts SET last_hash = ?, updated_at = ?
      WHERE project = ? AND document_id = ? AND locale = ?
    `).run(lastHash, new Date().toISOString(), project, documentId, locale);
  }

  close(): void {
    this.db.close();
  }
}
