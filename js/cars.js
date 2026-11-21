// Big Steal Car — procedural car models (extruded side profiles, clear-coat paint, liveries) and instanced wheels.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_TYPES } from './config.js';
import * as TX from './textures.js';

const BT = 0.07, BS = 0.045; // extrude bevel thickness / size

function profile(t) {
  const L = t.L, p = t.prof, c = t.clear + BS, zF = L / 2 - BS, zR = -L / 2 + BS;
  const ar = t.wheelR + 0.1, wy = t.wheelR, fa = t.wb / 2, ra = -t.wb / 2;
  const s = new THREE.Shape();
  const rg = Math.max(p.rg, zR + 0.3);
  const th0 = Math.asin(Math.max(-0.99, Math.min(0.99, (c - wy) / ar)));
  s.moveTo(zR, c + 0.14);
  s.lineTo(zR, p.tailH - 0.05);
  s.quadraticCurveTo(zR - 0.02, p.deckH, zR + 0.28, p.deckH);
  if (t.cargo) { s.lineTo(rg, p.deckH); s.lineTo(p.ws - 0.05, p.beltH); }
  else { s.lineTo(rg, p.deckH); s.lineTo(rg + 0.12, p.beltH); s.lineTo(p.ws, p.beltH); }
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
  const p = t.prof; const s = new THREE.Shape(); const H = t.H - BS; const b = p.beltH - 0.04;
  const r = 0.12; const rg = Math.max(p.rg, -t.L / 2 + BS + 0.3);
  s.moveTo(p.ws, b);
  s.lineTo(p.rf + 0.18, H - 0.03);
  s.quadraticCurveTo(p.rf, H, p.rf - r, H);
  s.lineTo(p.rr + r, H);
  s.quadraticCurveTo(p.rr, H, p.rr - 0.08, H - 0.06);
  s.lineTo(t.cargo ? rg - 0.02 : rg + 0.12, b);
  s.lineTo(p.ws, b);
  return s;
}
// extrude a side profile across the car's width, map into car space (x = width, z = length) and taper the top
function extrudeSide(shape, width, t, taperFrom, taperAmt, curve = 10) {
  const depth = Math.max(0.05, width - 2 * BT);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: BT, bevelSize: BS, bevelSegments: 3, curveSegments: curve, steps: 1 });
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const H = t.H;
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i), sy = pos.getY(i), sz = pos.getZ(i);
    let x = depth / 2 - sz; const y = sy, z = sx;
    if (taperAmt) { const k = Math.max(0, (y - taperFrom) / (H - taperFrom)); x *= 1 - taperAmt * k; }
    else { const mid = (t.clear + t.prof.beltH) / 2, hh = (t.prof.beltH - t.clear) / 2; const k = (y - mid) / hh; x *= 1 - 0.035 * k * k; }
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
  g.computeBoundingSphere();
  return g;
}

export class CarFactory {
  constructor() {
    this.cache = {}; this.paint = new Map(); this.side = new Map();
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0x0c131b, metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.82, envMapIntensity: 1.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    this.trim = new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.62, metalness: 0.15 });
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xd8dadc, metalness: 1, roughness: 0.22 });
    this.lamp = TX.carLights();
    this.grille = new THREE.MeshStandardMaterial({ map: this.lamp.map, roughness: 0.55, metalness: 0.4 });
    this.plateTex = TX.plate();
    this.plate = new THREE.MeshStandardMaterial({ map: this.plateTex, roughness: 0.5 });
    this.taxiSign = new THREE.MeshStandardMaterial({ map: TX.taxiSign(), emissiveMap: null, emissive: 0xffd60a, emissiveIntensity: 0.2, roughness: 0.4 });
    this.night = 0;
  }
  setNight(n) { this.taxiSign.emissiveIntensity = 0.2 + n * 1.2; this.night = n; }
  // every lamp on a car is one mesh; a float attribute picks which of 8 functions a face belongs to and a
  // per-car uniform array says how bright each function glows right now.
  lampMat() {
    const m = new THREE.MeshStandardMaterial({ map: this.lamp.map, emissiveMap: this.lamp.glow, emissive: 0xffffff, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.55 });
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
  paintMat(color) {
    if (!this.paint.has(color)) this.paint.set(color, new THREE.MeshPhysicalMaterial({ color, metalness: 0.42, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.22, envMapIntensity: 0.95 }));
    return this.paint.get(color);
  }
  sideMat(t, color) {
    const key = t.key + ':' + color;
    if (!this.side.has(key)) {
      const tk = t.livery ? t.key : 'gen:' + t.key;
      if (!this.cache['side:' + tk]) this.cache['side:' + tk] = TX.carSide(t, t.livery);
      const m = this.paintMat(t.livery ? 0xffffff : color).clone(); m.map = this.cache['side:' + tk];
      if (!this.cache['panel:' + t.key]) this.cache['panel:' + t.key] = TX.carPanels(t);
      m.normalMap = this.cache['panel:' + t.key]; m.normalScale = new THREE.Vector2(0.7, 0.7); this.side.set(key, m);
    }
    return this.side.get(key);
  }
  parts(t) {
    if (this.cache[t.key]) return this.cache[t.key];
    const p = t.prof, W = t.W, L = t.L;
    const body = extrudeSide(profile(t), W, t, 0, 0, 12);
    const cabW = W * 0.86; const cabin = extrudeSide(cabinShape(t), cabW, t, p.beltH, t.cargo ? 0.05 : 0.14, 8);
    const topHalf = (cabW / 2) * (1 - (t.cargo ? 0.05 : 0.14)) + 0.01;
    const paint = [], trim = [], chrome = [], plates = []; const lamp = new LampBuilder(this.lamp.R);
    // roof panel
    const roofLen = (p.rf - p.rr) - 0.05;
    if (!t.cargo) paint.push(new RoundedBoxGeometry(topHalf * 2, 0.06, roofLen, 2, 0.025).translate(0, t.H - BS - 0.005, (p.rf + p.rr) / 2));
    // pillars (A + C) as thin painted strips on each side
    for (const sx of [-1, 1]) {
      const a0 = new THREE.Vector3(sx * (cabW / 2 - 0.03), p.beltH, p.ws - 0.02), a1 = new THREE.Vector3(sx * (topHalf - 0.02), t.H - BS - 0.02, p.rf + 0.12);
      paint.push(strip(a0, a1, 0.07));
      if (!t.cargo) { const c0 = new THREE.Vector3(sx * (cabW / 2 - 0.03), p.beltH, p.rg + 0.14), c1 = new THREE.Vector3(sx * (topHalf - 0.02), t.H - BS - 0.02, p.rr - 0.04); paint.push(strip(c0, c1, 0.09)); }
      // B pillar
      if (!t.cargo && t.L > 4.2) { const zb = (p.ws + p.rr) / 2 + 0.05; trim.push(strip(new THREE.Vector3(sx * (cabW / 2 - 0.04), p.beltH, zb), new THREE.Vector3(sx * (topHalf - 0.03), t.H - BS - 0.03, zb - 0.05), 0.06)); }
      // belt chrome line + mirror
      chrome.push(new THREE.BoxGeometry(0.02, 0.025, (p.ws - p.rg) * 0.95).translate(sx * (cabW / 2 + 0.005), p.beltH - 0.01, (p.ws + p.rg) / 2));
      trim.push(new RoundedBoxGeometry(0.2, 0.12, 0.1, 2, 0.03).translate(sx * (W / 2 + 0.04), p.beltH + 0.09, p.ws - 0.18));
      trim.push(new THREE.BoxGeometry(0.1, 0.03, 0.05).translate(sx * (W / 2 - 0.04), p.beltH + 0.05, p.ws - 0.15));
      // lamp clusters: crisp textured lenses on a slim dark bezel (front: headlight + DRL + indicator, rear: tail + indicator + reverse)
      {
        const xo = sx * (W / 2 - 0.07), xi = sx * (W / 2 - 0.57), xt = sx * (W / 2 - 0.19); const zf = L / 2 + 0.022;
        const yT = p.noseH - 0.11, yB = p.noseH - 0.27, yD = yB + 0.032;
        trim.push(new THREE.BoxGeometry(0.53, 0.18, 0.05).translate(sx * (W / 2 - 0.32), (yT + yB) / 2, L / 2 - 0.005));
        lamp.face(0, 'head', [xt, yD, zf], [xi, yD, zf], [xi, yT, zf], [xt, yT, zf], [0, 0, 1], false);
        lamp.face(sx > 0 ? 2 : 3, 'turnF', [xo, yD, zf], [xt, yD, zf], [xt, yT, zf], [xo, yT, zf], [0, 0, 1], false);
        lamp.face(1, 'drl', [xo, yB, zf], [xi, yB, zf], [xi, yD - 0.004, zf], [xo, yD - 0.004, zf], [0, 0, 1], false);
        const xs = sx * (W / 2 * 0.997 + 0.006); // amber side repeater just behind the front corner
        lamp.face(sx > 0 ? 2 : 3, 'mark', [xs, p.noseH - 0.23, L / 2 - 0.32], [xs, p.noseH - 0.23, L / 2 - 0.13], [xs, p.noseH - 0.16, L / 2 - 0.13], [xs, p.noseH - 0.16, L / 2 - 0.32], [sx, 0, 0], false);
        const zr = -L / 2 - 0.022, tT = p.tailH - 0.075, tB = p.tailH - 0.225, tM = (tT + tB) / 2, xr = sx * (W / 2 - 0.37);
        trim.push(new THREE.BoxGeometry(0.53, 0.17, 0.05).translate(sx * (W / 2 - 0.32), (tT + tB) / 2, -L / 2 + 0.005));
        lamp.face(4, 'tail', [xo, tB, zr], [xr, tB, zr], [xr, tT, zr], [xo, tT, zr], [0, 0, -1], false);
        lamp.face(sx > 0 ? 5 : 6, 'turnR', [xr, tM + 0.004, zr], [xi, tM + 0.004, zr], [xi, tT, zr], [xr, tT, zr], [0, 0, -1], false);
        lamp.face(7, 'rev', [xr, tB, zr], [xi, tB, zr], [xi, tM - 0.004, zr], [xr, tM - 0.004, zr], [0, 0, -1], false);
        lamp.face(4, 'tail', [xs, tB + 0.03, -L / 2 + 0.07], [xs, tB + 0.03, -L / 2 + 0.25], [xs, tB + 0.1, -L / 2 + 0.25], [xs, tB + 0.1, -L / 2 + 0.07], [sx, 0, 0], false);
      }
      // wheel arch liners (dark) — hide the inside of the extrusion
      for (const za of [t.wb / 2, -t.wb / 2]) trim.push(new THREE.CylinderGeometry(t.wheelR + 0.08, t.wheelR + 0.08, 0.04, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(sx * (W / 2 - 0.36), t.wheelR, za));
    }
    // bumpers, grille, plate, exhaust
    trim.push(new RoundedBoxGeometry(W * 0.96, 0.2, 0.22, 2, 0.06).translate(0, t.clear + 0.15, L / 2 - 0.08));
    trim.push(new RoundedBoxGeometry(W * 0.96, 0.2, 0.22, 2, 0.06).translate(0, t.clear + 0.15, -L / 2 + 0.08));
    trim.push(new THREE.BoxGeometry(W * 0.42, 0.17, 0.05).translate(0, p.noseH - 0.19, L / 2 + 0.003));
    { const gx = W * 0.2, z = L / 2 + 0.03, y0 = p.noseH - 0.265, y1 = p.noseH - 0.115; lamp.face(8, 'grille', [gx, y0, z], [-gx, y0, z], [-gx, y1, z], [gx, y1, z], [0, 0, 1], false); }
    { const gx = W * 0.3, z = L / 2 + 0.032, y0 = t.clear + 0.08, y1 = t.clear + 0.17; lamp.face(8, 'grille', [gx, y0, z], [-gx, y0, z], [-gx, y1, z], [gx, y1, z], [0, 0, 1], false); }
    chrome.push(new THREE.BoxGeometry(W * 0.42, 0.012, 0.02).translate(0, p.noseH - 0.1, L / 2 + 0.03));
    plates.push(new THREE.PlaneGeometry(0.52, 0.12 * 2.1 * 0.5 + 0.02).rotateY(Math.PI).translate(0, t.clear + 0.38, -L / 2 - 0.035));
    chrome.push(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10).rotateX(Math.PI / 2).translate(-W * 0.3, t.clear + 0.06, -L / 2 + 0.02));
    trim.push(new THREE.BoxGeometry(W * 0.84, 0.12, L - t.wb * 0.2 - 1.2).translate(0, t.clear + 0.05, 0)); // underbody
    if (t.spoiler) { paint.push(new RoundedBoxGeometry(W * 0.92, 0.04, 0.32, 2, 0.015).translate(0, p.deckH + 0.26, -L / 2 + 0.28)); for (const sx of [-0.32, 0.32]) trim.push(new THREE.BoxGeometry(0.05, 0.26, 0.12).translate(sx * W, p.deckH + 0.12, -L / 2 + 0.3)); }
    if (t.scoop) trim.push(new RoundedBoxGeometry(0.62, 0.12, 0.8, 2, 0.04).translate(0, p.hoodH + 0.02, (p.ws + L / 2) / 2 - 0.1));
    if (t.rack) for (const sx of [-1, 1]) trim.push(new THREE.BoxGeometry(0.05, 0.06, roofLen * 0.95).translate(sx * (topHalf - 0.12), t.H + 0.02, (p.rf + p.rr) / 2));
    if (t.cargo) paint.push(new RoundedBoxGeometry(W - 0.02, t.H - t.clear - 0.18, (p.rg + 0.04) - (-L / 2 + 0.05), 2, 0.06).translate(0, (t.H + t.clear + 0.18) / 2, ((p.rg + 0.04) + (-L / 2 + 0.05)) / 2));
    if (t.pushbar) { trim.push(new THREE.BoxGeometry(W * 0.6, 0.06, 0.06).translate(0, p.noseH - 0.05, L / 2 + 0.16)); trim.push(new THREE.BoxGeometry(W * 0.6, 0.06, 0.06).translate(0, t.clear + 0.22, L / 2 + 0.16)); for (const sx of [-0.27, 0.27]) trim.push(new THREE.BoxGeometry(0.06, p.noseH - t.clear - 0.1, 0.06).translate(sx * W, (p.noseH + t.clear) / 2 + 0.06, L / 2 + 0.16)); }
    const out = { body, cabin, topHalf,
      paint: paint.length ? mergeAll(paint) : null, trim: mergeAll(trim), chrome: mergeAll(chrome), lamps: lamp.build(), plates: mergeAll(plates) };
    if (t.lightbar) {
      out.barBase = new RoundedBoxGeometry(1.1, 0.1, 0.3, 2, 0.03).translate(0, t.H + 0.04, (p.rf + p.rr) / 2 + 0.1);
      out.barR = new RoundedBoxGeometry(0.46, 0.09, 0.24, 2, 0.03).translate(0.27, t.H + 0.12, (p.rf + p.rr) / 2 + 0.1);
      out.barB = new RoundedBoxGeometry(0.46, 0.09, 0.24, 2, 0.03).translate(-0.27, t.H + 0.12, (p.rf + p.rr) / 2 + 0.1);
    }
    if (t.sign === 'taxi') out.sign = new RoundedBoxGeometry(0.7, 0.24, 0.26, 2, 0.04).translate(0, t.H + 0.1, (p.rf + p.rr) / 2 - 0.1);
    this.cache[t.key] = out; return out;
  }

  // returns { group, body, cabin, lamps (8 emissive colours), barR, barB, deform() }
  build(typeKey, color) {
    const t = CAR_TYPES[typeKey]; const P = this.parts(t);
    const col = t.fixedColor ?? color;
    const g = new THREE.Group(); const model = new THREE.Group(); g.add(model);
    const body = new THREE.Mesh(P.body.clone(), [this.sideMat(t, col), this.paintMat(col)]);
    const cabin = new THREE.Mesh(P.cabin.clone(), this.glass);
    model.add(body, cabin);
    const roofCol = t.livery === 'police' ? 0xf2f2f2 : col;
    if (P.paint) model.add(new THREE.Mesh(P.paint, this.paintMat(roofCol)));
    const lampMat = this.lampMat();
    model.add(new THREE.Mesh(P.trim, this.trim), new THREE.Mesh(P.chrome, this.chrome), new THREE.Mesh(P.lamps, lampMat), new THREE.Mesh(P.plates, this.plate));
    let barR = null, barB = null;
    if (P.barBase) {
      model.add(new THREE.Mesh(P.barBase, this.trim));
      barR = new THREE.MeshBasicMaterial({ color: 0x400000 }); barB = new THREE.MeshBasicMaterial({ color: 0x000040 });
      model.add(new THREE.Mesh(P.barR, barR), new THREE.Mesh(P.barB, barB));
    }
    if (P.sign) model.add(new THREE.Mesh(P.sign, this.taxiSign));
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = o !== cabin; } });
    cabin.castShadow = true;
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
    const repaint = (c) => { body.material = [this.sideMat(t, c), this.paintMat(c)]; model.children.forEach((m) => { if (m.geometry === P.paint) m.material = this.paintMat(t.livery === 'police' ? 0xf2f2f2 : c); }); };
    return { group: g, model, body, cabin, lamps: lampMat.userData.uL.value, lampMat, barR, barB, deform, repair, repaint, color: col };
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
    this.tire = new THREE.InstancedMesh(tire, new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }), max);
    const parts = [];
    const add = (g, hex) => { const n = g.index ? g.toNonIndexed() : g; const c = new THREE.Color(hex); const a = new Float32Array(n.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } n.setAttribute('color', new THREE.BufferAttribute(a, 3)); n.deleteAttribute('uv'); parts.push(n); };
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.8, 24, 1, true).rotateZ(Math.PI / 2), 0x9a9da3);
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 24).rotateZ(Math.PI / 2).translate(0.36, 0, 0), 0x2a2b2e);
    add(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 20).rotateZ(Math.PI / 2).translate(0.1, 0, 0), 0x55575c);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; add(new THREE.BoxGeometry(0.08, 0.5, 0.13).translate(0, 0.32, 0).rotateX(a).translate(0.4, 0, 0), 0xd5d8dc); }
    add(new THREE.TorusGeometry(0.6, 0.035, 6, 24).rotateY(Math.PI / 2).translate(0.4, 0, 0), 0xe0e3e6);
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12).rotateZ(Math.PI / 2).translate(0.42, 0, 0), 0xc9ccd0);
    this.rim = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.25 }), max);
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
