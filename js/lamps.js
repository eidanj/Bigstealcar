// Big Steal Car — per-model lamp and grille textures. Every model has its own headlight, taillight and grille design,
// painted into a small atlas (a colour map for how the lamp looks when it's off, and a glow map for which parts light
// up). Region sizes come from the real lamp shapes on that model, so round lamps stay round.
import { cv, tex } from './textures.js';

const TAU = Math.PI * 2;
// ---------- drawing helpers ----------
function rrect(c, X, Y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath(); c.moveTo(X + r, Y); c.arcTo(X + w, Y, X + w, Y + h, r); c.arcTo(X + w, Y + h, X, Y + h, r); c.arcTo(X, Y + h, X, Y, r); c.arcTo(X, Y, X + w, Y, r); c.closePath(); }
function vgrad(c, Y, h, stops) { const g = c.createLinearGradient(0, Y, 0, Y + h); stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s)); return g; }
function housing(x, X, Y, w, h, cols = ['#3a3f46', '#16181c', '#2a2e34']) { x.fillStyle = vgrad(x, Y, h, cols); x.fillRect(X, Y, w, h); }
function sheen(x, X, Y, w, h, rim = 0.85) { // clear outer lens: soft highlight and a crisp dark rim
  const s = x.createLinearGradient(X, Y, X + w * 0.5, Y + h); s.addColorStop(0, 'rgba(255,255,255,0.18)'); s.addColorStop(0.45, 'rgba(255,255,255,0.03)'); s.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = s; x.fillRect(X, Y, w, h); const lw = Math.max(2, Math.min(w, h) * 0.06); x.strokeStyle = `rgba(0,0,0,${rim})`; x.lineWidth = lw; x.strokeRect(X + lw / 2, Y + lw / 2, w - lw, h - lw);
}
function chromeRing(x, cx, cy, r, t) { const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r + t); g.addColorStop(0, '#f4f6f8'); g.addColorStop(0.6, '#8d959f'); g.addColorStop(1, '#2a2e34'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r + t, 0, TAU); x.fill(); }
function disc(c, cx, cy, r, col) { c.fillStyle = col; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill(); }
function glowDisc(g, cx, cy, r, col = '#fff', soft = 0.25) { const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, col); gr.addColorStop(1 - soft, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); }
function projector(x, g, cx, cy, r, gcol = '#fff') {
  chromeRing(x, cx, cy, r, r * 0.28); disc(x, cx, cy, r * 0.95, '#0b0c0e');
  const l = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, 1, cx, cy, r * 0.95); l.addColorStop(0, 'rgba(215,228,255,0.95)'); l.addColorStop(0.3, 'rgba(90,110,140,0.55)'); l.addColorStop(1, 'rgba(10,12,16,0)');
  x.fillStyle = l; x.beginPath(); x.arc(cx, cy, r * 0.95, 0, TAU); x.fill(); glowDisc(g, cx, cy, r * 1.15, gcol, 0.2);
}
function bowl(x, g, cx, cy, r, gcol = '#fff') { // round reflector with radial ribs and a bulb
  const gr = x.createRadialGradient(cx, cy, r * 0.1, cx, cy, r); gr.addColorStop(0, '#f2f4f6'); gr.addColorStop(0.55, '#9aa2ab'); gr.addColorStop(1, '#3a3f46'); disc(x, cx, cy, r, gr);
  x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = Math.max(1, r * 0.05); for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; x.beginPath(); x.moveTo(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25); x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); x.stroke(); }
  disc(x, cx, cy, r * 0.18, '#fffbe8'); glowDisc(g, cx, cy, r * 1.02, gcol, 0.3);
}
function fluted(x, X, Y, w, h, n, vertical, alpha = 0.12, col = '255,255,255') { for (let i = 0; i < n; i++) { x.fillStyle = `rgba(${col},${alpha * (i % 2 ? 1 : 0.35)})`; if (vertical) x.fillRect(X + (i / n) * w, Y, w / n * 0.55, h); else x.fillRect(X, Y + (i / n) * h, w, h / n * 0.55); } }
function glowRect(g, X, Y, w, h, col = '#fff', r = 0) { g.fillStyle = col; rrect(g, X, Y, w, h, r); g.fill(); }
function strip(x, g, pts, lw, col = '#e4e9ef', gcol = '#fff') { // LED light guide: dark channel, pale tube, bright glow
  const path = (c) => { c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); };
  x.lineJoin = g.lineJoin = 'round'; x.lineCap = g.lineCap = 'round';
  path(x); x.strokeStyle = '#0a0b0d'; x.lineWidth = lw * 1.8; x.stroke(); path(x); x.strokeStyle = col; x.lineWidth = lw; x.stroke();
  path(g); g.strokeStyle = gcol; g.lineWidth = lw * 1.25; g.stroke();
}
function dots(x, g, X, Y, w, h, nx, ny, col, gcol = '#fff', sq = true) {
  const cw = w / nx, ch = h / ny, s = Math.min(cw, ch) * 0.62;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const cx = X + (i + 0.5) * cw, cy = Y + (j + 0.5) * ch; x.fillStyle = col; g.fillStyle = gcol; if (sq) { x.fillRect(cx - s / 2, cy - s / 2, s, s); g.fillRect(cx - s / 2, cy - s / 2, s, s); } else { disc(x, cx, cy, s / 2, col); disc(g, cx, cy, s / 2, gcol); } }
}
function redLens(x, X, Y, w, h, a = '#4a0507', b = '#6a090c', c = '#3a0405') { x.fillStyle = vgrad(x, Y, h, [a, b, c]); x.fillRect(X, Y, w, h); }
function fresnel(x, X, Y, w, h, n, vertical = true, a = 0.22) { fluted(x, X, Y, w, h, n, vertical, a, '0,0,0'); }
function chromeFrame(x, X, Y, w, h, t) { x.strokeStyle = vgrad(x, Y, h, ['#f2f4f6', '#8d959f', '#d0d4d9', '#5d636b']); x.lineWidth = t; x.strokeRect(X + t / 2, Y + t / 2, w - t, h - t); }
function amberLens(x, X, Y, w, h, vertical = false) { const g = x.createLinearGradient(X, Y, vertical ? X : X + w, vertical ? Y + h : Y); g.addColorStop(0, '#6e4a12'); g.addColorStop(1, '#b07a22'); x.fillStyle = g; x.fillRect(X, Y, w, h); fluted(x, X, Y, w, h, vertical ? 8 : 10, !vertical, 0.16, '255,220,150'); }

// ---------- headlights ----------
const HEAD = {
  twinProj(x, g, X, Y, w, h) { housing(x, X, Y, w, h); fluted(x, X, Y, w, h, 24, true, 0.05); projector(x, g, X + w * 0.3, Y + h * 0.46, h * 0.3); projector(x, g, X + w * 0.72, Y + h * 0.46, h * 0.25); x.fillStyle = '#9aa2ab'; x.fillRect(X + w * 0.06, Y + h * 0.82, w * 0.88, h * 0.06); glowRect(g, X + w * 0.06, Y + h * 0.82, w * 0.88, h * 0.06, '#666'); },
  ledSlim(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#16181c', '#060708', '#121418']); for (let i = 0; i < 3; i++) { const cx = X + w * (0.5 + i * 0.16), s = h * 0.5; x.fillStyle = '#7d858f'; x.fillRect(cx - s / 2 - 2, Y + h * 0.22 - 2, s + 4, s + 4); x.fillStyle = '#d8e2ee'; x.fillRect(cx - s / 2, Y + h * 0.22, s, s); glowRect(g, cx - s / 2, Y + h * 0.22, s, s); } x.fillStyle = '#2d3238'; x.fillRect(X + w * 0.04, Y + h * 0.3, w * 0.36, h * 0.35); },
  quadRound(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#141518', '#08090a', '#141518']); for (const u of [0.27, 0.73]) { const cx = X + w * u, cy = Y + h * 0.5, r = Math.min(h * 0.38, w * 0.2); chromeRing(x, cx, cy, r, r * 0.22); const l = x.createRadialGradient(cx - r * 0.2, cy - r * 0.3, 1, cx, cy, r); l.addColorStop(0, '#f6f8fb'); l.addColorStop(1, '#9aa3ae'); disc(x, cx, cy, r, l); x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1.5; for (let k = 1; k < 4; k++) { x.beginPath(); x.arc(cx, cy, r * k / 4, 0, TAU); x.stroke(); } glowDisc(g, cx, cy, r, '#fff', 0.15); } },
  squareProj(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#4a5058', '#1e2126', '#33383f']); const s = h * 0.78; x.fillStyle = '#0f1114'; rrect(x, X + w * 0.12, Y + h * 0.11, s * 1.2, s, s * 0.18); x.fill(); projector(x, g, X + w * 0.12 + s * 0.6, Y + h * 0.5, s * 0.32); for (const u of [0.74, 0.86]) { x.fillStyle = '#d4dae2'; x.fillRect(X + w * u, Y + h * 0.14, w * 0.045, h * 0.72); glowRect(g, X + w * u, Y + h * 0.14, w * 0.045, h * 0.72, '#bbb'); } },
  roundCompact(x, g, X, Y, w, h) { x.fillStyle = '#0d0e10'; x.fillRect(X, Y, w, h); x.fillStyle = vgrad(x, Y, h, ['#565c64', '#22252a', '#3c4148']); rrect(x, X + 2, Y + 2, w - 4, h - 4, h * 0.48); x.fill(); bowl(x, g, X + w * 0.38, Y + h * 0.5, h * 0.4); chromeRing(x, X + w * 0.8, Y + h * 0.5, h * 0.2, h * 0.05); projector(x, g, X + w * 0.8, Y + h * 0.5, h * 0.17); },
  halogenRect(x, g, X, Y, w, h) { x.fillStyle = vgrad(x, Y, h, ['#c9ced4', '#8d939b', '#b9bec5']); x.fillRect(X, Y, w, h); fluted(x, X, Y, w, h, 9, false, 0.25); fluted(x, X, Y, w, h, 20, true, 0.08); const gr = g.createRadialGradient(X + w / 2, Y + h / 2, 0, X + w / 2, Y + h / 2, w * 0.55); gr.addColorStop(0, '#fff'); gr.addColorStop(0.45, '#bbb'); gr.addColorStop(1, '#555'); g.fillStyle = gr; g.fillRect(X, Y, w, h); disc(x, X + w / 2, Y + h / 2, h * 0.14, '#fffbe6'); },
  policeStrobe(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#202328', '#0b0c0e', '#1a1d21']); projector(x, g, X + w * 0.28, Y + h * 0.45, h * 0.3); projector(x, g, X + w * 0.6, Y + h * 0.45, h * 0.25); disc(x, X + w * 0.84, Y + h * 0.32, h * 0.11, '#b81d24'); disc(x, X + w * 0.84, Y + h * 0.68, h * 0.11, '#1d4ed8'); glowDisc(g, X + w * 0.84, Y + h * 0.32, h * 0.12, '#f33'); glowDisc(g, X + w * 0.84, Y + h * 0.68, h * 0.12, '#46f'); },
  vanBig(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#8d949c', '#525860', '#7a818a']); fluted(x, X, Y, w, h, 14, true, 0.1); bowl(x, g, X + w * 0.3, Y + h * 0.5, h * 0.36); bowl(x, g, X + w * 0.72, Y + h * 0.5, h * 0.3); x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(X + w * 0.505, Y + h * 0.1, 3, h * 0.8); },
  superSlit(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#0b0c0e', '#020203', '#0b0c0e']); for (let i = 0; i < 4; i++) { const cx = X + w * (0.42 + i * 0.13), s = h * 0.55; x.fillStyle = '#e0e8f2'; x.fillRect(cx - s / 2, Y + h * 0.25, s, s); glowRect(g, cx - s / 2, Y + h * 0.25, s, s); } strip(x, g, [[X + w * 0.04, Y + h * 0.78], [X + w * 0.34, Y + h * 0.78], [X + w * 0.96, Y + h * 0.12]], Math.max(2, h * 0.12)); },
  lProj(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#24272c', '#0e1012', '#1d2024']); projector(x, g, X + w * 0.68, Y + h * 0.46, h * 0.33); strip(x, g, [[X + w * 0.07, Y + h * 0.14], [X + w * 0.07, Y + h * 0.84], [X + w * 0.5, Y + h * 0.84]], Math.max(2, h * 0.11)); },
  crystal(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#5b626b', '#2b2f35', '#4a5058']); x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 1; for (let i = -10; i < 20; i++) { x.beginPath(); x.moveTo(X + i * h * 0.3, Y); x.lineTo(X + i * h * 0.3 + h, Y + h); x.stroke(); x.beginPath(); x.moveTo(X + i * h * 0.3 + h, Y); x.lineTo(X + i * h * 0.3, Y + h); x.stroke(); } for (let i = 0; i < 4; i++) { const cx = X + w * (0.16 + i * 0.22), cy = Y + h * 0.48; x.fillStyle = '#c3c9d0'; x.fillRect(cx - h * 0.3, cy - h * 0.3, h * 0.6, h * 0.6); projector(x, g, cx, cy, h * 0.2); } },
  twinBowl(x, g, X, Y, w, h) { x.fillStyle = vgrad(x, Y, h, ['#b9bfc6', '#6f767f', '#a3aab2']); x.fillRect(X, Y, w, h); bowl(x, g, X + w * 0.28, Y + h * 0.5, h * 0.38); bowl(x, g, X + w * 0.72, Y + h * 0.5, h * 0.38); x.fillStyle = '#e6e9ec'; x.fillRect(X + w * 0.495, Y, w * 0.015, h); },
  evPixel(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#0e0f11', '#050506', '#0e0f11']); dots(x, g, X + w * 0.05, Y + h * 0.15, w * 0.9, h * 0.7, Math.max(6, Math.round(w / h * 3)), 3, '#cfd8e3'); },
  bigRound(x, g, X, Y, w, h) { x.fillStyle = '#d7dbe0'; x.fillRect(X, Y, w, h); const cx = X + w / 2, cy = Y + h * 0.54, r = Math.min(w, h) * 0.4; x.fillStyle = vgrad(x, Y, h * 0.5, ['#8a9099', '#e8ebee']); rrect(x, X + w * 0.06, Y + h * 0.02, w * 0.88, h * 0.4, h * 0.2); x.fill(); chromeRing(x, cx, cy, r, r * 0.3); const l = x.createRadialGradient(cx - r * 0.25, cy - r * 0.3, 1, cx, cy, r); l.addColorStop(0, '#fbfcfd'); l.addColorStop(1, '#9fa8b2'); disc(x, cx, cy, r, l); x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 1.5; for (let k = 1; k < 5; k++) { x.beginPath(); x.arc(cx, cy, r * k / 5, 0, TAU); x.stroke(); } for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); x.stroke(); } glowDisc(g, cx, cy, r, '#fff', 0.12); },
  swept(x, g, X, Y, w, h) { x.fillStyle = '#060708'; x.fillRect(X, Y, w, h); x.save(); x.beginPath(); x.moveTo(X, Y); x.lineTo(X + w, Y + h * 0.45); x.lineTo(X + w, Y + h); x.lineTo(X, Y + h); x.closePath(); x.clip(); housing(x, X, Y, w, h, ['#4d535b', '#1a1d21', '#383d44']); projector(x, g, X + w * 0.3, Y + h * 0.62, h * 0.24); bowl(x, g, X + w * 0.62, Y + h * 0.72, h * 0.17); x.restore(); strip(x, g, [[X + w * 0.03, Y + h * 0.1], [X + w * 0.97, Y + h * 0.52]], Math.max(2, h * 0.07)); },
  cShape(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#3e434a', '#15171a', '#2c3036']); bowl(x, g, X + w * 0.48, Y + h * 0.5, h * 0.3); projector(x, g, X + w * 0.8, Y + h * 0.5, h * 0.17); strip(x, g, [[X + w * 0.66, Y + h * 0.12], [X + w * 0.12, Y + h * 0.12], [X + w * 0.12, Y + h * 0.88], [X + w * 0.66, Y + h * 0.88]], Math.max(3, h * 0.08)); },
  sealedSquare(x, g, X, Y, w, h) { x.fillStyle = '#111'; x.fillRect(X, Y, w, h); const s = Math.min(w * 0.86, h * 0.9), cx = X + w / 2, cy = Y + h / 2; chromeFrame(x, cx - s / 2 - 4, cy - s / 2 - 4, s + 8, s + 8, Math.max(3, s * 0.08)); x.fillStyle = vgrad(x, cy - s / 2, s, ['#eef1f4', '#a7afb8']); x.fillRect(cx - s / 2, cy - s / 2, s, s); fluted(x, cx - s / 2, cy - s / 2, s, s, 8, true, 0.14, '0,0,0'); fluted(x, cx - s / 2, cy - s / 2, s, s, 8, false, 0.1, '0,0,0'); glowRect(g, cx - s / 2, cy - s / 2, s, s, '#fff', s * 0.12); },
  truckStack(x, g, X, Y, w, h) { x.fillStyle = '#1a1c1f'; x.fillRect(X, Y, w, h); for (const v of [0.05, 0.53]) { const bx = X + w * 0.06, by = Y + h * v, bw = w * 0.88, bh = h * 0.42; chromeFrame(x, bx, by, bw, bh, 4); x.fillStyle = vgrad(x, by, bh, ['#d9dee4', '#8e959e']); x.fillRect(bx + 4, by + 4, bw - 8, bh - 8); fluted(x, bx + 4, by + 4, bw - 8, bh - 8, 12, true, 0.12, '0,0,0'); glowRect(g, bx + 4, by + 4, bw - 8, bh - 8, v < 0.3 ? '#fff' : '#aaa'); } },
  twinRoundBlack(x, g, X, Y, w, h) { x.fillStyle = vgrad(x, Y, h, ['#2b2d30', '#141517']); x.fillRect(X, Y, w, h); x.fillStyle = '#5a5e63'; for (const [u, v] of [[0.05, 0.12], [0.95, 0.12], [0.05, 0.88], [0.95, 0.88], [0.5, 0.12], [0.5, 0.88]]) disc(x, X + w * u, Y + h * v, Math.max(2, h * 0.04), '#6d7278'); for (const u of [0.27, 0.73]) { const r = Math.min(h * 0.33, w * 0.2), cx = X + w * u, cy = Y + h * 0.5; disc(x, cx, cy, r * 1.18, '#050505'); bowl(x, g, cx, cy, r); } },
  ledMatrixBlue(x, g, X, Y, w, h) { housing(x, X, Y, w, h, ['#121417', '#050607', '#121417']); for (let i = 0; i < 3; i++) projector(x, g, X + w * (0.22 + i * 0.25), Y + h * 0.42, h * 0.2); x.fillStyle = '#1d4ed8'; x.fillRect(X + w * 0.06, Y + h * 0.8, w * 0.88, h * 0.08); glowRect(g, X + w * 0.06, Y + h * 0.8, w * 0.88, h * 0.08, '#36f'); },
};

// ---------- taillights ----------
const TAIL = {
  threeBar(x, g, X, Y, w, h) { redLens(x, X, Y, w, h); fresnel(x, X, Y, w, h, 34); for (const [fy, fh] of [[0.2, 0.16], [0.47, 0.16], [0.74, 0.14]]) { rrect(x, X + w * 0.05, Y + h * fy, w * 0.9, h * fh, h * 0.05); x.fillStyle = '#a3171b'; x.fill(); rrect(g, X + w * 0.05, Y + h * fy, w * 0.9, h * fh, h * 0.05); g.fillStyle = '#fff'; g.fill(); } glowRect(g, X, Y, w, h, 'rgba(255,255,255,0.3)'); },
  twinRing(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#1c0405', '#2a0607', '#180304'); for (const u of [0.3, 0.72]) { const cx = X + w * u, cy = Y + h * 0.5, r = Math.min(h * 0.36, w * 0.19); x.strokeStyle = '#b3161b'; x.lineWidth = r * 0.32; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke(); g.strokeStyle = '#fff'; g.lineWidth = r * 0.36; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); disc(x, cx, cy, r * 0.5, '#3a0608'); } },
  ribbedWide(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#5d0709', '#8a0d10', '#4a0507'); glowRect(g, X, Y, w, h, '#d0d0d0'); const n = Math.max(6, Math.round(w / h * 3.2)); for (let i = 1; i < n; i++) { const px = X + (i / n) * w; x.fillStyle = vgrad(x, Y, h, ['#f1f3f5', '#8a9098', '#d8dce0']); x.fillRect(px - 2, Y, 4, h); g.fillStyle = '#000'; g.fillRect(px - 2, Y, 4, h); } chromeFrame(x, X, Y, w, h, 3); },
  vertStack(x, g, X, Y, w, h) { redLens(x, X, Y, w, h); fresnel(x, X, Y, w, h, 10, false, 0.18); strip(x, g, [[X + w * 0.78, Y + h * 0.12], [X + w * 0.25, Y + h * 0.12], [X + w * 0.25, Y + h * 0.88], [X + w * 0.78, Y + h * 0.88]], Math.max(2, w * 0.1), '#c4161c'); glowRect(g, X, Y, w, h, 'rgba(255,255,255,0.22)'); },
  boomerang(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#3a0405', '#5a080a', '#2c0304'); strip(x, g, [[X + w * 0.8, Y + h * 0.12], [X + w * 0.22, Y + h * 0.42], [X + w * 0.8, Y + h * 0.88]], Math.max(3, w * 0.14), '#c0151b'); glowRect(g, X, Y, w, h, 'rgba(255,255,255,0.15)'); },
  oldRect(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#7a0a0d', '#a8121a', '#6a090c'); fluted(x, X, Y, w, h, 7, false, 0.25, '0,0,0'); glowRect(g, X, Y, w, h, '#e8e8e8'); chromeFrame(x, X, Y, w, h, 4); },
  policeTail(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#2a0304', '#3a0405', '#220203'); for (let i = 0; i < 4; i++) { const bx = X + w * (0.06 + i * 0.23), bw = w * 0.19; rrect(x, bx, Y + h * 0.2, bw, h * 0.6, 4); x.fillStyle = '#9d151a'; x.fill(); glowRect(g, bx, Y + h * 0.2, bw, h * 0.6, '#fff', 4); } },
  vanVert(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#6a090c', '#8c0e12', '#5a080a'); for (let j = 0; j < 9; j++) for (let i = 0; i < 3; i++) disc(x, X + w * (0.2 + i * 0.3), Y + h * (0.07 + j * 0.108), Math.min(w, h) * 0.07, 'rgba(0,0,0,0.25)'); glowRect(g, X + 3, Y + 3, w - 6, h - 6, '#ddd'); },
  superX(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#150203', '#200304', '#120202'); const lw = Math.max(2, h * 0.14); strip(x, g, [[X + w * 0.05, Y + h * 0.2], [X + w * 0.3, Y + h * 0.5], [X + w * 0.05, Y + h * 0.8]], lw, '#b0141a'); strip(x, g, [[X + w * 0.95, Y + h * 0.5], [X + w * 0.3, Y + h * 0.5]], lw, '#b0141a'); },
  thinLine(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#250304', '#3a0506', '#250304'); x.fillStyle = '#c0161c'; x.fillRect(X + w * 0.02, Y + h * 0.4, w * 0.96, h * 0.2); glowRect(g, X + w * 0.02, Y + h * 0.36, w * 0.96, h * 0.28); },
  chromeGrid(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#5a0709', '#7d0b0f', '#4a0507'); dots(x, g, X + w * 0.03, Y + h * 0.08, w * 0.94, h * 0.36, Math.max(8, Math.round(w / h * 4)), 2, '#b0141a', '#fff', false); dots(x, g, X + w * 0.03, Y + h * 0.58, w * 0.94, h * 0.36, Math.max(8, Math.round(w / h * 4)), 2, '#b0141a', '#fff', false); x.fillStyle = vgrad(x, Y + h * 0.46, h * 0.1, ['#f3f5f7', '#8d959f']); x.fillRect(X, Y + h * 0.46, w, h * 0.09); },
  lShape(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#3a0405', '#5c080a', '#2c0304'); strip(x, g, [[X + w * 0.2, Y + h * 0.08], [X + w * 0.2, Y + h * 0.86], [X + w * 0.88, Y + h * 0.86]], Math.max(3, w * 0.13), '#c0151b'); glowRect(g, X, Y, w, h, 'rgba(255,255,255,0.18)'); },
  evBar(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#1a0203', '#260304', '#1a0203'); dots(x, g, X + w * 0.02, Y + h * 0.15, w * 0.96, h * 0.7, Math.max(10, Math.round(w / h * 2.2)), 1, '#a8131a'); },
  roundFin(x, g, X, Y, w, h) { x.fillStyle = vgrad(x, Y, h, ['#eef1f4', '#8d959f', '#d0d4d9']); x.fillRect(X, Y, w, h); const r = Math.min(w, h) * 0.38, cx = X + w / 2, cy = Y + h / 2; chromeRing(x, cx, cy, r, r * 0.22); const l = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r); l.addColorStop(0, '#e0333a'); l.addColorStop(1, '#6a090c'); disc(x, cx, cy, r, l); x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 1.5; for (let k = 1; k < 4; k++) { x.beginPath(); x.arc(cx, cy, r * k / 4, 0, TAU); x.stroke(); } glowDisc(g, cx, cy, r, '#fff', 0.1); },
  mvCurve(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#4a0507', '#6a090c', '#3a0405'); const pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([X + w * (0.3 + 0.45 * Math.sin(t * Math.PI)), Y + h * (0.08 + t * 0.84)]); } strip(x, g, pts, Math.max(2, w * 0.1), '#c4161c'); glowRect(g, X, Y, w, h, 'rgba(255,255,255,0.2)'); },
  pickupC(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#5a0709', '#7a0b0f', '#4a0507'); chromeFrame(x, X, Y, w, h, Math.max(3, w * 0.08)); strip(x, g, [[X + w * 0.75, Y + h * 0.14], [X + w * 0.3, Y + h * 0.14], [X + w * 0.3, Y + h * 0.86], [X + w * 0.75, Y + h * 0.86]], Math.max(3, w * 0.12), '#c8161d'); glowRect(g, X, Y, w, h, 'rgba(255,255,255,0.22)'); },
  squareOld(x, g, X, Y, w, h) { x.fillStyle = '#ccd0d5'; x.fillRect(X, Y, w, h); const m = Math.min(w, h) * 0.12; redLens(x, X + m, Y + m, w - 2 * m, h - 2 * m, '#8a0d10', '#b0141a', '#7a0b0f'); fluted(x, X + m, Y + m, w - 2 * m, h - 2 * m, 6, true, 0.25, '0,0,0'); fluted(x, X + m, Y + m, w - 2 * m, h - 2 * m, 8, false, 0.15, '0,0,0'); glowRect(g, X + m, Y + m, w - 2 * m, h - 2 * m, '#eee'); },
  roundTriple(x, g, X, Y, w, h) { x.fillStyle = '#141517'; x.fillRect(X, Y, w, h); const r = Math.min(w, h) * 0.4, cx = X + w / 2, cy = Y + h / 2; disc(x, cx, cy, r * 1.15, '#3b3e42'); const l = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r); l.addColorStop(0, '#e2363d'); l.addColorStop(1, '#7a0b0f'); disc(x, cx, cy, r, l); glowDisc(g, cx, cy, r, '#fff', 0.1); },
  roundPair(x, g, X, Y, w, h) { x.fillStyle = '#1b1c1e'; x.fillRect(X, Y, w, h); const r = Math.min(w, h) * 0.36, cx = X + w / 2, cy = Y + h / 2; const l = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r); l.addColorStop(0, '#d8343a'); l.addColorStop(1, '#6a090c'); disc(x, cx, cy, r, l); glowDisc(g, cx, cy, r, '#fff', 0.1); x.strokeStyle = '#8a8e93'; x.lineWidth = Math.max(2, r * 0.16); for (const d of [-0.45, 0, 0.45]) { x.beginPath(); x.moveTo(cx + d * r, cy - r * 1.15); x.lineTo(cx + d * r, cy + r * 1.15); x.stroke(); g.strokeStyle = '#000'; g.lineWidth = x.lineWidth; g.beginPath(); g.moveTo(cx + d * r, cy - r * 1.15); g.lineTo(cx + d * r, cy + r * 1.15); g.stroke(); } },
  vertBlue(x, g, X, Y, w, h) { redLens(x, X, Y, w, h, '#2a0304', '#3c0506', '#220203'); for (let j = 0; j < 7; j++) { const by = Y + h * (0.06 + j * 0.13); x.fillStyle = '#a8141a'; x.fillRect(X + w * 0.18, by, w * 0.64, h * 0.08); glowRect(g, X + w * 0.18, by, w * 0.64, h * 0.08); } x.fillStyle = '#c9ced5'; x.fillRect(X + w * 0.04, Y, w * 0.06, h); },
};

// ---------- grilles ----------
const GRILLE = {
  honey(x, X, Y, w, h) { x.fillStyle = '#060708'; x.fillRect(X, Y, w, h); x.strokeStyle = '#2b2f35'; x.lineWidth = 2.5; const s = Math.max(5, h / 7); for (let j = 0; j * s * 0.86 < h + s; j++) for (let i = 0; i * s < w + s; i++) { const cx = X + i * s + (j % 2) * s / 2, cy = Y + j * s * 0.86; x.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; x.lineTo(cx + Math.cos(a) * s * 0.45, cy + Math.sin(a) * s * 0.45); } x.closePath(); x.stroke(); } chromeFrame(x, X, Y, w, h, 4); },
  mesh(x, X, Y, w, h) { x.fillStyle = '#050505'; x.fillRect(X, Y, w, h); x.strokeStyle = '#25282c'; x.lineWidth = 1.5; for (let i = -h; i < w; i += 6) { x.beginPath(); x.moveTo(X + i, Y); x.lineTo(X + i + h, Y + h); x.stroke(); x.beginPath(); x.moveTo(X + i + h, Y); x.lineTo(X + i, Y + h); x.stroke(); } },
  hbars(x, X, Y, w, h) { x.fillStyle = '#070809'; x.fillRect(X, Y, w, h); for (let i = 0; i < 5; i++) { x.fillStyle = '#2c3036'; x.fillRect(X + 3, Y + h * (0.12 + i * 0.18), w - 6, h * 0.07); } x.fillStyle = '#9aa2ab'; x.fillRect(X, Y, w, 3); x.fillRect(X, Y + h - 3, w, 3); },
  vbars(x, X, Y, w, h) { x.fillStyle = '#0a0b0d'; x.fillRect(X, Y, w, h); for (let i = 0; i < 12; i++) { x.fillStyle = vgrad(x, Y, h, ['#c9ced5', '#6e757e']); x.fillRect(X + w * (0.04 + i * 0.08), Y + 4, w * 0.035, h - 8); } chromeFrame(x, X, Y, w, h, 5); },
  smile(x, X, Y, w, h) { x.fillStyle = '#0b0c0e'; rrect(x, X, Y, w, h, h * 0.5); x.fill(); x.strokeStyle = '#2b2f35'; x.lineWidth = 2; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(X + h * 0.3, Y + h * i / 4); x.lineTo(X + w - h * 0.3, Y + h * i / 4); x.stroke(); } },
  chromeBars(x, X, Y, w, h) { x.fillStyle = '#0a0b0c'; x.fillRect(X, Y, w, h); for (let i = 0; i < 4; i++) { x.fillStyle = vgrad(x, Y + h * (0.1 + i * 0.22), h * 0.12, ['#f3f5f7', '#7d858f']); x.fillRect(X + 2, Y + h * (0.1 + i * 0.22), w - 4, h * 0.12); } },
  police(x, X, Y, w, h) { x.fillStyle = '#030303'; x.fillRect(X, Y, w, h); for (let i = 0; i < 6; i++) { x.fillStyle = '#16181b'; x.fillRect(X + 2, Y + h * (0.08 + i * 0.15), w - 4, h * 0.07); } x.fillStyle = '#c1121f'; x.fillRect(X + w * 0.1, Y + h * 0.42, w * 0.06, h * 0.16); x.fillStyle = '#1d4ed8'; x.fillRect(X + w * 0.84, Y + h * 0.42, w * 0.06, h * 0.16); },
  van(x, X, Y, w, h) { x.fillStyle = '#2b2e32'; x.fillRect(X, Y, w, h); for (let i = 0; i < 4; i++) { x.fillStyle = '#0c0d0f'; x.fillRect(X + 6, Y + h * (0.12 + i * 0.22), w - 12, h * 0.13); } },
  carbon(x, X, Y, w, h) { x.fillStyle = '#0a0a0b'; x.fillRect(X, Y, w, h); for (let j = 0; j < h; j += 6) for (let i = 0; i < w; i += 6) { x.fillStyle = ((i + j) / 6) % 2 ? '#1c1d20' : '#121315'; x.fillRect(X + i, Y + j, 6, 6); } },
  diamond(x, X, Y, w, h) { x.fillStyle = '#060607'; x.fillRect(X, Y, w, h); x.fillStyle = '#8f969f'; const s = Math.max(6, h / 5); for (let j = 0; j < h / s + 1; j++) for (let i = 0; i < w / s + 1; i++) { const cx = X + i * s + (j % 2) * s / 2, cy = Y + j * s; x.beginPath(); x.moveTo(cx, cy - s * 0.2); x.lineTo(cx + s * 0.2, cy); x.lineTo(cx, cy + s * 0.2); x.lineTo(cx - s * 0.2, cy); x.closePath(); x.fill(); } chromeFrame(x, X, Y, w, h, 4); },
  chromeBig(x, X, Y, w, h) { x.fillStyle = '#08090a'; x.fillRect(X, Y, w, h); const n = 14; for (let i = 0; i < n; i++) { x.fillStyle = vgrad(x, Y, h, ['#ffffff', '#9aa2ab', '#e8ebee', '#6e757e']); x.fillRect(X + w * (i + 0.2) / n, Y + 6, w / n * 0.5, h - 12); } chromeFrame(x, X, Y, w, h, 8); },
  egg(x, X, Y, w, h) { x.fillStyle = '#0a0b0d'; x.fillRect(X, Y, w, h); x.strokeStyle = '#4a5058'; x.lineWidth = 3; for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo(X + w * i / 8, Y); x.lineTo(X + w * i / 8, Y + h); x.stroke(); } for (let j = 1; j < 3; j++) { x.beginPath(); x.moveTo(X, Y + h * j / 3); x.lineTo(X + w, Y + h * j / 3); x.stroke(); } chromeFrame(x, X, Y, w, h, 3); },
  blank(x, X, Y, w, h) { x.fillStyle = vgrad(x, Y, h, ['#24272b', '#070809', '#15171a']); x.fillRect(X, Y, w, h); x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(X, Y + h * 0.15, w, h * 0.08); disc(x, X + w / 2, Y + h * 0.55, h * 0.12, '#30343a'); },
  chromeTeeth(x, X, Y, w, h) { x.fillStyle = '#0b0b0c'; x.fillRect(X, Y, w, h); x.fillStyle = vgrad(x, Y, h * 0.3, ['#ffffff', '#8d959f']); x.fillRect(X, Y, w, h * 0.22); for (let i = 0; i < 9; i++) { const cx = X + w * (i + 0.5) / 9; x.fillStyle = vgrad(x, Y + h * 0.3, h * 0.6, ['#f2f4f6', '#7d858f']); rrect(x, cx - w * 0.025, Y + h * 0.3, w * 0.05, h * 0.62, w * 0.02); x.fill(); } },
  mvGrille(x, X, Y, w, h) { x.fillStyle = '#0b0c0e'; rrect(x, X, Y, w, h, h * 0.2); x.fill(); for (let i = 0; i < 3; i++) { x.fillStyle = vgrad(x, Y, h, ['#d8dce1', '#7d858f']); x.fillRect(X + w * 0.05, Y + h * (0.22 + i * 0.25), w * 0.9, h * 0.06); } },
  truckBig(x, X, Y, w, h) { x.fillStyle = '#070809'; x.fillRect(X, Y, w, h); x.strokeStyle = '#30343a'; x.lineWidth = 2; for (let i = 0; i < w; i += 8) { x.beginPath(); x.moveTo(X + i, Y); x.lineTo(X + i, Y + h); x.stroke(); } x.fillStyle = vgrad(x, Y, h, ['#f3f5f7', '#8d959f', '#e6e9ec']); x.fillRect(X, Y + h * 0.44, w, h * 0.12); x.fillRect(X + w * 0.46, Y, w * 0.08, h); chromeFrame(x, X, Y, w, h, 9); },
  oldBars(x, X, Y, w, h) { x.fillStyle = '#121314'; x.fillRect(X, Y, w, h); for (let i = 0; i < 6; i++) { x.fillStyle = '#8a8f95'; x.fillRect(X + 4, Y + h * (0.08 + i * 0.15), w - 8, h * 0.08); } chromeFrame(x, X, Y, w, h, 4); },
  truckSlots(x, X, Y, w, h) { x.fillStyle = '#2a2d31'; x.fillRect(X, Y, w, h); for (let j = 0; j < 6; j++) { x.fillStyle = '#050506'; rrect(x, X + w * 0.08, Y + h * (0.08 + j * 0.15), w * 0.84, h * 0.09, h * 0.04); x.fill(); } x.fillStyle = '#c9ced5'; x.font = `bold ${Math.round(h * 0.11)}px Arial Black, Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('PACKRAT', X + w / 2, Y + h * 0.95); },
  truckMesh(x, X, Y, w, h) { x.fillStyle = '#0a0a0a'; x.fillRect(X, Y, w, h); x.strokeStyle = '#5e6268'; x.lineWidth = 2; for (let i = 0; i < w; i += 7) { x.beginPath(); x.moveTo(X + i, Y); x.lineTo(X + i, Y + h); x.stroke(); } for (let j = 0; j < h; j += 7) { x.beginPath(); x.moveTo(X, Y + j); x.lineTo(X + w, Y + j); x.stroke(); } x.strokeStyle = '#3a3d41'; x.lineWidth = 10; x.strokeRect(X + 5, Y + 5, w - 10, h - 10); },
};

// ---------- small lamps (indicators, reverse, DRL, side markers, light bars) ----------
const CLEAR_TURN = new Set(['ledSlim', 'superSlit', 'lProj', 'crystal', 'evPixel', 'swept', 'ledMatrixBlue', 'policeStrobe', 'squareProj']);
function turnF(x, g, X, Y, w, h, hs) {
  if (CLEAR_TURN.has(hs)) { housing(x, X, Y, w, h, ['#3a3f46', '#1a1d21', '#30343a']); x.fillStyle = '#c68a2c'; const s = Math.min(w, h) * 0.5; x.fillRect(X + w / 2 - s / 2, Y + h / 2 - s / 2, s, s); glowRect(g, X + 3, Y + 3, w - 6, h - 6, '#ddd'); }
  else { amberLens(x, X, Y, w, h, h > w); glowRect(g, X + 3, Y + 3, w - 6, h - 6, '#e6e6e6'); }
  sheen(x, X, Y, w, h);
}
function turnR(x, g, X, Y, w, h) { const bg = x.createLinearGradient(0, Y, 0, Y + h); bg.addColorStop(0, '#8a4a08'); bg.addColorStop(1, '#5a2e04'); x.fillStyle = bg; x.fillRect(X, Y, w, h); fresnel(x, X, Y, w, h, Math.max(4, Math.round(w / 16)), true, 0.18); glowRect(g, X + 3, Y + 3, w - 6, h - 6, '#ececec'); sheen(x, X, Y, w, h); }
function rev(x, g, X, Y, w, h, round) {
  if (round) { x.fillStyle = '#141517'; x.fillRect(X, Y, w, h); const r = Math.min(w, h) * 0.4; disc(x, X + w / 2, Y + h / 2, r * 1.15, '#3b3e42'); disc(x, X + w / 2, Y + h / 2, r, '#d9dde2'); glowDisc(g, X + w / 2, Y + h / 2, r, '#fff', 0.1); return; }
  x.fillStyle = vgrad(x, Y, h, ['#9aa1a9', '#4b5058']); x.fillRect(X, Y, w, h); fluted(x, X, Y, w, h, Math.max(4, Math.round(w / 16)), true, 0.14); glowRect(g, X + 3, Y + 3, w - 6, h - 6, '#f0f0f0'); sheen(x, X, Y, w, h);
}
function roundTurn(x, g, X, Y, w, h) { x.fillStyle = '#141517'; x.fillRect(X, Y, w, h); const r = Math.min(w, h) * 0.4, cx = X + w / 2, cy = Y + h / 2; disc(x, cx, cy, r * 1.15, '#3b3e42'); const l = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r); l.addColorStop(0, '#ffb340'); l.addColorStop(1, '#9a5a08'); disc(x, cx, cy, r, l); glowDisc(g, cx, cy, r, '#fff', 0.1); }
function drl(x, g, X, Y, w, h) { x.fillStyle = '#1a1c20'; x.fillRect(X, Y, w, h); x.fillStyle = '#c9ced6'; x.fillRect(X + h * 0.3, Y + h * 0.28, w - h * 0.6, h * 0.44); glowRect(g, X + h * 0.3, Y + h * 0.22, w - h * 0.6, h * 0.56); sheen(x, X, Y, w, h, 0.6); }
function mark(x, g, X, Y, w, h) { x.fillStyle = '#a45f0c'; x.fillRect(X, Y, w, h); fresnel(x, X, Y, w, h, 8, true, 0.18); glowRect(g, X + 3, Y + 3, w - 6, h - 6, '#ddd'); sheen(x, X, Y, w, h); }
function fbar(x, g, X, Y, w, h) { x.fillStyle = '#060708'; x.fillRect(X, Y, w, h); x.fillStyle = '#dfe6ee'; x.fillRect(X, Y + h * 0.3, w, h * 0.4); glowRect(g, X, Y + h * 0.25, w, h * 0.5); }
function rbar(x, g, X, Y, w, h, ts) {
  if (ts === 'ribbedWide') return TAIL.ribbedWide(x, g, X, Y, w, h);
  if (ts === 'chromeGrid') return TAIL.chromeGrid(x, g, X, Y, w, h);
  if (ts === 'evBar') return TAIL.evBar(x, g, X, Y, w, h);
  redLens(x, X, Y, w, h, '#250304', '#3a0506', '#250304'); x.fillStyle = '#c0161c'; x.fillRect(X, Y + h * 0.38, w, h * 0.24); glowRect(g, X, Y + h * 0.34, w, h * 0.32);
}

// pack the regions a model uses into one canvas (shelf packing; shrink the pixels-per-metre until it fits)
export function lampAtlas(t, dims) {
  const L = t.lamp; const S = 512, pad = 4; const keys = Object.keys(dims);
  let ppm = 900, place;
  for (let tries = 0; tries < 12; tries++, ppm *= 0.86) {
    const sz = keys.map((k) => [k, Math.max(14, Math.min(S - 2 * pad, Math.round(dims[k][0] * ppm))), Math.max(10, Math.min(S - 2 * pad, Math.round(dims[k][1] * ppm)))]).sort((a, b) => b[2] - a[2]);
    let x0 = pad, y0 = pad, rowH = 0; place = {}; let ok = true;
    for (const [k, w, h] of sz) { if (x0 + w > S - pad) { x0 = pad; y0 += rowH + pad; rowH = 0; } if (y0 + h > S - pad) { ok = false; break; } place[k] = [x0, y0, w, h]; x0 += w + pad; rowH = Math.max(rowH, h); }
    if (ok) break;
  }
  const [c, x] = cv(S, S); const [gc, g] = cv(S, S); x.fillStyle = '#101113'; x.fillRect(0, 0, S, S); g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const R = {};
  for (const k of keys) {
    const [X, Y, w, h] = place[k]; R[k] = [X / S, 1 - (Y + h) / S, (X + w) / S, 1 - Y / S];
    x.save(); g.save(); x.beginPath(); x.rect(X, Y, w, h); x.clip(); g.beginPath(); g.rect(X, Y, w, h); g.clip();
    if (k === 'head') { (HEAD[L.hs] || HEAD.twinProj)(x, g, X, Y, w, h); sheen(x, X, Y, w, h); }
    else if (k === 'tail') { (TAIL[L.ts] || TAIL.threeBar)(x, g, X, Y, w, h); sheen(x, X, Y, w, h, 0.7); }
    else if (k === 'grille' || k === 'grille2') (GRILLE[L.gs] || GRILLE.honey)(x, X, Y, w, h);
    else if (k === 'turnF') turnF(x, g, X, Y, w, h, L.hs);
    else if (k === 'turnR') (L.r && L.r.k === 'bumper' ? roundTurn : turnR)(x, g, X, Y, w, h);
    else if (k === 'rev') rev(x, g, X, Y, w, h, L.r && L.r.k === 'bumper');
    else if (k === 'drl') drl(x, g, X, Y, w, h);
    else if (k === 'mark') mark(x, g, X, Y, w, h);
    else if (k === 'fbar') fbar(x, g, X, Y, w, h);
    else if (k === 'rbar') rbar(x, g, X, Y, w, h, L.ts);
    x.restore(); g.restore();
  }
  return { map: tex(c, { repeat: false }), glow: tex(gc, { repeat: false }), R };
}
export const LAMP_STYLES = { head: Object.keys(HEAD), tail: Object.keys(TAIL), grille: Object.keys(GRILLE) };
