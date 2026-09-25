export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Fetch helper untuk backend API.
 * @param {string} endpoint - path API (misal: '/api/auth/login')
 * @param {object} options - fetch options (method, body, headers, dll)
 * @returns {Promise<any>} isi response.data
 */
export async function apiRequest(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include', // kirim cookie sesi ke backend
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    const msg =
      (typeof data.error === 'object' ? data.error?.message : data.error) ||
      data.message ||
      'Request failed';
    const error = new Error(msg);
    error.status = res.status;
    error.code = data.error?.code;
    error.retryAfterMs = data.retryAfterMs;
    throw error;
  }

  return data.data;
}

/** Bangun query string, buang nilai kosong. */
function qs(params = {}) {
  const clean = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  return clean.length ? '?' + new URLSearchParams(clean).toString() : '';
}

/**
 * API client — semua endpoint backend Sewara.
 */
export const api = {
  auth: {
    login: (email, password) =>
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    logout: () => apiRequest('/api/auth/logout', { method: 'POST' }),
    me: () => apiRequest('/api/auth/me'),
    register: (email, password, namaLengkap, namaBisnis) =>
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          nama_lengkap: namaLengkap,
          nama_bisnis: namaBisnis,
        }),
      }),
  },

  inventory: {
    getAll: (params) => apiRequest(`/api/inventory${qs(params)}`),
    getAllByIds: (ids) => apiRequest(`/api/inventory${qs({ ids: ids.join(',') })}`),
    getRingkas: () => apiRequest(`/api/inventory${qs({ ringkas: 1 })}`),
    create: (data) =>
      apiRequest('/api/inventory', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/inventory/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id) => apiRequest(`/api/inventory/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids) =>
      apiRequest('/api/inventory/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    units: {
      getAll: (inventoryId) =>
        apiRequest(`/api/inventory-units${qs({ inventory_id: inventoryId })}`),
      save: (inventoryId, serialNumbers) =>
        apiRequest('/api/inventory-units', {
          method: 'POST',
          body: JSON.stringify({
            inventory_id: inventoryId,
            serial_numbers: serialNumbers,
          }),
        }),
    },
  },

  transactions: {
    getAll: (params) => apiRequest(`/api/transactions${qs(params)}`),
    getById: (id) => apiRequest(`/api/transactions/${id}`),
    create: (data) =>
      apiRequest('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    items: {
      get: (transactionId) =>
        apiRequest(`/api/transaction-items${qs({ transaction_id: transactionId })}`),
      getBulk: (transactionIds) =>
        apiRequest(
          `/api/transaction-items${qs({ transaction_ids: transactionIds.join(',') })}`,
        ),
      getAll: () => apiRequest(`/api/transaction-items${qs({ all: 1 })}`),
      save: (transactionId, items) =>
        apiRequest('/api/transaction-items', {
          method: 'POST',
          body: JSON.stringify({ transaction_id: transactionId, items }),
        }),
    },
    payments: {
      get: (transactionId) =>
        apiRequest(
          `/api/transaction-payments${qs({ transaction_id: transactionId })}`,
        ),
      save: (transactionId, payments) =>
        apiRequest('/api/transaction-payments', {
          method: 'POST',
          body: JSON.stringify({ transaction_id: transactionId, payments }),
        }),
    },
  },

  invoice: {
    nextNumber: () => apiRequest('/api/invoice-counter', { method: 'POST' }),
  },

  pembayaran: {
    reminder: (params) => apiRequest(`/api/pembayaran/reminder${qs(params)}`),
    reminderAck: (bulan) =>
      apiRequest('/api/pembayaran/reminder-ack', {
        method: 'POST',
        body: JSON.stringify({ bulan }),
      }),
  },

  members: {
    getAll: () => apiRequest('/api/members'),
    create: (data) =>
      apiRequest('/api/members', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/members/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id) => apiRequest(`/api/members/${id}`, { method: 'DELETE' }),
  },

  memberTypes: {
    getAll: () => apiRequest('/api/member-types'),
    create: (data) =>
      apiRequest('/api/member-types', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id) => apiRequest(`/api/member-types/${id}`, { method: 'DELETE' }),
  },

  profiles: {
    getAll: () => apiRequest('/api/profiles'),
    getByEmail: (email) => apiRequest(`/api/profiles${qs({ email })}`),
  },

  settings: {
    getAll: () => apiRequest('/api/settings'),
    get: (key) => apiRequest(`/api/settings${qs({ key })}`),
    upsert: (data) =>
      apiRequest('/api/settings', { method: 'POST', body: JSON.stringify(data) }),
  },

  promo: {
    getAll: () => apiRequest('/api/promo'),
    create: (data) =>
      apiRequest('/api/promo', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/promo/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id) => apiRequest(`/api/promo/${id}`, { method: 'DELETE' }),
    validate: (id) =>
      apiRequest('/api/promo/validate', { method: 'POST', body: JSON.stringify({ id }) }),
    use: (id) =>
      apiRequest('/api/promo/use', { method: 'POST', body: JSON.stringify({ id }) }),
  },

  logs: {
    getAll: (params) => apiRequest(`/api/logs${qs(params)}`),
    create: (data) =>
      apiRequest('/api/logs', { method: 'POST', body: JSON.stringify(data) }),
    delete: (payload) =>
      apiRequest('/api/logs', { method: 'DELETE', body: JSON.stringify(payload) }),
  },

  loginLogs: {
    getAll: (params) => apiRequest(`/api/logs/login${qs(params)}`),
  },

  dashboard: {
    getStats: (params) => apiRequest(`/api/dashboard${qs(params)}`),
    getStatistik: (params) => apiRequest(`/api/dashboard/statistik${qs(params)}`),
    getManajemen: () => apiRequest('/api/dashboard/manajemen'),
  },

  admin: {
    listUsers: () => apiRequest('/api/admin/users'),
    createUser: (data) =>
      apiRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
    deleteUser: (email) =>
      apiRequest('/api/admin/users', {
        method: 'DELETE',
        body: JSON.stringify({ email }),
      }),
    patchUser: (data) =>
      apiRequest('/api/admin/users', { method: 'PATCH', body: JSON.stringify(data) }),
    logs: () => apiRequest('/api/admin/logs'),
    akun: () => apiRequest('/api/admin/akun'),
  },
};