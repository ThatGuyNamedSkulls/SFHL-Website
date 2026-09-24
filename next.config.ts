import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Clubs were renamed to Clans: keep old links and clan invite URLs working
  // (query strings such as ?invite=… are passed through).
  async redirects() {
    return [
      { source: "/clubs", destination: "/clans", permanent: true },
      { source: "/clubs/:path*", destination: "/clans/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
