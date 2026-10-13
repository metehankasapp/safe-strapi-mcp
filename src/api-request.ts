import { AppError } from './errors.js';

export async function requestStrapi(project: { baseUrl: string; token: string }, path: string, init: RequestInit = {}): Promise<unknown> {
  if (!path.startsWith('/api/')) throw new AppError('INVALID_REQUEST', 'Only schema-derived Strapi Content API paths are supported');
  const base = new URL(project.baseUrl);
  if (base.username || base.password || base.search || base.hash) throw new AppError('CONFIG_ERROR', 'Strapi base URL must not contain credentials, query parameters or fragments');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${project.token}`);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${project.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new AppError('STRAPI_ERROR', 'Strapi connection failed; inspect the target before retrying a write', {
      status: null, retryable: false, writeOutcomeUnknown: Boolean(init.method && init.method !== 'GET'),
    }, 502);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok || body === null) {
    const server = response.headers.get('server');
    const contentType = response.headers.get('content-type');
    const upstreamBlocked = [401, 403].includes(response.status) && body === null;
    const apiError = body && typeof body === 'object' && 'error' in body ? (body as { error: unknown }).error : null;
    const errorMessage = apiError && typeof apiError === 'object' && 'message' in apiError && typeof apiError.message === 'string'
      ? apiError.message.split(project.token).join('[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1000) : null;
    throw new AppError('STRAPI_ERROR', upstreamBlocked
      ? `HTTP ${response.status}: upstream authentication/WAF blocked the API request; do not bypass it or switch to browser writes`
      : `Strapi request failed with status ${response.status}${body === null ? ' (non-JSON response)' : ''}`,
    { status: response.status, server, contentType, upstreamBlocked, validationMessage: errorMessage, retryable: false,
      writeOutcomeUnknown: Boolean(init.method && init.method !== 'GET' && (response.status >= 500 || response.ok && body === null)) }, 502);
  }
  return body;
}
