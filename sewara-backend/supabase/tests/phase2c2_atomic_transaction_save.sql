-- Manual-only, non-production tests. Setup two owners, staff owner A, tenant rows. Cleanup at end.
-- Schema/security
SELECT p.oid::regprocedure, p.prosecdef AS security_definer, p.proconfig FROM pg_proc p WHERE p.oid='public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean)'::regprocedure;
SELECT has_function_privilege('authenticated','public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean)','EXECUTE') AS authenticated_execute, has_function_privilege('anon','public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean)','EXECUTE') AS anon_execute;
SELECT count(*) AS overload_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='rpc_save_transaction';
-- Success
SELECT public.rpc_save_transaction(jsonb_build_object('id_transaksi','TEST-P2C2-SUCCESS','penyewa','Test','status','Booking'),'[]','[]',true,true);
-- Rollback invalid item numeric / assignedSNs; expect 22023 and no parent after transaction rollback.
BEGIN; SELECT public.rpc_save_transaction(jsonb_build_object('id_transaksi','TEST-P2C2-INVALID-ITEM','penyewa','Test','status','Booking'),'[{"qty":"bad"}]','[]'); ROLLBACK;
BEGIN; SELECT public.rpc_save_transaction(jsonb_build_object('id_transaksi','TEST-P2C2-INVALID-ARRAY','penyewa','Test','status','Booking'),'[{"assignedSNs":{}}]','[]'); ROLLBACK;
-- Rollback invalid payment amount/date/method; expect 22023.
BEGIN; SELECT public.rpc_save_transaction(jsonb_build_object('id_transaksi','TEST-P2C2-INVALID-PAYMENT','penyewa','Test','status','Booking'),'[]','[{"jumlah":"bad","metode":"Tunai","tanggal":"bad"}]'); ROLLBACK;
-- Cross-tenant parent/member/inventory: execute as owner B; each must raise 42501.
-- SELECT public.rpc_save_transaction(jsonb_build_object('id',<owner_a_tx_id>),'[]','[]');
-- SELECT public.rpc_save_transaction(jsonb_build_object('id_transaksi','TEST-P2C2-MEMBER','penyewa','Test','member_id',<owner_a_member_id>),'[]','[]');
-- SELECT public.rpc_save_transaction(jsonb_build_object('id_transaksi','TEST-P2C2-INVENTORY','penyewa','Test'),'[{"inventory_id":<owner_a_inventory_id>}]','[]');
-- Owner/staff: execute insert as staff A; returned user_id must equal owner A.
-- SELECT (public.rpc_save_transaction(jsonb_build_object('id_transaksi','TEST-P2C2-STAFF','penyewa','Staff','status','Booking'),'[]','[]')).user_id;
-- Child replacement: execute as owner A with existing children, then verify both counts 0.
-- SELECT public.rpc_save_transaction(jsonb_build_object('id',<owner_a_tx_id>),'[]','[]',true,true);
-- SELECT count(*) FROM transaction_items WHERE transaction_id=<owner_a_tx_id> AND user_id=<owner_a_id>;
-- SELECT count(*) FROM transaction_payments WHERE transaction_id=<owner_a_tx_id> AND user_id=<owner_a_id>;
-- Cleanup test DB only.
-- DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE id_transaksi LIKE 'TEST-P2C2-%');
-- DELETE FROM transaction_payments WHERE transaction_id IN (SELECT id FROM transactions WHERE id_transaksi LIKE 'TEST-P2C2-%');
-- DELETE FROM transactions WHERE id_transaksi LIKE 'TEST-P2C2-%';
