'use client';

import { useState } from 'react';

export const masterPrompt = `Set up Safe Strapi for this repository, then manage content through its REST API tools.

Rules:
1. Inspect only this repository: its Strapi source, frontend routes/language selector, gitignore and existing environment files. Preserve unrelated changes.
2. Use local stdio safe-strapi-mcp. This website is documentation, not a hosted /mcp service. Never request MCP_API_KEY or STRAPI_MCP_TOKEN.
3. Reuse existing Strapi URL and Content API token variables through a private env file or launcher. Never print/copy secrets into chat, client config or git. If absent, specify least-privilege Strapi permissions: find/findOne for target and populated relations/media, create/update for requested types, upload only for new assets.
4. Verify tools before setup. The 0.3.0 source build adds general entry/media tools; published npm 0.2.0 does not. If the installed build lacks list_content_types/inspect_content_type/preview_entry_write/apply_entry_write, build the current feature source checkout rather than pretending a page tool supports News. Use absolute source/env paths and keep credentials/state private.
5. Configure a project-scoped stdio entry, preserve existing configuration, and verify initialize/list_tools plus read-only discovery. Restart the client if needed. Never rebuild correct setup needlessly.
6. Before composing any content payload: list_projects -> list_content_types -> inspect_content_type for the EXACT UID. Read required fields, defaults, validation constraints, field localization, nested component schemas, media/relation targets, sample records, API endpoints/methods and returned official documentation. Do not guess names, storage types, IDs, permissions or payload shapes.
7. Inspect how the frontend resolves URLs and switches locale. Use the common slug when the language prefix already distinguishes translations. Do not add -ar/-ckb/-en suffixes. localeSlugPolicy defaults to shared; use localized only with evidence that the frontend resolves translated slugs.
8. Find/read existing entries with find_entries/get_entry. Resolve media with list_media and related documentIds through their exact schemas. Markdown richtext is a string; Blocks richtext is a structured array. JSON application IDs must remain intact. New components omit IDs; retained components preserve verified IDs.
9. Use preview_entry_write with the persisted inspectionId and exact data. Choose create for a new entry, update for existing content, or localize for an absent translation of the SAME documentId. Never POST a separate translation or overwrite shared fields during localization.
10. Existing-entry updates require explicit allowEntryEditing/--allow-entry-editing; enable it when the requested task authorizes editing existing entries. Generic entry tools support schema-approved references/arrays; old protected page tools keep their narrower rules. Do not use one workflow to silently bypass another's guards.
11. Show the exact persisted preview, field differences, target, affected/shared locales, visibility and hashes. Apply authorized content using apply_entry_write with its previewId, expectedOperationHash and stable unique idempotencyKey. A preview is required; approval already given in the conversation remains valid for its agreed scope.
12. Draft & Publish types always use status=draft. A type without draft state needs allowImmediateWrite=true and explicit approval of immediate visibility. New media is also immediately visible: preview_media_upload, show the exact local file/destination/hash/alt/caption, then upload_media after approval. Reuse existing assets when possible.
13. After writing, re-fetch the entry/media, verify exact changed fields, preserved unrelated data/component IDs, shared slugs and linked locales. Check published versions remain unchanged for draft writes. Test the requested frontend URLs/language transitions when accessible; API verification is not frontend verification.
14. API-only content entry: never switch to Computer Use, browser/admin UI, another MCP or shell writes after an API failure. Report HTML WAF/authentication errors separately from Strapi JSON errors. Never bypass security challenges. Resolve the API blocker before continuing.
15. Never blindly retry unknown POST/upload outcomes or adopt matching records by slug. Reuse the same idempotency key only for identical operations; known PUT targets can be re-read for reconciliation without another write. REST revision checks are not atomic against external writers.
16. For protected page cloning or patch/insert/rollback, use the existing dedicated tools and their contractVersion 1 safeguards. General entry/media previews use contractVersion 2. Never claim a publish/delete/rollback action that was not performed. Do not publish drafts or delete records automatically.

Start with read-only discovery and report the actual configuration/tool capabilities. Then continue with my content request.`;

export function MasterPrompt() {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(masterPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return <div className="masterPrompt" id="master-prompt">
    <div className="masterPromptBar"><span>Paste into Codex from your Strapi repository</span><button type="button" onClick={copyPrompt}>{copied ? 'Copied' : 'Copy master prompt'}</button></div>
    <pre>{masterPrompt}</pre>
  </div>;
}
