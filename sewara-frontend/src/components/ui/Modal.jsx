import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Reusable modal with overlay, Escape handling, and optional footer. */
export function Modal({ isOpen, onClose, title, description, children, footer, size = "md", closeOnOverlay = true }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);
  if (!isOpen) return null;
  const sizeClass = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl", "2xl": "max-w-2xl", "3xl": "max-w-3xl" }[size] || "max-w-md";
  return createPortal(<div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeOnOverlay ? onClose : undefined}><div className={`w-full max-h-[90dvh] flex flex-col overflow-hidden bg-[var(--bg-surface)] text-[var(--text-primary)] rounded-xl shadow-2xl animate-[rpModalPop_0.25s_cubic-bezier(0.22,1,0.36,1)_both] ${sizeClass}`} onClick={(event) => event.stopPropagation()}>{title && <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-base font-semibold m-0 leading-tight">{title}</h3>{description && <p className="mt-0.5 text-sm text-[var(--text-muted)]">{description}</p>}</div><button className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md bg-transparent text-[var(--text-muted)] text-base leading-none cursor-pointer hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]" onClick={onClose} aria-label="Tutup" style={{border:"none"}}>&#x2715;</button></div>}<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>{footer && <div className="px-6 pb-5 flex items-center justify-end gap-1.5">{footer}</div>}</div></div>, document.body);
}
