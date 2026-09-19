-- Phase 9.5: tenant integrity and child access policies
-- Staged, transactional migration. Run only after phase9_security_preflight.sql passes.
-- Parent user_id NULL rows are a hard blocker: no schema changes occur.

BEGIN;

DO $$
DECLARE
  v_nulls text;
  v_duplicates text;
BEGIN
  SELECT string_agg(format('%I=%s', table_name, row_count), ', ' ORDER BY table_name)
    INTO v_nulls
  FROM (
    SELECT 'inventory' table_name, count(*) row_count FROM public.inventory WHERE user_id IS NULL
    UNION ALL SELECT 'transactions', count(*) FROM public.transactions WHERE user_id IS NULL
    UNION ALL SELECT 'members', count(*) FROM public.members WHERE user_id IS NULL
    UNION ALL SELECT 'member_types', count(*) FROM public.member_types WHERE user_id IS NULL
  ) x WHERE row_count > 0;
  IF v_nulls IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 9.5 blocked: nullable parent user_id rows found (%)', v_nulls;
  END IF;

  SELECT string_agg(format('%I=%s', table_name, row_count), ', ' ORDER BY table_name)
    INTO v_duplicates
  FROM (
    SELECT 'inventory' table_name, count(*) row_count FROM (SELECT id, user_id FROM public.inventory GROUP BY id, user_id HAVING count(*) > 1) x
    UNION ALL SELECT 'transactions', count(*) FROM (SELECT id, user_id FROM public.transactions GROUP BY id, user_id HAVING count(*) > 1) x
    UNION ALL SELECT 'members', count(*) FROM (SELECT id, user_id FROM public.members GROUP BY id, user_id HAVING count(*) > 1) x
    UNION ALL SELECT 'member_types', count(*) FROM (SELECT id, user_id FROM public.member_types GROUP BY id, user_id HAVING count(*) > 1) x
  ) x WHERE row_count > 0;
  IF v_duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 9.5 blocked: duplicate parent (id,user_id) keys found (%)', v_duplicates;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_id_user_id ON public.inventory (id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_id_user_id ON public.transactions (id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_members_id_user_id ON public.members (id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_types_id_user_id ON public.member_types (id, user_id);

-- NOT VALID permits creation before validation; VALIDATE below is mandatory.
ALTER TABLE public.transaction_items ADD CONSTRAINT fk_ti_transaction_tenant
  FOREIGN KEY (transaction_id, user_id) REFERENCES public.transactions (id, user_id)
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE public.transaction_items ADD CONSTRAINT fk_ti_inventory_tenant
  FOREIGN KEY (inventory_id, user_id) REFERENCES public.inventory (id, user_id)
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE public.transaction_payments ADD CONSTRAINT fk_tp_transaction_tenant
  FOREIGN KEY (transaction_id, user_id) REFERENCES public.transactions (id, user_id)
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE public.inventory_units ADD CONSTRAINT fk_iu_inventory_tenant
  FOREIGN KEY (inventory_id, user_id) REFERENCES public.inventory (id, user_id)
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
-- Block member deletion while referenced; SET NULL would also clear transactions.user_id.
-- Existing scalar member FKs remain retained intentionally, preserving their prior delete behavior.
ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_member_tenant
  FOREIGN KEY (member_id, user_id) REFERENCES public.members (id, user_id)
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE public.members ADD CONSTRAINT fk_members_member_type_tenant
  FOREIGN KEY (tipe_id, user_id) REFERENCES public.member_types (id, user_id)
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

ALTER TABLE public.transaction_items VALIDATE CONSTRAINT fk_ti_transaction_tenant;
ALTER TABLE public.transaction_items VALIDATE CONSTRAINT fk_ti_inventory_tenant;
ALTER TABLE public.transaction_payments VALIDATE CONSTRAINT fk_tp_transaction_tenant;
ALTER TABLE public.inventory_units VALIDATE CONSTRAINT fk_iu_inventory_tenant;
ALTER TABLE public.transactions VALIDATE CONSTRAINT fk_transactions_member_tenant;
ALTER TABLE public.members VALIDATE CONSTRAINT fk_members_member_type_tenant;

-- Existing scalar FKs are retained intentionally, including both known member FKs.
-- This preserves exact prior delete semantics and avoids dropping an unknown duplicate.

ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transaction items" ON public.transaction_items;
DROP POLICY IF EXISTS "Users can insert own transaction items" ON public.transaction_items;
DROP POLICY IF EXISTS "Users can update own transaction items" ON public.transaction_items;
DROP POLICY IF EXISTS "Users can delete own transaction items" ON public.transaction_items;
CREATE POLICY phase9_5_transaction_items_access ON public.transaction_items FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.is_active AND (transaction_items.user_id=auth.uid() OR transaction_items.user_id=p.owner_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.is_active AND (transaction_items.user_id=auth.uid() OR transaction_items.user_id=p.owner_id)));

DROP POLICY IF EXISTS "Users can view own transaction payments" ON public.transaction_payments;
DROP POLICY IF EXISTS "Users can insert own transaction payments" ON public.transaction_payments;
DROP POLICY IF EXISTS "Users can update own transaction payments" ON public.transaction_payments;
DROP POLICY IF EXISTS "Users can delete own transaction payments" ON public.transaction_payments;
CREATE POLICY phase9_5_transaction_payments_access ON public.transaction_payments FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.is_active AND (transaction_payments.user_id=auth.uid() OR transaction_payments.user_id=p.owner_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.is_active AND (transaction_payments.user_id=auth.uid() OR transaction_payments.user_id=p.owner_id)));

DROP POLICY IF EXISTS "Users can view own inventory units" ON public.inventory_units;
DROP POLICY IF EXISTS "Users can insert own inventory units" ON public.inventory_units;
DROP POLICY IF EXISTS "Users can update own inventory units" ON public.inventory_units;
DROP POLICY IF EXISTS "Users can delete own inventory units" ON public.inventory_units;
CREATE POLICY phase9_5_inventory_units_access ON public.inventory_units FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.is_active AND (inventory_units.user_id=auth.uid() OR inventory_units.user_id=p.owner_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.is_active AND (inventory_units.user_id=auth.uid() OR inventory_units.user_id=p.owner_id)));

COMMIT;
