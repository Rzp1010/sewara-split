import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */
const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co").replace(/^https?:\/\//, "");
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const r2Domain = "*.r2.cloudflarestorage.com";
const isDev = process.env.NODE_ENV === "development";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `connect-src 'self' https://${supabaseHost} ${apiUrl}`,
      `img-src 'self' data: blob: https://${supabaseHost} https://${r2Domain}`,
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      // React dev mode butuh eval() untuk debugging; produksi TIDAK pakai eval -> tetap tanpa unsafe-eval
      isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
      `frame-src https://${r2Domain}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  // output: "standalone", // disabled — pakai node_modules langsung via PM2
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
