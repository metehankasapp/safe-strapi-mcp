#!/usr/bin/env node
import { config as dotenv } from 'dotenv';
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { AuditStore } from './audit.js';
import { ContentService } from './service.js';
import { createMcpServer } from './mcp.js';
import { createHttpApp } from './http-app.js';
import { PostgresAuditStore } from './postgres-audit.js';
import { secretFromEnvironment } from './secrets.js';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'env-file': { type: 'string' }, 'project-root': { type: 'string' }, config: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    process.stdout.write('safe-strapi-mcp [--env-file /absolute/path/.env] [--project-root /absolute/path/strapi] [--config /absolute/path/projects.json]\nRuns locally over stdio. Set STRAPI_URL and STRAPI_API_TOKEN; no shared MCP access key is required.\n');
    return;
  }
  const envFile = values['env-file'] ?? process.env.DOTENV_CONFIG_PATH;
  const loaded = dotenv({ path: envFile ?? '.env', quiet: true });
  if (envFile && loaded.error) throw new Error('Cannot read the specified env file');
  if (values['project-root']) process.env.STRAPI_PROJECT_ROOT = resolve(values['project-root']);
  else if (envFile && !process.env.STRAPI_PROJECT_ROOT) process.env.STRAPI_PROJECT_ROOT = dirname(resolve(envFile));
  if (values.config) process.env.PROJECTS_CONFIG = resolve(values.config);
  if (!process.env.AUDIT_DB && process.env.STRAPI_PROJECT_ROOT) process.env.AUDIT_DB = resolve(process.env.STRAPI_PROJECT_ROOT, '.safe-strapi/audit.sqlite');
  const config = await loadConfig();
  // A Strapi .env may contain DATABASE_URL for the CMS itself. Never use
  // that database for MCP audit tables implicitly in local mode.
  const databaseUrl = secretFromEnvironment('MCP_DATABASE_URL')
    ?? ((process.env.TRANSPORT ?? 'stdio') === 'http' ? secretFromEnvironment('DATABASE_URL') : undefined);
  const audit = databaseUrl
    ? await PostgresAuditStore.connect(databaseUrl)
    : new AuditStore();
  const service = new ContentService(config, audit);
  const transportMode = process.env.TRANSPORT ?? 'stdio';

  if (transportMode === 'stdio') {
    await createMcpServer(service).connect(new StdioServerTransport());
    return;
  }

  if (transportMode !== 'http') throw new Error(`Unsupported TRANSPORT: ${transportMode}`);
  const apiKey = secretFromEnvironment('MCP_API_KEY');
  const hasOidc = Boolean(process.env.OIDC_ISSUER && process.env.OIDC_AUDIENCE && process.env.OIDC_JWKS_URI);
  if ((!apiKey || apiKey.length < 32) && !hasOidc) throw new Error('HTTP mode requires MCP_API_KEY or complete OIDC configuration');

  const app = createHttpApp(service, apiKey, process.env.REQUEST_BODY_LIMIT ?? '10mb');

  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '127.0.0.1';
  app.listen(port, host, () => process.stderr.write(`safe-strapi-mcp listening on http://${host}:${port}/mcp\n`));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
