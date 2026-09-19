// @ts-nocheck
import { RATE_LIMITS } from './constants';

// Parse window string to milliseconds (e.g., "10m" -> 600000)
function parseWindow(window) {
  const match = window.match(/^(\d+)([smh])$/);
  if (!match) return 600000; // default 10 minutes
  const value = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: return 600000;
  }
}

const RATE_LIMIT_WINDOW_MS = parseWindow(RATE_LIMITS.LOGIN_IP_FAILURES.window);
const IP_LIMIT = RATE_LIMITS.LOGIN_IP_FAILURES.requests;
const EMAIL_LIMIT = RATE_LIMITS.LOGIN_EMAIL_FAILURES.requests;

function extractClientIp(headers) {
  return (headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;
}

export async function checkLoginRateLimit(admin, email, headers, now) {
  const sejak = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString();
  const ip = extractClientIp(headers);
  const [ipResult, emailResult] = await Promise.all([
    ip ? admin.from("login_logs").select("id", { count: "exact", head: true }).eq("ip", ip).eq("event", "login_gagal").gte("created_at", sejak) : Promise.resolve({ count: 0, error: null }),
    admin.from("login_logs").select("id", { count: "exact", head: true }).eq("email", email).eq("event", "login_gagal").gte("created_at", sejak),
  ]);

  if (ip && !ipResult.error && ipResult.count >= IP_LIMIT) {
    return { blocked: true, reason: "ip", retryAfterSeconds: 600, retryAfterMs: RATE_LIMIT_WINDOW_MS };
  }
  if (!emailResult.error && emailResult.count >= EMAIL_LIMIT) {
    return { blocked: true, reason: "email", retryAfterSeconds: 600, retryAfterMs: RATE_LIMIT_WINDOW_MS };
  }
  return { blocked: false };
}
