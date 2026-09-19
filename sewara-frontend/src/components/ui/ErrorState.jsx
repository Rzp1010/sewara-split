/** Error state with optional retry action. */
export function ErrorState({ message, onRetry }) {
  return <div className="flex flex-col items-center justify-center gap-3 p-12"><div className="text-red-600 text-5xl">!</div><p className="text-red-600 text-13">{message || "Terjadi kesalahan"}</p>{onRetry && <button className="rounded bg-brand px-4 py-2 text-white" onClick={onRetry}>Coba Lagi</button>}</div>;
}
