// @ts-nocheck
/**
 * Atomic Transaction Save via RPC
 * 
 * Server-safe wrapper for RPC save_transaction_atomic
 * Can be called from both client and server contexts
 */

// ============================================================================
// ATOMIC TRANSACTION SAVE
// ============================================================================

import { mapTransactionToRPC, mapItemsToRPC, mapPaymentsToRPC, handleRPCError, triggerDataChangedEvent } from "./transactionMappers";

export async function saveTransactionAtomic(supabase, transactionData, items = [], payments = []) {
  const { data, error } = await supabase.rpc("rpc_save_transaction", {
    p_transaction: mapTransactionToRPC(transactionData),
    p_items: mapItemsToRPC(items),
    p_payments: mapPaymentsToRPC(payments),
    p_replace_items: true,
    p_replace_payments: true
  });
  if (error) handleRPCError(error);
  triggerDataChangedEvent();
  return data;
}
