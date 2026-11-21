// Big Steal Car — procedural city: roads, blocks, buildings, parks, ramps, traffic lights, colliders and the road graph.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY, SPECIAL_BLOCKS, DISTRICTS } from './config.js';
import { rng, clamp } from './util.js';
import * as TX from './textures.js';

const { NB, P, RW, SW, CURB, HALF, SLAB, LOT, LIMIT, LANES } = CITY;
const STOP = 14;            // stop line distance from a node centre
const CELL = 16;            // collision grid cell size
// Diagonal avenues cut corner-to-corner through a run of blocks, splitting each into two wedges.
const DW = 16, DH = DW / 2, HH = DH * Math.SQRT2; // avenue width, half width, half width measured in (dx ± dz)
export const DIAGS = [
  { name: 'Grand Diagonal', from: [0, 4], dir: [1, 1], n: 5 },  // Sunset Heights -> Port Bellmont
  { name: 'Spire Avenue', from: [9, 1], dir: [-1, 1], n: 4 },   // Rustwater -> Central Spire
];

// ---------- convex polygon helpers (XZ, positive orientation = counter-clockwise with x right, z up) ----------
export function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; } return a / 2; }
export function orient(p) { return polyArea(p) < 0 ? p.slice().reverse() : p; }
export function inset(p, d) { // offset every edge inward by d (negative grows the polygon)
  const n = p.length, L = [];
  for (let i = 0; i < n; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % n]; let ex = bx - ax, ez = bz - az; const l = Math.hypot(ex, ez) || 1; ex /= l; ez /= l; L.push([ax - ez * d, az + ex * d, ex, ez]); }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = L[(i - 1 + n) % n], B = L[i]; const den = A[2] * B[3] - A[3] * B[2];
    if (Math.abs(den) < 1e-9) { out.push([B[0], B[1]]); continue; }
    const t = ((B[0] - A[0]) * B[3] - (B[1] - A[1]) * B[2]) / den; out.push([A[0] + A[2] * t, A[1] + A[3] * t]);
  }
  return out;
}
export function centroid(p) { let x = 0, z = 0; for (const [a, b] of p) { x += a; z += b; } return [x / p.length, z / p.length]; }
function scalePoly(p, k) { const [cx, cz] = centroid(p); return p.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]); }
function bbox(p) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; }
export function inPoly(p, x, z, pad = 0) { // convex, positive orientation
  for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; const ex = bx - ax, ez = bz - az, l = Math.hypot(ex, ez) || 1; if (((x - ax) * ez - (z - az) * ex) / l > pad) return false; }
  return true;
}
// blunt any corner sharper than ~50 degrees (flatiron noses)
function bluntTips(p, cut) {
  const out = []; const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n]; const ux = a[0] - b[0], uz = a[1] - b[1], vx = c[0] - b[0], vz = c[1] - b[1]; const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    const cos = (ux * vx + uz * vz) / (lu * lv || 1);
    if (cos > 0.64 && lu > cut * 2 && lv > cut * 2) { out.push([b[0] + ux / lu * cut, b[1] + uz / lu * cut], [b[0] + vx / lv * cut, b[1] + vz / lv * cut]); } else out.push(b);
  }
  return out;
}

// ---------- geometry builder (positions, normals, uvs, colors) ----------
class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  quad(a, b, c, d, n, u0, u1, v0, v1, col = [1, 1, 1]) {
    const o = this.p.length / 3;
    this.p.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) { this.n.push(...n); this.c.push(...col); }
    this.u.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  // axis-aligned box sides with world-scaled uvs (tw x th metres per texture tile)
  sides(x0, x1, y0, y1, z0, z1, tw, th, col, vOff = 0) {
    const v0 = vOff / th, v1 = (y1 - y0 + vOff) / th;
    const wx = (x1 - x0) / tw, wz = (z1 - z0) / tw;
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 0, wz, v0, v1, col);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 0, wz, v0, v1, col);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 0, wx, v0, v1, col);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 0, wx, v0, v1, col);
  }
  top(x0, x1, y, z0, z1, ts = 4, col) { this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], x0 / ts, x1 / ts, -z1 / ts, -z0 / ts, col); }
  box(x0, x1, y0, y1, z0, z1, col, ts = 2) { this.sides(x0, x1, y0, y1, z0, z1, ts, ts, col); this.top(x0, x1, y1, z0, z1, ts, col); }
  geo(geom, m, col) { // append an arbitrary BufferGeometry transformed by matrix m
    const g = geom.index ? geom.toNonIndexed() : geom; const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m); const o = this.p.length / 3;
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
      this.u.push(uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0); this.c.push(...col); this.i.push(o + k);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); g.computeBoundingSphere(); return g;
  }
  get empty() { return this.p.length === 0; }
  tri(a, b, c, n, ua, ub, uc, col = [1, 1, 1]) {
    const o = this.p.length / 3; this.p.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) { this.n.push(...n); this.c.push(...col); }
    this.u.push(...ua, ...ub, ...uc); this.i.push(o, o + 1, o + 2);
  }
  poly(pts, y, ts = 4, col) { // flat, facing up; pts convex in positive orientation
    for (let i = 1; i < pts.length - 1; i++) { const a = pts[0], b = pts[i + 1], c = pts[i]; this.tri([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], [0, 1, 0], [a[0] / ts, -a[1] / ts], [b[0] / ts, -b[1] / ts], [c[0] / ts, -c[1] / ts], col); }
  }
  // vertical wall over edge a->b (positive orientation => outward normal (ez, -ex)); flip faces it inward
  wall(a, b, y0, y1, tw, th, col, vOff = 0, u0 = 0, flip = false) {
    const ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1; const v0 = vOff / th, v1 = (y1 - y0 + vOff) / th, u1 = u0 + l / tw;
    if (!flip) this.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [ez / l, 0, -ex / l], u0, u1, v0, v1, col);
    else this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [-ez / l, 0, ex / l], u0, u1, v0, v1, col);
  }
  prism(pts, y0, y1, tw, th, col, vOff = 0) { // windows run continuously round the corners
    let u = 0; for (let i = pts.length - 1; i >= 0; i--) { const a = pts[i], b = pts[(i + 1) % pts.length]; this.wall(a, b, y0, y1, tw, th, col, vOff, u); u += Math.hypot(b[0] - a[0], b[1] - a[1]) / tw; }
  }
  ring(pts, y0, y1, w, col) { // parapet / cap band around a polygon roof
    const inn = inset(pts, w); const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], ia = inn[i], ib = inn[(i + 1) % n];
      this.wall(a, b, y0, y1, 2, 2, col); this.wall(ia, ib, y0, y1, 2, 2, col, 0, 0, true); this.poly([a, b, ib, ia], y1, 2, col);
    }
  }
}
const hexCol = (h, k = 1) => { const c = new THREE.Color(h); return [c.r * k, c.g * k, c.b * k]; };
function octagon(x0, z0, x1, z1, k) { const c = Math.min(x1 - x0, z1 - z0) * k; return [[x0 + c, z0], [x1 - c, z0], [x1, z0 + c], [x1, z1 - c], [x1 - c, z1], [x0 + c, z1], [x0, z1 - c], [x0, z0 + c]]; }
function rotatedRect(x0, z0, x1, z1, a) { // the largest same-proportion rectangle turned by a that still fits the lot
  const w = x1 - x0, d = z1 - z0, cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a)); const k = Math.min(w / (w * cs + d * sn), d / (w * sn + d * cs));
  const hw = w * k / 2, hd = d * k / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, c = Math.cos(a), s = Math.sin(a);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
}

export class World {
  constructor(scene, props) {
    this.scene = scene; this.props = props;
    this.root = new THREE.Group(); scene.add(this.root);
    this.colliders = []; this.grid = new Map(); this.stamp = 0;
    this.ramps = []; this.blocks = []; this.buildings = []; this.alleys = [];
    this.parkingSlots = []; this.lights = []; this.specials = {}; this.rings = [];
    this.facadeMats = []; this.emissiveMats = []; this.nightMats = [];
    this.night = 0; this.time = 0;
  }

  // ======================= public queries =======================
  district(x, z) {
    const i = clamp(Math.floor((x + HALF) / P), 0, NB - 1), j = clamp(Math.floor((z + HALF) / P), 0, NB - 1);
    const b = this.blocks[j * NB + i]; return b ? b.districtName : DISTRICTS.midtown.name;
  }
  blockAt(x, z) {
    const i = Math.floor((x + HALF) / P), j = Math.floor((z + HALF) / P); if (i < 0 || j < 0 || i >= NB || j >= NB) return null;
    const b = this.blocks[j * NB + i]; return (Math.abs(x - b.cx) <= SLAB && Math.abs(z - b.cz) <= SLAB) ? b : null;
  }
  // ground height (+ optional normal) — roads 0, slabs/promenade CURB, ramps on top
  ground(x, z, out) {
    let h = 0, nx = 0, ny = 1, nz = 0;
    const ax = Math.abs(x), az = Math.abs(z);
    if (ax > LIMIT + 0.5 || az > LIMIT + 0.5) h = -1.4; // water (sea floor below the wall)
    else if (ax > HALF + RW / 2 || az > HALF + RW / 2) h = CURB;
    else {
      const i = Math.floor((x + HALF) / P), j = Math.floor((z + HALF) / P);
      if (i >= 0 && j >= 0 && i < NB && j < NB) {
        const cx = (i + 0.5) * P - HALF, cz = (j + 0.5) * P - HALF;
        if (Math.abs(x - cx) <= SLAB && Math.abs(z - cz) <= SLAB) {
          h = CURB; const b = this.blocks[j * NB + i];
          if (b && b.diag && Math.abs(b.diag > 0 ? (x - cx) - (z - cz) : (x - cx) + (z - cz)) < HH) h = 0; // the avenue
        }
      }
    }
    for (let k = 0; k < this.ramps.length; k++) {
      const r = this.ramps[k]; const dx = x - r.x, dz = z - r.z;
      if (dx * dx + dz * dz > r.rad2) continue;
      const lx = dx * r.c - dz * r.s, lz = dx * r.s + dz * r.c; // into ramp space (+z up the slope)
      if (Math.abs(lx) > r.w / 2 || lz < 0 || lz > r.l) continue;
      const rh = r.base + r.h * (lz / r.l);
      if (rh > h) { h = rh; nx = r.nx; ny = r.ny; nz = r.nz; }
    }
    if (out) { out.h = h; out.nx = nx; out.ny = ny; out.nz = nz; }
    return h;
  }
  // collect colliders overlapping an XZ rectangle
  query(x0, z0, x1, z1, out) {
    out.length = 0; const s = ++this.stamp;
    const i0 = Math.floor((x0 + LIMIT + 40) / CELL), i1 = Math.floor((x1 + LIMIT + 40) / CELL);
    const j0 = Math.floor((z0 + LIMIT + 40) / CELL), j1 = Math.floor((z1 + LIMIT + 40) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cell = this.grid.get(j * 1000 + i); if (!cell) continue;
      for (const c of cell) if (c.stamp !== s && !c.dead) { c.stamp = s; out.push(c); }
    }
    return out;
  }
  // segment vs buildings (line of sight / camera). returns hit fraction 0..1 (1 = clear)
  raycast(ax, ay, az, bx, by, bz, pad = 0) {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 3) + 1; let best = 1; const tmp = this._rc || (this._rc = []);
    this.query(Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad, tmp);
    for (const c of tmp) {
      if (!c.solid) continue;
      if (c.k === 2 || c.k === 1) { const t = this.rayPrism(c, ax, ay, az, bx, by, bz, pad); if (t < best) best = t; continue; }
      // slab test in 3D
      let t0 = 0, t1 = 1; const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az], mn = [c.x0 - pad, c.y0, c.z0 - pad], mx = [c.x1 + pad, c.y1, c.z1 + pad]; let ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) ok = false; }
        else { let ta = (mn[a] - o[a]) / d[a], tb = (mx[a] - o[a]) / d[a]; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false; }
      }
      if (ok && t0 < best) best = t0;
    }
    void steps; return best;
  }
  // segment vs vertical prism (convex polygon or circle) -> entry fraction, 1 if missed
  rayPrism(c, ax, ay, az, bx, by, bz, pad) {
    const dx = bx - ax, dy = by - ay, dz = bz - az; let t0 = 0, t1 = 1;
    if (Math.abs(dy) < 1e-9) { if (ay < c.y0 || ay > c.y1) return 1; } else { let ta = (c.y0 - ay) / dy, tb = (c.y1 - ay) / dy; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return 1; }
    if (c.k === 1) {
      const ox = ax - c.x, oz = az - c.z, r = c.r + pad; const A = dx * dx + dz * dz, B = 2 * (ox * dx + oz * dz), C = ox * ox + oz * oz - r * r;
      if (C < 0) return t0; if (A < 1e-9) return 1; const disc = B * B - 4 * A * C; if (disc < 0) return 1;
      const sq = Math.sqrt(disc); const e0 = (-B - sq) / (2 * A), e1 = (-B + sq) / (2 * A); t0 = Math.max(t0, e0); t1 = Math.min(t1, e1); return t0 <= t1 ? t0 : 1;
    }
    for (let i = 0; i < c.nrm.length; i++) {
      const [nx, nz] = c.nrm[i]; const num = c.off[i] + pad - (nx * ax + nz * az), den = nx * dx + nz * dz;
      if (Math.abs(den) < 1e-9) { if (num < 0) return 1; continue; }
      const t = num / den; if (den < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t); if (t0 > t1) return 1;
    }
    return t0;
  }
  polyCollider(pts, y0, y1, solid = true) {
    const p = orient(pts); const nrm = [], off = [];
    for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; const ex = bx - ax, ez = bz - az, l = Math.hypot(ex, ez) || 1; nrm.push([ez / l, -ex / l]); off.push((ez * ax - ex * az) / l); }
    const [x0, z0, x1, z1] = bbox(p); return this.addCollider({ k: 2, pts: p, nrm, off, x0, z0, x1, z1, y0, y1, solid });
  }
  // how far (x,z) sits inside polygon collider c (negative = outside by that much) and the outward normal of the nearest face
  polyDepth(c, x, z) {
    let best = -1e9, bi = 0; for (let i = 0; i < c.nrm.length; i++) { const d = c.nrm[i][0] * x + c.nrm[i][1] * z - c.off[i]; if (d > best) { best = d; bi = i; } }
    return { depth: -best, nx: c.nrm[bi][0], nz: c.nrm[bi][1] };
  }
  // closest point on a polygon's boundary (for round things touching a polygon from outside)
  polyClosest(c, x, z) {
    const p = c.pts; let bd = 1e9, qx = x, qz = z;
    for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length]; const ex = bx - ax, ez = bz - az; const L2 = ex * ex + ez * ez || 1; const t = clamp(((x - ax) * ex + (z - az) * ez) / L2, 0, 1); const px = ax + ex * t, pz = az + ez * t; const d = (x - px) ** 2 + (z - pz) ** 2; if (d < bd) { bd = d; qx = px; qz = pz; } }
    return [qx, qz];
  }
  addCollider(c) {
    c.stamp = 0; c.dead = false; this.colliders.push(c);
    const bx = c.k !== 1; const x0 = bx ? c.x0 : c.x - c.r, x1 = bx ? c.x1 : c.x + c.r, z0 = bx ? c.z0 : c.z - c.r, z1 = bx ? c.z1 : c.z + c.r;
    const i0 = Math.floor((x0 + LIMIT + 40) / CELL), i1 = Math.floor((x1 + LIMIT + 40) / CELL);
    const j0 = Math.floor((z0 + LIMIT + 40) / CELL), j1 = Math.floor((z1 + LIMIT + 40) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const key = j * 1000 + i; let a = this.grid.get(key); if (!a) this.grid.set(key, a = []); a.push(c); }
    return c;
  }
  boxCollider(x0, x1, z0, z1, y0, y1, solid = true) { return this.addCollider({ k: 0, x0, x1, z0, z1, y0, y1, solid }); }
  circleCollider(x, z, r, y0, y1, prop = null, solid = false) { return this.addCollider({ k: 1, x, z, r, y0, y1, prop, solid }); }
  // anything solid a car would hit (buildings, trees, poles, walls) — used by AI feelers
  blocked(x, z, pad = 0) {
    const t = this._bk || (this._bk = []); this.query(x - pad - 1, z - pad - 1, x + pad + 1, z + pad + 1, t);
    for (const c of t) {
      if (c.k === 0) { if (x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad && c.y1 > 0.5) return true; }
      else if (c.k === 2) { if (c.y1 > 0.5 && inPoly(c.pts, x, z, pad)) return true; }
      else if (!c.prop && c.y1 > 0.5) { if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true; }
    }
    return false;
  }
  insideBuilding(x, z, pad = 0) {
    const t = this._ib || (this._ib = []); this.query(x - pad, z - pad, x + pad, z + pad, t);
    for (const c of t) {
      if (!c.solid) continue;
      if (c.k === 0) { if (x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad) return true; }
      else if (c.k === 2) { if (inPoly(c.pts, x, z, pad)) return true; }
      else if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
    }
    return false;
  }
  onSlab(x, z) { return this.ground(x, z) > 0.05 && Math.abs(x) < LIMIT - 1 && Math.abs(z) < LIMIT - 1; }

  // ======================= road graph =======================
  nodePos(k, l) { return [k * P - HALF, l * P - HALF]; }
  nodeIndex(k, l) { return l * (NB + 1) + k; }
  isDiagNode(k, l) { return !!(this.diagAdj && this.diagAdj.has(k + ',' + l)); }
  isDiagEdge(a, b) { return a[0] !== b[0] && a[1] !== b[1]; }
  // stop-line distance from a node: junctions where an avenue comes in are bigger
  stopDist(k, l, diag = false) { return this.isDiagNode(k, l) ? (diag ? 23 : 20) : STOP; }
  nearestNode(x, z) { const k = clamp(Math.round((x + HALF) / P), 0, NB), l = clamp(Math.round((z + HALF) / P), 0, NB); return [k, l]; }
  neighbors(k, l) {
    const out = []; if (k > 0) out.push([k - 1, l]); if (k < NB) out.push([k + 1, l]); if (l > 0) out.push([k, l - 1]); if (l < NB) out.push([k, l + 1]);
    const d = this.diagAdj && this.diagAdj.get(k + ',' + l); if (d) for (const n of d) out.push(n);
    return out;
  }
  // light state for traffic travelling along axis ('x', 'z' or 'd' for an avenue) into node -> 'g' | 'y' | 'r'
  lightState(k, l, axis) {
    if (!this.hasLight(k, l)) return 'g';
    if (this.isDiagNode(k, l)) { // three phases: x, z, then the avenue
      const t = (this.time + (k * 3.1 + l * 5.3)) % 33;
      const ph = axis === 'x' ? 0 : axis === 'z' ? 11 : 22; const u = (t - ph + 33) % 33;
      return u < 8 ? 'g' : u < 10.5 ? 'y' : 'r';
    }
    const t = (this.time + (k * 3.1 + l * 5.3)) % 23;
    if (axis === 'x') return t < 8 ? 'g' : t < 10.5 ? 'y' : 'r';
    return t >= 11.5 && t < 19.5 ? 'g' : t >= 19.5 && t < 22 ? 'y' : 'r';
  }
  axisOf(a, b) { return a[1] === b[1] ? 'x' : a[0] === b[0] ? 'z' : 'd'; }
  hasLight(k, l) { const edge = (k === 0 || k === NB) + (l === 0 || l === NB); return edge < 2; }
  // lane polyline from node a to node b in lane li
  lanePath(ak, al, bk, bl, li) {
    const [ax, az] = this.nodePos(ak, al), [bx, bz] = this.nodePos(bk, bl);
    let dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; const rx = -dz, rz = dx; const off = LANES[li];
    const dg = ak !== bk && al !== bl; const sa = this.stopDist(ak, al, dg), sb = this.stopDist(bk, bl, dg);
    return [[ax + dx * sa + rx * off, az + dz * sa + rz * off], [bx - dx * sb + rx * off, bz - dz * sb + rz * off]];
  }
  turnPath(ak, al, bk, bl, ck, cl, li, lo = li) { // through node b from a towards c (any angle)
    const [ax, az] = this.nodePos(ak, al), [bx, bz] = this.nodePos(bk, bl), [cx, cz] = this.nodePos(ck, cl);
    let d1x = bx - ax, d1z = bz - az, d2x = cx - bx, d2z = cz - bz; const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1; d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    const o1 = LANES[li], o2 = LANES[lo];
    const s1 = this.stopDist(bk, bl, ak !== bk && al !== bl), s2 = this.stopDist(bk, bl, bk !== ck && bl !== cl);
    const p0 = [bx - d1x * s1 - d1z * o1, bz - d1z * s1 + d1x * o1];
    const p2 = [bx + d2x * s2 - d2z * o2, bz + d2z * s2 + d2x * o2];
    const cr = d1x * d2z - d1z * d2x; let c;
    if (Math.abs(cr) < 0.05) c = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
    else { // control point where the incoming and outgoing lane lines meet
      const t = clamp(((p2[0] - p0[0]) * d2z - (p2[1] - p0[1]) * d2x) / cr, 1, Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) * 1.3);
      c = [p0[0] + d1x * t, p0[1] + d1z * t];
    }
    const pts = []; const n = 8;
    for (let i = 1; i <= n; i++) { const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t; pts.push([a * p0[0] + b * c[0] + d * p2[0], a * p0[1] + b * c[1] + d * p2[1]]); }
    return pts;
  }
  // BFS route on the grid between nodes -> list of [k,l]
  route(from, to) {
    const N = NB + 1, key = (k, l) => l * N + k; const prev = new Map(); const q = [from]; prev.set(key(...from), null);
    while (q.length) { const cur = q.shift(); if (cur[0] === to[0] && cur[1] === to[1]) break; for (const nb of this.neighbors(...cur)) { const kk = key(...nb); if (!prev.has(kk)) { prev.set(kk, cur); q.push(nb); } } }
    const path = []; let c = to; while (c) { path.unshift(c); c = prev.get(key(...c)); } return path;
  }

  // ======================= build =======================
  async build(progress = () => {}) {
    const R = rng(20251120);
    const step = async (p, label) => { progress(p, label); await new Promise((r) => setTimeout(r, 0)); };
    await step(0.05, 'Pouring asphalt');
    this.setupDiagonals();
    this.makeMaterials();
    this.buildGround();
    await step(0.15, 'Painting the streets');
    this.buildMarkings();
    await step(0.25, 'Zoning the districts');
    this.layoutBlocks(R);
    await step(0.35, 'Raising the skyline');
    this.buildBlocks(R);
    await step(0.6, 'Wiring the traffic lights');
    this.buildIntersections();
    this.buildStreetFurniture(R);
    this.buildAvenueFurniture(R);
    await step(0.72, 'Planting trees');
    this.buildEdge(R);
    this.finishMeshes();
    await step(0.8, 'Building ramps');
    this.props.finish();
  }

  makeMaterials() {
    const a = TX.asphalt(); this.asphaltTex = a;
    this.mat = {};
    this.mat.asphalt = new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normalMap, roughnessMap: a.roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6) });
    const cw = TX.concrete(2, 150); const cw2 = TX.concrete(1, 130);
    this.mat.sidewalk = new THREE.MeshStandardMaterial({ map: cw.map, normalMap: cw.normalMap, roughness: 0.92, vertexColors: true });
    this.mat.curb = new THREE.MeshStandardMaterial({ map: cw2.map, roughness: 0.9, color: 0xd8d6d0 });
    const gr = TX.grass(); this.mat.grass = new THREE.MeshStandardMaterial({ map: gr.map, normalMap: gr.normalMap, roughness: 0.95 });
    this.mat.roof = new THREE.MeshStandardMaterial({ map: TX.gravel(), roughness: 0.95, vertexColors: true });
    this.mat.props = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.2 });
    this.mat.metal = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.45, metalness: 0.8 });
    this.mat.line = new THREE.MeshStandardMaterial({ color: 0xc9c9c4, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mat.yline = new THREE.MeshStandardMaterial({ color: 0xc89a18, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mat.chevron = new THREE.MeshStandardMaterial({ map: TX.chevrons(), roughness: 0.6 });
    this.mat.sand = new THREE.MeshStandardMaterial({ map: TX.sand(), roughness: 1 });
    this.styles = ['glass', 'teal', 'office', 'brick', 'dark', 'stucco', 'warehouse'];
    this.facade = {};
    for (const s of this.styles) {
      const f = TX.facade(s, this.styles.indexOf(s) + 1);
      const m = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughnessMap: f.rm, metalnessMap: f.rm, roughness: 1, metalness: 1, vertexColors: true });
      this.facade[s] = { mat: m, tw: f.tileW, th: f.tileH, gb: new GB() }; this.facadeMats.push(m);
    }
    this.shops = [];
    for (let i = 0; i < 6; i++) { const f = TX.shopfront(i * 2 + 1); const m = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughnessMap: f.rm, metalnessMap: f.rm, roughness: 1, metalness: 1 }); this.shops.push({ mat: m, gb: new GB() }); this.facadeMats.push(m); }
    this.gb = { side: new GB(), top: new GB(), grass: new GB(), curb: new GB(), roof: new GB(), props: new GB(), metal: new GB(), asphalt: new GB(), chevron: new GB(), sand: new GB() };
  }

  buildGround() {
    const S = (LIMIT + 2) * 2;
    const g = new THREE.PlaneGeometry(S, S); g.rotateX(-Math.PI / 2);
    for (const t of [this.asphaltTex.map, this.asphaltTex.normalMap, this.asphaltTex.roughnessMap]) t.repeat.set(S / 12, S / 12);
    const m = new THREE.Mesh(g, this.mat.asphalt); m.receiveShadow = true; this.root.add(m);
  }

  buildMarkings() {
    const quads = [], yq = [];
    const add = (arr, x, z, yaw, w, l) => arr.push([x, z, yaw, w, l]);
    // segments along X (constant z) and along Z (constant x)
    for (let l = 0; l <= NB; l++) for (let k = 0; k < NB; k++) {
      for (const axis of ['x', 'z']) {
        const [ax, az] = axis === 'x' ? this.nodePos(k, l) : this.nodePos(l, k);
        const dx = axis === 'x' ? 1 : 0, dz = axis === 'x' ? 0 : 1, yaw = axis === 'x' ? Math.PI / 2 : 0;
        const [kA, lA] = axis === 'x' ? [k, l] : [l, k], [kB, lB] = axis === 'x' ? [k + 1, l] : [l, k + 1];
        const stA = this.stopDist(kA, lA), stB = this.stopDist(kB, lB);
        const s0 = stA - 0.4, s1 = P - stB + 0.4, len = s1 - s0, mid = (s0 + s1) / 2;
        const at = (s, off) => [ax + dx * s - dz * off, az + dz * s + dx * off];
        for (const off of [-0.16, 0.16]) { const [x, z] = at(mid, off); add(yq, x, z, yaw, 0.12, len); }
        for (const off of [-7.4, 7.4]) { const [x, z] = at(mid, off); add(quads, x, z, yaw, 0.16, len); }
        for (const off of [-3.8, 3.8]) for (let s = s0 + 2; s < s1 - 3; s += 9) { const [x, z] = at(s + 1.5, off); add(quads, x, z, yaw, 0.13, 3); }
        // parking bay ticks
        for (const off of [-8.7, 8.7]) for (let s = 20.75; s < P - 20; s += 6.5) { const [x, z] = at(s, off); add(quads, x, z, yaw + Math.PI / 2, 0.1, 2.4); }
        // stop lines (inbound side) + crosswalks at both ends
        for (const [s, sideSign] of [[stA, -1], [P - stB, 1]]) {
          const [x, z] = at(s, sideSign * 3.8); add(quads, x, z, yaw + Math.PI / 2, 0.45, 7.2);
          const cs = s - sideSign * -2.0; // crosswalk centre just inside the stop line
          for (let o = -9.2; o <= 9.2; o += 1.25) { const [cx, cz] = at(s + sideSign * 2.2, o); add(quads, cx, cz, yaw, 0.62, 3.0); }
          void cs;
        }
      }
    }
    // the avenues: double yellow, lane dashes, edge lines, stop lines and zebra crossings at both ends
    for (const D of this.diags) for (let i = 0; i + 1 < D.nodes.length; i++) {
      const [ax, az] = this.nodePos(...D.nodes[i]), [bx, bz] = this.nodePos(...D.nodes[i + 1]); const L = Math.hypot(bx - ax, bz - az); const dx = (bx - ax) / L, dz = (bz - az) / L; const yaw = Math.atan2(dx, dz);
      const at = (s, off) => [ax + dx * s - dz * off, az + dz * s + dx * off]; const s0 = 22.6, s1 = L - 22.6, mid = (s0 + s1) / 2;
      for (const off of [-0.16, 0.16]) { const [x, z] = at(mid, off); add(yq, x, z, yaw, 0.12, s1 - s0); }
      for (const off of [-7.4, 7.4]) { const [x, z] = at(mid, off); add(quads, x, z, yaw, 0.16, s1 - s0); }
      for (const off of [-3.8, 3.8]) for (let s = s0 + 2; s < s1 - 3; s += 9) { const [x, z] = at(s + 1.5, off); add(quads, x, z, yaw, 0.13, 3); }
      for (const [s, side] of [[23, -1], [L - 23, 1]]) {
        const [x, z] = at(s, side * 3.8); add(quads, x, z, yaw + Math.PI / 2, 0.45, 7.2);
        for (let o = -7.2; o <= 7.2; o += 1.25) { const [cx, cz] = at(s + side * 2.4, o); add(quads, cx, cz, yaw, 0.62, 3.0); }
      }
    }
    const make = (arr, mat) => {
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      const im = new THREE.InstancedMesh(g, mat, arr.length); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      arr.forEach(([x, z, yaw, w, l], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); p.set(x, 0.012, z); s.set(w, 1, l); m4.compose(p, q, s); im.setMatrixAt(i, m4); });
      im.receiveShadow = true; im.frustumCulled = false; this.root.add(im);
    };
    make(quads, this.mat.line); make(yq, this.mat.yline);
  }

  setupDiagonals() {
    this.diagAdj = new Map(); this.diagBlocks = new Map(); this.diags = DIAGS;
    const add = (a, b) => { const k = a[0] + ',' + a[1]; if (!this.diagAdj.has(k)) this.diagAdj.set(k, []); this.diagAdj.get(k).push(b); };
    for (const D of DIAGS) {
      let [k, l] = D.from; D.nodes = [[k, l]];
      for (let st = 0; st < D.n; st++) {
        const nk = k + D.dir[0], nl = l + D.dir[1]; add([k, l], [nk, nl]); add([nk, nl], [k, l]);
        this.diagBlocks.set(Math.min(k, nk) + ',' + Math.min(l, nl), D.dir[0] * D.dir[1] > 0 ? 1 : -1); k = nk; l = nl; D.nodes.push([k, l]);
      }
    }
  }
  // sidewalk loops pedestrians walk round, and which corners connect across a street (straight across a grid
  // street, or square across an avenue)
  linkRings() {
    const all = []; for (const r of this.rings) r.pts.forEach((p, i) => all.push([r, i, p]));
    for (const [r, i, p] of all) {
      r.links[i] = [];
      for (const [r2, j, q] of all) {
        if (r2 === r) continue; const dx = q[0] - p[0], dz = q[1] - p[1], d = Math.hypot(dx, dz); if (d > 30 || d < 3) continue;
        const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2; if (this.ground(mx, mz) > 0.05) continue;
        const [nk, nl] = this.nearestNode(mx, mz); const [nx, nz] = this.nodePos(nk, nl); if (Math.hypot(mx - nx, mz - nz) < 9) continue;
        const grid = Math.abs(dx) < 2.5 || Math.abs(dz) < 2.5;
        const b = r.block, b2 = r2.block; const avenue = b === b2 && b.diag && Math.abs(Math.abs(dx) - Math.abs(dz)) < 3 && Math.sign(dx) * Math.sign(dz) === -b.diag;
        if (grid || avenue) r.links[i].push({ ring: r2, idx: j });
      }
    }
  }
  layoutBlocks(R) {
    for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) {
      const cx = (i + 0.5) * P - HALF, cz = (j + 0.5) * P - HALF;
      let district = 'midtown';
      if (i >= 3 && i <= 5 && j >= 3 && j <= 5) district = 'downtown';
      else if (j >= 7) district = 'harbor';
      else if (i >= 7) district = 'industrial';
      else if (i <= 1) district = 'heights';
      let kind = SPECIAL_BLOCKS[`${i},${j}`] || 'buildings';
      const b = { i, j, cx, cz, district, kind, districtName: DISTRICTS[kind === 'park' ? 'park' : kind === 'stunt' ? 'stunt' : district].name, alley: null, items: [] };
      if (kind === 'buildings' && district !== 'downtown' && R.chance(0.5)) b.alley = R.chance(0.5) ? 'x' : 'z';
      b.diag = this.diagBlocks.get(i + ',' + j) || 0; if (b.diag) b.alley = null;
      const sq = [[cx - SLAB, cz - SLAB], [cx + SLAB, cz - SLAB], [cx + SLAB, cz + SLAB], [cx - SLAB, cz + SLAB]];
      if (!b.diag) b.pieces = [sq];
      else if (b.diag > 0) b.pieces = [[[cx + HH - SLAB, cz - SLAB], [cx + SLAB, cz - SLAB], [cx + SLAB, cz + SLAB - HH]], [[cx - SLAB, cz + HH - SLAB], [cx + SLAB - HH, cz + SLAB], [cx - SLAB, cz + SLAB]]].map(orient);
      else b.pieces = [[[cx + SLAB, cz + HH - SLAB], [cx + SLAB, cz + SLAB], [cx + HH - SLAB, cz + SLAB]], [[cx - SLAB, cz - SLAB], [cx + SLAB - HH, cz - SLAB], [cx - SLAB, cz + SLAB - HH]]].map(orient);
      b.rings = b.pieces.map((pc) => ({ pts: inset(pc, 2.6), block: b, links: [] })); this.rings.push(...b.rings);
      this.blocks.push(b);
    }
    // landmarks
    const at = (i, j) => this.blocks[j * NB + i];
    at(1, 3).special = 'spray'; at(6, 6).special = 'spray'; at(5, 2).special = 'police'; at(3, 6).special = 'hospital';
    at(1, 3).alley = null; at(6, 6).alley = null; at(5, 2).alley = null; at(3, 6).alley = null;
    at(4, 4).special = 'tower';
    at(3, 1).special = 'store'; at(3, 1).alley = null; at(7, 5).special = 'store'; at(7, 5).alley = null;
    this.linkRings();
  }

  // ---------- blocks ----------
  buildBlocks(R) {
    const G = this.gb;
    for (const b of this.blocks) {
      const { cx, cz } = b; const x0 = cx - SLAB, x1 = cx + SLAB, z0 = cz - SLAB, z1 = cz + SLAB;
      // curb sides
      if (!b.diag) G.curb.sides(x0, x1, 0, CURB, z0, z1, 3, 3, [1, 1, 1]);
      const sidewalkCol = b.district === 'downtown' ? [0.95, 0.95, 0.97] : b.district === 'industrial' || b.district === 'harbor' ? [0.82, 0.8, 0.78] : [0.9, 0.88, 0.85];
      if (b.kind === 'park') {
        // sidewalk ring + grass lot + crossing paths
        const L = LOT;
        G.top.top(x0, x1, CURB, z0, cz - L, 4, sidewalkCol); G.top.top(x0, x1, CURB, cz + L, z1, 4, sidewalkCol);
        G.top.top(x0, cx - L, CURB, cz - L, cz + L, 4, sidewalkCol); G.top.top(cx + L, x1, CURB, cz - L, cz + L, 4, sidewalkCol);
        G.grass.top(cx - L, cx + L, CURB + 0.004, cz - L, cz + L, 6);
        G.top.top(cx - 2.2, cx + 2.2, CURB + 0.01, cz - L, cz + L, 4, [0.86, 0.82, 0.74]); G.top.top(cx - L, cx + L, CURB + 0.011, cz - 2.2, cz + 2.2, 4, [0.86, 0.82, 0.74]);
        this.buildPark(b, R);
      } else if (b.kind === 'stunt' || b.kind === 'parking') {
        const L = LOT;
        G.top.top(x0, x1, CURB, z0, cz - L, 4, sidewalkCol); G.top.top(x0, x1, CURB, cz + L, z1, 4, sidewalkCol);
        G.top.top(x0, cx - L, CURB, cz - L, cz + L, 4, sidewalkCol); G.top.top(cx + L, x1, CURB, cz - L, cz + L, 4, sidewalkCol);
        G.asphalt.top(cx - L, cx + L, CURB + 0.003, cz - L, cz + L, 12);
        if (b.kind === 'stunt') this.buildStuntYard(b, R); else this.buildParkingLot(b, R);
      } else if (b.kind === 'plaza') {
        G.top.top(x0, x1, CURB, z0, z1, 4, [0.92, 0.88, 0.82]);
        this.buildPlaza(b, R);
      } else if (b.diag) { // split by an avenue: two wedge-shaped islands
        for (const pc of b.pieces) { G.curb.prism(pc, 0, CURB, 3, 3, [1, 1, 1]); G.top.poly(pc, CURB, 4, sidewalkCol); }
        this.buildWedges(b, R);
      } else {
        G.top.top(x0, x1, CURB, z0, z1, 4, sidewalkCol);
        this.buildLot(b, R);
      }
    }
  }

  buildLot(b, R) {
    const { cx, cz } = b; const L = LOT; let rects = [[cx - L, cz - L, cx + L, cz + L]];
    if (b.alley) {
      const w = 4;
      if (b.alley === 'x') { rects = [[cx - L, cz - L, cx + L, cz - w], [cx - L, cz + w, cx + L, cz + L]]; this.gb.asphalt.top(cx - SLAB, cx + SLAB, CURB + 0.004, cz - w, cz + w, 12); this.alleys.push({ x0: cx - SLAB, x1: cx + SLAB, z0: cz - w, z1: cz + w, axis: 'x', cx, cz }); }
      else { rects = [[cx - L, cz - L, cx - w, cz + L], [cx + w, cz - L, cx + L, cz + L]]; this.gb.asphalt.top(cx - w, cx + w, CURB + 0.004, cz - SLAB, cz + SLAB, 12); this.alleys.push({ x0: cx - w, x1: cx + w, z0: cz - SLAB, z1: cz + SLAB, axis: 'z', cx, cz }); }
      // dumpsters in alley
      for (let k = 0; k < 2; k++) {
        const t = (k ? 1 : -1) * R.range(8, 20);
        const px = b.alley === 'x' ? cx + t : cx + (k ? 2.6 : -2.6), pz = b.alley === 'x' ? cz + (k ? 2.6 : -2.6) : cz + t;
        this.props.add('dumpster', px, pz, b.alley === 'x' ? 0 : Math.PI / 2, CURB);
      }
    }
    // specials reserve the north-west quarter facing the road
    if (b.special === 'spray') rects = this.placeSpray(b, rects);
    if (b.special === 'police') rects = this.placeCivic(b, rects, 'police');
    if (b.special === 'hospital') rects = this.placeCivic(b, rects, 'hospital');
    if (b.special === 'store') rects = this.placeStore(b);
    for (const r of rects) this.subdivide(b, r, R, 0);
  }

  subdivide(b, r, R, depth) {
    const [x0, z0, x1, z1] = r; const w = x1 - x0, d = z1 - z0;
    const maxP = { downtown: 34, midtown: 26, heights: 20, industrial: 40, harbor: 34 }[b.district];
    if ((w > maxP || d > maxP) && depth < 4) {
      const alongX = w >= d; const t = R.range(0.38, 0.62);
      if (alongX) { const m = x0 + w * t; this.subdivide(b, [x0, z0, m, z1], R, depth + 1); this.subdivide(b, [m, z0, x1, z1], R, depth + 1); }
      else { const m = z0 + d * t; this.subdivide(b, [x0, z0, x1, m], R, depth + 1); this.subdivide(b, [x0, m, x1, z1], R, depth + 1); }
      return;
    }
    if (w < 6 || d < 6) return;
    this.makeBuilding(b, x0, z0, x1, z1, R);
  }

  pickBuilding(b, R) {
    const D = b.district; const dist = Math.hypot(b.cx, b.cz);
    let h, style;
    if (D === 'downtown') { h = R.range(55, 120) + Math.max(0, 160 - dist * 0.9) * R.range(0.3, 0.9); style = R.pick(['glass', 'glass', 'teal', 'dark', 'office']); }
    else if (D === 'midtown') { h = R.range(14, 48); style = R.pick(['office', 'stucco', 'brick', 'dark', 'office', 'glass']); }
    else if (D === 'heights') { h = R.range(9, 26); style = R.pick(['brick', 'brick', 'stucco']); }
    else { h = R.range(7, 15); style = R.pick(['warehouse', 'warehouse', 'brick']); }
    let tower = false; if (b.special === 'tower' && !b.towerDone) { h = 245; b.towerDone = true; tower = true; }
    const tintBase = style === 'stucco' ? R.pick([0xf4e1c6, 0xe8d0d0, 0xd6e4e8, 0xf0ecd8, 0xdde5cf, 0xf3d6b8]) : style === 'warehouse' ? R.pick([0xb8c0c8, 0xc9a68b, 0x9fb3a6, 0xd0d0d0]) : 0xffffff;
    return { h, style, tint: hexCol(tintBase, R.range(0.86, 1.04)), tower };
  }
  makeBuilding(b, x0, z0, x1, z1, R) {
    const D = b.district; const gap = D === 'downtown' ? 0.6 : R.range(0.4, 1.6);
    x0 += gap; z0 += gap; x1 -= gap; z1 -= gap;
    const { h, style, tint, tower } = this.pickBuilding(b, R);
    const w = x1 - x0, d = z1 - z0, v = R(), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // footprint variety: not every lot gets a plain box
    if (tower) return this.polyBuilding(b, octagon(x0, z0, x1, z1, 0.24), h, style, tint, R, true);
    if ((D === 'downtown' || D === 'midtown') && w > 13 && d > 13 && v < 0.11) return this.roundBuilding(b, cx, cz, Math.min(w, d) / 2, h, D === 'midtown' ? 'glass' : style, tint, R);
    if (D === 'industrial' && w > 9 && d > 9 && v < 0.16) return this.silos(b, x0, z0, x1, z1, R);
    if (D !== 'industrial' && w > 10 && d > 10 && v < 0.27) return this.polyBuilding(b, octagon(x0, z0, x1, z1, R.range(0.14, 0.3)), h, style, tint, R);
    if (D !== 'downtown' && w > 12 && d > 12 && v < 0.38) { this.polyBuilding(b, rotatedRect(x0, z0, x1, z1, R.range(0.22, 0.6) * (R.chance(0.5) ? 1 : -1)), h, style, tint, R); this.lotTrees(b, x0, z0, x1, z1, R); return; }
    const F = this.facade[style]; const y0 = CURB;
    // setback sections for tall buildings
    const sections = [];
    if (h > 70 && R.chance(0.7)) {
      const h1 = h * R.range(0.45, 0.6), h2 = h * R.range(0.78, 0.88); const ins1 = R.range(0.12, 0.2), ins2 = R.range(0.25, 0.34);
      sections.push([x0, z0, x1, z1, y0, y0 + h1]);
      sections.push([x0 + w * ins1, z0 + d * ins1, x1 - w * ins1, z1 - d * ins1, y0 + h1, y0 + h2]);
      sections.push([x0 + w * ins2, z0 + d * ins2, x1 - w * ins2, z1 - d * ins2, y0 + h2, y0 + h]);
    } else sections.push([x0, z0, x1, z1, y0, y0 + h]);
    const hasShop = (D === 'midtown' || D === 'heights' || D === 'downtown') && style !== 'warehouse';
    for (const [sx0, sz0, sx1, sz1, sy0, sy1] of sections) {
      F.gb.sides(sx0, sx1, sy0, sy1, sz0, sz1, F.tw, F.th, tint, sy0 - y0);
      this.gb.roof.top(sx0, sx1, sy1, sz0, sz1, 4, [0.75, 0.75, 0.75]);
      if (style !== 'glass' && style !== 'teal') { // parapet
        const p = 0.35, ph = 0.9, col = [0.62, 0.6, 0.58];
        this.gb.props.box(sx0, sx1, sy1, sy1 + ph, sz0, sz0 + p, col); this.gb.props.box(sx0, sx1, sy1, sy1 + ph, sz1 - p, sz1, col);
        this.gb.props.box(sx0, sx0 + p, sy1, sy1 + ph, sz0, sz1, col); this.gb.props.box(sx1 - p, sx1, sy1, sy1 + ph, sz0, sz1, col);
      } else {
        this.gb.metal.box(sx0 - 0.15, sx1 + 0.15, sy1 - 0.2, sy1 + 0.5, sz0 - 0.15, sz1 + 0.15, [1, 1, 1]);
      }
    }
    if (hasShop && h > 8) { const S = R.pick(this.shops); S.gb.sides(x0 - 0.25, x1 + 0.25, y0, y0 + 4.5, z0 - 0.25, z1 + 0.25, 12, 4.5, [1, 1, 1]); this.gb.metal.box(x0 - 0.6, x1 + 0.6, y0 + 4.5, y0 + 4.85, z0 - 0.6, z1 + 0.6, [1, 1, 1]); }
    // rooftop clutter on the top section
    const [tx0, tz0, tx1, tz1, , ty] = sections[sections.length - 1];
    const tw = tx1 - tx0, td = tz1 - tz0;
    const nAC = Math.floor(R.range(1, 4));
    for (let k = 0; k < nAC; k++) { const ax = R.range(tx0 + 1.5, tx1 - 3.5), az = R.range(tz0 + 1.5, tz1 - 3.5); this.gb.props.box(ax, ax + 2, ty, ty + 1.2, az, az + 1.6, [0.72, 0.74, 0.76]); this.gb.props.box(ax + 0.3, ax + 1.7, ty + 1.2, ty + 1.3, az + 0.3, az + 1.3, [0.3, 0.3, 0.32]); }
    if (style === 'brick' && R.chance(0.5) && tw > 8) this.waterTower(tx0 + tw * 0.7, tz0 + td * 0.3, ty, R);
    if (h > 120) { const ax = (tx0 + tx1) / 2, az = (tz0 + tz1) / 2; const hgt = R.range(12, 30); const m = new THREE.Matrix4().makeTranslation(ax, ty + hgt / 2, az); this.gb.metal.geo(new THREE.CylinderGeometry(0.25, 0.5, hgt, 6), m, [1, 1, 1]); this.props.beacon(ax, ty + hgt + 0.3, az); }
    if (D === 'downtown' && h > 90 && h < 120 && tw > 14 && td > 14 && R.chance(0.6)) this.helipad((tx0 + tx1) / 2, ty + 0.05, (tz0 + tz1) / 2, Math.min(tw, td) * 0.42);
    if ((D === 'midtown' || D === 'heights') && R.chance(0.16) && tw > 10) this.props.billboard((tx0 + tx1) / 2, ty, (tz0 + tz1) / 2, R.chance(0.5) ? 0 : Math.PI / 2, Math.min(12, tw * 0.9));
    this.boxCollider(x0 - 0.3, x1 + 0.3, z0 - 0.3, z1 + 0.3, 0, CURB + h);
    this.buildings.push({ x0, z0, x1, z1, h, style });
  }
  // any convex footprint: octagons, rotated slabs, flatiron wedges along the avenues
  polyBuilding(b, poly, h, style, tint, R, tower = false) {
    const D = b.district; const F = this.facade[style]; const y0 = CURB; poly = orient(poly);
    const sections = [];
    if (h > 70 && (tower || R.chance(0.7))) { const h1 = h * R.range(0.45, 0.6), h2 = h * R.range(0.78, 0.88); sections.push([poly, y0, y0 + h1], [scalePoly(poly, 0.8), y0 + h1, y0 + h2], [scalePoly(poly, 0.6), y0 + h2, y0 + h]); }
    else sections.push([poly, y0, y0 + h]);
    for (const [sp, sy0, sy1] of sections) {
      F.gb.prism(sp, sy0, sy1, F.tw, F.th, tint, sy0 - y0);
      this.gb.roof.poly(sp, sy1, 4, [0.75, 0.75, 0.75]);
      if (style !== 'glass' && style !== 'teal') this.gb.props.ring(sp, sy1, sy1 + 0.9, 0.35, [0.62, 0.6, 0.58]);
      else this.gb.metal.ring(inset(sp, -0.15), sy1 - 0.2, sy1 + 0.5, 0.3, [1, 1, 1]);
    }
    const hasShop = (D === 'midtown' || D === 'heights' || D === 'downtown') && style !== 'warehouse';
    if (hasShop && h > 8) { const S = R.pick(this.shops); S.gb.prism(inset(poly, -0.25), y0, y0 + 4.5, 12, 4.5, [1, 1, 1]); this.gb.metal.ring(inset(poly, -0.65), y0 + 4.5, y0 + 4.85, 0.45, [1, 1, 1]); }
    const top = sections[sections.length - 1][0], ty = sections[sections.length - 1][2]; const [bx0, bz0, bx1, bz1] = bbox(top); const [ccx, ccz] = centroid(top);
    for (let k = 0, n = 0; k < 12 && n < 3; k++) { const ax = R.range(bx0, bx1), az = R.range(bz0, bz1); if (!inPoly(top, ax, az, -2.4)) continue; n++; this.gb.props.box(ax - 1, ax + 1, ty, ty + 1.2, az - 0.8, az + 0.8, [0.72, 0.74, 0.76]); this.gb.props.box(ax - 0.7, ax + 0.7, ty + 1.2, ty + 1.3, az - 0.5, az + 0.5, [0.3, 0.3, 0.32]); }
    if (h > 120) { const hgt = R.range(14, 34); const m = new THREE.Matrix4().makeTranslation(ccx, ty + hgt / 2, ccz); this.gb.metal.geo(new THREE.CylinderGeometry(0.25, 0.55, hgt, 6), m, [1, 1, 1]); this.props.beacon(ccx, ty + hgt + 0.3, ccz); }
    else if (style === 'brick' && R.chance(0.4) && inPoly(top, ccx, ccz, -3)) this.waterTower(ccx, ccz, ty, R);
    this.polyCollider(inset(poly, -0.3), 0, CURB + h);
    const [x0, z0, x1, z1] = bbox(poly); this.buildings.push({ x0, z0, x1, z1, h, style, poly });
  }
  roundBuilding(b, cx, cz, r, h, style, tint, R) {
    const N = 22; const circ = (rr) => Array.from({ length: N }, (_, i) => { const a = (i / N) * Math.PI * 2; return [cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]; });
    const D = b.district; const F = this.facade[style]; const y0 = CURB; const tiers = h > 70 ? [[1, 0.5], [0.84, 0.82], [0.66, 1]] : [[1, 1]];
    let yb = y0;
    for (const [k, f] of tiers) {
      const yt = y0 + h * f; const pts = orient(circ(r * k));
      F.gb.prism(pts, yb, yt, F.tw, F.th, tint, yb - y0); this.gb.roof.poly(pts, yt, 4, [0.75, 0.75, 0.75]); this.gb.metal.ring(orient(circ(r * k + 0.2)), yt - 0.2, yt + 0.6, 0.35, [1, 1, 1]); yb = yt;
    }
    if ((D === 'midtown' || D === 'downtown') && h > 8) { const S = R.pick(this.shops); S.gb.prism(orient(circ(r + 0.25)), y0, y0 + 4.5, 12, 4.5, [1, 1, 1]); }
    const top = r * tiers[tiers.length - 1][0];
    if (h > 120) { const hgt = R.range(18, 36); const m = new THREE.Matrix4().makeTranslation(cx, y0 + h + hgt / 2, cz); this.gb.metal.geo(new THREE.CylinderGeometry(0.25, 0.6, hgt, 6), m, [1, 1, 1]); this.props.beacon(cx, y0 + h + hgt + 0.3, cz); }
    else if (top > 8 && h > 40 && R.chance(0.5)) this.helipad(cx, y0 + h + 0.05, cz, top * 0.6);
    this.circleCollider(cx, cz, r + 0.3, 0, CURB + h, null, true);
    this.buildings.push({ x0: cx - r, z0: cz - r, x1: cx + r, z1: cz + r, h, style, poly: circ(r), round: true });
    this.lotTrees(b, cx - r, cz - r, cx + r, cz + r, R);
  }
  // grain silos / tanks for the industrial district
  silos(b, x0, z0, x1, z1, R) {
    const w = x1 - x0, d = z1 - z0, along = w >= d; const n = Math.max(1, Math.min(4, Math.floor((along ? w : d) / ((along ? d : w) * 0.95)))); const r = (along ? d : w) * 0.42; const h = R.range(12, 22);
    const F = this.facade.warehouse; const col = hexCol(R.pick([0xd9d9d6, 0xc8ccd0, 0xb9b2a4]), 1);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n; const cx = along ? x0 + w * t : (x0 + x1) / 2, cz = along ? (z0 + z1) / 2 : z0 + d * t;
      const pts = orient(Array.from({ length: 18 }, (_, k) => { const a = (k / 18) * Math.PI * 2; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; }));
      F.gb.prism(pts, CURB, CURB + h, F.tw, F.th, col); this.gb.roof.poly(pts, CURB + h, 4, [0.7, 0.7, 0.7]);
      const m = new THREE.Matrix4().makeTranslation(cx, CURB + h + r * 0.3, cz); this.gb.metal.geo(new THREE.ConeGeometry(r * 1.02, r * 0.6, 18), m, [1, 1, 1]);
      this.circleCollider(cx, cz, r + 0.25, 0, CURB + h + r * 0.6, null, true);
      this.buildings.push({ x0: cx - r, z0: cz - r, x1: cx + r, z1: cz + r, h, style: 'warehouse', poly: pts, round: true });
    }
  }
  // a few street trees in the open space a rotated or round building leaves behind
  lotTrees(b, x0, z0, x1, z1, R) {
    if (b.district === 'industrial') return;
    for (const [x, z] of [[x0 + 1.2, z0 + 1.2], [x1 - 1.2, z0 + 1.2], [x1 - 1.2, z1 - 1.2], [x0 + 1.2, z1 - 1.2]]) if (R.chance(0.6) && !this.insideBuilding(x, z, 1.4) && this.onSlab(x, z)) this.props.tree(x, z, CURB, R.range(0.6, 0.85), 'leaf');
  }
  // split blocks along an avenue: a regular corner building plus two wedges with blunt flatiron noses
  buildWedges(b, R) {
    for (const pc of b.pieces) {
      const lot = inset(pc, SW); const n = lot.length; let ci = 0;
      for (let i = 0; i < n; i++) { const a = lot[(i - 1 + n) % n], c0 = lot[i], c1 = lot[(i + 1) % n]; const ux = a[0] - c0[0], uz = a[1] - c0[1], vx = c1[0] - c0[0], vz = c1[1] - c0[1]; if (Math.abs(ux * vx + uz * vz) < 1e-3 * Math.hypot(ux, uz) * Math.hypot(vx, vz)) { ci = i; break; } }
      const C = lot[ci], T1 = lot[(ci + 1) % n], T2 = lot[(ci - 1 + n) % n]; const U = [T1[0] - C[0], T1[1] - C[1]], V = [T2[0] - C[0], T2[1] - C[1]];
      const s = R.range(0.38, 0.46); const at = (u, v) => [C[0] + U[0] * u + V[0] * v, C[1] + U[1] * u + V[1] * v];
      const [qx0, qz0, qx1, qz1] = bbox([at(0, 0), at(s, 0), at(s, s), at(0, s)]); this.subdivide(b, [qx0, qz0, qx1, qz1], R, 2);
      for (const w of [orient([at(s, 0), at(1, 0), at(s, 1 - s)]), orient([at(0, s), at(s, s), at(s, 1 - s), at(0, 1)])]) {
        const { h, style, tint } = this.pickBuilding(b, R); this.polyBuilding(b, bluntTips(inset(w, 0.7), 2.4), h, style, tint, R);
      }
    }
  }
  waterTower(x, z, y, R) {
    const wood = [0.42, 0.28, 0.18]; const m = new THREE.Matrix4();
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { m.makeTranslation(x + dx * 1.2, y + 1.5, z + dz * 1.2); this.gb.props.geo(new THREE.CylinderGeometry(0.08, 0.08, 3, 5), m, [0.2, 0.2, 0.2]); }
    m.makeTranslation(x, y + 4.4, z); this.gb.props.geo(new THREE.CylinderGeometry(1.8, 1.8, 3, 14), m, wood);
    m.makeTranslation(x, y + 6.5, z); this.gb.props.geo(new THREE.ConeGeometry(2.0, 1.3, 14), m, [0.25, 0.2, 0.18]);
    void R;
  }
  helipad(x, y, z, r) {
    const g = new THREE.CircleGeometry(r, 32); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TX.helipad(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, y + 0.02, z); m.receiveShadow = true; this.root.add(m);
  }

  placeSpray(b, rects) {
    // garage on the block's north side (-z), door facing the north road
    const { cx, cz } = b; const gx = cx - 8, gz0 = cz - LOT, w = 14, d = 16, h = 6.5, door = 8;
    const x0 = gx - w / 2, x1 = gx + w / 2, z0 = gz0, z1 = gz0 + d; const col = [0.36, 0.52, 0.74];
    const t = 0.5;
    this.gb.props.box(x0, x0 + t, CURB, h, z0, z1, col); this.gb.props.box(x1 - t, x1, CURB, h, z0, z1, col);
    this.gb.props.box(x0, x1, CURB, h, z1 - t, z1, col);
    this.gb.props.box(x0, gx - door / 2, CURB, h, z0, z0 + t, col); this.gb.props.box(gx + door / 2, x1, CURB, h, z0, z0 + t, col);
    this.gb.props.box(gx - door / 2, gx + door / 2, 4.8, h, z0, z0 + t, col);
    this.gb.roof.top(x0, x1, h, z0, z1, 4, [0.7, 0.7, 0.7]);
    this.gb.props.box(x0 + t, x1 - t, CURB, CURB + 0.02, z0 + t, z1 - t, [0.25, 0.27, 0.3]);
    this.boxCollider(x0, x0 + t, z0, z1, 0, h); this.boxCollider(x1 - t, x1, z0, z1, 0, h); this.boxCollider(x0, x1, z1 - t, z1, 0, h);
    this.boxCollider(x0, gx - door / 2, z0, z0 + t, 0, h); this.boxCollider(gx + door / 2, x1, z0, z0 + t, 0, h);
    const sign = this.props.sign('PAY & SPRAY', gx, h + 1.3, z0 - 0.4, Math.PI, 11, 2.4, { bg: '#0b3d91', fg: '#ffffff', border: '#ffd60a' });
    // roll-up door (animated by gameplay)
    const dm = new THREE.Mesh(new THREE.BoxGeometry(door, 4.6, 0.12), new THREE.MeshStandardMaterial({ map: TX.corrugated('#9aa3ad'), roughness: 0.5, metalness: 0.6 }));
    dm.position.set(gx, 4.8 + 2.3, z0 + 0.2); dm.castShadow = true; this.root.add(dm);
    this.buildings.push({ x0, z0, x1, z1, h, style: 'spray' });
    (this.specials.spray || (this.specials.spray = [])).push({ x: gx, z: (z0 + z1) / 2 + 1, x0: x0 + 1, x1: x1 - 1, z0: z0 + 1.5, z1: z1 - 1.5, door: dm, doorOpenY: 4.8 + 2.3, doorClosedY: CURB + 2.3, sign, entrance: [gx, z0 - 12] });
    // remaining lot space
    return rects.flatMap(([a, c, e, f]) => [[x1 + 1, c, e, f], [a, z1 + 1, x1 + 1, f]]).filter(([a, c, e, f]) => e - a > 6 && f - c > 6);
  }

  // walk-in gun store: brick shell with an open doorway, pegboard gun wall, counter and a clerk
  placeStore(b) {
    const { cx, cz } = b; const x0 = cx + 2, x1 = cx + 16, z0 = cz - LOT, z1 = z0 + 13, h = CURB + 5.2, t = 0.3, dw = 2.6, dh = CURB + 3.1; const gx = (x0 + x1) / 2;
    if (!this.storeMat) {
      this.storeMat = {
        peg: new THREE.MeshStandardMaterial({ map: TX.pegboard(), roughness: 0.8, emissive: 0x2a1c0c, emissiveIntensity: 0.6 }),
        floor: new THREE.MeshStandardMaterial({ map: TX.tiles(), roughness: 0.35, metalness: 0.1 }),
        ceil: new THREE.MeshStandardMaterial({ map: TX.ceilingPanels(), emissiveMap: TX.ceilingPanels(), emissive: 0xffffff, emissiveIntensity: 1.6 }),
        glass: new THREE.MeshPhysicalMaterial({ color: 0x9fd3e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 }),
      };
      this.storeGB = { peg: new GB(), floor: new GB(), ceil: new GB() };
    }
    const F = this.facade.brick; const tint = [0.78, 0.42, 0.38];
    const wall = (ax0, ax1, ay0, ay1, az0, az1) => { F.gb.sides(ax0, ax1, ay0, ay1, az0, az1, F.tw, F.th, tint, ay0 - CURB); this.gb.roof.top(ax0, ax1, ay1, az0, az1, 4, [0.6, 0.6, 0.6]); this.boxCollider(ax0, ax1, az0, az1, 0, ay1); };
    wall(x0, x1, CURB, h, z1 - t, z1); wall(x0, x0 + t, CURB, h, z0, z1); wall(x1 - t, x1, CURB, h, z0, z1);
    wall(x0, gx - dw / 2, CURB, h, z0, z0 + t); wall(gx + dw / 2, x1, CURB, h, z0, z0 + t);
    F.gb.sides(gx - dw / 2, gx + dw / 2, dh, h, z0, z0 + t, F.tw, F.th, tint, dh - CURB);
    this.gb.roof.top(x0, x1, h, z0, z1, 4, [0.7, 0.7, 0.7]);
    const P = this.storeGB, ix0 = x0 + t + 0.01, ix1 = x1 - t - 0.01, iz0 = z0 + t + 0.01, iz1 = z1 - t - 0.01;
    P.peg.quad([ix1, CURB, iz1], [ix0, CURB, iz1], [ix0, h, iz1], [ix1, h, iz1], [0, 0, -1], 0, (ix1 - ix0) / 4, 0, (h - CURB) / 4);
    P.peg.quad([ix0, CURB, iz1], [ix0, CURB, iz0], [ix0, h, iz0], [ix0, h, iz1], [1, 0, 0], 0, (iz1 - iz0) / 4, 0, (h - CURB) / 4);
    P.peg.quad([ix1, CURB, iz0], [ix1, CURB, iz1], [ix1, h, iz1], [ix1, h, iz0], [-1, 0, 0], 0, (iz1 - iz0) / 4, 0, (h - CURB) / 4);
    P.floor.top(ix0, ix1, CURB + 0.02, iz0, iz1, 2.5);
    P.ceil.quad([ix0, h - 0.02, iz0], [ix1, h - 0.02, iz0], [ix1, h - 0.02, iz1], [ix0, h - 0.02, iz1], [0, -1, 0], 0, (ix1 - ix0) / 3, 0, (iz1 - iz0) / 3);
    // counter with a glass top, display rack and a shutter frame around the door
    const cz0 = z1 - 4.4, cz1 = z1 - 3.6;
    this.gb.props.box(x0 + 2.2, x1 - 2.2, CURB, CURB + 1.0, cz0, cz1, [0.32, 0.2, 0.12]);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 4.4, 0.06, 0.8), this.storeMat.glass); glass.position.set(gx, CURB + 1.03, (cz0 + cz1) / 2); this.root.add(glass);
    this.boxCollider(x0 + 2.2, x1 - 2.2, cz0, cz1, 0, CURB + 1.05);
    this.gb.metal.box(x0 + 1.0, x1 - 1.0, CURB, CURB + 0.08, z1 - 1.0, z1 - 0.6, [1, 1, 1]);
    this.gb.metal.box(gx - dw / 2 - 0.15, gx - dw / 2, CURB, dh, z0 - 0.08, z0 + t + 0.08, [1, 1, 1]); this.gb.metal.box(gx + dw / 2, gx + dw / 2 + 0.15, CURB, dh, z0 - 0.08, z0 + t + 0.08, [1, 1, 1]);
    for (const dx of [-1.9, 1.9]) { const m = new THREE.Matrix4().makeTranslation(gx + dx, CURB + 0.5, z0 - 1.3); this.gb.props.geo(new THREE.CylinderGeometry(0.14, 0.16, 1.0, 10), m, [0.95, 0.75, 0.1]); this.circleCollider(gx + dx, z0 - 1.3, 0.18, 0, CURB + 1); }
    this.props.sign('BLAST BARN', gx, h + 1.25, z0 - 0.35, Math.PI, 11, 2.3, { bg: '#7a0f0f', fg: '#ffd60a', border: '#ffd60a' });
    this.props.sign('GUNS · AMMO · ARMOR', gx, dh + 0.55, z0 - 0.25, Math.PI, 4.6, 0.7, { bg: '#111', fg: '#ff5a5f', size: 60 });
    this.buildings.push({ x0, z0, x1, z1, h: 5.2, style: 'store' });
    (this.specials.stores || (this.specials.stores = [])).push({ x: gx, z: z0 - 2, door: [gx, z0], x0: ix0, x1: ix1, z0: iz0, z1: iz1, roofY: h, counter: [gx, cz0 - 0.9], clerk: [gx, cz1 + 1.0], light: [gx, h - 0.7, (z0 + z1) / 2] });
    const L = LOT; return [[cx - L, cz - L, x0 - 1, cz + L], [x1 + 1, cz - L, cx + L, cz + L], [x0 - 1, z1 + 1, x1 + 1, cz + L]];
  }
  interiorAt(x, z) { for (const s of this.specials.stores || []) if (x > s.x0 - 0.2 && x < s.x1 + 0.2 && z > s.z0 - 0.4 && z < s.z1 + 0.2) return s; return null; }

  placeCivic(b, rects, kind) {
    const { cx, cz } = b; const x0 = cx - LOT, x1 = cx + LOT, z0 = cz - LOT + 12, z1 = cz + 8; const h = kind === 'police' ? 16 : 26;
    const style = kind === 'police' ? 'office' : 'stucco'; const F = this.facade[style];
    const tint = kind === 'police' ? hexCol(0xc8d2e0) : hexCol(0xffffff);
    F.gb.sides(x0, x1, CURB, CURB + h, z0, z1, F.tw, F.th, tint);
    this.gb.roof.top(x0, x1, CURB + h, z0, z1, 4, [0.75, 0.75, 0.75]);
    this.gb.props.box(x0 - 0.2, x1 + 0.2, CURB + h, CURB + h + 0.8, z0 - 0.2, z0 + 0.3, [0.6, 0.6, 0.62]);
    this.boxCollider(x0 - 0.2, x1 + 0.2, z0 - 0.2, z1 + 0.2, 0, CURB + h);
    this.buildings.push({ x0, z0, x1, z1, h, style });
    // forecourt with a canopy
    this.gb.metal.box(cx - 8, cx + 8, CURB + 4.2, CURB + 4.6, z0 - 6, z0, [1, 1, 1]);
    for (const dx of [-7.5, 7.5]) { const m = new THREE.Matrix4().makeTranslation(cx + dx, CURB + 2.1, z0 - 5.6); this.gb.metal.geo(new THREE.CylinderGeometry(0.15, 0.15, 4.2, 8), m, [1, 1, 1]); this.circleCollider(cx + dx, z0 - 5.6, 0.2, 0, 4.4); }
    if (kind === 'police') this.props.sign('POLICE', cx, CURB + 6.4, z0 - 0.35, Math.PI, 12, 2.6, { bg: '#0d2c6b', fg: '#ffffff', border: '#ffffff' });
    else this.props.sign('HOSPITAL', cx, CURB + 6.4, z0 - 0.35, Math.PI, 14, 2.6, { bg: '#ffffff', fg: '#c1121f', border: '#c1121f', icon: 'cross' });
    this.specials[kind] = { x: cx, z: z0 - 4, yaw: Math.PI, road: [cx, cz - SLAB - 6] };
    return [[x0, z1 + 1, x1, cz + LOT]];
  }

  buildPark(b, R) {
    const { cx, cz } = b; const L = LOT;
    // fountain or pond in the middle
    const m = new THREE.Matrix4().makeTranslation(cx, CURB + 0.35, cz);
    this.gb.props.geo(new THREE.CylinderGeometry(5.2, 5.6, 0.7, 28, 1, true), m, [0.78, 0.76, 0.72]);
    m.makeTranslation(cx, CURB + 0.72, cz); this.gb.props.geo(new THREE.TorusGeometry(5.4, 0.25, 6, 32).rotateX(Math.PI / 2), m, [0.82, 0.8, 0.76]);
    m.makeTranslation(cx, CURB + 1.4, cz); this.gb.props.geo(new THREE.CylinderGeometry(0.4, 0.8, 2.2, 10), m, [0.8, 0.78, 0.74]);
    m.makeTranslation(cx, CURB + 2.6, cz); this.gb.props.geo(new THREE.CylinderGeometry(1.5, 0.5, 0.4, 16), m, [0.8, 0.78, 0.74]);
    this.props.water(cx, CURB + 0.55, cz, 5.1);
    this.circleCollider(cx, cz, 5.7, 0, 0.9);
    if (b.i === 2 && b.j === 2) this.addRamp(cx + 14, cz + SLAB - 13, 0, 7, 13, 2.4, CURB, 'mega'); // mega jump across the road south into the parking lot
    if (b.i === 6 && b.j === 4) this.addRamp(cx - 16, cz - 10, Math.PI / 2, 5, 9, 1.4, CURB + 0.004);
    // trees avoiding paths, fountain and ramp run-ups
    let n = 0;
    for (let k = 0; k < 120 && n < 34; k++) {
      const x = cx + R.range(-L + 2, L - 2), z = cz + R.range(-L + 2, L - 2);
      if (Math.abs(x - cx) < 4.5 || Math.abs(z - cz) < 4.5 || Math.hypot(x - cx, z - cz) < 9 || this.nearRamp(x, z)) continue;
      this.props.tree(x, z, CURB, R.range(0.8, 1.35), 'leaf'); n++;
    }
    for (const [dx, dz, yaw] of [[3.5, 12, Math.PI / 2], [-3.5, -12, -Math.PI / 2], [12, -3.5, Math.PI], [-12, 3.5, 0], [3.5, -20, Math.PI / 2], [-3.5, 20, -Math.PI / 2]]) this.props.add('bench', cx + dx, cz + dz, yaw, CURB);
    for (let k = 0; k < 4; k++) this.props.add('trash', cx + (k % 2 ? 3.2 : -3.2), cz + (k < 2 ? 7 : -7), 0, CURB);
  }

  buildPlaza(b, R) {
    const { cx, cz } = b;
    const m = new THREE.Matrix4();
    // stepped circular monument
    for (let k = 0; k < 3; k++) { m.makeTranslation(cx, CURB + 0.2 + k * 0.4, cz); this.gb.props.geo(new THREE.CylinderGeometry(9 - k * 2.5, 9.2 - k * 2.5, 0.4, 32), m, [0.85, 0.82, 0.76]); }
    m.makeTranslation(cx, CURB + 7, cz); this.gb.props.geo(new THREE.CylinderGeometry(0.7, 1.2, 12, 8), m, [0.7, 0.68, 0.64]);
    m.makeTranslation(cx, CURB + 13.4, cz); this.gb.props.geo(new THREE.OctahedronGeometry(1.6, 0), m, [0.95, 0.78, 0.3]);
    this.circleCollider(cx, cz, 9.2, 0, 1.4);
    this.addRamp(cx - 20, cz + 20, Math.PI, 6, 10, 1.7, CURB);
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; if (this.nearRamp(cx + Math.cos(a) * 22, cz + Math.sin(a) * 22)) continue; this.props.tree(cx + Math.cos(a) * 22, cz + Math.sin(a) * 22, CURB, R.range(0.9, 1.2), 'leaf'); }
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2; this.props.add('bench', cx + Math.cos(a) * 14, cz + Math.sin(a) * 14, -a + Math.PI / 2, CURB); }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.5; this.props.lamp(cx + Math.cos(a) * 17, cz + Math.sin(a) * 17, CURB); }
  }

  buildStuntYard(b, R) {
    const { cx, cz } = b;
    this.addRamp(cx - 24, cz + 18, Math.PI, 8, 17, 3.6, CURB + 0.003, 'big'); // big ramp heading north (-z)
    this.addRamp(cx + 16, cz + 22, Math.PI, 6, 10, 1.6, CURB + 0.003);
    this.addRamp(cx + 16, cz - 6, 0, 6, 10, 1.6, CURB + 0.003); // facing pair
    this.addRamp(cx - 4, cz - 22, Math.PI / 2, 7, 12, 2.2, CURB + 0.003);
    for (let k = 0; k < 20; k++) this.props.add('cone', cx + R.range(-26, 26), cz + R.range(-26, 26), R.range(0, 6), CURB);
    // shipping container wall to smash past
    const cols = [0xc0392b, 0x2471a3, 0x229954, 0xd68910];
    for (let k = 0; k < 3; k++) this.container(cx + 24, cz - 22 + k * 3.0, 0, cols[k % 4], R);
    this.props.sign('STUNT YARD', cx, CURB + 3.5, cz + SLAB - 0.8, 0, 14, 3, { bg: '#111', fg: '#ffcc00', border: '#ffcc00' });
  }

  buildParkingLot(b, R) {
    const { cx, cz } = b; const L = LOT;
    for (let row = -1; row <= 1; row += 2) for (let k = -8; k <= 8; k++) {
      const x = cx + k * 3.2, z = cz + row * 9; const g = new THREE.Matrix4().makeTranslation(x - 1.6, CURB + 0.01, z);
      this.gb.props.geo(new THREE.BoxGeometry(0.12, 0.01, 5.2), g, [0.9, 0.9, 0.9]);
      if (Math.abs(k) < 8) this.parkingSlots.push({ x, z, yaw: row > 0 ? Math.PI : 0, lot: true });
    }
    void L; void R;
  }

  container(x, z, yaw, col, R) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.45), new THREE.MeshStandardMaterial({ map: TX.corrugated('#' + new THREE.Color(col).getHexString()), roughness: 0.6, metalness: 0.4 }));
    m.position.set(x, CURB + 1.3, z); m.rotation.y = yaw; m.castShadow = m.receiveShadow = true; this.root.add(m);
    const hw = yaw ? 1.25 : 3, hd = yaw ? 3 : 1.25; this.boxCollider(x - hw, x + hw, z - hd, z + hd, 0, CURB + 2.6);
    void R;
  }

  nearRamp(x, z) {
    for (const r of this.ramps) { const dx = x - r.x, dz = z - r.z; const lx = dx * r.c - dz * r.s, lz = dx * r.s + dz * r.c; if (Math.abs(lx) < r.w / 2 + 3 && lz > -24 && lz < r.l + 8) return true; }
    return false;
  }
  addRamp(x, z, yaw, w, l, h, base, tag) {
    // ramp rises along local +z; (x,z) is the low edge centre
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const n = new THREE.Vector3(0, l, -h).normalize(); const nx = n.x * c + n.z * s, nz = -n.x * s + n.z * c;
    const cxw = x + s * (l / 2), czw = z + c * (l / 2);
    const r = { x, z, yaw, w, l, h, base, c, s, nx, ny: n.y, nz, rad2: (l + w) * (l + w), tag, top: [x + s * l, z + c * l] };
    this.ramps.push(r);
    // geometry: wedge
    const g = new THREE.BufferGeometry(); const hw = w / 2;
    const v = [[-hw, 0, 0], [hw, 0, 0], [hw, h, l], [-hw, h, l], [-hw, 0, l], [hw, 0, l]];
    const pos = [], uv = [];
    const tri = (a, b2, c2, ua, ub, uc) => { pos.push(...v[a], ...v[b2], ...v[c2]); uv.push(...ua, ...ub, ...uc); };
    const L = Math.hypot(l, h) / 4;
    tri(0, 3, 2, [0, 0], [0, L], [w / 4, L]); tri(0, 2, 1, [0, 0], [w / 4, L], [w / 4, 0]); // slope
    tri(4, 3, 0, [0, 0], [0, 1], [1, 0]); tri(1, 2, 5, [0, 0], [0, 1], [1, 0]); // sides
    tri(5, 2, 3, [0, 0], [1, 0], [1, 1]); tri(5, 3, 4, [0, 0], [1, 1], [0, 1]); // back
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    g.addGroup(0, 6, 0); g.addGroup(6, 12, 1);
    const mesh = new THREE.Mesh(g, [this.mat.chevron, this.mat.metal]);
    mesh.position.set(x, base, z); mesh.rotation.y = yaw; mesh.castShadow = mesh.receiveShadow = true; this.root.add(mesh);
    void cxw; void czw; return r;
  }

  // ---------- intersections ----------
  buildIntersections() {
    for (let l = 0; l <= NB; l++) for (let k = 0; k <= NB; k++) {
      if (!this.hasLight(k, l)) continue;
      const [nx, nz] = this.nodePos(k, l); const big = this.isDiagNode(k, l);
      for (const [ak, al] of this.neighbors(k, l)) {
        const [ax, az] = this.nodePos(ak, al); let dx = nx - ax, dz = nz - az; const L = Math.hypot(dx, dz); dx /= L; dz /= L; const rx = -dz, rz = dx;
        const dg = ak !== k && al !== l; const half = (dg ? DH : RW / 2) + 1.2;
        // corner of the junction on the right of the approach; at the big avenue junctions slide back until it's on a sidewalk
        let t = big ? this.stopDist(k, l, dg) - 1.5 : 11.2, px = 0, pz = 0;
        for (let tries = 0; tries < 16; tries++) { px = nx - dx * t + rx * half; pz = nz - dz * t + rz * half; if (this.onSlab(px, pz) && !this.insideBuilding(px, pz, 0.6)) break; t += 1; }
        this.props.trafficLight(px, pz, dx, dz, rx, rz, k, l, this.axisOf([ak, al], [k, l]));
        this.circleCollider(px, pz, 0.22, 0, 7);
      }
    }
  }

  buildStreetFurniture(R) {
    const edge = RW / 2 + 0.7;
    for (let l = 0; l <= NB; l++) for (let k = 0; k < NB; k++) for (const axis of ['x', 'z']) {
      const [ax, az] = axis === 'x' ? this.nodePos(k, l) : this.nodePos(l, k);
      const dx = axis === 'x' ? 1 : 0, dz = axis === 'x' ? 0 : 1;
      for (const side of [-1, 1]) {
        const ox = -dz * side, oz = dx * side; // lateral unit (side)
        const blk = this.blockAt(ax + dx * P / 2 + ox * (RW / 2 + 5), az + dz * P / 2 + oz * (RW / 2 + 5));
        const outer = !blk; // outer side of perimeter roads: the promenade handles it
        const leafy = blk && (blk.district === 'heights' || blk.district === 'midtown' || blk.kind === 'park');
        for (let s = 24; s < P - 20; s += 30) {
          const x = ax + dx * (s + (side > 0 ? 6 : 0)) + ox * edge, z = az + dz * (s + (side > 0 ? 6 : 0)) + oz * edge;
          if (this.onSlab(x, z) && !this.insideBuilding(x, z, 0.5)) this.props.streetlight(x, z, Math.atan2(-ox, -oz), CURB);
        }
        if (outer) continue;
        if (leafy) for (let s = 16; s < P - 14; s += 15) { const x = ax + dx * (s + 7) + ox * (RW / 2 + 1.4), z = az + dz * (s + 7) + oz * (RW / 2 + 1.4); if (R.chance(0.75) && !this.nearRamp(x, z) && this.onSlab(x, z) && !this.insideBuilding(x, z, 0.8)) this.props.tree(x, z, CURB, R.range(0.75, 1.05), 'leaf'); }
        // misc props near block corners
        if (blk && blk.kind !== 'park') {
          const put = (kind, s, lat, yaw) => { const x = ax + dx * s + ox * lat, z = az + dz * s + oz * lat; if (this.onSlab(x, z) && !this.insideBuilding(x, z, 0.6)) this.props.add(kind, x, z, yaw, CURB); };
          if (R.chance(0.7)) put('hydrant', blk.diag ? 30 : 18, RW / 2 + 0.9, 0);
          if (R.chance(0.5)) put('mailbox', P - 22, RW / 2 + 0.9, Math.atan2(ox, oz));
          if (R.chance(0.6)) put('trash', P / 2 + 4, RW / 2 + 0.9, 0);
          if (blk.district !== 'industrial' && R.chance(0.35)) put('bench', P / 2 - 6, RW / 2 + 4.2, Math.atan2(ox, oz) + Math.PI);
        }
        // parking slots on the right-hand strip for traffic heading +axis when side=+1 ... both strips used
        for (let s = 24; s < P - 24; s += 6.5) {
          if (R.chance(0.45)) continue;
          const x = ax + dx * s + ox * CITY.PARK, z = az + dz * s + oz * CITY.PARK;
          // cars park facing the direction of the adjacent lane's traffic
          const travel = side > 0 ? 1 : -1; const yaw = Math.atan2(dx * travel, dz * travel);
          this.parkingSlots.push({ x, z, yaw });
        }
      }
    }
  }

  // lamps and trees down both sides of each avenue
  buildAvenueFurniture(R) {
    for (const D of this.diags) for (let i = 0; i + 1 < D.nodes.length; i++) {
      const [ax, az] = this.nodePos(...D.nodes[i]), [bx, bz] = this.nodePos(...D.nodes[i + 1]); const L = Math.hypot(bx - ax, bz - az); const dx = (bx - ax) / L, dz = (bz - az) / L;
      const blk = this.blockAt((ax + bx) / 2 + 20 * dz, (az + bz) / 2 - 20 * dx); const leafy = blk && blk.district !== 'industrial';
      for (const side of [-1, 1]) {
        const ox = -dz * side, oz = dx * side;
        for (let s = 32 + (side > 0 ? 13 : 0); s < L - 30; s += 26) { const x = ax + dx * s + ox * (DH + 0.8), z = az + dz * s + oz * (DH + 0.8); if (this.onSlab(x, z) && !this.insideBuilding(x, z, 0.5)) this.props.streetlight(x, z, Math.atan2(-ox, -oz), CURB); }
        if (leafy) for (let s = 38; s < L - 34; s += 13) { const x = ax + dx * s + ox * (DH + 1.7), z = az + dz * s + oz * (DH + 1.7); if (R.chance(0.7) && this.onSlab(x, z) && !this.insideBuilding(x, z, 1)) this.props.tree(x, z, CURB, R.range(0.75, 1.0), 'leaf'); }
      }
    }
  }
  buildEdge(R) {
    // promenade ring between the outer roads and the sea wall
    const a = HALF + RW / 2, b = LIMIT; const col = [0.92, 0.9, 0.86];
    this.gb.top.top(-b, b, CURB, -b, -a, 4, col); this.gb.top.top(-b, b, CURB, a, b, 4, col);
    this.gb.top.top(-b, -a, CURB, -a, a, 4, col); this.gb.top.top(a, b, CURB, -a, a, 4, col);
    // inner curb faces (toward the outer roads)
    this.gb.curb.sides(-a, a, 0, CURB, -a - 0.02, -a, 3, 3, [1, 1, 1]); this.gb.curb.sides(-a, a, 0, CURB, a, a + 0.02, 3, 3, [1, 1, 1]);
    this.gb.curb.sides(-a - 0.02, -a, 0, CURB, -a, a, 3, 3, [1, 1, 1]); this.gb.curb.sides(a, a + 0.02, 0, CURB, -a, a, 3, 3, [1, 1, 1]);
    // sea wall (barrier + drop)
    const wall = [0.78, 0.77, 0.74], t = 0.6, wh = 1.05;
    for (const [x0, x1, z0, z1] of [[-b, b, -b - t, -b], [-b, b, b, b + t], [-b - t, -b, -b, b], [b, b + t, -b, b]]) {
      this.gb.props.box(x0, x1, CURB, CURB + wh, z0, z1, wall, 3);
      this.boxCollider(x0, x1, z0, z1, -5, CURB + wh, false);
    }
    this.gb.curb.sides(-b - t, b + t, -3, CURB, -b - t, b + t, 3, 3, [0.9, 0.9, 0.9]);
    // palms + lamps along the promenade
    for (let s = -b + 10; s < b - 10; s += 22) {
      for (const [x, z] of [[s, -b + 4], [s, b - 4], [-b + 4, s], [b - 4, s]]) { if (R.chance(0.8)) this.props.tree(x, z, CURB, R.range(0.9, 1.3), 'palm'); }
      for (const [x, z] of [[s + 11, -b + 9], [s + 11, b - 9], [-b + 9, s + 11], [b - 9, s + 11]]) this.props.lamp(x, z, CURB);
    }
    // harbour cranes along the south shore
    for (let k = 0; k < 4; k++) this.crane(-240 + k * 150, b - 8, R);
    for (let k = 0; k < 18; k++) { const cols = [0xc0392b, 0x2471a3, 0x229954, 0xd68910, 0x7d3c98]; this.container(-300 + k * 34 + R.range(-4, 4), b - 18 + (k % 2) * 3, 0, R.pick(cols), R); }
    // beach strip west
    const sandM = new THREE.Mesh(new THREE.PlaneGeometry(60, (b + 40) * 2).rotateX(-Math.PI / 2), this.mat.sand); sandM.position.set(-b - 28, -0.6, 0); sandM.receiveShadow = true; this.root.add(sandM);
  }

  crane(x, z, R) {
    const col = [0.85, 0.55, 0.1]; const m = new THREE.Matrix4();
    for (const [dx, dz] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) { m.makeTranslation(x + dx, CURB + 14, z + dz); this.gb.props.geo(new THREE.BoxGeometry(0.9, 28, 0.9), m, col); this.circleCollider(x + dx, z + dz, 0.7, 0, 28); }
    m.makeTranslation(x, CURB + 28.5, z - 6); this.gb.props.geo(new THREE.BoxGeometry(12, 2, 40), m, col);
    m.makeTranslation(x, CURB + 31, z - 2); this.gb.props.geo(new THREE.BoxGeometry(5, 4, 5), m, [0.9, 0.9, 0.88]);
    m.makeTranslation(x, CURB + 24, z - 20); this.gb.props.geo(new THREE.BoxGeometry(3, 1, 3), m, [0.2, 0.2, 0.2]);
    void R;
  }

  finishMeshes() {
    const add = (gb, mat, cast = true, recv = true) => { if (gb.empty) return null; const m = new THREE.Mesh(gb.build(), mat); m.castShadow = cast; m.receiveShadow = recv; this.root.add(m); return m; };
    for (const s of this.styles) add(this.facade[s].gb, this.facade[s].mat);
    for (const sh of this.shops) add(sh.gb, sh.mat);
    add(this.gb.top, this.mat.sidewalk, false, true);
    add(this.gb.curb, this.mat.curb, false, true);
    add(this.gb.grass, this.mat.grass, false, true);
    add(this.gb.roof, this.mat.roof, false, true);
    add(this.gb.props, this.mat.props, true, true);
    add(this.gb.metal, this.mat.metal, true, true);
    if (this.storeGB) { add(this.storeGB.peg, this.storeMat.peg, false, true); add(this.storeGB.floor, this.storeMat.floor, false, true); add(this.storeGB.ceil, this.storeMat.ceil, false, false); }
    const asp = this.mat.asphalt.clone(); asp.map = this.asphaltTex.map.clone(); asp.map.repeat.set(1, 1); asp.normalMap = this.asphaltTex.normalMap.clone(); asp.normalMap.repeat.set(1, 1); asp.roughnessMap = null; asp.roughness = 0.88; asp.color.setScalar(0.9);
    asp.map.needsUpdate = true; asp.normalMap.needsUpdate = true;
    asp.polygonOffset = true; asp.polygonOffsetFactor = -1; asp.polygonOffsetUnits = -1;
    add(this.gb.asphalt, asp, false, true);
    // mountains on the horizon
    const mm = new THREE.MeshStandardMaterial({ color: 0x5b6f63, roughness: 1, flatShading: true });
    const R = rng(77);
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2 + R.range(-0.1, 0.1), d = R.range(1700, 2600), h = R.range(120, 420), r = R.range(250, 520);
      const g = new THREE.ConeGeometry(r, h, 7, 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > -h / 2 + 1) { p.setX(i, p.getX(i) * R.range(0.8, 1.2)); p.setZ(i, p.getZ(i) * R.range(0.8, 1.2)); }
      g.computeVertexNormals(); const m = new THREE.Mesh(g, mm); m.position.set(Math.cos(a) * d, h / 2 - 20, Math.sin(a) * d); this.root.add(m);
    }
  }

  setNight(n) {
    this.night = n;
    for (const m of this.facadeMats) m.emissiveIntensity = n * 1.35;
    this.props.setNight(n);
  }
  update(dt) { this.time += dt; }
}

export { GB };
void RoundedBoxGeometry; void mergeGeometries; void SW;
