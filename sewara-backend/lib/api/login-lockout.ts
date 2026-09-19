// @ts-nocheck
import { logError } from '@/lib/api/errors';

export const MENIT_MS = 60000;
export const DECAY_MS = 24 * 3600000;

// Tangga penalti (PLAN_KEAMANAN_LOGIN.md Fitur A)
export function terapkanTangga(failedLogin, now) {
  if (failedLogin >= 9) {
    return {
      locked_until: new Date(now + 30 * MENIT_MS).toISOString(),
      cooldown_until: null,
    };
  }
  if (failedLogin >= 6) {
    return { cooldown_until: new Date(now + 2 * MENIT_MS).toISOString() };
  }
  if (failedLogin >= 3) {
    return { cooldown_until: new Date(now + MENIT_MS).toISOString() };
  }
  return {};
}

export function checkLockout(profile, now) {
  if (!profile?.locked_until) return null;
  const lockedUntilMs = new Date(profile.locked_until).getTime();
  if (lockedUntilMs <= now) return null;

  const sisa = Math.max(1, Math.ceil((lockedUntilMs - now) / MENIT_MS));
  const jam = new Date(profile.locked_until).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return { blocked: true, sisaMenit: sisa, jam, retryAfterSeconds: Math.ceil(sisa * 60) };
}

export function checkCooldown(profile, now) {
  if (!profile?.cooldown_until) return null;
  const cooldownUntilMs = new Date(profile.cooldown_until).getTime();
  if (cooldownUntilMs <= now) return null;

  const sisa = Math.max(1, Math.ceil((cooldownUntilMs - now) / MENIT_MS));
  return { blocked: true, sisaMenit: sisa, retryAfterSeconds: Math.ceil(sisa * 60) };
}

export async function registerLoginFailure(admin, profile, now) {
  if (!profile?.user_id) return null;

  let failedLogin = null;
  try {
    const { data: flBaru } = await admin.rpc("rpc_register_login_failure", {
      p_user_id: profile.user_id,
    });
    failedLogin = Number(flBaru);
  } catch (e) {
    logError(e, {
      operation: 'register_login_failure',
      userId: profile.user_id
    });
    const lastFailedMs = profile.last_failed_at ? new Date(profile.last_failed_at).getTime() : 0;
    failedLogin = now - lastFailedMs >= DECAY_MS ? 1 : (profile.failed_login || 0) + 1;
    const patch = {
      failed_login: failedLogin,
      last_failed_at: new Date(now).toISOString(),
      ...terapkanTangga(failedLogin, now),
    };
    await admin.from("profiles").update(patch).eq("user_id", profile.user_id);
    return failedLogin;
  }

  const patch = terapkanTangga(failedLogin, now);
  if (Object.keys(patch).length > 0) {
    await admin.from("profiles").update(patch).eq("user_id", profile.user_id);
  }
  return failedLogin;
}

export async function resetLockout(admin, userId) {
  if (!userId) return;
  await admin.from("profiles").update({
    failed_login: 0,
    last_failed_at: null,
    cooldown_until: null,
    locked_until: null,
  }).eq("user_id", userId);
}
