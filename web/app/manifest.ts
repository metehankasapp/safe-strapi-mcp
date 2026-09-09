import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Safe Strapi MCP',
    short_name: 'Safe Strapi',
    description: 'Clone-first content operations for Strapi 5.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#4945ff',
    icons: [
      { src: '/strapi-monogram.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
