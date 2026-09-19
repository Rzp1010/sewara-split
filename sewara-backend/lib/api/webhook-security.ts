// @ts-nocheck
import { timingSafeEqual } from "crypto";

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function validateWebhookSecret(request, secretEnvVar) {
  const secret = process.env[secretEnvVar];
  if (!secret) return { valid: false, reason: "secret_not_configured" };
  const headerValue = request.headers.get("x-webhook-secret");
  if (!headerValue) return { valid: false, reason: "missing_header" };
  if (!safeEqual(headerValue, secret)) return { valid: false, reason: "mismatch" };
  return { valid: true };
}
