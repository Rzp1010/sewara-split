// ============================================================================
// CLIENT-SIDE EVENT HELPERS
// ============================================================================

/**
 * Trigger data changed event for client-side listeners
 *
 * Used to notify UI components that data has been modified
 * and they should refresh. Only works in browser context.
 *
 * @example
 * await saveData(supabase, data);
 * triggerDataChangedEvent(); // UI will refresh
 */
export function triggerDataChangedEvent() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dataChanged"));
  }
}
