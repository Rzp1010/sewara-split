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
      cookieOptions: { sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", httpOnly: false },
    }
  );
}

export async function GET(request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not Found" }, { status: 404 });
  }
  try {
    const supabase = await buatServerClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    
    if (authErr || !user) {
      return NextResponse.json({ 
        ok: false, 
        error: "Not authenticated" 
      }, { status: 401 });
    }

    // Get available inventory
    const { data: inventory, error: invErr } = await supabase
      .from("inventory")
      .select("id, nama, jenis, harga")
      .limit(10);

    if (invErr) {
      return NextResponse.json({
        ok: false,
        error: invErr.message
      }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        user_id: user.id,
        inventory_count: inventory?.length || 0,
        inventory: inventory || []
      }
    });

  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err.message
    }, { status: 500 });
  }
}
