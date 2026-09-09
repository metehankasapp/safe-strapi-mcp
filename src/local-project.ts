import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppConfig, JsonObject } from './types.js';
import { AppError } from './errors.js';

export async function localProject(env: NodeJS.ProcessEnv = process.env): Promise<AppConfig> {
  const root = resolve(env.STRAPI_PROJECT_ROOT ?? '.');
  if (!env.STRAPI_URL) throw new AppError('CONFIG_ERROR', 'Set STRAPI_URL and STRAPI_API_TOKEN in your environment or use --env-file. Set STRAPI_PROJECT_ROOT to your Strapi source directory.');
  const components: Record<string, JsonObject> = {};
  const componentRoot = resolve(root, 'src/components');
  const categories = await readdir(componentRoot, { withFileTypes: true }).catch(() => []);
  for (const category of categories.filter(item => item.isDirectory())) {
    for (const file of await readdir(resolve(componentRoot, category.name))) {
      if (file.endsWith('.json')) components[`${category.name}.${file.slice(0, -5)}`] = JSON.parse(await readFile(resolve(componentRoot, category.name, file), 'utf8'));
    }
  }
  const projects: AppConfig['projects'] = {};
  const apiRoot = resolve(root, 'src/api');
  const apis = await readdir(apiRoot, { withFileTypes: true }).catch(() => []);
  for (const api of apis.filter(item => item.isDirectory())) {
    const typesRoot = resolve(apiRoot, api.name, 'content-types');
    const types = await readdir(typesRoot, { withFileTypes: true }).catch(() => []);
    for (const type of types.filter(item => item.isDirectory())) {
      const schema = JSON.parse(await readFile(resolve(typesRoot, type.name, 'schema.json'), 'utf8'));
      if (schema.kind !== 'collectionType' || schema.options?.draftAndPublish !== true) continue;
      if (env.STRAPI_CONTENT_TYPE && env.STRAPI_CONTENT_TYPE !== type.name) continue;
      const attributes = schema.attributes as Record<string, JsonObject>;
      const slug = env.STRAPI_SLUG_FIELD ?? Object.keys(attributes).find(key => attributes[key].type === 'uid');
      if (!slug || !attributes[slug]) continue;
      for (const [zone, definition] of Object.entries(attributes)) {
        if (definition.type !== 'dynamiczone' || (env.STRAPI_BLOCKS_FIELD && env.STRAPI_BLOCKS_FIELD !== zone)) continue;
        const params = new URLSearchParams();
        const populate = (attrs: Record<string, JsonObject>, prefix: string, ancestors: string[] = []) => {
          for (const [name, attribute] of Object.entries(attrs)) {
            const key = `${prefix}[${name}]`;
            if (attribute.type === 'media' || attribute.type === 'relation') params.set(key, 'true');
            const nested = (uid: string, path: string) => {
              if (ancestors.includes(uid) || !components[uid]) throw new AppError('CONFIG_ERROR', `Missing or recursive component schema: ${uid}`);
              params.set(`${path}[populate]`, '*');
              populate(components[uid].attributes as Record<string, JsonObject>, `${path}[populate]`, [...ancestors, uid]);
              // Explicit nested population replaces the wildcard when present.
              if ([...params.keys()].some(k => k.startsWith(`${path}[populate][`))) params.delete(`${path}[populate]`);
            };
            if (attribute.type === 'component') nested(String(attribute.component), key);
            if (attribute.type === 'dynamiczone') for (const uid of attribute.components as string[]) nested(uid, `${key}[on][${uid}]`);
          }
        };
        populate(attributes, 'populate');
        const title = env.STRAPI_TITLE_FIELD ?? ['title', 'name'].find(key => attributes[key]?.type === 'string');
        projects[`${type.name}:${zone}`] = {
          baseUrl: env.STRAPI_URL, tokenEnv: env.STRAPI_TOKEN_ENV ?? 'STRAPI_API_TOKEN',
          collection: schema.info.pluralName, blocksField: zone, slugField: slug,
          titleField: title, defaultLocale: env.STRAPI_LOCALE ?? 'en',
          contentType: type.name, contentTypeSchema: schema, componentSchemas: components,
          populate: params.toString(),
        };
      }
    }
  }
  if (!Object.keys(projects).length) throw new AppError('CONFIG_ERROR', 'No supported content types found. STRAPI_PROJECT_ROOT must contain src/api and src/components. Use collection types with Draft & Publish, a UID field, and a dynamic zone; or provide PROJECTS_CONFIG with embedded schemas.');
  return { projects };
}
