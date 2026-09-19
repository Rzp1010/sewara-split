import "./globals-base.css";
import { Plus_Jakarta_Sans } from "next/font/google";

// Legacy .rp-* CSS loaded in dashboard/layout.js for backward compatibility

const jakarta = Plus_Jakarta_Sans({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
});

export const metadata = {
  title: "Sewara - Era Baru Manajemen Persewaan",
  description: "Aplikasi Sewara — manajemen persewaan alat",
  metadataBase: new URL("https://app-sewara.vercel.app"),
  openGraph: {
    title: "Sewara - Era Baru Manajemen Persewaan",
    description: "Aplikasi Sewara — manajemen persewaan alat",
    type: "website",
    locale: "id_ID",
    siteName: "Sewara",
    images: [{ url: "/logo/Sewara_Logo With Text Color  White.png" }],
  },
  twitter: {
    card: "summary",
    title: "Sewara - Era Baru Manajemen Persewaan",
    description: "Aplikasi Sewara — manajemen persewaan alat",
  },
};

export default function RootLayout({ children }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return (
    <html lang="id" className={jakarta.variable}>
      <head>
        {supabaseUrl && (
          <>
            <link rel="preconnect" href={supabaseUrl} />
            <link rel="dns-prefetch" href={supabaseUrl} />
          </>
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
