/**
 * Apply date range filter to query
 *
 * @param {Object} query - Supabase query
 * @param {Object|null} rentang - Date range { mulai, akhir }
 * @param {string} startColumn - Start date column name
 * @param {string} endColumn - End date column name (optional)
 * @returns {Object} Modified query
 */
export function applyDateRange(query, rentang, startColumn, endColumn = null) {
  if (!rentang) return query;

  const { mulai, akhir } = rentang;

  if (mulai) {
    query = query.gte(startColumn, mulai);
  }

  if (akhir) {
    const column = endColumn || startColumn;
    query = query.lte(column, akhir);
  }

  return query;
}

/**
 * Apply tenant scope filter (user_id)
 *
 * @param {Object} query - Supabase query
 * @param {string} userId - User/owner ID
 * @returns {Object} Modified query
 */
export function applyTenantScope(query, userId) {
  if (!userId) {
    throw new Error("Tenant user ID required");
  }
  return query.eq("user_id", userId);
}

/**
 * Calculate sum of numeric column
 */
export function sumColumn(rows, column) {
  return rows.reduce((sum, row) => sum + (Number(row[column]) || 0), 0);
}

/**
 * Count rows
 */
export function countRows(rows) {
  return rows.length;
}
