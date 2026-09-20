import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CORS handled by proxy.ts (dev) or Nginx reverse proxy (production).
  // No static CORS headers here — build-time env not reliable for multi-origin.
};

export default nextConfig;