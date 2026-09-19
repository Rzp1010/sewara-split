/** Empty data state with optional icon and action. */
export function EmptyState({ message = "Tidak ada data", icon, action }) {
  return <div className="flex flex-col items-center justify-center gap-3 p-12">{icon && <div className="text-text-muted text-[3rem]">{icon}</div>}<p className="text-13 text-text-muted">{message}</p>{action && <div>{action}</div>}</div>;
}
