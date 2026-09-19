// @ts-nocheck
/**
 * Telegram Test Notification API Route
 * 
 * Endpoint untuk test notifikasi Telegram (superadmin only)
 */

import { getServerClient, getServiceRoleClient } from '@/lib/api/supabase';
import { requireAuth, requireActiveProfile, requireRole } from '@/lib/api/auth';
import { successResponse, forbiddenResponse, validationErrorResponse, externalServiceErrorResponse } from '@/lib/api/response';
import { withErrorHandler, logError } from '@/lib/api/errors';
import { TELEGRAM } from '@/lib/api/constants';

export const runtime = 'nodejs';

/**
 * POST /api/telegram/test
 * 
 * Test Telegram notification (superadmin only)
 * Kirim test message ke Telegram channel untuk verify konfigurasi
 */
async function telegramTestHandler(request) {
  const supabase = await getServerClient();
  const admin = getServiceRoleClient();
  
  // Require authentication
  const user = await requireAuth(supabase);
  
  // Get profile
  const profile = await requireActiveProfile(admin, user.id);
  
  // Require superadmin role
  requireRole(profile, 'superadmin');
  
  // Get Telegram config dari settings
  const config = await getTelegramConfig(admin, user.id);
  
  if (!config.aktif) {
    return validationErrorResponse('Notifikasi Telegram belum diaktifkan.');
  }
  
  if (!config.botToken || !config.chatId) {
    return validationErrorResponse('Bot token dan Chat ID wajib diisi.');
  }
  
  // Send test message
  const success = await sendTelegramTestMessage(config);
  
  if (!success) {
    return externalServiceErrorResponse('Gagal mengirim pesan ke Telegram. Periksa konfigurasi.');
  }
  
  return successResponse();
}

/**
 * Get Telegram configuration dari settings
 * 
 * @param {SupabaseClient} admin - Service role client
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Telegram config
 */
async function getTelegramConfig(admin, userId) {
  const { data: configRow } = await admin
    .from('settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'telegram_login_notif')
    .maybeSingle();
  
  // Parse config
  let config = {
    aktif: false,
    botToken: null,
    chatId: null,
    topicLogin: TELEGRAM.THREAD_LOGIN,
  };
  
  if (configRow?.value) {
    try {
      const parsed = JSON.parse(configRow.value);
      config = { ...config, ...parsed };
    } catch (error) {
      logError(error, {
        route: '/api/telegram/test',
        operation: 'parse_telegram_config',
        userId,
      });
    }
  }
  
  return config;
}

/**
 * Send test message ke Telegram
 * 
 * @param {Object} config - Telegram config
 * @returns {Promise<boolean>} Success status
 */
async function sendTelegramTestMessage(config) {
  const timestamp = new Date().toLocaleString('id-ID', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  
  const text = `✅ Notifikasi Telegram aktif!\n\n${timestamp}\nIni pesan uji dari Log Login.`;
  
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          message_thread_id: config.topicLogin,
          text,
        }),
        signal: AbortSignal.timeout(TELEGRAM.REQUEST_TIMEOUT),
      }
    );
    
    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      
      try {
        const result = await response.json();
        errorDetail = result?.description || errorDetail;
      } catch {
        // Ignore JSON parse error
      }
      
      logError(new Error('Telegram API error'), {
        route: '/api/telegram/test',
        operation: 'send_message',
        status: response.status,
        error: errorDetail,
      });
      
      return false;
    }
    
    return true;
  } catch (error) {
    logError(error, {
      route: '/api/telegram/test',
      operation: 'send_message',
      error: error.message,
    });
    
    return false;
  }
}

// Export dengan error handler
export const POST = withErrorHandler(telegramTestHandler);
