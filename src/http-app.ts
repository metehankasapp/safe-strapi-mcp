import express, { type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ContentService } from './service.js';
import { createMcpServer } from './mcp.js';
import { AppError, toStructuredError } from './errors.js';
import { Authenticator, runAsPrincipal } from './auth.js';
import { rateLimit } from 'express-rate-limit';

export function createHttpApp(service: ContentService, apiKey?: string, bodyLimit = '10mb') {
  const authenticator = new Authenticator({
    apiKey,
    issuer: process.env.OIDC_ISSUER,
    audience: process.env.OIDC_AUDIENCE,
    jwksUri: process.env.OIDC_JWKS_URI,
  });
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, '');
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: bodyLimit }));
  app.get('/health', (_request, response) => response.json({ ok: true, service: 'safe-strapi-mcp' }));
  app.get('/ready', async (_request, response, next) => {
    try {
      await service.readiness();
      response.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_request, response) => {
    if (!publicUrl || !process.env.OIDC_ISSUER) return response.status(404).json({ ok: false, error: { code: 'CONFIG_ERROR', message: 'OIDC is not configured' } });
    return response.json({ resource: `${publicUrl}/mcp`, authorization_servers: [process.env.OIDC_ISSUER], scopes_supported: ['mcp:read', 'mcp:write'] });
  });
  const mcpRateLimit = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    limit: Number(process.env.RATE_LIMIT_MAX ?? 120),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many MCP requests' } }),
  });
  app.post('/mcp', mcpRateLimit, async (request, response, next) => {
    try {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
      const origin = request.header('origin');
      if (origin && !allowedOrigins.includes(origin)) {
        throw new AppError('FORBIDDEN_ORIGIN', 'Request origin is not allowed', { origin }, 403);
      }
      const principal = await authenticator.authenticate(request.header('authorization'));
      const server = createMcpServer(service);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
      await runAsPrincipal(principal, async () => {
        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
      });
    } catch (error) {
      next(error);
    }
  });
  app.all('/mcp', (_request, response) => response.status(405).json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Method not allowed' } }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const isTooLarge = error instanceof Error && (error as Error & { type?: string }).type === 'entity.too.large';
    const normalized = isTooLarge ? new AppError('REQUEST_TOO_LARGE', 'Request body exceeds configured limit', undefined, 413) : error;
    if (normalized instanceof AppError && normalized.status === 401 && publicUrl && process.env.OIDC_ISSUER) {
      response.setHeader('WWW-Authenticate', `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource/mcp"`);
    }
    response.status(normalized instanceof AppError ? normalized.status : 500).json({ ok: false, error: toStructuredError(normalized) });
  });
  return app;
}
