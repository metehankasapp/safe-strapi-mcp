import { Footer, Header } from '../ui';
import { StatusClient } from './status-client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Service Status',
  description: 'Live availability for Safe Strapi documentation and setup resources.',
  alternates: { canonical: '/status' },
};

export default function Status() {
  return (
    <main>
      <Header />
      <article className="simplePage statusPage">
        <span className="kicker">SERVICE STATUS</span>
        <h1>Safe Strapi status</h1>
        <p className="lead">Live checks for the documentation and setup service. Strapi connections run locally in each project.</p>
        <StatusClient />
        <div className="statusRows">
          <div><span><i />Master prompt</span><strong>Available</strong></div>
          <div><span><i />Local MCP package</span><strong>npm</strong></div>
          <div><span><i />Documentation</span><strong>Monitored</strong></div>
          <div><span><i className="neutral" />Connected Strapi projects</span><strong>Configured separately</strong></div>
        </div>
        <p className="statusNote">The hosted /mcp route is intentionally disabled. Each Strapi project connects through the local stdio package without an MCP access key.</p>
      </article>
      <Footer />
    </main>
  );
}
