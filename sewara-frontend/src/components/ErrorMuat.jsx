"use client";

export default function ErrorMuat({ onRetry }) {
  return (
    <section
      role="alert"
      className="mx-auto flex min-h-56 w-full max-w-xl flex-col items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 text-center text-[var(--text-primary)] shadow-sm"
    >
      <span
        aria-hidden="true"
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-danger-soft)] text-xl font-bold text-[var(--color-danger-text)]"
      >
        !
      </span>
      <p className="m-0 text-base font-semibold text-[var(--text-primary)]">
        Gagal memuat data.
      </p>
      <p className="mb-4 mt-1 text-sm text-[var(--text-secondary)]">
        Periksa koneksi lalu coba lagi.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#5d6fcc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7181E0] focus-visible:ring-offset-2"
      >
        Coba lagi
      </button>
    </section>
  );
}
