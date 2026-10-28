// audit-endpoints.js â€” telusuri 74 endpoint backend Next terhadap pemakaian di frontend.
//
// Rantai: halaman/komponen -> fungsi db.js -> metode api-client -> endpoint.
// Status:
//   DIPAKAI              dirujuk dari file selain lib/db.js (halaman/komponen)
//   DIPAKAI (via db.js)  hanya lewat fungsi db.js yang juga dipanggil di luar db.js
//   DIPAKAI (URL langsung) path literal dipakai di luar api-client (img/fetch/link)
//   WRAPPER MATI         api-client dipanggil db.js, tapi fungsi pembungkusnya tidak dipakai
//   TIDAK ADA RUJUKAN    tidak ada jejak sama sekali di frontend
//
// Endpoint webhook dipanggil pihak eksternal, bukan frontend; skrip menandainya
// terpisah supaya tidak salah dibaca sebagai "boleh dibuang".

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const BE = path.join(ROOT, 'sewara-backend/app/api');
const FE = path.join(ROOT, 'sewara-frontend/src');
const MATRIX = path.join(ROOT, 'docs/endpoint-matrix.md');

const norm = (p) => p.replace(/\\/g, '/');

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

// ---------- 1. endpoint dari route.ts ----------
const endpoints = [];
for (const f of walk(BE, ['route.ts'])) {
  let rel = norm(path.relative(BE, f)).replace(/\/route\.ts$/, '');
  rel = rel.replace(/\[([^\]]+)\]/g, ':$1');
  const src = fs.readFileSync(f, 'utf8');
  const methods = [...src.matchAll(/export (?:const|async function)\s+(GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
  endpoints.push({
    url: '/api' + (rel ? '/' + rel : ''),
    methods: [...new Set(methods)],
    lines: src.split(/\r?\n/).length,
  });
}

// ---------- 2. kategori dari endpoint-matrix.md ----------
const kategori = new Map();
if (fs.existsSync(MATRIX)) {
  for (const line of fs.readFileSync(MATRIX, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\/api[^|]*?)\s*\|\s*([A-Z, ]+?)\s*\|\s*([A-Z]+)\s*\|/);
    if (m) kategori.set(m[1].trim(), m[3]);
  }
}

// ---------- 3. frontend ----------
const feFiles = walk(FE, ['.js', '.jsx']);
const feText = new Map(feFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const clientPath = feFiles.find((f) => f.endsWith('api-client.js'));
const dbPath = feFiles.find((f) => norm(f).endsWith('/lib/db.js'));
if (!clientPath || !dbPath) throw new Error('api-client.js atau lib/db.js tidak ditemukan');

// ---------- 4. api-client -> daftar panggilan ----------
const clientLines = feText.get(clientPath).split(/\r?\n/);
const apiDefs = [];
const objStack = [{ indent: -1, key: 'api' }];

function pathDariBaris(line) {
  const call = line.match(/apiRequest\(\s*(['"`])([^'"`]+)\1/);
  if (call) {
    const raw = call[2];
    const tanpaTemplate = raw.replace(/\$\{.*$/, '');
    const pathParam = /\$\{/.test(raw) && tanpaTemplate.endsWith('/');
    return pathParam ? tanpaTemplate + 'X' : tanpaTemplate;
  }
  const base = line.match(/`\$\{API_BASE\}([^`]*)`/);
  if (base) return base[1].split('?')[0];
  return null;
}

// metodeDariBaris mencari `method: 'X'` HANYA di dalam pernyataan milik properti
// ini. Dua jebakan:
//   1. menyeberang ke properti berikutnya (mis. `getAll` terbaca POST karena
//      `create` di bawahnya);
//   2. berhenti tepat di baris `method: 'POST'` karena bentuknya mirip properti.
// Aturannya: baris mirip-properti hanya menghentikan pencarian kalau indentasinya
// tidak lebih dalam dari properti itu sendiri. Baris opsi (`method`, `body`)
// selalu lebih dalam, jadi tetap terbaca.
function metodeDariBaris(lines, idx, kunciIndent) {
  const same = lines[idx].match(/method:\s*'([A-Z]+)'/);
  if (same) return same[1];

  for (let j = idx + 1; j < Math.min(idx + 10, lines.length); j++) {
    const l = lines[j];
    const ind = l.match(/^(\s*)/)[1].length;
    if (/^\s*[A-Za-z_$][\w$]*\s*:/.test(l) && ind <= kunciIndent) break; // properti baru
    const m = l.match(/method:\s*'([A-Z]+)'/);
    if (m) return m[1];
    if (/^\s*\},?\s*$/.test(l)) break; // objek ditutup
  }
  return 'GET';
}

let propSekarang = null;

for (let i = 0; i < clientLines.length; i++) {
  const line = clientLines[i];
  const indent = line.match(/^(\s*)/)[1].length;

  const objM = line.match(/^(\s*)([A-Za-z_$][\w$]*)\s*:\s*\{\s*$/);
  if (objM) {
    const ind = objM[1].length;
    while (objStack.length && objStack[objStack.length - 1].indent >= ind) objStack.pop();
    objStack.push({ indent: ind, key: objM[2] });
    propSekarang = null;
    continue;
  }

  const propM = line.match(/^(\s*)([A-Za-z_$][\w$]*)\s*:/);
  if (propM) propSekarang = { indent: propM[1].length, key: propM[2] };

  const url = pathDariBaris(line);
  if (!url) continue;

  // Kunci metode: di baris yang sama kalau ada, kalau tidak properti terakhir
  // (pola `nama: (x) =>` lalu `apiRequest(...)` di baris berikutnya).
  const kunci = propM ? propM[2] : propSekarang?.key;
  const kunciIndent = propM ? propM[1].length : propSekarang?.indent ?? indent;
  if (!kunci) continue;

  const parents = objStack.filter((s) => s.indent < kunciIndent).map((s) => s.key);
  apiDefs.push({
    callName: [...parents, kunci].join('.'),
    url,
    method: metodeDariBaris(clientLines, i, kunciIndent),
    line: i + 1,
  });
}

const urlRegex = (u) => new RegExp('^' + u.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/') + '$');

// db.js memanggil sebagian endpoint lewat apiRequest langsung, tanpa api-client.
// Kalau tidak dihitung, endpoint itu akan tampak "tidak ada rujukan".
const dbDirectDefs = [];

const defsUntuk = (ep) => {
  const re = urlRegex(ep.url);
  const cocok = (d) => re.test(d.url) && ep.methods.includes(d.method);
  return [...apiDefs.filter(cocok), ...dbDirectDefs.filter(cocok)];
};

// ---------- 5. pemakaian ----------
function enclosingFunction(lines, idx) {
  for (let j = idx; j >= 0; j--) {
    const m = lines[j].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) return m[1];
  }
  return null;
}

function rujukanString(teks, kecuali) {
  const hasil = [];
  for (const [f, isi] of feText) if (f !== kecuali && isi.includes(teks)) hasil.push(f);
  return hasil;
}

function rujukanIdentifier(nama, kecuali) {
  const re = new RegExp('\\b' + nama.replace(/\$/g, '\\$') + '\\b');
  const hasil = [];
  for (const [f, isi] of feText) {
    if (f === kecuali || f === dbPath || f === clientPath) continue;
    if (re.test(isi)) hasil.push(f);
  }
  return hasil;
}

const dbLines = feText.get(dbPath).split(/\r?\n/);

for (let i = 0; i < dbLines.length; i++) {
  if (!dbLines[i].includes('apiRequest(')) continue;
  const url = pathDariBaris(dbLines[i]) || pathDariBaris(dbLines[i + 1] || '');
  if (!url) continue;
  dbDirectDefs.push({
    fn: enclosingFunction(dbLines, i),
    url,
    method: metodeDariBaris(dbLines, i, dbLines[i].match(/^(\s*)/)[1].length),
    line: i + 1,
  });
}

// Ikuti rantai di dalam db.js: fungsi pembungkus bisa memanggil fungsi lain di
// file yang sama, dan yang terakhir itulah yang dipakai halaman.
function dipakaiDiLuarDb(fn, visited = new Set()) {
  if (!fn || visited.has(fn)) return [];
  visited.add(fn);
  const luar = rujukanIdentifier(fn, dbPath);
  if (luar.length > 0) return luar;

  for (let j = 0; j < dbLines.length; j++) {
    if (!new RegExp('\\b' + fn + '\\b').test(dbLines[j])) continue;
    const induk = enclosingFunction(dbLines, j);
    if (induk && induk !== fn) {
      const hasil = dipakaiDiLuarDb(induk, visited);
      if (hasil.length > 0) return hasil;
    }
  }
  return [];
}

const hasil = [];
for (const ep of endpoints) {
  const defs = defsUntuk(ep);
  const bukti = new Set();
  const catatan = [];
  let status = 'TIDAK ADA RUJUKAN';

  for (const d of defs) {
    // Panggilan langsung dari db.js: tidak ada nama api-client, cukup nama fungsi.
    if (d.fn) {
      const pemakai = dipakaiDiLuarDb(d.fn);
      if (pemakai.length > 0) {
        if (status !== 'DIPAKAI') status = 'DIPAKAI (via db.js)';
        pemakai.forEach((f) => bukti.add(norm(path.relative(FE, f))));
      } else {
        if (status === 'TIDAK ADA RUJUKAN') status = 'WRAPPER MATI';
        catatan.push(`db.js:${d.fn}() tidak dipanggil siapa pun`);
      }
      continue;
    }

    const rujukan = rujukanString(d.callName, clientPath);
    if (rujukan.length === 0) {
      catatan.push(`${d.callName} hanya didefinisikan`);
      continue;
    }

    const langsung = rujukan.filter((f) => f !== dbPath);
    if (langsung.length > 0) {
      status = 'DIPAKAI';
      langsung.forEach((f) => bukti.add(norm(path.relative(FE, f))));
      continue;
    }

    const idx = dbLines.findIndex((l) => l.includes(d.callName));
    const fn = idx >= 0 ? enclosingFunction(dbLines, idx) : null;
    const pemakai = dipakaiDiLuarDb(fn);
    if (pemakai.length > 0) {
      if (status !== 'DIPAKAI') status = 'DIPAKAI (via db.js)';
      pemakai.forEach((f) => bukti.add(norm(path.relative(FE, f))));
    } else {
      if (status === 'TIDAK ADA RUJUKAN') status = 'WRAPPER MATI';
      catatan.push(`db.js:${fn}() tidak dipanggil siapa pun`);
    }
  }

  // Path literal di luar api-client: fetch manual, <img src>, link unduh, atau
  // pembangun URL di db.js. Kalau yang memuat hanya db.js, fungsi pembungkusnya
  // tetap harus dipakai â€” kalau tidak, ini bukan "dipakai", hanya sisa kode.
  for (const f of rujukanString(ep.url, clientPath)) {
    if (f === dbPath) {
      const idxL = dbLines.findIndex((l) => l.includes(ep.url));
      const fnL = idxL >= 0 ? enclosingFunction(dbLines, idxL) : null;
      const pemakaiL = dipakaiDiLuarDb(fnL);
      if (pemakaiL.length === 0) {
        catatan.push(`db.js:${fnL}() memuat URL tapi tidak dipanggil`);
        continue;
      }
      if (status === 'TIDAK ADA RUJUKAN' || status === 'WRAPPER MATI') status = 'DIPAKAI (via db.js)';
      pemakaiL.forEach((x) => bukti.add(norm(path.relative(FE, x)) + ' [url]'));
      continue;
    }
    if (status === 'TIDAK ADA RUJUKAN') status = 'DIPAKAI (URL langsung)';
    bukti.add(norm(path.relative(FE, f)) + ' [url]');
  }

  hasil.push({
    url: ep.url,
    methods: ep.methods.join(','),
    kategori: kategori.get(ep.url) || '?',
    status,
    bukti: [...bukti].slice(0, 3).join(', '),
    catatan: [...new Set(catatan)].join('; '),
  });
}

const urutan = { 'DIPAKAI': 0, 'DIPAKAI (via db.js)': 1, 'DIPAKAI (URL langsung)': 2, 'WRAPPER MATI': 3, 'TIDAK ADA RUJUKAN': 4 };
hasil.sort((a, b) => urutan[a.status] - urutan[b.status] || a.url.localeCompare(b.url));

const ringkas = {};
for (const h of hasil) ringkas[h.status] = (ringkas[h.status] || 0) + 1;

console.log('TOTAL:', hasil.length, '| method:', hasil.reduce((n, h) => n + (h.methods ? h.methods.split(',').length : 0), 0));
console.log('RINGKASAN:', JSON.stringify(ringkas));
console.log('');
for (const h of hasil) {
  console.log([h.status.padEnd(24), h.methods.padEnd(22), h.kategori.padEnd(9), h.url.padEnd(40), h.bukti, h.catatan].join(' | '));
}

fs.writeFileSync(path.join(require('os').tmpdir(), 'audit-endpoint-usage.json'), JSON.stringify(hasil, null, 2));

if (process.env.DEBUG_DEFS) {
  console.log('\n--- apiDefs (' + apiDefs.length + ') ---');
  for (const d of apiDefs) console.log(`${d.line}\t${d.method}\t${d.url}\t${d.callName}`);
}

