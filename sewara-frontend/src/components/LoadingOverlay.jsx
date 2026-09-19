"use client";

import { createPortal } from "react-dom";

export default function LoadingOverlay({ teks = "Memuat...", subteks }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-sm">
      <div className="h-10 w-10 rounded-full border-4 border-surface-card border-t-brand [animation:rpSpin_0.7s_linear_infinite]"></div>
      <p className="text-sm font-bold text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.4)]">{teks}</p>
      {subteks && <p className="text-xs text-white/85 [text-shadow:0_1px_4px_rgba(0,0,0,0.4)]">{subteks}</p>}
    </div>,
    document.body
  );
}
