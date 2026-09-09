import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AppConfig, ProjectConfig } from './types.js';
import { AppError } from './errors.js';
import { secretFromEnvironment } from './secrets.js';
import { localProject } from './local-project.js';

const projectSchema = z.object({
  baseUrl: z.string().url(),
  tokenEnv: z.string().min(1),
  collection: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  blocksField: z.string().min(1),
  slugField: z.string().min(1),
  titleField: z.string().min(1).optional(),
  populate: z.string().min(1).optional(),
  defaultLocale: z.string().min(1).optional(),
  schemaRoot: z.string().min(1).optional(),
  contentType: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
  componentSchemas: z.record(z.string(), z.record(z.unknown())).optional(),
  contentTypeSchema: z.record(z.unknown()).optional(),
});

const configSchema = z.object({
  projects: z.record(z.string().min(1), projectSchema),
});

export async function loadConfig(): Promise<AppConfig> {
  try {
    if (!process.env.PROJECTS_CONFIG && process.env.STRAPI_URL) return configSchema.parse(await localProject());
    const path = resolve(process.env.PROJECTS_CONFIG ?? './config/projects.json');
    return configSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    throw new AppError('CONFIG_ERROR', 'Invalid projects configuration', { cause: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export function resolveProject(config: AppConfig, name: string): ProjectConfig & { token: string } {
  const project = config.projects[name];
  if (!project) throw new AppError('CONFIG_ERROR', `Unknown project: ${name}`);
  const token = secretFromEnvironment(project.tokenEnv);
  if (!token) throw new AppError('TOKEN_MISSING', `Missing Strapi token environment variable: ${project.tokenEnv}`, undefined, 500);
  return { ...project, baseUrl: project.baseUrl.replace(/\/$/, ''), token };
}
