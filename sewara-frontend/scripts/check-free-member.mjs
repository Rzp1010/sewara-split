import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hitungDiskonMurni } from "../src/lib/booking/diskon.js";

const gratis = hitungDiskonMurni(250000, {
  member: { status: "aktif", diskon_persen: 100 },
  aturanDiskon: { stack: "terbesar", maksPersen: 100 },
});
assert.equal(gratis.biayaAkhir, 0);
assert.equal(gratis.totalDiskon, 250000);
const utils = await readFile(new URL("../src/lib/utils.js", import.meta.url), "utf8");
assert.match(utils, /if \(total <= 0 \|\| dibayar >= total\) status = "Lunas";/);
assert.match(utils, /label: total <= 0 \? "Gratis" : status/);

const dibatasi = hitungDiskonMurni(250000, {
  member: { status: "aktif", diskon_persen: 100 },
  aturanDiskon: { stack: "terbesar", maksPersen: 50 },
});
assert.equal(dibatasi.biayaAkhir, 125000);
console.log("PASS: member 100%, cap setting, dan pembayaran total nol");
