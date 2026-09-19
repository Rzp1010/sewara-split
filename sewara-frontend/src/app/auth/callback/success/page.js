import Image from "next/image";
import Link from "next/link";

export default function VerificationSuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700">
      <section className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center" aria-labelledby="verification-success-title">
        <div className="flex justify-center mb-4">
          <Image src="/logo/Sewara_Logo Apps.png" width={80} height={80} alt="Sewara" priority style={{ objectFit: "contain" }} />
        </div>
        <h1 id="verification-success-title" className="text-2xl font-semibold text-gray-800 mb-4">Email berhasil diverifikasi</h1>
        <p className="text-gray-600 mt-2">
          Email Anda sudah terverifikasi.
        </p>
        <div className="text-green-600 mb-4" role="status">
          <p className="m-0">Akun Anda masih menunggu persetujuan admin.</p>
        </div>
        <p className="text-gray-600 mt-4 mb-6">
          Anda dapat login setelah akun disetujui admin.
        </p>
        <Link href="/" className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors w-full block mt-6 text-center">
          Ke Halaman Login
        </Link>
        <p className="text-gray-600 m-0 mt-6">Aplikasi Sewara &copy; 2026</p>
      </section>
    </main>
  );
}
