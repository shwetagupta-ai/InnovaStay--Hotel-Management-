'use strict';
/**
 * Minimal QR Code generator (byte mode, error-correction level M, versions 1-10) -> SVG string.
 * Written for InnovaStay so the project needs no npm packages. Algorithm follows the QR spec (ISO/IEC 18004).
 */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

function rawModules(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; if (v >= 7) r -= 36; }
  return r;
}
// GF(256) arithmetic for Reed-Solomon
const EXP = new Array(512), LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsDivisor(deg) {
  let r = [1];
  for (let i = 0; i < deg; i++) { const n = new Array(r.length + 1).fill(0); r.forEach((c, j) => { n[j] ^= c; n[j + 1] ^= gmul(c, EXP[i]); }); r = n; }
  return r.slice(1);
}
function rsRemainder(data, div) {
  const res = new Array(div.length).fill(0);
  for (const b of data) { const f = b ^ res.shift(); res.push(0); div.forEach((c, i) => (res[i] ^= gmul(c, f))); }
  return res;
}
function alignPositions(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, size = v * 4 + 17;
  const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6]; for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
  return r;
}

function encode(text) {
  const bytes = [...Buffer.from(text, 'utf8')];
  let ver = 1;
  for (; ver <= 10; ver++) {
    const cap = Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
    if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break;
  }
  if (ver > 10) throw new Error('QR text too long');
  const dataCw = Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, dataCw * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < dataCw * 8; pad ^= 0xec ^ 0x11) put(pad, 8);
  const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  // split in blocks, add ECC, interleave
  const nb = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver], rawCw = Math.floor(rawModules(ver) / 8);
  const shortLen = Math.floor(rawCw / nb), nShort = nb - (rawCw % nb), div = rsDivisor(eccLen);
  const blocks = []; let k = 0;
  for (let i = 0; i < nb; i++) {
    const len = shortLen - eccLen + (i < nShort ? 0 : 1);
    const d = cw.slice(k, k + len); k += len;
    blocks.push({ d, e: rsRemainder(d, div) });
  }
  const out = [];
  for (let i = 0; i < shortLen - eccLen + 1; i++) blocks.forEach((b) => { if (i < b.d.length) out.push(b.d[i]); });
  for (let i = 0; i < eccLen; i++) blocks.forEach((b) => out.push(b.e[i]));
  return { ver, out };
}

function toMatrix(text) {
  const { ver, out } = encode(text), size = ver * 4 + 17;
  const best = { score: Infinity, m: null };
  for (let mask = 0; mask < 8; mask++) {
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < size && y < size) { m[y][x] = v; fn[y][x] = true; } };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
    const ap = alignPositions(ver);
    ap.forEach((ax, i) => ap.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    // format bits (ECC M = 00)
    const data = (0 << 3) | mask; let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fb = ((data << 10) | rem) ^ 0x5412, bit = (i) => ((fb >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const vb = (ver << 12) | r;
      for (let i = 0; i < 18; i++) { const b = ((vb >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, b); set(c, a, b); }
    }
    // zig-zag data placement
    let idx = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - v : v;
        if (fn[y][x]) continue;
        let dark = idx < out.length * 8 ? ((out[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0 : false; idx++;
        const inv = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask];
        m[y][x] = dark !== inv;
      }
    }
    // penalty (rules 1 & 4 – enough to pick a well-balanced mask)
    let score = 0;
    for (let a = 0; a < size; a++) for (const horiz of [true, false]) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = horiz ? m[a][b] : m[b][a], prev = horiz ? m[a][b - 1] : m[b - 1][a];
        if (cur === prev) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
      }
    }
    const dark = m.flat().filter(Boolean).length; score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    if (score < best.score) { best.score = score; best.m = m; }
  }
  return best.m;
}

function toSvg(text, px = 5, border = 3) {
  const m = toMatrix(text), n = m.length, dim = (n + border * 2) * px;
  let d = '';
  m.forEach((row, y) => row.forEach((v, x) => { if (v) d += `M${(x + border) * px},${(y + border) * px}h${px}v${px}h-${px}z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0b2a5b"/></svg>`;
}
module.exports = { toSvg, toMatrix };
