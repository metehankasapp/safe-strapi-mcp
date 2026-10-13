import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { JsonObject, ProjectConfig } from './types.js';
import { AppError } from './errors.js';

export interface ContentType {
  uid: string;
  kind: 'collectionType' | 'singleType';
  endpoint: string;
  schema: JsonObject;
  localized: boolean;
  draftAndPublish: boolean;
}

export interface ContentRegistry {
  types: Record<string, JsonObject>;
  components: Record<string, JsonObject>;
  customFieldTypes?: Record<string, string>;
}

async function directories(path: string) {
  try { return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function readContentRegistry(root: string): Promise<ContentRegistry> {
  const registry: ContentRegistry = { types: {}, components: {} };
  for (const api of await directories(resolve(root, 'src/api'))) {
    for (const type of await directories(resolve(root, 'src/api', api.name, 'content-types'))) {
      const path = resolve(root, 'src/api', api.name, 'content-types', type.name, 'schema.json');
      try { registry.types[`api::${api.name}.${type.name}`] = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  for (const category of await directories(resolve(root, 'src/components'))) {
    for (const file of await readdir(resolve(root, 'src/components', category.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.json')) {
        registry.components[`${category.name}.${file.name.slice(0, -5)}`] = JSON.parse(await readFile(resolve(root, 'src/components', category.name, file.name), 'utf8'));
      }
    }
  }
  return registry;
}

export function describeContentType(uid: string, schema: JsonObject): ContentType {
  if (!/^api::[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(uid) || !['collectionType', 'singleType'].includes(String(schema.kind))) {
    throw new AppError('CONFIG_ERROR', `Unsupported content-type schema: ${uid}`);
  }
  const kind = schema.kind as ContentType['kind'];
  const info = schema.info as JsonObject;
  const name = kind === 'singleType' ? info?.singularName : info?.pluralName;
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name) || !schema.attributes) {
    throw new AppError('CONFIG_ERROR', `Content type has no valid API name or attributes: ${uid}`);
  }
  return { uid, kind, endpoint: `/api/${name}`, schema,
    localized: ((schema.pluginOptions as JsonObject | undefined)?.i18n as JsonObject | undefined)?.localized === true,
    draftAndPublish: (schema.options as JsonObject | undefined)?.draftAndPublish === true };
}

export async function registryFor(project: ProjectConfig): Promise<ContentRegistry> {
  // Source schemas must win over startup snapshots so schema drift invalidates previews.
  const source = project.schemaRoot ? await readContentRegistry(project.schemaRoot) : { types: {}, components: {} };
  const registry: ContentRegistry = {
    types: project.schemaRoot ? source.types : { ...project.contentTypeSchemas },
    components: project.schemaRoot ? source.components : { ...project.componentSchemas },
  };
  registry.customFieldTypes = project.customFieldTypes;
  if (project.contentTypeSchema && !project.schemaRoot) {
    const name = project.contentType ?? (project.contentTypeSchema.info as JsonObject)?.singularName;
    if (typeof name === 'string') {
      const uid = Object.keys(registry.types).find(key => key.split('.')[1] === name) ?? `api::${name}.${name}`;
      registry.types[uid] = project.contentTypeSchema;
    }
  }
  return registry;
}

export function population(schema: JsonObject, components: Record<string, JsonObject>): URLSearchParams {
  const params = new URLSearchParams();
  const visit = (attributes: JsonObject, prefix: string, ancestors: string[]) => {
    for (const [name, raw] of Object.entries(attributes)) {
      const field = raw as JsonObject;
      if (field.private === true || field.type === 'password') continue;
      const path = `${prefix}[${name}]`;
      if (field.type === 'media' || field.type === 'relation') params.set(path, 'true');
      const nested = (uid: string, key: string) => {
        if (!components[uid] || ancestors.includes(uid) || ancestors.length > 20) throw new AppError('CONFIG_ERROR', `Missing or recursive component schema: ${uid}`);
        params.set(`${key}[populate]`, '*');
        visit(components[uid].attributes as JsonObject, `${key}[populate]`, [...ancestors, uid]);
        if ([...params.keys()].some(k => k.startsWith(`${key}[populate][`))) params.delete(`${key}[populate]`);
      };
      if (field.type === 'component') nested(String(field.component), path);
      if (field.type === 'dynamiczone') for (const uid of field.components as string[]) nested(uid, `${path}[on][${uid}]`);
    }
  };
  visit(schema.attributes as JsonObject, 'populate', []);
  return params;
}
