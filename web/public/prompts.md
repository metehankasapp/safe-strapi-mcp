# Safe Strapi MCP Prompt Cookbook

Use this guide with any MCP-compatible AI client. Replace `<placeholders>` with real values. Safe Strapi works on cloned drafts and does not publish content.

## Required workflow

1. List projects and find the source page.
2. Inspect the full page, indexed component order, and content hash.
3. Fetch the schema for every component that will be inserted or replaced.
4. Preview the complete sequential operation set.
5. Review the proposed slug, hashes, counts, changed paths, and final order.
6. Only after approval, create the draft with the exact previewed operations, latest source hash, and a stable unique idempotency key.
7. Inspect and validate the owned draft.
8. Compare it with the source and re-fetch the source to confirm its hash is unchanged.
9. Never publish automatically.

Indexes are zero-based. Operations run sequentially, so later indexes refer to the current order. If a selector could match more than one component, use an explicit index or occurrence. Never reuse an idempotency key for a different operation.

## 1. Read-only discovery

```text
Use the configured Safe Strapi MCP server.

1. List available projects.
2. List component schemas for <project-name>.
3. Find the page with slug <page-slug>.
4. Inspect its dynamic-zone component order and content hash.

Do not create, update, delete, or publish anything.
```

## 2. Update copy on a safe draft

```text
Use Safe Strapi for project <project-name>. Find and inspect <page-slug>.

Preview a clone that changes the title field on component index <index> to:
"<new-title>"

Show the source hash, operation hash, proposed slug, and exact changed paths. Do not write until I approve the preview.
```

## 3. Insert a component from JSON

```text
Use Safe Strapi for project <project-name>. Inspect <page-slug> and fetch the schema for <component-uid>.

Validate this JSON against that schema:
<json-payload>

Preview a cloned draft that inserts it after component index <index>. Preserve every field on every existing component. Do not write yet.
```

## 4. Move, duplicate, and replace blocks

```text
Inspect <page-slug> in <project-name> and show the current indexed component order.

On a cloned draft only:
- move component index <from-index> after index <target-index>
- duplicate component index <duplicate-index> at the end
- replace component index <replace-index> with <component-json>

Preview the sequential result first. If any selector is ambiguous or invalid, stop and explain it.
```

## 5. Protect a 100+ component page

```text
Inspect the complete <page-slug> page in <project-name> and capture its source hash.

Preview these operations in order on a clone:
1. Patch component #50 with <changes>.
2. Move component #80 after component #10.
3. Insert <component-json> after component #25.

Use explicit indexes and a stable idempotency key. After creation, re-fetch the draft, validate it, compare it with the source, and confirm that every field outside the approved changes is preserved. Re-fetch the source and prove its hash is unchanged. Never publish.
```

## 6. Create a team review draft

```text
Use Safe Strapi to create a review draft from <source-page> in <project-name>.

Brief:
<campaign-brief>

First inspect the page and relevant component schemas. Propose the smallest set of component operations and preview them. Use clone slug <review-slug> and title suffix " (Content Review)". After I approve, create the draft, validate it, compare it with the source, and return a concise review summary. Do not publish.
```

## 7. Modify an existing MCP-owned draft

```text
Inspect owned draft <draft-document-id> in <project-name>. Show its latest draft hash and current component order.

Preview <requested-changes> against that exact revision. Use a new stable idempotency key. If approved, modify only this owned draft, re-fetch it, validate it, compare it with its source, and confirm the source remains unchanged.
```

## 8. Recover safely from conflicts

```text
Continue only if the current source and draft hashes match the last inspected hashes.

If SOURCE_CHANGED or DRAFT_CHANGED occurs, stop, inspect again, and show what changed before proposing a new preview. If WRITE_OUTCOME_UNKNOWN occurs, do not retry the create automatically. Never reuse an idempotency key for different operations.
```

## Expected completion report

After a successful write, report:

- source document ID, slug, and unchanged hash status;
- draft document ID, slug, status, and latest hash;
- operation hash and idempotency key;
- exact operations and changed paths;
- validation result and component count;
- comparison summary;
- explicit confirmation that nothing was published.
