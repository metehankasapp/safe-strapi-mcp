import { resolve } from 'node:path';
import type { AppConfig, JsonObject, ProjectConfig } from './types.js';
import { AppError } from './errors.js';
import { describeContentType, population, readContentRegistry } from './content-types.js';

export async function localProject(env: NodeJS.ProcessEnv = process.env): Promise<AppConfig> {
  for (const key of ['STRAPI_ALLOW_IN_PLACE_EDITING', 'STRAPI_ALLOW_ENTRY_EDITING']) {
    if (env[key] && !['true', 'false'].includes(env[key]!)) throw new AppError('CONFIG_ERROR', `${key} must be true or false`);
  }
  const root = resolve(env.STRAPI_PROJECT_ROOT ?? '.');
  if (!env.STRAPI_URL) throw new AppError('CONFIG_ERROR', 'Set STRAPI_URL and a Strapi Content API token; point STRAPI_PROJECT_ROOT at your Strapi source.');
  const registry = await readContentRegistry(root);
  const pages: AppConfig['projects'] = {};
  const entries: AppConfig['projects'] = {};
  for (const [uid, schema] of Object.entries(registry.types)) {
    const name = uid.split('.')[1];
    if (env.STRAPI_CONTENT_TYPE && env.STRAPI_CONTENT_TYPE !== name && env.STRAPI_CONTENT_TYPE !== uid) continue;
    const type = describeContentType(uid, schema);
    const attributes = schema.attributes as Record<string, JsonObject>;
    const slug = env.STRAPI_SLUG_FIELD ?? Object.keys(attributes).find(key => attributes[key].type === 'uid') ?? (attributes.slug?.type === 'string' ? 'slug' : '');
    if (slug && !attributes[slug]) throw new AppError('CONFIG_ERROR', `STRAPI_SLUG_FIELD does not exist in ${name}: ${slug}`);
    const routeField = env.STRAPI_ROUTE_FIELD;
    if (routeField && !attributes[routeField]) throw new AppError('CONFIG_ERROR', `STRAPI_ROUTE_FIELD does not exist in ${name}: ${routeField}`);
    const project: ProjectConfig = {
      baseUrl: env.STRAPI_URL, tokenEnv: env.STRAPI_TOKEN_ENV ?? 'STRAPI_API_TOKEN',
      collection: type.endpoint.slice('/api/'.length), blocksField: '', slugField: slug,
      routeField, titleField: env.STRAPI_TITLE_FIELD ?? ['title', 'name'].find(key => attributes[key]?.type === 'string'),
      defaultLocale: env.STRAPI_LOCALE ?? 'en', schemaRoot: root, contentType: name,
      contentTypeSchema: schema, contentTypeSchemas: registry.types, componentSchemas: registry.components,
      allowInPlaceEditing: env.STRAPI_ALLOW_IN_PLACE_EDITING === 'true',
      allowEntryEditing: env.STRAPI_ALLOW_ENTRY_EDITING === 'true',
    };
    entries[name] = project;
    if (type.kind !== 'collectionType' || !type.draftAndPublish || !slug) continue;
    for (const [zone, definition] of Object.entries(attributes)) {
      if (definition.type !== 'dynamiczone' || (env.STRAPI_BLOCKS_FIELD && env.STRAPI_BLOCKS_FIELD !== zone)) continue;
      pages[`${name}:${zone}`] = { ...project, blocksField: zone, populate: population(schema, registry.components).toString() };
    }
  }
  const projects = { ...pages, ...entries };
  if (!Object.keys(projects).length) throw new AppError('CONFIG_ERROR', 'No content-type schemas found. STRAPI_PROJECT_ROOT must contain src/api, or use --config with contentTypeSchemas.');
  return { projects };
}
