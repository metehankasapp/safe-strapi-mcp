# Production deployment

## VPS-free Cloudflare deployment

`worker/` is the serverless deployment target. It uses D1 for audit/ownership state and a Durable Object to serialize write operations. The web application is exported as static Worker assets.

```sh
npm install --prefix worker
npm run build:cloudflare --prefix web
cd worker
npx wrangler d1 migrations apply safe-strapi --remote
npm run deploy
node scripts/remote-smoke.mjs https://safe-strapi-mcp.<account>.workers.dev
```

MCP and project credentials must be stored with `wrangler secret put`; never add them to `wrangler.jsonc`.

## Docker deployment

The repository deploys as two isolated containers behind Caddy:

- `/mcp`, `/health`, `/ready`: MCP service
- every other route: public web documentation

## Prerequisites

- A Linux host with Docker Compose
- A DNS A/AAAA record pointing `PUBLIC_DOMAIN` to the host
- Strapi 5 reachable from the host
- A Strapi read/create/update API token restricted to the required content type

## Configure

```sh
cp .env.example .env
cp config/projects.example.json config/projects.json
openssl rand -hex 32
```

For a private pilot, put the generated value in `MCP_API_KEY`. For shared production access, configure `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URI`, and leave `MCP_API_KEY` empty. Access tokens must contain a valid `tenant_id`, a `projects` array, and `mcp:read` and/or `mcp:write` scopes. Set `PUBLIC_DOMAIN`, configure the project URL, and set the Strapi token. Never commit `.env` or credentials.

## Start and verify

```sh
docker compose config
docker compose build
docker compose up -d
curl --fail "https://${PUBLIC_DOMAIN}/health"
```

Then run the protocol smoke test against the public endpoint with a non-production Strapi fixture project before connecting a live project.

## Scaling and authorization

`DATABASE_URL` enables the PostgreSQL audit/ownership registry. Ownership and idempotency records are tenant-namespaced, and PostgreSQL advisory locks serialize conflicting writes across replicas. The static bearer token is appropriate only for a controlled pilot; shared access must use OIDC/OAuth tokens.
