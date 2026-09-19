"use client";

import { useSyncExternalStore } from "react";

const ICONS = {
  dashboard: "/icons/dashboard.png",
  "katalog-n-inventaris": "/icons/katalog-n-inventaris.png",
  "booking-baru": "/icons/booking-baru.png",
  "status-sewa": "/icons/status-sewa.png",
  "riwayat-invoice": "/icons/riwayat-invoice.png",
  "tracking-alat": "/icons/tracking-alat.png",
  log: "/icons/log.png",
  "kalender-jadwal": "/icons/kalender-jadwal.png",
  laporan: "/icons/laporan.png",
  progres: "/icons/proggres.png",
  todo: "/icons/to-do.png",
};

function subscribeDark(cb) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  window.addEventListener("rentalpro-theme-change", cb);
  return () => {
    mq.removeEventListener("change", cb);
    window.removeEventListener("rentalpro-theme-change", cb);
  };
}
function getDark() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}
function getDarkServer() {
  return false;
}

const SIZES = {
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  12: 48,
};

export default function Emoji({ name, size = 5, className = "" }) {
  const dark = useSyncExternalStore(subscribeDark, getDark, getDarkServer);

  const src =
    name === "sdm"
      ? `/icons/${dark ? "sdm-dark" : "sdm-light"}.png`
      : ICONS[name];
  if (!src) return null;

  const px = SIZES[size] || 20;

  return (
    <img
      src={src}
      alt={name}
      aria-hidden="true"
      className={className}
      style={{ display: "inline-block", width: px, height: px, objectFit: "contain" }}
    />
  );
}
