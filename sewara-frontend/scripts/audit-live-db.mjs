// Audit live DB sewara (obhvrzholszhjnpvmnna) — non-destruktif.
// Pakai sebelum tulis/ubah RPC: cek kolom & fungsi live dulu.
// Trigger/policy tidak terlihat via PostgREST — cek manual di SQL Editor bila ragu.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env.local"), "utf-8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.match(/^([^=#\s][^=]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1].trim(), m[2].trim().replace(/^["']|["']$/g, "")]),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/rest/v1/`, {
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
});
const spec = await res.json();
const schemas = spec.definitions || {};

console.log(`=== TABEL LIVE (${Object.keys(schemas).length}) ===`);
for (const [t, def] of Object.entries(schemas).sort()) {
  console.log(`\n[${t}]`);
  console.log("  " + Object.keys(def.properties || {}).join(", "));
}

console.log(`\n=== RPC LIVE ===`);
console.log(
  Object.keys(spec.paths || {})
    .filter((p) => p.startsWith("/rpc/"))
    .map((p) => p.slice(5))
    .sort()
    .join("\n"),
);
