"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Rute lama → tab Member di halaman gabungan. */
export default function PengalihMember() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/pelanggan?tab=member");
  }, [router]);
  return null;
}
