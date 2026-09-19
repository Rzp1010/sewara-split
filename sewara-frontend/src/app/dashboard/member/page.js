"use client";
import { useState, useEffect, useCallback } from "react";
import { getSettingTenant, setSettingTenant, getMembers, simpanMember, hapusMember, getMemberTemplates, simpanMemberTemplate, hapusMemberTemplate } from "@/lib/db";
import { createPortal } from "react-dom";
import imageCompression from "browser-image-compression";
import { api } from "@/lib/api-client";
import { ROLE_OWNER } from "@/lib/role";
import { useNotify } from "@/components/NotificationProvider";
import LoadingOverlay from "@/components/LoadingOverlay";

const EMPTY = {
  nama: "",
  hp: "",
  email: "",
  alamat: "",
  catatan: "",
  tipe_id: "",
  foto_jaminan: [],
};
const EMPTY_TIER = { nama: "", diskon_persen: "", status: "aktif" };
const DOCUMENT_SLOTS = [
  { key: "ktp", label: "KTP" },
  { key: "kk", label: "Kartu Keluarga" },
  { key: "sim", label: "SIM" },
  { key: "npwp", label: "NPWP" },
  { key: "lainnya", label: "Lainnya" },
];
const profileComplete = (member) =>
  Boolean(member.nama?.trim() && member.hp?.trim() && member.alamat?.trim());

export default function MemberPage() {
  const { notify, confirm: konfirm } = useNotify();
  const [loading, setLoading] = useState(true),
    [allowed, setAllowed] = useState(true),
    [members, setMembers] = useState([]),
    [templates, setTemplates] = useState([]);
  const [stack, setStack] = useState("terbesar"),
    [maks, setMaks] = useState("50"),
    [min, setMin] = useState("0"),
    [searchQuery, setSearchQuery] = useState("");
  const [modal, setModal] = useState(false),
    [editing, setEditing] = useState(null),
    [detail, setDetail] = useState(null),
    [form, setForm] = useState(EMPTY),
    [saving, setSaving] = useState(false);
  const [documentPreviews, setDocumentPreviews] = useState({}),
    [documentLoading, setDocumentLoading] = useState({});
  const [editPreviews, setEditPreviews] = useState({}),
    [draggingDocument, setDraggingDocument] = useState(null);
  const [tierModal, setTierModal] = useState(false),
    [tierEditing, setTierEditing] = useState(null),
    [tierForm, setTierForm] = useState(EMPTY_TIER),
    [settingsModal, setSettingsModal] = useState(false);

  function clearDocumentPreview() {
    setDocumentPreviews({});
    setDocumentLoading({});
  }
  function closeDetail() {
    setDetail(null);
    clearDocumentPreview();
  }
  function openMemberDetail(member) {
    closeDetail();
    setDetail(member);
  }
  function handleDrop(event, slot) {
    event.preventDefault();
    setDraggingDocument(null);
    const file = event.dataTransfer.files[0];
    if (file) upload(file, slot.key, slot.label);
  }
  function handleDragOver(event, index) {
    event.preventDefault();
    setDraggingDocument(index);
  }

  useEffect(() => {
    if (!modal) return;
    let active = true;
    setEditPreviews({});
    form.foto_jaminan.forEach(async (row) => {
      if (!row.path) return;
      const slot = DOCUMENT_SLOTS.find((item) => item.label === row.label);
      if (!slot) return;
      try {
        const response = await fetch(
          `/api/member/photo?key=${encodeURIComponent(row.path)}`,
        );
        const result = await response.json();
        if (!response.ok || !result.url)
          throw Error(result.error || "Dokumen tidak dapat dibuka");
        if (active)
          setEditPreviews((current) => ({
            ...current,
            [slot.key]: {
              url: result.url,
              type: /\.pdf(?:$|[?#])/i.test(row.path) ? "pdf" : "image",
            },
          }));
      } catch (error) {
        if (active) notify(`${row.label}: ${error.message}`, "error");
      }
    });
    return () => {
      active = false;
    };
  }, [modal, form.foto_jaminan, notify]);

  useEffect(() => {
    if (!detail) return undefined;
    let active = true;
    const documents = Array.isArray(detail.foto_jaminan)
      ? detail.foto_jaminan.filter((item) => item?.path)
      : [];
    setDocumentPreviews({});
    setDocumentLoading(
      Object.fromEntries(documents.map((item, index) => [index, true])),
    );
    documents.forEach(async (item, index) => {
      const { label, path } = item;
      try {
        const response = await fetch(
          `/api/member/photo?key=${encodeURIComponent(path)}`,
        );
        const result = await response.json();
        if (!response.ok || !result.url)
          throw Error(result.error || "Dokumen tidak dapat dibuka");
        if (active)
          setDocumentPreviews((current) => ({
            ...current,
            [index]: {
              label,
              type: /\.pdf(?:$|[?#])/i.test(path) ? "pdf" : "image",
              url: result.url,
            },
          }));
      } catch (error) {
        if (active) notify(`${label}: ${error.message}`, "error");
      } finally {
        if (active)
          setDocumentLoading((current) => ({ ...current, [index]: false }));
      }
    });
    return () => {
      active = false;
    };
  }, [detail, notify]);

  const muat = useCallback(async () => {
    setLoading(true);
    let role = "";
    try {
      const me = await api.auth.me();
      role = me?.user?.role || "";
    } catch {}
    setAllowed(role === ROLE_OWNER);
    if (role === ROLE_OWNER) {
      const [m, t, s, x, p] = await Promise.all([
        getMembers(),
        getMemberTemplates(),
        getSettingTenant("diskon_stack", "terbesar"),
        getSettingTenant("diskon_maks_persen", 50),
        getSettingTenant("promo_min_transaksi", 0),
      ]);
      setMembers(m);
      setTemplates(t);
      setStack(s);
      setMaks(String(x));
      setMin(String(p));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    muat();
  }, [muat]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nama = params.get("nama");
    if (nama) {
      setForm({
        ...EMPTY,
        nama,
        hp: params.get("hp") || "",
        email: params.get("email") || "",
        alamat: params.get("alamat") || "",
      });
      setModal(true);
    }
  }, []);

  async function saveMember() {
    if (!form.nama.trim()) return notify("Nama wajib diisi", "error");
    if (form.hp && !/^(08|\+62)/.test(form.hp))
      return notify("HP harus diawali 08 atau +62", "error");
    setSaving(true);
    const data = {
      nama: form.nama.trim(),
      hp: form.hp,
      email: form.email,
      alamat: form.alamat,
      catatan: form.catatan,
      foto_jaminan: form.foto_jaminan,
      tipe_id: form.tipe_id ? Number(form.tipe_id) : null,
    };
    if (editing?.id) data.id = editing.id;
    const r = await simpanMember(data);
    setSaving(false);
    if (!r.ok) return notify(r.error, "error");
    setModal(false);
    notify("Member disimpan.");
    muat();
  }

  async function upload(file, slotKey, slotLabel) {
    if (!editing?.id)
      return notify("Simpan profil dulu sebelum upload foto", "error");
    if (
      file.size > 5242880 ||
      !["image/jpeg", "image/png", "application/pdf"].includes(file.type)
    )
      return notify("File maksimal 5MB, format JPG, PNG, atau PDF", "error");
    const existingIndex = form.foto_jaminan.findIndex(
      (item) => item.label === slotLabel,
    );
    const index = existingIndex >= 0 ? existingIndex : form.foto_jaminan.length;
    setDocumentLoading((current) => ({ ...current, [slotKey]: true }));
    try {
      let f = file;
      if (file.type.startsWith("image/"))
        f = await imageCompression(file, {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        });
      const d = new FormData();
      d.append("file", f);
      d.append("memberId", editing.id);
      d.append("label", slotLabel);
      d.append("index", index);
      const j = await (
        await fetch("/api/member/upload", { method: "POST", body: d })
      ).json();
      if (!j.ok) throw Error(j.error);
      setForm((x) => {
        const documents = [...x.foto_jaminan];
        documents[existingIndex >= 0 ? existingIndex : documents.length] = {
          label: j.label || slotLabel,
          path: j.path,
        };
        return { ...x, foto_jaminan: documents };
      });
      setEditPreviews((current) => ({
        ...current,
        [slotKey]: {
          url: URL.createObjectURL(file),
          type: file.type === "application/pdf" ? "pdf" : "image",
        },
      }));
      notify("Dokumen berhasil diupload.");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setDocumentLoading((current) => ({ ...current, [slotKey]: false }));
    }
  }

  async function deleteDocument(slotKey, slotLabel) {
    if (!(await konfirm(`Hapus dokumen ${slotLabel}?`))) return;
    setForm((x) => ({
      ...x,
      foto_jaminan: x.foto_jaminan.filter((item) => item.label !== slotLabel),
    }));
    setEditPreviews((current) => {
      const next = { ...current };
      delete next[slotKey];
      return next;
    });
    notify("Dokumen dihapus.");
  }

  async function saveTier() {
    if (!tierForm.nama.trim()) return notify("Nama tipe wajib diisi", "error");
    const d = {
      ...tierForm,
      nama: tierForm.nama.trim(),
      diskon_persen: Math.min(
        100,
        Math.max(0, Number(tierForm.diskon_persen) || 0),
      ),
    };
    if (tierEditing?.id) d.id = tierEditing.id;
    const r = await simpanMemberTemplate(d);
    if (!r.ok) return notify(r.error, "error");
    setTierModal(false);
    muat();
  }

  const filteredMembers = members.filter((member) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      member.nama?.toLowerCase().includes(query) ||
      member.hp?.toLowerCase().includes(query) ||
      member.email?.toLowerCase().includes(query)
    );
  });

  if (loading) return <LoadingOverlay />;
  if (!allowed)
    return (
      <div className="min-h-full p-6">
        <div className="rounded-md border border-solid border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Anda tidak berhak mengakses.
        </div>
      </div>
    );

  return (
    <>
      <div className="min-h-full p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Member</h2>
            <p className="text-slate-600">
              Kelola profil member, tingkatan, dan diskon.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300 transition-colors"
              onClick={() => setSettingsModal(true)}
            >
              Pengaturan
            </button>
            <button
              type="button"
              className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc] transition-colors"
              onClick={() => {
                setEditing(null);
                setForm(EMPTY);
                setModal(true);
              }}
            >
              Tambah Member
            </button>
          </div>
        </div>

        {/* Tabel */}
        <div className="rounded-lg border border-solid border-slate-200 bg-white p-0">
          <div className="flex items-center justify-between px-6 pb-4 pt-6">
            <b>Data Member</b>
            <input
              className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              placeholder="Cari nama, HP, atau email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
            <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
              <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">Nama</th>
                  <th className="px-4 py-3 text-left">HP</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Tipe</th>
                  <th className="px-4 py-3 text-left">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((m) => (
                  <tr key={m.id} className="odd:bg-white even:bg-slate-50">
                    <td className="px-4 py-3">{m.nama}</td>
                    <td className="px-4 py-3">{m.hp || "-"}</td>
                    <td className="px-4 py-3">{m.email || "-"}</td>
                    <td className="px-4 py-3">{m.tipeNama || "-"}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="rounded-lg border-0 bg-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-gray-300"
                        onClick={() => openMemberDetail(m)}
                      >
                        Cek Data
                      </button>{" "}
                      <button
                        type="button"
                        className="rounded-lg border-0 bg-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-gray-300"
                        onClick={() => {
                          setEditing(m);
                          setForm({
                            ...EMPTY,
                            ...m,
                            foto_jaminan: Array.isArray(m.foto_jaminan)
                              ? m.foto_jaminan
                              : [],
                          });
                          setModal(true);
                        }}
                      >
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        className="rounded-lg border-0 bg-[#F04438] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#d03a2f]"
                        onClick={async () => {
                          if (await konfirm(`Hapus member ${m.nama}?`)) {
                            const r = await hapusMember(m.id);
                            if (!r.ok) notify(r.error, "error");
                            else muat();
                          }
                        }}
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Settings Modal */}
        {typeof document !== "undefined" &&
          settingsModal &&
          createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
              onClick={() => setSettingsModal(false)}
            >
              <div
                className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-6 pb-4 pt-6">
                  <h3 className="text-lg font-bold">
                    Pengaturan Tier &amp; Diskon
                  </h3>
                  <button
                    type="button"
                    className="rounded-lg border-0 bg-transparent px-2 py-2 text-xl text-slate-600 hover:bg-gray-100 transition-colors"
                    onClick={() => setSettingsModal(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                  <div className="rounded-lg border border-solid border-slate-200 bg-white p-0">
                    <div className="flex items-center justify-between px-6 pb-4 pt-6">
                      <b>Tipe Member</b>
                      <button
                        type="button"
                        className="rounded-md border-0 bg-indigo-500 px-3 py-1.5 text-xs text-white shadow-sm hover:bg-indigo-600"
                        onClick={() => {
                          setTierEditing(null);
                          setTierForm(EMPTY_TIER);
                          setTierModal(true);
                        }}
                      >
                        Tambah Tipe
                      </button>
                    </div>
                    <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
                      <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
                        <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                          <tr>
                            <th className="px-4 py-3 text-left">Nama</th>
                            <th className="px-4 py-3 text-left">Diskon</th>
                            <th className="px-4 py-3 text-left">Status</th>
                            <th className="px-4 py-3 text-left">Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {templates.map((t) => (
                            <tr
                              key={t.id}
                              className="odd:bg-white even:bg-slate-50"
                            >
                              <td className="px-4 py-3">{t.nama}</td>
                              <td className="px-4 py-3">{t.diskon_persen}%</td>
                              <td className="px-4 py-3">{t.status}</td>
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  className="rounded-md bg-transparent px-3 py-1.5 text-xs text-slate-700 hover:bg-gray-200"
                                  onClick={() => {
                                    setTierEditing(t);
                                    setTierForm({
                                      nama: t.nama,
                                      diskon_persen: String(t.diskon_persen),
                                      status: t.status,
                                    });
                                    setTierModal(true);
                                  }}
                                >
                                  Edit
                                </button>{" "}
                                <button
                                  type="button"
                                  className="rounded-lg border-0 bg-[#F04438] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#d03a2f]"
                                  onClick={async () => {
                                    if (
                                      await konfirm(
                                        `Hapus tipe member ${t.nama}?`,
                                      )
                                    ) {
                                      await hapusMemberTemplate(t.id);
                                      muat();
                                    }
                                  }}
                                >
                                  Hapus
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-solid border-slate-200 bg-white p-4">
                    <h3>Setting Diskon Member</h3>
                    <label className="mb-3 block text-sm font-semibold">
                      Cara diskon berpadu promo
                      <select
                        className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                        value={stack}
                        onChange={(e) => {
                          setStack(e.target.value);
                          setSettingTenant("diskon_stack", e.target.value);
                        }}
                      >
                        <option value="terbesar">Pilih diskon terbesar</option>
                        <option value="gabung">Boleh digabung</option>
                        <option value="satu">Hanya satu jenis</option>
                      </select>
                    </label>
                    <label className="mb-3 block text-sm font-semibold">
                      Batas maksimal diskon (%)
                      <input
                        className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                        value={maks}
                        onChange={(e) => setMaks(e.target.value)}
                        onBlur={() =>
                          setSettingTenant(
                            "diskon_maks_persen",
                            Number(maks) || 0,
                          )
                        }
                      />
                    </label>
                    <label className="mb-3 block text-sm font-semibold">
                      Minimal transaksi promo (Rp)
                      <input
                        className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                        value={min}
                        onChange={(e) => setMin(e.target.value)}
                        onBlur={() =>
                          setSettingTenant(
                            "promo_min_transaksi",
                            Number(min) || 0,
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 px-6 pb-6 pt-4">
                  <button
                    type="button"
                    className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc] transition-colors"
                    onClick={() => setSettingsModal(false)}
                  >
                    Tutup
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {/* Detail Modal */}
        {typeof document !== "undefined" &&
          detail &&
          createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
              onClick={closeDetail}
            >
              <div
                className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="member-detail-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-6 pb-4 pt-6">
                  <h3 id="member-detail-title" className="text-lg font-bold">
                    Data Member
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      <b>Nama:</b> {detail.nama || "-"}
                    </p>
                    <p style={{ margin: 0 }}>
                      <b>HP:</b> {detail.hp || "-"}
                    </p>
                    <p style={{ margin: 0 }}>
                      <b>Email:</b> {detail.email || "-"}
                    </p>
                    <p style={{ margin: 0 }}>
                      <b>Alamat:</b> {detail.alamat || "-"}
                    </p>
                  </div>
                  <h4>Dokumen</h4>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: "12px",
                      alignItems: "start",
                    }}
                  >
                    {(Array.isArray(detail.foto_jaminan)
                      ? detail.foto_jaminan
                      : []
                    ).map((item, index) => {
                      const { label, path } = item;
                      const preview = documentPreviews[index];
                      const isLoading = documentLoading[index];
                      return path ? (
                        <div key={index} style={{ minWidth: 0 }}>
                          <div
                            style={{
                              border: "1px solid #ddd",
                              borderRadius: "8px",
                              padding: "8px",
                              width: "100%",
                              height: "220px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              overflow: "hidden",
                              background: "#fafafa",
                            }}
                          >
                            {isLoading && (
                              <span aria-live="polite">Memuat...</span>
                            )}
                            {preview?.type === "pdf" && (
                              <iframe
                                title={`Pratinjau ${label}`}
                                src={preview.url}
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  border: 0,
                                  pointerEvents: "none",
                                }}
                              />
                            )}
                            {preview?.type === "image" && (
                              <img
                                src={preview.url}
                                alt={`Pratinjau ${label}`}
                                style={{
                                  display: "block",
                                  maxWidth: "100%",
                                  maxHeight: "100%",
                                  width: "auto",
                                  height: "auto",
                                  objectFit: "contain",
                                }}
                              />
                            )}
                            {!isLoading && !preview && (
                              <span>Dokumen gagal dimuat</span>
                            )}
                          </div>
                          <p style={{ textAlign: "center", margin: "8px 0 0" }}>
                            <b>{label}</b>
                          </p>
                        </div>
                      ) : (
                        <div key={index}>
                          <p>
                            <b>{label}:</b> Belum
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 px-6 pb-6 pt-4">
                  <button
                    type="button"
                    className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300 transition-colors"
                    onClick={closeDetail}
                  >
                    Tutup
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc] transition-colors"
                    onClick={() => {
                      setEditing(detail);
                      setForm({
                        ...EMPTY,
                        ...detail,
                        foto_jaminan: detail.foto_jaminan || EMPTY.foto_jaminan,
                      });
                      closeDetail();
                      setModal(true);
                    }}
                  >
                    Edit member
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {/* Edit / Tambah Member Modal */}
        {typeof document !== "undefined" &&
          modal &&
          createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
              onClick={() => setModal(false)}
            >
              <div
                className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between px-6 pb-4 pt-6">
                  <div>
                    <h3 className="mb-0.5 text-lg font-bold">
                      {editing ? "Edit" : "Tambah"} Member
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {editing?.nama || form.nama || "Member baru"} ·{" "}
                      {editing?.tipeNama || "Tanpa tipe"}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Tutup"
                    onClick={() => setModal(false)}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border-0 bg-gray-100 text-xl text-gray-600 hover:bg-gray-200 transition-colors"
                  >
                    ×
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Nama
                      </label>
                      <input
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                        value={form.nama || ""}
                        onChange={(e) =>
                          setForm({ ...form, nama: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        No HP
                      </label>
                      <input
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                        value={form.hp || ""}
                        onChange={(e) =>
                          setForm({ ...form, hp: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Email
                      </label>
                      <input
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                        value={form.email || ""}
                        onChange={(e) =>
                          setForm({ ...form, email: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Alamat
                      </label>
                      <input
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                        value={form.alamat || ""}
                        onChange={(e) =>
                          setForm({ ...form, alamat: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Tipe Member
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={
                            form.tipe_id == t.id
                              ? "rounded-full border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc] transition-colors"
                              : "rounded-full border border-solid border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-100 transition-colors"
                          }
                          onClick={() => setForm({ ...form, tipe_id: t.id })}
                        >
                          {t.nama}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={
                          !form.tipe_id
                            ? "rounded-full border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc] transition-colors"
                            : "rounded-full border border-solid border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-100 transition-colors"
                        }
                        onClick={() => setForm({ ...form, tipe_id: "" })}
                      >
                        Tanpa tipe
                      </button>
                    </div>
                  </div>
                  <div className="mb-4 mt-6 flex items-center gap-3">
                    <div className="h-px flex-1 bg-gray-200" />
                    <span className="whitespace-nowrap text-xs font-semibold text-gray-400">
                      Dokumen Jaminan (Opsional ·{" "}
                      {form.foto_jaminan.filter((item) => item?.path).length}/5)
                    </span>
                    <div className="h-px flex-1 bg-gray-200" />
                  </div>
                  <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                    {DOCUMENT_SLOTS.map((slot, index) => {
                      const item = form.foto_jaminan.find(
                        (d) => d.label === slot.label,
                      );
                      const preview = editPreviews[slot.key];
                      const filled = item?.path || preview;
                      return (
                        <div
                          key={slot.key}
                          className={`relative flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] px-2 py-3.5 text-center transition-colors hover:border-[#7181E0] hover:bg-[#EEF2FF] ${filled ? "border-solid border-emerald-500 bg-green-50" : "border-dashed border-gray-200"}`}
                          onClick={() =>
                            document.getElementById(`doc-${slot.key}`)?.click()
                          }
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDrop={(e) => handleDrop(e, slot)}
                        >
                          <div
                            className={`text-xl leading-none ${filled ? "text-emerald-500" : "text-gray-400"}`}
                          >
                            {preview?.type === "image" ? (
                              <img
                                src={preview.url}
                                alt={slot.label}
                                className="max-h-20 max-w-full object-contain"
                              />
                            ) : preview?.type === "pdf" ? (
                              <span className="text-3xl">PDF</span>
                            ) : (
                              <span>{filled ? "✓" : "+"}</span>
                            )}
                          </div>
                          <div
                            className={`text-[11px] font-semibold ${filled ? "text-emerald-800" : "text-gray-400"}`}
                          >
                            {slot.label}
                          </div>
                          {filled && (
                            <div
                              className="text-center text-[10px] text-red-500"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteDocument(slot.key, slot.label);
                              }}
                            >
                              Hapus
                            </div>
                          )}
                          <input
                            id={`doc-${slot.key}`}
                            type="file"
                            hidden
                            accept="image/jpeg,image/png,application/pdf"
                            onChange={(e) =>
                              e.target.files[0] &&
                              upload(e.target.files[0], slot.key, slot.label)
                            }
                          />
                          {documentLoading[slot.key] && (
                            <div className="absolute inset-0 flex items-center justify-center rounded bg-white/80">
                              Mengunggah...
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 px-6 pb-6 pt-4">
                  <button
                    type="button"
                    className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300 transition-colors"
                    onClick={() => setModal(false)}
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc] transition-colors"
                    disabled={saving}
                    onClick={saveMember}
                  >
                    Simpan
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {/* Tier Modal */}
        {typeof document !== "undefined" &&
          tierModal &&
          createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
              onClick={() => setTierModal(false)}
            >
              <div
                className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-6 pb-4 pt-6">
                  <h3 className="text-lg font-bold">
                    {tierEditing ? "Edit" : "Tambah"} Tipe Member
                  </h3>
                  <button
                    type="button"
                    className="rounded-lg border-0 bg-transparent px-2 py-2 text-xl text-slate-600 hover:bg-gray-100 transition-colors"
                    onClick={() => setTierModal(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                  <label className="mb-3 block text-sm font-semibold">
                    Nama Tipe
                    <input
                      className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                      value={tierForm.nama}
                      onChange={(e) =>
                        setTierForm({ ...tierForm, nama: e.target.value })
                      }
                    />
                  </label>
                  <label className="mb-3 block text-sm font-semibold">
                    Diskon (%)
                    <input
                      className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                      value={tierForm.diskon_persen}
                      onChange={(e) =>
                        setTierForm({
                          ...tierForm,
                          diskon_persen: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="mb-3 block text-sm font-semibold">
                    Status
                    <select
                      className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                      value={tierForm.status}
                      onChange={(e) =>
                        setTierForm({ ...tierForm, status: e.target.value })
                      }
                    >
                      <option>aktif</option>
                      <option>nonaktif</option>
                    </select>
                  </label>
                </div>
                <div className="flex items-center justify-end gap-3 px-6 pb-6 pt-4">
                  <button
                    type="button"
                    className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300 transition-colors"
                    onClick={() => setTierModal(false)}
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc] transition-colors"
                    onClick={saveTier}
                  >
                    Simpan
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>
    </>
  );
}
