// @ts-nocheck
/**
 * Telegram Integration Service
 *
 * Provides Telegram Bot API integration for:
 * - Login notifications (success/failure)
 * - Transaction backup notifications
 * - New registration notifications
 */

import { createClient } from "@supabase/supabase-js";
import { logError } from '@/lib/api/errors';

// ============================================================================
// CLIENT & CONFIG
// ============================================================================

export async function getTelegramConfig(settingsKey = "telegram_login_notif") {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { error: "SUPABASE_SERVICE_ROLE_KEY belum diatur di server." };
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: superadmins } = await supabase.from("profiles").select("user_id").eq("role", "superadmin");
  if (!superadmins || superadmins.length === 0) return { error: "Superadmin tidak ditemukan." };
  const { data: cfgRow } = await supabase.from("settings").select("value").eq("user_id", superadmins[0].user_id).eq("key", settingsKey).maybeSingle();
  let settings = {};
  if (cfgRow?.value) { try { settings = JSON.parse(cfgRow.value); } catch {} }
  if (!settings.botToken) return { error: "botToken belum diatur di pengaturan Telegram." };
  return { botToken: settings.botToken, chatId: settings.chatId };
}

export async function sendTelegramMessage(botToken, chatId, messageThreadId, text, parseMode = "HTML") {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_thread_id: messageThreadId, text, parse_mode: parseMode }),
  });
  let result;
  try { result = await res.json(); } catch { result = null; }
  if (!res.ok) throw new Error(result?.description || `Telegram HTTP ${res.status}`);
  return result;
}

// ============================================================================
// MESSAGE FORMATTERS
// ============================================================================

function formatRupiah(n) {
  try { return "Rp" + (Number(n) || 0).toLocaleString("id-ID"); } catch { return String(n ?? ""); }
}
function escapeHtml(str) { return String(str).replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

export function formatTransactionMessage(eventType, record) {
  const separator = "—".repeat(28);
  const emoji = eventType === "INSERT" ? "🆕" : eventType === "DELETE" ? "🗑️" : "✏️";
  const waktu = new Date(record.created_at || Date.now()).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
  const lines = [`${emoji} *TRANSAKSI — ${eventType}*`, separator, `Invoice  : ${record.no_invoice || record.invoice || "-"}`, `Penyewa  : ${record.nama_penyewa || record.penyewa || record.user_id || "-"}`, `Status   : ${record.status || "-"}`, `Total    : ${formatRupiah(record.total_akhir ?? record.total ?? record.biaya)}`, `Waktu    : ${waktu}`];
  return lines.join("\n") + `\n\n<b>JSON:</b>\n<code>${escapeHtml(JSON.stringify(record))}</code>`;
}

export function formatRegistrationMessage(eventType, record) {
  const separator = "—".repeat(28);
  const waktu = new Date(record.created_at || Date.now()).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
  const lines = [`🆕 *PENDAFTAR BARU — ${eventType}*`, separator, `Nama     : ${record.nama_lengkap || record.nama || "-"}`, `Email    : ${record.email || "-"}`, `Role     : ${record.role || "-"}`, `Status   : ${record.status || "-"}`, `Waktu    : ${waktu}`];
  return lines.join("\n") + `\n\n<b>JSON:</b>\n<code>${escapeHtml(JSON.stringify(record))}</code>`;
}

export function formatLoginMessage(event, email, ip, detail) {
  const waktu = new Date().toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
  const emoji = event === "login_sukses" ? "🔓" : "⚠️";
  const label = event === "login_sukses" ? "Login Sukses" : "Login Gagal";
  return `${emoji} ${label}\n👤 ${email}\n🕐 ${waktu}\n🌐 IP: ${ip || "-"}${detail ? `\n📝 ${detail}` : ""}`;
}

// ============================================================================
// HIGH-LEVEL NOTIFICATIONS
// ============================================================================

export async function notifyLoginToTelegram(admin, { email, event, detail, ip }) {
  try {
    const { data: superadmins } = await admin.from("profiles").select("user_id").eq("role", "superadmin");
    if (!superadmins || superadmins.length === 0) return;
    const ids = superadmins.map((s) => s.user_id);
    const { data: configs } = await admin.from("settings").select("value").in("user_id", ids).eq("key", "telegram_login_notif");
    if (!configs || configs.length === 0) return;
    for (const cfg of configs) {
      let settings;
      try { settings = JSON.parse(cfg.value); } catch { continue; }
      if (!settings || !settings.aktif || !settings.botToken || !settings.chatId) continue;
      if (event === "login_sukses" && !settings.kirimSukses) continue;
      if (event === "login_gagal" && !settings.kirimGagal) continue;
      await sendTelegramMessage(settings.botToken, settings.chatId, settings.topicLogin ?? 4, formatLoginMessage(event, email, ip, detail), undefined);
    }
  } catch (e) {
    logError(e, {
      service: 'telegram',
      operation: 'notify_login',
      email,
      event
    });
  }
}
