// @ts-nocheck
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { checkLockout, checkCooldown, registerLoginFailure, resetLockout, MENIT_MS } from "@/lib/api/login-lockout";
import { checkLoginRateLimit } from "@/lib/api/login-rate-limit";
import { logLoginEvent } from "@/lib/api/login-logging";
import { notifyLoginToTelegram } from "@/lib/services/telegram";
import { withErrorHandler, logError } from "@/lib/api/errors";
import { parseAndValidate, loginSchema } from "@/lib/api/validation";
import { successResponse, validationErrorResponse, forbiddenResponse, unauthorizedResponse, internalErrorResponse } from "@/lib/api/response";

export const runtime = "nodejs";

async function loginHandler(request) {
  const validation = await parseAndValidate(request, loginSchema);
  if (!validation.success) return validationErrorResponse("Email dan password wajib diisi.");
  const { email, password } = validation.data;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) return internalErrorResponse("Server belum dikonfigurasi.");

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profil } = await admin.from("profiles").select("user_id, role, is_active, owner_id, failed_login, last_failed_at, cooldown_until, locked_until, status, subscribed_until").eq("email", email).maybeSingle();
  const now = Date.now();
  const gagal = (detail, error, status, extra, headers) => {
    logLoginEvent(admin, { email, ownerId: profil?.owner_id, event: "login_gagal", detail, headers: headers || request.headers }).catch((e) => logError(e, {
      route: '/api/auth/login',
      operation: 'log_login_event',
      email
    }));
    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;
    notifyLoginToTelegram(admin, { email, event: "login_gagal", detail, ip }).catch((e) => logError(e, {
      route: '/api/auth/login',
      operation: 'telegram_notification',
      email,
      event: 'login_gagal'
    }));
    if (status === 403) return forbiddenResponse(error);
    if (status === 401) return unauthorizedResponse(error);
    return NextResponse.json({ error, ...extra }, { status, ...(headers ? { headers } : {}) });
  };
  if (profil?.status === "menunggu") return gagal("akun menunggu persetujuan", "Akun Anda menunggu persetujuan admin.", 403);
  if (profil?.subscribed_until && new Date(profil.subscribed_until).getTime() < now) return gagal("langganan berakhir", "Langganan berakhir. Hubungi admin untuk perpanjang.", 401);
  if (profil?.user_id) {
    const { data: authUser, error: authUserErr } = await admin.auth.admin.getUserById(profil.user_id);
    if (!authUserErr && authUser?.user && !authUser.user.email_confirmed_at) return gagal("email belum diverifikasi", "Email belum diverifikasi. Periksa inbox email Anda.", 403);
  }
  if (profil && profil.is_active === false) return gagal("akun nonaktif", "Email atau password salah.", 401);
  const lockout = checkLockout(profil, now);
  if (lockout?.blocked) return gagal("akun terkunci", `Akun terkunci. Coba lagi sekitar ${lockout.jam} (${lockout.sisaMenit} menit) atau hubungi atasan.`, 423, { retryAfterMs: lockout.sisaMenit * MENIT_MS }, { "Retry-After": String(lockout.retryAfterSeconds) });
  const cooldown = checkCooldown(profil, now);
  if (cooldown?.blocked) return gagal("terlalu banyak percobaan", `Terlalu banyak percobaan. Coba lagi dalam ${cooldown.sisaMenit} menit.`, 429, { retryAfterMs: cooldown.sisaMenit * MENIT_MS }, { "Retry-After": String(cooldown.retryAfterSeconds) });
  const rateLimit = await checkLoginRateLimit(admin, email, request.headers, now);
  if (rateLimit.blocked) return gagal(`rate limit ${rateLimit.reason}`, "Terlalu banyak percobaan dari perangkat ini. Coba lagi nanti.", 429, { retryAfterMs: rateLimit.retryAfterMs }, { "Retry-After": String(rateLimit.retryAfterSeconds) });
  const cookieStore = await cookies();
  const isSecure = process.env.NODE_ENV === "production" || request.headers.get("x-forwarded-proto") === "https";
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: (list) => { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {} } },
    // cookieOptions: httpOnly=false WAJIB — app ini SPA client-heavy, sesi dibaca via document.cookie oleh createBrowserClient. httpOnly=true memutus alur session (getSession() tak melihat cookie). secure hanya kalau request via HTTPS (deteksi x-forwarded-proto dari Nginx/Cloudflare).
    cookieOptions: { sameSite: "lax", path: "/", secure: isSecure, httpOnly: false },
  });
  const { data: sess, error: signErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signErr || !sess?.session) {
    logLoginEvent(admin, { email, ownerId: profil?.owner_id, event: "login_gagal", detail: profil ? "password salah" : "email tidak dikenal", headers: request.headers }).catch((e) => logError(e, {
      route: '/api/auth/login',
      operation: 'log_login_event',
      email
    }));
    await registerLoginFailure(admin, profil, now);
    return unauthorizedResponse("Email atau password salah.");
  }
  await resetLockout(admin, profil?.user_id);
  await logLoginEvent(admin, { email, ownerId: profil?.owner_id || profil?.user_id, event: "login_sukses", detail: null, headers: request.headers });
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;
  notifyLoginToTelegram(admin, { email, event: "login_sukses", detail: null, ip }).catch((e) => logError(e, {
    route: '/api/auth/login',
    operation: 'telegram_notification',
    email,
    event: 'login_sukses'
  }));
  return successResponse({ ok: true });
}

export const POST = withErrorHandler(loginHandler);
