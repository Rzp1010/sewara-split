// @ts-nocheck
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

async function buatServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
      cookieOptions: { sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", httpOnly: false },
    }
  );
}

// HANDOFF DATA (audit keamanan data 2026-08-10): hapusSemuaData dipindah
// dari client-side (db.js) ke server route — hapus seluruh data tenant HANYA
// untuk owner/superadmin (staf CS/Gudang dilarang — dulu bisa via console).
export async function POST(request) {
  try {
    const supabase = await buatServerClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY belum diatur di server." }, { status: 500 });
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role, user_id, owner_id, is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    // Hanya owner/superadmin; staf CS/Gudang DITOLAK
    if (!callerProfile) {
      return NextResponse.json({ error: "Akun Anda tidak memiliki profil/role." }, { status: 403 });
    }
    if (callerProfile.is_active === false) {
      return NextResponse.json({ error: "Akun Anda dinonaktifkan." }, { status: 403 });
    }
    if (callerProfile.role !== "owner" && callerProfile.role !== "superadmin") {
      return NextResponse.json({ error: "Anda tidak berhak menghapus data." }, { status: 403 });
    }

    // user_id data bisnis: owner → dirinya; superadmin → dirinya (tidak punya data tenant)
    const tenantId = callerProfile.role === "owner" ? callerProfile.user_id : callerProfile.owner_id || callerProfile.user_id;
    // superadmin tidak punya data bisnis sendiri → tidak ada yang dihapus
    if (callerProfile.role === "superadmin") {
      return NextResponse.json({ error: "Superadmin tidak memiliki data bisnis." }, { status: 400 });
    }

    // Hitung dulu total per tabel (untuk respons)
    const [c1, c2, c3] = await Promise.all([
      admin.from("inventory").select("id", { count: "exact", head: true }).eq("user_id", tenantId),
      admin.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", tenantId),
      admin.from("activity_logs").select("id", { count: "exact", head: true }).eq("user_id", tenantId),
    ]);

    // Hapus data bisnis tenant (service role → bypass RLS, sudah lolos cek role di atas).
    // URUTAN WAJIB: transactions DULU (CASCADE hapus transaction_items/payments),
    // baru inventory — FK fk_transaction_items_inventory ON DELETE RESTRICT menolak
    // hapus inventory yang masih direferensikan item transaksi.
    const { error: e2 } = await admin.from("transactions").delete().eq("user_id", tenantId);
    if (e2) {
      console.error("hapus transaksi error:", e2.message);
      return NextResponse.json({ error: "Gagal menghapus data transaksi." }, { status: 500 });
    }
    const { error: e1 } = await admin.from("inventory").delete().eq("user_id", tenantId);
    if (e1) {
      console.error("hapus inventaris error:", e1.message);
      return NextResponse.json({ error: "Gagal menghapus data inventaris." }, { status: 500 });
    }
    const { error: e3 } = await admin.from("activity_logs").delete().eq("user_id", tenantId);
    if (e3) {
      console.error("hapus log error:", e3.message);
      return NextResponse.json({ error: "Gagal menghapus data log." }, { status: 500 });
    }
    // Data pelanggan tenant (PII). transactions.member_id → SET NULL, aman setelah transaksi terhapus.
    for (const tabel of ["members", "member_types", "promo_codes"]) {
      const { error: ePel } = await admin.from(tabel).delete().eq("user_id", tenantId);
      if (ePel) {
        console.error(`hapus ${tabel} error:`, ePel.message);
        return NextResponse.json({ error: `Gagal menghapus data ${tabel}.` }, { status: 500 });
      }
    }

    // Reset invoice counter ke (mulai - 1)
    const mulai = parseInt(process.env.INVOICE_MULAI || "1") || 1;
    await admin.from("settings").upsert(
      { user_id: tenantId, key: "invoice_counter", value: JSON.stringify(String(mulai - 1)), updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" }
    );

    return NextResponse.json({ ok: true, total: { inventaris: c1?.count || 0, transaksi: c2?.count || 0, log: c3?.count || 0 } });
  } catch (err) {
    console.error("API admin data error:", err);
    return NextResponse.json({ error: "Terjadi kesalahan. Coba lagi." }, { status: 500 });
  }
}