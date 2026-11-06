"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import DokumenJaminan from "@/components/DokumenJaminan";
import {
  getMemberTemplates,
  patchPelanggan,
  ubahBlacklist,
  uploadDokumenMember,
  uploadDokumenPelanggan,
  urlDokumenMember,
  urlDokumenPelanggan,
  upsertPelanggan,
} from "@/lib/db";
import { api } from "@/lib/api-client";

const FIELDS = [
  { key: "nama", label: "Nama" },
  { key: "hp", label: "No. HP" },
  { key: "email", label: "Email" },
  { key: "alamat", label: "Alamat" },
  { key: "catatan", label: "Catatan" },
];

/**
 * Detail orang read-only dengan pensil per field, pengaturan member
 * (tipe + diskon), dan dokumen jaminan (unggah/hapus).
 *
 * Tujuan simpan baris: pelanggan → PATCH /api/pelanggan/{id}; baris murni
 * member → PATCH /api/members/{id}; baris murni blacklist → PATCH blacklist.
 * Dokumen jaminan mengikuti pasangan member bila ada (tulis-tembus ke
 * members.foto_jaminan), selain itu ke pelanggan.foto.
 */
export default function DetailOrang({ orang, onClose, onTersimpan }) {
  const { notify } = useNotify();
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [foto, setFoto] = useState(() => orang?.foto || []);
  const [tipeList, setTipeList] = useState([]);
  // State form member di-key ke identitas baris: reset saat baris berganti
  // tanpa setState di dalam effect.
  const kunciBaris = `${orang?.id ?? ""}|${orang?.member_id ?? 0}|${orang?.sumber ?? ""}`;
  const [memberForm, setMemberForm] = useState(() => ({
    kunci: kunciBaris,
    tipeId: orang?.member?.tipe_id ? String(orang.member.tipe_id) : "",
    diskon: String(orang?.member?.diskon_persen ?? 0),
  }));
  if (memberForm.kunci !== kunciBaris)
    setMemberForm({
      kunci: kunciBaris,
      tipeId: orang?.member?.tipe_id ? String(orang.member.tipe_id) : "",
      diskon: String(orang?.member?.diskon_persen ?? 0),
    });
  const tipeId = memberForm.tipeId;
  const diskon = memberForm.diskon;
  const setTipeId = (nilai) => setMemberForm((f) => ({ ...f, tipeId: nilai }));
  const setDiskon = (nilai) => setMemberForm((f) => ({ ...f, diskon: nilai }));

  const idMember = Number(orang?.member_id) > 0 ? Number(orang.member_id) : 0;

  useEffect(() => {
    if (!idMember) return undefined;
    let batal = false;
    getMemberTemplates()
      .then((rows) => {
        if (!batal) setTipeList(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {});
    return () => {
      batal = true;
    };
  }, [idMember]);

  if (!orang) return null;

  // Jenis tujuan simpan baris (tanpa member = pelanggan).
  function jenisBaris() {
    if (idMember) return "member";
    if (orang.sumber === "blacklist" && !orang.id) return "blacklist";
    return "pelanggan";
  }

  async function simpanField() {
    setSaving(true);
    try {
      const jenis = jenisBaris();
      if (jenis === "member")
        await api.members.update(idMember, { [edit.key]: edit.nilai });
      else if (orang.id)
        await patchPelanggan(orang.id, { [edit.key]: edit.nilai });
      else if (orang.black?.id)
        await ubahBlacklist(orang.black.id, { [edit.key]: edit.nilai });
      else throw new Error("Baris ini tidak punya tujuan simpan.");
      notify("Tersimpan.");
      setEdit(null);
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal menyimpan.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function simpanMember() {
    setSaving(true);
    try {
      await api.members.update(idMember, {
        tipe_id: tipeId ? Number(tipeId) : null,
        diskon_persen: Math.max(0, Number(diskon) || 0),
      });
      notify("Tipe & diskon member disimpan.");
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal menyimpan member.", "error");
    } finally {
      setSaving(false);
    }
  }

  // Baris riwayat belum punya baris pelanggan: materialkan dulu supaya
  // dokumen jaminan punya tempat simpan (perilaku sama seperti tab Pelanggan).
  async function targetDokumen() {
    if (idMember) return { jenis: "member", id: idMember };
    if (orang.sumber === "riwayat" || !orang.id) {
      const baris = await upsertPelanggan({
        nama: orang.nama,
        hp: orang.hp,
        alamat: orang.alamat,
      });
      return { jenis: "pelanggan", id: baris?.id };
    }
    return { jenis: "pelanggan", id: orang.id };
  }

  async function unggahJaminan(file, slotKey, label) {
    try {
      const target = await targetDokumen();
      if (!target?.id) throw new Error("Data pelanggan tidak memiliki ID.");
      const index = foto.some((d) => d.label === label)
        ? foto.findIndex((d) => d.label === label)
        : foto.length;
      const hasil =
        target.jenis === "member"
          ? await uploadDokumenMember({
              memberId: target.id,
              file,
              label,
              index,
            })
          : await uploadDokumenPelanggan({
              pelangganId: target.id,
              file,
              label,
              index,
            });
      setFoto([
        ...foto.filter((d) => d.label !== label),
        { label: hasil.label || label, path: hasil.path },
      ]);
      notify("Dokumen jaminan diunggah.");
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal mengunggah dokumen.", "error");
    }
  }

  async function hapusJaminan(label) {
    try {
      const target = await targetDokumen();
      const sisa = foto
        .filter((d) => d.label !== label)
        .map(({ label: itemLabel, path }) => ({ label: itemLabel, path }));
      if (target.jenis === "member")
        await api.members.update(target.id, { foto_jaminan: sisa });
      else await patchPelanggan(target.id, { foto: sisa });
      setFoto(sisa);
      notify("Dokumen jaminan dihapus.");
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal menghapus dokumen.", "error");
    }
  }

  const jmlFoto = foto.filter((d) => d?.path).length;

  return (
    <Modal isOpen onClose={onClose} title={`Detail ${orang.nama}`} size="lg">
      <div className="flex flex-col gap-3">
        {FIELDS.map((f) => {
          const nilai = orang[f.key] || "";
          const aktif = edit?.key === f.key;
          return (
            <div
              key={f.key}
              className="flex items-start gap-3 rounded-lg border border-[var(--border-color)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                  {f.label}
                </div>
                {aktif ? (
                  <input
                    autoFocus
                    value={edit.nilai}
                    onChange={(e) => setEdit({ ...edit, nilai: e.target.value })}
                    className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]"
                  />
                ) : (
                  <div className="truncate text-sm text-[var(--text-primary)]">
                    {nilai || "—"}
                  </div>
                )}
              </div>
              {aktif ? (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" loading={saving} onClick={simpanField}>
                    Simpan
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                    Batal
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Ubah ${f.label}`}
                  className="shrink-0 rounded-md px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                  onClick={() => setEdit({ key: f.key, nilai })}
                >
                  ✎
                </button>
              )}
            </div>
          );
        })}

        {idMember ? (
          <div className="rounded-lg border border-[var(--border-color)] px-3 py-2">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
              Data member
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[10rem] flex-1 text-xs text-[var(--text-secondary)]">
                Tipe
                <select
                  value={tipeId}
                  onChange={(e) => setTipeId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)]"
                >
                  <option value="">Tanpa tipe</option>
                  {tipeList.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nama}
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-28 text-xs text-[var(--text-secondary)]">
                Diskon %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={diskon}
                  onChange={(e) => setDiskon(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)]"
                />
              </label>
              <Button size="sm" loading={saving} onClick={simpanMember}>
                Simpan tipe
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              Ganti tipe lengkap (daftar tipe, diskon durasi) ada di tab Member →
              Kelola.
            </p>
          </div>
        ) : null}

        {orang.black ? (
          <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger-text)]">
            Blacklist · alasan: {orang.black.alasan}
            {orang.black.createdAt
              ? ` · sejak ${String(orang.black.createdAt).slice(0, 10)}`
              : ""}
            <div className="mt-1">Tanggal masuk bersifat read-only.</div>
          </div>
        ) : null}

        <div className="rounded-lg border border-[var(--border-color)] px-3 py-2">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
            Dokumen jaminan · {jmlFoto}/5
            {idMember ? " (tersimpan di data member)" : ""}
          </div>
          <DokumenJaminan
            judul=""
            dokumen={foto}
            onUpload={unggahJaminan}
            onHapus={hapusJaminan}
            urlDokumen={idMember ? urlDokumenMember : urlDokumenPelanggan}
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            JPG/PNG/PDF maks 5MB per file.
          </p>
        </div>
      </div>
    </Modal>
  );
}
