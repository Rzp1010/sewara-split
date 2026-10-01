-- Migration 2026-09-30: Jaminan Sewa Multi-Select (per transaksi)
--
-- TUJUAN:
--   transactions.jaminan_sewa diubah dari TEXT skalar menjadi jsonb array string,
--   supaya bisa menampung MULTI jaminan per transaksi (mis. ["KTP","SIM","STNK"]).
--   Nilai lama (string tunggal) di-backfill menjadi array satu elemen ["lama"];
--   NULL -> NULL; string kosong -> '[]'. RPC rpc_save_transaction di-recreate
--   agar menulis/membaca kolom ini sebagai jsonb utuh (bukan teks).
--
-- POLA: mengikuti preseden 20260824131036_dynamic_documents.sql (string/object -> array).
--
-- ATURAN LEDGER (AGENTS.md "Aturan DB"): file ini mengakhiri dirinya dengan
--   INSERT INTO schema_migrations (filename) VALUES ('20260930_jaminan_multi.sql');
-- Jalankan UTUH di SQL Editor dev lalu produksi (tanpa supabase CLI).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Ubah tipe kolom text -> jsonb dengan transformasi nilai lama.
--    - NULL          -> NULL
--    - '' / spasi    -> '[]'::jsonb  (kosong dianggap tanpa jaminan)
--    - sudah '[' ... -> cast apa adanya (dev yang keburu test / re-run idempotent)
--    - string lama   -> jsonb_build_array(nilai)  => ["lama"]
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions ALTER COLUMN jaminan_sewa TYPE jsonb USING (
  CASE
    WHEN jaminan_sewa IS NULL THEN NULL
    WHEN trim(jaminan_sewa) = '' THEN '[]'::jsonb
    WHEN jaminan_sewa ~ '^\s*\[' THEN jaminan_sewa::jsonb
    ELSE jsonb_build_array(jaminan_sewa)
  END
);

-- 2) Default kolom: array kosong.
ALTER TABLE public.transactions ALTER COLUMN jaminan_sewa SET DEFAULT '[]'::jsonb;

-- 3) Constraint: jaminan_sewa harus NULL atau jsonb array.
--    DROP dulu supaya idempotent-safe (bisa dijalankan ulang).
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS jaminan_sewa_is_array;
ALTER TABLE public.transactions
  ADD CONSTRAINT jaminan_sewa_is_array
  CHECK (jaminan_sewa IS NULL OR jsonb_typeof(jaminan_sewa) = 'array');

-- ---------------------------------------------------------------------------
-- 4) Recreate RPC rpc_save_transaction — definisi identik dengan versi eksis
--    (sumber: 20260917_printilan.sql, tercermin di schema_prod_20260930.sql),
--    HANYA 2 perubahan pada jaminan_sewa:
--      - INSERT: p_transaction->>'jaminan_sewa'  ->  p_transaction->'jaminan_sewa'
--      - UPDATE: p_transaction->>'jaminan_sewa'  ->  p_transaction->'jaminan_sewa'
--    (operator '>>' melebur jsonb array jadi teks -> salah untuk kolom jsonb;
--     pakai '->' agar jsonb utuh. Key absen tetap menghasilkan NULL.)
--    Semua kolom/RPC lain baris-per-baris TIDAK diubah.
--
--    Catatan overload: signature lama = (jsonb,jsonb,jsonb,boolean,boolean).
--    DROP dengan argumen persis dulu, lalu CREATE, supaya tidak meninggalkan
--    overload usang saat dijalankan ulang.
--    RPC lain yang mereferensi jaminan_sewa: tidak ada (hasil grep hanya
--    rpc_save_transaction; dashboard/report tidak menyentuh kolom ini).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean);
CREATE FUNCTION public.rpc_save_transaction(p_transaction jsonb,p_items jsonb DEFAULT '[]'::jsonb,p_payments jsonb DEFAULT '[]'::jsonb,p_replace_items boolean DEFAULT false,p_replace_payments boolean DEFAULT false)
RETURNS public.transactions LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
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
    penyewa=COALESCE(p_transaction->>'penyewa',penyewa),hp_penyewa=COALESCE(p_transaction->>'hp_penyewa',hp_penyewa),alamat_penyewa=COALESCE(p_transaction->>'alamat_penyewa',alamat_penyewa),jaminan_sewa=COALESCE(p_transaction->'jaminan_sewa',jaminan_sewa),waktu_ambil_rencana=COALESCE(v_ta,waktu_ambil_rencana),waktu_kembali_rencana=COALESCE(v_tk,waktu_kembali_rencana),waktu_ambil_aktual=COALESCE(v_aa,waktu_ambil_aktual),waktu_kembali_aktual=COALESCE(v_ak,waktu_kembali_aktual),status=COALESCE((p_transaction->>'status')::enum_status_transaksi,status),items=CASE WHEN jsonb_typeof(p_transaction->'items')='array' THEN p_transaction->'items' ELSE items END,denda=CASE WHEN p_transaction ? 'denda' THEN v_denda ELSE denda END,biaya=CASE WHEN p_transaction ? 'biaya' THEN v_biaya ELSE biaya END,durasi_teks=COALESCE(p_transaction->>'durasi_teks',durasi_teks),total_akhir=CASE WHEN p_transaction ? 'total_akhir' THEN v_total ELSE total_akhir END,pembayaran=CASE WHEN jsonb_typeof(p_transaction->'pembayaran')='object' THEN p_transaction->'pembayaran' ELSE pembayaran END,diskon=CASE WHEN jsonb_typeof(p_transaction->'diskon')='object' THEN p_transaction->'diskon' ELSE diskon END,"riwayatDilayani"=CASE WHEN jsonb_typeof(p_transaction->'riwayatDilayani')='array' THEN p_transaction->'riwayatDilayani' ELSE "riwayatDilayani" END,dilayani_oleh=COALESCE(p_transaction->>'dilayani_oleh',dilayani_oleh),member_id=CASE WHEN p_transaction ? 'member_id' THEN v_member ELSE member_id END,dp_hangus=CASE WHEN p_transaction ? 'dp_hangus' THEN v_dp_hangus ELSE dp_hangus END,dp_hangus_aturan=COALESCE(p_transaction->>'dp_hangus_aturan',dp_hangus_aturan),printilan=CASE WHEN p_transaction ? 'printilan' THEN v_printilan ELSE printilan END,updated_at=now() WHERE id=v_id AND user_id=v_owner RETURNING * INTO v_parent;
  ELSE
    IF EXISTS (SELECT 1 FROM transactions WHERE id=v_id) THEN RAISE EXCEPTION 'Transaction belongs to another tenant' USING ERRCODE='42501'; END IF;
    INSERT INTO transactions(id,id_transaksi,no_invoice,penyewa,hp_penyewa,alamat_penyewa,jaminan_sewa,waktu_ambil_rencana,waktu_kembali_rencana,waktu_ambil_aktual,waktu_kembali_aktual,status,items,denda,biaya,durasi_teks,total_akhir,pembayaran,diskon,"riwayatDilayani",dilayani_oleh,member_id,dp_hangus,dp_hangus_aturan,printilan,user_id)
    VALUES(v_id,p_transaction->>'id_transaksi',v_invoice,p_transaction->>'penyewa',p_transaction->>'hp_penyewa',p_transaction->>'alamat_penyewa',p_transaction->'jaminan_sewa',v_ta,v_tk,v_aa,v_ak,v_status,CASE WHEN jsonb_typeof(p_transaction->'items')='array' THEN p_transaction->'items' ELSE '[]'::jsonb END,v_denda,v_biaya,p_transaction->>'durasi_teks',v_total,CASE WHEN jsonb_typeof(p_transaction->'pembayaran')='object' THEN p_transaction->'pembayaran' ELSE '{}'::jsonb END,CASE WHEN jsonb_typeof(p_transaction->'diskon')='object' THEN p_transaction->'diskon' ELSE '{}'::jsonb END,CASE WHEN jsonb_typeof(p_transaction->'riwayatDilayani')='array' THEN p_transaction->'riwayatDilayani' ELSE '[]'::jsonb END,p_transaction->>'dilayani_oleh',v_member,v_dp_hangus,p_transaction->>'dp_hangus_aturan',v_printilan,v_owner) RETURNING * INTO v_parent;
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
END; $$;
REVOKE ALL ON FUNCTION public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean) TO authenticated;
COMMENT ON FUNCTION public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean) IS 'Atomic tenant-scoped save; +dp_hangus, +dp_hangus_aturan (2026-09-16); +printilan (2026-09-17); jaminan_sewa jsonb array (2026-09-30).';

-- 5) Dokumentasi kolom.
COMMENT ON COLUMN public.transactions.jaminan_sewa IS 'Array jaminan per transaksi, mis ["KTP","SIM","STNK"]. jsonb array of string; NULL = tanpa jaminan.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Ledger: catat migration ini (WAJIB, di luar transaksi).
-- ---------------------------------------------------------------------------
INSERT INTO schema_migrations (filename) VALUES ('20260930_jaminan_multi.sql');

-- ---------------------------------------------------------------------------
-- VERIFIKASI MANUAL (jalankan setelah COMMIT; read-only):
--
--   -- Tidak boleh ada sisa nilai string/objek/number (harus 0):
--   SELECT jsonb_typeof(jaminan_sewa) AS tipe, count(*)
--   FROM public.transactions
--   GROUP BY 1;
--   -- ekspektasi: 'array' dan/atau NULL saja.
--
--   SELECT count(*) FROM public.transactions
--   WHERE jaminan_sewa IS NOT NULL
--     AND jsonb_typeof(jaminan_sewa) <> 'array';
--   -- ekspektasi: 0
--
--   -- RPC hanya 1 overload:
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.proname='rpc_save_transaction';
--   -- ekspektasi: 1
--
--   -- Ledger terisi:
--   SELECT filename, applied_at FROM schema_migrations
--   WHERE filename='20260930_jaminan_multi.sql';
-- ---------------------------------------------------------------------------