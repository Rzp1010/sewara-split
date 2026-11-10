import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Modal bersama dengan overlay dan dukungan tombol Escape. */
export function Modal({ isOpen, onClose, title, description, children, footer, size = "md", closeOnOverlay = true, zClass = "z-40" }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);
  if (!isOpen) return null;
  const sizeClass = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-[520px]", action: "max-w-[400px]", xl: "max-w-xl", "2xl": "max-w-2xl", "3xl": "max-w-3xl" }[size] || "max-w-md";
  return createPortal(
    <div className={`fixed inset-0 ${zClass} flex items-center justify-center bg-black/50 backdrop-blur-sm`} onClick={closeOnOverlay ? onClose : undefined}>
      <div className={`flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-xl bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xl animate-[rpModalPop_0.25s_cubic-bezier(0.22,1,0.36,1)_both] ${sizeClass}`} onClick={(event) => event.stopPropagation()}>
        {title && <div className="flex items-start justify-between gap-3 px-[22px] pt-5"><div className="min-w-0"><h3 className="m-0 text-base font-bold leading-tight">{title}</h3>{description && <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">{description}</p>}</div><button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-base leading-none text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]" onClick={onClose} aria-label="Tutup">&#x2715;</button></div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-solid border-[var(--border-color)] px-[22px] pb-[18px] pt-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
