import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const baseUrl = 'https://safe-strapi-mcp.metehankasapp.workers.dev';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${baseUrl}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/docs`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/prompts`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/prompts.md`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/security`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/status`, changeFrequency: 'daily', priority: 0.5 },
  ];
}
