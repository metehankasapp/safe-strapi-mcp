import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/mcp'] },
    sitemap: 'https://safe-strapi-mcp.metehankasapp.workers.dev/sitemap.xml',
    host: 'https://safe-strapi-mcp.metehankasapp.workers.dev',
  };
}
