import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const baseUrl = process.argv[2];
if (!baseUrl) throw new Error('Usage: node scripts/remote-smoke.mjs <worker-url>');
const vars = Object.fromEntries((await readFile(new URL('../.dev.vars.generated', import.meta.url), 'utf8'))
  .trim().split(/\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const client = new Client({ name: 'safe-strapi-cloudflare-smoke', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${vars.MCP_API_KEY}` } },
});

try {
  const [health, ready, home, docs, security, status, unauthorized] = await Promise.all([
    fetch(`${baseUrl}/health`), fetch(`${baseUrl}/ready`), fetch(baseUrl), fetch(`${baseUrl}/docs`),
    fetch(`${baseUrl}/security`), fetch(`${baseUrl}/status`),
    fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  ]);
  if (![health, ready, home, docs, security, status].every((response) => response.ok) || unauthorized.status !== 401) {
    throw new Error(`HTTP smoke failed: ${[health.status, ready.status, home.status, docs.status, security.status, status.status, unauthorized.status].join(',')}`);
  }
  await client.connect(transport);
  const tools = await client.listTools();
  const projects = await client.callTool({ name: 'list_projects', arguments: {} });
  if (projects.isError || tools.tools.length !== 13) throw new Error('MCP protocol smoke failed');
  const headers = { Authorization: `Bearer ${vars.MCP_API_KEY}`, 'content-type': 'application/json' };
  const probes = [
    ['invalid-token', { headers: { ...headers, Authorization: 'Bearer invalid' }, body: '{}' }, 401, 'UNAUTHORIZED'],
    ['forbidden-origin', { headers: { ...headers, Origin: 'https://untrusted.example' }, body: '{}' }, 403, 'FORBIDDEN_ORIGIN'],
    ['invalid-json', { headers, body: '{' }, 400, 'INVALID_REQUEST'],
    ['wrong-content-type', { headers: { ...headers, 'content-type': 'text/plain' }, body: '{}' }, 415, 'INVALID_REQUEST'],
    ['streamed-body-limit', { headers, duplex: 'half', body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(2_000_001))); controller.close(); } }) }, 413, 'REQUEST_TOO_LARGE'],
  ];
  for (const [name, options, expectedStatus, expectedCode] of probes) {
    const response = await fetch(`${baseUrl}/mcp`, { method: 'POST', ...options });
    const body = await response.json();
    if (response.status !== expectedStatus || body.error?.code !== expectedCode) throw new Error(`Security probe failed: ${name} (${response.status})`);
  }
  const projectText = projects.content?.find(item => item.type === 'text')?.text;
  const projectList = projectText ? JSON.parse(projectText).data : null;
  process.stdout.write(JSON.stringify({ ok: true, health: true, ready: true, web: true, docs: true, security: true, status: true, unauthorized: true, toolCount: tools.tools.length, projectCount: Array.isArray(projectList) ? projectList.length : null, securityProbes: probes.length }, null, 2));
} finally {
  await client.close();
}
