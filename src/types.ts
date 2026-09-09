export type JsonObject = Record<string, unknown>;

export interface ProjectConfig {
  baseUrl: string;
  tokenEnv: string;
  collection: string;
  blocksField: string;
  slugField: string;
  titleField?: string;
  populate?: string;
  defaultLocale?: string;
  schemaRoot?: string;
  contentType?: string;
  componentSchemas?: Record<string, JsonObject>;
  contentTypeSchema?: JsonObject;
}

export interface AppConfig {
  projects: Record<string, ProjectConfig>;
}

export type Selector = {
  index?: number;
  component?: string;
  occurrence?: number;
};

export type Position =
  | { start: true }
  | { end: true }
  | { before: Selector }
  | { after: Selector };

export type Operation =
  | { type: 'insert'; component: JsonObject; position: Position }
  | { type: 'patch'; selector: Selector; changes: JsonObject }
  | { type: 'move'; selector: Selector; position: Position }
  | { type: 'remove'; selector: Selector }
  | { type: 'duplicate'; selector: Selector; position: Position }
  | { type: 'replace'; selector: Selector; component: JsonObject };

export interface ChangeSummary {
  type: Operation['type'];
  component: string;
  from?: number;
  to?: number;
  changedPaths?: string[];
}
