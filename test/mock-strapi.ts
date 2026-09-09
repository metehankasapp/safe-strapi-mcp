import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { JsonObject } from '../src/types.js';

function copy<T>(value: T): T {
  return structuredClone(value);
}

export interface MockStrapi {
  baseUrl: string;
  documents: Map<string, JsonObject>;
  requests: Array<{ method: string; path: string }>;
  setCorruptNextWrite(value: boolean): void;
  setMutateSourceAfterWrite(value: boolean): void;
  setDropNextWriteResponse(value: boolean): void;
  close(): Promise<void>;
}

export async function startMockStrapi(source: JsonObject): Promise<MockStrapi> {
  const documents = new Map<string, JsonObject>([[String(source.documentId), copy(source)]]);
  const requests: Array<{ method: string; path: string }> = [];
  let sequence = 0;
  let corruptNextWrite = false;
  let mutateSourceAfterWrite = false;
  let dropNextWriteResponse = false;

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requests.push({ method: request.method ?? 'GET', path: `${url.pathname}${url.search}` });
    response.setHeader('content-type', 'application/json');
    const match = url.pathname.match(/^\/api\/pages\/([^/]+)$/);

    if (request.method === 'GET' && match) {
      const document = documents.get(decodeURIComponent(match[1]));
      response.statusCode = document ? 200 : 404;
      response.end(JSON.stringify(document ? { data: copy(document) } : { error: { message: 'Not found' } }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/pages') {
      const slug = url.searchParams.get('filters[slug][$eq]');
      const data = [...documents.values()].filter((item) => !slug || item.slug === slug);
      response.end(JSON.stringify({ data: copy(data) }));
      return;
    }

    if ((request.method === 'POST' || request.method === 'PUT') && (url.pathname === '/api/pages' || match)) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data: JsonObject };
      const documentId = request.method === 'POST' ? `owned-${++sequence}` : decodeURIComponent(String(match?.[1]));
      const stored: JsonObject = {
        ...(request.method === 'PUT' ? copy(documents.get(documentId) ?? {}) : {}),
        ...copy(parsed.data),
        documentId,
        id: 1000 + sequence,
        publishedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: `2026-01-01T00:00:0${sequence}.000Z`,
        locale: url.searchParams.get('locale') ?? 'en',
      };
      if (corruptNextWrite) {
        stored.title = 'CORRUPTED';
        corruptNextWrite = false;
      }
      documents.set(documentId, stored);
      if (mutateSourceAfterWrite) {
        const sourceId = String(source.documentId);
        const current = documents.get(sourceId);
        if (current) documents.set(sourceId, { ...current, updatedAt: '2026-01-02T00:00:00.000Z' });
        mutateSourceAfterWrite = false;
      }
      if (dropNextWriteResponse) {
        dropNextWriteResponse = false;
        response.destroy();
      } else response.end(JSON.stringify({ data: copy(stored) }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: 'Unhandled mock route' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    documents,
    requests,
    setCorruptNextWrite: (value) => { corruptNextWrite = value; },
    setMutateSourceAfterWrite: (value) => { mutateSourceAfterWrite = value; },
    setDropNextWriteResponse: (value) => { dropNextWriteResponse = value; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
