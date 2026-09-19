// @ts-nocheck
import { NextResponse } from "next/server";
import { withErrorHandler, logError } from "@/lib/api/errors";
import { parseAndValidate, telegramWebhookSchema } from "@/lib/api/validation";
import { externalServiceErrorResponse, successResponse, unauthorizedResponse, validationErrorResponse } from "@/lib/api/response";
import { validateWebhookSecret } from "@/lib/api/webhook-security";
import { getTelegramConfig, sendTelegramMessage, formatTransactionMessage, formatRegistrationMessage } from "@/lib/services/telegram";

export const runtime = "nodejs";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "-1003838354394";
const THREAD_BACKUP = 6;
const THREAD_DAFTAR = 25;
const TOPIC_LOGIN = 4;

async function webhookHandler(request) {
  const secretCheck = validateWebhookSecret(request, "WEBHOOK_TELEGRAM_SECRET");
  if (!secretCheck.valid) return unauthorizedResponse("Secret webhook tidak valid.");

  const validation = await parseAndValidate(request, telegramWebhookSchema);
  if (!validation.success) return validationErrorResponse("Webhook payload tidak valid.");

  const { type, table, record, old_record } = validation.data;
  const eventType = type;
  const eventRecord = record || {};
  const config = await getTelegramConfig("telegram_login_notif");
  if (config.error) return NextResponse.json({ error: config.error }, { status: 500 });

  if (table === "transactions") {
    if (eventType === "DELETE" && !eventRecord?.no_invoice && !eventRecord?.id) return NextResponse.json({ ok: true, skip: "DELETE tanpa record" });
    try {
      await sendTelegramMessage(config.botToken, CHAT_ID, THREAD_BACKUP, formatTransactionMessage(eventType, eventRecord));
    } catch (error) {
      logError(error, {
        route: '/api/telegram/webhook',
        operation: 'process_webhook_event',
        event: eventType,
        table
      });
      return externalServiceErrorResponse("Terjadi kesalahan. Coba lagi.");
    }
    return successResponse({ ok: true, to: "backup" });
  }
  if (table === "profiles" && eventRecord.status === "menunggu" && eventRecord.role === "owner") {
    try {
      await sendTelegramMessage(config.botToken, CHAT_ID, THREAD_DAFTAR, formatRegistrationMessage(eventType, eventRecord));
    } catch (error) {
      logError(error, {
        route: '/api/telegram/webhook',
        operation: 'process_webhook_event',
        event: eventType,
        table
      });
      return externalServiceErrorResponse("Terjadi kesalahan. Coba lagi.");
    }
    return successResponse({ ok: true, to: "daftar" });
  }
  return NextResponse.json({ ok: true, skip: `${table}/${eventType}` });
}

export const POST = withErrorHandler(webhookHandler);
