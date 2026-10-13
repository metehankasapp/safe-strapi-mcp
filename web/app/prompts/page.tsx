import type { Metadata } from 'next';
import { CodeBlock, Footer, Header } from '../ui';

export const metadata: Metadata = {
  title: 'Prompt cookbook and use cases',
  description: 'Copy-ready prompts for safely inspecting, cloning, editing, validating, and comparing Strapi content with any MCP client.',
  alternates: { canonical: '/prompts' },
};

const prompts = [
  {
    level: 'START HERE',
    title: 'Read-only project discovery',
    copy: 'Confirm the connection and understand the content model before allowing any write.',
    prompt: `Use the configured Safe Strapi MCP server.\n\n1. List projects and content types.\n2. Inspect <content-type-uid> with inspect_content_type.\n3. Read its schema, components, sample records and REST contract.\n4. Research its routes, controllers, services, lifecycle hooks and frontend routing.\n5. Find existing entries and inspect the relevant record.\n\nDo not create, update, delete, or publish anything.`,
  },
  {
    level: 'COLLECTION ENTRY',
    title: 'Create News in three linked languages',
    copy: 'Inspect the News schema, resolve real assets and create translations on the same document.',
    prompt: `Use Safe Strapi for <project-name>. Inspect the exact News UID with inspect_content_type. Research the type's API implementation and frontend language routes. Read <article-file> and prepare content for <source-locale>, <locale-two> and <locale-three>.\n\nResolve existing media and category IDs through read tools. Preview the source entry with preview_entry_write and show the exact fields, endpoint, visibility and hashes. Apply the authorized preview with apply_entry_write. Preview each translation with action=localize on the SAME documentId, using the shared slug where language prefixes distinguish routes. Never POST separate translation records.\n\nRe-fetch all three locales, verify content, assets, links and unchanged published versions. Use API tools only; never fall back to browser/admin UI or shell writes. Do not publish.`,
  },
  {
    level: 'SINGLE TYPE',
    title: 'Update settings from their actual schema',
    copy: 'Use the singleton endpoint and review every requested field before updating.',
    prompt: `Use Safe Strapi for <project-name>. Inspect <single-type-uid> and its API/source behavior, then get_entry without a documentId.\n\nPreview only <field-changes> with action=update and the persisted inspectionId. Enable allowEntryEditing only for this authorized task. Show the exact PUT request, before/after values, visibility and hashes. Apply the approved persisted preview, re-fetch and verify unchanged fields. If Draft & Publish is disabled, disclose immediate visibility and require explicit approval.`,
  },
  {
    level: 'MEDIA',
    title: 'Upload a reviewed image through the API',
    copy: 'Reuse existing assets or upload the exact file and verify its saved metadata.',
    prompt: `Use Safe Strapi for <project-name>. Search list_media for an existing matching asset first. If a new file is needed, preview_media_upload for <absolute-file-path> with alternativeText=<alt-text> and caption=<caption>.\n\nShow the file hash, destination, metadata and immediate Media Library visibility. After approval, call upload_media with its exact previewId, expectedOperationHash and stable idempotencyKey. Verify the returned media ID and metadata before referencing it in an entry. Never blindly retry an unknown upload outcome.`,
  },
  {
    level: 'BASIC',
    title: 'Update copy on a safe draft',
    copy: 'Clone a page and patch one known component without touching the source.',
    prompt: `Use Safe Strapi for project <project-name>. Find and inspect <page-slug>.\n\nPreview a clone that changes the title field on component index <index> to:\n"<new-title>"\n\nShow the source hash, operation hash, proposed slug, and exact changed paths. Do not write until I approve the preview.`,
  },
  {
    level: 'STRUCTURED CONTENT',
    title: 'Insert a component from JSON',
    copy: 'Validate supplied JSON against the live project schema, then place it precisely.',
    prompt: `Use Safe Strapi for project <project-name>. Inspect <page-slug> and fetch the schema for <component-uid>.\n\nValidate this JSON against that schema:\n<json-payload>\n\nPreview a cloned draft that inserts it after component index <index>. Preserve every field on every existing component. Do not write yet.`,
  },
  {
    level: 'REORDERING',
    title: 'Move, duplicate, or replace a block',
    copy: 'Use explicit zero-based indexes so repeated component types never become ambiguous.',
    prompt: `Inspect <page-slug> in <project-name> and show the current indexed component order.\n\nOn a cloned draft only:\n- move component index <from-index> after index <target-index>\n- duplicate component index <duplicate-index> at the end\n- replace component index <replace-index> with <component-json>\n\nPreview the sequential result first. If any selector is ambiguous or invalid, stop and explain it.`,
  },
  {
    level: 'LONG PAGE',
    title: 'Protect a 100+ component page',
    copy: 'Make several targeted changes while explicitly checking that unrelated fields survive.',
    prompt: `Inspect the complete <page-slug> page in <project-name> and capture its source hash.\n\nPreview these operations in order on a clone:\n1. Patch component #50 with <changes>.\n2. Move component #80 after component #10.\n3. Insert <component-json> after component #25.\n\nUse explicit indexes and a stable idempotency key. After creation, re-fetch the draft, validate it, compare it with the source, and confirm that every field outside the approved changes is preserved. Re-fetch the source and prove its hash is unchanged. Never publish.`,
  },
  {
    level: 'TEAM WORKFLOW',
    title: 'Create a review-ready campaign draft',
    copy: 'Turn a content brief into a named draft that editors can review in Strapi.',
    prompt: `Use Safe Strapi to create a review draft from <source-page> in <project-name>.\n\nBrief:\n<campaign-brief>\n\nFirst inspect the page and relevant component schemas. Propose the smallest set of component operations and preview them. Use clone slug <review-slug> and title suffix " (Content Review)". After I approve, create the draft, validate it, compare it with the source, and return a concise review summary. Do not publish.`,
  },
  {
    level: 'RECOVERY',
    title: 'Respond safely to a conflict',
    copy: 'Never force a stale operation through after another editor or agent changes content.',
    prompt: `Continue the Safe Strapi operation only if the current source and draft hashes match the last inspected hashes.\n\nIf you receive SOURCE_CHANGED or DRAFT_CHANGED, stop, inspect again, and show what changed before proposing a new preview. If you receive WRITE_OUTCOME_UNKNOWN, do not retry the create automatically. Never reuse an idempotency key for different operations.`,
  },
  {
    level: 'OPT-IN · DRAFT EDITING',
    title: 'Edit the middle component without cloning',
    copy: 'Use the same document draft with preserved IDs and surrounding content. Requires npm 0.3.0 and project opt-in.',
    prompt: `Use Safe Strapi for <project-name>. Confirm preview_modify_page and modify_page are available and list_projects reports allowInPlaceEditing=true.\n\nInspect existing page <document-id> and the schema for component index <index>. Preview only this patch with preview_modify_page:\n<field-changes>\n\nPreserve every other block and existing component ID. Show differences, pageHash and operationHash. Do not write until I approve. After approval, call modify_page with the exact operations, both returned hashes and a stable idempotency key. Re-inspect the same document and verify the result. Do not clone, clear fields, replace arrays or publish.`,
  },
  {
    level: 'OPT-IN · DRAFT EDITING',
    title: 'Insert between existing components',
    copy: 'Add a component to the existing draft while keeping old blocks in their relative order.',
    prompt: `Use Safe Strapi for <project-name> with direct draft editing explicitly enabled. Inspect existing page <document-id> and get the schema for <component-uid>.\n\nPrepare <component-json> with all schema attributes, explicit null/empty values for unused fields and no component IDs. Preview an insert after component index <index> with preview_modify_page. Do not remove or replace existing blocks.\n\nAfter I approve the preview, apply it with modify_page using its pageHash, operationHash and a stable idempotency key. Re-inspect and verify the inserted block and all preserved IDs. Never publish. If this feature is unavailable in the installed package, upgrade to npm 0.3.0 and restart the MCP client before continuing.`,
  },
];

export default function PromptsPage() {
  return <main><Header /><div className="docsShell"><aside className="docsNav"><strong>Prompt cookbook</strong><a href="#principles">Prompt structure</a>{prompts.map((item, index) => <a key={item.title} href={`#use-case-${index + 1}`}>{item.title}</a>)}<a href="#machine-readable">For AI agents</a></aside><article className="docs promptCookbook">
    <span className="kicker">USE CASES</span><h1>Tell your agent exactly what safe means.</h1><p className="lead">These prompts work with Codex, Claude, Cursor, custom agents, and other MCP clients. Replace the angle-bracket placeholders with your project values. Begin read-only, review a preview, then authorize a draft.</p>
    <h2 id="principles">A reliable prompt structure</h2><div className="promptPrinciples"><div><strong>1. Name the project and source</strong><span>Use an exact project name plus a document ID or slug.</span></div><div><strong>2. Inspect before selecting</strong><span>Ask for indexed component order and schemas before making changes.</span></div><div><strong>3. Preview before writing</strong><span>Review hashes, the proposed slug, changed paths, and final order.</span></div><div><strong>4. Verify after writing</strong><span>Validate, compare, re-fetch, and confirm the source hash is unchanged.</span></div></div>
    <div className="note">npm 0.3.0 supports schema-first collections, single types and media, plus page cloning and opt-in draft editing. Inspect the exact schema and API, review a persisted preview, then apply the authorized request. Draft content is never published automatically.</div>
    {prompts.map((item, index) => <section className="useCase" id={`use-case-${index + 1}`} key={item.title}><span className="useCaseLevel">{item.level}</span><h2>{item.title}</h2><p>{item.copy}</p><CodeBlock label="Copy this prompt">{item.prompt}</CodeBlock></section>)}
    <h2 id="remote-acceptance">Test a remote CMS on one disposable draft</h2><p>The <a className="textLink" href="/prompts.md#12-remote-acceptance-one-disposable-draft-step-by-step">step-by-step acceptance guide</a> includes prompts and verified results for creation, middle/nested edits, rollback, insertion, optional copy clearing, component removal, and conflict handling. Original draft and published pages remained unchanged.</p><div className="note">Clearing/removal use the owned-draft workflow and may regenerate component IDs. Direct patch/insert/rollback preserve IDs and reject removal. No page records were deleted and nothing was published. Public frontend visibility was not verified.</div>
    <h2 id="machine-readable">Let an AI client read this guide</h2><p>Give your agent the raw guide URL and ask it to choose the safest matching workflow. The Markdown version contains tool rules, placeholders, and every prompt without page chrome.</p><CodeBlock label="Prompt for your agent">{`Read https://safe-strapi-mcp.metehankasapp.workers.dev/prompts.md\nChoose the safest matching Safe Strapi workflow for my request.\nStart read-only and do not write until you show me a preview.`}</CodeBlock><p>Discovery metadata is also available at <a className="textLink" href="/llms.txt">/llms.txt</a>.</p>
  </article></div><Footer /></main>;
}
