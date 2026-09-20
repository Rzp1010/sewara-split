// @ts-nocheck
import { createClient } from "@supabase/supabase-js";
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  validationErrorResponse,
  internalErrorResponse,
} from "@/lib/api/response";
import { withErrorHandler } from "@/lib/api/errors";
import { getServerClient } from "@/lib/api/supabase";
import {
  parseAndValidate,
  createUserSchema,
  deleteUserByEmailSchema,
  adminPatchSchema,
} from "@/lib/api/validation";
import {
  checkRateLimit,
  adminCreateUserLimiter,
  adminDeleteUserLimiter,
  adminPatchUserLimiter,
} from "@/lib/api/rate-limit";
import {
  createUser,
  deleteAdminUser,
  applyUserPatch,
} from "@/lib/services/admin-user";
import { logAdminAction } from "@/lib/services/audit";
import { requireAuth, requireRole } from '@/lib/api/auth';
import { getServiceRoleClient } from '@/lib/api/supabase';

export const runtime = "nodejs";

async function listUsersHandler(request) {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, owner_id, user_id')
    .eq('user_id', user.id)
    .single();

  await requireRole(profile, ['owner', 'superadmin']);

  const serviceSupabase = getServiceRoleClient();

  let query = serviceSupabase
    .from('profiles')
    .select('user_id, email, nama_lengkap, username, role, owner_id, is_active, status, subscribed_until, created_at')
    .order('created_at', { ascending: false });

  if (profile.role === 'owner') {
    query = query.eq('owner_id', profile.user_id);
  }

  const { data: users, error } = await query;
  if (error) throw error;

  // Aggregate jumlah_staff per owner (untuk superadmin view)
  if (profile.role === 'superadmin') {
    const staffCounts = {};
    users.forEach(u => {
      if (u.owner_id && u.role !== 'owner') {
        staffCounts[u.owner_id] = (staffCounts[u.owner_id] || 0) + 1;
      }
    });
    users.forEach(u => {
      if (u.role === 'owner') {
        u.jumlah_staff = staffCounts[u.user_id] || 0;
      }
    });
  }

  return successResponse({ users });
}

async function usersHandler(request) {
  const bodyResult = await parseAndValidate(request, createUserSchema);
  if (!bodyResult.success) {
    return validationErrorResponse("Input tidak valid.", bodyResult.errors);
  }
  const { email, password, nama_lengkap, username, nama_invoice, role } =
    bodyResult.data;

  const supabase = await getServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return unauthorizedResponse("Tidak terautentikasi.");
  }

  // Rate limit per user terautentikasi (bukan IP — di lokal semua request "unknown",
  // di kantor satu IP dipakai banyak staf; bucket per user lebih akurat).
  const rateLimitResponse = await checkRateLimit(
    adminCreateUserLimiter,
    user.id,
    "Terlalu banyak percobaan pembuatan user. Coba lagi nanti.",
  );
  if (rateLimitResponse) return rateLimitResponse;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return internalErrorResponse(
      "SUPABASE_SERVICE_ROLE_KEY belum diatur di server.",
    );
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const callerEmail = (user?.email || "").toLowerCase();
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, owner_id, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  const callerRole = callerProfile?.role;

  if (!callerRole) {
    return forbiddenResponse("Akun Anda tidak memiliki profil/role.");
  }
  if (callerProfile?.is_active === false) {
    return forbiddenResponse("Akun Anda dinonaktifkan.");
  }
  if (callerRole === "superadmin") {
    if (role !== "owner") {
      return forbiddenResponse("Superadmin hanya bisa membuat akun Owner.");
    }
  } else if (callerRole === "owner") {
    if (role === "owner") {
      return forbiddenResponse("Owner tidak bisa membuat owner lain.");
    }
  } else {
    return forbiddenResponse("Akun Anda tidak berhak menambah user.");
  }

  const targetOwnerId = callerRole === "owner" ? user.id : null;

  const created = await createUser({
    email,
    password,
    nama_lengkap,
    username,
    nama_invoice,
    role,
    ownerId: targetOwnerId,
    actorEmail: callerEmail,
  });
  if (!created.success) {
    const status = created.status || 500;
    return errorResponse(created.error, undefined, status);
  }

  return successResponse({ ok: true });
}

async function deleteHandler(request) {
  const bodyResult = await parseAndValidate(request, deleteUserByEmailSchema);
  if (!bodyResult.success)
    return validationErrorResponse("Input tidak valid.", bodyResult.errors);
  const { email: targetEmail } = bodyResult.data;

  const supabase = await getServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return unauthorizedResponse("Tidak terautentikasi.");
  }

  // Rate limit per user terautentikasi — alasan sama dengan POST di atas.
  const rateLimitResponse = await checkRateLimit(
    adminDeleteUserLimiter,
    user.id,
    "Terlalu banyak percobaan penghapusan user. Coba lagi nanti.",
  );
  if (rateLimitResponse) return rateLimitResponse;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return internalErrorResponse(
      "SUPABASE_SERVICE_ROLE_KEY belum diatur di server.",
    );
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const callerEmail = (user?.email || "").toLowerCase();
  const { data: callerProfile, error: callerProfileError } = await admin
    .from("profiles")
    .select("role, user_id, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerProfileError) {
    console.error(
      "[DELETE] Caller profile query failed:",
      callerProfileError.message,
    );
    return internalErrorResponse("Gagal memeriksa profil admin.");
  }

  const callerRole = callerProfile?.role;

  if (!callerProfile || !callerRole) {
    return forbiddenResponse("Akun Anda tidak memiliki profil/role.");
  }

  if (callerProfile?.is_active === false) {
    return forbiddenResponse("Akun Anda dinonaktifkan.");
  }

  const { data: targetProfile, error: targetProfileError } = await admin
    .from("profiles")
    .select("user_id, email, role, owner_id")
    .eq("email", targetEmail)
    .maybeSingle();

  if (targetProfileError) {
    console.error(
      "[DELETE] Target profile query failed:",
      targetProfileError.message,
    );
    return internalErrorResponse("Gagal mencari profil target.");
  }

  if (!targetProfile) {
    return errorResponse("Akun tidak ditemukan.", undefined, 404);
  }
  if (targetProfile.role === "superadmin") {
    return forbiddenResponse("Tidak bisa menghapus superadmin.");
  }

  // Izin: superadmin boleh hapus siapa saja (kecuali superadmin); owner boleh hapus stafnya sendiri.
  // 404 seragam utk yang tidak berhak — hindari email enumeration (audit #6).
  if (callerRole === "superadmin") {
    // ok
  } else if (callerRole === "owner" && targetProfile.owner_id === user.id) {
    // ok, owner menghapus stafnya
  } else {
    return errorResponse("Akun tidak ditemukan.", undefined, 404);
  }

  // Larang hapus akun SENDIRI — profil owner memakai owner_id = user_id sendiri (self-reference),
  // jadi cek "owner_id === user.id" TIDAK cukup membedakan staf vs diri sendiri.
  if (targetProfile.user_id === user.id) {
    return forbiddenResponse("Tidak bisa menghapus akun sendiri.");
  }

  const result = await deleteAdminUser({
    admin,
    targetEmail,
    targetProfile,
    actorEmail: callerEmail,
  });
  if (!result.success)
    return errorResponse(result.error, undefined, result.status || 500);
  return successResponse({ dihapus: result.deleted });
}

async function patchHandler(request) {
  const bodyResult = await parseAndValidate(request, adminPatchSchema);
  if (!bodyResult.success)
    return validationErrorResponse("Input tidak valid.", bodyResult.errors);
const {
    email,
    action,
    durasi = 0,
    new_password,
    nama_lengkap = "",
    username = "",
    nama_invoice = "",
    role,
  } = bodyResult.data;
  const password = new_password || "";
  const unlock = action === "unlock_akun";
  const approve = action === "setujui_registrasi";
  const reject = action === "tolak_registrasi";
  const perpanjang = action === "perpanjang_langganan" ? durasi : 0;

  const supabase = await getServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return unauthorizedResponse("Tidak terautentikasi.");
  }

  // Rate limit per user terautentikasi — alasan sama dengan POST/DELETE di atas.
  const rateLimitResponse = await checkRateLimit(
    adminPatchUserLimiter,
    user.id,
    "Terlalu banyak percobaan perubahan user. Coba lagi nanti.",
  );
  if (rateLimitResponse) return rateLimitResponse;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return internalErrorResponse(
      "SUPABASE_SERVICE_ROLE_KEY belum diatur di server.",
    );
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const callerEmail = (user?.email || "").toLowerCase();
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  const callerRole = callerProfile?.role;

  if (callerProfile?.is_active === false) {
    return forbiddenResponse("Akun Anda dinonaktifkan.");
  }

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("user_id, email, role, owner_id, subscribed_until")
    .eq("email", email)
    .maybeSingle();
  if (!targetProfile) {
    return errorResponse("Akun tidak ditemukan.", undefined, 404);
  }
  if (targetProfile.role === "superadmin") {
    return forbiddenResponse("Tidak bisa mengedit superadmin.");
  }

  // Izin: superadmin boleh edit siapa pun (kecuali superadmin); owner boleh edit stafnya sendiri & akunnya sendiri.
  // 404 seragam utk yang tidak berhak — hindari email enumeration (audit #6).
  if (callerRole === "superadmin") {
    // ok
  } else if (
    callerRole === "owner" &&
    (targetProfile.owner_id === user.id || targetProfile.user_id === user.id)
  ) {
    // ok, owner mengedit stafnya atau akunnya sendiri (self-service username/nama di Pengaturan)
  } else {
    return errorResponse("Akun tidak ditemukan.", undefined, 404);
  }

const DURASI_VALID = [1, 3, 6, 12];

  if (action === "set_role") {
    if (!role) return validationErrorResponse("Role wajib diisi.");
    if (targetProfile.user_id === user.id)
      return forbiddenResponse("Anda tidak bisa mengubah role sendiri.");
    if (role === "owner" && callerRole !== "superadmin")
      return forbiddenResponse("Hanya Superadmin yang bisa memberi role owner.");
    const { error } = await admin
      .from("profiles")
      .update({ role })
      .eq("email", email);
    if (error) return errorResponse("Gagal mengubah role.", undefined, 500);
    logAdminAction(callerEmail, "set_role", email, `role=${role}`).catch(() => {});
    return successResponse({ ok: true });
  }

  if (action === "toggle_active") {
    if (targetProfile.user_id === user.id)
      return forbiddenResponse("Anda tidak bisa menonaktifkan akun sendiri.");
    if (targetProfile.role === "owner" && callerRole !== "superadmin")
      return forbiddenResponse("Hanya Superadmin yang bisa mengubah status Owner.");
    const { data: current } = await admin
      .from("profiles")
      .select("is_active")
      .eq("email", email)
      .maybeSingle();
    const berikutnya = current?.is_active === false;
    const { error } = await admin
      .from("profiles")
      .update({ is_active: berikutnya })
      .eq("email", email);
    if (error) return errorResponse("Gagal mengubah status akun.", undefined, 500);
    logAdminAction(
      callerEmail,
      "toggle_active",
      email,
      berikutnya ? "diaktifkan" : "dinonaktifkan",
    ).catch(() => {});
    return successResponse({ ok: true, is_active: berikutnya });
  }

  if (approve || reject || perpanjang > 0) {
    if (callerRole !== "superadmin")
      return forbiddenResponse(
        "Hanya Superadmin yang bisa melakukan aksi ini.",
      );
    if (targetProfile.role !== "owner")
      return forbiddenResponse("Aksi ini hanya untuk akun Owner.");
    if (targetProfile.user_id === user.id)
      return forbiddenResponse("Superadmin tidak bisa mengubah akun sendiri.");
    if (
      (approve && !DURASI_VALID.includes(durasi)) ||
      (perpanjang > 0 && !DURASI_VALID.includes(perpanjang))
    )
      return validationErrorResponse(
        "Durasi langganan tidak valid (1/3/6/12 bulan).",
      );
    const result = await applyUserPatch({
      admin,
      targetEmail: email,
      targetProfile,
      actorEmail: callerEmail,
      password,
      nama_lengkap,
      username,
      nama_invoice,
      unlock,
      approve,
      reject,
      perpanjang,
      durasi,
    });
    if (result.error)
      return errorResponse(result.error, undefined, result.status || 500);
    return successResponse({ ok: true });
  }

  if (unlock) {
    if (targetProfile.user_id === user.id)
      return forbiddenResponse(
        "Anda tidak bisa membuka kunci akun sendiri. Hubungi atasan.",
      );
    const result = await applyUserPatch({
      admin,
      targetEmail: email,
      targetProfile,
      actorEmail: callerEmail,
      password,
      nama_lengkap,
      username,
      nama_invoice,
      unlock,
      approve,
      reject,
      perpanjang,
      durasi,
    });
    if (result.error)
      return errorResponse(result.error, undefined, result.status || 500);
    return successResponse({ ok: true });
  }

  const result = await applyUserPatch({
    admin,
    targetEmail: email,
    targetProfile,
    actorEmail: callerEmail,
    password,
    nama_lengkap,
    username,
    nama_invoice,
    unlock,
    approve,
    reject,
    perpanjang,
    durasi,
  });
  if (result.error)
    return errorResponse(result.error, undefined, result.status || 500);
  return successResponse({ ok: true });
}

export const GET = withErrorHandler(listUsersHandler);
export const POST = withErrorHandler(usersHandler);
export const DELETE = withErrorHandler(deleteHandler);
export const PATCH = withErrorHandler(patchHandler);
