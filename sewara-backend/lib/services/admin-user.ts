// @ts-nocheck
/**
 * Admin User Management Service
 * 
 * Business logic untuk create, delete, dan update user accounts (admin operations)
 */

import { getServiceRoleClient } from '@/lib/api/supabase';
import { logAdminAction } from './audit';
import { logError } from '@/lib/api/errors';

// ============================================================================
// CREATE USER
// ============================================================================

/**
 * Create new user account (admin operation)
 * 
 * @param {Object} params
 * @param {string} params.email - User email
 * @param {string} params.password - User password
 * @param {string} params.nama_lengkap - Full name
 * @param {string} params.username - Username (optional, defaults to email)
 * @param {string} params.nama_invoice - Invoice name (optional, defaults to full name)
 * @param {string} params.role - User role (owner, cs, gudang)
 * @param {string|null} params.ownerId - Owner ID (null for owner accounts created by superadmin)
 * @param {string} params.actorEmail - Email of admin performing action
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createUser({
  email,
  password,
  nama_lengkap,
  username,
  nama_invoice,
  role,
  ownerId,
  actorEmail,
}) {
  const admin = getServiceRoleClient();
  
  try {
    // Create Supabase Auth user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        nama_lengkap,
        username: username || email,
        nama_invoice: nama_invoice || nama_lengkap,
      },
    });
    
    if (createErr) {
      logError(new Error('Failed to create auth user'), {
        function: 'createUser',
        email,
        error: createErr,
      });
      return { success: false, error: 'Gagal membuat akun.' };
    }
    
    // Create/update profile
    const { error: profileErr } = await admin.from('profiles').upsert(
      {
        user_id: created.user.id,
        email,
        role,
        nama_lengkap,
        username: username || email,
        nama_invoice: nama_invoice || nama_lengkap,
        is_active: true,
        owner_id: ownerId,
      },
      { onConflict: 'email' }
    );
    
    if (profileErr) {
      logError(new Error('Failed to create profile'), {
        function: 'createUser',
        email,
        userId: created.user.id,
        error: profileErr,
      });
      return { success: false, error: 'Akun dibuat, tapi profil gagal disimpan.' };
    }
    
    // Log admin action (fire-and-forget)
    logAdminAction(actorEmail, 'tambah_user', email, `role=${role}`).catch(() => {});
    
    return { success: true };
  } catch (error) {
    logError(error, {
      function: 'createUser',
      email,
    });
    return { success: false, error: 'Terjadi kesalahan. Coba lagi.' };
  }
}

// ============================================================================
// DELETE USER
// ============================================================================

/**
 * Delete user account dan semua data terkait
 * 
 * @param {Object} params
 * @param {string} params.targetEmail - Email user yang akan dihapus
 * @param {Object} params.targetProfile - Profile object dari target user
 * @param {string} params.actorEmail - Email admin yang melakukan hapus
 * @returns {Promise<{success: boolean, deleted?: number, error?: string}>}
 */
export async function deleteUser({ targetEmail, targetProfile, actorEmail }) {
  const admin = getServiceRoleClient();
  
  try {
    // Collect Auth user IDs to delete (target + owned staff)
    const { data: staffProfiles } = await admin
      .from('profiles')
      .select('user_id')
      .eq('owner_id', targetProfile.user_id);
    
    const authIdsToDelete = new Set([targetProfile.user_id]);
    if (staffProfiles) {
      staffProfiles.forEach((p) => authIdsToDelete.add(p.user_id));
    }
    
    // Delete application data via RPC
    const { error: rpcErr } = await admin.rpc('rpc_hapus_data_user', {
      p_email: targetEmail,
    });
    
    if (rpcErr) {
      logError(new Error('Failed to delete user data'), {
        function: 'deleteUser',
        targetEmail,
        error: rpcErr,
      });
      return { success: false, error: 'Gagal menghapus data akun.' };
    }
    
    // Delete Auth users
    const failedAuthDeletes = [];
    for (const uid of authIdsToDelete) {
      try {
        await admin.auth.admin.deleteUser(uid);
      } catch (err) {
        // Ignore "User not found" errors
        if (!err.message?.includes('User not found')) {
          failedAuthDeletes.push(uid);
          logError(err, {
            function: 'deleteUser',
            operation: 'delete_auth_user',
            userId: uid,
          });
        }
      }
    }
    
    if (failedAuthDeletes.length > 0) {
      return {
        success: false,
        error: `Data terhapus, tapi ${failedAuthDeletes.length} login gagal dihapus.`,
      };
    }
    
    // Log admin action (fire-and-forget)
    const staffCount = authIdsToDelete.size - 1;
    logAdminAction(
      actorEmail,
      'hapus_akun',
      targetEmail,
      staffCount > 0 ? `+${staffCount} staff` : null
    ).catch(() => {});
    
    return { success: true, deleted: authIdsToDelete.size };
  } catch (error) {
    logError(error, {
      function: 'deleteUser',
      targetEmail,
    });
    return { success: false, error: 'Terjadi kesalahan. Coba lagi.' };
  }
}

// ============================================================================
// UPDATE USER - Registration Actions
// ============================================================================

/**
 * Approve registration (superadmin only)
 * 
 * @param {Object} params
 * @param {string} params.targetEmail - Email target
 * @param {string} params.targetUserId - User ID target
 * @param {number} params.durasi - Duration in months (1, 3, 6, 12)
 * @param {string} params.actorEmail - Admin email
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function approveRegistration({ targetEmail, targetUserId, durasi, actorEmail }) {
  const admin = getServiceRoleClient();
  
  try {
    // Calculate subscription end date
    const sampai = new Date();
    sampai.setMonth(sampai.getMonth() + durasi);
    
    // Update profile
    const { error } = await admin
      .from('profiles')
      .update({
        status: 'aktif',
        is_active: true,
        owner_id: targetUserId,
        subscribed_until: sampai.toISOString(),
      })
      .eq('email', targetEmail);
    
    if (error) {
      logError(new Error('Failed to approve registration'), {
        function: 'approveRegistration',
        targetEmail,
        error,
      });
      return { success: false, error: 'Gagal menyetujui pendaftaran.' };
    }
    
    // Log action
    logAdminAction(actorEmail, 'setujui_daftar', targetEmail, `${durasi} bulan`).catch(() => {});
    
    return { success: true };
  } catch (error) {
    logError(error, {
      function: 'approveRegistration',
      targetEmail,
    });
    return { success: false, error: 'Terjadi kesalahan. Coba lagi.' };
  }
}

/**
 * Reject registration (superadmin only)
 */
export async function rejectRegistration({ targetEmail, actorEmail }) {
  const admin = getServiceRoleClient();
  
  try {
    const { error } = await admin
      .from('profiles')
      .update({
        status: 'diblokir',
        is_active: false,
      })
      .eq('email', targetEmail);
    
    if (error) {
      logError(new Error('Failed to reject registration'), {
        function: 'rejectRegistration',
        targetEmail,
        error,
      });
      return { success: false, error: 'Gagal menolak pendaftaran.' };
    }
    
    logAdminAction(actorEmail, 'tolak_daftar', targetEmail, null).catch(() => {});
    
    return { success: true };
  } catch (error) {
    logError(error, {
      function: 'rejectRegistration',
      targetEmail,
    });
    return { success: false, error: 'Terjadi kesalahan. Coba lagi.' };
  }
}

/**
 * Extend subscription (superadmin only)
 */
export async function extendSubscription({ targetEmail, targetProfile, perpanjang, actorEmail }) {
  const admin = getServiceRoleClient();
  
  try {
    // Calculate new end date
    const basis = targetProfile.subscribed_until
      ? new Date(targetProfile.subscribed_until)
      : new Date();
    
    // Only use future date as basis
    const now = new Date();
    const startFrom = basis > now ? basis : now;
    
    const sampai = new Date(startFrom);
    sampai.setMonth(sampai.getMonth() + perpanjang);
    
    const { error } = await admin
      .from('profiles')
      .update({ subscribed_until: sampai.toISOString() })
      .eq('email', targetEmail);
    
    if (error) {
      logError(new Error('Failed to extend subscription'), {
        function: 'extendSubscription',
        targetEmail,
        error,
      });
      return { success: false, error: 'Gagal memperpanjang langganan.' };
    }
    
    logAdminAction(actorEmail, 'perpanjang', targetEmail, `${perpanjang} bulan`).catch(() => {});
    
    return { success: true };
  } catch (error) {
    logError(error, {
      function: 'extendSubscription',
      targetEmail,
    });
    return { success: false, error: 'Terjadi kesalahan. Coba lagi.' };
  }
}

// ============================================================================
// UPDATE USER - Account Actions
// ============================================================================

/**
 * Unlock user account
 */
export async function unlockAccount({ targetUserId, targetEmail, actorEmail }) {
  const admin = getServiceRoleClient();
  
  try {
    const { error } = await admin
      .from('profiles')
      .update({
        locked_until: null,
        failed_login: 0,
        cooldown_until: null,
        last_failed_at: null,
      })
      .eq('user_id', targetUserId);
    
    if (error) {
      logError(new Error('Failed to unlock account'), {
        function: 'unlockAccount',
        targetEmail,
        error,
      });
      return { success: false, error: 'Gagal membuka kunci akun.' };
    }
    
    logAdminAction(actorEmail, 'buka_kunci', targetEmail, null).catch(() => {});
    
    return { success: true };
  } catch (error) {
    logError(error, {
      function: 'unlockAccount',
      targetEmail,
    });
    return { success: false, error: 'Terjadi kesalahan. Coba lagi.' };
  }
}

/**
 * Change user password
 */
export async function changePassword({ targetUserId, targetEmail, password, actorEmail }) {
  const admin = getServiceRoleClient();
  
  try {
    const { error } = await admin.auth.admin.updateUserById(targetUserId, { password });
    
    if (error) {
      logError(new Error('Failed to change password'), {
        function: 'changePassword',
        targetEmail,
        error,
      });
      return { success: false, error: 'Gagal mengubah password.' };
    }
    
    logAdminAction(actorEmail, 'ubah', targetEmail, 'password').catch(() => {});
    
    return { success: true };
  } catch (error) {
    logError(error, {
      function: 'changePassword',
      targetEmail,
    });
    return { success: false, error: 'Gagal mengubah password.' };
  }
}

/**
 * Update profile fields
 */
async function logAdminActionSafely(actorEmail, action, targetEmail, detail) {
  try {
    await logAdminAction(actorEmail, action, targetEmail, detail);
  } catch (error) {
    logError(error, { function: 'logAdminActionSafely', actorEmail, action, targetEmail });
  }
}

function getSafeErrorFields(error) {
  return {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
  };
}

export async function deleteAdminUser({ admin = getServiceRoleClient(), targetEmail, targetProfile, actorEmail }) {
  try {
    const { data: staffProfiles, error: staffErr } = await admin
      .from('profiles')
      .select('user_id')
      .eq('owner_id', targetProfile.user_id);
    if (staffErr) {
      logError(new Error('Failed to query staff profiles'), {
        function: 'deleteAdminUser',
        operation: 'query_staff_profiles',
        targetEmail,
        supabaseError: getSafeErrorFields(staffErr),
      });
      return { success: false, status: 500, error: 'Gagal menghapus data akun.' };
    }

    const ids = [...new Set([targetProfile.user_id, ...(staffProfiles || []).map((p) => p.user_id)])];
    const { error: hapusErr } = await admin.rpc('rpc_hapus_data_user', { p_email: targetEmail });
    if (hapusErr) {
      logError(new Error('Failed to delete user data'), {
        function: 'deleteAdminUser',
        operation: 'rpc_hapus_data_user',
        targetEmail,
        supabaseError: getSafeErrorFields(hapusErr),
      });
      return { success: false, status: 500, error: 'Gagal menghapus data akun.' };
    }

    const gagalAuth = [];
    for (const uid of ids) {
      const { error: authErr } = await admin.auth.admin.deleteUser(uid);
      if (authErr) {
        if (/not found|already (been )?deleted/i.test(authErr.message || '')) continue;
        logError(new Error('Failed to delete auth user'), {
          function: 'deleteAdminUser',
          operation: 'delete_auth_user',
          userId: uid,
          supabaseError: getSafeErrorFields(authErr),
        });
        gagalAuth.push(uid);
      }
    }
    if (gagalAuth.length) return { success: false, status: 500, error: `Data akun sudah dihapus, tapi ${gagalAuth.length} login gagal dibersihkan. Hubungi admin.` };
    await logAdminActionSafely(actorEmail, 'hapus_akun', targetEmail, `termasuk ${ids.length - 1} staf`);
    return { success: true, deleted: ids.length };
  } catch (error) {
    logError(error, { function: 'deleteAdminUser', targetEmail });
    return { success: false, status: 500, error: 'Terjadi kesalahan. Coba lagi.' };
  }
}

export async function applyUserPatch({ admin = getServiceRoleClient(), targetEmail, targetProfile, actorEmail, password, nama_lengkap, username, nama_invoice, unlock, approve, reject, perpanjang, durasi }) {
  try {
    if (approve) {
      const sampai = new Date(Date.now()); sampai.setMonth(sampai.getMonth() + durasi);
      const { error } = await admin.from('profiles').update({ status: 'aktif', is_active: true, owner_id: targetProfile.user_id, subscribed_until: sampai.toISOString() }).eq('email', targetEmail);
      if (error) return { error: 'Gagal menyetujui pendaftaran.', status: 500 };
      await logAdminActionSafely(actorEmail, 'approve_pendaftaran', targetEmail, `langganan ${durasi} bulan`); return { ok: true };
    }
    if (reject) {
      const { error } = await admin.from('profiles').update({ status: 'diblokir', is_active: false }).eq('email', targetEmail);
      if (error) return { error: 'Gagal menolak pendaftaran.', status: 500 };
      await logAdminActionSafely(actorEmail, 'reject_pendaftaran', targetEmail, 'pendaftaran ditolak'); return { ok: true };
    }
    if (perpanjang > 0) {
      const existing = targetProfile.subscribed_until ? new Date(targetProfile.subscribed_until).getTime() : 0;
      const sampai = new Date(existing > Date.now() ? existing : Date.now()); sampai.setMonth(sampai.getMonth() + perpanjang);
      const { error } = await admin.from('profiles').update({ subscribed_until: sampai.toISOString() }).eq('email', targetEmail);
      if (error) return { error: 'Gagal memperpanjang langganan.', status: 500 };
      await logAdminActionSafely(actorEmail, 'perpanjang_langganan', targetEmail, `+${perpanjang} bulan`); return { ok: true };
    }
    if (unlock) {
      const { error } = await admin.from('profiles').update({ locked_until: null, failed_login: 0, cooldown_until: null, last_failed_at: null }).eq('user_id', targetProfile.user_id);
      if (error) return { error: 'Gagal membuka kunci akun.', status: 500 };
      await logAdminActionSafely(actorEmail, 'buka_kunci', targetEmail, 'unlock akun terkunci'); return { ok: true, dibuka: true };
    }
    if (password) {
      const { error } = await admin.auth.admin.updateUserById(targetProfile.user_id, { password });
      if (error) return { error: 'Gagal mengubah password.', status: 400 };
    }
    for (const [field, value, message] of [['nama_lengkap', nama_lengkap, 'Gagal mengubah nama.'], ['username', username, 'Gagal mengubah username.'], ['nama_invoice', nama_invoice, 'Gagal mengubah nama invoice.']]) {
      if (value !== '') { const { error } = await admin.from('profiles').update({ [field]: value }).eq('email', targetEmail); if (error) return { error: message, status: 500 }; }
    }
    const detail = `${password ? 'password,' : ''}${nama_lengkap !== '' ? 'nama,' : ''}${username !== '' ? 'username,' : ''}${nama_invoice !== '' ? 'nama_invoice' : ''}`.replace(/,$/, '') || 'tidak ada perubahan';
    await logAdminActionSafely(actorEmail, 'edit_akun', targetEmail, detail); return { ok: true };
  } catch (error) { logError(error, { function: 'applyUserPatch', targetEmail }); return { error: 'Terjadi kesalahan. Coba lagi.', status: 500 }; }
}

export async function updateProfileField({ targetEmail, field, value, actorEmail }) {
  const admin = getServiceRoleClient();
  
  try {
    const { error } = await admin
      .from('profiles')
      .update({ [field]: value })
      .eq('email', targetEmail);
    
    if (error) {
      logError(new Error(`Failed to update ${field}`), {
        function: 'updateProfileField',
        targetEmail,
        field,
        error,
      });
      return { success: false, error: `Gagal mengubah ${field}.` };
    }
    
    logAdminAction(actorEmail, 'ubah', targetEmail, field).catch(() => {});
    
    return { success: true };
  } catch (error) {
    logError(error, {
      function: 'updateProfileField',
      targetEmail,
      field,
    });
    return { success: false, error: `Gagal mengubah ${field}.` };
  }
}
