# Safe Strapi MCP Prompt Cookbook

Use this guide with any MCP-compatible AI client. Replace `<placeholders>` with real values. Clone-first is the default; opt-in direct editing of existing drafts is also in the current source build. These new tools are not in the published 0.2.0 package. Neither workflow publishes content.

## Required clone-first workflow

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

Show an AI-side before/after plan for <requested-changes> against that exact revision; modify_owned_draft has no dedicated persisted preview tool. Use a new stable idempotency key. If approved, modify only this owned draft, re-fetch it, validate it, compare it with its source, and confirm the source remains unchanged.
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

## 9. Edit the middle component without cloning (opt-in source build)

```text
Use Safe Strapi for <project-name>. Confirm preview_modify_page and modify_page
are available and list_projects reports allowInPlaceEditing=true.

Inspect existing page <document-id> and the schema for component index <index>.
Preview only this patch with preview_modify_page:
<field-changes>

Preserve every other block and all existing component IDs. Show the differences,
pageHash and operationHash. Do not write until I approve the preview.
After approval, call modify_page with the exact operations, expectedPageHash from
pageHash, expectedOperationHash from operationHash and a stable idempotency key.
Re-inspect the same document to verify changes and retained IDs.
Do not clone, clear fields, replace arrays or publish.
```

## 10. Insert between existing components (opt-in source build)

```text
Use Safe Strapi for <project-name> with direct editing explicitly enabled.
Inspect existing page <document-id> and get the schema for <component-uid>.

Prepare <component-json> with all schema attributes, explicit null/empty values
for unused optional fields and no component IDs. Preview an insert after
component index <index> using preview_modify_page.
Preserve the old blocks and their relative order. Do not remove or replace them.

After I approve, apply with modify_page, both preview hashes and a stable
idempotency key. Re-inspect and verify the insertion and all existing IDs.
Do not publish. If the installed package lacks these tools, explain that a
current source build is required; do not bypass the checks with another MCP.
```

### Direct editing rules and report

- Enable only when explicitly requested: `STRAPI_ALLOW_IN_PLACE_EDITING=true` or
  `--allow-in-place-editing` for automatic discovery, `allowInPlaceEditing: true`
  per project in custom config. The flag does not override custom config.
- Use an existing draft with complete schemas and full population.
- Only patch and insert are supported. Remove/replace/move/duplicate, component
  identity changes, clearing fields, array replacement and changing existing
  media/relations are rejected. Private/custom fields are unsupported.
- Existing pages do not require owned-draft registration. Do not call
  inspect_owned_draft or validate_draft on an unowned document.
- On PAGE_CHANGED or PREVIEW_MISMATCH, inspect and preview again. With a lost
  update response, the same inputs/key permit re-read reconciliation only;
  WRITE_OUTCOME_UNKNOWN means inspect before starting a new operation.
- Report the same document ID/slug, final pageHash, operationHash, changed fields,
  component counts, retained IDs and that nothing was cloned or published.
- External writers can still race the final REST GET/PUT; preventing this fully
  needs a Strapi-side atomic endpoint. Official MCP writes bypass these guards.
- Check the target frontend’s content-state configuration. A frontend that reads
  only published content will not show draft edits. Static sites may need a
  separate rebuild and deployment after publication.

## Consistent preview response (current source)

For `contractVersion: "1"`, always use these labels in this order, translated
consistently into the user's language:

1. **Target** — `target.project`, `documentId`, `locale`, draft state.
2. **Action** — `action` and `summary` counts.
3. **Changes** — `fieldChanges`: path, before → after and existence flags.
4. **Protection** — `safety`; REST checks are not atomic.
5. **Publication** — nothing is published automatically.
6. **Rollback** — `safety.rollbackSupported` is eligibility, not revision validity.
7. **Approval** — ask before calling `nextAction.tool`; show `revision` hashes.

If `fieldChangesTruncated` is true, disclose that the diff is incomplete and
inspect relevant content before seeking approval. Keep machine field names
unchanged; human labels can be localized. User approval is a client workflow
rule, not independently enforced human authentication by the MCP.

## 11. Undo a recorded field edit (opt-in source build)

```text
Use Safe Strapi for <project-name>. List local operations for <document-id>
and locale <locale> with list_page_operations.

Preview rollback of operation <operation-id> using preview_rollback_page.
Use the standard preview response labels and show the exact recorded values
to restore. Do not write until I explicitly approve this rollback.

After approval, call rollback_page with the same target and operationId,
expectedPageHash from pageHash, expectedOperationHash from operationHash,
and a NEW stable idempotency key. Re-inspect the draft and report verification.
Never publish, delete components, or automatically roll back after an error.
```

Rollback only supports completed verified patch-only edits while the page still
matches its exact post-operation revision. Later edits, uncertain writes,
missing snapshots and insert operations must stop the workflow. Existing
component identities and media/relation references are preserved. Recorded
scalar values may return to a previously empty/null value; ordinary patches
still cannot clear content. A lost rollback response can only be reconciled by
re-reading with the same inputs/key, never blindly sending a second update.
Keep the local audit database private: it contains content snapshots. These
new tools are in the current source build, not the published 0.2.0 package.


## 12. Remote acceptance: one disposable draft, step by step

This sequence was verified through MCP stdio against a remote Strapi server.
Every write targeted one newly created unpublished test draft. Full before/after
hashes of all original draft and published pages matched. Credentials, schemas,
content snapshots and execution records remain private. These prompts describe
individual stages; they are not instructions to run all writes without review.

Replace placeholders and inspect schemas before choosing actual field names.
Use a unique test slug and retain the same private audit database throughout.

| Step | Tool path | Verified result |
| --- | --- | --- |
| Read and baseline | list_projects, find_pages, inspect_page | Read-only discovery and source snapshot |
| Create test page | preview_clone_and_modify → clone_page_and_modify | New unpublished owned draft; source unchanged |
| Edit middle and nested fields | preview_modify_page → modify_page | Surrounding content and all existing IDs preserved |
| Undo the field edit | list_page_operations → preview_rollback_page → rollback_page | Exact recorded values and IDs restored |
| Insert between blocks | preview_modify_page → modify_page | One added block; old content, order and IDs preserved |
| Check direct-edit guards | Direct clearing, remove, insert rollback attempts | Rejected; page unchanged |
| Clear optional test copy | inspect_owned_draft → AI plan → modify_owned_draft | Selected optional field emptied; other content retained |
| Remove inserted middle block | inspect_owned_draft → AI plan → modify_owned_draft | Selected block removed; remaining content/order retained |
| Change after rollback preview | preview_rollback_page → later edit → rollback_page | PAGE_CHANGED; later edit retained |
| Final verification | inspect_page, validate_draft, list_page_operations; baseline comparison | Original pages unchanged; test draft unpublished |

**Owned-draft limitation:** `modify_owned_draft` uses create normalization.
Retained component IDs were regenerated during the clearing/removal stages.
Use direct patch/insert/rollback when identity preservation is required. The
owned-draft route is restricted to drafts registered by this MCP installation;
it is not a deletion route for arbitrary existing pages. Native persisted
preview contracts apply to clone/direct-edit/rollback tools. For owned-draft
updates, the AI must show its plan from the latest inspection and pass the
matching `expectedDraftHash`; the MCP does not persist a dedicated preview.
There is no page-record deletion tool. Required fields must remain valid.

### A. Create only the disposable test draft

```text
Use Safe Strapi MCP for <project-name>. Read <reference-page> and record its
full hash. Preview a new draft with slug <unique-test-slug> and a title suffix
" (MCP TEST — DO NOT PUBLISH)". Use schema-valid synthetic test components:
a heading, two middle blocks including a nested button, and a final text block.
Show the resulting order and changed fields. After approval, create and validate
only this draft. Confirm the source hash is unchanged. Never publish.
```

### B. Edit, undo, then insert

```text
Use Safe Strapi MCP on test draft <test-document-id> only.
Preview a middle block title/copy change and its nested button label using
preview_modify_page. Preserve every other value and existing component ID.
After approval, apply with both preview hashes and a unique idempotency key.
Verify the result and record operationId.
```

```text
Use Safe Strapi MCP to preview rollback of <operation-id> on <test-document-id>.
Show the recorded values to restore. After approval, apply the rollback with
both preview hashes and a new idempotency key. Verify exact values and IDs.
```

```text
Use Safe Strapi MCP to preview insertion of <schema-valid-component-json>
after block <index> on test draft <test-document-id>. After approval, apply
with both hashes and a new key. Verify existing content, order and IDs.
Do not attempt to undo an insertion through rollback_page. Never publish.
```

### C. Clear copy and remove the inserted block on the owned test draft

```text
Use Safe Strapi MCP only on owned test draft <test-document-id>.
Inspect its current revision. Show an AI-side before/after plan to empty the
optional <field-name> on block <index>. Explain that owned-draft normalization
may regenerate component IDs. After approval, call modify_owned_draft with
that exact expectedDraftHash and a new key. Verify all other content remains.
Do not touch the source or publish.
```

```text
Use Safe Strapi MCP only on owned test draft <test-document-id>.
Inspect again and show the exact inserted block at <index> and resulting order.
After approval, remove only that block using modify_owned_draft, the latest
expectedDraftHash and a new key. Verify every remaining block's content/order
and validate the draft. Report any regenerated IDs. Never publish.
```

### D. Verify conflict handling and original-page preservation

```text
Use Safe Strapi MCP only on test draft <test-document-id>.
Record a verified direct patch, then preview its rollback. Make another approved
test edit. Confirm the stale rollback returns PAGE_CHANGED and does not change
the later content. Compare every original draft/published page with the initial
full snapshots; report unchanged hashes, the final draft status and test steps.
Do not publish, delete any page record or change original pages.
```

Remote CMS acceptance verifies CMS content state. Public-site rendering is a
separate check: the acceptance run's public frontend returned HTTP 403, so its
visibility was not verified. A published-only static frontend also requires
publication and a separate build/deployment to display new content; neither was
performed in this sequence.
