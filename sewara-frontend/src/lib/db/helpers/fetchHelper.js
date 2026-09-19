/**
 * Fetch JSON from API with error handling
 *
 * @param {string} url - API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Response object { ok, data?, error?, status }
 */
export async function fetchJson(url, options = {}) {
  try {
    const res = await fetch(url, options);

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text || "Invalid response" };
    }

    return {
      ok: res.ok,
      status: res.status,
      ...(res.ok ? { data: body } : { error: body.error || body.message || "Request failed" }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Network error",
    };
  }
}

/**
 * POST JSON to API
 */
export async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * PATCH JSON to API
 */
export async function patchJson(url, body) {
  return fetchJson(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * DELETE request to API
 */
export async function deleteJson(url, body = null) {
  return fetchJson(url, {
    method: "DELETE",
    ...(body && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}
