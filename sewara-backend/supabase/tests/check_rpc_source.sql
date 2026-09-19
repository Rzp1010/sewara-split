-- Check rpc_save_transaction implementation untuk status handling
SELECT 
  routine_name,
  pg_get_functiondef(
    (SELECT oid FROM pg_proc WHERE proname = 'rpc_save_transaction' AND pronamespace = 'public'::regnamespace)
  ) AS function_source;
