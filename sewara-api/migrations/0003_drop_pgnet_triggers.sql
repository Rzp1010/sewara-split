-- 0003_drop_pgnet_triggers.sql
-- Menghapus trigger notifikasi yang bergantung pada pg_net.
--
-- Temuan: dua trigger menembak HTTP dari dalam database lewat net.http_post()
-- (ekstensi khusus Supabase, tidak ada di Postgres biasa):
--   trg_telegram_pendaftar  -> notify_telegram_pendaftar()   (profiles, AFTER INSERT)
--   trg_telegram_transaksi  -> notify_telegram_transaksi()   (transactions, AFTER INSERT/UPDATE)
--
-- Selain tidak portabel, keduanya menyimpan URL dan secret webhook langsung di
-- badan fungsi, dan URL-nya menunjuk deployment lama (app-sewara.vercel.app).
--
-- Keputusan: notifikasi keluar dari database. Di arsitektur baru, Go yang
-- mengirim notifikasi setelah transaksi commit, dengan URL dan secret dari
-- konfigurasi aplikasi. Karena itu fungsi dan triggernya dihapus, bukan
-- dipindahkan. Kalau nanti notifikasi tetap ingin lewat endpoint internal,
-- pemanggilnya Go, bukan trigger.

DROP TRIGGER IF EXISTS trg_telegram_pendaftar ON public.profiles;
DROP TRIGGER IF EXISTS trg_telegram_transaksi ON public.transactions;

DROP FUNCTION IF EXISTS public.notify_telegram_pendaftar();
DROP FUNCTION IF EXISTS public.notify_telegram_transaksi();
