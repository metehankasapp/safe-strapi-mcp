#!/usr/bin/env node
import { config as dotenv } from 'dotenv';
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { AuditStore } from './audit.js';
import { ContentService } from './service.js';
import { createMcpServer } from './mcp.js';

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
  const service = new ContentService(config, new AuditStore());
  await createMcpServer(service).connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
