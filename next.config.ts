import type { NextConfig } from "next";

/**
 * Security headers for every response (docs/WEBSITE_SECURITY_PLAN.md 2.4).
 * The CSP is deliberately small: it stops other sites from framing ours
 * (clickjacking) and blocks <base>/plugin tricks, without a script policy — a
 * full `script-src` needs per-request nonces, which would force every page to
 * render dynamically. Try that later with Content-Security-Policy-Report-Only.
 */
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  // Clubs were renamed to Clans: keep old links and clan invite URLs working
  // (query strings such as ?invite=… are passed through).
  async redirects() {
    return [
      { source: "/clubs", destination: "/clans", permanent: true },
      { source: "/clubs/:path*", destination: "/clans/:path*", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
