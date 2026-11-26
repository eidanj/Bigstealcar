// Big Steal Car — procedural car models (extruded side profiles, clear-coat paint, liveries) and instanced wheels.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_TYPES } from './config.js';
import * as TX from './textures.js';
import { lampAtlas } from './lamps.js';

const BT = 0.07, BS = 0.045; // extrude bevel thickness / size
// which palette colours are metallic (the rest are solid gloss)
const METALLIC = new Set([0xb8bcc2, 0x5d6168, 0x1d3a6e, 0x5e1320, 0x1f4d36, 0xc9b48f, 0x2a7f8f, 0x2b2f3a, 0x8a1538, 0x3c6e9e, 0x6b4e9b, 0x111214]);
const cabTop = (t) => t.prof.cabH ?? t.H;

function profile(t) {
  const L = t.L, p = t.prof, c = t.clear + BS, zF = L / 2 - BS, zR = -L / 2 + BS;
  const ar = t.wheelR + 0.1, wy = t.wheelR, fa = t.wb / 2, ra = -t.wb / 2;
  const s = new THREE.Shape();
  const rg = Math.max(p.rg, zR + 0.3);
  const th0 = Math.asin(Math.max(-0.99, Math.min(0.99, (c - wy) / ar)));
  s.moveTo(zR, c + 0.14);
  if (t.cabZ != null) { // flat load deck / bed floor behind a vertical cab back (pickups, trucks)
    s.lineTo(zR, p.deckH - 0.05); s.quadraticCurveTo(zR, p.deckH, zR + 0.05, p.deckH);
    s.lineTo(t.cabZ, p.deckH); s.lineTo(t.cabZ, p.beltH); s.lineTo(p.ws, p.beltH);
  } else {
    s.lineTo(zR, p.tailH - 0.05);
    s.quadraticCurveTo(zR - 0.02, p.deckH, zR + 0.28, p.deckH);
    if (t.cargo) { s.lineTo(rg, p.deckH); s.lineTo(p.ws - 0.05, p.beltH); }
    else { s.lineTo(rg, p.deckH); s.lineTo(rg + 0.12, p.beltH); s.lineTo(p.ws, p.beltH); }
  }
  s.lineTo(zF - 0.5, p.noseH + 0.06);
  s.quadraticCurveTo(zF + 0.02, p.noseH + 0.02, zF, p.noseH - 0.1);
  s.lineTo(zF, c + 0.16);
  s.quadraticCurveTo(zF, c, zF - 0.22, c);
  s.lineTo(fa + ar * Math.cos(th0), c);
  s.absarc(fa, wy, ar, th0, Math.PI - th0, false);
  s.lineTo(ra + ar * Math.cos(th0), c);
  s.absarc(ra, wy, ar, th0, Math.PI - th0, false);
  s.lineTo(zR + 0.2, c);
  s.quadraticCurveTo(zR, c, zR, c + 0.14);
  return s;
}
function cabinShape(t) {
  const p = t.prof; const s = new THREE.Shape(); const H = cabTop(t) - BS; const b = p.beltH - 0.04;
  const r = 0.12; const rg = Math.max(p.rg, -t.L / 2 + BS + 0.3);
  s.moveTo(p.ws, b);
  s.lineTo(p.rf + 0.18, H - 0.03);
  s.quadraticCurveTo(p.rf, H, p.rf - r, H);
  s.lineTo(p.rr + r, H);
  s.quadraticCurveTo(p.rr, H, p.rr - 0.08, H - 0.06);
  s.lineTo(t.cargo || t.cabZ != null ? rg - 0.02 : rg + 0.12, b);
  s.lineTo(p.ws, b);
  return s;
}
// extrude a side profile across the car's width, map into car space (x = width, z = length) and taper the top
function extrudeSide(shape, width, t, taperFrom, taperAmt, curve = 10, Htop = t.H) {
  const depth = Math.max(0.05, width - 2 * BT);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: BT, bevelSize: BS, bevelSegments: 3, curveSegments: curve, steps: 1 });
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const H = t.H;
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i), sy = pos.getY(i), sz = pos.getZ(i);
    let x = depth / 2 - sz; const y = sy, z = sx;
    if (taperAmt) { const k = Math.max(0, (y - taperFrom) / (Htop - taperFrom)); x *= 1 - taperAmt * k; }
    else { const mid = (t.clear + t.prof.beltH) / 2, hh = (t.prof.beltH - t.clear) / 2; const k = Math.min(1.2, Math.abs(y - mid) / hh); x *= 1 - 0.035 * k * k; }
    pos.setXYZ(i, x, y, z);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i); nor.setXYZ(i, -nz, ny, nx);
  }
  // uv for the flat side caps (group 0): u along length (mirrored per side), v up the height
  const capCount = g.groups[0].count; const idx = g.index;
  for (let k = 0; k < capCount; k++) {
    const i = idx ? idx.getX(g.groups[0].start + k) : g.groups[0].start + k;
    const z = pos.getZ(i), y = pos.getY(i), nx = nor.getX(i); const u = (z + t.L / 2) / t.L;
    uv.setXY(i, nx > 0 ? 1 - u : u, y / H);
  }
  // ExtrudeGeometry shades every segment flat, which made curved hoods and roofs look striped like a plastic
  // model; smooth across gentle bends (curves, bevels) and keep real body creases sharp
  const out = toCreasedNormals(g, THREE.MathUtils.degToRad(34));
  out.computeBoundingSphere();
  return out;
}
// merge geometries that share the same material groups (side caps / sides), keeping the groups
function mergeGrouped(list) {
  const out = new THREE.BufferGeometry(); const attrs = [['position', 3], ['normal', 3], ['uv', 2]]; const data = { position: [], normal: [], uv: [] };
  let start = 0;
  for (let gi = 0; gi < list[0].groups.length; gi++) {
    let count = 0;
    for (const g of list) { const gr = g.groups[gi]; for (const [a, n] of attrs) { const A = g.attributes[a].array; for (let i = gr.start * n; i < (gr.start + gr.count) * n; i++) data[a].push(A[i]); } count += gr.count; }
    out.addGroup(start, count, list[0].groups[gi].materialIndex); start += count;
  }
  for (const [a, n] of attrs) out.setAttribute(a, new THREE.Float32BufferAttribute(data[a], n));
  out.computeBoundingSphere(); return out;
}

// Where the lamps sit on a model: textured quads [fn, region, a, b, c, d, normal]. Corners run outer-bottom,
// inner-bottom, inner-top, outer-top so every lamp texture is drawn with its outer edge at u = 0.
function lampFaces(t) {
  const W = t.W, L = t.L, p = t.prof, Lm = t.lamp;
  const f = { hw: 0.5, hh: 0.16, hy: 0.11, turn: 'out', drl: 'under', ...(Lm.f || {}) }, r = { k: 'horiz', tw: 0.5, th: 0.15, ty: 0.075, ...(Lm.r || {}) };
  const out = []; const F = (fn, region, a, b, c, d, n) => out.push([fn, region, a, b, c, d, n]);
  const zf = L / 2 + 0.022, zr = -L / 2 - 0.022, NF = [0, 0, 1], NR = [0, 0, -1];
  const bumpTop = t.clear + (t.cls === 'Truck' ? 0.41 : 0.25);
  let yT = p.noseH - f.hy, yB = yT - f.hh; if (yB < bumpTop - 0.012) { yT += bumpTop - 0.012 - yB; yB = bumpTop - 0.012; } // keep the cluster clear of the bumper
  // low sports noses: the lamps lie on the curved nose instead of a vertical face
  const zF = L / 2 - BS;
  const nose = (y) => { // point on the nose curve at height y, pushed out past the bevelled skin along its normal
    let lo = 0, hi = 1; const Y = (m) => (1 - m) ** 2 * (p.noseH + 0.06) + 2 * (1 - m) * m * (p.noseH + 0.02) + m * m * (p.noseH - 0.1);
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (Y(m) > y) lo = m; else hi = m; } const m = (lo + hi) / 2;
    const z = (1 - m) ** 2 * (zF - 0.5) + 2 * (1 - m) * m * (zF + 0.02) + m * m * zF;
    const dz = 2 * (1 - m) * (0.52) + 2 * m * (-0.02), dy = 2 * (1 - m) * (-0.04) + 2 * m * (-0.12); const l = Math.hypot(dz, dy) || 1; const off = BS + 0.012;
    return [z - dy / l * off, y + dz / l * off];
  };
  const fp = (y) => (f.slope && y > p.noseH - 0.1 ? nose(y) : [L / 2 + 0.022, y]);
  const qf = (fn, reg, x0, x1, y0, y1) => { const [z0, Y0] = fp(y0), [z1, Y1] = fp(y1); const dy = Y1 - Y0, dz = z1 - z0, l = Math.hypot(dy, dz) || 1; F(fn, reg, [x0, Y0, z0], [x1, Y0, z0], [x1, Y1, z1], [x0, Y1, z1], [0, -dz / l, dy / l]); };
  const q = (fn, reg, x0, x1, y0, y1, z, n) => F(fn, reg, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], n);
  for (const sx of [-1, 1]) {
    const tf = sx > 0 ? 2 : 3, trn = sx > 0 ? 5 : 6;
    // ---- front cluster: head + indicator, with a running-light strip and/or indicator tucked inside the cluster
    const xo = sx * (W / 2 - 0.07), xi = sx * (W / 2 - 0.07 - f.hw); const tw = Math.min(0.13, f.hw * 0.26);
    let y0 = yB, y1 = yT;
    if (f.drl === 'under') { if (f.turn === 'none') { const xm = xo - sx * f.hw * 0.3; qf(tf, 'turnF', xo, xm, y0, y0 + 0.03); qf(1, 'drl', xm, xi, y0, y0 + 0.03); } else qf(1, 'drl', xo, xi, y0, y0 + 0.03); y0 += 0.034; }
    if (f.drl === 'top') { qf(1, 'drl', xo, xi, y1 - 0.03, y1); y1 -= 0.034; }
    if (f.turn === 'under') { qf(tf, 'turnF', xo, xi, y0, y0 + 0.055); y0 += 0.06; }
    if (f.turn === 'out') { const xt = xo - sx * tw; qf(0, 'head', xt, xi, y0, y1); qf(tf, 'turnF', xo, xt, y0, y1); }
    else if (f.turn === 'in') { const xt = xi + sx * tw; qf(0, 'head', xo, xt, y0, y1); qf(tf, 'turnF', xt, xi, y0, y1); }
    else if (f.turn === 'none' && f.drl !== 'under') { qf(0, 'head', xo - sx * 0.1, xi, y0, y1); qf(tf, 'turnF', xo, xo - sx * 0.1, y0, y1); }
    else qf(0, 'head', xo, xi, y0, y1);
    // amber side repeater just behind the front corner
    const xs = sx * (W / 2 * 0.997 + 0.006), ym = Math.min(p.noseH - 0.16, p.beltH - 0.12);
    F(tf, 'mark', [xs, ym - 0.07, L / 2 - 0.32], [xs, ym - 0.07, L / 2 - 0.13], [xs, ym, L / 2 - 0.13], [xs, ym, L / 2 - 0.32], [sx, 0, 0]);
    // ---- rear
    const ro = sx * (W / 2 - (r.k === 'vert' ? 0.04 : 0.07)), tT = p.tailH - r.ty, tB = tT - r.th;
    if (r.k === 'horiz' || r.k === 'bar') {
      const xr = ro - sx * r.tw * 0.6, xi2 = ro - sx * r.tw, tM = (tT + tB) / 2;
      q(4, 'tail', ro, xr, tB, tT, zr, NR); q(trn, 'turnR', xr, xi2, tM + 0.004, tT, zr, NR); q(7, 'rev', xr, xi2, tB, tM - 0.004, zr, NR);
    } else if (r.k === 'vert') {
      const xi2 = ro - sx * r.tw, y1 = tT - r.th * 0.52, y2 = y1 - r.th * 0.22;
      q(4, 'tail', ro, xi2, y1, tT, zr, NR); q(trn, 'turnR', ro, xi2, y2 + 0.004, y1 - 0.004, zr, NR); q(7, 'rev', ro, xi2, tB, y2 - 0.004, zr, NR);
    } else if (r.k === 'bumper') {
      const yc = (t.box ? t.box.y0 : p.deckH) - 0.24, s = 0.075, zb = -L / 2 - 0.075;
      for (const [fn, reg, off] of [[4, 'tail', 0.18], [trn, 'turnR', 0.37], [7, 'rev', 0.56]]) { const cx = sx * (W / 2 - off); q(fn, reg, cx + sx * s, cx - sx * s, yc - s, yc + s, zb, NR); }
    }
    const xs2 = sx * (W / 2 * 0.997 + 0.006), ty0 = r.k === 'bumper' ? (t.box ? t.box.y0 : p.deckH) - 0.32 : Math.min(tB, p.tailH - 0.2) + 0.03;
    F(4, 'tail', [xs2, ty0, -L / 2 + 0.07], [xs2, ty0, -L / 2 + 0.25], [xs2, ty0 + 0.07, -L / 2 + 0.25], [xs2, ty0 + 0.07, -L / 2 + 0.07], [sx, 0, 0]);
  }
  // full-width bars: EV front light bar, connected rear light bars
  if (f.drl === 'bar') { const xi = W / 2 - 0.07 - f.hw + 0.004; q(1, 'fbar', xi, -xi, yT - f.hh * 0.62, yT - f.hh * 0.32, zf + 0.002, NF); }
  if (r.k === 'bar') { const xi = W / 2 - 0.07 - r.tw + 0.004, tT = p.tailH - r.ty, full = Lm.ts === 'ribbedWide' || Lm.ts === 'chromeGrid'; const h = full ? r.th : r.th * 0.5, y0 = tT - (r.th + h) / 2; q(4, 'rbar', xi, -xi, y0, y0 + h, zr, NR); }
  // grille (+ lower intake)
  const g = { w: 0.2, h: 0.15, y: 0.115, ...(Lm.g || {}) }; const gx = Math.min(W * g.w, W / 2 - 0.09 - f.hw), gy1 = p.noseH - g.y, gy0 = gy1 - g.h;
  q(8, 'grille', gx, -gx, gy0, gy1, L / 2 + 0.03, NF);
  if (t.cls !== 'Truck') q(8, 'grille2', W * 0.3, -W * 0.3, t.clear + 0.08, t.clear + 0.17, L / 2 + 0.032, NF);
  return { faces: out, f, r, g: { gx, gy0, gy1 }, yT, yB };
}

export class CarFactory {
  constructor() {
    this.cache = {}; this.paint = new Map(); this.side = new Map(); this.lampTex = {};
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1016, metalness: 0.0, roughness: 0.02, transparent: true, opacity: 0.84, envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1 });
    this.trim = new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.62, metalness: 0.15 });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.55, metalness: 0.6 });
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xe2e4e6, metalness: 1, roughness: 0.12 });
    this.plateTex = TX.plate();
    this.plate = new THREE.MeshStandardMaterial({ map: this.plateTex, roughness: 0.5 });
    this.taxiSign = new THREE.MeshStandardMaterial({ map: TX.taxiSign(), emissiveMap: null, emissive: 0xffd60a, emissiveIntensity: 0.2, roughness: 0.4 });
    this.night = 0; this.envMap = null; this.flake = TX.carFlake(); this.flake.repeat.set(3, 3); this.wearTex = {};
  }
  setNight(n) { this.taxiSign.emissiveIntensity = 0.2 + n * 1.2; this.night = n; }
  // every lamp on a car is one mesh; a float attribute picks which of 9 functions a face belongs to and a
  // per-car uniform array says how bright each function glows right now. Each model has its own lamp atlas.
  lampMat(t) {
    const A = this.lampTex[t.key];
    const m = new THREE.MeshStandardMaterial({ map: A.map, emissiveMap: A.glow, emissive: 0xffffff, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.55 });
    const uL = { value: Array.from({ length: 9 }, () => new THREE.Vector3()) }; m.userData.uL = uL;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uL = uL;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float lfn;\nvarying float vLfn;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLfn = lfn;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLfn;\nuniform vec3 uL[9];')
        .replace('#include <emissivemap_fragment>', 'vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );\ntotalEmissiveRadiance = uL[ int( vLfn + 0.5 ) ] * emissiveColor.rgb;');
    };
    m.customProgramCacheKey = () => 'bsc-lamp-v1';
    return m;
  }
  boxMat() { if (!this._box) this._box = new THREE.MeshPhysicalMaterial({ map: TX.truckBox(), roughness: 0.42, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 0.5, envMap: this.envMap }); return this._box; }
  // real reflections: car materials point straight at the city reflection probe (with their own intensity)
  setEnvMap(tex) {
    this.envMap = tex;
    const all = [this.glass, this.chrome, this.trim, this.steel, ...(this._box ? [this._box] : []), ...this.paint.values(), ...this.side.values()];
    for (const m of all) { m.envMap = tex; m.needsUpdate = true; }
  }
  paintMat(color) {
    if (!this.paint.has(color)) {
      const metallic = METALLIC.has(color);
      const m = new THREE.MeshPhysicalMaterial({ color, metalness: metallic ? 0.62 : 0.05, roughness: metallic ? 0.3 : 0.4, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 0.72, envMap: this.envMap });
      if (metallic) { m.normalMap = this.flake; m.normalScale = new THREE.Vector2(0.22, 0.22); } // flake glints under a smooth clear layer
      this.paint.set(color, m);
    }
    return this.paint.get(color);
  }
  // body sides: painted livery texture + panel gaps + (for older cars) a little rust, fade, scratches and grime
  sideMat(t, color, wear = 0) {
    const key = t.key + ':' + color + ':' + wear;
    if (!this.side.has(key)) {
      const tk = t.livery ? t.key : 'gen:' + t.key;
      if (!this.cache['side:' + tk]) this.cache['side:' + tk] = TX.carSide(t, t.livery);
      const m = this.paintMat(t.livery ? 0xffffff : color).clone(); m.map = this.cache['side:' + tk]; m.envMap = this.envMap;
      if (!this.cache['panel:' + t.key]) this.cache['panel:' + t.key] = TX.carPanels(t);
      m.normalMap = this.cache['panel:' + t.key]; m.normalScale = new THREE.Vector2(0.4, 0.4);
      if (!this.wearTex[t.key]) this.wearTex[t.key] = TX.carWear(t);
      const uW = { value: [0, 0.38, 0.72][wear] || 0 }, wearMap = { value: this.wearTex[t.key] };
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uWear = uW; sh.uniforms.wearMap = wearMap;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D wearMap; uniform float uWear;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            vec3 wr = texture2D( wearMap, vMapUv ).rgb;
            float thr = 1.0 - uWear * 0.6, on = step( 0.01, uWear );
            float rust = smoothstep( thr, thr + 0.035, wr.r ) * on;            // bare rusted metal
            float lift = ( smoothstep( thr - 0.09, thr, wr.r ) - rust ) * on;  // bubbled paint around it
            float fade = wr.g * uWear, grime = wr.b * uWear;
            diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.8 + vec3( 0.06 ), fade * 0.85 );
            diffuseColor.rgb *= 1.0 - lift * 0.16 - grime * 0.3;
            vec3 rc = mix( vec3( 0.075, 0.03, 0.016 ), vec3( 0.2, 0.075, 0.03 ), smoothstep( thr, thr + 0.2, wr.r ) );
            diffuseColor.rgb = mix( diffuseColor.rgb, rc, rust );`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix( roughnessFactor, 0.92, max( rust, lift * 0.5 + fade * 0.35 + grime * 0.5 ) );')
          .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor *= 1.0 - rust;')
          .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.clearcoat *= 1.0 - clamp( rust + lift * 0.6 + grime * 0.6, 0.0, 1.0 ); material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.3, clamp( fade * 1.5, 0.0, 1.0 ) );');
      };
      m.customProgramCacheKey = () => 'bsc-carside-v2';
      this.side.set(key, m);
    }
    return this.side.get(key);
  }
  // how worn a new car is: sporty, luxury and police models are always clean; older everyday models sometimes aren't
  rollWear(t) {
    if (t.age === 'new' || !t.age) return 0;
    const r = Math.random();
    return t.age === 'old' ? (r < 0.55 ? 0 : r < 0.86 ? 1 : 2) : (r < 0.86 ? 0 : r < 0.97 ? 1 : 2);
  }
  parts(t) {
    if (this.cache[t.key]) return this.cache[t.key];
    const p = t.prof, W = t.W, L = t.L, Hc = cabTop(t);
    const body = extrudeSide(profile(t), W, t, 0, 0, 12);
    const boxy = t.cargo || t.cabZ != null || t.cls === 'Truck';
    const cabW = W * (t.cls === 'Truck' ? 0.94 : 0.86); const tap = boxy ? 0.05 : 0.14; const cabin = extrudeSide(cabinShape(t), cabW, t, p.beltH, tap, 8, Hc);
    const topHalf = (cabW / 2) * (1 - tap) + 0.01;
    const paint = [], trim = [], chrome = [], plates = [], steel = [];
    const bump = t.chromeBumper ? chrome : t.cls === 'Truck' ? steel : trim;
    // roof panel
    const roofLen = (p.rf - p.rr) - 0.05;
    if (!t.cargo) paint.push(new RoundedBoxGeometry(topHalf * 2, 0.06, roofLen, 2, 0.025).translate(0, Hc - BS - 0.005, (p.rf + p.rr) / 2));
    for (const sx of [-1, 1]) {
      // pillars (A + C) as thin painted strips on each side
      const a0 = new THREE.Vector3(sx * (cabW / 2 - 0.03), p.beltH, p.ws - 0.02), a1 = new THREE.Vector3(sx * (topHalf - 0.02), Hc - BS - 0.02, p.rf + 0.12);
      paint.push(strip(a0, a1, 0.07));
      if (!t.cargo) { const c0 = new THREE.Vector3(sx * (cabW / 2 - 0.03), p.beltH, (t.cabZ != null ? p.rg - 0.02 : p.rg + 0.14)), c1 = new THREE.Vector3(sx * (topHalf - 0.02), Hc - BS - 0.02, p.rr - 0.04); paint.push(strip(c0, c1, 0.09)); }
      // B pillar (four-door models)
      if (!t.cargo && t.doors !== 2 && t.L > 4.2) { const zb = t.doors === 'slide' ? (p.ws + p.rr) / 2 + 0.38 : (p.ws + p.rr) / 2 + 0.05; trim.push(strip(new THREE.Vector3(sx * (cabW / 2 - 0.04), p.beltH, zb), new THREE.Vector3(sx * (topHalf - 0.03), Hc - BS - 0.03, zb - 0.05), 0.06)); }
      // belt chrome line + mirror (trucks: big mirrors on arms)
      chrome.push(new THREE.BoxGeometry(0.02, 0.025, (p.ws - Math.max(p.rg, t.cabZ ?? -9)) * 0.95).translate(sx * (cabW / 2 + 0.005), p.beltH - 0.01, (p.ws + Math.max(p.rg, t.cabZ ?? -9)) / 2));
      if (t.cls === 'Truck') { trim.push(new RoundedBoxGeometry(0.1, 0.42, 0.2, 2, 0.03).translate(sx * (W / 2 + 0.2), p.beltH + 0.42, p.ws - 0.25)); steel.push(new THREE.BoxGeometry(0.24, 0.03, 0.03).translate(sx * (W / 2 + 0.08), p.beltH + 0.3, p.ws - 0.25)); }
      else { trim.push(new RoundedBoxGeometry(0.2, 0.12, 0.1, 2, 0.03).translate(sx * (W / 2 + 0.04), p.beltH + 0.09, p.ws - 0.18)); trim.push(new THREE.BoxGeometry(0.1, 0.03, 0.05).translate(sx * (W / 2 - 0.04), p.beltH + 0.05, p.ws - 0.15)); }
      // wheel arch liners (dark) — hide the inside of the extrusion
      for (const za of [t.wb / 2, -t.wb / 2]) trim.push(new THREE.CylinderGeometry(t.wheelR + 0.08, t.wheelR + 0.08, 0.04, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(sx * (W / 2 - 0.36), t.wheelR, za));
      // classic tail fins
      if (t.fins) paint.push(new RoundedBoxGeometry(0.07, 0.2, 1.4, 2, 0.03).rotateX(-0.12).translate(sx * (W / 2 - 0.1), p.deckH + 0.04, -L / 2 + 0.75));
    }
    // lamps: each model's own layout, painted into its own atlas
    const LF = lampFaces(t); const dims = {};
    for (const [, reg, a, b, , d] of LF.faces) { const w = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), h = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]); const o = dims[reg] || (dims[reg] = [0, 0]); o[0] = Math.max(o[0], w); o[1] = Math.max(o[1], h); }
    if (!this.lampTex[t.key]) this.lampTex[t.key] = lampAtlas(t, dims);
    const lamp = new LampBuilder(this.lampTex[t.key].R);
    for (const [fn, reg, a, b, c, d, n] of LF.faces) lamp.face(fn, reg, a, b, c, d, n, false);
    // dark bezels behind the clusters
    if (!LF.f.slope) { const { yT, yB } = LF; const f = LF.f; for (const sx of [-1, 1]) trim.push(new THREE.BoxGeometry(f.hw + 0.03, yT - yB + 0.03, 0.05).translate(sx * (W / 2 - 0.07 - f.hw / 2), (yT + yB) / 2, L / 2 - 0.005)); }
    if (LF.r.k !== 'bumper') { const r = LF.r; const tT = p.tailH - r.ty; for (const sx of [-1, 1]) trim.push(new THREE.BoxGeometry(r.k === 'vert' ? r.tw + 0.03 : r.tw + 0.03, r.th + 0.02, 0.05).translate(sx * (W / 2 - (r.k === 'vert' ? 0.04 : 0.07) - r.tw / 2), tT - r.th / 2, -L / 2 + 0.005)); }
    // bumpers, grille backing, plate, exhaust
    const bh = t.cls === 'Truck' ? 0.34 : 0.2, by = t.clear + (t.cls === 'Truck' ? 0.24 : 0.15);
    bump.push(new RoundedBoxGeometry(W * (t.cls === 'Truck' ? 1.0 : 0.96), bh, 0.22, 2, 0.06).translate(0, by, L / 2 - 0.08));
    if (LF.r.k === 'bumper') { // trucks: steel rear bar carrying the lamps, and an underride guard
      const yc = (t.box ? t.box.y0 : p.deckH) - 0.24; steel.push(new THREE.BoxGeometry(W - 0.06, 0.26, 0.1).translate(0, yc, -L / 2 - 0.02)); steel.push(new THREE.BoxGeometry(W * 0.86, 0.14, 0.12).translate(0, t.clear + 0.18, -L / 2 + 0.25));
      for (const sx of [-0.4, 0.4]) steel.push(new THREE.BoxGeometry(0.08, yc - t.clear - 0.2, 0.08).translate(sx * W, (yc + t.clear + 0.2) / 2, -L / 2 + 0.25));
    } else bump.push(new RoundedBoxGeometry(W * 0.96, 0.2, 0.22, 2, 0.06).translate(0, t.clear + 0.15, -L / 2 + 0.08));
    { const G = LF.g; trim.push(new THREE.BoxGeometry(G.gx * 2 + 0.04, G.gy1 - G.gy0 + 0.03, 0.05).translate(0, (G.gy0 + G.gy1) / 2, L / 2 + 0.003)); chrome.push(new THREE.BoxGeometry(G.gx * 2 + 0.02, 0.012, 0.02).translate(0, G.gy1 + 0.012, L / 2 + 0.03)); }
    const plateY = LF.r.k === 'bumper' ? (t.box ? t.box.y0 : p.deckH) - 0.24 : t.clear + 0.38;
    plates.push(new THREE.PlaneGeometry(0.52, 0.12 * 2.1 * 0.5 + 0.02).rotateY(Math.PI).translate(0, plateY, -L / 2 - (LF.r.k === 'bumper' ? 0.08 : 0.035)));
    if (!t.electric && t.cls !== 'Truck') chrome.push(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10).rotateX(Math.PI / 2).translate(-W * 0.3, t.clear + 0.06, -L / 2 + 0.02));
    trim.push(new THREE.BoxGeometry(W * 0.84, 0.12, L - t.wb * 0.2 - 1.2).translate(0, t.clear + 0.05, 0)); // underbody
    if (t.spoiler) { paint.push(new RoundedBoxGeometry(W * 0.92, 0.04, 0.32, 2, 0.015).translate(0, p.deckH + 0.26, -L / 2 + 0.28)); for (const sx of [-0.32, 0.32]) trim.push(new THREE.BoxGeometry(0.05, 0.26, 0.12).translate(sx * W, p.deckH + 0.12, -L / 2 + 0.3)); }
    if (t.scoop) trim.push(new RoundedBoxGeometry(0.62, 0.12, 0.8, 2, 0.04).translate(0, p.hoodH + 0.02, (p.ws + L / 2) / 2 - 0.1));
    if (t.rack) for (const sx of [-1, 1]) trim.push(new THREE.BoxGeometry(0.05, 0.06, roofLen * 0.95).translate(sx * (topHalf - 0.12), t.H + 0.02, (p.rf + p.rr) / 2));
    if (t.cargo) paint.push(new RoundedBoxGeometry(W - 0.02, t.H - t.clear - 0.18, (p.rg + 0.04) - (-L / 2 + 0.05), 2, 0.06).translate(0, (t.H + t.clear + 0.18) / 2, ((p.rg + 0.04) + (-L / 2 + 0.05)) / 2));
    if (t.pushbar) { trim.push(new THREE.BoxGeometry(W * 0.6, 0.06, 0.06).translate(0, p.noseH - 0.05, L / 2 + 0.16)); trim.push(new THREE.BoxGeometry(W * 0.6, 0.06, 0.06).translate(0, t.clear + 0.22, L / 2 + 0.16)); for (const sx of [-0.27, 0.27]) trim.push(new THREE.BoxGeometry(0.06, p.noseH - t.clear - 0.1, 0.06).translate(sx * W, (p.noseH + t.clear) / 2 + 0.06, L / 2 + 0.16)); }
    // open load bed: painted side walls (they carry the body's side texture), tailgate, ribbed floor liner
    let walls = null;
    if (t.bed) {
      const b = t.bed, z1 = (b.z0 ?? t.cabZ) - BS, z0 = -L / 2 + BS, y0 = p.deckH - 0.03, y1 = b.rail - BS;
      const sh = new THREE.Shape(); sh.moveTo(z0, y0); sh.lineTo(z1, y0); sh.lineTo(z1, y1 - 0.03); sh.quadraticCurveTo(z1, y1, z1 - 0.03, y1); sh.lineTo(z0 + 0.03, y1); sh.quadraticCurveTo(z0, y1, z0, y1 - 0.03); sh.closePath();
      const wg = extrudeSide(sh, b.wall, t, 0, 0, 4); const thick = Math.max(0.05, b.wall - 2 * BT) + 2 * BT; const off = W / 2 - thick / 2;
      walls = mergeGrouped([wg.clone().translate(off, 0, 0), wg.translate(-off, 0, 0)]);
      const iw = W - thick * 2;
      paint.push(new RoundedBoxGeometry(iw + 0.02, b.rail - p.deckH - 0.02, 0.07, 2, 0.02).translate(0, (b.rail + p.deckH) / 2 - 0.02, -L / 2 + 0.035));
      trim.push(new THREE.BoxGeometry(0.3, 0.05, 0.02).translate(0, b.rail - 0.12, -L / 2 - 0.005)); // tailgate handle
      const bl = (b.z0 ?? t.cabZ) - (-L / 2 + 0.07); for (let k = 0; k < 7; k++) trim.push(new THREE.BoxGeometry(0.05, 0.03, bl).translate(-iw / 2 + iw * (k + 0.5) / 7, p.deckH + 0.015, -L / 2 + 0.07 + bl / 2));
      trim.push(new THREE.BoxGeometry(iw, 0.012, bl).translate(0, p.deckH + 0.004, -L / 2 + 0.07 + bl / 2));
      if (b.head) { // dump truck: front wall and a cab protector over the roof
        paint.push(new RoundedBoxGeometry(W - 0.04, b.rail + 0.25 - p.deckH, 0.14, 2, 0.03).translate(0, (b.rail + 0.25 + p.deckH) / 2, (b.z0 ?? t.cabZ) - 0.07));
        paint.push(new RoundedBoxGeometry(W - 0.3, 0.07, 0.95, 2, 0.02).translate(0, b.rail + 0.22, (b.z0 ?? t.cabZ) + 0.45));
      }
    }
    // box truck body (one atlas: livery sides, roll-up rear door, plain panels)
    let box = null;
    if (t.box) {
      const bz0 = -L / 2 + 0.02, bz1 = t.box.z0, by0 = t.box.y0, by1 = t.H; box = new THREE.BoxGeometry(W - 0.03, by1 - by0, bz1 - bz0).translate(0, (by0 + by1) / 2, (bz0 + bz1) / 2);
      const uv = box.attributes.uv; const REG = [[0, 0.5, 1, 1], [0, 0.5, 1, 1], [0.5, 0, 1, 0.5], [0.5, 0, 1, 0.5], [0.5, 0, 1, 0.5], [0, 0, 0.5, 0.5]]; // +x -x +y -y +z(front) -z(rear)
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; const [u0, v0, u1, v1] = REG[f]; uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); }
      steel.push(new THREE.BoxGeometry(W - 0.2, 0.08, bz1 - bz0).translate(0, by0 - 0.04, (bz0 + bz1) / 2)); // sub-frame
    }
    if (t.cls === 'Truck') { // exhaust stack behind the cab
      const sx = W / 2 - 0.16, zc = t.cabZ - 0.12; chrome.push(new THREE.CylinderGeometry(0.06, 0.06, Hc - 0.7, 10).translate(sx, 0.7 + (Hc - 0.7) / 2 + 0.25, zc));
      steel.push(new THREE.BoxGeometry(0.5, 0.18, 0.7).translate(-W / 2 + 0.35, t.clear + 0.45, t.cabZ - 0.6)); // fuel tank / steps
    }
    const out = { body, cabin, topHalf, walls, box,
      paint: paint.length ? mergeAll(paint) : null, trim: mergeAll(trim), chrome: mergeAll(chrome), steel: steel.length ? mergeAll(steel) : null, lamps: lamp.build(), plates: mergeAll(plates) };
    if (t.lightbar) {
      out.barBase = new RoundedBoxGeometry(1.1, 0.1, 0.3, 2, 0.03).translate(0, Hc + 0.04, (p.rf + p.rr) / 2 + 0.1);
      out.barR = new RoundedBoxGeometry(0.46, 0.09, 0.24, 2, 0.03).translate(0.27, Hc + 0.12, (p.rf + p.rr) / 2 + 0.1);
      out.barB = new RoundedBoxGeometry(0.46, 0.09, 0.24, 2, 0.03).translate(-0.27, Hc + 0.12, (p.rf + p.rr) / 2 + 0.1);
    }
    if (t.sign === 'taxi') out.sign = new RoundedBoxGeometry(0.7, 0.24, 0.26, 2, 0.04).translate(0, Hc + 0.1, (p.rf + p.rr) / 2 - 0.1);
    this.cache[t.key] = out; return out;
  }

  // returns { group, body, cabin, lamps (9 emissive colours), barR, barB, deform() }
  build(typeKey, color, wear) {
    const t = CAR_TYPES[typeKey]; const P = this.parts(t);
    const col = t.fixedColor ?? color; wear = wear ?? this.rollWear(t);
    const g = new THREE.Group(); const model = new THREE.Group(); g.add(model);
    const body = new THREE.Mesh(P.body.clone(), [this.sideMat(t, col, wear), this.paintMat(col)]);
    const cabin = new THREE.Mesh(P.cabin.clone(), this.glass);
    model.add(body, cabin);
    const roofCol = t.livery === 'police' ? 0xf2f2f2 : col;
    const roof = P.paint ? new THREE.Mesh(P.paint, this.paintMat(roofCol)) : null; if (roof) model.add(roof);
    const walls = P.walls ? new THREE.Mesh(P.walls, [this.sideMat(t, col, wear), this.paintMat(col)]) : null; if (walls) model.add(walls);
    const boxM = P.box ? new THREE.Mesh(P.box, this.boxMat()) : null; if (boxM) model.add(boxM);
    if (P.steel) model.add(new THREE.Mesh(P.steel, this.steel));
    const lampMat = this.lampMat(t);
    model.add(new THREE.Mesh(P.trim, this.trim), new THREE.Mesh(P.chrome, this.chrome), new THREE.Mesh(P.lamps, lampMat), new THREE.Mesh(P.plates, this.plate));
    let barR = null, barB = null;
    if (P.barBase) {
      model.add(new THREE.Mesh(P.barBase, this.trim));
      barR = new THREE.MeshBasicMaterial({ color: 0x400000 }); barB = new THREE.MeshBasicMaterial({ color: 0x000040 });
      model.add(new THREE.Mesh(P.barR, barR), new THREE.Mesh(P.barB, barB));
    }
    if (P.sign) model.add(new THREE.Mesh(P.sign, this.taxiSign));
    // only the big panels cast shadows: small trim, lamps and plates add a shadow draw each for nothing visible
    const casters = new Set([body, cabin, roof, walls, boxM]); model.traverse((o) => { if (o.isMesh) { o.castShadow = casters.has(o); o.receiveShadow = o !== cabin; } });
    const orig = { body: body.geometry.attributes.position.array.slice(), cabin: cabin.geometry.attributes.position.array.slice() };
    const deform = (lx, ly, lz, dx, dy, dz, amt) => {
      for (const [mesh, o] of [[body, orig.body], [cabin, orig.cabin]]) {
        const pos = mesh.geometry.attributes.position; const a = pos.array; const R = 0.85;
        let changed = false;
        for (let i = 0; i < a.length; i += 3) {
          const ex = a[i] - lx, ey = a[i + 1] - ly, ez = a[i + 2] - lz; const d2 = ex * ex + ey * ey + ez * ez; if (d2 > R * R) continue;
          const f = (1 - Math.sqrt(d2) / R) ** 2 * amt; let nx = a[i] + dx * f, ny = a[i + 1] + dy * f, nz = a[i + 2] + dz * f;
          const ox = nx - o[i], oy = ny - o[i + 1], oz = nz - o[i + 2]; const od = Math.hypot(ox, oy, oz);
          if (od > 0.22) { const k = 0.22 / od; nx = o[i] + ox * k; ny = o[i + 1] + oy * k; nz = o[i + 2] + oz * k; }
          a[i] = nx; a[i + 1] = ny; a[i + 2] = nz; changed = true;
        }
        if (changed) pos.needsUpdate = true;
      }
    };
    const repair = () => { body.geometry.attributes.position.array.set(orig.body); body.geometry.attributes.position.needsUpdate = true; cabin.geometry.attributes.position.array.set(orig.cabin); cabin.geometry.attributes.position.needsUpdate = true; };
    const repaint = (c) => { const m = [this.sideMat(t, c), this.paintMat(c)]; body.material = m; if (walls) walls.material = m; if (roof) roof.material = this.paintMat(t.livery === 'police' ? 0xf2f2f2 : c); };
    return { group: g, model, body, cabin, lamps: lampMat.userData.uL.value, lampMat, barR, barB, deform, repair, repaint, color: col, wear };
  }
}
// textured lamp quads with a per-vertex function id (lfn) for the lamp shader
class LampBuilder {
  constructor(R) { this.R = R; this.p = []; this.n = []; this.u = []; this.f = []; }
  face(fn, region, a, b, c, d, n, flipU) {
    let [u0, v0, u1, v1] = this.R[region]; if (flipU) [u0, u1] = [u1, u0];
    let q = [[a, u0, v0], [b, u1, v0], [c, u1, v1], [d, u0, v1]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) q = [q[1], q[0], q[3], q[2]]; // keep the winding facing outward
    for (const i of [0, 1, 2, 0, 2, 3]) { const [v, uu, vv] = q[i]; this.p.push(...v); this.n.push(...n); this.u.push(uu, vv); this.f.push(fn); }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('lfn', new THREE.Float32BufferAttribute(this.f, 1));
    g.computeBoundingSphere(); return g;
  }
}
function strip(a, b, w) {
  const d = new THREE.Vector3().subVectors(b, a); const len = d.length();
  const g = new THREE.BoxGeometry(0.035, len, w); const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)); g.applyMatrix4(m); return g;
}
function mergeAll(list) { const gs = list.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; }); return mergeGeometries(gs); }

// ---------------- instanced wheels ----------------
export class Wheels {
  constructor(scene, max = 240) {
    const prof = [[0.6, -0.5], [0.86, -0.5], [0.95, -0.46], [1.0, -0.34], [1.0, 0.34], [0.95, 0.46], [0.86, 0.5], [0.6, 0.5]].map(([r, y]) => new THREE.Vector2(r, y));
    const tire = new THREE.LatheGeometry(prof, 28).rotateZ(Math.PI / 2);
    // tread grooves via vertex darkening isn't possible on lathe; use a slight bumpy normal from a dark texture instead
    const tt = TX.tire(); tt.map.repeat.set(1, 1); this.tire = new THREE.InstancedMesh(tire, new THREE.MeshStandardMaterial({ map: tt.map, normalMap: tt.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), color: 0xffffff, roughness: 0.88 }), max);
    const parts = [];
    const add = (g, hex) => { const n = g.index ? g.toNonIndexed() : g; const c = new THREE.Color(hex); const a = new Float32Array(n.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } n.setAttribute('color', new THREE.BufferAttribute(a, 3)); n.deleteAttribute('uv'); parts.push(n); };
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.8, 24, 1, true).rotateZ(Math.PI / 2), 0x9a9da3);
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 24).rotateZ(Math.PI / 2).translate(0.36, 0, 0), 0x2a2b2e);
    add(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 20).rotateZ(Math.PI / 2).translate(0.1, 0, 0), 0x55575c);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; add(new THREE.BoxGeometry(0.08, 0.5, 0.13).translate(0, 0.32, 0).rotateX(a).translate(0.4, 0, 0), 0xd5d8dc); }
    add(new THREE.TorusGeometry(0.6, 0.035, 6, 24).rotateY(Math.PI / 2).translate(0.4, 0, 0), 0xe0e3e6);
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12).rotateZ(Math.PI / 2).translate(0.42, 0, 0), 0xc9ccd0);
    this.rim = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.95, roughness: 0.18 }), max);
    for (const im of [this.tire, this.rim]) { im.castShadow = true; im.frustumCulled = false; im.count = 0; scene.add(im); }
    this.free = []; for (let i = max - 1; i >= 0; i--) this.free.push(i); this.used = 0;
    const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < max; i++) { this.tire.setMatrixAt(i, z); this.rim.setMatrixAt(i, z); this.rim.setColorAt(i, new THREE.Color(1, 1, 1)); }
  }
  alloc(rimColor = 0xffffff) { const i = this.free.pop(); if (i === undefined) return -1; if (i + 1 > this.used) { this.used = i + 1; this.tire.count = this.rim.count = this.used; } this.rim.setColorAt(i, new THREE.Color(rimColor)); this.rim.instanceColor.needsUpdate = true; return i; }
  release(i) { if (i < 0) return; const z = new THREE.Matrix4().makeScale(0, 0, 0); this.tire.setMatrixAt(i, z); this.rim.setMatrixAt(i, z); this.free.push(i); this.free.sort((a, b) => b - a); this.dirty = true;
    let top = this.used; while (top > 0 && this.free.includes(top - 1)) top--; if (top !== this.used) { this.used = top; this.tire.count = this.rim.count = top; } }
  set(i, m) { if (i < 0) return; this.tire.setMatrixAt(i, m); this.rim.setMatrixAt(i, m); this.dirty = true; }
  commit() { if (this.dirty) { this.tire.instanceMatrix.needsUpdate = true; this.rim.instanceMatrix.needsUpdate = true; this.dirty = false; } }
}
