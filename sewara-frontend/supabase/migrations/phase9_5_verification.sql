-- Phase 9.5 read-only verification
-- Run after phase9_5_tenant_integrity.sql. SELECT/WITH only.

SELECT conrelid::regclass AS child_table, conname, convalidated,
       pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE connamespace='public'::regnamespace
  AND conname IN ('fk_ti_transaction_tenant','fk_ti_inventory_tenant','fk_tp_transaction_tenant',
                  'fk_iu_inventory_tenant','fk_transactions_member_tenant','fk_members_member_type_tenant')
ORDER BY conname;

SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND policyname IN ('phase9_5_transaction_items_access','phase9_5_transaction_payments_access','phase9_5_inventory_units_access')
ORDER BY tablename;

SELECT indexrelid::regclass AS index_name, indrelid::regclass AS table_name, indisunique
FROM pg_index
WHERE indexrelid::regclass::text IN ('uq_inventory_id_user_id','uq_transactions_id_user_id','uq_members_id_user_id','uq_member_types_id_user_id')
ORDER BY 1;

WITH failures AS (
  SELECT count(*) AS n FROM public.transaction_items ti
  WHERE NOT EXISTS (SELECT 1 FROM public.transactions t WHERE (t.id,t.user_id)=(ti.transaction_id,ti.user_id))
  UNION ALL SELECT count(*) FROM public.transaction_items ti WHERE ti.inventory_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory i WHERE (i.id,i.user_id)=(ti.inventory_id,ti.user_id))
  UNION ALL SELECT count(*) FROM public.transaction_payments tp WHERE NOT EXISTS (SELECT 1 FROM public.transactions t WHERE (t.id,t.user_id)=(tp.transaction_id,tp.user_id))
  UNION ALL SELECT count(*) FROM public.inventory_units iu WHERE NOT EXISTS (SELECT 1 FROM public.inventory i WHERE (i.id,i.user_id)=(iu.inventory_id,iu.user_id))
  UNION ALL SELECT count(*) FROM public.transactions t WHERE t.member_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.members m WHERE (m.id,m.user_id)=(t.member_id,t.user_id))
  UNION ALL SELECT count(*) FROM public.members m WHERE m.tipe_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.member_types mt WHERE (mt.id,mt.user_id)=(m.tipe_id,m.user_id))
)
SELECT sum(n) AS tenant_integrity_failures, CASE WHEN sum(n)=0 THEN 'PASS' ELSE 'FAIL' END status FROM failures;
