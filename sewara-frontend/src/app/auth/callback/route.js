import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function resultRedirect(request, result, errorCode) {
  const url = new URL(result === "error" ? "/" : "/auth/callback/success", request.url);
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
  if (!supabaseUrl || !anonKey) return resultRedirect(request, "error");

  const code = params.get("code");
  const queryError = params.get("error");
  const errorCode = params.get("error_code");
  if (queryError || errorCode) return resultRedirect(request, "error", errorCode);
  if (!code) return resultRedirect(request, "verified");

  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return resultRedirect(request, "error");

  return resultRedirect(request, "verified");
}
