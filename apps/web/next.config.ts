import type { NextConfig } from 'next';

/**
 * Headers de segurança básicos. A CSP com nonce entra na F1, junto com a autenticação
 * (docs/architecture.md §7).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@f4d/ui'],
  headers: () => Promise.resolve([{ source: '/:path*', headers: securityHeaders }]),
};

export default config;
