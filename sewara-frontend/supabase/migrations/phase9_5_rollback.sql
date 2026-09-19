-- Phase 9.5 rollback: remove only Phase 9.5 objects. No data deletion.
-- Run manually inside transaction after review.

BEGIN;

DROP POLICY IF EXISTS phase9_5_transaction_items_access ON public.transaction_items;
DROP POLICY IF EXISTS phase9_5_transaction_payments_access ON public.transaction_payments;
DROP POLICY IF EXISTS phase9_5_inventory_units_access ON public.inventory_units;

ALTER TABLE public.transaction_items DROP CONSTRAINT IF EXISTS fk_ti_transaction_tenant;
ALTER TABLE public.transaction_items DROP CONSTRAINT IF EXISTS fk_ti_inventory_tenant;
ALTER TABLE public.transaction_payments DROP CONSTRAINT IF EXISTS fk_tp_transaction_tenant;
ALTER TABLE public.inventory_units DROP CONSTRAINT IF EXISTS fk_iu_inventory_tenant;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS fk_transactions_member_tenant;
ALTER TABLE public.members DROP CONSTRAINT IF EXISTS fk_members_member_type_tenant;

DROP INDEX IF EXISTS public.uq_inventory_id_user_id;
DROP INDEX IF EXISTS public.uq_transactions_id_user_id;
DROP INDEX IF EXISTS public.uq_members_id_user_id;
DROP INDEX IF EXISTS public.uq_member_types_id_user_id;

COMMIT;
