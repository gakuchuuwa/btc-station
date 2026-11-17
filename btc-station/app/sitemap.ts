import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://quant-lab.org'
  const now = new Date().toISOString()

  return [
    { url: base, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${base}/strategy`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/monte-carlo`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/report`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/pattern-report`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
