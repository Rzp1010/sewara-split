"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import {
  getMemberTemplates,
  simpanMemberTemplate,
  hapusMemberTemplate,
} from "@/lib/db";

const EMPTY_TIER = {
  nama: "",
  diskon_persen: "",
  status: "aktif",
  diskon_durasi_aturan: [],
};

// Normalisasi diskon_durasi_aturan: array / string JSON / gagal → []
function normalisasiAturanDurasi(value) {
  try {
    const arr = value
      ? typeof value === "string"
        ? JSON.parse(value)
        : value
      : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function DurasiTierEditor({ value, onChange }) {
  const rows = normalisasiAturanDurasi(value);
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-subtle)] text-xs uppercase text-[var(--text-secondary)]">
          <tr>
            <th className="px-3 py-2 text-left">Mulai dari (hari)</th>
            <th className="px-3 py-2 text-left">Diskon (%)</th>
            <th className="w-12 px-3 py-2 text-center">—</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={3} className="px-3 py-2 text-sm text-[var(--text-muted)]">Belum ada aturan durasi.</td></tr>
          ) : null}
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[var(--border-color)]">
              <td className="px-3 py-2">
                <input
                  type="number"
                  min="1"
                  value={r.min_hari}
                  onChange={(e) =>
                    onChange(
                      rows.map((x, j) =>
                        j === i
                          ? { ...x, min_hari: Number(e.target.value) || 0 }
                          : x,
                      ),
                    )
                  }
                  className="w-24 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </td>
              <td className="px-3 py-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={r.persentase}
                  onChange={(e) =>
                    onChange(
                      rows.map((x, j) =>
                        j === i
                          ? { ...x, persentase: Number(e.target.value) || 0 }
                          : x,
                      ),
                    )
                  }
                  className="w-24 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </td>
              <td className="px-3 py-2 text-center">
                <button
                  type="button"
                  aria-label="Hapus tier"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  className="rounded p-1 text-[var(--color-danger)] hover:bg-[var(--bg-subtle)]"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-[var(--border-color)] px-3 py-2">
        <button
          type="button"
          onClick={() =>
            onChange([
              ...rows,
              {
                min_hari: (rows[rows.length - 1]?.min_hari || 0) + 1,
                persentase: 10,
              },
            ])
          }
          className="text-xs font-medium text-[var(--color-primary)] hover:underline"
        >
          + Tambah aturan diskon
        </button>
      </div>
    </div>
  );
}

/**
 * Kelola tipe member (tabel member_types): daftar, tambah, edit, hapus.
 * Dipasang hanya saat terbuka; daftar diambil sekali di effect.
 */
export default function ModalTipeMember({ onClose, onBerubah }) {
  const { notify, confirm: konfirm } = useNotify();
  const [tipe, setTipe] = useState([]);
  const [form, setForm] = useState(EMPTY_TIER);
  const [editId, setEditId] = useState(0);
  const [saving, setSaving] = useState(false);
  const [memuat, setMemuat] = useState(true);

  async function muat() {
    setMemuat(true);
    try {
      const rows = await getMemberTemplates();
      setTipe(Array.isArray(rows) ? rows : []);
    } catch {
      notify("Gagal memuat tipe member.", "error");
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    let batal = false;
    getMemberTemplates()
      .then((rows) => {
        if (!batal) setTipe(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!batal) notify("Gagal memuat tipe member.", "error");
      })
      .finally(() => {
        if (!batal) setMemuat(false);
      });
    return () => {
      batal = true;
    };
  }, []);

  const input =
    "mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]";

  function mulaiEdit(t) {
    setEditId(t.id);
    setForm({
      nama: t.nama || "",
      diskon_persen: String(t.diskon_persen ?? ""),
      status: t.status || "aktif",
      diskon_durasi_aturan: normalisasiAturanDurasi(t.diskon_durasi_aturan),
    });
  }

  async function simpan() {
    if (!form.nama.trim()) return notify("Nama tipe wajib diisi.", "error");
    setSaving(true);
    const aturan = normalisasiAturanDurasi(form.diskon_durasi_aturan)
      .map((r) => ({
        min_hari: Math.max(1, Math.floor(Number(r?.min_hari) || 0)),
        persentase: Math.min(100, Math.max(0, Math.round(Number(r?.persentase) || 0))),
      }))
      .filter((r) => r.persentase > 0)
      .sort((a, b) => b.min_hari - a.min_hari);
    const r = await simpanMemberTemplate({
      ...(editId ? { id: editId } : {}),
      nama: form.nama.trim(),
      diskon_persen: Math.min(100, Math.max(0, Number(form.diskon_persen) || 0)),
      status: form.status,
      diskon_durasi_aturan: aturan,
    });
    setSaving(false);
    if (!r.ok) return notify(r.error || "Gagal menyimpan tipe.", "error");
    notify("Tipe member disimpan.");
    setForm(EMPTY_TIER);
    setEditId(0);
    await muat();
    onBerubah?.();
  }

  async function hapus(t) {
    if (!(await konfirm(`Hapus tipe ${t.nama}?`))) return;
    const r = await hapusMemberTemplate(t.id);
    if (!r.ok) return notify(r.error || "Gagal menghapus tipe.", "error");
    notify("Tipe dihapus.");
    await muat();
    onBerubah?.();
  }

  return (
    <Modal isOpen onClose={onClose} title="Kelola tipe member" description="Atur status dan diskon yang berlaku untuk tiap tipe." size="xl">
      <div className="space-y-5">
        <section className="rounded-lg border border-[var(--border-color)] p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Daftar tipe</h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-subtle)] text-xs uppercase text-[var(--text-secondary)]">
              <tr>
                <th className="px-3 py-2 text-left">Nama</th>
                <th className="px-3 py-2 text-left">Diskon</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {memuat ? (
                <tr><td colSpan={4} className="py-4 text-center text-sm text-[var(--text-muted)]">Memuat tipe member...</td></tr>
              ) : tipe.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm text-[var(--text-muted)]">
                    Belum ada tipe member. Tambahkan tipe melalui formulir di bawah.
                  </td>
                </tr>
              ) : (
                tipe.map((t) => (
                  <tr key={t.id} className="border-t border-[var(--border-color)]">
                    <td className="px-3 py-2 text-[var(--text-primary)]">{t.nama}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                      {Number(t.diskon_persen) || 0}%
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                      {t.status || "aktif"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => mulaiEdit(t)}
                        className="mr-2 text-xs font-semibold text-[var(--color-primary)] hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => hapus(t)}
                        className="text-xs font-semibold text-[var(--color-danger)] hover:underline"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border-color)] p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
            {editId ? "Edit tipe" : "Tambah tipe"}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium text-[var(--text-secondary)]">
              Nama tipe *
              <input
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className={input}
              />
            </label>
            <label className="text-sm font-medium text-[var(--text-secondary)]">
              Diskon umum (%)
              <input
                type="number"
                min="0"
                max="100"
                value={form.diskon_persen}
                onChange={(e) =>
                  setForm({ ...form, diskon_persen: e.target.value })
                }
                className={input}
              />
            </label>
            <label className="text-sm font-medium text-[var(--text-secondary)]">
              Status
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className={input}
              >
                <option value="aktif">aktif</option>
                <option value="nonaktif">nonaktif</option>
              </select>
            </label>
          </div>
          <div className="mt-3">
            <div className="mb-1 text-sm font-medium text-[var(--text-secondary)]">
              Diskon berdasarkan durasi sewa (opsional)
            </div>
            <p className="mb-2 text-[11px] text-[var(--text-muted)]">
              Kalau diisi, persentase ini menggantikan diskon biasa saat durasi
              sewa memenuhi syarat.
            </p>
            <DurasiTierEditor
              value={form.diskon_durasi_aturan}
              onChange={(v) => setForm({ ...form, diskon_durasi_aturan: v })}
            />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {editId ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditId(0);
                  setForm(EMPTY_TIER);
                }}
              >
                Batal edit
              </Button>
            ) : null}
            <Button loading={saving} onClick={simpan}>
              Simpan tipe
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}