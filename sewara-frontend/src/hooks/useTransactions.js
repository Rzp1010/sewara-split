/**
 * Shared transaction cache hook.
 * Prevents duplicate fetches across pages with TTL-based invalidation.
 */

import { useCallback, useEffect, useState } from "react";
import { getTransactionsAktif } from "@/lib/db";
let cacheData = null;
let cacheTimestamp = null;
let pendingFetch = null;
const CACHE_TTL = 30000;

function isCacheValid() {
  return cacheData !== null && cacheTimestamp !== null && Date.now() - cacheTimestamp < CACHE_TTL;
}

export function invalidateTransactionCache() {
  cacheData = null;
  cacheTimestamp = null;
}

export function useTransactionsAktif({ skipCache = false } = {}) {
  const [data, setData] = useState(cacheData);
  const [loading, setLoading] = useState(!isCacheValid());
  const [error, setError] = useState(null);

  const fetchTransactions = useCallback(async (forceFresh = false) => {
    if (!forceFresh && isCacheValid()) {
      setData(cacheData);
      setLoading(false);
      return cacheData;
    }

    if (pendingFetch) return pendingFetch;

    setLoading(true);
    setError(null);
    pendingFetch = getTransactionsAktif()
      .then((transactions) => {
        cacheData = transactions;
        cacheTimestamp = Date.now();
        setData(transactions);
        return transactions;
      })
      .catch((err) => {
        console.error("[useTransactionsAktif] Fetch error:", err);
        setError(err.message || "Gagal memuat transaksi aktif");
        throw err;
      })
      .finally(() => {
        pendingFetch = null;
        setLoading(false);
      });
    try {
      return await pendingFetch;
    } catch (err) {
      console.error("[useTransactionsAktif] Fetch error:", err);
      setError(err.message || "Gagal memuat transaksi aktif");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (skipCache || !isCacheValid()) {
      fetchTransactions(skipCache);
    }
  }, [skipCache, fetchTransactions]);

  useEffect(() => {
    const handleDataChanged = () => {
      invalidateTransactionCache();
      fetchTransactions(true);
    };
    window.addEventListener("dataChanged", handleDataChanged);
    return () => window.removeEventListener("dataChanged", handleDataChanged);
  }, [fetchTransactions]);

  const refetch = useCallback(() => fetchTransactions(true), [fetchTransactions]);

  return { data, loading, error, refetch };
}
