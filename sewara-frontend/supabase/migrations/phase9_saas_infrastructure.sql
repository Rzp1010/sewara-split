-- ============================================================================
-- Phase 9: SaaS Infrastructure + Role & Permission System
-- ============================================================================
-- Date: 30 August 2026
-- Description: 
--   - 8 tabel platform SaaS (subscription, plans, usage, payments)
--   - 3 tabel role & permission system (permissions, role_permissions, staff_permissions)
--   - Enum types untuk subscription status dan event type
--   - Foreign keys, RLS policies, indexes
--   - Infrastruktur saja, belum aktifkan restriction/payment gateway
-- ============================================================================

-- ============================================================================
-- PART 1: ENUM TYPES
-- ============================================================================

-- Subscription status
CREATE TYPE enum_subscription_status AS ENUM (
  'trialing',      -- masa trial gratis
  'active',        -- langganan aktif
  'past_due',      -- pembayaran telat, masih bisa akses
  'grace_period',  -- grace period sebelum suspend
  'cancelled',     -- dibatalkan oleh user
  'expired',       -- masa berlangganan habis
  'suspended'      -- ditangguhkan (admin action atau payment gagal)
);

-- Subscription event type (untuk webhook log)
CREATE TYPE enum_subscription_event AS ENUM (
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.expired',
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'plan.upgraded',
  'plan.downgraded'
);

-- Permission category
CREATE TYPE enum_permission_category AS ENUM (
  'inventory',
  'transaction',
  'member',
  'report',
  'setting',
  'staff'
);


-- ============================================================================
-- PART 2: SAAS PLATFORM TABLES (8 tabel dengan prefix sewara_)
-- ============================================================================

-- -------------------------
-- 2.1 sewara_plans
-- -------------------------
-- Paket langganan (Starter, Pro, Business, dll)
CREATE TABLE sewara_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- 'Starter', 'Pro', 'Business'
  slug TEXT NOT NULL UNIQUE,             -- 'starter', 'pro', 'business'
  description TEXT,
  price_monthly INTEGER NOT NULL,        -- harga per bulan (dalam rupiah)
  price_yearly INTEGER,                  -- harga per tahun (opsional, diskon)
  trial_days INTEGER DEFAULT 0,          -- jumlah hari trial gratis
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sewara_plans IS 'Paket langganan SaaS (Starter, Pro, Business)';
COMMENT ON COLUMN sewara_plans.price_monthly IS 'Harga dalam rupiah (contoh: 99000 = Rp 99.000)';
COMMENT ON COLUMN sewara_plans.trial_days IS 'Jumlah hari trial gratis untuk plan baru';

CREATE INDEX idx_sewara_plans_slug ON sewara_plans(slug);
CREATE INDEX idx_sewara_plans_active ON sewara_plans(is_active) WHERE is_active = true;


-- -------------------------
-- 2.2 sewara_plan_features
-- -------------------------
-- Fitur dan limit per paket
CREATE TABLE sewara_plan_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES sewara_plans(id) ON DELETE CASCADE,
  feature_code TEXT NOT NULL,            -- 'max_transactions', 'max_inventory', 'max_members', dll
  feature_name TEXT NOT NULL,            -- nama display untuk UI
  limit_value INTEGER,                   -- nilai limit (NULL = unlimited)
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(plan_id, feature_code)
);

COMMENT ON TABLE sewara_plan_features IS 'Fitur dan limit per paket (max transaksi, inventory, member, dll)';
COMMENT ON COLUMN sewara_plan_features.feature_code IS 'Kode fitur: max_transactions_monthly, max_inventory_items, max_members, max_staff, max_storage_mb, dll';
COMMENT ON COLUMN sewara_plan_features.limit_value IS 'Nilai limit (NULL = unlimited)';

CREATE INDEX idx_plan_features_plan ON sewara_plan_features(plan_id);
CREATE INDEX idx_plan_features_code ON sewara_plan_features(feature_code);


-- -------------------------
-- 2.3 sewara_subscriptions
-- -------------------------
-- Langganan aktif per owner
CREATE TABLE sewara_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES sewara_plans(id),
  status enum_subscription_status NOT NULL DEFAULT 'trialing',
  
  -- Periode langganan
  trial_ends_at TIMESTAMPTZ,             -- akhir masa trial
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at TIMESTAMPTZ,                 -- dijadwalkan cancel di tanggal ini
  cancelled_at TIMESTAMPTZ,              -- waktu dibatalkan
  ended_at TIMESTAMPTZ,                  -- waktu berakhir
  
  -- Metadata
  metadata JSONB DEFAULT '{}',           -- data tambahan fleksibel
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraint: 1 owner hanya bisa punya 1 subscription aktif
  UNIQUE(owner_id)
);

COMMENT ON TABLE sewara_subscriptions IS 'Langganan aktif per owner (1 owner = 1 subscription)';
COMMENT ON COLUMN sewara_subscriptions.status IS 'Status langganan: trialing, active, past_due, grace_period, cancelled, expired, suspended';
COMMENT ON COLUMN sewara_subscriptions.metadata IS 'Data fleksibel: payment_provider, external_subscription_id, dll';

CREATE INDEX idx_subscriptions_owner ON sewara_subscriptions(owner_id);
CREATE INDEX idx_subscriptions_plan ON sewara_subscriptions(plan_id);
CREATE INDEX idx_subscriptions_status ON sewara_subscriptions(status);
CREATE INDEX idx_subscriptions_period_end ON sewara_subscriptions(current_period_end);


-- -------------------------
-- 2.4 sewara_subscription_payments
-- -------------------------
-- Riwayat pembayaran langganan
CREATE TABLE sewara_subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES sewara_subscriptions(id) ON DELETE CASCADE,
  
  amount INTEGER NOT NULL,               -- jumlah pembayaran (rupiah)
  currency TEXT DEFAULT 'IDR',
  status TEXT NOT NULL,                  -- 'pending', 'succeeded', 'failed', 'refunded'
  
  -- Payment gateway info
  payment_provider TEXT,                 -- 'midtrans', 'xendit', 'stripe', dll
  external_payment_id TEXT,              -- ID dari payment gateway
  payment_method TEXT,                   -- 'credit_card', 'bank_transfer', 'qris', dll
  
  -- Timestamps
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sewara_subscription_payments IS 'Riwayat pembayaran langganan (link ke payment gateway)';
COMMENT ON COLUMN sewara_subscription_payments.external_payment_id IS 'ID payment dari provider (Midtrans/Xendit/Stripe)';

CREATE INDEX idx_sub_payments_subscription ON sewara_subscription_payments(subscription_id);
CREATE INDEX idx_sub_payments_status ON sewara_subscription_payments(status);
CREATE INDEX idx_sub_payments_external ON sewara_subscription_payments(external_payment_id);
CREATE INDEX idx_sub_payments_created ON sewara_subscription_payments(created_at DESC);


-- -------------------------
-- 2.5 sewara_subscription_events
-- -------------------------
-- Log webhook event dari payment gateway
CREATE TABLE sewara_subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES sewara_subscriptions(id) ON DELETE SET NULL,
  
  event_type enum_subscription_event NOT NULL,
  event_source TEXT,                     -- 'midtrans', 'xendit', 'stripe', 'internal'
  
  -- Raw webhook data
  payload JSONB NOT NULL,                -- raw webhook payload
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sewara_subscription_events IS 'Log webhook event dari payment gateway (untuk debugging & audit)';
COMMENT ON COLUMN sewara_subscription_events.payload IS 'Raw webhook payload dari payment gateway';

CREATE INDEX idx_sub_events_subscription ON sewara_subscription_events(subscription_id);
CREATE INDEX idx_sub_events_type ON sewara_subscription_events(event_type);
CREATE INDEX idx_sub_events_processed ON sewara_subscription_events(processed);
CREATE INDEX idx_sub_events_created ON sewara_subscription_events(created_at DESC);


-- -------------------------
-- 2.6 sewara_usage_counters
-- -------------------------
-- Tracking pemakaian bulanan per owner (untuk enforce limit)
CREATE TABLE sewara_usage_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  feature_code TEXT NOT NULL,            -- 'transactions', 'inventory', 'members', 'storage_mb'
  period_start DATE NOT NULL,            -- awal periode (misal: 2026-08-01)
  period_end DATE NOT NULL,              -- akhir periode (misal: 2026-08-31)
  
  current_value INTEGER DEFAULT 0,       -- nilai usage saat ini
  limit_value INTEGER,                   -- limit dari plan (NULL = unlimited)
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(owner_id, feature_code, period_start)
);

COMMENT ON TABLE sewara_usage_counters IS 'Tracking pemakaian bulanan per owner (untuk enforce limit paket)';
COMMENT ON COLUMN sewara_usage_counters.current_value IS 'Jumlah pemakaian saat ini di periode ini';
COMMENT ON COLUMN sewara_usage_counters.limit_value IS 'Limit dari plan (copy dari sewara_plan_features)';

CREATE INDEX idx_usage_counters_owner ON sewara_usage_counters(owner_id);
CREATE INDEX idx_usage_counters_feature ON sewara_usage_counters(feature_code);
CREATE INDEX idx_usage_counters_period ON sewara_usage_counters(period_start, period_end);


-- -------------------------
-- 2.7 sewara_feature_overrides
-- -------------------------
-- Override limit khusus per owner (bonus atau custom deal)
CREATE TABLE sewara_feature_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  feature_code TEXT NOT NULL,            -- fitur yang di-override
  override_value INTEGER,                -- nilai override (NULL = unlimited)
  reason TEXT,                           -- alasan override (misal: 'bonus promo', 'custom deal')
  
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,               -- NULL = permanent
  
  created_by UUID REFERENCES auth.users(id),  -- admin yang buat override
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(owner_id, feature_code)
);

COMMENT ON TABLE sewara_feature_overrides IS 'Override limit khusus per owner (bonus, promo, custom deal)';
COMMENT ON COLUMN sewara_feature_overrides.override_value IS 'Nilai override (NULL = unlimited, prioritas tertinggi)';

CREATE INDEX idx_feature_overrides_owner ON sewara_feature_overrides(owner_id);
CREATE INDEX idx_feature_overrides_valid ON sewara_feature_overrides(valid_from, valid_until);


-- -------------------------
-- 2.8 sewara_payment_methods
-- -------------------------
-- Metode pembayaran tersimpan per owner (opsional, untuk auto-renewal)
CREATE TABLE sewara_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  payment_provider TEXT NOT NULL,        -- 'midtrans', 'xendit', 'stripe'
  external_method_id TEXT NOT NULL,      -- ID dari payment provider
  
  type TEXT NOT NULL,                    -- 'credit_card', 'bank_account', 'ewallet'
  last4 TEXT,                            -- 4 digit terakhir kartu/rekening
  brand TEXT,                            -- 'visa', 'mastercard', 'bca', dll
  
  is_default BOOLEAN DEFAULT false,
  
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sewara_payment_methods IS 'Metode pembayaran tersimpan per owner (untuk auto-renewal)';
COMMENT ON COLUMN sewara_payment_methods.external_method_id IS 'Token/ID metode pembayaran dari provider (jangan simpan data kartu mentah)';

CREATE INDEX idx_payment_methods_owner ON sewara_payment_methods(owner_id);
CREATE INDEX idx_payment_methods_default ON sewara_payment_methods(is_default) WHERE is_default = true;


-- ============================================================================
-- PART 3: ROLE & PERMISSION SYSTEM (3 tabel)
-- ============================================================================

-- -------------------------
-- 3.1 permissions
-- -------------------------
-- Master list permission yang tersedia
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,             -- 'inventory.view', 'transaction.create', dll
  name TEXT NOT NULL,                    -- nama display
  description TEXT,
  category enum_permission_category NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE permissions IS 'Master list permission (inventory.view, transaction.create, report.export, dll)';
COMMENT ON COLUMN permissions.code IS 'Kode unik permission: {module}.{action} (contoh: inventory.create, transaction.delete)';

CREATE INDEX idx_permissions_code ON permissions(code);
CREATE INDEX idx_permissions_category ON permissions(category);
CREATE INDEX idx_permissions_active ON permissions(is_active) WHERE is_active = true;


-- -------------------------
-- 3.2 role_permissions
-- -------------------------
-- Default permission per role (template)
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,                    -- 'owner', 'supervisor', 'cs', 'gudang'
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  is_default BOOLEAN DEFAULT true,       -- apakah ini default permission untuk role ini?
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(role, permission_id)
);

COMMENT ON TABLE role_permissions IS 'Default permission template per role (owner, supervisor, cs, gudang)';
COMMENT ON COLUMN role_permissions.is_default IS 'Permission default yang otomatis diberikan saat assign role';

CREATE INDEX idx_role_permissions_role ON role_permissions(role);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);


-- -------------------------
-- 3.3 staff_permissions
-- -------------------------
-- Custom permission override per staff per owner
CREATE TABLE staff_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  
  is_granted BOOLEAN NOT NULL,           -- true = grant, false = revoke
  overridden_at TIMESTAMPTZ DEFAULT NOW(),
  overridden_by UUID REFERENCES auth.users(id),  -- siapa yang override
  
  UNIQUE(staff_user_id, owner_id, permission_id)
);

COMMENT ON TABLE staff_permissions IS 'Custom permission override per staff per owner (grant/revoke individual permission)';
COMMENT ON COLUMN staff_permissions.is_granted IS 'true = grant permission, false = revoke permission (override default dari role)';

CREATE INDEX idx_staff_permissions_staff ON staff_permissions(staff_user_id, owner_id);
CREATE INDEX idx_staff_permissions_permission ON staff_permissions(permission_id);


-- ============================================================================
-- PART 4: ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- -------------------------
-- 4.1 SaaS Tables RLS
-- -------------------------

-- sewara_plans: public read, admin only write
ALTER TABLE sewara_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY plans_public_read ON sewara_plans
  FOR SELECT USING (is_active = true);

-- sewara_plan_features: public read
ALTER TABLE sewara_plan_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY plan_features_public_read ON sewara_plan_features
  FOR SELECT USING (true);

-- sewara_subscriptions: owner hanya bisa lihat subscription sendiri
ALTER TABLE sewara_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_owner_all ON sewara_subscriptions
  FOR ALL USING (owner_id = auth.uid());

-- sewara_subscription_payments: owner hanya bisa lihat payment sendiri
ALTER TABLE sewara_subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sub_payments_owner_read ON sewara_subscription_payments
  FOR SELECT USING (
    subscription_id IN (
      SELECT id FROM sewara_subscriptions WHERE owner_id = auth.uid()
    )
  );

-- sewara_subscription_events: owner hanya bisa lihat event sendiri
ALTER TABLE sewara_subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY sub_events_owner_read ON sewara_subscription_events
  FOR SELECT USING (
    subscription_id IN (
      SELECT id FROM sewara_subscriptions WHERE owner_id = auth.uid()
    )
  );

-- sewara_usage_counters: owner hanya bisa lihat usage sendiri
ALTER TABLE sewara_usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_counters_owner_all ON sewara_usage_counters
  FOR ALL USING (owner_id = auth.uid());

-- sewara_feature_overrides: owner hanya bisa lihat override sendiri
ALTER TABLE sewara_feature_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY feature_overrides_owner_read ON sewara_feature_overrides
  FOR SELECT USING (owner_id = auth.uid());

-- sewara_payment_methods: owner hanya bisa manage metode pembayaran sendiri
ALTER TABLE sewara_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_methods_owner_all ON sewara_payment_methods
  FOR ALL USING (owner_id = auth.uid());


-- -------------------------
-- 4.2 Permission Tables RLS
-- -------------------------

-- permissions: public read (semua bisa lihat list permission)
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY permissions_public_read ON permissions
  FOR SELECT USING (is_active = true);

-- role_permissions: public read (semua bisa lihat default permission per role)
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_public_read ON role_permissions
  FOR SELECT USING (true);

-- staff_permissions: owner dan staff terkait bisa lihat
ALTER TABLE staff_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_permissions_owner_all ON staff_permissions
  FOR ALL USING (owner_id = auth.uid());

CREATE POLICY staff_permissions_staff_read ON staff_permissions
  FOR SELECT USING (staff_user_id = auth.uid());


-- ============================================================================
-- PART 5: SEED DATA — Default Plans & Permissions
-- ============================================================================

-- -------------------------
-- 5.1 Default Plans
-- -------------------------
INSERT INTO sewara_plans (name, slug, description, price_monthly, price_yearly, trial_days, display_order) VALUES
  ('Starter', 'starter', 'Paket dasar untuk usaha kecil', 99000, 990000, 14, 1),
  ('Pro', 'pro', 'Paket untuk usaha menengah dengan fitur lengkap', 199000, 1990000, 14, 2),
  ('Business', 'business', 'Paket untuk usaha besar dengan limit tinggi', 399000, 3990000, 14, 3);

-- -------------------------
-- 5.2 Default Plan Features (akan disesuaikan nanti)
-- -------------------------
-- Starter plan features
INSERT INTO sewara_plan_features (plan_id, feature_code, feature_name, limit_value) VALUES
  ((SELECT id FROM sewara_plans WHERE slug = 'starter'), 'max_transactions_monthly', 'Transaksi per bulan', 50),
  ((SELECT id FROM sewara_plans WHERE slug = 'starter'), 'max_inventory_items', 'Jumlah item inventori', 20),
  ((SELECT id FROM sewara_plans WHERE slug = 'starter'), 'max_members', 'Jumlah member', 50),
  ((SELECT id FROM sewara_plans WHERE slug = 'starter'), 'max_staff', 'Jumlah staff', 2),
  ((SELECT id FROM sewara_plans WHERE slug = 'starter'), 'max_storage_mb', 'Storage (MB)', 100);

-- Pro plan features
INSERT INTO sewara_plan_features (plan_id, feature_code, feature_name, limit_value) VALUES
  ((SELECT id FROM sewara_plans WHERE slug = 'pro'), 'max_transactions_monthly', 'Transaksi per bulan', 200),
  ((SELECT id FROM sewara_plans WHERE slug = 'pro'), 'max_inventory_items', 'Jumlah item inventori', 100),
  ((SELECT id FROM sewara_plans WHERE slug = 'pro'), 'max_members', 'Jumlah member', 500),
  ((SELECT id FROM sewara_plans WHERE slug = 'pro'), 'max_staff', 'Jumlah staff', 10),
  ((SELECT id FROM sewara_plans WHERE slug = 'pro'), 'max_storage_mb', 'Storage (MB)', 1000);

-- Business plan features (unlimited)
INSERT INTO sewara_plan_features (plan_id, feature_code, feature_name, limit_value) VALUES
  ((SELECT id FROM sewara_plans WHERE slug = 'business'), 'max_transactions_monthly', 'Transaksi per bulan', NULL),
  ((SELECT id FROM sewara_plans WHERE slug = 'business'), 'max_inventory_items', 'Jumlah item inventori', NULL),
  ((SELECT id FROM sewara_plans WHERE slug = 'business'), 'max_members', 'Jumlah member', NULL),
  ((SELECT id FROM sewara_plans WHERE slug = 'business'), 'max_staff', 'Jumlah staff', NULL),
  ((SELECT id FROM sewara_plans WHERE slug = 'business'), 'max_storage_mb', 'Storage (MB)', NULL);

-- -------------------------
-- 5.3 Default Permissions
-- -------------------------
INSERT INTO permissions (code, name, description, category) VALUES
  -- Inventory permissions
  ('inventory.view', 'Lihat Inventori', 'Bisa melihat daftar inventori', 'inventory'),
  ('inventory.create', 'Tambah Inventori', 'Bisa menambah item inventori baru', 'inventory'),
  ('inventory.edit', 'Edit Inventori', 'Bisa mengubah data inventori', 'inventory'),
  ('inventory.delete', 'Hapus Inventori', 'Bisa menghapus item inventori', 'inventory'),
  
  -- Transaction permissions
  ('transaction.view', 'Lihat Transaksi', 'Bisa melihat daftar transaksi', 'transaction'),
  ('transaction.create', 'Buat Transaksi', 'Bisa membuat booking/transaksi baru', 'transaction'),
  ('transaction.edit', 'Edit Transaksi', 'Bisa mengubah transaksi', 'transaction'),
  ('transaction.delete', 'Hapus Transaksi', 'Bisa menghapus transaksi', 'transaction'),
  
  -- Member permissions
  ('member.view', 'Lihat Member', 'Bisa melihat daftar member', 'member'),
  ('member.create', 'Tambah Member', 'Bisa menambah member baru', 'member'),
  ('member.edit', 'Edit Member', 'Bisa mengubah data member', 'member'),
  ('member.delete', 'Hapus Member', 'Bisa menghapus member', 'member'),
  
  -- Report permissions
  ('report.view', 'Lihat Laporan', 'Bisa melihat halaman laporan', 'report'),
  ('report.export', 'Export Laporan', 'Bisa export laporan ke Excel/PDF', 'report'),
  
  -- Setting permissions
  ('setting.view', 'Lihat Pengaturan', 'Bisa melihat halaman pengaturan', 'setting'),
  ('setting.edit', 'Edit Pengaturan', 'Bisa mengubah pengaturan sistem', 'setting'),
  
  -- Staff permissions
  ('staff.view', 'Lihat Staff', 'Bisa melihat daftar staff', 'staff'),
  ('staff.create', 'Tambah Staff', 'Bisa menambah staff baru', 'staff'),
  ('staff.edit', 'Edit Staff', 'Bisa mengubah data staff', 'staff'),
  ('staff.delete', 'Hapus Staff', 'Bisa menghapus staff', 'staff');

-- -------------------------
-- 5.4 Default Role Permissions
-- -------------------------

-- Owner: semua permission
INSERT INTO role_permissions (role, permission_id)
  SELECT 'owner', id FROM permissions WHERE is_active = true;

-- Supervisor: hampir semua kecuali staff management
INSERT INTO role_permissions (role, permission_id)
  SELECT 'supervisor', id FROM permissions 
  WHERE is_active = true 
  AND code NOT IN ('staff.create', 'staff.delete', 'setting.edit');

-- CS: transaksi dan member
INSERT INTO role_permissions (role, permission_id)
  SELECT 'cs', id FROM permissions 
  WHERE is_active = true 
  AND category IN ('transaction', 'member');

-- Gudang: inventori dan lihat transaksi
INSERT INTO role_permissions (role, permission_id)
  SELECT 'gudang', id FROM permissions 
  WHERE is_active = true 
  AND (category = 'inventory' OR code = 'transaction.view');


-- ============================================================================
-- PART 6: HELPER FUNCTIONS (Optional - untuk query convenience)
-- ============================================================================

-- Function: check apakah user punya permission tertentu
CREATE OR REPLACE FUNCTION has_permission(
  p_user_id UUID,
  p_owner_id UUID,
  p_permission_code TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_has_permission BOOLEAN;
  v_user_role TEXT;
BEGIN
  -- Get user role dari profiles
  SELECT role INTO v_user_role 
  FROM profiles 
  WHERE user_id = p_user_id;
  
  -- Owner selalu punya semua permission
  IF v_user_role = 'owner' THEN
    RETURN true;
  END IF;
  
  -- Cek override dulu di staff_permissions
  SELECT is_granted INTO v_has_permission
  FROM staff_permissions sp
  JOIN permissions p ON sp.permission_id = p.id
  WHERE sp.staff_user_id = p_user_id
    AND sp.owner_id = p_owner_id
    AND p.code = p_permission_code;
  
  IF FOUND THEN
    RETURN v_has_permission;
  END IF;
  
  -- Fallback ke default role_permissions
  SELECT EXISTS(
    SELECT 1 FROM role_permissions rp
    JOIN permissions p ON rp.permission_id = p.id
    WHERE rp.role = v_user_role
      AND p.code = p_permission_code
      AND p.is_active = true
  ) INTO v_has_permission;
  
  RETURN COALESCE(v_has_permission, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION has_permission IS 'Check apakah user punya permission tertentu (dengan override support)';


-- Function: get feature limit untuk owner
CREATE OR REPLACE FUNCTION get_feature_limit(
  p_owner_id UUID,
  p_feature_code TEXT
) RETURNS INTEGER AS $$
DECLARE
  v_limit INTEGER;
BEGIN
  -- Cek override dulu (prioritas tertinggi)
  SELECT override_value INTO v_limit
  FROM sewara_feature_overrides
  WHERE owner_id = p_owner_id
    AND feature_code = p_feature_code
    AND (valid_until IS NULL OR valid_until > NOW());
  
  IF FOUND THEN
    RETURN v_limit; -- NULL = unlimited
  END IF;
  
  -- Fallback ke plan limit
  SELECT pf.limit_value INTO v_limit
  FROM sewara_subscriptions s
  JOIN sewara_plan_features pf ON s.plan_id = pf.plan_id
  WHERE s.owner_id = p_owner_id
    AND pf.feature_code = p_feature_code
    AND s.status IN ('trialing', 'active');
  
  RETURN v_limit; -- NULL = unlimited
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_feature_limit IS 'Get feature limit untuk owner (cek override dulu, lalu plan limit)';


-- ============================================================================
-- END OF PHASE 9 MIGRATION
-- ============================================================================

-- Verification queries (jalankan manual untuk cek hasil):
/*
-- Count tables
SELECT COUNT(*) as saas_tables FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'sewara_%';

SELECT COUNT(*) as permission_tables FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name IN ('permissions', 'role_permissions', 'staff_permissions');

-- Count enum types
SELECT COUNT(*) FROM pg_type WHERE typname LIKE 'enum_%';

-- Count default plans
SELECT * FROM sewara_plans ORDER BY display_order;

-- Count default permissions
SELECT category, COUNT(*) FROM permissions GROUP BY category;

-- Count default role permissions
SELECT role, COUNT(*) FROM role_permissions GROUP BY role ORDER BY role;
*/
