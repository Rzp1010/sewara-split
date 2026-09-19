# Documentation Index

**Project:** Sewara Apps  
**Last Updated:** 30 August 2026

---

## 📚 Documentation Structure

Dokumentasi Sewara Apps dikelompokkan berdasarkan area/domain untuk kemudahan navigasi.

```
docs/
├── database/           # Database schema, ERD, migration history
├── api/               # (Future) API endpoints documentation
├── features/          # (Future) Feature specifications
└── README.md          # This file (documentation index)
```

---

## 🗄️ Database Documentation

### [SCHEMA.md](database/SCHEMA.md)
**Detailed database schema documentation**

**Content:**
- Overview 28 tabel (Business Rental + SaaS Platform + Utility)
- Detailed column specifications per tabel
- Data types, constraints, defaults
- Relationships & foreign keys
- RLS policies & tenant isolation strategy
- Enum types (9 total)
- Indexes for performance
- `transaction_items` actual columns: `item_name`, `item_type`, `unit_price`, `subtotal`, `rate_type`, `serial_number`, `assigned_components`
- Promo auto-expire status and request-triggered persistence
- Usage examples

**Use this when:**
- Butuh referensi kolom apa saja di tabel tertentu
- Cek data type dan constraint
- Understand FK relationships
- Review RLS policies
- Looking for enum values

---

### [ERD.md](database/ERD.md)
**Entity Relationship Diagrams**

**Content:**
- Visual Mermaid diagrams (Business + SaaS domains)
- Relationship summary (1:1, 1:many)
- Tenant isolation pattern visualization
- Cross-domain integration flow
- Data flow examples (transaction creation, payment webhook, permission check)
- Cascade behavior documentation
- Index strategy
- Future schema changes (planned)

**Use this when:**
- Butuh visual overview database structure
- Understand table relationships
- Planning new features (mana tabel yang terpengaruh?)
- Debugging FK constraints
- Architecture review

---

### [MIGRATIONS.md](database/MIGRATIONS.md)
**Complete migration history Phase 1-9**

**Content:**
- Timeline semua perubahan database (27 Aug - 30 Aug 2026)
- Detailed per-phase changes
- Migration SQL scripts
- Verification results
- Code changes per phase
- Deploy history
- Rollback procedures
- Known issues & resolutions
- Future migration plans

**Use this when:**
- Tracking "kapan tabel ini dibuat?"
- Understanding "kenapa schema-nya seperti ini?"
- Need rollback procedure
- Review past issues & solutions
- Planning next migration phase

---

## 📋 Project Documentation

### Root Level Files

**[SESSION_PROGRESS.md](../SESSION_PROGRESS.md)**
- Current project status (Phase 1-9 completed)
- Files created per phase
- Known issues & notes
- Next safe steps
- Quick reference for "what we did so far"

**[PHASE9_PLAN.md](../PHASE9_PLAN.md)**
- Phase 9 execution guide
- Step-by-step migration checklist
- Verification queries
- Integration examples (future)
- Detailed plan untuk SaaS infrastructure

**[FUTURE_UPDATES.md](../FUTURE_UPDATES.md)**
- Roadmap 11 fitur future
- Multi-cabang (high complexity)
- Payment gateway integration
- Data pelanggan detail + R2 storage
- Server-side pagination
- Auth migration
- Prioritization & estimasi

**[FITUR_BARU.md](../FITUR_BARU.md)**
- Original feature request dari tester
- Detailed technical specs
- R2 + SSE-C encryption design
- Task breakdown
- Storage architecture

---

## 🚀 Quick Start Guide

### For New Developers

1. **Start here:** Read this `README.md` for overview
2. **Understand database:** Read `database/SCHEMA.md` (focus on your domain)
3. **Visual overview:** Check `database/ERD.md` for table relationships
4. **Historical context:** Skim `database/MIGRATIONS.md` to understand "why"
5. **Current status:** Check `SESSION_PROGRESS.md` for latest state

### For Feature Development

1. **Plan:** Check `FUTURE_UPDATES.md` to see if it's already planned
2. **Schema impact:** Review `database/SCHEMA.md` & `ERD.md` for affected tables
3. **Migration:** Follow patterns in `database/MIGRATIONS.md`
4. **Implementation:** Use helper libraries (`src/lib/subscription.js`, `src/lib/permission.js`)
5. **Documentation:** Update relevant docs after completion

### For Bug Fixes

1. **Schema reference:** Check `database/SCHEMA.md` for column types & constraints
2. **Relationships:** Check `database/ERD.md` for FK dependencies
3. **Historical issues:** Check `database/MIGRATIONS.md` known issues section
4. **Code patterns:** Review `SESSION_PROGRESS.md` for recent changes

---

## 📊 Database Overview

### Statistics (30 Aug 2026)

| Metric | Count |
|--------|-------|
| Total Tables | 28 |
| Business Rental Tables | 14 |
| SaaS Platform Tables | 11 |
| Utility Tables | 3 |
| Enum Types | 9 |
| Foreign Keys | 12 |
| RLS Policies | ~30 |
| Migration Phases | 9 |

### Table Groups

**Business Rental (14):**
- Core: `inventory`, `transactions`, `members`
- Normalized: `transaction_items`, `transaction_payments`, `inventory_units`
- Supporting: `member_types`, `promo_codes`, `settings`
- Logs: `activity_logs`, `login_logs`, `admin_logs`
- Auth: `profiles`, `versi_akun`

**SaaS Platform (11):**
- Subscription: `sewara_plans`, `sewara_plan_features`, `sewara_subscriptions`
- Payment: `sewara_subscription_payments`, `sewara_subscription_events`, `sewara_payment_methods`
- Usage: `sewara_usage_counters`, `sewara_feature_overrides`
- Permission: `permissions`, `role_permissions`, `staff_permissions`

**Utility (3):**
- Config: `app_config`
- Counters: `log_count`, `mt_count`

---

## 🔍 Search Tips

### Finding Information

**"Tabel X punya kolom apa saja?"**
→ `database/SCHEMA.md` → Search "### X" → Read column table

**"Tabel X relate ke tabel mana?"**
→ `database/ERD.md` → Search "X" → Check Mermaid diagram

**"Kapan kolom Y ditambahkan?"**
→ `database/MIGRATIONS.md` → Search "Y" → Read phase description

**"Apa itu enum_status_transaksi?"**
→ `database/SCHEMA.md` → Section "Enum Types" → Find enum definition

**"Gimana cara check permission?"**
→ `database/SCHEMA.md` → Search "permission" → Read permission tables
→ Or check `src/lib/permission.js` for implementation

**"Apa yang harus dilakukan sebelum migration?"**
→ `database/MIGRATIONS.md` → Section "Migration Best Practices"

---

## 🛠️ Maintenance

### Updating Documentation

**When to update:**
- ✅ After setiap migration (update MIGRATIONS.md)
- ✅ Setelah schema changes (update SCHEMA.md & ERD.md)
- ✅ New features completed (update relevant docs)
- ✅ Bug fixes yang affect schema (update MIGRATIONS.md known issues)

**How to update:**
1. Edit relevant `.md` file
2. Update "Last Updated" date
3. Commit with descriptive message: `docs: update SCHEMA.md - add column X to table Y`
4. Keep docs in sync with code

### Documentation Quality Checklist

- [ ] Dates are current
- [ ] Examples are accurate (tested)
- [ ] SQL queries are executable
- [ ] Links between docs work
- [ ] Terminology consistent
- [ ] No outdated information

---

## 🔗 External Resources

**Supabase Dashboard:**
- URL: https://supabase.com/dashboard/project/obhvrzholszhjnpvmnna
- SQL Editor: `/sql/new`
- Database: `/database/tables`
- RLS Policies: `/auth/policies`

**Production:**
- Main: https://app.sewara.my.id
- Vercel: https://app-sewara-5p65j42a5-rizki12.vercel.app

**Repository:**
- GitHub: https://github.com/Rzp1010/sewara-apps

---

## 📝 Contributing

### Adding New Documentation

**For new features:**
1. Create `docs/features/FEATURE_NAME.md`
2. Include: overview, technical specs, schema changes, API endpoints
3. Update this `README.md` with link

**For API documentation:**
1. Create `docs/api/ENDPOINT_NAME.md`
2. Include: method, parameters, response, examples
3. Update this `README.md` with link

**For database changes:**
1. Always update `database/MIGRATIONS.md` first (record change)
2. Update `database/SCHEMA.md` (reflect current state)
3. Update `database/ERD.md` if relationships changed

---

## 🎯 Documentation Goals

**Current State (30 Aug 2026):** ✅ Foundation complete
- Database fully documented (28 tables)
- Migration history complete (Phase 1-9)
- ERD diagrams available

**Next Steps:**
- [ ] API endpoint documentation (saat implement payment gateway)
- [ ] Feature documentation (saat implement fitur baru)
- [ ] Deployment guide
- [ ] Troubleshooting guide
- [ ] User guide (for non-technical)

---

## 💡 Tips

**For Developers:**
- Bookmark `docs/database/SCHEMA.md` — paling sering dipakai
- Keep `database/ERD.md` open saat coding (visual reference)
- Read `MIGRATIONS.md` untuk understand "why" behind decisions

**For Team Lead:**
- Review `SESSION_PROGRESS.md` untuk current status
- Check `FUTURE_UPDATES.md` untuk planning
- Use `database/MIGRATIONS.md` untuk risk assessment

**For Tester:**
- Read `database/SCHEMA.md` → Section specific tabel untuk understand data structure
- Check `FUTURE_UPDATES.md` untuk fitur yang akan di-test
- Review `SESSION_PROGRESS.md` → Known Issues sebelum test

---

## ❓ Need Help?

**Can't find what you need?**
1. Use file search (Ctrl+Shift+F in VS Code)
2. Check `SESSION_PROGRESS.md` → "Next Safe Step"
3. Review Git commit history for recent changes
4. Ask team lead atau developer

**Documentation unclear?**
1. Open issue atau discussion
2. Propose documentation improvement
3. Submit PR with fixes

---

**Documentation maintained by:** Development Team  
**Last major update:** 30 August 2026 (Phase 9 completion)  
**Next review:** After tester audit (September 2026)
