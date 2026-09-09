import { createLegacyMcpHandler } from 'agents/mcp';
import type { AppConfig, ProjectConfig } from '../../src/types.js';
import { ContentService } from '../../src/service.js';
import { createMcpServer } from '../../src/mcp.js';
import { AppError } from '../../src/errors.js';
import { D1AuditStore } from './d1-audit.js';
import { boundedBody, checkOrigin, SerialQueue } from './request-security.js';

interface Env {
  DB: D1Database;
  COORDINATOR: DurableObjectNamespace;
  ASSETS: Fetcher;
  MCP_API_KEY: string;
  PROJECTS_JSON?: string;
  [key: string]: unknown;
}

async function tokensEqual(actual: string, expected: string): Promise<boolean> {
  const encode = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [left, right] = await Promise.all([encode(actual), encode(expected)]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function configFromEnv(env: Env): AppConfig {
  const raw = env.PROJECTS_JSON ?? '{"projects":{}}';
  const parsed = JSON.parse(raw) as AppConfig;
  if (!parsed.projects || typeof parsed.projects !== 'object') throw new AppError('CONFIG_ERROR', 'PROJECTS_JSON is invalid', undefined, 500);
  return parsed;
}

function resolveWorkerProject(env: Env, config: AppConfig, name: string): ProjectConfig & { token: string } {
  const project = config.projects[name];
  if (!project) throw new AppError('CONFIG_ERROR', `Unknown project: ${name}`);
  const token = env[project.tokenEnv];
  if (typeof token !== 'string' || !token) throw new AppError('TOKEN_MISSING', `Missing Worker secret: ${project.tokenEnv}`, undefined, 500);
  return { ...project, baseUrl: project.baseUrl.replace(/\/$/, ''), token };
}

export class McpCoordinator implements DurableObject {
  private readonly queue = new SerialQueue();

  constructor(private readonly _state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    return this.queue.run(async () => {
      const config = configFromEnv(this.env);
      const service = new ContentService(config, new D1AuditStore(this.env.DB), (appConfig, name) => resolveWorkerProject(this.env, appConfig, name));
      // The root and Worker packages resolve the same SDK version from separate
      // node_modules trees; the runtime contract is identical.
      const server = createMcpServer(service);
      try {
        const response = await createLegacyMcpHandler(server as never, { route: '/mcp', enableJsonResponse: true })(request, this.env, {} as ExecutionContext);
        // Consume the response before releasing the lock: SSE headers alone do
        // not imply that a tool operation has finished.
        return new Response(await response.arrayBuffer(), response);
      } finally { await server.close(); }
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'safe-strapi-mcp-worker' });
    if (url.pathname === '/ready') {
      try {
        await new D1AuditStore(env.DB).health();
        return Response.json({ ok: true });
      } catch { return Response.json({ ok: false }, { status: 503 }); }
    }
    if (url.pathname !== '/mcp') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return Response.json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Method not allowed' } }, { status: 405 });
    const header = request.headers.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (!env.MCP_API_KEY || env.MCP_API_KEY.length < 32 || !token || token.length > 4096 || !await tokensEqual(token, env.MCP_API_KEY)) {
      return Response.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing bearer token' } }, { status: 401 });
    }
    checkOrigin(request, typeof env.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS : '');
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new AppError('INVALID_REQUEST', 'Content-Type must be application/json', undefined, 415);
    }
    const body = await boundedBody(request);
    try { JSON.parse(new TextDecoder().decode(body)); }
    catch { throw new AppError('INVALID_REQUEST', 'Malformed JSON request', undefined, 400); }
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const forwarded = new Request(request.url, { method: 'POST', headers, body });
    const id = env.COORDINATOR.idFromName('global');
    const response = await env.COORDINATOR.get(id).fetch(forwarded);
    const secured = new Response(response.body, response);
    secured.headers.set('Cache-Control', 'no-store');
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    return secured;
    } catch (error) {
      return Response.json({ ok: false, error: {
        code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
        message: error instanceof AppError ? error.message : 'Internal server error',
      } }, { status: error instanceof AppError ? error.status : 500, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
  },
} satisfies ExportedHandler<Env>;
