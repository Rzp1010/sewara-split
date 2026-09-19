-- Drop existing function and reapply with enum cast fix
-- Database: obhvrzholszhjnpvmnna (sewara-apps)
-- Fix: v_status now declared as enum_status_transaksi instead of text

BEGIN;
DROP FUNCTION IF EXISTS public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean);
