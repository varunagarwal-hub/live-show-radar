import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@radar/core", "@radar/config", "@radar/sources"],
  // PGlite is only used by tests; keep it out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "node-ical"],
  poweredByHeader: false,
  devIndicators: false,
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
