import { AsyncLocalStorage } from 'node:async_hooks';
import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from './errors.js';

export interface Principal {
  subject: string;
  tenant: string;
  scopes: ReadonlySet<string>;
  projects: ReadonlySet<string> | '*';
  authentication: 'api-key' | 'oidc';
}

const context = new AsyncLocalStorage<Principal>();

export function runAsPrincipal<T>(principal: Principal, callback: () => T): T {
  return context.run(principal, callback);
}

export function requireScope(scope: 'mcp:read' | 'mcp:write'): void {
  const principal = context.getStore();
  if (!principal) return; // stdio is a trusted local process boundary
  if (!principal.scopes.has(scope)) throw new AppError('INSUFFICIENT_SCOPE', `Required scope is missing: ${scope}`, { required: scope }, 403);
}

export function canAccessProject(project: string): boolean {
  const principal = context.getStore();
  return !principal || principal.projects === '*' || principal.projects.has(project);
}

export function currentTenant(): string {
  return context.getStore()?.tenant ?? 'local';
}

export function requireProject(project: string): void {
  if (!canAccessProject(project)) throw new AppError('PROJECT_FORBIDDEN', 'Caller is not authorized for this Strapi project', { project }, 403);
}

function secureEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class Authenticator {
  private readonly jwks;

  constructor(private readonly config: {
    apiKey?: string;
    issuer?: string;
    audience?: string;
    jwksUri?: string;
  }) {
    if (config.apiKey && config.apiKey.length < 32) throw new AppError('CONFIG_ERROR', 'MCP_API_KEY must contain at least 32 characters', undefined, 500);
    if (config.issuer || config.audience || config.jwksUri) {
      if (!config.issuer || !config.audience || !config.jwksUri) {
        throw new AppError('CONFIG_ERROR', 'OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI must be configured together', undefined, 500);
      }
      this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
    }
    if (!config.apiKey && !this.jwks) throw new AppError('CONFIG_ERROR', 'Configure MCP_API_KEY or OIDC authentication', undefined, 500);
  }

  async authenticate(header: string | undefined): Promise<Principal> {
    if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHORIZED', 'Missing bearer token', undefined, 401);
    const token = header.slice(7);
    if (this.config.apiKey && secureEqual(token, this.config.apiKey)) {
      return { subject: 'legacy-api-key', tenant: 'legacy', scopes: new Set(['mcp:read', 'mcp:write']), projects: '*', authentication: 'api-key' };
    }
    if (!this.jwks || !this.config.issuer || !this.config.audience) throw new AppError('UNAUTHORIZED', 'Invalid bearer token', undefined, 401);
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.config.issuer, audience: this.config.audience });
      const scopes = new Set(typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : []);
      const projectsClaim = payload.projects;
      const projects = projectsClaim === '*' ? '*' : new Set(Array.isArray(projectsClaim) ? projectsClaim.filter((value): value is string => typeof value === 'string') : []);
      const tenant = typeof payload.tenant_id === 'string' ? payload.tenant_id : '';
      if (!tenant || !/^[a-zA-Z0-9_-]{1,100}$/.test(tenant)) throw new Error('Missing or invalid tenant_id claim');
      return { subject: payload.sub ?? 'unknown', tenant, scopes, projects, authentication: 'oidc' };
    } catch {
      throw new AppError('UNAUTHORIZED', 'Invalid or expired bearer token', undefined, 401);
    }
  }
}
