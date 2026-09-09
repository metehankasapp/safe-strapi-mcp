import { Footer, Header } from '../ui';
import { StatusClient } from './status-client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Service Status',
  description: 'Live availability for the Safe Strapi MCP gateway and audit store.',
  alternates: { canonical: '/status' },
};

export default function Status() {
  return (
    <main>
      <Header />
      <article className="simplePage statusPage">
        <span className="kicker">SERVICE STATUS</span>
        <h1>Safe Strapi status</h1>
        <p className="lead">Live checks for the public MCP gateway and its persistent audit store.</p>
        <StatusClient />
        <div className="statusRows">
          <div><span><i />MCP gateway</span><strong>Monitored</strong></div>
          <div><span><i />D1 audit database</span><strong>Monitored</strong></div>
          <div><span><i />Documentation</span><strong>Monitored</strong></div>
          <div><span><i className="neutral" />Connected Strapi projects</span><strong>Configured separately</strong></div>
        </div>
        <p className="statusNote">This page confirms that Safe Strapi is available. Individual Strapi projects may have their own availability and permissions.</p>
      </article>
      <Footer />
    </main>
  );
}
