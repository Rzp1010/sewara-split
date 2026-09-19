-- Phase 2C-2 atomic transaction persistence.
-- Actual schema: transactions has legacy JSONB items/pembayaran plus diskon/member_id;
-- normalized children use assigned_components (not assignedSNs), and payment_method values are Tunai/Transfer/QRIS.
-- transactions.id is GENERATED ALWAYS AS IDENTITY: insert intentionally omits client id.
-- Client audit/ownership fields are never accepted. SECURITY INVOKER keeps RLS effective.
BEGIN;
DROP FUNCTION IF EXISTS public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean);
CREATE FUNCTION public.rpc_save_transaction(p_transaction jsonb,p_items jsonb DEFAULT '[]'::jsonb,p_payments jsonb DEFAULT '[]'::jsonb,p_replace_items boolean DEFAULT false,p_replace_payments boolean DEFAULT false)
RETURNS public.transactions LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
 v_uid uuid:=auth.uid(); v_owner uuid; v_parent public.transactions; v_item jsonb; v_payment jsonb;
 v_id bigint; v_member bigint; v_inventory bigint; v_qty integer; v_price numeric; v_subtotal numeric; v_amount numeric; v_method enum_metode_bayar; v_status enum_status_transaksi;
 v_denda numeric; v_biaya numeric; v_total numeric; v_ta timestamptz; v_tk timestamptz; v_aa timestamptz; v_ak timestamptz; v_pd timestamptz;
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
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid parent numeric, id, member_id, or timestamp JSON value' USING ERRCODE='22023'; END;
 IF v_denda<0 OR v_biaya<0 OR v_total<0 THEN RAISE EXCEPTION 'Parent denda, biaya, and total_akhir must be >= 0' USING ERRCODE='22023'; END IF;
 v_status=COALESCE((p_transaction->>'status')::enum_status_transaksi,'Booking'::enum_status_transaksi);
 IF v_status NOT IN ('Booking','Disewa','Selesai','Belum Selesai','Dibatalkan') THEN RAISE EXCEPTION 'Invalid transaction status' USING ERRCODE='22023'; END IF;
 IF v_member IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members WHERE id=v_member AND user_id=v_owner) THEN RAISE EXCEPTION 'Member does not belong to tenant' USING ERRCODE='42501'; END IF;
 IF v_id IS NULL THEN
  INSERT INTO transactions(id_transaksi,penyewa,hp_penyewa,alamat_penyewa,jaminan_sewa,waktu_ambil_rencana,waktu_kembali_rencana,waktu_ambil_aktual,waktu_kembali_aktual,status,items,denda,biaya,durasi_teks,total_akhir,pembayaran,diskon,member_id,user_id)
  VALUES(p_transaction->>'id_transaksi',p_transaction->>'penyewa',p_transaction->>'hp_penyewa',p_transaction->>'alamat_penyewa',p_transaction->>'jaminan_sewa',v_ta,v_tk,v_aa,v_ak,v_status,COALESCE(p_transaction->'items','[]'::jsonb),v_denda,v_biaya,p_transaction->>'durasi_teks',v_total,p_transaction->'pembayaran',p_transaction->'diskon',v_member,v_owner) RETURNING * INTO v_parent;
 ELSE
  SELECT * INTO v_parent FROM transactions WHERE id=v_id AND user_id=v_owner FOR UPDATE;
  IF NOT FOUND THEN IF EXISTS (SELECT 1 FROM transactions WHERE id=v_id) THEN RAISE EXCEPTION 'Transaction belongs to another tenant' USING ERRCODE='42501'; ELSE RAISE EXCEPTION 'Transaction not found' USING ERRCODE='42501'; END IF; END IF;
  UPDATE transactions SET id_transaksi=COALESCE(p_transaction->>'id_transaksi',id_transaksi),penyewa=COALESCE(p_transaction->>'penyewa',penyewa),hp_penyewa=COALESCE(p_transaction->>'hp_penyewa',hp_penyewa),alamat_penyewa=COALESCE(p_transaction->>'alamat_penyewa',alamat_penyewa),jaminan_sewa=COALESCE(p_transaction->>'jaminan_sewa',jaminan_sewa),waktu_ambil_rencana=COALESCE(v_ta,waktu_ambil_rencana),waktu_kembali_rencana=COALESCE(v_tk,waktu_kembali_rencana),waktu_ambil_aktual=COALESCE(v_aa,waktu_ambil_aktual),waktu_kembali_aktual=COALESCE(v_ak,waktu_kembali_aktual),status=COALESCE((p_transaction->>'status')::enum_status_transaksi,status),items=COALESCE(p_transaction->'items',items),denda=CASE WHEN p_transaction ? 'denda' THEN v_denda ELSE denda END,biaya=CASE WHEN p_transaction ? 'biaya' THEN v_biaya ELSE biaya END,durasi_teks=COALESCE(p_transaction->>'durasi_teks',durasi_teks),total_akhir=CASE WHEN p_transaction ? 'total_akhir' THEN v_total ELSE total_akhir END,pembayaran=COALESCE(p_transaction->'pembayaran',pembayaran),diskon=COALESCE(p_transaction->'diskon',diskon),member_id=CASE WHEN p_transaction ? 'member_id' THEN v_member ELSE member_id END,updated_at=now() WHERE id=v_id AND user_id=v_owner RETURNING * INTO v_parent;
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
EXCEPTION WHEN foreign_key_violation THEN RAISE EXCEPTION 'Referenced record violates tenant/schema constraint' USING ERRCODE='23503'; WHEN check_violation THEN RAISE EXCEPTION 'Transaction data violates table constraint' USING ERRCODE='23514';
END; $$;
REVOKE ALL ON FUNCTION public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean) TO authenticated;
COMMENT ON FUNCTION public.rpc_save_transaction(jsonb,jsonb,jsonb,boolean,boolean) IS 'Atomic tenant-scoped save with explicit ownership and validated whitelisted fields.';
COMMIT;
