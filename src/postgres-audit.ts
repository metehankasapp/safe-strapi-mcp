import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { AppError } from './errors.js';
import type { AuditRecord, AuditRepository, OwnedDraft } from './audit.js';
import type { JsonObject } from './types.js';

function auditRecord(row: QueryResultRow): AuditRecord {
  return {
    idempotencyKey: String(row.idempotency_key),
    status: row.status as AuditRecord['status'],
    project: String(row.project),
    sourceDocumentId: String(row.source_document_id),
    cloneSlug: String(row.clone_slug),
    requestHash: String(row.request_hash),
    intendedHash: row.intended_hash ? String(row.intended_hash) : null,
    request: row.request_json as JsonObject,
    result: row.result_json as JsonObject | null,
  };
}

function ownedDraft(row: QueryResultRow): OwnedDraft {
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

export class PostgresAuditStore implements AuditRepository {
  private constructor(private readonly pool: Pool) {}

  static async connect(connectionString: string): Promise<PostgresAuditStore> {
    const pool = new Pool({ connectionString, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
    return PostgresAuditStore.fromPool(pool);
  }

  static async fromPool(pool: Pool): Promise<PostgresAuditStore> {
    const store = new PostgresAuditStore(pool);
    await store.migrate();
    return store;
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS content_jobs (
        idempotency_key TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
        project TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        clone_slug TEXT NOT NULL,
        request_json JSONB NOT NULL,
        request_hash TEXT NOT NULL,
        intended_hash TEXT,
        result_json JSONB,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS owned_drafts (
        project TEXT NOT NULL,
        document_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        slug TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        created_by_job TEXT NOT NULL UNIQUE REFERENCES content_jobs(idempotency_key),
        last_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (project, document_id, locale)
      );
      CREATE INDEX IF NOT EXISTS owned_drafts_source_idx ON owned_drafts(project, source_document_id, locale);
    `);
  }

  async health(): Promise<void> { await this.pool.query('SELECT 1'); }

  async withLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
      return await callback();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      } finally {
        client.release();
      }
    }
  }

  async get(key: string): Promise<AuditRecord | null> {
    const result = await this.pool.query('SELECT * FROM content_jobs WHERE idempotency_key = $1', [key]);
    return result.rows[0] ? auditRecord(result.rows[0]) : null;
  }

  async begin(input: { key: string; project: string; sourceDocumentId: string; cloneSlug: string; requestHash: string; intendedHash: string; request: unknown }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT request_hash FROM content_jobs WHERE idempotency_key = $1 FOR UPDATE', [input.key]);
      if (existing.rows[0] && existing.rows[0].request_hash !== input.requestHash) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different operation', {
          idempotencyKey: input.key,
          existingHash: existing.rows[0].request_hash,
          receivedHash: input.requestHash,
        }, 409);
      }
      await client.query(`
        INSERT INTO content_jobs (idempotency_key, status, project, source_document_id, clone_slug, request_json, request_hash, intended_hash)
        VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7)
        ON CONFLICT (idempotency_key) DO UPDATE SET status = 'pending', error = NULL, updated_at = NOW()
        WHERE content_jobs.status = 'failed'
      `, [input.key, input.project, input.sourceDocumentId, input.cloneSlug, input.request, input.requestHash, input.intendedHash]);
      await client.query('COMMIT');
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async rollback(client: PoolClient): Promise<void> {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
  }

  async complete(key: string, result: JsonObject): Promise<void> {
    await this.pool.query("UPDATE content_jobs SET status = 'completed', result_json = $1, updated_at = NOW() WHERE idempotency_key = $2", [result, key]);
  }

  async fail(key: string, error: unknown): Promise<void> {
    await this.pool.query("UPDATE content_jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE idempotency_key = $2", [error instanceof Error ? error.message : String(error), key]);
  }

  async recordOwned(input: OwnedDraft): Promise<void> {
    await this.pool.query(`
      INSERT INTO owned_drafts (project, document_id, locale, slug, source_document_id, source_hash, created_by_job, last_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (project, document_id, locale) DO UPDATE SET last_hash = EXCLUDED.last_hash, updated_at = NOW()
    `, [input.project, input.documentId, input.locale, input.slug, input.sourceDocumentId, input.sourceHash, input.createdByJob, input.lastHash]);
  }

  async getOwned(project: string, documentId: string, locale: string): Promise<OwnedDraft | null> {
    const result = await this.pool.query('SELECT * FROM owned_drafts WHERE project = $1 AND document_id = $2 AND locale = $3', [project, documentId, locale]);
    return result.rows[0] ? ownedDraft(result.rows[0]) : null;
  }

  async getOwnedByJob(jobKey: string): Promise<OwnedDraft | null> {
    const result = await this.pool.query('SELECT * FROM owned_drafts WHERE created_by_job = $1', [jobKey]);
    return result.rows[0] ? ownedDraft(result.rows[0]) : null;
  }

  async updateOwnedHash(project: string, documentId: string, locale: string, lastHash: string): Promise<void> {
    await this.pool.query('UPDATE owned_drafts SET last_hash = $1, updated_at = NOW() WHERE project = $2 AND document_id = $3 AND locale = $4', [lastHash, project, documentId, locale]);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
