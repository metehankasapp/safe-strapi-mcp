import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://safe-strapi-mcp.metehankasapp.workers.dev'),
  title: {
    default: 'Safe Strapi MCP — Schema-first content entry',
    template: '%s | Safe Strapi MCP',
  },
  description: 'Inspect Strapi 5 schemas and APIs, preview content, write collections, single types and media, then verify every result.',
  applicationName: 'Safe Strapi MCP',
  keywords: ['Strapi MCP', 'Strapi 5', 'content automation', 'Model Context Protocol', 'Strapi draft workflow'],
  category: 'developer tools',
  alternates: { canonical: '/' },
  icons: {
    icon: [{ url: '/strapi-monogram.svg', type: 'image/svg+xml' }],
    shortcut: '/strapi-monogram.svg',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Safe Strapi MCP',
    title: 'Safe Strapi MCP — Preview, edit, verify',
    description: 'Schema-first Strapi 5 content entry with linked languages, media uploads, reviewed previews and post-write verification.',
    locale: 'en_US',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Safe Strapi MCP — clone-first content operations for Strapi 5' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Safe Strapi MCP',
    description: 'Schema-first content entry and protected draft editing for Strapi 5.',
    images: ['/og-image.png'],
  },
  robots: { index: true, follow: true },
};

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Safe Strapi MCP',
  url: 'https://safe-strapi-mcp.metehankasapp.workers.dev/',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Cross-platform',
  description: 'A local MCP for inspecting Strapi schemas and APIs, previewing content entry and verifying API writes.',
  softwareVersion: '0.3.0',
  softwareRequirements: 'Strapi 5 or newer; an MCP-compatible client',
  isAccessibleForFree: true,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
        {children}
      </body>
    </html>
  );
}
