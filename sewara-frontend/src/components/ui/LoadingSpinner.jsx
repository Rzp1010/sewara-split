/** Centered loading indicator. */
export function LoadingSpinner({ size = "md", message }) {
  const sizeClass = { sm: "w-4 h-4", md: "w-8 h-8", lg: "w-12 h-12" }[size] || "";
  return <div className="flex flex-col items-center justify-center gap-2" style={{ padding: "2rem" }}><div className={`border-4 border-surface-card border-t-brand rounded-full [animation:rpSpin_0.7s_linear_infinite] ${sizeClass}`} />{message && <span className="text-text-muted">{message}</span>}</div>;
}
