import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Disable the in-memory ISR cache so its (bounded) LRU doesn't add to the
  // heap. Any growth left is per-path state kept outside of the ISR cache.
  cacheMaxMemorySize: 0,
};

export default nextConfig;
