-- DDL produksi sewara (project obhvrzholszhjnpvmnna) — direkonstruksi dari pg_catalog via Management API
-- Tanggal: 2026-09-30. Skema: public saja. TANPA data, TANPA grants.
-- Extensions non-default di-emit lebih dulu (pg_net dkk); default Supabase
-- (pgcrypto/uuid-ossp/pg_stat_statements/vault/plpgsql) sudah ada di project baru.
-- File ini = seed DB dev/staging. BUKAN migration untuk produksi.
-- Diakui: urutan best-effort; kalau error "function does not exist" di policies, pindahkan
-- bagian 'functions' lebih awal (sudah diurus di generator).


-- ===== extensions (1) =====
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ===== enums (9) =====
CREATE TYPE public.enum_jenis_inventory AS ENUM ('satuan', 'bundling');

CREATE TYPE public.enum_kondisi_inventory AS ENUM ('Sangat Baik', 'Baik', 'Rusak Ringan', 'Rusak Berat');

CREATE TYPE public.enum_metode_bayar AS ENUM ('Tunai', 'Transfer', 'QRIS');

CREATE TYPE public.enum_permission_category AS ENUM ('inventory', 'transaction', 'member', 'report', 'setting', 'staff');

CREATE TYPE public.enum_status_aktif AS ENUM ('aktif', 'nonaktif');

CREATE TYPE public.enum_status_transaksi AS ENUM ('Booking', 'Disewa', 'Selesai', 'Belum Selesai', 'Dibatalkan');

CREATE TYPE public.enum_status_unit AS ENUM ('available', 'rented', 'maintenance', 'retired');

CREATE TYPE public.enum_subscription_event AS ENUM ('subscription.created', 'subscription.updated', 'subscription.cancelled', 'subscription.expired', 'payment.succeeded', 'payment.failed', 'payment.refunded', 'plan.upgraded', 'plan.downgraded');

CREATE TYPE public.enum_subscription_status AS ENUM ('trialing', 'active', 'past_due', 'grace_period', 'cancelled', 'expired', 'suspended');

-- ===== sequences (non-identity) (6) =====
CREATE SEQUENCE public.activity_logs_id_seq;

CREATE SEQUENCE public.admin_logs_id_seq;

CREATE SEQUENCE public.inventory_id_seq;

CREATE SEQUENCE public.inventory_units_id_seq;

CREATE SEQUENCE public.transaction_items_id_seq;

CREATE SEQUENCE public.transaction_payments_id_seq;

-- ===== tables (28) =====
CREATE TABLE public.activity_logs (
      id bigint NOT NULL DEFAULT nextval('activity_logs_id_seq'::regclass),
      "time" text,
      aksi text,
      sn text,
      nama_barang text,
      id_barang text,
      created_at timestamp with time zone DEFAULT now(),
      user_id uuid,
      waktu text,
      aktivitas text,
      detail text,
      catatan text,
      pelayan text,
      trx_info text
);

CREATE TABLE public.admin_logs (
      id bigint NOT NULL DEFAULT nextval('admin_logs_id_seq'::regclass),
      actor_email text NOT NULL,
      aksi text NOT NULL,
      target_email text,
      detail text DEFAULT ''::text,
      created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.auth_verification_resends (
      email text NOT NULL,
      ip text,
      sent_at timestamp with time zone[] NOT NULL DEFAULT '{}'::timestamp with time zone[],
      last_sent_at timestamp with time zone,
      updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory (
      id bigint NOT NULL DEFAULT nextval('inventory_id_seq'::regclass),
      nama text NOT NULL,
      jenis enum_jenis_inventory NOT NULL,
      h24 numeric DEFAULT 0,
      h12 numeric DEFAULT 0,
      h6 numeric DEFAULT 0,
      denda text,
      sns jsonb DEFAULT '[]'::jsonb,
      komponen jsonb DEFAULT '[]'::jsonb,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      user_id uuid,
      "tipeSewa" text DEFAULT 'fleksibel'::text,
      kondisi enum_kondisi_inventory DEFAULT 'Baik'::enum_kondisi_inventory,
      keterangan text DEFAULT '-'::text,
      tarif text,
      tag text,
      kondisi_sn jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.inventory_units (
      id integer NOT NULL DEFAULT nextval('inventory_units_id_seq'::regclass),
      inventory_id bigint NOT NULL,
      serial_number text NOT NULL,
      status text NOT NULL DEFAULT 'available'::text,
      notes text,
      user_id uuid NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.log_count (
      count bigint
);

CREATE TABLE public.login_logs (
      id bigint GENERATED ALWAYS AS IDENTITY,
      email text NOT NULL,
      owner_id uuid,
      event text NOT NULL,
      detail text,
      ip text,
      user_agent text,
      created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.member_types (
      id bigint GENERATED ALWAYS AS IDENTITY,
      user_id uuid NOT NULL,
      nama text NOT NULL,
      diskon_persen numeric NOT NULL DEFAULT 0,
      status enum_status_aktif NOT NULL DEFAULT 'aktif'::enum_status_aktif,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      diskon_durasi_aturan jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE public.members (
      id bigint GENERATED ALWAYS AS IDENTITY,
      user_id uuid NOT NULL,
      nama text NOT NULL,
      hp text NOT NULL DEFAULT ''::text,
      alamat text NOT NULL DEFAULT ''::text,
      diskon_persen numeric NOT NULL DEFAULT 0,
      status enum_status_aktif NOT NULL DEFAULT 'aktif'::enum_status_aktif,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      tipe_id bigint,
      email text,
      foto_jaminan jsonb DEFAULT '{}'::jsonb,
      catatan text
);

CREATE TABLE public.mt_count (
      count bigint
);

CREATE TABLE public.permissions (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      code text NOT NULL,
      name text NOT NULL,
      description text,
      category enum_permission_category NOT NULL,
      is_active boolean DEFAULT true,
      created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.profiles (
      user_id uuid NOT NULL,
      email text NOT NULL,
      role text NOT NULL DEFAULT 'cs'::text,
      nama_lengkap text NOT NULL DEFAULT ''::text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      failed_login integer NOT NULL DEFAULT 0,
      last_failed_at timestamp with time zone,
      cooldown_until timestamp with time zone,
      locked_until timestamp with time zone,
      owner_id uuid,
      username text,
      nama_invoice text,
      status text DEFAULT 'aktif'::text,
      subscribed_until timestamp with time zone
);

CREATE TABLE public.promo_codes (
      id bigint GENERATED ALWAYS AS IDENTITY,
      user_id uuid NOT NULL,
      kode text NOT NULL,
      diskon_persen numeric NOT NULL DEFAULT 0,
      berlaku_dari timestamp with time zone,
      berlaku_sampai timestamp with time zone,
      kuota integer,
      terpakai integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'aktif'::text,
      created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.role_permissions (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      role text NOT NULL,
      permission_id uuid NOT NULL,
      is_default boolean DEFAULT true,
      created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.schema_migrations (
      filename text NOT NULL,
      applied_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.settings (
      user_id uuid NOT NULL DEFAULT auth.uid(),
      key text NOT NULL,
      value text,
      updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sewara_feature_overrides (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      feature_code text NOT NULL,
      override_value integer,
      reason text,
      valid_from timestamp with time zone DEFAULT now(),
      valid_until timestamp with time zone,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sewara_payment_methods (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      payment_provider text NOT NULL,
      external_method_id text NOT NULL,
      type text NOT NULL,
      last4 text,
      brand text,
      is_default boolean DEFAULT false,
      expires_at timestamp with time zone,
      created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sewara_plan_features (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      plan_id uuid NOT NULL,
      feature_code text NOT NULL,
      feature_name text NOT NULL,
      limit_value integer,
      is_enabled boolean DEFAULT true,
      created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sewara_plans (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      name text NOT NULL,
      slug text NOT NULL,
      description text,
      price_monthly integer NOT NULL,
      price_yearly integer,
      trial_days integer DEFAULT 0,
      is_active boolean DEFAULT true,
      display_order integer DEFAULT 0,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sewara_subscription_events (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      subscription_id uuid,
      event_type enum_subscription_event NOT NULL,
      event_source text,
      payload jsonb NOT NULL,
      processed boolean DEFAULT false,
      processed_at timestamp with time zone,
      error_message text,
      created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sewara_subscription_payments (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      subscription_id uuid NOT NULL,
      amount integer NOT NULL,
      currency text DEFAULT 'IDR'::text,
      status text NOT NULL,
      payment_provider text,
      external_payment_id text,
      payment_method text,
      paid_at timestamp with time zone,
      failed_at timestamp with time zone,
      refunded_at timestamp with time zone,
      metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sewara_subscriptions (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      plan_id uuid NOT NULL,
      status enum_subscription_status NOT NULL DEFAULT 'trialing'::enum_subscription_status,
      trial_ends_at timestamp with time zone,
      current_period_start timestamp with time zone NOT NULL,
      current_period_end timestamp with time zone NOT NULL,
      cancel_at timestamp with time zone,
      cancelled_at timestamp with time zone,
      ended_at timestamp with time zone,
      metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sewara_usage_counters (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL,
      feature_code text NOT NULL,
      period_start date NOT NULL,
      period_end date NOT NULL,
      current_value integer DEFAULT 0,
      limit_value integer,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.staff_permissions (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      staff_user_id uuid NOT NULL,
      owner_id uuid NOT NULL,
      permission_id uuid NOT NULL,
      is_granted boolean NOT NULL,
      overridden_at timestamp with time zone DEFAULT now(),
      overridden_by uuid
);

CREATE TABLE public.transaction_items (
      id integer NOT NULL DEFAULT nextval('transaction_items_id_seq'::regclass),
      transaction_id bigint NOT NULL,
      inventory_id bigint,
      item_name text NOT NULL,
      item_type text,
      qty integer NOT NULL DEFAULT 1,
      unit_price numeric(12,2) DEFAULT 0,
      subtotal numeric(12,2) DEFAULT 0,
      rate_type text,
      serial_number text,
      assigned_components jsonb DEFAULT '[]'::jsonb,
      user_id uuid NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.transaction_payments (
      id integer NOT NULL DEFAULT nextval('transaction_payments_id_seq'::regclass),
      transaction_id bigint NOT NULL,
      amount numeric(12,2) NOT NULL,
      payment_method enum_metode_bayar NOT NULL DEFAULT 'Tunai'::enum_metode_bayar,
      payment_date timestamp with time zone NOT NULL,
      notes text,
      user_id uuid NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.transactions (
      id bigint NOT NULL DEFAULT 0,
      id_transaksi text,
      penyewa text NOT NULL,
      hp_penyewa text,
      alamat_penyewa text,
      jaminan_sewa text,
      waktu_ambil_rencana timestamp with time zone,
      waktu_kembali_rencana timestamp with time zone,
      waktu_ambil_aktual timestamp with time zone,
      waktu_kembali_aktual timestamp with time zone,
      status enum_status_transaksi NOT NULL DEFAULT 'Booking'::enum_status_transaksi,
      items jsonb DEFAULT '[]'::jsonb,
      denda numeric DEFAULT 0,
      biaya numeric DEFAULT 0,
      durasi_teks text,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      user_id uuid,
      pembayaran jsonb DEFAULT '{"dp": 0, "tglDp": "", "metodeDp": "", "riwayatBayar": []}'::jsonb,
      "riwayatDilayani" jsonb DEFAULT '[]'::jsonb,
      dilayani_oleh text,
      diskon jsonb,
      total_akhir numeric DEFAULT 0,
      no_invoice text,
      member_id bigint,
      created_by uuid,
      updated_by uuid,
      dp_hangus numeric DEFAULT 0,
      dp_hangus_aturan text,
      printilan jsonb DEFAULT '[]'::jsonb
);

-- ===== indexes (68) =====
CREATE INDEX idx_activity_logs_user_id ON public.activity_logs USING btree (user_id);

CREATE INDEX idx_logs_waktu ON public.activity_logs USING btree (waktu);

CREATE INDEX idx_auth_verification_resends_ip ON public.auth_verification_resends USING btree (ip);

CREATE INDEX idx_inventory_nama ON public.inventory USING btree (nama);

CREATE INDEX idx_inventory_user_id ON public.inventory USING btree (user_id);

CREATE UNIQUE INDEX uq_inventory_id_user_id ON public.inventory USING btree (id, user_id);

CREATE INDEX idx_inventory_units_available ON public.inventory_units USING btree (inventory_id, serial_number) WHERE (status = 'available'::text);

CREATE INDEX idx_inventory_units_inventory_id ON public.inventory_units USING btree (inventory_id);

CREATE INDEX idx_inventory_units_status ON public.inventory_units USING btree (status);

CREATE INDEX idx_inventory_units_user_id ON public.inventory_units USING btree (user_id);

CREATE INDEX idx_login_logs_email_event_created ON public.login_logs USING btree (email, event, created_at DESC);

CREATE INDEX idx_login_logs_ip_event_created ON public.login_logs USING btree (ip, event, created_at DESC);

CREATE INDEX idx_login_logs_owner_created ON public.login_logs USING btree (owner_id, created_at DESC);

CREATE INDEX idx_member_templates_user_id ON public.member_types USING btree (user_id);

CREATE UNIQUE INDEX uq_member_types_id_user_id ON public.member_types USING btree (id, user_id);

CREATE INDEX idx_members_email ON public.members USING btree (email) WHERE (email IS NOT NULL);

CREATE INDEX idx_members_hp ON public.members USING btree (hp) WHERE (hp IS NOT NULL);

CREATE INDEX idx_members_user_id ON public.members USING btree (user_id);

CREATE UNIQUE INDEX uq_members_id_user_id ON public.members USING btree (id, user_id);

CREATE INDEX idx_permissions_active ON public.permissions USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_permissions_category ON public.permissions USING btree (category);

CREATE INDEX idx_permissions_code ON public.permissions USING btree (code);

CREATE INDEX idx_promo_codes_user_id ON public.promo_codes USING btree (user_id);

CREATE INDEX idx_role_permissions_permission ON public.role_permissions USING btree (permission_id);

CREATE INDEX idx_role_permissions_role ON public.role_permissions USING btree (role);

CREATE INDEX idx_settings_user_id ON public.settings USING btree (user_id);

CREATE INDEX idx_feature_overrides_owner ON public.sewara_feature_overrides USING btree (owner_id);

CREATE INDEX idx_feature_overrides_valid ON public.sewara_feature_overrides USING btree (valid_from, valid_until);

CREATE INDEX idx_payment_methods_default ON public.sewara_payment_methods USING btree (is_default) WHERE (is_default = true);

CREATE INDEX idx_payment_methods_owner ON public.sewara_payment_methods USING btree (owner_id);

CREATE INDEX idx_plan_features_code ON public.sewara_plan_features USING btree (feature_code);

CREATE INDEX idx_plan_features_plan ON public.sewara_plan_features USING btree (plan_id);

CREATE INDEX idx_sewara_plans_active ON public.sewara_plans USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_sewara_plans_slug ON public.sewara_plans USING btree (slug);

CREATE INDEX idx_sub_events_created ON public.sewara_subscription_events USING btree (created_at DESC);

CREATE INDEX idx_sub_events_processed ON public.sewara_subscription_events USING btree (processed);

CREATE INDEX idx_sub_events_subscription ON public.sewara_subscription_events USING btree (subscription_id);

CREATE INDEX idx_sub_events_type ON public.sewara_subscription_events USING btree (event_type);

CREATE INDEX idx_sub_payments_created ON public.sewara_subscription_payments USING btree (created_at DESC);

CREATE INDEX idx_sub_payments_external ON public.sewara_subscription_payments USING btree (external_payment_id);

CREATE INDEX idx_sub_payments_status ON public.sewara_subscription_payments USING btree (status);

CREATE INDEX idx_sub_payments_subscription ON public.sewara_subscription_payments USING btree (subscription_id);

CREATE INDEX idx_subscriptions_owner ON public.sewara_subscriptions USING btree (owner_id);

CREATE INDEX idx_subscriptions_period_end ON public.sewara_subscriptions USING btree (current_period_end);

CREATE INDEX idx_subscriptions_plan ON public.sewara_subscriptions USING btree (plan_id);

CREATE INDEX idx_subscriptions_status ON public.sewara_subscriptions USING btree (status);

CREATE INDEX idx_usage_counters_feature ON public.sewara_usage_counters USING btree (feature_code);

CREATE INDEX idx_usage_counters_owner ON public.sewara_usage_counters USING btree (owner_id);

CREATE INDEX idx_usage_counters_period ON public.sewara_usage_counters USING btree (period_start, period_end);

CREATE INDEX idx_staff_permissions_permission ON public.staff_permissions USING btree (permission_id);

CREATE INDEX idx_staff_permissions_staff ON public.staff_permissions USING btree (staff_user_id, owner_id);

CREATE INDEX idx_transaction_items_inventory_id ON public.transaction_items USING btree (inventory_id) WHERE (inventory_id IS NOT NULL);

CREATE INDEX idx_transaction_items_sn ON public.transaction_items USING btree (transaction_id, serial_number) WHERE (serial_number IS NOT NULL);

CREATE INDEX idx_transaction_items_transaction_id ON public.transaction_items USING btree (transaction_id);

CREATE INDEX idx_transaction_items_user_id ON public.transaction_items USING btree (user_id);

CREATE INDEX idx_transaction_payments_date ON public.transaction_payments USING btree (payment_date DESC);

CREATE INDEX idx_transaction_payments_method ON public.transaction_payments USING btree (payment_method);

CREATE INDEX idx_transaction_payments_transaction_id ON public.transaction_payments USING btree (transaction_id);

CREATE INDEX idx_transaction_payments_user_id ON public.transaction_payments USING btree (user_id);

CREATE INDEX idx_transactions_dilayani_oleh ON public.transactions USING btree (dilayani_oleh);

CREATE INDEX idx_transactions_member_id ON public.transactions USING btree (member_id) WHERE (member_id IS NOT NULL);

CREATE INDEX idx_transactions_no_invoice ON public.transactions USING btree (no_invoice) WHERE (no_invoice IS NOT NULL);

CREATE INDEX idx_transactions_status ON public.transactions USING btree (status);

CREATE INDEX idx_transactions_user_created ON public.transactions USING btree (user_id, created_at DESC);

CREATE INDEX idx_transactions_user_id ON public.transactions USING btree (user_id);

CREATE INDEX idx_transactions_user_status ON public.transactions USING btree (user_id, status);

CREATE INDEX idx_transactions_user_status_created ON public.transactions USING btree (user_id, status, created_at DESC);

CREATE UNIQUE INDEX uq_transactions_id_user_id ON public.transactions USING btree (id, user_id);

-- ===== constraints (80) =====
ALTER TABLE public.activity_logs ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.admin_logs ADD CONSTRAINT admin_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.auth_verification_resends ADD CONSTRAINT auth_verification_resends_pkey PRIMARY KEY (email);

ALTER TABLE public.inventory ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);

ALTER TABLE public.inventory_units ADD CONSTRAINT inventory_units_pkey PRIMARY KEY (id);

ALTER TABLE public.login_logs ADD CONSTRAINT login_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.member_types ADD CONSTRAINT member_types_pkey PRIMARY KEY (id);

ALTER TABLE public.members ADD CONSTRAINT members_pkey PRIMARY KEY (id);

ALTER TABLE public.permissions ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_pkey PRIMARY KEY (id);

ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);

ALTER TABLE public.schema_migrations ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);

ALTER TABLE public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (user_id, key);

ALTER TABLE public.sewara_feature_overrides ADD CONSTRAINT sewara_feature_overrides_pkey PRIMARY KEY (id);

ALTER TABLE public.sewara_payment_methods ADD CONSTRAINT sewara_payment_methods_pkey PRIMARY KEY (id);

ALTER TABLE public.sewara_plan_features ADD CONSTRAINT sewara_plan_features_pkey PRIMARY KEY (id);

ALTER TABLE public.sewara_plans ADD CONSTRAINT sewara_plans_pkey PRIMARY KEY (id);

ALTER TABLE public.sewara_subscription_events ADD CONSTRAINT sewara_subscription_events_pkey PRIMARY KEY (id);

ALTER TABLE public.sewara_subscription_payments ADD CONSTRAINT sewara_subscription_payments_pkey PRIMARY KEY (id);

ALTER TABLE public.sewara_subscriptions ADD CONSTRAINT sewara_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE public.sewara_usage_counters ADD CONSTRAINT sewara_usage_counters_pkey PRIMARY KEY (id);

ALTER TABLE public.staff_permissions ADD CONSTRAINT staff_permissions_pkey PRIMARY KEY (id);

ALTER TABLE public.transaction_items ADD CONSTRAINT transaction_items_pkey PRIMARY KEY (id);

ALTER TABLE public.transaction_payments ADD CONSTRAINT transaction_payments_pkey PRIMARY KEY (id);

ALTER TABLE public.transactions ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);

ALTER TABLE public.inventory_units ADD CONSTRAINT inventory_units_inventory_id_serial_number_user_id_key UNIQUE (inventory_id, serial_number, user_id);

ALTER TABLE public.permissions ADD CONSTRAINT permissions_code_key UNIQUE (code);

ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);

ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_user_kode UNIQUE (user_id, kode);

ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_role_permission_id_key UNIQUE (role, permission_id);

ALTER TABLE public.sewara_feature_overrides ADD CONSTRAINT sewara_feature_overrides_owner_id_feature_code_key UNIQUE (owner_id, feature_code);

ALTER TABLE public.sewara_plan_features ADD CONSTRAINT sewara_plan_features_plan_id_feature_code_key UNIQUE (plan_id, feature_code);

ALTER TABLE public.sewara_plans ADD CONSTRAINT sewara_plans_slug_key UNIQUE (slug);

ALTER TABLE public.sewara_subscriptions ADD CONSTRAINT sewara_subscriptions_owner_id_key UNIQUE (owner_id);

ALTER TABLE public.sewara_usage_counters ADD CONSTRAINT sewara_usage_counters_owner_id_feature_code_period_start_key UNIQUE (owner_id, feature_code, period_start);

ALTER TABLE public.staff_permissions ADD CONSTRAINT staff_permissions_staff_user_id_owner_id_permission_id_key UNIQUE (staff_user_id, owner_id, permission_id);

ALTER TABLE public.inventory_units ADD CONSTRAINT check_inventory_units_sn_not_empty CHECK ((length(TRIM(BOTH FROM serial_number)) > 0));

ALTER TABLE public.login_logs ADD CONSTRAINT login_logs_event_check CHECK ((event = ANY (ARRAY['login_sukses'::text, 'login_gagal'::text, 'logout'::text])));

ALTER TABLE public.member_types ADD CONSTRAINT member_templates_diskon_persen_check CHECK (((diskon_persen >= (0)::numeric) AND (diskon_persen <= (100)::numeric)));

ALTER TABLE public.members ADD CONSTRAINT foto_jaminan_array_check CHECK (((jsonb_typeof(foto_jaminan) = 'array'::text) AND (jsonb_array_length(foto_jaminan) <= 5)));

ALTER TABLE public.members ADD CONSTRAINT members_diskon_persen_check CHECK (((diskon_persen >= (0)::numeric) AND (diskon_persen <= (100)::numeric)));

ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['superadmin'::text, 'owner'::text, 'cs'::text, 'gudang'::text])));

ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check CHECK ((status = ANY (ARRAY['menunggu'::text, 'aktif'::text, 'diblokir'::text])));

ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_diskon_persen_check CHECK (((diskon_persen >= (0)::numeric) AND (diskon_persen <= (100)::numeric)));

ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_status_check CHECK ((status = ANY (ARRAY['aktif'::text, 'nonaktif'::text, 'expired'::text])));

ALTER TABLE public.transaction_items ADD CONSTRAINT check_transaction_items_prices CHECK (((unit_price >= (0)::numeric) AND (subtotal >= (0)::numeric)));

ALTER TABLE public.transaction_items ADD CONSTRAINT check_transaction_items_qty_positive CHECK ((qty > 0));

ALTER TABLE public.transaction_items ADD CONSTRAINT transaction_items_qty_check CHECK ((qty > 0));

ALTER TABLE public.transaction_items ADD CONSTRAINT transaction_items_subtotal_check CHECK ((subtotal >= (0)::numeric));

ALTER TABLE public.transaction_items ADD CONSTRAINT transaction_items_unit_price_check CHECK ((unit_price >= (0)::numeric));

ALTER TABLE public.transaction_payments ADD CONSTRAINT check_transaction_payments_amount_positive CHECK ((amount > (0)::numeric));

ALTER TABLE public.transaction_payments ADD CONSTRAINT transaction_payments_amount_check CHECK ((amount > (0)::numeric));

ALTER TABLE public.inventory_units ADD CONSTRAINT fk_inventory_units_inventory FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.inventory_units ADD CONSTRAINT fk_iu_inventory_tenant FOREIGN KEY (inventory_id, user_id) REFERENCES inventory(id, user_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.members ADD CONSTRAINT fk_members_member_type FOREIGN KEY (tipe_id) REFERENCES member_types(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.members ADD CONSTRAINT fk_members_member_type_tenant FOREIGN KEY (tipe_id, user_id) REFERENCES member_types(id, user_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE;

ALTER TABLE public.sewara_feature_overrides ADD CONSTRAINT sewara_feature_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.sewara_feature_overrides ADD CONSTRAINT sewara_feature_overrides_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.sewara_payment_methods ADD CONSTRAINT sewara_payment_methods_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.sewara_plan_features ADD CONSTRAINT sewara_plan_features_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES sewara_plans(id) ON DELETE CASCADE;

ALTER TABLE public.sewara_subscription_events ADD CONSTRAINT sewara_subscription_events_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES sewara_subscriptions(id) ON DELETE SET NULL;

ALTER TABLE public.sewara_subscription_payments ADD CONSTRAINT sewara_subscription_payments_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES sewara_subscriptions(id) ON DELETE CASCADE;

ALTER TABLE public.sewara_subscriptions ADD CONSTRAINT sewara_subscriptions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.sewara_subscriptions ADD CONSTRAINT sewara_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES sewara_plans(id);

ALTER TABLE public.sewara_usage_counters ADD CONSTRAINT sewara_usage_counters_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.staff_permissions ADD CONSTRAINT staff_permissions_overridden_by_fkey FOREIGN KEY (overridden_by) REFERENCES auth.users(id);

ALTER TABLE public.staff_permissions ADD CONSTRAINT staff_permissions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.staff_permissions ADD CONSTRAINT staff_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE;

ALTER TABLE public.staff_permissions ADD CONSTRAINT staff_permissions_staff_user_id_fkey FOREIGN KEY (staff_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.transaction_items ADD CONSTRAINT fk_ti_inventory_tenant FOREIGN KEY (inventory_id, user_id) REFERENCES inventory(id, user_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.transaction_items ADD CONSTRAINT fk_ti_transaction_tenant FOREIGN KEY (transaction_id, user_id) REFERENCES transactions(id, user_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.transaction_items ADD CONSTRAINT fk_transaction_items_inventory FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.transaction_items ADD CONSTRAINT fk_transaction_items_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.transaction_payments ADD CONSTRAINT fk_tp_transaction_tenant FOREIGN KEY (transaction_id, user_id) REFERENCES transactions(id, user_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.transaction_payments ADD CONSTRAINT fk_transaction_payments_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_member FOREIGN KEY (member_id) REFERENCES members(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.transactions ADD CONSTRAINT fk_transactions_member_tenant FOREIGN KEY (member_id, user_id) REFERENCES members(id, user_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.transactions ADD CONSTRAINT transactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

-- ===== views (0) =====
-- ===== replica identity (non-default) (0) =====
-- ===== functions (24) =====
CREATE OR REPLACE FUNCTION public.get_feature_limit(p_owner_id uuid, p_feature_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_owner_id uuid, p_permission_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.increment_invoice_counter(step integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_owner uuid;
  new_val int;
  curr_val int;
BEGIN
  -- Tenant aktif pemanggil: staf -> owner_id; owner -> dirinya (COALESCE menutup owner_id NULL).
  SELECT COALESCE(p.owner_id, p.user_id) INTO v_owner
  FROM public.profiles p
  WHERE p.user_id = uid AND p.is_active;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'active profile required'; END IF;

  -- Ambil nilai saat ini, bersihkan quotes jika ada (identik alter7).
  SELECT COALESCE(NULLIF(regexp_replace(value, '^"|"$', '', 'g'), '')::int, 0) INTO curr_val
  FROM settings WHERE user_id = v_owner AND key = 'invoice_counter';

  new_val := curr_val + step;

  INSERT INTO settings (user_id, key, value)
  VALUES (v_owner, 'invoice_counter', new_val::text)
  ON CONFLICT (user_id, key)
  DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

  RETURN new_val;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_telegram_pendaftar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url TEXT := 'https://app-sewara.vercel.app/api/telegram/webhook';
  v_secret TEXT := '720d6bc28ac0a6f1a0458faa36140676a3679cfe90646182';
BEGIN
  -- Hanya pendaftar baru (role owner + status menunggu)
  IF NEW.role = 'owner' AND NEW.status = 'menunggu' THEN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      body := jsonb_build_object(
        'type', TG_OP,
        'table', 'profiles',
        'record', to_jsonb(NEW),
        'old_record', to_jsonb(OLD)
      )
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_telegram_transaksi()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url TEXT := 'https://app-sewara.vercel.app/api/telegram/webhook';
  v_secret TEXT := '720d6bc28ac0a6f1a0458faa36140676a3679cfe90646182';
BEGIN
  -- Guard anti-spam: SKIP jika ini sekadar relink UUID (perubahan user_id saja,
  -- terjadi saat relink-users.ps1 / migrasi) - bukan perubahan data nyata.
  -- ✅ FIXED: camelCase → snake_case
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id
     AND OLD.status = NEW.status
     AND OLD.total_akhir IS NOT DISTINCT FROM NEW.total_akhir
     AND OLD.biaya IS NOT DISTINCT FROM NEW.biaya
     AND OLD.no_invoice = NEW.no_invoice THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'type', TG_OP,
      'table', 'transactions',
      'record', to_jsonb(NEW),
      'old_record', to_jsonb(OLD)
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_profile_self_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Baris sendiri: tak boleh ubah role/owner/status/lockout/langganan.
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.user_id THEN
    IF OLD.role IS DISTINCT FROM NEW.role
       OR OLD.owner_id IS DISTINCT FROM NEW.owner_id
       OR OLD.is_active IS DISTINCT FROM NEW.is_active
       OR OLD.failed_login IS DISTINCT FROM NEW.failed_login
       OR OLD.last_failed_at IS DISTINCT FROM NEW.last_failed_at
       OR OLD.cooldown_until IS DISTINCT FROM NEW.cooldown_until
       OR OLD.locked_until IS DISTINCT FROM NEW.locked_until
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.subscribed_until IS DISTINCT FROM NEW.subscribed_until THEN
      RAISE EXCEPTION 'Tidak boleh mengubah role, owner, status aktif, lockout, atau langganan pada akun sendiri';
    END IF;
    RETURN NEW;
  END IF;

  -- Baris pihak lain: non-superadmin / non-service-role tidak boleh eskalasi.
  IF auth.uid() IS NOT NULL
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin'
     ) THEN
    IF NEW.role IN ('owner', 'superadmin') AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Tidak boleh menaikkan role ke owner/superadmin';
    END IF;
    IF OLD.owner_id IS DISTINCT FROM NEW.owner_id THEN
      RAISE EXCEPTION 'Tidak boleh memindahkan kepemilikan (owner_id) akun';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_login_logs_retensi()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.login_logs WHERE created_at < now() - interval '30 days';
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_auth_punya_role(p_role text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role = p_role AND is_active
  );
$function$;

CREATE OR REPLACE FUNCTION public.rpc_dashboard_pembayaran(p_user_id uuid, p_mulai timestamp with time zone DEFAULT NULL::timestamp with time zone, p_akhir timestamp with time zone DEFAULT NULL::timestamp with time zone, p_basis text DEFAULT 'selesai'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_akhir numeric := 0;
  v_diterima numeric := 0;
  v_tunai numeric := 0;
  v_transfer numeric := 0;
  v_qris numeric := 0;
  v_tenant uuid;
BEGIN
  -- SECURITY CHECK: p_user_id harus = tenant caller (owner: dirinya; staf: owner-nya).
  SELECT COALESCE(p.owner_id, p.user_id) INTO v_tenant
  FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_active;

  IF v_tenant IS NULL OR p_user_id != v_tenant THEN
    RAISE EXCEPTION 'Unauthorized: tenant mismatch. Attempted access to user % by user %',
                    p_user_id, auth.uid();
  END IF;

  -- Total Akhir (kolom snake_case)
  SELECT COALESCE(SUM(total_akhir), 0) INTO v_total_akhir
  FROM transactions
  WHERE user_id = p_user_id
    AND status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND status = 'Selesai')
      OR (p_basis = 'aktif' AND status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR created_at >= p_mulai)
    AND (p_akhir IS NULL OR created_at <= p_akhir);

  -- Total Diterima (JSON key riwayatBayar — bukan kolom, tetap camelCase)
  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_diterima
  FROM transactions t,
  LATERAL jsonb_array_elements(
    COALESCE((t.pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)
  ) AS bayar
  WHERE t.user_id = p_user_id
    AND t.status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND t.status = 'Selesai')
      OR (p_basis = 'aktif' AND t.status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR t.created_at >= p_mulai)
    AND (p_akhir IS NULL OR t.created_at <= p_akhir);

  -- Tunai
  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_tunai
  FROM transactions t,
  LATERAL jsonb_array_elements(
    COALESCE((t.pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)
  ) AS bayar
  WHERE t.user_id = p_user_id
    AND t.status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND t.status = 'Selesai')
      OR (p_basis = 'aktif' AND t.status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR t.created_at >= p_mulai)
    AND (p_akhir IS NULL OR t.created_at <= p_akhir)
    AND bayar->>'metode' = 'Tunai';

  -- Transfer
  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_transfer
  FROM transactions t,
  LATERAL jsonb_array_elements(
    COALESCE((t.pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)
  ) AS bayar
  WHERE t.user_id = p_user_id
    AND t.status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND t.status = 'Selesai')
      OR (p_basis = 'aktif' AND t.status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR t.created_at >= p_mulai)
    AND (p_akhir IS NULL OR t.created_at <= p_akhir)
    AND bayar->>'metode' = 'Transfer';

  -- QRIS
  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_qris
  FROM transactions t,
  LATERAL jsonb_array_elements(
    COALESCE((t.pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)
  ) AS bayar
  WHERE t.user_id = p_user_id
    AND t.status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND t.status = 'Selesai')
      OR (p_basis = 'aktif' AND t.status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR t.created_at >= p_mulai)
    AND (p_akhir IS NULL OR t.created_at <= p_akhir)
    AND bayar->>'metode' = 'QRIS';

  RETURN jsonb_build_object(
    'totalAkhir', v_total_akhir,
    'diterima', v_diterima,
    'tunai', v_tunai,
    'transfer', v_transfer,
    'qris', v_qris
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_dashboard_rekap_status(p_user_id uuid, p_mulai timestamp with time zone DEFAULT NULL::timestamp with time zone, p_akhir timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking int := 0;
  v_disewa int := 0;
  v_mendekati int := 0;
  v_telat int := 0;
  v_belum int := 0;
  v_selesai int := 0;
  v_batas_jam int;
  v_tenant uuid;
BEGIN
  -- SECURITY CHECK: p_user_id harus = tenant caller (owner: dirinya; staf: owner-nya).
  SELECT COALESCE(p.owner_id, p.user_id) INTO v_tenant
  FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_active;

  IF v_tenant IS NULL OR p_user_id != v_tenant THEN
    RAISE EXCEPTION 'Unauthorized: tenant mismatch. Attempted access to user % by user %',
                    p_user_id, auth.uid();
  END IF;

  -- Extract JSON scalar text, remove JSON quotes, default invalid ke 2 (identik 20260903).
  v_batas_jam := COALESCE((
    SELECT CASE
      WHEN NULLIF(btrim(value::text, '"'), '') ~ '^-?[0-9]+$'
        AND btrim(value::text, '"')::numeric BETWEEN -2147483648 AND 2147483647
        THEN btrim(value::text, '"')::int
      ELSE NULL
    END
    FROM settings
    WHERE user_id = p_user_id AND key = 'notif_jam'
  ), 2);

  SELECT
    COUNT(*) FILTER (WHERE status = 'Booking'),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND (waktu_kembali_rencana IS NULL OR waktu_kembali_rencana >= now())),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND waktu_kembali_rencana IS NOT NULL
      AND waktu_kembali_rencana < now()
      AND now() - waktu_kembali_rencana <= v_batas_jam * interval '1 hour'),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND waktu_kembali_rencana IS NOT NULL
      AND waktu_kembali_rencana < now()
      AND now() - waktu_kembali_rencana > v_batas_jam * interval '1 hour')
  INTO v_booking, v_disewa, v_mendekati, v_telat
  FROM transactions
  WHERE user_id = p_user_id
    AND status IN ('Booking', 'Disewa')
    AND (p_mulai IS NULL OR created_at >= p_mulai)
    AND (p_akhir IS NULL OR created_at <= p_akhir);

  SELECT COUNT(*) INTO v_belum
  FROM transactions
  WHERE user_id = p_user_id
    AND status = 'Belum Selesai'
    AND (p_mulai IS NULL OR created_at >= p_mulai)
    AND (p_akhir IS NULL OR created_at <= p_akhir);

  SELECT COUNT(*) INTO v_selesai
  FROM transactions
  WHERE user_id = p_user_id
    AND status = 'Selesai'
    AND (p_mulai IS NULL OR created_at >= p_mulai)
    AND (p_akhir IS NULL OR created_at <= p_akhir);

  RETURN jsonb_build_object(
    'booking', v_booking,
    'disewa', v_disewa,
    'mendekati', v_mendekati,
    'telat', v_telat,
    'belumSelesai', v_belum,
    'selesai', v_selesai
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_hapus_data_user(p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target profiles%ROWTYPE;
  uid UUID;
  v_ids UUID[];
BEGIN
  SELECT * INTO target FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'profil tidak ditemukan'; END IF;

  -- GUARD: service_role (route server) ATAU superadmin ATAU owner utk stafnya
  IF NOT (
    (auth.jwt() ->> 'role') = 'service_role'
    OR EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin')
    OR (target.owner_id = auth.uid() AND target.user_id <> auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'owner'))
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  uid := target.user_id;

  v_ids := ARRAY[uid];
  SELECT array_agg(s.user_id) INTO v_ids
    FROM (SELECT user_id FROM profiles WHERE owner_id = uid
          UNION SELECT uid) s;

  -- URUTAN WAJIB: transactions DULU (CASCADE transaction_items/payments),
  -- baru inventory (FK RESTRICT dari transaction_items).
  DELETE FROM transactions  WHERE user_id = ANY(v_ids);
  DELETE FROM inventory     WHERE user_id = ANY(v_ids);
  DELETE FROM activity_logs WHERE user_id = ANY(v_ids);

  -- data pelanggan tenant (sebelumnya tertinggal)
  DELETE FROM members      WHERE user_id = ANY(v_ids);
  DELETE FROM member_types WHERE user_id = ANY(v_ids);
  DELETE FROM promo_codes  WHERE user_id = ANY(v_ids);

  -- hapus data per-akun
  DELETE FROM settings    WHERE user_id = ANY(v_ids);
  DELETE FROM admin_logs  WHERE actor_email = p_email OR target_email = p_email;
  DELETE FROM login_logs  WHERE email = p_email OR email IN (SELECT email FROM profiles WHERE user_id = ANY(v_ids));

  -- hapus profil
  DELETE FROM profiles    WHERE user_id = ANY(v_ids);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_list_admin_logs()
 RETURNS TABLE(actor_email text, aksi text, target_email text, detail text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT l.actor_email, l.aksi, l.target_email, l.detail, l.created_at
    FROM admin_logs l ORDER BY l.created_at DESC LIMIT 500;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_list_akun()
 RETURNS TABLE(email text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT u.email::text, u.created_at
    FROM auth.users u
    WHERE u.email IS NOT NULL
    ORDER BY u.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_list_login_logs()
 RETURNS TABLE(id bigint, email text, event text, detail text, ip text, user_agent text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- retensi 30 hari: hapus log kedaluwarsa (baris yang sudah lewat 30 hari)
  DELETE FROM public.login_logs
  WHERE login_logs.created_at < now() - interval '30 days';

  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RETURN QUERY
      SELECT l.id, l.email, l.event, l.detail, l.ip, l.user_agent, l.created_at
      FROM public.login_logs l
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 500;
  ELSIF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'owner') THEN
    RETURN QUERY
      SELECT l.id, l.email, l.event, l.detail, l.ip, l.user_agent, l.created_at
      FROM public.login_logs l
      WHERE l.owner_id = auth.uid()
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 500;
  ELSE
    RAISE EXCEPTION 'not allowed';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_list_owners()
 RETURNS TABLE(email text, created_at timestamp with time zone, nama_lengkap text, is_active boolean, jumlah_staff bigint, locked_until timestamp with time zone, failed_login integer, status text, subscribed_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT p.email::text, p.created_at, p.nama_lengkap, p.is_active,
           (SELECT count(*)::BIGINT FROM profiles s WHERE s.owner_id = p.user_id),
           p.locked_until, p.failed_login, p.status, p.subscribed_until
    FROM profiles p
    WHERE p.role = 'owner'
    ORDER BY p.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_list_staff()
 RETURNS TABLE(email text, created_at timestamp with time zone, role text, nama_lengkap text, is_active boolean, locked_until timestamp with time zone, failed_login integer, status text, subscribed_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
    SELECT p.email::text, p.created_at, p.role, p.nama_lengkap, p.is_active, p.locked_until, p.failed_login, p.status, p.subscribed_until
    FROM profiles p
    WHERE p.owner_id = auth.uid()
    ORDER BY p.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_list_users()
 RETURNS TABLE(email text, created_at timestamp with time zone, role text, nama_lengkap text, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT u.email::text, u.created_at, p.role, p.nama_lengkap, p.is_active
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    WHERE u.email IS NOT NULL
    ORDER BY u.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_register_login_failure(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fl INTEGER;
BEGIN
  UPDATE public.profiles
  SET failed_login = CASE
        WHEN last_failed_at IS NULL OR last_failed_at < now() - interval '24 hours'
        THEN 1
        ELSE failed_login + 1
      END,
      last_failed_at = now()
  WHERE user_id = p_user_id
  RETURNING failed_login INTO v_fl;

  RETURN COALESCE(v_fl, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_reserve_verification_resend(p_email text, p_ip text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  now_ts TIMESTAMPTZ := now();
  recent TIMESTAMPTZ[];
  ip_count INTEGER;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN RETURN FALSE; END IF;
  SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO recent
  FROM unnest(COALESCE((SELECT sent_at FROM auth_verification_resends WHERE email = lower(trim(p_email))), '{}')) x
  WHERE x > now_ts - interval '1 hour';

  IF EXISTS (SELECT 1 FROM auth_verification_resends WHERE email = lower(trim(p_email)) AND last_sent_at > now_ts - interval '60 seconds') THEN RETURN FALSE; END IF;
  IF COALESCE(array_length(recent, 1), 0) >= 3 THEN RETURN FALSE; END IF;
  SELECT count(*) INTO ip_count FROM auth_verification_resends WHERE ip = p_ip AND updated_at > now_ts - interval '1 hour';
  IF p_ip IS NOT NULL AND ip_count >= 20 THEN RETURN FALSE; END IF;

  INSERT INTO auth_verification_resends(email, ip, sent_at, last_sent_at)
  VALUES (lower(trim(p_email)), p_ip, recent || now_ts, now_ts)
  ON CONFLICT (email) DO UPDATE SET ip = EXCLUDED.ip, sent_at = EXCLUDED.sent_at, last_sent_at = EXCLUDED.last_sent_at, updated_at = now_ts;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_save_transaction(p_transaction jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb, p_replace_items boolean DEFAULT false, p_replace_payments boolean DEFAULT false)
 RETURNS transactions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_owner uuid; v_parent public.transactions; v_item jsonb; v_payment jsonb;
 v_id bigint; v_member bigint; v_inventory bigint; v_qty integer; v_price numeric; v_subtotal numeric; v_amount numeric; v_method enum_metode_bayar; v_status enum_status_transaksi;
 v_denda numeric; v_biaya numeric; v_total numeric; v_ta timestamptz; v_tk timestamptz; v_aa timestamptz; v_ak timestamptz; v_pd timestamptz;
 v_invoice text;
 v_dp_hangus numeric; -- DP Hangus
 v_printilan jsonb; -- [NEW] Printilan
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
 IF jsonb_typeof(p_transaction)<>'object' THEN RAISE EXCEPTION 'p_transaction must be a JSON object' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_items)<>'array' OR jsonb_typeof(p_payments)<>'array' THEN RAISE EXCEPTION 'p_items and p_payments must be JSON arrays' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(owner_id,user_id) INTO v_owner FROM profiles WHERE user_id=v_uid AND is_active;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Active profile required' USING ERRCODE='42501'; END IF;
 BEGIN
  v_id=NULLIF(p_transaction->>'id','')::bigint; v_member=NULLIF(p_transaction->>'member_id','')::bigint;
  v_denda=COALESCE(NULLIF(p_transaction->>'denda','')::numeric,0); v_biaya=COALESCE(NULLIF(p_transaction->>'biaya','')::numeric,0); v_total=COALESCE(NULLIF(p_transaction->>'total_akhir','')::numeric,0);
  v_ta=NULLIF(p_transaction->>'waktu_ambil_rencana','')::timestamptz; v_tk=NULLIF(p_transaction->>'waktu_kembali_rencana','')::timestamptz; v_aa=NULLIF(p_transaction->>'waktu_ambil_aktual','')::timestamptz; v_ak=NULLIF(p_transaction->>'waktu_kembali_aktual','')::timestamptz;
  v_dp_hangus=COALESCE(NULLIF(p_transaction->>'dp_hangus','')::numeric,0);
  v_printilan=COALESCE(p_transaction->'printilan','[]'::jsonb); -- [NEW]
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid parent numeric, id, member_id, or timestamp JSON value' USING ERRCODE='22023'; END;
 v_invoice=NULLIF(COALESCE(p_transaction->>'no_invoice',p_transaction->>'id_transaksi'),'');
 IF v_denda<0 OR v_biaya<0 OR v_total<0 OR v_dp_hangus<0 THEN RAISE EXCEPTION 'Parent denda, biaya, total_akhir, and dp_hangus must be >= 0' USING ERRCODE='22023'; END IF;
 v_status=COALESCE((p_transaction->>'status')::enum_status_transaksi,'Booking'::enum_status_transaksi);
 IF v_status NOT IN ('Booking','Disewa','Selesai','Belum Selesai','Dibatalkan') THEN RAISE EXCEPTION 'Invalid transaction status' USING ERRCODE='22023'; END IF;
 IF v_member IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members WHERE id=v_member AND user_id=v_owner) THEN RAISE EXCEPTION 'Member does not belong to tenant' USING ERRCODE='42501'; END IF;
 IF v_id IS NULL THEN RAISE EXCEPTION 'id is required (client-generated, e.g. Date.now()) — DB has no id generator' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_parent FROM transactions WHERE id=v_id AND user_id=v_owner FOR UPDATE;
  IF FOUND THEN
    UPDATE transactions SET id_transaksi=COALESCE(p_transaction->>'id_transaksi',id_transaksi),no_invoice=COALESCE(v_invoice,no_invoice),
    penyewa=COALESCE(p_transaction->>'penyewa',penyewa),hp_penyewa=COALESCE(p_transaction->>'hp_penyewa',hp_penyewa),alamat_penyewa=COALESCE(p_transaction->>'alamat_penyewa',alamat_penyewa),jaminan_sewa=COALESCE(p_transaction->>'jaminan_sewa',jaminan_sewa),waktu_ambil_rencana=COALESCE(v_ta,waktu_ambil_rencana),waktu_kembali_rencana=COALESCE(v_tk,waktu_kembali_rencana),waktu_ambil_aktual=COALESCE(v_aa,waktu_ambil_aktual),waktu_kembali_aktual=COALESCE(v_ak,waktu_kembali_aktual),status=COALESCE((p_transaction->>'status')::enum_status_transaksi,status),items=CASE WHEN jsonb_typeof(p_transaction->'items')='array' THEN p_transaction->'items' ELSE items END,denda=CASE WHEN p_transaction ? 'denda' THEN v_denda ELSE denda END,biaya=CASE WHEN p_transaction ? 'biaya' THEN v_biaya ELSE biaya END,durasi_teks=COALESCE(p_transaction->>'durasi_teks',durasi_teks),total_akhir=CASE WHEN p_transaction ? 'total_akhir' THEN v_total ELSE total_akhir END,pembayaran=CASE WHEN jsonb_typeof(p_transaction->'pembayaran')='object' THEN p_transaction->'pembayaran' ELSE pembayaran END,diskon=CASE WHEN jsonb_typeof(p_transaction->'diskon')='object' THEN p_transaction->'diskon' ELSE diskon END,"riwayatDilayani"=CASE WHEN jsonb_typeof(p_transaction->'riwayatDilayani')='array' THEN p_transaction->'riwayatDilayani' ELSE "riwayatDilayani" END,dilayani_oleh=COALESCE(p_transaction->>'dilayani_oleh',dilayani_oleh),member_id=CASE WHEN p_transaction ? 'member_id' THEN v_member ELSE member_id END,dp_hangus=CASE WHEN p_transaction ? 'dp_hangus' THEN v_dp_hangus ELSE dp_hangus END,dp_hangus_aturan=COALESCE(p_transaction->>'dp_hangus_aturan',dp_hangus_aturan),printilan=CASE WHEN p_transaction ? 'printilan' THEN v_printilan ELSE printilan END,updated_at=now() WHERE id=v_id AND user_id=v_owner RETURNING * INTO v_parent;
  ELSE
    IF EXISTS (SELECT 1 FROM transactions WHERE id=v_id) THEN RAISE EXCEPTION 'Transaction belongs to another tenant' USING ERRCODE='42501'; END IF;
    INSERT INTO transactions(id,id_transaksi,no_invoice,penyewa,hp_penyewa,alamat_penyewa,jaminan_sewa,waktu_ambil_rencana,waktu_kembali_rencana,waktu_ambil_aktual,waktu_kembali_aktual,status,items,denda,biaya,durasi_teks,total_akhir,pembayaran,diskon,"riwayatDilayani",dilayani_oleh,member_id,dp_hangus,dp_hangus_aturan,printilan,user_id)
    VALUES(v_id,p_transaction->>'id_transaksi',v_invoice,p_transaction->>'penyewa',p_transaction->>'hp_penyewa',p_transaction->>'alamat_penyewa',p_transaction->>'jaminan_sewa',v_ta,v_tk,v_aa,v_ak,v_status,CASE WHEN jsonb_typeof(p_transaction->'items')='array' THEN p_transaction->'items' ELSE '[]'::jsonb END,v_denda,v_biaya,p_transaction->>'durasi_teks',v_total,CASE WHEN jsonb_typeof(p_transaction->'pembayaran')='object' THEN p_transaction->'pembayaran' ELSE '{}'::jsonb END,CASE WHEN jsonb_typeof(p_transaction->'diskon')='object' THEN p_transaction->'diskon' ELSE '{}'::jsonb END,CASE WHEN jsonb_typeof(p_transaction->'riwayatDilayani')='array' THEN p_transaction->'riwayatDilayani' ELSE '[]'::jsonb END,p_transaction->>'dilayani_oleh',v_member,v_dp_hangus,p_transaction->>'dp_hangus_aturan',v_printilan,v_owner) RETURNING * INTO v_parent;
  END IF;
 IF p_replace_items OR jsonb_array_length(p_items)>0 THEN
  IF p_replace_items THEN DELETE FROM transaction_items WHERE transaction_id=v_parent.id AND user_id=v_owner; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   IF jsonb_typeof(v_item)<>'object' THEN RAISE EXCEPTION 'Each item must be a JSON object' USING ERRCODE='22023'; END IF;
   IF v_item ? 'assignedSNs' AND jsonb_typeof(v_item->'assignedSNs')<>'array' THEN RAISE EXCEPTION 'item.assignedSNs must be a JSON array' USING ERRCODE='22023'; END IF;
   BEGIN v_inventory=NULLIF(COALESCE(v_item->>'inventory_id',v_item#>>'{ref,id}'),'')::bigint; v_qty=COALESCE(NULLIF(v_item->>'qty','')::integer,1); v_price=COALESCE(NULLIF(v_item->>'harga','')::numeric,NULLIF(v_item#>>'{ref,harga}','')::numeric,0); v_subtotal=COALESCE(NULLIF(v_item->>'subtotal','')::numeric,v_qty*v_price); EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid item inventory_id, qty, harga, or subtotal JSON value' USING ERRCODE='22023'; END;
   IF v_qty<=0 THEN RAISE EXCEPTION 'Item qty must be > 0' USING ERRCODE='22023'; END IF; IF v_price<0 OR v_subtotal<0 THEN RAISE EXCEPTION 'Item price and subtotal must be >= 0' USING ERRCODE='22023'; END IF;
   IF v_inventory IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory WHERE id=v_inventory AND user_id=v_owner) THEN RAISE EXCEPTION 'Inventory does not belong to tenant' USING ERRCODE='42501'; END IF;
   INSERT INTO transaction_items(transaction_id,inventory_id,item_name,item_type,qty,unit_price,subtotal,rate_type,serial_number,assigned_components,user_id) VALUES(v_parent.id,v_inventory,COALESCE(v_item->>'nama',v_item#>>'{ref,nama}','Unknown'),COALESCE(v_item->>'jenis',v_item#>>'{ref,jenis}','satuan'),v_qty,v_price,v_subtotal,v_item->>'tarif',v_item->>'sn',COALESCE(v_item->'assignedSNs','[]'::jsonb),v_owner);
  END LOOP;
 END IF;
 IF p_replace_payments OR jsonb_array_length(p_payments)>0 THEN
  IF p_replace_payments THEN DELETE FROM transaction_payments WHERE transaction_id=v_parent.id AND user_id=v_owner; END IF;
  FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payments) LOOP
   IF jsonb_typeof(v_payment)<>'object' THEN RAISE EXCEPTION 'Each payment must be a JSON object' USING ERRCODE='22023'; END IF;
   BEGIN v_amount=NULLIF(v_payment->>'jumlah','')::numeric; v_pd=COALESCE(NULLIF(v_payment->>'tanggal','')::timestamptz,now()); EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid payment jumlah or tanggal JSON value' USING ERRCODE='22023'; END;
   v_method=COALESCE((v_payment->>'metode')::enum_metode_bayar,'Tunai'::enum_metode_bayar); IF v_amount IS NULL OR v_amount<=0 THEN RAISE EXCEPTION 'Payment amount must be > 0' USING ERRCODE='22023'; END IF; IF v_method NOT IN ('Tunai','Transfer','QRIS') THEN RAISE EXCEPTION 'Invalid payment method: %',v_method USING ERRCODE='22023'; END IF;
   INSERT INTO transaction_payments(transaction_id,amount,payment_method,payment_date,notes,user_id) VALUES(v_parent.id,v_amount,v_method,v_pd,v_payment->>'catatan',v_owner);
  END LOOP;
 END IF; RETURN v_parent;
 EXCEPTION WHEN foreign_key_violation THEN RAISE EXCEPTION 'Referenced record violates tenant/schema constraint' USING ERRCODE='23503'; WHEN check_violation THEN RAISE EXCEPTION 'Transaction data violates table constraint' USING ERRCODE='23514'; WHEN unique_violation THEN RAISE EXCEPTION 'Transaction ID already exists or concurrent save detected' USING ERRCODE='23505';
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_set_role(p_email text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE target profiles%ROWTYPE;
BEGIN
  IF p_role NOT IN ('owner', 'cs', 'gudang') THEN RAISE EXCEPTION 'role tidak valid'; END IF;
  SELECT * INTO target FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'profil tidak ditemukan'; END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    IF target.role = 'superadmin' THEN RAISE EXCEPTION 'tidak bisa ubah superadmin'; END IF;
  ELSIF target.owner_id = auth.uid() THEN
    IF p_role IN ('owner', 'superadmin') THEN RAISE EXCEPTION 'tidak bisa jadikan owner/superadmin'; END IF;
  ELSE
    RAISE EXCEPTION 'not allowed';
  END IF;

  UPDATE profiles SET role = p_role, updated_at = now() WHERE email = p_email;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_tambah_admin_log(p_actor text, p_aksi text, p_target text, p_detail text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (
    (auth.jwt() ->> 'role') = 'service_role'
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE email = (auth.jwt() ->> 'email')
        AND role IN ('owner', 'superadmin')
        AND is_active
    )
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  INSERT INTO admin_logs (actor_email, aksi, target_email, detail)
  VALUES (p_actor, p_aksi, p_target, p_detail);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_toggle_active(p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE target profiles%ROWTYPE;
BEGIN
  SELECT * INTO target FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'profil tidak ditemukan'; END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    IF target.role = 'superadmin' THEN RAISE EXCEPTION 'tidak bisa nonaktifkan superadmin'; END IF;
  ELSIF target.owner_id = auth.uid() THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF target.email = (auth.jwt() ->> 'email') THEN RAISE EXCEPTION 'tidak bisa nonaktifkan diri sendiri'; END IF;

  UPDATE profiles SET is_active = NOT is_active, updated_at = now() WHERE email = p_email;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_unlock_akun(p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target profiles%ROWTYPE;
BEGIN
  SELECT * INTO target FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'profil tidak ditemukan'; END IF;

  -- superadmin: boleh unlock siapa pun (kecuali... superadmin lain? tidak ada, hanya 1)
  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    NULL; -- boleh
  ELSIF target.owner_id = auth.uid() AND target.user_id <> auth.uid() THEN
    NULL; -- owner unlock staf-nya (bukan diri sendiri)
  ELSE
    RAISE EXCEPTION 'not allowed';
  END IF;

  UPDATE profiles
  SET failed_login = 0, last_failed_at = NULL, cooldown_until = NULL, locked_until = NULL,
      updated_at = now()
  WHERE email = p_email;
END;
$function$;

-- ===== triggers (4) =====
CREATE TRIGGER trg_login_logs_retensi BEFORE INSERT ON public.login_logs FOR EACH ROW EXECUTE FUNCTION purge_login_logs_retensi();

CREATE TRIGGER trg_protect_profile_self BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_self_escalation();

CREATE TRIGGER trg_telegram_pendaftar AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION notify_telegram_pendaftar();

CREATE TRIGGER trg_telegram_transaksi AFTER INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION notify_telegram_transaksi();

-- ===== policies (26) =====
CREATE POLICY access_own_or_owner_logs ON public.activity_logs AS PERMISSIVE FOR ALL TO authenticated USING (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid())))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid()))))));

CREATE POLICY admin_logs_insert_owner ON public.admin_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((rpc_auth_punya_role('owner'::text) OR rpc_auth_punya_role('superadmin'::text)));

CREATE POLICY admin_logs_select_superadmin ON public.admin_logs AS PERMISSIVE FOR SELECT TO authenticated USING (rpc_auth_punya_role('superadmin'::text));

CREATE POLICY access_own_or_owner_inventory ON public.inventory AS PERMISSIVE FOR ALL TO authenticated USING (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid())))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid()))))));

CREATE POLICY phase9_5_inventory_units_access ON public.inventory_units AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND p.is_active AND ((inventory_units.user_id = auth.uid()) OR (inventory_units.user_id = p.owner_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND p.is_active AND ((inventory_units.user_id = auth.uid()) OR (inventory_units.user_id = p.owner_id))))));

CREATE POLICY member_templates_access_own_or_owner ON public.member_types AS PERMISSIVE FOR ALL TO authenticated USING (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid())))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid()))))));

CREATE POLICY members_access_own_or_owner ON public.members AS PERMISSIVE FOR ALL TO authenticated USING (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid())))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid()))))));

CREATE POLICY permissions_public_read ON public.permissions AS PERMISSIVE FOR SELECT TO PUBLIC USING ((is_active = true));

CREATE POLICY profiles_select_allowed ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR rpc_auth_punya_role('superadmin'::text) OR (owner_id = auth.uid())));

CREATE POLICY profiles_write_allowed ON public.profiles AS PERMISSIVE FOR ALL TO authenticated USING ((rpc_auth_punya_role('superadmin'::text) OR (user_id = auth.uid()) OR (owner_id = auth.uid()))) WITH CHECK ((rpc_auth_punya_role('superadmin'::text) OR (user_id = auth.uid()) OR (owner_id = auth.uid())));

CREATE POLICY promo_codes_access_own_or_owner ON public.promo_codes AS PERMISSIVE FOR ALL TO authenticated USING (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid())))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid()))))));

CREATE POLICY role_permissions_public_read ON public.role_permissions AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY settings_own_or_owner ON public.settings AS PERMISSIVE FOR ALL TO authenticated USING (((user_id = auth.uid()) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.owner_id = settings.user_id) AND p.is_active))) AND (key <> ALL (ARRAY['telegram_login_notif'::text, 'webhook_sheets'::text]))))) WITH CHECK (((user_id = auth.uid()) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.owner_id = settings.user_id) AND p.is_active))) AND (key <> ALL (ARRAY['telegram_login_notif'::text, 'webhook_sheets'::text])))));

CREATE POLICY feature_overrides_owner_read ON public.sewara_feature_overrides AS PERMISSIVE FOR SELECT TO PUBLIC USING ((owner_id = auth.uid()));

CREATE POLICY payment_methods_owner_all ON public.sewara_payment_methods AS PERMISSIVE FOR ALL TO PUBLIC USING ((owner_id = auth.uid()));

CREATE POLICY plan_features_public_read ON public.sewara_plan_features AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY plans_public_read ON public.sewara_plans AS PERMISSIVE FOR SELECT TO PUBLIC USING ((is_active = true));

CREATE POLICY sub_events_owner_read ON public.sewara_subscription_events AS PERMISSIVE FOR SELECT TO PUBLIC USING ((subscription_id IN ( SELECT sewara_subscriptions.id
   FROM sewara_subscriptions
  WHERE (sewara_subscriptions.owner_id = auth.uid()))));

CREATE POLICY sub_payments_owner_read ON public.sewara_subscription_payments AS PERMISSIVE FOR SELECT TO PUBLIC USING ((subscription_id IN ( SELECT sewara_subscriptions.id
   FROM sewara_subscriptions
  WHERE (sewara_subscriptions.owner_id = auth.uid()))));

CREATE POLICY subscriptions_owner_all ON public.sewara_subscriptions AS PERMISSIVE FOR ALL TO PUBLIC USING ((owner_id = auth.uid()));

CREATE POLICY usage_counters_owner_all ON public.sewara_usage_counters AS PERMISSIVE FOR ALL TO PUBLIC USING ((owner_id = auth.uid()));

CREATE POLICY staff_permissions_owner_all ON public.staff_permissions AS PERMISSIVE FOR ALL TO PUBLIC USING ((owner_id = auth.uid()));

CREATE POLICY staff_permissions_staff_read ON public.staff_permissions AS PERMISSIVE FOR SELECT TO PUBLIC USING ((staff_user_id = auth.uid()));

CREATE POLICY phase9_5_transaction_items_access ON public.transaction_items AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND p.is_active AND ((transaction_items.user_id = auth.uid()) OR (transaction_items.user_id = p.owner_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND p.is_active AND ((transaction_items.user_id = auth.uid()) OR (transaction_items.user_id = p.owner_id))))));

CREATE POLICY phase9_5_transaction_payments_access ON public.transaction_payments AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND p.is_active AND ((transaction_payments.user_id = auth.uid()) OR (transaction_payments.user_id = p.owner_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND p.is_active AND ((transaction_payments.user_id = auth.uid()) OR (transaction_payments.user_id = p.owner_id))))));

CREATE POLICY access_own_or_owner_transactions ON public.transactions AS PERMISSIVE FOR ALL TO authenticated USING (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid())))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = auth.uid()) AND profiles.is_active))) AND ((user_id = auth.uid()) OR (user_id = ( SELECT profiles.owner_id
   FROM profiles
  WHERE (profiles.user_id = auth.uid()))))));

-- ===== rls enable (28) =====
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.auth_verification_resends ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.inventory_units ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.log_count ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.member_types ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mt_count ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sewara_feature_overrides ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sewara_payment_methods ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sewara_plan_features ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sewara_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sewara_subscription_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sewara_subscription_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sewara_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sewara_usage_counters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transaction_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ===== rls force (0) =====
-- ===== comments (31) =====
COMMENT ON TABLE public.sewara_plans IS 'Paket langganan SaaS (Starter, Pro, Business)';

COMMENT ON TABLE public.sewara_plan_features IS 'Fitur dan limit per paket (max transaksi, inventory, member, dll)';

COMMENT ON TABLE public.sewara_subscriptions IS 'Langganan aktif per owner (1 owner = 1 subscription)';

COMMENT ON TABLE public.sewara_subscription_payments IS 'Riwayat pembayaran langganan (link ke payment gateway)';

COMMENT ON TABLE public.sewara_subscription_events IS 'Log webhook event dari payment gateway (untuk debugging & audit)';

COMMENT ON TABLE public.sewara_usage_counters IS 'Tracking pemakaian bulanan per owner (untuk enforce limit paket)';

COMMENT ON TABLE public.sewara_feature_overrides IS 'Override limit khusus per owner (bonus, promo, custom deal)';

COMMENT ON TABLE public.sewara_payment_methods IS 'Metode pembayaran tersimpan per owner (untuk auto-renewal)';

COMMENT ON TABLE public.permissions IS 'Master list permission (inventory.view, transaction.create, report.export, dll)';

COMMENT ON TABLE public.role_permissions IS 'Default permission template per role (owner, supervisor, cs, gudang)';

COMMENT ON TABLE public.staff_permissions IS 'Custom permission override per staff per owner (grant/revoke individual permission)';

COMMENT ON COLUMN public.members.hp IS 'Nomor HP pelanggan (format Indonesia: 08xx atau +62)';

COMMENT ON COLUMN public.members.alamat IS 'Alamat lengkap pelanggan';

COMMENT ON COLUMN public.members.email IS 'Email pelanggan';

COMMENT ON COLUMN public.members.foto_jaminan IS 'Array of member documents: [{"label": "KTP", "path": "user-id/member-id/doc-0.jpg"}]. Max 5 documents.';

COMMENT ON COLUMN public.members.catatan IS 'Catatan internal untuk pelanggan';

COMMENT ON COLUMN public.sewara_plans.price_monthly IS 'Harga dalam rupiah (contoh: 99000 = Rp 99.000)';

COMMENT ON COLUMN public.sewara_plans.trial_days IS 'Jumlah hari trial gratis untuk plan baru';

COMMENT ON COLUMN public.sewara_plan_features.feature_code IS 'Kode fitur: max_transactions_monthly, max_inventory_items, max_members, max_staff, max_storage_mb, dll';

COMMENT ON COLUMN public.sewara_plan_features.limit_value IS 'Nilai limit (NULL = unlimited)';

COMMENT ON COLUMN public.sewara_subscriptions.status IS 'Status langganan: trialing, active, past_due, grace_period, cancelled, expired, suspended';

COMMENT ON COLUMN public.sewara_subscriptions.metadata IS 'Data fleksibel: payment_provider, external_subscription_id, dll';

COMMENT ON COLUMN public.sewara_subscription_payments.external_payment_id IS 'ID payment dari provider (Midtrans/Xendit/Stripe)';

COMMENT ON COLUMN public.sewara_subscription_events.payload IS 'Raw webhook payload dari payment gateway';

COMMENT ON COLUMN public.sewara_usage_counters.current_value IS 'Jumlah pemakaian saat ini di periode ini';

COMMENT ON COLUMN public.sewara_usage_counters.limit_value IS 'Limit dari plan (copy dari sewara_plan_features)';

COMMENT ON COLUMN public.sewara_feature_overrides.override_value IS 'Nilai override (NULL = unlimited, prioritas tertinggi)';

COMMENT ON COLUMN public.sewara_payment_methods.external_method_id IS 'Token/ID metode pembayaran dari provider (jangan simpan data kartu mentah)';

COMMENT ON COLUMN public.permissions.code IS 'Kode unik permission: {module}.{action} (contoh: inventory.create, transaction.delete)';

COMMENT ON COLUMN public.role_permissions.is_default IS 'Permission default yang otomatis diberikan saat assign role';

COMMENT ON COLUMN public.staff_permissions.is_granted IS 'true = grant permission, false = revoke permission (override default dari role)';

-- ===== sequence sync (6) =====
SELECT setval('public.activity_logs_id_seq', 1790173239930, true);

SELECT setval('public.admin_logs_id_seq', 168, true);

SELECT setval('public.inventory_id_seq', 1790674561116, true);

SELECT setval('public.inventory_units_id_seq', 528, true);

SELECT setval('public.transaction_items_id_seq', 566, true);

SELECT setval('public.transaction_payments_id_seq', 371, true);
