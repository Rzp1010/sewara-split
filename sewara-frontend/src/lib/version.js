export const VERSI_APLIKASI = {
  nama: "Sewara",
  versi: "alfa v0.1.5",
  tanggal: "2026-08-06",
  draft_changes: [],
  riwayat: [
    {
      versi: "alfa v0.1.5",
      tanggal: "2026-08-06",
      perubahan: [
        "Perbaikan: Penyimpanan inventaris tidak lagi berisiko menimpa data saat dua perangkat mengedit bersamaan",
        "Perbaikan: Akun tanpa profil tidak lagi mendapat menu pemilik & dashboard tidak loading selamanya",
        "Perbaikan: Staf tidak bisa mengubah role/status akunnya sendiri (pengamanan akses)",
      ],
    },
    {
      versi: "alfa v0.1.4",
      tanggal: "2026-08-06",
      perubahan: [
        "Fitur baru: Tampilan invoice baru yang lebih sederhana & rapi, lengkap dengan tombol Cetak, Download PDF, dan Tutup",
        "Fitur baru: Menu Pengaturan kini tersedia untuk staf CS/Gudang (tema & tampilan per user)",
        "Perbaikan: Membuka invoice tidak lagi langsung mencetak, hasil cetak & PDF lebih bersih tanpa header/footer browser",
        "Perbaikan: Penyimpanan data tidak lagi berisiko menimpa data lain (bug kritis data hilang)",
        "Perbaikan: Mencegah booking ganda saat dua device menyimpan bersamaan (bug kritis)",
      ],
    },
    {
      versi: "alfa v0.1.3",
      tanggal: "2026-08-05",
      perubahan: [
        "Fitur baru: Multi-user — tiap Owner punya bisnis & data sendiri, serta dapat membuat staf CS/Gudang yang bekerja di data bisnis yang sama",
        "Fitur baru: Halaman Manajemen Karyawan (khusus Owner) — kelola staf CS & Gudang: tambah, edit nama/password, aktif/nonaktifkan, hapus",
        "Peningkatan: Info akun di pojok kanan atas menampilkan nama lengkap pengguna",
        "Peningkatan: Dropdown pilihan barang kini membuka ke atas otomatis saat ruang di bawah layar tidak cukup, dan menyesuaikan tinggi dengan sisa layar",
        "Perbaikan: Filter rentang tanggal di Status Sewa tidak lagi menyembunyikan booking masa depan (board aktif selalu tampil penuh)",
        "Perbaikan: Tombol 'Sekarang' di Booking tidak lagi lompat 2 jam saat menit 56-59",
        "Perbaikan: Denda keterlambatan pada versi lama kini menghormati pengaturan aktif/mati & menit dispensasi (konsisten dengan versi baru)",
        "Perbaikan: S/N bundling tidak lagi terpakai ganda dalam satu booking",
        "Perbaikan: Pencatatan pembayaran memblokir pembayaran berlebih tanpa konfirmasi & menolak pembayaran untuk transaksi yang sudah lunas",
      ],
    },
    {
      versi: "alfa v0.1.2",
      tanggal: "2026-08-03",
      perubahan: [
        "Peningkatan: Perapian tulisan dan ikon di seluruh menu & halaman",
        "Fitur baru: Denda keterlambatan fleksibel, dapat diaktifkan atau dinonaktifkan di pengaturan, dispensasi menit, dan opsi tanpa denda saat telat",
        "Fitur baru: Semua pengaturan tersimpan & tersinkron per user (multi-device); nomor invoice dihitung atomik di database — tidak reset/duplikat saat ganti device",
        "Fitur baru: Invoice custom (identitas usaha, logo, warna aksen, 3 preset, toggle & blok kustom). Catatan: fitur ini belum optimal",
      ],
    },
    {
      versi: "alfa v0.1.1",
      tanggal: "2026-08-02",
      perubahan: [
        "Fitur baru: Tag Kategori di Katalog & Inventaris — produk dikelompokkan per tag, kolom tag di import/export CSV",
        "Peningkatan: dropdown pilihan barang saat Booking dikelompokkan per jenis + tag kategori",
        "Peningkatan: pencarian barang juga bisa mencocokkan Tag Kategori",
        "Perbaikan: urutan hasil pencarian barang kini menempatkan yang huruf awalnya cocok di paling atas (A-Z)",
        "Perbaikan: produk tidak lagi tampak Habis saat sudah di-booking untuk periode lain",
        "Perbaikan: ubah status sewa (ambil/kembali/bayar) kini tercatat di Log S/N",
        "Perbaikan: keranjang booking otomatis kosong setelah eksekusi",
        "Perbaikan: booking baru langsung muncul di Status Sewa untuk rentang selain Semua",
      ],
    },
  ],
};
