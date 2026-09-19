/**
 * Fetch all rows from table with automatic pagination
 *
 * @param {string} table - Table name
 * @param {string} columns - Column selection (default "*")
 * @param {Function} queryModifier - Optional query modifier (filter, order)
 * @returns {Promise<Array>} All rows
 */
export async function fetchAllPages(supabase, table, columns = "*", queryModifier = null) {
  const pageSize = 1000;
  const hasil = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (queryModifier) {
      query = queryModifier(query);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Fetch ${table} failed: ${error.message}`);
    }

    const batch = data || [];
    hasil.push(...batch);

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return hasil;
}

/**
 * Fetch single row by ID
 *
 * @param {string} table - Table name
 * @param {string|number} id - Row ID
 * @param {string} columns - Column selection
 * @returns {Promise<Object|null>} Single row or null
 */
export async function fetchOne(supabase, table, id, columns = "*") {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Fetch ${table}/${id} failed: ${error.message}`);
  }

  return data;
}
