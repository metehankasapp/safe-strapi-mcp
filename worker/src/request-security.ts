import { AppError } from '../../src/errors.js';

export async function boundedBody(request: Request, limit = 2_000_000): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = () => new AppError('REQUEST_TOO_LARGE', 'Request body exceeds 2 MB', undefined, 413);
  if (Number(request.headers.get('content-length')) > limit) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export function checkOrigin(request: Request, allowed = ''): void {
  const origin = request.headers.get('origin');
  if (origin && !allowed.split(',').map(value => value.trim()).filter(Boolean).includes(origin)) {
    throw new AppError('FORBIDDEN_ORIGIN', 'Request origin is not allowed', undefined, 403);
  }
}

// Bound queued work as well as keeping asynchronous operations serialized.
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending >= 32) throw new AppError('RATE_LIMITED', 'MCP capacity reached; retry later', undefined, 429);
    this.pending++;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); }
    finally { this.pending--; release(); }
  }
}
