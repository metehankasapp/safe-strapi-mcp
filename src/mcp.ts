import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ContentService } from './service.js';
import { toStructuredError } from './errors.js';
import { requireScope } from './auth.js';
import { previewDataSchema } from './preview.js';

const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue),
]));
const jsonObject = z.record(jsonValue);

const selector = z.object({
  index: z.number().int().nonnegative().optional(),
  component: z.string().min(1).optional(),
  occurrence: z.number().int().nonnegative().optional(),
}).refine((value) => (value.index !== undefined) !== (value.component !== undefined), {
  message: 'Selector requires exactly one of index or component',
});

const position = z.union([
  z.object({ start: z.literal(true) }),
  z.object({ end: z.literal(true) }),
  z.object({ before: selector }),
  z.object({ after: selector }),
]);

const operation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('insert'), component: jsonObject, position }),
  z.object({ type: z.literal('patch'), selector, changes: jsonObject }),
  z.object({ type: z.literal('move'), selector, position }),
  z.object({ type: z.literal('remove'), selector }),
  z.object({ type: z.literal('duplicate'), selector, position }),
  z.object({ type: z.literal('replace'), selector, component: jsonObject }),
]);

const cloneInput = {
  project: z.string().min(1),
  sourceDocumentId: z.string().min(1).optional(),
  sourceSlug: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
  expectedSourceHash: z.string().length(64).optional(),
  cloneSlug: z.string().min(1).optional(),
  titleSuffix: z.string().max(100).optional(),
  operations: z.array(operation).max(100),
};

const inPlaceInput = {
  project: z.string().min(1),
  documentId: z.string().min(1),
  locale: z.string().min(1).optional(),
  operations: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('insert'), component: jsonObject, position }).strict(),
    z.object({ type: z.literal('patch'), selector, changes: jsonObject }).strict(),
  ])).min(1).max(100),
};

const rollbackInput = {
  project: z.string().min(1),
  documentId: z.string().min(1),
  locale: z.string().min(1).optional(),
  operationId: z.string().min(8).max(200),
};

const draftWriteInput = {
  expectedPageHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedOperationHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().min(8).max(200),
};

const previewOutput = { ok: z.boolean(), data: previewDataSchema.optional(),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).optional() };

function response(value: unknown) {
  const structuredContent = { ok: true, data: value };
  return { structuredContent, content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }] };
}

function errorResponse(error: unknown) {
  const structuredContent = { ok: false, error: toStructuredError(error) };
  return {
    isError: true,
    structuredContent,
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
  };
}

async function safe<T>(scope: 'mcp:read' | 'mcp:write', callback: () => Promise<T> | T) {
  try {
    requireScope(scope);
    return response(await callback());
  } catch (error) {
    return errorResponse(error);
  }
}

export function createMcpServer(service: ContentService): McpServer {
  const server = new McpServer({ name: 'safe-strapi-mcp', version: '0.1.0' });

  server.registerTool('list_projects', {
    description: 'List configured Strapi projects. Never exposes API tokens.',
    inputSchema: {},
  }, async () => safe('mcp:read', () => service.listProjects()));

  server.registerTool('preview_modify_page', {
    description: 'Preview patch/insert operations on an existing page draft without cloning or writing to Strapi. Returns contractVersion 1 with target, summary, changes, fieldChanges (before/after), safety, revision and nextAction. Present these fields consistently and obtain user approval before writing. Requires project opt-in. Preserves components and IDs; array replacement, clearing fields and changing existing media/relations are blocked.',
    inputSchema: inPlaceInput,
    outputSchema: previewOutput,
  }, async (args) => safe('mcp:read', () => service.previewModifyPage(args)));

  server.registerTool('modify_page', {
    description: 'Apply a persisted preview to an existing page draft without cloning or publishing. Requires project opt-in, both preview hashes and an idempotency key. Only patch/insert are supported. Verifies preserved component IDs and content after re-fetch. REST revision checks cannot prevent an external edit racing the final write.',
    inputSchema: { ...inPlaceInput, ...draftWriteInput },
  }, async (args) => safe('mcp:write', () => service.modifyPage(args)));

  server.registerTool('list_page_operations', {
    description: 'List local patch/insert and rollback operation IDs for one project, document and locale. No page snapshots or credentials are returned. rollbackSupported indicates operation eligibility, not that the current revision permits rollback.',
    inputSchema: { project: z.string().min(1), documentId: z.string().min(1),
      locale: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).default(20) },
  }, async (args) => safe('mcp:read', () => service.listPageOperations(args.project, args.documentId, args.locale, args.limit)));

  server.registerTool('preview_rollback_page', {
    description: 'Preview restoring recorded field values for a completed patch-only operation. Returns the same versioned preview contract as preview_modify_page. Requires opt-in and the exact post-operation page revision. Refuses later edits, uncertain writes and operations containing insert; never removes components. Show before/after values and obtain explicit approval before rollback_page.',
    inputSchema: rollbackInput,
    outputSchema: previewOutput,
  }, async (args) => safe('mcp:read', () => service.previewRollbackPage(args)));

  server.registerTool('rollback_page', {
    description: 'Apply a persisted rollback preview with both preview hashes and a new idempotency key. Restores only verified recorded field values on the same draft, including previously empty values. Preserves component identities, media and relations. Never publishes or deletes components. Refuses changed revisions; uncertain responses are reconciled without another write. REST checks are not atomic.',
    inputSchema: { ...rollbackInput, ...draftWriteInput },
  }, async (args) => safe('mcp:write', () => service.rollbackPage(args)));

  server.registerTool('find_pages', {
    description: 'Find draft-visible pages by title or slug before inspecting one.',
    inputSchema: {
      project: z.string().min(1),
      search: z.string().optional(),
      locale: z.string().optional(),
      pageSize: z.number().int().min(1).max(100).default(20),
    },
  }, async (args) => safe('mcp:read', () => service.listPages(args.project, args.search, args.locale, args.pageSize)));

  server.registerTool('list_components', {
    description: 'List component UIDs available in a project schema. Use before composing content.',
    inputSchema: { project: z.string().min(1) },
  }, async (args) => safe('mcp:read', () => service.listComponents(args.project)));

  server.registerTool('get_component_schema', {
    description: 'Get the exact Strapi schema and configurable fields for one component UID.',
    inputSchema: { project: z.string().min(1), uid: z.string().min(3) },
  }, async (args) => safe('mcp:read', () => service.componentSchema(args.project, args.uid)));

  server.registerTool('inspect_page', {
    description: 'Read a complete source page and return ordered components plus a revision hash. This never writes.',
    inputSchema: {
      project: z.string().min(1),
      documentId: z.string().min(1).optional(),
      slug: z.string().min(1).optional(),
      locale: z.string().min(1).optional(),
    },
  }, async (args) => safe('mcp:read', () => service.inspect(args.project, args.documentId, args.slug, args.locale)));

  server.registerTool('inspect_owned_draft', {
    description: 'Inspect a draft only if this MCP service created and owns it.',
    inputSchema: {
      project: z.string().min(1),
      documentId: z.string().min(1),
      locale: z.string().min(1).optional(),
    },
  }, async (args) => safe('mcp:read', () => service.inspectOwnedDraft(args.project, args.documentId, args.locale)));

  server.registerTool('preview_clone_and_modify', {
    description: 'Validate component operations and preview their ordered diff using contractVersion 1: target, summary, changes, fieldChanges, safety, revision and nextAction. Show the preview consistently and obtain approval before writing. Never writes to Strapi.',
    inputSchema: cloneInput,
    outputSchema: previewOutput,
  }, async (args) => safe('mcp:read', () => service.preview(args)));

  server.registerTool('clone_page_and_modify', {
    description: 'Clone a source page into a new draft and apply validated component operations with revision checks and post-write verification. Never updates, deletes, or publishes the source. Always preview first and pass its source hash.',
    inputSchema: {
      ...cloneInput,
      expectedSourceHash: z.string().length(64),
      idempotencyKey: z.string().min(8).max(200).describe('Stable unique operation identifier, e.g. project:task:revision'),
    },
  }, async (args) => safe('mcp:write', () => service.cloneAndModify(args)));

  server.registerTool('modify_owned_draft', {
    description: 'Modify only a draft previously created by this MCP service. Requires the latest draft hash and never modifies the source.',
    inputSchema: {
      project: z.string().min(1),
      documentId: z.string().min(1),
      locale: z.string().min(1).optional(),
      expectedDraftHash: z.string().length(64),
      idempotencyKey: z.string().min(8).max(200),
      operations: z.array(operation).min(1).max(100),
    },
  }, async (args) => safe('mcp:write', () => service.modifyOwnedDraft(args)));

  const ownedWriteBase = {
    project: z.string().min(1),
    documentId: z.string().min(1),
    locale: z.string().min(1).optional(),
    expectedDraftHash: z.string().length(64),
    idempotencyKey: z.string().min(8).max(200),
  };

  server.registerTool('duplicate_component', {
    description: 'Duplicate one component inside an owned draft. New component IDs are generated by Strapi.',
    inputSchema: { ...ownedWriteBase, selector, position },
  }, async (args) => safe('mcp:write', () => service.modifyOwnedDraft({
    ...args,
    operations: [{ type: 'duplicate', selector: args.selector, position: args.position }],
  })));

  server.registerTool('replace_component', {
    description: 'Replace one component inside an owned draft while preserving every other component.',
    inputSchema: { ...ownedWriteBase, selector, component: jsonObject },
  }, async (args) => safe('mcp:write', () => service.modifyOwnedDraft({
    ...args,
    operations: [{ type: 'replace', selector: args.selector, component: args.component }],
  })));

  server.registerTool('validate_draft', {
    description: 'Validate an owned draft against local component schemas and verify its source is unchanged.',
    inputSchema: {
      project: z.string().min(1),
      documentId: z.string().min(1),
      locale: z.string().min(1).optional(),
    },
  }, async (args) => safe('mcp:read', () => service.validateDraft(args.project, args.documentId, args.locale)));

  server.registerTool('compare_pages', {
    description: 'Compare two pages field-by-field after removing Strapi system identifiers.',
    inputSchema: {
      project: z.string().min(1),
      leftDocumentId: z.string().min(1),
      rightDocumentId: z.string().min(1),
      locale: z.string().min(1).optional(),
    },
  }, async (args) => safe('mcp:read', () => service.comparePages(args.project, args.leftDocumentId, args.rightDocumentId, args.locale)));

  return server;
}
