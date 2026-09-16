interface Env {
  ASSETS: Fetcher;
}

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/ready') {
      return Response.json({ ok: true, service: 'safe-strapi-site' }, { headers });
    }
    if (url.pathname === '/mcp') {
      return Response.json({
        ok: false,
        error: {
          code: 'LOCAL_STDIO_ONLY',
          message: 'Safe Strapi runs locally over stdio. No hosted MCP endpoint or MCP API key is required.',
          setup: `${url.origin}/#master-prompt`,
        },
      }, { status: 410, headers });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
