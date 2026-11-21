// Big Steal Car — every texture in the game is painted here on HTML5 canvases (no image files).
import * as THREE from 'three';
import { rng } from './util.js';

let ANISO = 8;
export function setAnisotropy(a) { ANISO = a; }

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { repeat = true, color = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = ANISO; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true; return t;
}

// ---------- tileable value noise ----------
function makeNoise(n, seed) {
  const r = rng(seed); const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x, y) => g[((y % n + n) % n) * n + ((x % n + n) % n)];
  return (x, y) => { // x,y in lattice units, wraps every n
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(noise, x, y, oct, base) { let s = 0, a = 0.5, f = 1, t = 0; for (let o = 0; o < oct; o++) { s += a * noise(x * f, y * f); t += a; a *= 0.5; f *= 2; } return s / t; }

// height field -> tangent-space normal map
function normalFromHeight(h, w, hgt, strength) {
  const [c, x] = cv(w, hgt); const img = x.createImageData(w, hgt); const d = img.data;
  for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
    const l = h[j * w + ((i - 1 + w) % w)], r = h[j * w + ((i + 1) % w)];
    const u = h[((j - 1 + hgt) % hgt) * w + i], dn = h[((j + 1) % hgt) * w + i];
    let nx = (l - r) * strength, ny = (u - dn) * strength, nz = 1; const len = Math.hypot(nx, ny, nz);
    const k = (j * w + i) * 4; d[k] = (nx / len * 0.5 + 0.5) * 255; d[k + 1] = (ny / len * 0.5 + 0.5) * 255; d[k + 2] = (nz / len * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  x.putImageData(img, 0, 0); return tex(c, { color: false });
}

// ---------- ground ----------
export function asphalt() {
  const N = 512, nz = makeNoise(64, 11), nz2 = makeNoise(16, 12);
  const [c, x] = cv(N, N); const img = x.createImageData(N, N); const d = img.data; const h = new Float32Array(N * N);
  const [rc, rx] = cv(N, N); const rimg = rx.createImageData(N, N); const rd = rimg.data;
  const r = rng(5);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const fine = r(); const mid = fbm(nz, i / 8, j / 8, 3); const big = nz2(i / 32, j / 32);
    let v = 52 + mid * 22 + (fine - 0.5) * 26 - big * 10;
    if (fine > 0.985) v += 40; // light aggregate
    const k = (j * N + i) * 4; d[k] = v * 0.98; d[k + 1] = v; d[k + 2] = v * 1.04; d[k + 3] = 255;
    h[j * N + i] = fine * 0.6 + mid;
    const rough = 200 + (fine - 0.5) * 40 - big * 50; rd[k] = 0; rd[k + 1] = rough; rd[k + 2] = 0; rd[k + 3] = 255;
  }
  x.putImageData(img, 0, 0); rx.putImageData(rimg, 0, 0);
  // tar seams + cracks
  x.strokeStyle = 'rgba(15,15,17,0.55)'; x.lineWidth = 2;
  for (let k = 0; k < 7; k++) { x.beginPath(); let px = r() * N, py = r() * N; x.moveTo(px, py); for (let s = 0; s < 9; s++) { px += (r() - 0.5) * 60; py += (r() - 0.5) * 60; x.lineTo(px, py); } x.stroke(); }
  x.fillStyle = 'rgba(20,20,22,0.18)'; for (let k = 0; k < 6; k++) { x.beginPath(); x.ellipse(r() * N, r() * N, 20 + r() * 50, 12 + r() * 30, r() * 3, 0, 7); x.fill(); }
  return { map: tex(c), normalMap: normalFromHeight(h, N, N, 1.6), roughnessMap: tex(rc, { color: false }) };
}

export function concrete(slabs = 2, tone = 150) {
  const N = 512, nz = makeNoise(32, 21); const r = rng(22);
  const [c, x] = cv(N, N); const img = x.createImageData(N, N); const d = img.data; const h = new Float32Array(N * N);
  const step = N / slabs;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const n = fbm(nz, i / 16, j / 16, 4); let v = tone + (n - 0.5) * 34 + (r() - 0.5) * 14;
    const jx = i % step, jy = j % step; const joint = jx < 3 || jy < 3;
    if (joint) v -= 45;
    const k = (j * N + i) * 4; d[k] = v; d[k + 1] = v * 0.99; d[k + 2] = v * 0.96; d[k + 3] = 255;
    h[j * N + i] = joint ? 0 : 0.5 + n * 0.3;
  }
  x.putImageData(img, 0, 0);
  x.fillStyle = 'rgba(60,55,50,0.10)'; for (let k = 0; k < 14; k++) { x.beginPath(); x.ellipse(r() * N, r() * N, 8 + r() * 40, 6 + r() * 26, r() * 3, 0, 7); x.fill(); }
  return { map: tex(c), normalMap: normalFromHeight(h, N, N, 2.2) };
}

export function grass() {
  const N = 512, nz = makeNoise(32, 31); const r = rng(32);
  const [c, x] = cv(N, N); const img = x.createImageData(N, N); const d = img.data; const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const n = fbm(nz, i / 12, j / 12, 4); const f = r();
    const k = (j * N + i) * 4; d[k] = 52 + n * 40 + f * 22; d[k + 1] = 96 + n * 58 + f * 30; d[k + 2] = 34 + n * 20 + f * 10; d[k + 3] = 255;
    h[j * N + i] = f * 0.7 + n;
  }
  x.putImageData(img, 0, 0);
  for (let k = 0; k < 2600; k++) { x.strokeStyle = `rgba(${120 + r() * 60},${160 + r() * 60},${70 + r() * 30},0.35)`; x.lineWidth = 1; const px = r() * N, py = r() * N; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 4, py - 4 - r() * 6); x.stroke(); }
  return { map: tex(c), normalMap: normalFromHeight(h, N, N, 1.2) };
}

export function gravel() {
  const N = 256; const r = rng(41); const [c, x] = cv(N, N); const img = x.createImageData(N, N); const d = img.data;
  for (let i = 0; i < N * N; i++) { const v = 95 + r() * 60; d[i * 4] = v; d[i * 4 + 1] = v * 0.98; d[i * 4 + 2] = v * 0.94; d[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0); return tex(c);
}

export function sand() {
  const N = 256; const r = rng(42); const nz = makeNoise(16, 43); const [c, x] = cv(N, N); const img = x.createImageData(N, N); const d = img.data;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const n = fbm(nz, i / 16, j / 16, 3); const v = 190 + n * 40 + r() * 20; const k = (j * N + i) * 4; d[k] = v; d[k + 1] = v * 0.9; d[k + 2] = v * 0.7; d[k + 3] = 255; }
  x.putImageData(img, 0, 0); return tex(c);
}

// ---------- building facades ----------
// Every style returns map / emissiveMap / rm (G = roughness, B = metalness) plus the world size of one tile.
const LIT = ['#ffd9a0', '#ffe8c2', '#fff1d6', '#cfe3ff', '#ffc98a', '#e8f0ff'];
function litWindow(e, r, x0, y0, w, h) {
  if (!r.chance(0.36)) return;
  const col = r.pick(LIT); const g = e.createLinearGradient(0, y0, 0, y0 + h);
  g.addColorStop(0, col); g.addColorStop(1, shade(col, 0.55)); e.fillStyle = g; e.fillRect(x0, y0, w, h);
  if (r.chance(0.35)) { e.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = y0 + 2; y < y0 + h; y += 5) e.fillRect(x0, y, w, 2); } // blinds
  if (r.chance(0.3)) { e.fillStyle = 'rgba(0,0,0,0.5)'; e.fillRect(x0 + w * r(), y0 + h * 0.4, w * 0.2, h * 0.6); } // silhouette of furniture
}
function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const r = ((n >> 16) & 255) * k, g = ((n >> 8) & 255) * k, b = (n & 255) * k; return `rgb(${r | 0},${g | 0},${b | 0})`; }
function rmFill(x, rough, metal) { x.fillStyle = `rgb(0,${Math.round(rough * 255)},${Math.round(metal * 255)})`; }

export function facade(style, seed = 1) {
  const N = 512; const r = rng(seed * 97 + style.length * 13);
  const [c, x] = cv(N, N), [ec, e] = cv(N, N), [mc, m] = cv(N, N);
  e.fillStyle = '#000'; e.fillRect(0, 0, N, N);
  let tileW = 12, tileH = 14.4;
  const nz = makeNoise(32, seed + 3);
  const grime = () => { // vertical streaks + noise
    const img = x.getImageData(0, 0, N, N); const d = img.data;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = (j * N + i) * 4; const n = (fbm(nz, i / 20, j / 40, 3) - 0.5) * 26; d[k] += n; d[k + 1] += n; d[k + 2] += n; }
    x.putImageData(img, 0, 0);
  };
  if (style === 'glass' || style === 'teal') {
    const cols = 4, rows = 4, bw = N / cols, fh = N / rows;
    const top = style === 'teal' ? '#3f7f86' : '#4b6c8c', bot = style === 'teal' ? '#1e4a50' : '#1c3047';
    for (let fy = 0; fy < rows; fy++) for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * bw, y0 = fy * fh;
      const g = x.createLinearGradient(0, y0, 0, y0 + fh); g.addColorStop(0, top); g.addColorStop(1, bot); x.fillStyle = g; x.fillRect(x0, y0, bw, fh);
      x.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.06})`; x.fillRect(x0, y0, bw, fh);
      rmFill(m, 0.06, 0.92); m.fillRect(x0, y0, bw, fh);
      litWindow(e, r, x0 + 4, y0 + 4, bw - 8, fh - 22);
    }
    x.fillStyle = style === 'teal' ? '#20343a' : '#222a35'; rmFill(m, 0.5, 0.3);
    for (let fy = 0; fy < rows; fy++) { x.fillRect(0, fy * fh + fh - 18, N, 18); m.fillRect(0, fy * fh + fh - 18, N, 18); }
    x.fillStyle = '#9aa4ae'; rmFill(m, 0.35, 0.9);
    for (let bx = 0; bx <= cols; bx++) { x.fillRect(bx * bw - 3, 0, 6, N); m.fillRect(bx * bw - 3, 0, 6, N); }
    for (let bx = 0; bx < cols; bx++) { x.fillStyle = 'rgba(160,170,180,0.6)'; x.fillRect(bx * bw + bw / 2 - 1, 0, 2, N); }
    tileW = 12; tileH = 14.4;
  } else if (style === 'office') {
    x.fillStyle = '#cdbfa6'; x.fillRect(0, 0, N, N); grime(); rmFill(m, 0.85, 0); m.fillRect(0, 0, N, N);
    const cols = 4, rows = 4, bw = N / cols, fh = N / rows;
    for (let fy = 0; fy < rows; fy++) for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * bw + 22, y0 = fy * fh + 26, w = bw - 44, h = fh - 54;
      x.fillStyle = '#efe9dd'; x.fillRect(x0 - 5, y0 - 5, w + 10, h + 10);
      const g = x.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, '#41566a'); g.addColorStop(1, '#1d2731'); x.fillStyle = g; x.fillRect(x0, y0, w, h);
      x.fillStyle = '#efe9dd'; x.fillRect(x0 + w / 2 - 2, y0, 4, h); x.fillStyle = '#b5a68c'; x.fillRect(x0 - 8, y0 + h + 5, w + 16, 7);
      rmFill(m, 0.08, 0.7); m.fillRect(x0, y0, w, h);
      litWindow(e, r, x0, y0, w, h);
    }
    tileW = 12; tileH = 14;
  } else if (style === 'brick') {
    x.fillStyle = '#6f5a50'; x.fillRect(0, 0, N, N);
    for (let y = 0, row = 0; y < N; y += 12, row++) for (let bx = (row % 2) * -16; bx < N; bx += 32) {
      const v = r(); x.fillStyle = `rgb(${118 + v * 50},${50 + v * 22},${38 + v * 16})`; x.fillRect(bx + 1, y + 1, 30, 10);
    }
    grime(); rmFill(m, 0.92, 0); m.fillRect(0, 0, N, N);
    const cols = 4, rows = 4, bw = N / cols, fh = N / rows;
    for (let fy = 0; fy < rows; fy++) for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * bw + 34, y0 = fy * fh + 24, w = bw - 68, h = fh - 50;
      x.fillStyle = '#8c7f76'; x.fillRect(x0 - 6, y0 - 12, w + 12, 8); // lintel
      x.fillStyle = '#ece6dc'; x.fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
      x.fillStyle = '#1e2329'; x.fillRect(x0, y0, w, h); x.fillStyle = '#ece6dc'; x.fillRect(x0, y0 + h * 0.5 - 2, w, 4); x.fillRect(x0 + w / 2 - 2, y0, 4, h);
      x.fillStyle = '#9a8d82'; x.fillRect(x0 - 8, y0 + h + 4, w + 16, 6);
      rmFill(m, 0.1, 0.6); m.fillRect(x0, y0, w, h);
      litWindow(e, r, x0, y0, w, h);
    }
    tileW = 12; tileH = 12.8;
  } else if (style === 'dark') {
    x.fillStyle = '#2b2e34'; x.fillRect(0, 0, N, N); grime(); rmFill(m, 0.55, 0.4); m.fillRect(0, 0, N, N);
    const rows = 4, fh = N / rows;
    for (let fy = 0; fy < rows; fy++) {
      const y0 = fy * fh + 30, h = fh - 52;
      const g = x.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, '#3a4a5c'); g.addColorStop(1, '#141b24'); x.fillStyle = g; x.fillRect(0, y0, N, h);
      rmFill(m, 0.05, 0.9); m.fillRect(0, y0, N, h);
      x.fillStyle = '#4c525b'; for (let bx = 0; bx < N; bx += 64) x.fillRect(bx, y0, 3, h);
      for (let bx = 0; bx < N; bx += 64) litWindow(e, r, bx + 4, y0 + 2, 58, h - 4);
      x.fillStyle = '#3d4249'; x.fillRect(0, y0 - 8, N, 4);
    }
    tileW = 14; tileH = 14;
  } else if (style === 'stucco') {
    x.fillStyle = '#ebe6dc'; x.fillRect(0, 0, N, N); grime(); rmFill(m, 0.9, 0); m.fillRect(0, 0, N, N);
    const cols = 4, rows = 4, bw = N / cols, fh = N / rows;
    for (let fy = 0; fy < rows; fy++) for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * bw + 30, y0 = fy * fh + 28, w = bw - 60, h = fh - 56;
      x.fillStyle = '#ffffff'; x.fillRect(x0 - 5, y0 - 5, w + 10, h + 10);
      x.fillStyle = '#26303a'; x.fillRect(x0, y0, w, h); x.fillStyle = '#fff'; x.fillRect(x0 + w / 2 - 2, y0, 4, h);
      if (r.chance(0.5)) { x.fillStyle = '#5c6b73'; x.fillRect(x0 - 16, y0 - 4, 10, h + 8); x.fillRect(x0 + w + 6, y0 - 4, 10, h + 8); } // shutters
      if (r.chance(0.25)) { x.fillStyle = '#9aa0a6'; x.fillRect(x0 + w - 18, y0 + h + 8, 26, 16); } // AC unit
      rmFill(m, 0.1, 0.5); m.fillRect(x0, y0, w, h);
      litWindow(e, r, x0, y0, w, h);
    }
    tileW = 12; tileH = 12;
  } else if (style === 'warehouse') {
    for (let i = 0; i < N; i += 8) { x.fillStyle = (i / 8) % 2 ? '#8b939c' : '#a5adb5'; x.fillRect(i, 0, 8, N); }
    grime(); rmFill(m, 0.5, 0.65); m.fillRect(0, 0, N, N);
    x.fillStyle = 'rgba(120,70,30,0.18)'; for (let k = 0; k < 14; k++) x.fillRect(r() * N, r() * N * 0.5, 3 + r() * 6, 60 + r() * 160);
    for (let bx = 0; bx < N; bx += 128) { x.fillStyle = '#2a3036'; x.fillRect(bx + 20, 40, 88, 36); rmFill(m, 0.1, 0.5); m.fillRect(bx + 20, 40, 88, 36); if (r.chance(0.5)) { e.fillStyle = '#ffdca0'; e.fillRect(bx + 20, 40, 88, 36); } }
    x.fillStyle = '#5a6168'; x.fillRect(0, 0, N, 10);
    tileW = 16; tileH = 16;
  }
  return { map: tex(c), emissiveMap: tex(ec), rm: tex(mc, { color: false }), tileW, tileH };
}

// ground-floor shopfront band (one tile = 12 m x 4.5 m)
const SHOPS = [
  ['NOODLE KING', '#c1121f', '#fff'], ['FRESHMART', '#2a9d8f', '#fff'], ['CAFE BREW', '#5e3023', '#f3e9dc'], ['AUTO PARTS', '#1d3557', '#ffd166'],
  ['PIZZA SLICE', '#e76f51', '#fff'], ['PHONE HUT', '#3a0ca3', '#fff'], ['BOOKS', '#264653', '#e9c46a'], ['DONUT HOLE', '#ff70a6', '#fff'],
  ['TACO TIME', '#f4a261', '#3d1f0f'], ['GYM 24', '#111', '#ff4d6d'], ['LAUNDRY', '#48cae4', '#023047'], ['BANK', '#2b2d42', '#edf2f4'],
];
export function shopfront(seed) {
  const W = 512, H = 192; const r = rng(seed * 31 + 7); const shop = SHOPS[seed % SHOPS.length];
  const [c, x] = cv(W, H), [ec, e] = cv(W, H), [mc, m] = cv(W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  x.fillStyle = '#d7d2c8'; x.fillRect(0, 0, W, H); rmFill(m, 0.8, 0); m.fillRect(0, 0, W, H);
  // sign band
  x.fillStyle = shop[1]; x.fillRect(0, 8, W, 40); e.fillStyle = shop[1]; e.fillRect(0, 8, W, 40);
  x.font = 'bold 30px Arial Black, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = shop[2]; x.fillText(shop[0], W / 2, 29);
  e.font = x.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = shop[2]; e.fillText(shop[0], W / 2, 29);
  // windows + door
  for (let i = 0; i < 2; i++) {
    const x0 = 14 + i * 300, w = i ? 186 : 230;
    x.fillStyle = '#20272e'; x.fillRect(x0, 60, w, 118); rmFill(m, 0.05, 0.6); m.fillRect(x0, 60, w, 118);
    for (let k = 0; k < 6; k++) { x.fillStyle = `hsl(${r() * 360},50%,${35 + r() * 25}%)`; x.fillRect(x0 + 10 + r() * (w - 40), 120 + r() * 40, 18 + r() * 20, 20 + r() * 20); }
    const g = e.createLinearGradient(0, 60, 0, 178); g.addColorStop(0, '#ffe2b0'); g.addColorStop(1, '#a06a30'); e.fillStyle = g; e.fillRect(x0, 60, w, 118);
    x.fillStyle = '#8d9399'; x.fillRect(x0 - 3, 57, w + 6, 4); x.fillRect(x0 - 3, 176, w + 6, 4);
  }
  x.fillStyle = '#3b2f2a'; x.fillRect(250, 64, 50, 128); x.fillStyle = '#c8a24a'; x.fillRect(288, 124, 4, 14);
  return { map: tex(c), emissiveMap: tex(ec), rm: tex(mc, { color: false }), tileW: 12, tileH: 4.5 };
}

// ---------- signs / billboards ----------
export function label(text, { w = 512, h = 128, bg = '#1d3557', fg = '#fff', font = 'Anton, Impact, sans-serif', size = 80, border = null, icon = null } = {}) {
  const [c, x] = cv(w, h);
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  if (border) { x.strokeStyle = border; x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10); }
  x.fillStyle = fg; x.font = `${size}px ${font}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (icon === 'cross') { x.fillStyle = '#e63946'; x.fillRect(30, h / 2 - 14, 70, 28); x.fillRect(51, h / 2 - 35, 28, 70); x.fillStyle = fg; x.fillText(text, w / 2 + 40, h / 2 + 4); }
  else x.fillText(text, w / 2, h / 2 + 4);
  return tex(c, { repeat: false });
}

const ADS = [
  { t: 'MEGA COLA', s: 'TASTE THE FIZZ', a: '#d00000', b: '#370617', f: '#fff' },
  { t: 'ALTEKZ', s: 'STUDIOS · GAMES THAT SLAP', a: '#0b0b0b', b: '#3a3a3a', f: '#fff' },
  { t: 'ZENTRA R', s: '0-60 IN "YES"', a: '#ffbe0b', b: '#fb5607', f: '#1b1b1b' },
  { t: 'SLURP JUICE', s: '100% FRUIT-ISH', a: '#38b000', b: '#004b23', f: '#fff' },
  { t: 'BIG STEAL CAR', s: 'NOW SHOWING', a: '#7209b7', b: '#240046', f: '#ffd60a' },
  { t: 'SKY BANK', s: 'YOUR MONEY. UP HIGH.', a: '#0077b6', b: '#03045e', f: '#fff' },
  { t: 'NOODLE KING', s: 'SLURP RESPONSIBLY', a: '#e85d04', b: '#6a040f', f: '#fff' },
  { t: 'ROBO TAXI', s: 'NO DRIVER. NO PROBLEM.', a: '#4cc9f0', b: '#3a0ca3', f: '#fff' },
];
export const AD_COUNT = ADS.length;
export function billboard(i) {
  const ad = ADS[i % ADS.length]; const [c, x] = cv(1024, 384);
  const g = x.createLinearGradient(0, 0, 1024, 384); g.addColorStop(0, ad.a); g.addColorStop(1, ad.b); x.fillStyle = g; x.fillRect(0, 0, 1024, 384);
  x.fillStyle = 'rgba(255,255,255,0.08)'; for (let k = 0; k < 8; k++) { x.beginPath(); x.arc(150 * k, 384, 120 + k * 20, 0, 7); x.fill(); }
  x.fillStyle = ad.f; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '150px Anton, Impact, sans-serif'; x.fillText(ad.t, 512, 160);
  x.font = '50px Anton, Impact, sans-serif'; x.globalAlpha = 0.85; x.fillText(ad.s, 512, 300); x.globalAlpha = 1;
  const t = tex(c, { repeat: false }); return t;
}

// ---------- vehicles ----------
// Side panel detail map for the extruded body caps. u runs rear->front along L, v bottom->top along H.
export function carSide(type, livery) {
  const W = 1024, H = 320; const [c, x] = cv(W, H);
  const L = type.L, Ht = type.H, p = type.prof;
  const U = (z) => ((z + L / 2) / L) * W, Vp = (y) => H - (y / Ht) * H;
  const body = livery === 'police' ? '#16181c' : livery === 'taxi' ? '#f2b705' : '#ffffff';
  x.fillStyle = body; x.fillRect(0, 0, W, H);
  if (livery === 'police') { // white doors band
    x.fillStyle = '#f4f4f4'; x.fillRect(U(-1.25), Vp(p.beltH + 0.05), U(1.05) - U(-1.25), Vp(type.clear + 0.18) - Vp(p.beltH + 0.05));
    x.fillStyle = '#1d4ed8'; x.fillRect(U(-1.25), Vp(0.62), U(1.05) - U(-1.25), 10);
    x.fillStyle = '#16181c'; x.font = `bold ${Math.round(H * 0.15)}px Arial Black, Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('POLICE', (U(-1.25) + U(1.05)) / 2, Vp(0.78));
  }
  if (livery === 'taxi') {
    const y0 = Vp(0.72); for (let i = 0; i < 40; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#f2b705'; x.fillRect(U(-1.6) + i * 16, y0 + j * 12, 16, 12); }
    x.fillStyle = '#111'; x.font = `bold ${Math.round(H * 0.11)}px Arial Black, Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('TAXI', U(0.0), Vp(0.88));
  }
  // rocker / lower trim
  const lg = x.createLinearGradient(0, Vp(type.clear + 0.22), 0, H); lg.addColorStop(0, 'rgba(0,0,0,0.0)'); lg.addColorStop(0.35, 'rgba(0,0,0,0.55)'); lg.addColorStop(1, 'rgba(0,0,0,0.75)');
  x.fillStyle = lg; x.fillRect(0, Vp(type.clear + 0.22), W, H);
  // shoulder highlight line
  x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(0, Vp(p.beltH - 0.06), W, 3);
  x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, Vp(p.beltH - 0.09), W, 3);
  // door seams + handles
  x.strokeStyle = 'rgba(20,20,22,0.85)'; x.lineWidth = 3;
  const doors = type.key === 'van' || type.cargo ? [[p.ws - 0.05, p.ws - 1.15]] : type.L < 4.2 || type.cls === 'Sports' || type.cls === 'Super' || type.cls === 'Muscle' ? [[p.ws - 0.05, p.rr + 0.2]] : [[p.ws - 0.05, (p.ws + p.rr) / 2 + 0.05], [(p.ws + p.rr) / 2 + 0.05, p.rr - 0.05]];
  for (const [zf, zr] of doors) {
    x.beginPath(); x.moveTo(U(zf), Vp(p.beltH)); x.lineTo(U(zf + 0.05), Vp(type.clear + 0.14)); x.lineTo(U(zr), Vp(type.clear + 0.14)); x.lineTo(U(zr), Vp(p.beltH)); x.stroke();
    x.fillStyle = 'rgba(25,25,28,0.9)'; x.fillRect(U(zr) + 14, Vp(p.beltH - 0.12), 36, 9);
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(U(zr) + 14, Vp(p.beltH - 0.12), 36, 2);
  }
  // fuel flap
  x.strokeStyle = 'rgba(20,20,22,0.6)'; x.lineWidth = 2; x.strokeRect(U(p.rg + 0.15), Vp(p.beltH - 0.1), 26, 22);
  // side marker lights
  x.fillStyle = '#ff7b00'; x.fillRect(U(L / 2 - 0.25), Vp(type.prof.noseH - 0.12), 18, 8);
  x.fillStyle = '#c1121f'; x.fillRect(U(-L / 2 + 0.12), Vp(type.prof.tailH - 0.1), 18, 8);
  const t = tex(c, { repeat: false }); return t;
}

export function plate() {
  const [c, x] = cv(256, 128); x.fillStyle = '#f5f5f0'; x.fillRect(0, 0, 256, 128); x.strokeStyle = '#1d3557'; x.lineWidth = 8; x.strokeRect(4, 4, 248, 120);
  x.fillStyle = '#c1121f'; x.font = 'bold 22px Arial'; x.textAlign = 'center'; x.fillText('San Altekz', 128, 32);
  x.fillStyle = '#1d3557'; x.font = 'bold 60px Arial'; const r = Math.random; const s = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  x.fillText(`${(r() * 9 + 1) | 0}${s[(r() * s.length) | 0]}${s[(r() * s.length) | 0]}${s[(r() * s.length) | 0]}${(r() * 900 + 100) | 0}`, 128, 96);
  return tex(c, { repeat: false });
}

export function taxiSign() { return label('TAXI', { w: 256, h: 96, bg: '#ffd60a', fg: '#111', size: 70 }); }

// ---------- characters ----------
export function face() {
  const [c, x] = cv(128, 128); x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#1a1a1a'; x.fillRect(30, 50, 18, 18); x.fillRect(80, 50, 18, 18);
  x.fillStyle = '#fff'; x.fillRect(34, 53, 6, 6); x.fillRect(84, 53, 6, 6);
  x.fillStyle = 'rgba(40,25,20,0.8)'; x.fillRect(26, 38, 26, 6); x.fillRect(76, 38, 26, 6);
  x.fillStyle = 'rgba(120,60,50,0.8)'; x.fillRect(46, 92, 36, 7);
  x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(58, 62, 12, 20);
  return tex(c, { repeat: false });
}

// ---------- fx ----------
export function softDot() {
  const [c, x] = cv(64, 64); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return tex(c, { repeat: false });
}
export function smokePuff() {
  const N = 128; const nz = makeNoise(8, 77); const [c, x] = cv(N, N); const img = x.createImageData(N, N); const d = img.data;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const dx = (i - N / 2) / (N / 2), dy = (j - N / 2) / (N / 2); const r = Math.hypot(dx, dy);
    const n = fbm(nz, i / 16, j / 16, 4); const a = Math.max(0, 1 - r) ** 1.5 * (0.55 + n * 0.9);
    const k = (j * N + i) * 4; d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.min(255, a * 255);
  }
  x.putImageData(img, 0, 0); return tex(c, { repeat: false });
}
export function lightPool() {
  const [c, x] = cv(128, 128); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,214,150,0.9)'); g.addColorStop(0.4, 'rgba(255,190,120,0.35)'); g.addColorStop(1, 'rgba(255,180,100,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return tex(c, { repeat: false });
}
export function chevrons() {
  const [c, x] = cv(256, 256); x.fillStyle = '#ffcc00'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#151515'; for (let k = -2; k < 6; k++) { x.beginPath(); const y = k * 64; x.moveTo(0, y + 64); x.lineTo(128, y); x.lineTo(256, y + 64); x.lineTo(256, y + 96); x.lineTo(128, y + 32); x.lineTo(0, y + 96); x.closePath(); x.fill(); }
  return tex(c);
}
export function helipad() {
  const [c, x] = cv(256, 256); x.fillStyle = '#3a3d42'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#ffd166'; x.lineWidth = 10; x.beginPath(); x.arc(128, 128, 104, 0, 7); x.stroke();
  x.fillStyle = '#fff'; x.font = 'bold 140px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', 128, 136);
  return tex(c, { repeat: false });
}
export function cashNote() {
  const [c, x] = cv(256, 128); x.fillStyle = '#5fa35a'; x.fillRect(0, 0, 256, 128); x.strokeStyle = '#2d5a27'; x.lineWidth = 8; x.strokeRect(6, 6, 244, 116);
  x.fillStyle = '#e8f5e1'; x.beginPath(); x.ellipse(128, 64, 40, 44, 0, 0, 7); x.fill(); x.fillStyle = '#2d5a27'; x.font = 'bold 70px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 128, 68);
  return tex(c, { repeat: false });
}
export function waterNormal() {
  const N = 256; const h = new Float32Array(N * N); const r = rng(91);
  const waves = Array.from({ length: 14 }, () => ({ kx: r.int(-6, 6), ky: r.int(-6, 6), a: 0.3 + r(), p: r() * 6.28 }));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let s = 0; for (const w of waves) s += w.a * Math.sin(((w.kx * i + w.ky * j) / N) * 6.2832 + w.p); h[j * N + i] = s; }
  return normalFromHeight(h, N, N, 0.6);
}
export function clouds() {
  const N = 512; const nz = makeNoise(16, 55); const [c, x] = cv(N, N); const img = x.createImageData(N, N); const d = img.data;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const n = fbm(nz, (i / N) * 16, (j / N) * 16, 5); const a = Math.max(0, (n - 0.5) * 3.2);
    const k = (j * N + i) * 4; d[k] = d[k + 1] = d[k + 2] = 255 - Math.min(60, a * 40); d[k + 3] = Math.min(255, a * 255);
  }
  x.putImageData(img, 0, 0); return tex(c);
}
export function corrugated(color) {
  const [c, x] = cv(128, 128); for (let i = 0; i < 128; i += 8) { x.fillStyle = (i / 8) % 2 ? color : shade(color, 0.78); x.fillRect(i, 0, 8, 128); }
  x.fillStyle = 'rgba(0,0,0,0.15)'; x.fillRect(0, 0, 128, 4); x.fillRect(0, 124, 128, 4); return tex(c);
}
