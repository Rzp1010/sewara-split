"use client";

export default function ErrorMuat({ onRetry }) {
  return (
    <section
      role="alert"
      className="mx-auto flex min-h-56 w-full max-w-xl flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm"
    >
      <span
        aria-hidden="true"
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-xl font-bold text-red-600"
      >
        !
      </span>
      <p className="m-0 text-base font-semibold text-gray-900">
        Gagal memuat data.
      </p>
      <p className="mb-4 mt-1 text-sm text-gray-500">
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
