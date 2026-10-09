import type { JsonObject } from './types.js';
import { z } from 'zod';

export const REST_CONCURRENCY = 'REST revision checks; external writes are not atomic';

export const previewDataSchema = z.object({
  contractVersion: z.literal('1'), kind: z.literal('preview'),
  action: z.enum(['clone_page_and_modify', 'modify_page', 'rollback_page']),
  target: z.object({ project: z.string(), documentId: z.string(), locale: z.string(),
    status: z.literal('draft'), blocksField: z.string(), operationId: z.string().nullable() }),
  summary: z.object({ beforeCount: z.number().int().nonnegative(), afterCount: z.number().int().nonnegative(),
    changeCount: z.number().int().nonnegative() }),
  changes: z.array(z.unknown()),
  fieldChanges: z.array(z.object({ path: z.string(), before: z.unknown(), after: z.unknown(),
    beforeExists: z.boolean(), afterExists: z.boolean() })).max(500),
  fieldChangesTruncated: z.boolean(),
  safety: z.object({ writesDuringPreview: z.literal(false), publishes: z.literal(false), sourcePreserved: z.boolean(),
    componentRemovalAllowed: z.boolean(), rollbackSupported: z.boolean(),
    concurrency: z.literal('rest_revision_checks'), atomic: z.literal(false) }),
  revision: z.object({ pageHash: z.string().regex(/^[a-f0-9]{64}$/), operationHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  nextAction: z.object({ tool: z.enum(['clone_page_and_modify', 'modify_page', 'rollback_page']),
    requiresUserApproval: z.literal(true), requiresIdempotencyKey: z.literal(true) }),
}).passthrough();

/** Stable, language-neutral fields for clients; human wording belongs to the AI. */
export function previewContract(input: {
  action: 'clone_page_and_modify' | 'modify_page' | 'rollback_page';
  project: string;
  documentId: string;
  locale: string;
  blocksField: string;
  beforeCount: number;
  afterCount: number;
  changes: unknown[];
  differences: JsonObject[];
  pageHash: string;
  operationHash: string;
  rollbackSupported: boolean;
  operationId?: string;
}): JsonObject {
  return previewDataSchema.parse({
    contractVersion: '1', kind: 'preview', action: input.action,
    target: { project: input.project, documentId: input.documentId, locale: input.locale,
      status: 'draft', blocksField: input.blocksField, operationId: input.operationId ?? null },
    summary: { beforeCount: input.beforeCount, afterCount: input.afterCount, changeCount: input.changes.length },
    changes: input.changes,
    fieldChanges: input.differences.map(({ path, left, right }) => ({ path, before: left ?? null, after: right ?? null,
      beforeExists: left !== undefined, afterExists: right !== undefined })),
    fieldChangesTruncated: input.differences.length >= 500,
    safety: { writesDuringPreview: false, publishes: false,
      sourcePreserved: input.action === 'clone_page_and_modify',
      componentRemovalAllowed: input.action === 'clone_page_and_modify',
      rollbackSupported: input.rollbackSupported, concurrency: 'rest_revision_checks', atomic: false },
    revision: { pageHash: input.pageHash, operationHash: input.operationHash },
    nextAction: { tool: input.action, requiresUserApproval: true, requiresIdempotencyKey: true },
  });
}
