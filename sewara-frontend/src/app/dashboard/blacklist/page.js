"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Rute lama → tab Blacklist di halaman gabungan. */
export default function PengalihBlacklist() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/pelanggan?tab=blacklist");
  }, [router]);
  return null;
}
