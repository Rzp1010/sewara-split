// @ts-nocheck
/**
 * Proxy route — Next.js 16 replacement for middleware.
 * Handles CORS for dev (cross-origin) and passes through in production (Nginx same-origin).
 *
 * Local dev:  Frontend :3000 → Backend :4000 (cross-origin, CORS needed)
 * Production: Frontend + Backend via Nginx (same-origin, CORS passthrough)
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:3002",
  "http://localhost:4000",
].filter(Boolean);

export async function proxy(request: NextRequest) {
  // Preflight: return 204 with CORS headers
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin") || "";
    const headers: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
    };
    if (ALLOWED_ORIGINS.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    return new NextResponse(null, { status: 204, headers });
  }

  // Actual request: pass CORS header + forward
  const response = NextResponse.next();
  const origin = request.headers.get("origin") || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
