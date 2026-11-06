import type { NextConfig } from "next";

// cacheComponents is intentionally off: almost every DropCart page depends on
// the signed-in user, and Channel3 responses are cached in Postgres
// (CatalogueCache) rather than in the framework cache.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Channel3 product images come from many merchant CDNs; we render them
    // with plain <img> tags, so no remote allow-list is needed here.
    unoptimized: true,
  },
};

export default nextConfig;
