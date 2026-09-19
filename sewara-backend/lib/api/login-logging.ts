// @ts-nocheck
import { logError } from '@/lib/api/errors';

function extractClientIp(headers) {
  return (headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;
}

export async function logLoginEvent(admin, { email, ownerId, event, detail, headers }) {
  try {
    const ip = extractClientIp(headers);
    const ua = headers.get("user-agent") || null;
    await admin.from("login_logs").insert({ email, owner_id: ownerId || null, event, detail, ip, user_agent: ua });
  } catch (e) {
    logError(e, {
      operation: 'login_logging',
      email,
      event
    });
  }
}
