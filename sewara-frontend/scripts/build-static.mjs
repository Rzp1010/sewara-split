// Build static export untuk jalur Go. Dipisah dari `next build` biasa supaya
// jalur pm2 (next start) tidak berubah. Hasilnya di folder `out/`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const nextBin = path.join(here, "..", "node_modules", "next", "dist", "bin", "next");

const r = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: { ...process.env, STATIC_EXPORT: "true" },
});

if (r.status !== 0) {
  console.error("[build:static] gagal (exit " + r.status + ")");
  process.exit(r.status ?? 1);
}
console.log("[build:static] selesai — hasil di sewara-frontend/out/");
