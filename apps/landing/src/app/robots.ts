import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export const dynamic = 'force-static';

/** Fora de produção, bloqueia tudo: previews e staging nunca devem ser indexados. */
export default function robots(): MetadataRoute.Robots {
  if (!site.allowIndexing) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: new URL('/sitemap.xml', site.url).toString(),
  };
}
