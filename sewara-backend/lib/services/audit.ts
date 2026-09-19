// @ts-nocheck
/**
 * Admin Audit Logging Service
 * 
 * Service untuk mencatat aktivitas admin (create, delete, update users)
 */

import { getServiceRoleClient } from '@/lib/api/supabase';
import { logError } from '@/lib/api/errors';

/**
 * Log admin action ke database
 * 
 * @param {string} actorEmail - Email admin yang melakukan aksi
 * @param {string} action - Jenis aksi (tambah_user, hapus_akun, etc)
 * @param {string} targetEmail - Email target user
 * @param {string} detail - Detail tambahan
 * @returns {Promise<boolean>} Success status
 * 
 * @example
 * await logAdminAction('admin@example.com', 'tambah_user', 'newuser@example.com', 'role=cs');
 */
export async function logAdminAction(actorEmail, action, targetEmail, detail = null) {
  try {
    const admin = getServiceRoleClient();
    
    const { error } = await admin.rpc('rpc_tambah_admin_log', {
      p_actor: actorEmail,
      p_aksi: action,
      p_target: targetEmail,
      p_detail: detail,
    });
    
    if (error) {
      logError(new Error('Failed to log admin action'), {
        function: 'logAdminAction',
        actorEmail,
        action,
        targetEmail,
        error,
      });
      return false;
    }
    
    return true;
  } catch (error) {
    logError(error, {
      function: 'logAdminAction',
      actorEmail,
      action,
      targetEmail,
    });
    return false;
  }
}
