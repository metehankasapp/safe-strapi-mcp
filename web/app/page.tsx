import { Footer, Header } from './ui';
import { MasterPrompt } from './master-prompt';

const workflow = [
  ['01', 'Inspect the source', 'Read the complete page and capture its revision hash. Nothing is written.'],
  ['02', 'Review the change', 'Validate component operations and see the exact order before creating anything.'],
  ['03', 'Work on a copy', 'Create a new Strapi draft, then apply only the approved operations to that draft.'],
  ['04', 'Verify the result', 'Fetch the draft again, compare every field, and confirm the source stayed untouched.'],
];

export default function Home() {
  return <main><Header />
    <section className="hero" id="top">
      <div className="availability"><span /> One prompt · local setup · no MCP key</div>
      <h1>Tell Codex to set it up.<br /><em>Then manage content safely.</em></h1>
      <p>Copy one master prompt into Codex from your Strapi repository. It finds your existing configuration, installs the local MCP, verifies the connection, and keeps credentials out of chat.</p>
      <div className="actions"><a className="button" href="#master-prompt">Get the master prompt</a><a className="textLink" href="#how-it-works">See how it works <span>→</span></a></div>
      <MasterPrompt />
      <div className="productWindow" aria-label="Example Safe Strapi operation">
        <div className="windowBar"><div><i /><i /><i /></div><span>content change</span><span className="verified">Verified</span></div>
        <div className="operation"><div className="sourceCard"><span className="cardLabel">SOURCE PAGE</span><strong>Homepage</strong><small>100 components · unchanged</small><div className="hash">9f2a…7c10</div></div><div className="operationArrow">→</div><div className="draftCard"><span className="cardLabel">NEW DRAFT</span><strong>Homepage — campaign</strong><small>101 components · 3 operations</small><div className="changes"><span>Patch #50</span><span>Move #80</span><span>Insert after #25</span></div></div></div>
      </div>
    </section>
    <section className="proof" aria-label="Product guarantees"><div><strong>No MCP key</strong><span>Runs locally over stdio</span></div><div><strong>Strapi 5+</strong><span>Automatic schema discovery</span></div><div><strong>SHA-256</strong><span>Before-and-after checks</span></div><div><strong>Clone first</strong><span>No source write tool</span></div></section>
    <section className="section" id="how-it-works"><div className="sectionIntro"><span className="kicker">HOW IT WORKS</span><h2>A careful workflow for fast-moving teams.</h2><p>Long Strapi pages are easy to damage with a partial update. Safe Strapi treats the full document as the unit of work and checks it at every boundary.</p></div><div className="workflow">{workflow.map(([number,title,copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="section twoCol"><div><span className="kicker">BUILT FOR YOUR PROJECT</span><h2>Your content stays in your hands.</h2><p>Install the MCP on your machine or agent host. Point it at your Strapi project and environment file. Credentials stay in your environment, and content requests go directly to your CMS. No account required.</p><a className="textLink" href="/docs">Read the setup guide <span>→</span></a></div><div className="examplePrompt"><span>Example request</span><p>“Use my configured Strapi project. Copy the homepage, update the hero title, and add the supplied CTA. Validate the draft and show me the diff.”</p><div><i /> The source page remains unchanged</div></div></section>
    <section className="ctaBand"><div><span className="kicker">READY TO START</span><h2>Paste the prompt. Codex handles setup.</h2><p>The local MCP uses your Strapi API token directly. No hosted service credential is involved.</p></div><a className="button light" href="#master-prompt">Get the prompt</a></section>
    <Footer />
  </main>;
}
