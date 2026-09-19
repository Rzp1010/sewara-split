# Entity Relationship Diagram (ERD)

**Project:** Sewara Apps  
**Last Updated:** 30 August 2026  
**Total Tables:** 28

---

## Visual ERD (Mermaid Diagram)

### Business Rental Domain

```mermaid
erDiagram
    AUTH_USERS ||--o{ PROFILES : "has"
    AUTH_USERS ||--o{ LOGIN_LOGS : "generates"
    AUTH_USERS ||--o{ ACTIVITY_LOGS : "generates"
    AUTH_USERS ||--o{ ADMIN_LOGS : "generates"
    
    PROFILES {
        uuid user_id PK
        text nama
        text role
        boolean is_active
        timestamptz created_at
    }
    
    MEMBER_TYPES ||--o{ MEMBERS : "categorizes"
    MEMBER_TYPES {
        text id PK
        text nama
        integer diskon
        enum status
        uuid user_id FK
        timestamptz created_at
    }
    
    MEMBERS ||--o{ TRANSACTIONS : "makes"
    MEMBERS {
        text id PK
        text nama
        text hp
        text alamat
        text member_type_id FK
        integer diskon
        enum status
        uuid user_id FK
        timestamptz created_at
    }
    
    INVENTORY ||--o{ INVENTORY_UNITS : "has_units"
    INVENTORY ||--o{ TRANSACTION_ITEMS : "rented_as"
    INVENTORY {
        text id PK
        text nama
        integer stok
        integer harga
        text satuan
        enum jenis
        enum kondisi
        text gambar
        jsonb komponen
        jsonb sns
        uuid user_id FK
        timestamptz created_at
    }
    
    INVENTORY_UNITS {
        uuid id PK
        text inventory_id FK
        text serial_number
        text status
        uuid user_id FK
        timestamptz created_at
    }
    
    TRANSACTIONS ||--o{ TRANSACTION_ITEMS : "contains"
    TRANSACTIONS ||--o{ TRANSACTION_PAYMENTS : "has_payments"
    TRANSACTIONS {
        text id PK
        text no_invoice
        text penyewa
        text hp_penyewa
        text alamat_penyewa
        text member_id FK
        jsonb jaminan_sewa
        timestamptz waktu_ambil_rencana
        timestamptz waktu_kembali_rencana
        timestamptz waktu_ambil_aktual
        timestamptz waktu_kembali_aktual
        text durasi_teks
        enum status
        integer biaya
        integer denda
        integer total_akhir
        jsonb items
        jsonb pembayaran
        uuid user_id FK
        uuid created_by
        uuid updated_by
        timestamptz created_at
        timestamptz updated_at
    }
    
    TRANSACTION_ITEMS {
        uuid id PK
        text transaction_id FK
        text inventory_id FK
        text item_name
        text item_type
        integer qty
        numeric unit_price
        numeric subtotal
        text rate_type
        text serial_number
        jsonb assigned_components
        uuid user_id FK
        timestamptz created_at
        timestamptz updated_at
    }
    
    TRANSACTION_PAYMENTS {
        uuid id PK
        text transaction_id FK
        enum payment_method
        integer amount
        timestamptz payment_date
        text notes
        uuid user_id FK
        timestamptz created_at
    }
    
    PROMO_CODES {
        text id PK
        text code
        integer discount_percent
        integer discount_amount
        timestamptz valid_from
        timestamptz valid_until
        integer max_usage
        integer current_usage
        boolean is_active
        uuid user_id FK
        timestamptz created_at
    }
    
    SETTINGS {
        text id PK
        text key
        text value
        uuid user_id FK
        timestamptz created_at
    }
    
    ACTIVITY_LOGS {
        bigserial id PK
        uuid user_id FK
        text action
        text entity_type
        text entity_id
        jsonb details
        timestamptz created_at
    }
    
    LOGIN_LOGS {
        bigserial id PK
        uuid user_id FK
        text event_type
        text ip_address
        text user_agent
        timestamptz created_at
    }
    
    ADMIN_LOGS {
        bigserial id PK
        uuid admin_user_id FK
        text action
        uuid target_user_id
        jsonb details
        timestamptz created_at
    }
```

---

### SaaS Platform Domain

```mermaid
erDiagram
    AUTH_USERS ||--o| SEWARA_SUBSCRIPTIONS : "subscribes"
    AUTH_USERS ||--o{ SEWARA_USAGE_COUNTERS : "tracks_usage"
    AUTH_USERS ||--o{ SEWARA_FEATURE_OVERRIDES : "has_overrides"
    AUTH_USERS ||--o{ SEWARA_PAYMENT_METHODS : "stores_methods"
    
    SEWARA_PLANS ||--o{ SEWARA_PLAN_FEATURES : "defines"
    SEWARA_PLANS ||--o{ SEWARA_SUBSCRIPTIONS : "offers"
    SEWARA_PLANS {
        uuid id PK
        text name
        text slug
        text description
        integer price_monthly
        integer price_yearly
        integer trial_days
        boolean is_active
        integer display_order
        timestamptz created_at
        timestamptz updated_at
    }
    
    SEWARA_PLAN_FEATURES {
        uuid id PK
        uuid plan_id FK
        text feature_code
        text feature_name
        integer limit_value
        boolean is_enabled
        timestamptz created_at
    }
    
    SEWARA_SUBSCRIPTIONS ||--o{ SEWARA_SUBSCRIPTION_PAYMENTS : "generates"
    SEWARA_SUBSCRIPTIONS ||--o{ SEWARA_SUBSCRIPTION_EVENTS : "logs"
    SEWARA_SUBSCRIPTIONS {
        uuid id PK
        uuid owner_id FK
        uuid plan_id FK
        enum status
        timestamptz trial_ends_at
        timestamptz current_period_start
        timestamptz current_period_end
        timestamptz cancel_at
        timestamptz cancelled_at
        timestamptz ended_at
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
    }
    
    SEWARA_SUBSCRIPTION_PAYMENTS {
        uuid id PK
        uuid subscription_id FK
        integer amount
        text currency
        text status
        text payment_provider
        text external_payment_id
        text payment_method
        timestamptz paid_at
        timestamptz failed_at
        timestamptz refunded_at
        jsonb metadata
        timestamptz created_at
    }
    
    SEWARA_SUBSCRIPTION_EVENTS {
        uuid id PK
        uuid subscription_id FK
        enum event_type
        text event_source
        jsonb payload
        boolean processed
        timestamptz processed_at
        text error_message
        timestamptz created_at
    }
    
    SEWARA_USAGE_COUNTERS {
        uuid id PK
        uuid owner_id FK
        text feature_code
        date period_start
        date period_end
        integer current_value
        integer limit_value
        timestamptz created_at
        timestamptz updated_at
    }
    
    SEWARA_FEATURE_OVERRIDES {
        uuid id PK
        uuid owner_id FK
        text feature_code
        integer override_value
        text reason
        timestamptz valid_from
        timestamptz valid_until
        uuid created_by
        timestamptz created_at
    }
    
    SEWARA_PAYMENT_METHODS {
        uuid id PK
        uuid owner_id FK
        text payment_provider
        text external_method_id
        text type
        text last4
        text brand
        boolean is_default
        timestamptz expires_at
        timestamptz created_at
    }
    
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "assigned_to_roles"
    PERMISSIONS ||--o{ STAFF_PERMISSIONS : "overridden_for_staff"
    PERMISSIONS {
        uuid id PK
        text code
        text name
        text description
        enum category
        boolean is_active
        timestamptz created_at
    }
    
    ROLE_PERMISSIONS {
        uuid id PK
        text role
        uuid permission_id FK
        boolean is_default
        timestamptz created_at
    }
    
    AUTH_USERS ||--o{ STAFF_PERMISSIONS : "staff_has"
    AUTH_USERS ||--o{ STAFF_PERMISSIONS : "owner_grants"
    STAFF_PERMISSIONS {
        uuid id PK
        uuid staff_user_id FK
        uuid owner_id FK
        uuid permission_id FK
        boolean is_granted
        timestamptz overridden_at
        uuid overridden_by
    }
```

---

## Relationship Summary

### One-to-Many Relationships

| Parent Table | Child Table | Relationship | FK Column |
|--------------|-------------|--------------|-----------|
| `auth.users` | `profiles` | 1:1 | `user_id` |
| `auth.users` | `sewara_subscriptions` | 1:1 | `owner_id` |
| `auth.users` | `login_logs` | 1:many | `user_id` |
| `auth.users` | `activity_logs` | 1:many | `user_id` |
| `auth.users` | `sewara_usage_counters` | 1:many | `owner_id` |
| `auth.users` | `sewara_payment_methods` | 1:many | `owner_id` |
| `member_types` | `members` | 1:many | `member_type_id` |
| `members` | `transactions` | 1:many | `member_id` |
| `inventory` | `inventory_units` | 1:many | `inventory_id` |
| `inventory` | `transaction_items` | 1:many | `inventory_id` |
| `transactions` | `transaction_items` | 1:many | `transaction_id` |
| `transactions` | `transaction_payments` | 1:many | `transaction_id` |
| `sewara_plans` | `sewara_plan_features` | 1:many | `plan_id` |
| `sewara_plans` | `sewara_subscriptions` | 1:many | `plan_id` |
| `sewara_subscriptions` | `sewara_subscription_payments` | 1:many | `subscription_id` |
| `sewara_subscriptions` | `sewara_subscription_events` | 1:many | `subscription_id` |
| `permissions` | `role_permissions` | 1:many | `permission_id` |
| `permissions` | `staff_permissions` | 1:many | `permission_id` |

### Tenant Isolation Pattern

Semua tabel bisnis rental menggunakan `user_id` sebagai tenant key:

```
auth.users (owner)
    ├── inventory (user_id)
    ├── inventory_units (user_id)
    ├── transactions (user_id)
    ├── transaction_items (user_id)
    ├── transaction_payments (user_id)
    ├── members (user_id)
    ├── member_types (user_id)
    ├── promo_codes (user_id)
    ├── settings (user_id)
    └── activity_logs (user_id)
```

Semua tabel SaaS platform menggunakan `owner_id`:

```
auth.users (owner)
    ├── sewara_subscriptions (owner_id)
    ├── sewara_usage_counters (owner_id)
    ├── sewara_feature_overrides (owner_id)
    └── sewara_payment_methods (owner_id)
```

---

## Cross-Domain Relationships

### Business ↔ SaaS Integration

```
auth.users (owner)
    ├── Business Domain (via user_id)
    │   ├── inventory
    │   ├── transactions
    │   └── members
    │
    └── SaaS Domain (via owner_id)
        ├── sewara_subscriptions (active plan)
        ├── sewara_usage_counters (current usage)
        └── sewara_feature_overrides (custom limits)
```

**Usage Check Flow:**
1. User creates transaction
2. Check `sewara_subscriptions` (active?)
3. Check `sewara_feature_overrides` (custom limit?)
4. Check `sewara_plan_features` (plan limit?)
5. Check `sewara_usage_counters` (current usage)
6. Allow/deny action based on limit

---

## Data Flow Examples

### Transaction Creation Flow

```
User creates transaction
    ↓
transactions (main record)
    ↓
transaction_items (items detail)
    ↓
transaction_payments (payment records)
    ↓
inventory.stok (decrement)
    ↓
activity_logs (log action)
    ↓
sewara_usage_counters (increment usage)
```

### Subscription Payment Flow

```
Payment Gateway (Midtrans/Xendit/Stripe)
    ↓
Webhook → /api/webhooks/payment
    ↓
sewara_subscription_events (log raw payload)
    ↓
Process event
    ↓
sewara_subscription_payments (record payment)
    ↓
sewara_subscriptions (update status)
    ↓
sewara_usage_counters (reset if new period)
```

### Permission Check Flow

```
User attempts action
    ↓
Check profiles.role (owner/supervisor/cs/gudang)
    ↓
If owner → allow all
    ↓
Check staff_permissions (custom override?)
    ↓
If override found → use is_granted value
    ↓
Else → check role_permissions (default)
    ↓
Allow/deny action
```

---

## Normalization Level

**Business Tables:** 3NF (Third Normal Form)
- No transitive dependencies
- JSONB used only for flexible/historical data

**SaaS Tables:** 3NF
- Proper FK relationships
- Normalized payment/event data

**Denormalized Fields (by design):**
- `transaction_items.item_name` — snapshot (inventory name may change)
- `transaction_items.unit_price` — snapshot (price may change)
- `transaction_items.item_type`, `rate_type`, `serial_number`, `assigned_components` — item rental details
- `transactions.penyewa`, `hp_penyewa`, `alamat_penyewa` — customer snapshot (member data may change)

**JSONB Usage (intentional):**
- `transactions.jaminan_sewa` — flexible structure (KTP/SIM/etc)
- `inventory.komponen` — bundling components (flexible structure)
- `transactions.items` — LEGACY fallback (dual-write)
- `transactions.pembayaran` — LEGACY fallback (dual-write)
- `inventory.sns` — LEGACY fallback (dual-write)

---

## Cascade Behavior

### ON DELETE CASCADE

**Parent → Child (auto-delete):**
- `inventory` DELETE → `inventory_units` CASCADE
- `transactions` DELETE → `transaction_items` CASCADE
- `transactions` DELETE → `transaction_payments` CASCADE
- `sewara_plans` DELETE → `sewara_plan_features` CASCADE
- `sewara_subscriptions` DELETE → `sewara_subscription_payments` CASCADE
- `auth.users` DELETE → `profiles` CASCADE
- `auth.users` DELETE → `sewara_subscriptions` CASCADE
- `auth.users` DELETE → `sewara_usage_counters` CASCADE
- `auth.users` DELETE → `sewara_payment_methods` CASCADE
- `permissions` DELETE → `role_permissions` CASCADE
- `permissions` DELETE → `staff_permissions` CASCADE

### ON DELETE SET NULL

**Parent DELETE → Child FK = NULL:**
- `members` DELETE → `transactions.member_id` SET NULL
- `member_types` DELETE → `members.member_type_id` SET NULL
- `inventory` DELETE → `transaction_items.inventory_id` SET NULL
- `sewara_subscriptions` DELETE → `sewara_subscription_events.subscription_id` SET NULL

---

## Indexes for Performance

### Critical Indexes

**Foreign Keys (all indexed for JOIN performance):**
- All `user_id` columns
- All `owner_id` columns
- All FK columns (inventory_id, transaction_id, plan_id, etc)

**Timestamp Indexes:**
- `created_at DESC` — recent records
- `updated_at DESC` — tracking changes
- `payment_date DESC` — recent payments

**Status/Category Indexes:**
- `transactions.status` — filter by status
- `sewara_subscriptions.status` — active subscriptions
- `sewara_subscriptions.current_period_end` — expiring subscriptions

**Composite Indexes:**
- `(user_id, key)` — settings lookup
- `(user_id, code)` — promo codes lookup
- `(owner_id, feature_code, period_start)` — usage counters lookup
- `(staff_user_id, owner_id)` — staff permissions lookup

---

## Future Schema Changes (Planned)

### Multi-Branch Support (Future Update)
**Impact:** High complexity

Add `branches` table and `branch_id` to all business tables:
- Change RLS from `user_id` to `branch_id`
- Staff assigned per branch
- Owner can view all branches

### Auth Migration (Future Update)
**Impact:** Medium complexity

Migrate from Supabase Auth to custom auth:
- Replace FK from `auth.users` to `users` table
- Update RLS policies
- Migrate existing user data

### Inventory Rates (Future Enhancement)
**Impact:** Low complexity

Add `inventory_rates` table for dynamic pricing:
- Different rates per duration (hourly/daily/weekly)
- Seasonal pricing
- Member-specific pricing

---

**Last Updated:** 30 August 2026  
**Maintained by:** Development Team  
**See also:** `SCHEMA.md`, `MIGRATIONS.md`
