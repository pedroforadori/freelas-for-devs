import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
];

/** Landing 100% estática (ADR-0011): HTML pronto no CDN, zero JS de cliente na v1. */
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@f4d/ui'],
  images: { formats: ['image/avif', 'image/webp'] },
  headers: () => Promise.resolve([{ source: '/:path*', headers: securityHeaders }]),
};

export default config;
