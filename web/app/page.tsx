import { Footer, Header } from './ui';
import { MasterPrompt } from './master-prompt';

const workflow = [
  ['01', 'Inspect the schema and API', 'Discover the collection or single type, its fields, related content and REST contract.'],
  ['02', 'Review the content', 'Validate the exact JSON and review fields, locales and visibility before writing.'],
  ['03', 'Write through the API', 'Apply the approved persisted plan with revision checks and an idempotency key.'],
  ['04', 'Verify the result', 'Fetch the entry again and check intended fields, preserved content and publication state.'],
];

export default function Home() {
  return <main><Header />
    <section className="hero" id="top">
      <div className="availability"><span /> npm 0.3.0 · local setup · no MCP key</div>
      <h1>Tell Codex to set it up.<br /><em>Then manage content safely.</em></h1>
      <p>Copy one master prompt into Codex from your Strapi repository. It finds your existing configuration, installs the local MCP, verifies the connection, and keeps credentials out of chat.</p>
      <div className="actions"><a className="button" href="#master-prompt">Get the master prompt</a><a className="textLink" href="#how-it-works">See how it works <span>→</span></a></div>
      <MasterPrompt />
      <div className="productWindow" aria-label="Example Safe Strapi operation">
        <div className="windowBar"><div><i /><i /><i /></div><span>content change</span><span className="verified">Verified</span></div>
        <div className="operation"><div className="sourceCard"><span className="cardLabel">INSPECTED TYPE</span><strong>News</strong><small>Schema · API · media · relations</small><div className="hash">9f2a…7c10</div></div><div className="operationArrow">→</div><div className="draftCard"><span className="cardLabel">NEW DRAFT</span><strong>Global user summit</strong><small>One document · three linked languages</small><div className="changes"><span>English</span><span>Arabic</span><span>Central Kurdish</span></div></div></div>
      </div>
    </section>
    <section className="proof" aria-label="Product capabilities"><div><strong>No MCP key</strong><span>Runs locally over stdio</span></div><div><strong>Strapi 5+</strong><span>Automatic schema discovery</span></div><div><strong>SHA-256</strong><span>Before-and-after checks</span></div><div><strong>Schema first</strong><span>Inspect, preview, write and verify</span></div></section>
    <section className="section" id="how-it-works"><div className="sectionIntro"><span className="kicker">HOW IT WORKS</span><h2>A careful workflow for fast-moving teams.</h2><p>Safe Strapi handles News, Blogs, forms, settings and composed pages through their actual Strapi schemas. The AI researches the type and API before writing approved content.</p></div><div className="workflow">{workflow.map(([number,title,copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="section twoCol"><div><span className="kicker">BUILT FOR YOUR PROJECT</span><h2>Your content stays in your hands.</h2><p>Install the MCP on your machine or agent host. Point it at your Strapi project and environment file. Credentials stay in your environment, and content requests go directly to your CMS. No account required.</p><a className="textLink" href="/docs">Read the setup guide <span>→</span></a></div><div className="examplePrompt"><span>Example request</span><p>“Inspect my News schema and API. Prepare this article in English, Arabic and Central Kurdish with the existing images. Preview it, apply the approved API requests and verify all three languages.”</p><div><i /> Schema first · shared slug · verified content</div></div></section>
    <section className="section twoCol"><div><span className="kicker">EDIT WITHOUT COPYING</span><h2>Change one component on the existing draft.</h2><p>Safe Strapi also supports opt-in direct edits. Preview a patch or insertion, apply the reviewed plan to the same document, and verify existing component IDs and other content. No publishing is performed.</p><a className="textLink" href="/docs#in-place">Read the direct editing guide <span>→</span></a></div><div className="examplePrompt"><span>Opt-in request · npm 0.3.0</span><p>“Edit the features component on this existing page. Preserve the surrounding blocks. Use preview_modify_page, show me the changes, then apply the approved plan with modify_page.”</p><div><i /> Clone-first remains the default</div></div></section>
    <section className="ctaBand"><div><span className="kicker">READY TO START</span><h2>Paste the prompt. Codex handles setup.</h2><p>The local MCP uses your Strapi API token directly. No hosted service credential is involved.</p></div><a className="button light" href="#master-prompt">Get the prompt</a></section>
    <Footer />
  </main>;
}
