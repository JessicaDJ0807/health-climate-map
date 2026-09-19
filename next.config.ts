import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't pick up a stray lockfile higher up.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
