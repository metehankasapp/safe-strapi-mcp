import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from './errors.js';

export interface Principal {
  subject: string;
  tenant: string;
  scopes: ReadonlySet<string>;
  projects: ReadonlySet<string> | '*';
  authentication: 'local' | 'api-key' | 'oidc';
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
