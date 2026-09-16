'use client';

import { useState } from 'react';

export const masterPrompt = `Set up Safe Strapi for this repository, then help me manage Strapi content safely.

Rules:
1. Work only with the repository currently open. Inspect its structure, Strapi source directory, gitignore, and existing environment files before changing anything.
2. Use the local stdio package "safe-strapi-mcp". Do not connect to a hosted /mcp URL and do not ask for an MCP_API_KEY or STRAPI_MCP_TOKEN. This project does not use hosted MCP.
3. Locate the existing Strapi base URL and API token variables without printing or copying secret values into chat. Reuse them through a private env file or local launcher. If no Strapi API token exists, tell me exactly which least-privilege Strapi token to create; do not confuse it with an MCP key.
4. Configure this project for Codex with a project-scoped local stdio MCP entry. Run the published package with npm exec and absolute paths. Keep credentials out of .codex/config.toml, .mcp.json, source control, and chat.
5. Add only private credential/state paths to the relevant .gitignore. Preserve existing project configuration and unrelated changes.
6. Verify the MCP over stdio with an initialize request, then verify read-only tools: list projects, discover schemas, find the requested page, and inspect its complete component order and content hash.
7. For content changes, always inspect first, fetch relevant schemas, and preview the full operation set. Do not write until I approve the preview.
8. After approval, create or modify only an MCP-owned draft, validate it, compare it with the source, and re-fetch the source to prove it is unchanged. Never publish, delete, or modify the source page.
9. If setup is already correct, do not rebuild it. Diagnose and fix the root cause of any failure, then continue with my content request.

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
