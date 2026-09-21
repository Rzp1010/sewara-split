// @ts-nocheck
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { successResponse, errorResponse } from "@/lib/api/response";

export const runtime = "nodejs";

// Rate-limit per-IP in-memory: maks 5 pendaftaran per 10 menit per IP.
// Data sesaat proses — cukup untuk meredam spam sederhana.
const RIWAYAT = new Map();
const MAKS_DAFTAR = 5;
const JENDELA_MS = 10 * 60000;

function cekRateLimit(ip) {
  const kini = Date.now();
  const jendelaAwal = kini - JENDELA_MS;
  const list = (RIWAYAT.get(ip) || []).filter((t) => t > jendelaAwal);
  if (list.length >= MAKS_DAFTAR) return true;
  list.push(kini);
  RIWAYAT.set(ip, list);
  return false;
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const email = String(body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(body?.password || "");
    const nama_lengkap = String(body?.nama_lengkap || "").trim();
    const nama_bisnis = String(body?.nama_bisnis || "").trim();

    if (!email || !RE_EMAIL.test(email)) {
      return NextResponse.json(
        { error: "Format email tidak valid." },
        { status: 400 },
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password minimal 8 karakter." },
        { status: 400 },
      );
    }
    if (!nama_lengkap) {
      return NextResponse.json(
        { error: "Nama lengkap wajib diisi." },
        { status: 400 },
      );
    }

    const ip =
      (request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() ||
      "unknown";
    if (cekRateLimit(ip)) {
      return NextResponse.json(
        { error: "Terlalu banyak pendaftaran. Coba lagi nanti." },
        { status: 429 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const frontendUrl = process.env.FRONTEND_URL || new URL(request.url).origin;
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return errorResponse("Server belum dikonfigurasi.", undefined, 500);
    }

    const emailRedirectTo = `${frontendUrl}/api/auth/callback`;
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: created, error: signupErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: {
          nama_lengkap,
          username: email,
          nama_invoice: nama_bisnis || nama_lengkap,
          status: "menunggu",
        },
      },
    });

    // Input VALID selalu balas 200 { ok:true } — termasuk saat email sudah terdaftar.
    // Supabase dapat mengembalikan identities kosong untuk email yang sudah ada.
    if (signupErr || !created?.user || created.user.identities?.length === 0) {
      if (signupErr) console.error("register signUp:", signupErr.message);
      return successResponse({ ok: true });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: profileErr } = await admin.from("profiles").upsert(
      {
        user_id: created.user.id,
        email,
        role: "owner",
        nama_lengkap,
        username: email,
        nama_invoice: nama_bisnis || nama_lengkap,
        is_active: false,
        status: "menunggu",
        owner_id: null,
      },
      { onConflict: "email" },
    );
    if (profileErr) {
      console.error("register upsert profil:", profileErr.message);
      return successResponse({ ok: true });
    }

    try {
      await admin.rpc("rpc_tambah_admin_log", {
        p_actor: email,
        p_aksi: "daftar",
        p_target: email,
        p_detail: "menunggu persetujuan",
      });
    } catch (e) {
      console.error("rpc_tambah_admin_log register error:", e.message);
    }

    return successResponse({ ok: true });
  } catch (err) {
    console.error("API auth register error:", err);
    return NextResponse.json(
      { error: "Terjadi kesalahan. Coba lagi." },
      { status: 500 },
    );
  }
}
