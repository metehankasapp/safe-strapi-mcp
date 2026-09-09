# Contributing

## Development

Requires Node.js 22.5 or newer.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Do not use real Strapi credentials or customer content in tests. Add a focused
regression test for behavior changes. Preserve clone-first writes, owned-draft
enforcement, revision checks, idempotency, and post-write verification.

## Pull requests

Keep changes focused, explain the safety impact, and update documentation when
behavior or configuration changes. All CI checks must pass.
