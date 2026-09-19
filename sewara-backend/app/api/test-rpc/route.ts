// @ts-nocheck
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
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
      cookieOptions: {
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        httpOnly: false,
      },
    },
  );
}

/**
 * Test RPC `save_transaction_atomic` dengan authenticated user.
 *
 * Query params:
 * - scenario=success → test payload valid
 * - scenario=rollback → test child invalid (trigger rollback)
 * - scenario=tenant → test tenant isolation (coba save ke tenant lain)
 */
export async function GET(request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Not Found" } },
      { status: 404 },
    );
  }
  try {
    const supabase = await buatServerClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "AUTH_REQUIRED", message: "Tidak terautentikasi." },
        },
        { status: 401 },
      );
    }

    // Get user profile untuk tenant_id
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("user_id, owner_id, role")
      .eq("user_id", user.id)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "PROFILE_NOT_FOUND",
            message: "Profil user tidak ditemukan.",
          },
        },
        { status: 403 },
      );
    }

    const tenantId = profile.owner_id || profile.user_id;
    const { searchParams } = new URL(request.url);
    const scenario = searchParams.get("scenario") || "success";

    let testResult = {};

    // === SCENARIO 1: SUCCESS ===
    if (scenario === "success") {
      const transactionData = {
        id: Date.now(),
        id_transaksi: `TEST-${Date.now()}`,
        penyewa: "[TEST] Customer RPC",
        hp_penyewa: "08123456789",
        // Note: status column is enum_status_transaksi, not text
        waktu_ambil_rencana: "2026-09-10T10:00:00Z",
        waktu_kembali_rencana: "2026-09-12T10:00:00Z",
        durasi_teks: "2 hari",
        total_akhir: 50000,
      };

      const items = [
        {
          nama: "Test Item",
          jenis: "satuan",
          qty: 1,
          harga: 50000,
          subtotal: 50000,
        },
      ];

      const { data, error } = await supabase.rpc("rpc_save_transaction", {
        p_transaction: transactionData,
        p_items: items,
        p_payments: [],
        p_replace_items: true,
        p_replace_payments: true,
      });

      if (error) {
        testResult = {
          scenario: "success",
          status: "FAILED",
          error: error.message,
          code: error.code,
          hint: error.hint,
        };
      } else {
        testResult = {
          scenario: "success",
          status: "PASS",
          transaction_id: data?.id,
          transaction_data: data,
          message: "RPC berhasil create transaction dengan item",
        };

        // Cleanup: hapus test data (id bisa 0, jangan pakai falsy check)
        if (data?.id != null) {
          await supabase
            .from("transaction_items")
            .delete()
            .eq("transaction_id", data.id);
          await supabase.from("transactions").delete().eq("id", data.id);
        }
      }
    }

    // === SCENARIO 2: ROLLBACK ===
    else if (scenario === "rollback") {
      const transactionData = {
        id: Date.now(),
        id_transaksi: `TEST-ROLLBACK-${Date.now()}`,
        penyewa: "[TEST] Rollback",
        hp_penyewa: "08123456789",
        // Note: status omitted, will use default 'Booking'
        waktu_ambil_rencana: "2026-09-10T10:00:00Z",
        waktu_kembali_rencana: "2026-09-12T10:00:00Z",
        durasi_teks: "2 hari",
        total_akhir: 50000,
      };

      const items = [
        {
          inventory_id: 99999999, // Invalid FK - akan trigger rollback
          nama: "Invalid Item",
          jenis: "satuan",
          qty: 1,
          harga: 50000,
          subtotal: 50000,
        },
      ];

      const { data, error } = await supabase.rpc("rpc_save_transaction", {
        p_transaction: transactionData,
        p_items: items,
        p_payments: [],
        p_replace_items: true,
        p_replace_payments: true,
      });

      if (error) {
        testResult = {
          scenario: "rollback",
          status: "PASS",
          message: "RPC correctly rolled back pada invalid child",
          error_code: error.code,
          error_message: error.message,
        };

        // Verify parent tidak tersimpan
        const { count } = await supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("penyewa", "[TEST] Rollback");

        testResult.parent_leaked =
          count > 0 ? "FAIL - parent tersimpan" : "PASS - no leak";
      } else {
        testResult = {
          scenario: "rollback",
          status: "FAILED",
          message: "RPC seharusnya gagal dengan invalid inventory_id",
          transaction_id: data?.id,
          transaction_data: data,
        };

        // Cleanup jika somehow succeed
        if (data?.id != null) {
          await supabase
            .from("transaction_items")
            .delete()
            .eq("transaction_id", data.id);
          await supabase.from("transactions").delete().eq("id", data.id);
        }
      }
    }

    // === SCENARIO 3: TENANT ISOLATION ===
    else if (scenario === "tenant") {
      // Coba save dengan user_id berbeda (bukan tenantId)
      const fakeTenantId =
        tenantId === "00000000-0000-0000-0000-000000000001"
          ? "00000000-0000-0000-0000-000000000002"
          : "00000000-0000-0000-0000-000000000001";

      const transactionData = {
        id: Date.now(),
        id_transaksi: `TEST-BREACH-${Date.now()}`,
        penyewa: "[TEST] Tenant Breach",
        hp_penyewa: "08123456789",
        // Note: status omitted, will use default 'Booking'
        waktu_ambil_rencana: "2026-09-10T10:00:00Z",
        waktu_kembali_rencana: "2026-09-12T10:00:00Z",
        durasi_teks: "2 hari",
        total_akhir: 50000,
        user_id: fakeTenantId, // Coba inject tenant lain
      };

      const { data, error } = await supabase.rpc("rpc_save_transaction", {
        p_transaction: transactionData,
        p_items: [],
        p_payments: [],
        p_replace_items: true,
        p_replace_payments: true,
      });

      if (error && (error.code === "42501" || error.code === "28000")) {
        testResult = {
          scenario: "tenant",
          status: "PASS",
          message: "RPC correctly blocked cross-tenant save",
          error_code: error.code,
          error_message: error.message,
        };
      } else if (error) {
        testResult = {
          scenario: "tenant",
          status: "UNKNOWN",
          message: "RPC failed tapi bukan karena tenant isolation",
          error_code: error.code,
          error_message: error.message,
        };
      } else {
        // Check apakah data tersimpan dengan tenant yang salah
        const savedTenant = data?.user_id;

        testResult = {
          scenario: "tenant",
          status: savedTenant === tenantId ? "PASS" : "CRITICAL_FAIL",
          message:
            savedTenant === tenantId
              ? "RPC ignored fake tenant_id and used authenticated user's tenant (CORRECT)"
              : "RPC allowed cross-tenant save (SECURITY BREACH)",
          transaction_id: data?.id,
          attempted_tenant: fakeTenantId,
          actual_tenant: tenantId,
          saved_tenant: savedTenant,
        };

        // Cleanup
        if (data?.id != null) {
          await supabase.from("transactions").delete().eq("id", data.id);
        }
      }
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_SCENARIO",
            message: "Gunakan ?scenario=success|rollback|tenant",
          },
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        user_id: user.id,
        tenant_id: tenantId,
        role: profile.role,
        test: testResult,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[test-rpc] Error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: err.message,
        },
      },
      { status: 500 },
    );
  }
}
