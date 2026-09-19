import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Reusable modal with overlay, Escape handling, and optional footer. */
export function Modal({ isOpen, onClose, title, children, footer, size = "md", closeOnOverlay = true }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);
  if (!isOpen) return null;
  const sizeClass = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl" }[size] || "max-w-md";
  return createPortal(<div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeOnOverlay ? onClose : undefined}><div className={`w-full max-h-[90vh] flex flex-col overflow-hidden bg-white rounded-lg border border-border shadow-xl animate-[rpModalPop_0.25s_cubic-bezier(0.22,1,0.36,1)_both] ${sizeClass}`} onClick={(event) => event.stopPropagation()}>{title && <div className="px-6 py-4 border-b flex items-center justify-between"><h3 className="text-[17px] capitalize m-0">{title}</h3><button className="w-8 h-8 shrink-0 flex items-center justify-center border-0 rounded-sm bg-transparent text-text-muted text-xl leading-none cursor-pointer transition-colors duration-fast hover:bg-surface-secondary hover:text-text-primary" onClick={onClose} aria-label="Tutup">×</button></div>}<div className="p-6 overflow-y-auto">{children}</div>{footer && <div className="px-6 py-4 border-t flex items-center justify-end gap-2">{footer}</div>}</div></div>, document.body);
}
