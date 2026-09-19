import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="flex flex-col items-center">
        <div className="mb-4">
          <Image
            src="/logo/Sewara_Logo Apps.png"
            width={80}
            height={80}
            alt="Sewara"
            priority
            style={{ objectFit: "contain" }}
          />
        </div>
        <h1 className="text-9xl font-bold text-blue-600 mb-4" style={{ fontSize: 64, lineHeight: 1, letterSpacing: "-0.03em" }}>
          404
        </h1>
        <p className="text-2xl font-semibold text-gray-800 mb-2" style={{ marginTop: 12, fontSize: 16, fontWeight: 700, color: "var(--text-secondary)" }}>
          Halaman Tidak Ditemukan
        </p>
        <p className="text-gray-600 mb-6 text-center" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Halaman yang Anda cari tidak ada atau telah dipindahkan.
          Periksa kembali alamatnya, atau kembali ke halaman login untuk melanjutkan.
        </p>
        <div>
          <Link href="/" className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors">
            Kembali ke Login
          </Link>
        </div>
        <p className="text-gray-500 mt-6 mb-0">Aplikasi Sewara &copy; 2026</p>
      </div>
    </div>
  );
}
