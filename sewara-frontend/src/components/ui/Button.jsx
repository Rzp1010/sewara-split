import React from "react";

/** Reusable button with consistent variants and loading state. */
export function Button({ children, variant = "primary", size = "md", disabled = false, loading = false, onClick, type = "button", className = "", ...props }) {
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed",
    success: "bg-green-600 text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed",
    danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed",
    ghost: "bg-transparent hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed",
    outline: "border border-gray-300 bg-transparent hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed",
  };
  const sizes = { xs: "px-2 py-1 text-xs", sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-sm", lg: "px-6 py-3 text-base" };
  const classes = ["inline-flex items-center justify-center rounded-lg font-medium transition-colors", variants[variant] || variants.primary, sizes[size] || "", className].filter(Boolean).join(" ");
  return <button type={type} className={classes} disabled={disabled || loading} onClick={onClick} {...props}>{loading ? <><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> <span>Memuat...</span></> : children}</button>;
}
