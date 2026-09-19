// Dev server wrapper — menampilkan SEMUA network URL (Tailscale + Wi-Fi/LAN)
// Next.js native hanya menampilkan 1 "Network:" — script ini menambahkan daftar lengkap
// setelah banner "Ready" muncul, tanpa mengubah perilaku `next dev` sama sekali.
const { spawn } = require("child_process");
const os = require("os");

const PORT = process.env.PORT || "3000";

// Kumpulkan IP IPv4 non-internal yang layak dipakai device lain.
// - Skip link-local/APIPA (169.254.x / fe80::) KECUALI interface Tailscale
// - Skip virtual adapter noise (vEthernet, Local Area Connection* dummy)
// - Prioritaskan: Tailscale (jika ada) + Wi-Fi/LAN real
function listNetworkUrls() {
  const results = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      const ip = iface.address;
      if (ip.startsWith("169.254.") && name.toLowerCase() !== "tailscale") continue;
      if (/^(vethernet|docker|virtualbox|vmware)/i.test(name)) continue;
      results.push({ name, url: `http://${ip}:${PORT}` });
    }
  }
  return results.sort((a, b) =>
    (a.name.toLowerCase() === "tailscale" ? 0 : 1) - (b.name.toLowerCase() === "tailscale" ? 0 : 1)
  );
}

const child = spawn("next", ["dev"], {
  shell: true,
  stdio: "inherit",
});

child.on("spawn", () => {
  // Banner Next.js biasanya muncul < 5 detik; tampilkan daftar setelahnya biar rapi.
  setTimeout(() => {
    const nets = listNetworkUrls();
    if (nets.length === 0) return;
    console.log("");
    console.log("  Network dari semua adapter:");
    nets.forEach(({ name, url }) => console.log(`  - ${name}: ${url}`));
    console.log("");
  }, 5000);
});

child.on("exit", (code) => process.exit(code ?? 0));