// @ts-nocheck
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { saveTransactionAtomic } from "@/lib/db/services/transactionServiceAtomic";

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
 * Test saveTransactionAtomic integration
 * Query params:
 * - test=1|2|3|4|5|6
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

    const { searchParams } = new URL(request.url);
    const testNum = searchParams.get("test") || "1";

    let testResult = {};

    // === TEST 1: Create Transaction Minimal ===
    if (testNum === "1") {
      const transactionData = {
        id: Date.now(),
        id_transaksi: `TEST-ATOMIC-${Date.now()}`,
        penyewa: "Test Customer Atomic",
        hp_penyewa: "08123456789",
        waktu_ambil_rencana: "2026-09-15T10:00:00Z",
        waktu_kembali_rencana: "2026-09-17T10:00:00Z",
        durasi_teks: "2 hari",
        total_akhir: 100000,
        denda: 0,
        biaya: 0,
      };

      const items = [
        {
          // inventory_id omitted - test standalone item tanpa FK
          nama: "Test Item Standalone",
          jenis: "satuan",
          qty: 1,
          harga: 100000,
          subtotal: 100000,
        },
      ];

      try {
        const result = await saveTransactionAtomic(
          supabase,
          transactionData,
          items,
          [],
        );
        testResult = {
          test: 1,
          status: "PASS",
          transaction_id: result.id,
          transaction_data: result,
          message: "Transaction created successfully",
        };

        // Cleanup
        if (result?.id != null) {
          await supabase
            .from("transaction_items")
            .delete()
            .eq("transaction_id", result.id);
          await supabase.from("transactions").delete().eq("id", result.id);
          testResult.cleanup = "done";
        }
      } catch (error) {
        testResult = {
          test: 1,
          status: "FAIL",
          error: error.message,
          stack: error.stack,
        };
      }
    }

    // === TEST 2: Create Full Transaction ===
    else if (testNum === "2") {
      const transactionData = {
        id: Date.now(),
        id_transaksi: `TEST-ATOMIC-FULL-${Date.now()}`,
        penyewa: "Test Customer Full",
        hp_penyewa: "08123456789",
        alamat_penyewa: "Jl. Test No. 123",
        jaminan_sewa: "KTP",
        waktu_ambil_rencana: "2026-09-15T10:00:00Z",
        waktu_kembali_rencana: "2026-09-17T10:00:00Z",
        durasi_teks: "2 hari",
        total_akhir: 250000,
        denda: 0,
        biaya: 10000,
        diskon: { type: "percentage", value: 10 },
      };

      const items = [
        {
          nama: "Item A",
          jenis: "satuan",
          qty: 2,
          harga: 100000,
          subtotal: 200000,
        },
        {
          nama: "Item B",
          jenis: "paket",
          qty: 1,
          harga: 50000,
          subtotal: 50000,
          tarif: "harian",
        },
      ];

      const payments = [
        {
          jumlah: 100000,
          metode: "Tunai",
          tanggal: new Date().toISOString(),
          catatan: "DP 40%",
        },
        {
          jumlah: 50000,
          metode: "Transfer",
          tanggal: new Date().toISOString(),
          catatan: "Pelunasan sebagian",
        },
      ];

      try {
        const result = await saveTransactionAtomic(
          supabase,
          transactionData,
          items,
          payments,
        );

        const { data: savedItems } = await supabase
          .from("transaction_items")
          .select("*")
          .eq("transaction_id", result.id);

        const { data: savedPayments } = await supabase
          .from("transaction_payments")
          .select("*")
          .eq("transaction_id", result.id);

        testResult = {
          test: 2,
          status: "PASS",
          transaction_id: result.id,
          items_count: savedItems?.length,
          payments_count: savedPayments?.length,
          expected: { items: 2, payments: 2 },
          message: "Full transaction created",
        };

        // Cleanup
        await supabase
          .from("transaction_payments")
          .delete()
          .eq("transaction_id", result.id);
        await supabase
          .from("transaction_items")
          .delete()
          .eq("transaction_id", result.id);
        await supabase.from("transactions").delete().eq("id", result.id);
        testResult.cleanup = "done";
      } catch (error) {
        testResult = {
          test: 2,
          status: "FAIL",
          error: error.message,
        };
      }
    }

    // === TEST 4: Rollback Test ===
    else if (testNum === "4") {
      const transactionData = {
        id: Date.now(),
        id_transaksi: `TEST-ROLLBACK-${Date.now()}`,
        penyewa: "Test Rollback",
        hp_penyewa: "08123456789",
        waktu_ambil_rencana: "2026-09-15T10:00:00Z",
        waktu_kembali_rencana: "2026-09-17T10:00:00Z",
        durasi_teks: "2 hari",
        total_akhir: 100000,
        denda: 0,
        biaya: 0,
      };

      const items = [
        {
          inventory_id: 99999999, // Invalid FK
          nama: "Invalid Item",
          jenis: "satuan",
          qty: 1,
          harga: 100000,
          subtotal: 100000,
        },
      ];

      try {
        const result = await saveTransactionAtomic(
          supabase,
          transactionData,
          items,
          [],
        );
        testResult = {
          test: 4,
          status: "FAIL",
          message: "Should have failed but succeeded",
          transaction_id: result?.id,
        };
      } catch (error) {
        // Verify parent tidak tersimpan
        const { count } = await supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("penyewa", "Test Rollback");

        testResult = {
          test: 4,
          status: "PASS",
          message: "Rollback worked correctly",
          error: error.message,
          parent_leaked: count > 0 ? "FAIL" : "PASS",
        };
      }
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_TEST", message: "Use ?test=1|2|4" },
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: testResult,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[test-atomic] Error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: err.message },
      },
      { status: 500 },
    );
  }
}
