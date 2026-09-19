-- Phase 7B: Add Foreign Keys and Constraints
-- Date: 2026-08-28 12:18 UTC
-- Project: Sewara (obhvrzholszhjnpvmnna)
--
-- Adds referential integrity constraints
-- Duration: 15 minutes
-- Prerequisites: Phase 7A passed (0 orphans)

BEGIN;

-- =====================================================
-- 1. Foreign Keys for transaction_items
-- =====================================================

-- FK to transactions (CASCADE delete - items follow transaction)
ALTER TABLE transaction_items
ADD CONSTRAINT fk_transaction_items_transaction
FOREIGN KEY (transaction_id) 
REFERENCES transactions(id) 
ON DELETE CASCADE
ON UPDATE CASCADE;

-- FK to inventory (RESTRICT delete - can't delete inventory if in use)
-- NULL allowed (some items don't have inventory_id)
ALTER TABLE transaction_items
ADD CONSTRAINT fk_transaction_items_inventory
FOREIGN KEY (inventory_id) 
REFERENCES inventory(id) 
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- =====================================================
-- 2. Foreign Keys for transaction_payments
-- =====================================================

-- FK to transactions (CASCADE delete)
ALTER TABLE transaction_payments
ADD CONSTRAINT fk_transaction_payments_transaction
FOREIGN KEY (transaction_id) 
REFERENCES transactions(id) 
ON DELETE CASCADE
ON UPDATE CASCADE;

-- =====================================================
-- 3. Foreign Keys for inventory_units
-- =====================================================

-- FK to inventory (CASCADE delete - units follow inventory)
ALTER TABLE inventory_units
ADD CONSTRAINT fk_inventory_units_inventory
FOREIGN KEY (inventory_id) 
REFERENCES inventory(id) 
ON DELETE CASCADE
ON UPDATE CASCADE;

-- =====================================================
-- 4. Foreign Keys for transactions table
-- =====================================================

-- FK to members (SET NULL - keep transaction if member deleted)
ALTER TABLE transactions
ADD CONSTRAINT fk_transactions_member
FOREIGN KEY (member_id) 
REFERENCES members(id) 
ON DELETE SET NULL
ON UPDATE CASCADE;

-- =====================================================
-- 5. Foreign Keys for members table
-- =====================================================

-- FK to member_types (SET NULL - keep member if type deleted)
ALTER TABLE members
ADD CONSTRAINT fk_members_member_type
FOREIGN KEY (tipe_id) 
REFERENCES member_types(id) 
ON DELETE SET NULL
ON UPDATE CASCADE;

-- =====================================================
-- 6. Check Constraints
-- =====================================================

-- transaction_items: qty must be positive
ALTER TABLE transaction_items
ADD CONSTRAINT check_transaction_items_qty_positive
CHECK (qty > 0);

-- transaction_items: prices non-negative
ALTER TABLE transaction_items
ADD CONSTRAINT check_transaction_items_prices
CHECK (unit_price >= 0 AND subtotal >= 0);

-- transaction_payments: amount must be positive
ALTER TABLE transaction_payments
ADD CONSTRAINT check_transaction_payments_amount_positive
CHECK (amount > 0);

-- inventory_units: serial_number not empty
ALTER TABLE inventory_units
ADD CONSTRAINT check_inventory_units_sn_not_empty
CHECK (length(trim(serial_number)) > 0);

-- =====================================================
-- Verification
-- =====================================================

DO $$
DECLARE
  v_fk_count INTEGER;
  v_check_count INTEGER;
BEGIN
  -- Count foreign keys added
  SELECT COUNT(*) INTO v_fk_count
  FROM information_schema.table_constraints
  WHERE constraint_schema = 'public'
    AND constraint_type = 'FOREIGN KEY'
    AND table_name IN (
      'transaction_items', 
      'transaction_payments', 
      'inventory_units',
      'transactions',
      'members'
    )
    AND constraint_name LIKE 'fk_%';
  
  IF v_fk_count != 6 THEN
    RAISE WARNING 'Expected 6 foreign keys, found %', v_fk_count;
  ELSE
    RAISE NOTICE '✅ 6 foreign keys created';
  END IF;
  
  -- Count check constraints added
  SELECT COUNT(*) INTO v_check_count
  FROM information_schema.table_constraints
  WHERE constraint_schema = 'public'
    AND constraint_type = 'CHECK'
    AND constraint_name LIKE 'check_%'
    AND table_name IN ('transaction_items', 'transaction_payments', 'inventory_units');
  
  IF v_check_count != 4 THEN
    RAISE WARNING 'Expected 4 check constraints, found %', v_check_count;
  ELSE
    RAISE NOTICE '✅ 4 check constraints created';
  END IF;
  
  -- Summary
  RAISE NOTICE '===================================';
  RAISE NOTICE 'Constraints Summary:';
  RAISE NOTICE '  Foreign Keys: %', v_fk_count;
  RAISE NOTICE '  Check Constraints: %', v_check_count;
  RAISE NOTICE '===================================';
END $$;

COMMIT;

-- =====================================================
-- Post-Addition Notes
-- =====================================================

-- Foreign Key Behaviors:
-- 1. CASCADE: Child rows deleted when parent deleted
-- 2. RESTRICT: Cannot delete parent if children exist
-- 3. SET NULL: Child FK set to NULL when parent deleted

-- Transaction items/payments: CASCADE (delete with transaction)
-- Inventory units: CASCADE (delete with inventory)
-- Transaction → member: SET NULL (keep transaction history)
-- Member → member_type: SET NULL (keep member)

-- Next: Phase 7C (Verify FK working with test deletes)
