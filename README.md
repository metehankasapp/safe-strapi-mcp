# Safe Strapi MCP

[![CI](https://github.com/metehankasapp/safe-strapi-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/metehankasapp/safe-strapi-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/safe-strapi-mcp.svg)](https://www.npmjs.com/package/safe-strapi-mcp)
[![license](https://img.shields.io/npm/l/safe-strapi-mcp.svg)](LICENSE)

Run content operations against your own Strapi 5 installation from a local MCP client. The service creates draft copies, applies ordered component changes, and verifies the result and source hash. It does not publish pages.

## Install

Requires Node.js 22.5 or newer. SQLite may need native build tools on platforms without prebuilt binaries.

```sh
npm install --global safe-strapi-mcp
safe-strapi-mcp --help
```

You can also run it without a global install using `npx safe-strapi-mcp`.

## Configure your project

### 1. Create a Strapi API token

In Strapi Admin, open **Settings → Global settings → API Tokens → Create new API Token**. Choose **Custom** and grant only:

- `find` and `findOne` for every collection the page populates, including related content;
- `find` and `findOne` for Upload/media when the page contains assets;
- `create` and `update` for the collection types whose drafts the MCP may create.

`delete` and publish permissions are not required. Save the token when Strapi displays it; Strapi does not show the full value again. A token that can list pages but cannot read populated relations or media may fail during `inspect_page` with HTTP 403.

### 2. Store it locally

Create a private env file outside version control:

```dotenv
STRAPI_URL=http://localhost:1337
STRAPI_API_TOKEN=
```

Paste the token after `STRAPI_API_TOKEN=`. Use the Strapi origin for `STRAPI_URL`, without `/admin` or `/api`. Never commit this file or paste the token into chat. No hosted account or MCP access key is needed for stdio.

Add the local state and env file to the Strapi project's `.gitignore`:

```gitignore
.env.safe-strapi
.safe-strapi/
```

### 3. Connect your MCP client

Configure your MCP client to run:

```sh
safe-strapi-mcp --env-file /absolute/path/strapi/.env --project-root /absolute/path/strapi
```

Codex CLI can register the published package directly:

```sh
codex mcp add safe-strapi -- \
  npm exec --yes --package=safe-strapi-mcp -- safe-strapi-mcp \
  --env-file /absolute/path/strapi/.env.safe-strapi \
  --project-root /absolute/path/strapi
```

Restart Codex, then begin with a read-only request: `Use safe-strapi. List projects, find the homepage, and inspect it. Do not create or update anything.` Only continue to preview after this succeeds.

Use the absolute executable path if your desktop client does not inherit your shell PATH. The tool loads the env file directly; do not paste secrets into chat. Environment variables already present in the process take precedence over the file.

The source directory must contain `src/api` and `src/components`. Collection types with Draft & Publish, a UID field, and dynamic zones are discovered automatically. Each zone is named `content-type:zone` in `list_projects`. Single types are not supported by automatic setup.

Optional env variables: `STRAPI_CONTENT_TYPE`, `STRAPI_BLOCKS_FIELD`, `STRAPI_SLUG_FIELD`, `STRAPI_ROUTE_FIELD`, `STRAPI_TITLE_FIELD`, `STRAPI_LOCALE` (defaults to `en`). Set `STRAPI_ROUTE_FIELD=url` only when the frontend routes by a separate top-level field that must track cloned slugs. The field must exist in the content-type schema and be string-like; preview reports the change explicitly. Set `STRAPI_TOKEN_ENV=MY_EXISTING_TOKEN` to read a differently named token variable. Use HTTPS for remote CMS connections.

Only a remote URL and token? Obtain the schema source from the project owner, or pass `--config /absolute/path/projects.json` with this structure:

```json
{
  "projects": {
    "my-site": {
      "baseUrl": "https://cms.example.com",
      "tokenEnv": "STRAPI_API_TOKEN",
      "collection": "pages",
      "blocksField": "blocks",
      "slugField": "slug",
      "routeField": "url",
      "titleField": "title",
      "schemaRoot": "/absolute/path/strapi",
      "contentType": "page",
      "populate": "*"
    }
  }
}
```

For custom config, populate must include every nested component, media and relation required for the full document. Embedded `componentSchemas` (UID to schema object) and `contentTypeSchema` can replace source files. Automatic local setup generates nested populate queries from discovered schemas. Custom Strapi routes, permissions and plugins still require integration validation.

## Use

Ask your client to list projects, inspect the page, preview operations, and create the reviewed draft with its source hash and a stable idempotency key. Then validate and compare it. Source pages remain read-only. Existing drafts must be registered in this installation's ownership database.

Tools: `list_projects`, `find_pages`, `inspect_page`, `list_components`, `get_component_schema`, `preview_clone_and_modify`, `clone_page_and_modify`, `inspect_owned_draft`, `modify_owned_draft`, `duplicate_component`, `replace_component`, `validate_draft`, `compare_pages`.

Copy-ready workflows for discovery, JSON insertion, component reordering, long pages, team review drafts, and conflict recovery are available in the [prompt cookbook](https://safe-strapi-mcp.metehankasapp.workers.dev/prompts). AI clients can read the same guide directly as [Markdown](https://safe-strapi-mcp.metehankasapp.workers.dev/prompts.md) or discover key resources through [`llms.txt`](https://safe-strapi-mcp.metehankasapp.workers.dev/llms.txt).

Indexes are zero-based. Operations run sequentially, so later indexes refer to the current order. Ambiguous selectors must include an occurrence or index. Writes require revision hashes and idempotency keys; retries with a different operation hash are rejected.

If a create response is lost before its document ID can be recorded, the retry fails closed with `WRITE_OUTCOME_UNKNOWN`; it never submits another create or adopts a page by slug. Inspect the CMS through its API and use a new operation only after resolving the uncertain result. A lost update response is safely reconciled from the recorded intended content without a second PUT.

Concurrent MCP writes sharing the same audit database are serialized. Draft and source hashes are checked immediately before writes and results are fetched and verified afterward. Owned-draft updates send only the configured dynamic-zone field. Strapi REST does not expose an atomic revision precondition, so a writer outside this MCP can still race inside the final GET/PUT interval; preventing that last race requires a Strapi-side conditional-update endpoint.

## Local state

The audit database defaults to `.safe-strapi/audit.sqlite` inside the selected project; set `AUDIT_DB` to override it. Preserve this database between sessions. Add `.safe-strapi/` and env files to your project's gitignore. Protect them with local filesystem permissions.

Each installation uses its own local credentials and state. The package supports stdio only and does not require or accept an MCP access key.

## Development checks

```sh
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

Tests include a 100-component preservation scenario, owned-draft checks, idempotency conflicts, lost-response recovery, cross-instance serialization, and env-file onboarding through the real stdio protocol against mocked Strapi REST. Local acceptance additionally exercises a real Strapi 5 API without using the admin UI. These tests do not certify every Strapi plugin or version.

Independent tooling; not affiliated with or endorsed by Strapi.

## Community and security

Bug reports and contributions are welcome on [GitHub](https://github.com/metehankasapp/safe-strapi-mcp). Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Released under the [MIT License](LICENSE).
