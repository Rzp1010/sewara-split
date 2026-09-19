"use client";

import { VERSI_APLIKASI } from "@/lib/version";
import { getSetting, setSetting } from "@/lib/db";
import { getFITUR } from "@/lib/features";
const LABEL_TAB = {
  tampilan: "Tampilan",
  profil: "Profil",
  invoice: "Invoice",
  notifikasi: "Notifikasi",
  aturan: "Aturan Sewa",
  laporan: "Laporan & Pendapatan",
  pengembangan: "Pengembangan",
  info: "Info Aplikasi",
};

import { ROLE_OWNER, ROLE_CS, ROLE_GUDANG } from "@/lib/role";

export default function SettingsModal({
  open,
  onClose,
  userRole,
  theme,
  setTheme,
  tabSetting,
  setTabSetting,
  autoLogoutMin,
  setAutoLogoutMin,
  profilSubscribed,
  kini,
  profilUsername,
  setProfilUsername,
  profilNama,
  setProfilNama,
  profilLocks,
  setProfilLocks,
  simpanProfil,
  kosongkanSemua,
  invPrefix,
  setInvPrefix,
  invDigit,
  setInvDigit,
  invMulai,
  setInvMulai,
  invFooter,
  setInvFooter,
  notifJam,
  setNotifJam,
  aturanAmbilCepat,
  setAturanAmbilCepat,
  aturanAmbilTelat,
  setAturanAmbilTelat,
  aturanDp,
  setAturanDp,
  gabungStatus,
  setGabungStatus,
  jamMode,
  setJamMode,
  jamBuka,
  setJamBuka,
  jamTutup,
  setJamTutup,
  basisPendapatan,
  setBasisPendapatan,
  dendaAktif,
  setDendaAktif,
  dendaDispensasi,
  setDendaDispensasi,
}) {
  if (!open) return null;
  return (
    <div
      onClick={() => onClose()}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[85vh] max-h-[90vh] w-full max-w-4xl mx-4 flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h3
            id="settings-modal-title"
            className="text-lg font-semibold text-gray-900"
          >
            Pengaturan
          </h3>
          <button
            type="button"
            onClick={() => onClose()}
            aria-label="Tutup pengaturan"
            className="rounded-lg border-0 bg-transparent text-xl leading-none text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-56 shrink-0 overflow-y-auto border-r border-gray-100 p-4">
            <div className="space-y-1">
              {[
                ...(userRole === ROLE_CS || userRole === ROLE_GUDANG
                  ? [
                      { key: "tampilan", label: "Tampilan" },
                      { key: "info", label: "Info Aplikasi" },
                    ]
                  : [
                      { key: "tampilan", label: "Tampilan" },
                      ...(userRole === ROLE_OWNER
                        ? [{ key: "profil", label: "Profil" }]
                        : []),
                      { key: "invoice", label: "Invoice" },
                      { key: "notifikasi", label: "Notifikasi" },
                      { key: "aturan", label: "Aturan Sewa" },
                      { key: "laporan", label: "Laporan & Pendapatan" },
                      ...(userRole === ROLE_OWNER
                        ? [{ key: "pengembangan", label: "Pengembangan" }]
                        : []),
                      { key: "info", label: "Info Aplikasi" },
                    ]),
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setTabSetting(tab.key)}
                  className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium ${tabSetting === tab.key ? "bg-[#7181E0]/10 text-[#7181E0] font-semibold" : "text-gray-600 hover:bg-gray-100"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h4 className="text-base font-semibold text-gray-900 mb-4">
                {LABEL_TAB[tabSetting] || tabSetting}
              </h4>
            </div>
            {(userRole === ROLE_CS || userRole === ROLE_GUDANG) &&
              tabSetting !== "tampilan" &&
              tabSetting !== "info" && (
                <div className="space-y-5">
                  Tab ini tidak tersedia untuk role Anda.
                </div>
              )}
            {tabSetting === "tampilan" && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Tema</p>
                  <div className="space-y-5">
                    {[
                      { value: "light", label: "Terang" },
                      { value: "dark", label: "Gelap" },
                      { value: "system", label: "Sistem" },
                    ].map((o) => (
                      <button
                        key={o.value}
                        onClick={() => setTheme(o.value)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${theme === o.value ? "bg-[#7181E0] text-white" : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Board Status Sewa
                  </p>
                  <div className="space-y-5">
                    <button
                      onClick={() => {
                        setSetting("board_mode", "stack");
                        window.dispatchEvent(new CustomEvent("settingChanged"));
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium ${getSetting("board_mode", "scroll") === "stack" ? "bg-[#7181E0] text-white" : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                    >
                      Tumpuk
                    </button>
                    <button
                      onClick={() => {
                        setSetting("board_mode", "scroll");
                        window.dispatchEvent(new CustomEvent("settingChanged"));
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium ${getSetting("board_mode", "scroll") === "scroll" ? "bg-[#7181E0] text-white" : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                    >
                      Geser
                    </button>
                  </div>
                </div>
                {userRole === ROLE_OWNER && (
                  <div className="space-y-5">
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Logout Otomatis
                    </p>
                    <div className="space-y-5">
                      <label className="space-y-5">
                        Waktu Tanpa Aktivitas (menit)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={autoLogoutMin}
                        onChange={(e) => {
                          setAutoLogoutMin(parseInt(e.target.value, 10) || 0);
                          setSetting(
                            "auto_logout_minutes",
                            e.target.value || "0",
                          );
                        }}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                      />
                    </div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Logout otomatis setelah pengguna tidak aktif selama menit
                      ini. Berlaku untuk SEMUA akun di bisnis Anda (owner +
                      staf). 0 = nonaktif (tidak logout otomatis).
                    </p>
                  </div>
                )}
              </div>
            )}
            {tabSetting === "profil" && userRole === ROLE_OWNER && (
              <div className="space-y-5">
                <div className="space-y-5">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Langganan
                  </p>
                  {profilSubscribed ? (
                    new Date(profilSubscribed).getTime() > kini ? (
                      <span className="space-y-5">
                        Langganan aktif sampai{" "}
                        {new Date(profilSubscribed).toLocaleDateString(
                          "id-ID",
                          {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          },
                        )}
                      </span>
                    ) : (
                      <span className="space-y-5">Langganan berakhir</span>
                    )
                  ) : (
                    <span className="space-y-5">Tanpa batas</span>
                  )}
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Masa aktif langganan bisnis Anda. Hubungi admin untuk
                    perpanjang.
                  </p>
                </div>
                <div className="space-y-5">
                  <label className="space-y-5">Username</label>
                  <div className="space-y-5">
                    <input
                      value={profilUsername}
                      onChange={(e) => setProfilUsername(e.target.value)}
                      disabled={profilLocks.username}
                      placeholder="nama tampil di aplikasi"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                    {profilLocks.username && (
                      <button
                        type="button"
                        onClick={() =>
                          setProfilLocks((l) => ({ ...l, username: false }))
                        }
                        className="space-y-5"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Ditampilkan di navbar &amp; dropdown profil.
                  </p>
                </div>
                <div className="space-y-5">
                  <label className="space-y-5">Nama</label>
                  <div className="space-y-5">
                    <input
                      value={profilNama}
                      onChange={(e) => setProfilNama(e.target.value)}
                      disabled={profilLocks.nama}
                      placeholder="nama tampil di aplikasi & nota"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                    {profilLocks.nama && (
                      <button
                        type="button"
                        onClick={() =>
                          setProfilLocks((l) => ({ ...l, nama: false }))
                        }
                        className="space-y-5"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Nama ini juga akan tertulis di invoice &amp; riwayat
                    pelayan.
                  </p>
                </div>
                <button
                  onClick={simpanProfil}
                  className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
                >
                  Simpan Profil
                </button>
              </div>
            )}
            {tabSetting === "invoice" && (
              <div className="space-y-5">
                <div className="space-y-5">
                  <label className="space-y-5">Awalan Nomor Invoice</label>
                  <input
                    value={invPrefix}
                    onChange={(e) => {
                      setInvPrefix(e.target.value);
                      setSetting("invoice_prefix", e.target.value || "INV");
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    placeholder="INV"
                  />
                </div>
                <div className="space-y-5">
                  <div className="space-y-5">
                    <label className="space-y-5">Jumlah Digit</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={invDigit}
                      onChange={(e) => {
                        const v = e.target.value || "6";
                        setInvDigit(v);
                        setSetting("invoice_digit", v);
                      }}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                  </div>
                  <div className="space-y-5">
                    <label className="space-y-5">Mulai Dari Nomor</label>
                    <input
                      type="number"
                      min={1}
                      value={invMulai}
                      onChange={(e) => {
                        const v = e.target.value || "1";
                        setInvMulai(v);
                        setSetting("invoice_mulai", v);
                        setSetting("invoice_counter", String(parseInt(v) - 1));
                      }}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Contoh: <strong>{invPrefix || "INV"}</strong>-
                  {String(invMulai || 1).padStart(parseInt(invDigit) || 6, "0")}
                </p>
                <div className="space-y-5">
                  <label className="space-y-5">
                    Teks Terima Kasih (Footer Invoice)
                  </label>
                  <textarea
                    value={invFooter}
                    onChange={(e) => {
                      setInvFooter(e.target.value);
                      setSetting("invoice_footer", e.target.value);
                    }}
                    rows={3}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    placeholder="Terima kasih. Harap kembalikan barang lengkap sesuai Nomor Seri..."
                  />
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Teks ini tampil di bagian bawah invoice. Kosongkan utk
                    memakai teks bawaan.
                  </p>
                </div>
              </div>
            )}
            {tabSetting === "notifikasi" && (
              <div className="space-y-5">
                <label className="space-y-5">
                  Peringatan Mendekati Kembali (Jam)
                </label>
                <input
                  type="number"
                  min={1}
                  value={notifJam}
                  onChange={(e) => {
                    setNotifJam(e.target.value);
                    setSetting("notif_jam", e.target.value || "2");
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                />
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Transaksi dengan sisa waktu ≤ {notifJam || "2"} jam akan masuk
                  board <strong>Mendekati</strong>
                </p>
              </div>
            )}
            {tabSetting === "aturan" && (
              <div className="space-y-5">
                <div className="space-y-5">
                  <label className="space-y-5">Jika Ambil SEBELUM Jadwal</label>
                  <select
                    value={aturanAmbilCepat}
                    onChange={(e) => {
                      setAturanAmbilCepat(e.target.value);
                      setSetting("aturan_ambil_cepat", e.target.value);
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                  >
                    <option value="rencana">
                      Ikuti Jadwal (hitung dari jadwal awal)
                    </option>
                    <option value="aktual">
                      Ikuti Aktual (hitung dari waktu ambil sebenarnya)
                    </option>
                  </select>
                </div>
                <div className="space-y-5">
                  <label className="space-y-5">Jika Ambil SETELAH Jadwal</label>
                  <select
                    value={aturanAmbilTelat}
                    onChange={(e) => {
                      setAturanAmbilTelat(e.target.value);
                      setSetting("aturan_ambil_telat", e.target.value);
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                  >
                    <option value="rencana">
                      Ikuti Jadwal (hitung dari jadwal awal)
                    </option>
                    <option value="aktual">
                      Ikuti Aktual (hitung dari waktu ambil sebenarnya)
                    </option>
                  </select>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Mempengaruhi hitung biaya saat Serahkan / Terima Kembali di
                    board Status Sewa
                  </p>
                </div>
                <div className="space-y-5">
                  <label className="space-y-5">Aturan DP (Uang Muka)</label>
                  <select
                    value={aturanDp}
                    onChange={(e) => {
                      setAturanDp(e.target.value);
                      setSetting("aturan_dp", e.target.value);
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                  >
                    <option value="bebas">Bebas</option>
                    <option value="wajib">Wajib DP</option>
                  </select>
                  {aturanDp === "bebas" ? (
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Booking boleh dibuat tanpa DP. Transaksi tanpa DP akan
                      ditandai ⚠️ <strong>Belum DP</strong> (belum terkunci) —
                      bisa diambil penyewa lain yang DP lebih cepat. Pembayaran
                      bisa dicatat kapan saja.
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Form booking akan mewajibkan isi DP sebelum transaksi bisa
                      disimpan. Tanpa DP, bookingan tidak bisa dibuat.
                    </p>
                  )}
                </div>
                <div className="space-y-5">
                  <label className="space-y-5">
                    Gabung Booking Identitas Sama
                  </label>
                  <select
                    value={gabungStatus}
                    onChange={(e) => {
                      setGabungStatus(e.target.value);
                      setSetting("gabung_status", e.target.value);
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                  >
                    <option value="booking">
                      Hanya status Booking (belum diambil)
                    </option>
                    <option value="booking_disewa">
                      Booking & Disewa (sudah diambil)
                    </option>
                  </select>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Saat membuat booking baru dengan{" "}
                    <strong>identitas penyewa sama persis</strong> (nama, HP,
                    alamat, jaminan) dan <strong>periode sama persis</strong>{" "}
                    dengan booking aktif, akan muncul tawaran untuk
                    menggabungkan item ke booking tersebut atau memisahkannya.
                  </p>
                </div>
                {getFITUR().dendaFleksibel && (
                  <div className="space-y-5">
                    <label className="space-y-5">Denda Keterlambatan</label>
                    <div className="space-y-5">
                      <button
                        onClick={() => {
                          setDendaAktif("1");
                          setSetting("denda_aktif", "1");
                        }}
                        className="rounded-lg border border-gray-200 bg-transparent px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Aktif
                      </button>
                      <button
                        onClick={() => {
                          setDendaAktif("0");
                          setSetting("denda_aktif", "0");
                        }}
                        className="rounded-lg border border-gray-200 bg-transparent px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Mati
                      </button>
                    </div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      {dendaAktif === "1"
                        ? "Transaksi telat tetap dihitung denda otomatis, admin bisa memilih tanpa denda saat Terima Kembali."
                        : "Transaksi telat diproses tanpa peringatan denda sama sekali."}
                    </p>
                    <div className="space-y-5">
                      <label className="space-y-5">
                        Dispensasi Terlambat Bebas Denda (menit)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={dendaDispensasi}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDendaDispensasi(v);
                          setSetting("denda_dispensasi_menit", v);
                        }}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                      />
                      <p className="text-sm font-medium text-gray-700 mb-2">
                        Keterlambatan di bawah angka ini tidak dikenakan denda.
                        Denda dihitung setelah melewati dispensasi.
                      </p>
                    </div>
                  </div>
                )}
                <div className="space-y-5">
                  <label className="space-y-5">
                    Jam Operasional (Waktu Ambil)
                  </label>
                  <select
                    value={jamMode}
                    onChange={(e) => {
                      setJamMode(e.target.value);
                      setSetting("jam_mode", e.target.value);
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                  >
                    <option value="buka_tutup">Mengikuti Jam Buka-Tutup</option>
                    <option value="fleksibel">Fleksibel (bebas 24 jam)</option>
                  </select>
                  {jamMode === "buka_tutup" ? (
                    <>
                      <div className="space-y-5">
                        <div className="space-y-5">
                          <label className="space-y-5">Jam Buka</label>
                          <input
                            type="time"
                            value={
                              jamBuka !== "" && jamBuka != null
                                ? `${String(jamBuka).padStart(2, "0")}:00`
                                : ""
                            }
                            onChange={(e) => {
                              const v = e.target.value
                                ? parseInt(e.target.value.split(":")[0], 10)
                                : "";
                              setJamBuka(v);
                              setSetting("jam_buka", v);
                            }}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                          />
                        </div>
                        <div className="space-y-5">
                          <label className="space-y-5">Jam Tutup</label>
                          <input
                            type="time"
                            value={
                              jamTutup !== "" && jamTutup != null
                                ? `${String(jamTutup).padStart(2, "0")}:00`
                                : ""
                            }
                            onChange={(e) => {
                              const v = e.target.value
                                ? parseInt(e.target.value.split(":")[0], 10)
                                : "";
                              setJamTutup(v);
                              setSetting("jam_tutup", v);
                            }}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                          />
                        </div>
                      </div>
                      <p className="text-sm font-medium text-gray-700 mb-2">
                        Di form booking, waktu ambil di luar rentang jam{" "}
                        {jamBuka || "6"}:00 s/d {jamTutup || "22"}:00 tidak bisa
                        dipilih. Waktu kembali tetap bebas.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Waktu ambil bisa dipilih kapan saja (24 jam) di form
                      booking.
                    </p>
                  )}
                </div>
              </div>
            )}
            {tabSetting === "laporan" && (
              <div className="space-y-5">
                <div className="space-y-5">
                  <label className="space-y-5">Basis Pendapatan</label>
                  <select
                    value={basisPendapatan}
                    onChange={(e) => {
                      setBasisPendapatan(e.target.value);
                      setSetting("basis_pendapatan", e.target.value);
                      window.dispatchEvent(new CustomEvent("settingChanged"));
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                  >
                    <option value="selesai">Hanya Selesai</option>
                    <option value="aktif">Selesai + Sedang Disewa</option>
                    <option value="semua">Semua (termasuk Booking)</option>
                  </select>
                  {basisPendapatan === "selesai" ? (
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Hanya transaksi yang sudah <strong>Selesai</strong> yang
                      dihitung di Dashboard & kartu rekap Laporan. Total Akhir
                      sudah termasuk denda keterlambatan.
                    </p>
                  ) : basisPendapatan === "aktif" ? (
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Transaksi <strong>Selesai</strong> ditambah yang sedang{" "}
                      <strong>Disewa</strong> (dihitung dari total_akhir saat
                      Serahkan, belum termasuk denda). Booking yang belum
                      diserahkan tidak dihitung.
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Semua transaksi dihitung, termasuk estimasi{" "}
                      <strong>Booking</strong> yang belum diserahkan. Transaksi{" "}
                      <strong>Dibatalkan</strong> selalu dikecualikan.
                    </p>
                  )}
                </div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Mempengaruhi kartu <strong>Total Pendapatan</strong> di
                  Dashboard dan kartu rekap di Laporan Keuangan. Tabel detail &
                  export di Laporan tetap menampilkan transaksi Selesai saja.
                </p>
              </div>
            )}
            {tabSetting === "pengembangan" && userRole === ROLE_OWNER && (
              <div className="space-y-5">
                <div className="space-y-5">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    ⚠️ Zona Pengembangan
                  </p>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Khusus saat developing. Fitur ini akan dihapus di versi
                    final.
                  </p>
                </div>
                <div className="space-y-5">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    ≡ƒùæ∩╕Å Kosongkan Semua Data
                  </p>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Menghapus PERMANEN: semua item & S/N inventaris, semua
                    transaksi/booking/riwayat, dan semua log S/N. Nomor invoice
                    juga di-reset.
                    <strong className="space-y-5">
                      {" "}
                      Data yang dihapus TIDAK BISA DIKEMBALIKAN.
                    </strong>
                  </p>
                  <button
                    onClick={kosongkanSemua}
                    className="rounded-lg border-0 bg-[#F04438] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d03a2f]"
                  >
                    ≡ƒùæ∩╕Å Kosongkan Semua Data
                  </button>
                </div>
              </div>
            )}
            {tabSetting === "info" && (
              <div className="space-y-5">
                <div className="space-y-5">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    {VERSI_APLIKASI.nama} — {VERSI_APLIKASI.versi}
                  </p>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Lingkungan:{" "}
                    <strong>
                      {process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(
                        "srgmeoipuybrkhsxmtsf",
                      )
                        ? "Tester (Uji)"
                        : "Pribadi (Produksi)"}
                    </strong>
                  </p>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Tanggal rilis: {VERSI_APLIKASI.tanggal}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Riwayat Versi
                  </p>
                  <div className="space-y-5">
                    {VERSI_APLIKASI.riwayat.map((r) => (
                      <div key={r.versi} className="space-y-5">
                        <div className="space-y-5">
                          <p className="text-sm font-medium text-gray-700 mb-2">
                            {r.versi}
                          </p>
                          <span className="space-y-5">{r.tanggal}</span>
                        </div>
                        <ul className="space-y-5">
                          {r.perubahan.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
