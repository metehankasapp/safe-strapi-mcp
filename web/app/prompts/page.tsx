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
    prompt: `Use the configured Safe Strapi MCP server.\n\n1. List available projects.\n2. List component schemas for <project-name>.\n3. Find the page with slug <page-slug>.\n4. Inspect its dynamic-zone component order and content hash.\n\nDo not create, update, delete, or publish anything.`,
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
];

export default function PromptsPage() {
  return <main><Header /><div className="docsShell"><aside className="docsNav"><strong>Prompt cookbook</strong><a href="#principles">Prompt structure</a>{prompts.map((item, index) => <a key={item.title} href={`#use-case-${index + 1}`}>{item.title}</a>)}<a href="#machine-readable">For AI agents</a></aside><article className="docs promptCookbook">
    <span className="kicker">USE CASES</span><h1>Tell your agent exactly what safe means.</h1><p className="lead">These prompts work with Codex, Claude, Cursor, custom agents, and other MCP clients. Replace the angle-bracket placeholders with your project values. Begin read-only, review a preview, then authorize a draft.</p>
    <h2 id="principles">A reliable prompt structure</h2><div className="promptPrinciples"><div><strong>1. Name the project and source</strong><span>Use an exact project name plus a document ID or slug.</span></div><div><strong>2. Inspect before selecting</strong><span>Ask for indexed component order and schemas before making changes.</span></div><div><strong>3. Preview before writing</strong><span>Review hashes, the proposed slug, changed paths, and final order.</span></div><div><strong>4. Verify after writing</strong><span>Validate, compare, re-fetch, and confirm the source hash is unchanged.</span></div></div>
    <div className="note">Safe Strapi creates drafts; it does not publish them. Keep publishing as a deliberate human review step in Strapi.</div>
    {prompts.map((item, index) => <section className="useCase" id={`use-case-${index + 1}`} key={item.title}><span className="useCaseLevel">{item.level}</span><h2>{item.title}</h2><p>{item.copy}</p><CodeBlock label="Copy this prompt">{item.prompt}</CodeBlock></section>)}
    <h2 id="machine-readable">Let an AI client read this guide</h2><p>Give your agent the raw guide URL and ask it to choose the safest matching workflow. The Markdown version contains tool rules, placeholders, and every prompt without page chrome.</p><CodeBlock label="Prompt for your agent">{`Read https://safe-strapi-mcp.metehankasapp.workers.dev/prompts.md\nChoose the safest matching Safe Strapi workflow for my request.\nStart read-only and do not write until you show me a preview.`}</CodeBlock><p>Discovery metadata is also available at <a className="textLink" href="/llms.txt">/llms.txt</a>.</p>
  </article></div><Footer /></main>;
}
