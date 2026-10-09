'use client';

import { useState } from 'react';

export const masterPrompt = `Set up Safe Strapi for this repository, then help me manage Strapi content safely.

Rules:
1. Work only with the repository currently open. Inspect its structure, Strapi source directory, gitignore, and existing environment files before changing anything.
2. Use the local stdio package "safe-strapi-mcp". Do not connect to a hosted /mcp URL and do not ask for an MCP_API_KEY or STRAPI_MCP_TOKEN. This project does not use hosted MCP.
3. Locate the existing Strapi base URL and API token variables without printing or copying secret values into chat. Reuse them through a private env file or local launcher. If no Strapi API token exists, tell me exactly which least-privilege Strapi token to create; do not confuse it with an MCP key.
4. Inspect how the frontend resolves content routes. If it uses a separate top-level field such as "url" instead of the configured Strapi UID/slug field, set STRAPI_ROUTE_FIELD to that exact schema field so cloned drafts remain reachable. Never guess or mutate arbitrary fields.
5. Configure this project for Codex with a project-scoped local stdio MCP entry. Run the published package with npm exec and absolute paths. Keep credentials out of .codex/config.toml, .mcp.json, source control, and chat.
6. Add only private credential/state paths to the relevant .gitignore. Preserve existing project configuration and unrelated changes.
7. Verify the MCP over stdio with an initialize request, then verify read-only tools: list projects, discover schemas, find the requested page, and inspect its complete component order and content hash.
8. For content changes, always inspect first, fetch relevant schemas, and preview the full operation set. Default to clone-first unless I explicitly request editing the existing page without cloning. Do not write until I approve the preview.
9. For clone-first changes, use the clone and MCP-owned draft tools, show top-level slug/route/title changes, validate and compare the draft, and re-fetch the source to prove it is unchanged.
10. For an explicitly requested in-place edit, first confirm preview_modify_page and modify_page are available and list_projects reports allowInPlaceEditing=true. These tools are in the current source, not the published 0.2.0 package. If unavailable, explain that a source build and explicit project opt-in are required; do not silently switch to an official MCP update or enable in-place editing during ordinary setup.
11. In-place editing uses an existing draft and only patch/insert operations. Preview with preview_modify_page, then pass the exact operations, returned pageHash as expectedPageHash, operationHash as expectedOperationHash, and a stable idempotencyKey to modify_page. Re-inspect the same document to verify changed fields, other components and preserved IDs. Do not use owned-draft validation for an unowned existing page. Never clear fields, replace arrays, change existing media/relations, remove blocks, or publish. Explain that external writers can still race the final REST GET/PUT.
12. If setup is already correct, do not rebuild it. Diagnose and fix the root cause of any failure, then continue with my content request. Never publish or delete content in either workflow.

Start now. Briefly report what you found, what you configured, and the result of the read-only verification. Then ask what content I want to add or change.`;

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
