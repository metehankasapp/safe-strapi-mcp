# Website deployment

The Cloudflare Worker serves the static documentation, master prompt, and health endpoints. It does not host an MCP server, store Strapi credentials, or require secrets, D1, or Durable Objects.

```sh
npm install --prefix web
npm install --prefix worker
npm run build:cloudflare --prefix web
npm run deploy --prefix worker
```

Every push to `main` runs package, web, and Worker checks, then deploys when these repository settings exist:

- variable `CLOUDFLARE_ACCOUNT_ID`;
- variable `CLOUDFLARE_DEPLOY_ENABLED=true`;
- secret `CLOUDFLARE_API_TOKEN` scoped to deploy Workers.

The `/mcp` route returns an explicit local-stdio-only response so agents cannot mistake the website for a hosted MCP endpoint. Users run the published `safe-strapi-mcp` package locally from their own Strapi repository.
