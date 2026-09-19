// @ts-nocheck
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

function resultRedirect(result, errorCode) {
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const url = new URL(result === "error" ? "/" : "/auth/callback/success", baseUrl);
  if (result === "error") url.searchParams.set("error", "verification");
  if (errorCode && /^[a-z0-9_:-]{1,64}$/i.test(errorCode)) {
    url.searchParams.set("error_code", errorCode);
  }
  return NextResponse.redirect(url);
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return resultRedirect("error");

  const code = params.get("code");
  const queryError = params.get("error");
  const errorCode = params.get("error_code");
  if (queryError || errorCode) return resultRedirect("error", errorCode);
  if (!code) return resultRedirect("verified");

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {}
      },
    },
    cookieOptions: {
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      httpOnly: false,
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return resultRedirect("error");

  return resultRedirect("verified");
}
