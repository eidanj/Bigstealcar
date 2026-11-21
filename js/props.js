// Big Steal Car — instanced street furniture. Knockable props become debris, streetlights hinge over and fall.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GB } from './world.js';
import { rng, clamp } from './util.js';
import * as TX from './textures.js';

const colorize = (g, hex) => { const c = new THREE.Color(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const T = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };
const nonIdx = (g) => (g.index ? g.toNonIndexed() : g);
const merge = (parts) => { const gs = parts.map((p) => { const g = nonIdx(p); if (g.attributes.uv) g.deleteAttribute('uv'); return g; }); return mergeGeometries(gs); };

// prop kinds: geometry builder, collider radius, height, mass, lying radius
const KINDS = {
  hydrant: { r: 0.22, h: 0.8, mass: 70, geo: () => merge([colorize(T(new THREE.CylinderGeometry(0.15, 0.17, 0.62, 10), 0, 0.31, 0), 0xc1121f), colorize(T(new THREE.SphereGeometry(0.16, 10, 6, 0, 6.3, 0, 1.6), 0, 0.62, 0), 0xc1121f), colorize(T(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), 0, 0.42, 0, 0, 0, Math.PI / 2), 0xd4a017), colorize(T(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), 0, 0.03, 0), 0x8a0f17)]) },
  trash: { r: 0.32, h: 0.95, mass: 25, geo: () => merge([colorize(T(new THREE.CylinderGeometry(0.3, 0.26, 0.9, 12, 1, false), 0, 0.45, 0), 0x2d6a4f), colorize(T(new THREE.CylinderGeometry(0.33, 0.33, 0.06, 12), 0, 0.92, 0), 0x1b4332)]) },
  mailbox: { r: 0.35, h: 1.2, mass: 40, geo: () => merge([colorize(T(new THREE.BoxGeometry(0.5, 0.7, 0.45), 0, 0.85, 0), 0x1d4ed8), colorize(T(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12, 1, false, 0, Math.PI), 0, 1.2, 0, 0, Math.PI / 2, Math.PI / 2), 0x1d4ed8), colorize(T(new THREE.BoxGeometry(0.08, 0.5, 0.08), 0.18, 0.25, 0.15), 0x222), colorize(T(new THREE.BoxGeometry(0.08, 0.5, 0.08), -0.18, 0.25, -0.15), 0x222), colorize(T(new THREE.BoxGeometry(0.08, 0.5, 0.08), 0.18, 0.25, -0.15), 0x222), colorize(T(new THREE.BoxGeometry(0.08, 0.5, 0.08), -0.18, 0.25, 0.15), 0x222)]) },
  bench: { r: 0.75, h: 0.9, mass: 55, geo: () => { const p = []; for (let k = 0; k < 3; k++) p.push(colorize(T(new THREE.BoxGeometry(1.8, 0.05, 0.12), 0, 0.46, -0.16 + k * 0.15), 0x8b5a2b)); for (let k = 0; k < 2; k++) p.push(colorize(T(new THREE.BoxGeometry(1.8, 0.12, 0.04), 0, 0.68 + k * 0.16, -0.26, -0.2), 0x8b5a2b)); for (const x of [-0.75, 0.75]) { p.push(colorize(T(new THREE.BoxGeometry(0.06, 0.46, 0.45), x, 0.23, 0), 0x2b2b2b)); p.push(colorize(T(new THREE.BoxGeometry(0.06, 0.5, 0.06), x, 0.7, -0.27), 0x2b2b2b)); } return merge(p); } },
  cone: { r: 0.22, h: 0.72, mass: 3, geo: () => merge([colorize(T(new THREE.ConeGeometry(0.17, 0.66, 12), 0, 0.37, 0), 0xff6b00), colorize(T(new THREE.CylinderGeometry(0.115, 0.13, 0.08, 12), 0, 0.36, 0), 0xffffff), colorize(T(new THREE.BoxGeometry(0.42, 0.04, 0.42), 0, 0.02, 0), 0x222)]) },
  dumpster: { r: 1.05, h: 1.25, mass: 320, geo: () => merge([colorize(T(new THREE.BoxGeometry(1.9, 1.05, 1.15), 0, 0.62, 0), 0x2f5d50), colorize(T(new THREE.BoxGeometry(1.96, 0.08, 1.25), 0, 1.17, -0.02, 0.12), 0x1f3f37), colorize(T(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8), 0.8, 0.05, 0.45), 0x111), colorize(T(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8), -0.8, 0.05, 0.45), 0x111)]) },
};

export class Props {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.root = new THREE.Group(); scene.add(this.root);
    this.recs = []; this.byKind = {}; this.dyn = [];
    this.poles = []; this.lamps = []; this.signals = []; this.trees = []; this.beacons = []; this.signs = []; this.waters = [];
    this.static = { metal: new GB(), dark: new GB() };
    this.night = 0; this.t = 0;
  }
  setWorld(w) { this.world = w; }

  // -------- registration (during world build) --------
  add(kind, x, z, yaw, base) {
    const K = KINDS[kind]; const rec = { kind, K, x, z, y: base, yaw, state: 'static', i: (this.byKind[kind] = (this.byKind[kind] || 0) + 1) - 1, timer: 0 };
    rec.pos = new THREE.Vector3(x, base, z); rec.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    rec.vel = new THREE.Vector3(); rec.ang = new THREE.Vector3();
    rec.col = this.world.circleCollider(x, z, K.r, 0, base + K.h, rec);
    this.recs.push(rec); return rec;
  }
  streetlight(x, z, yaw, base) { return this.pole('street', x, z, yaw, base); }
  lamp(x, z, base) { return this.pole('park', x, z, 0, base); }
  pole(type, x, z, yaw, base) {
    const rec = { pole: true, type, x, z, y: base, yaw, state: 'static', theta: 0, omega: 0, axis: new THREE.Vector3(1, 0, 0), timer: 0, i: this.poles.filter((p) => p.type === type).length };
    rec.col = this.world.circleCollider(x, z, type === 'street' ? 0.2 : 0.16, 0, base + 8, rec);
    this.poles.push(rec); return rec;
  }
  tree(x, z, base, s, type) { this.trees.push({ x, z, y: base, s, type, yaw: Math.random() * 6.28 }); this.world.circleCollider(x, z, 0.32 * s + 0.05, 0, base + 6 * s); }
  trafficLight(px, pz, dx, dz, rx, rz, k, l, axis) {
    const M = this.static.dark; const m = new THREE.Matrix4(); const y = this.world ? 0.15 : 0.15;
    m.makeTranslation(px, y + 3.6, pz); M.geo(new THREE.CylinderGeometry(0.12, 0.16, 7.2, 8), m, [0.18, 0.19, 0.2]);
    const armLen = 7.5; const ax = px - rx * armLen / 2, az = pz - rz * armLen / 2;
    m.makeRotationY(Math.atan2(rx, rz)); m.setPosition(ax, y + 6.9, az); M.geo(new THREE.BoxGeometry(0.12, 0.14, armLen), m, [0.18, 0.19, 0.2]);
    const heads = [[px - rx * 5.8, y + 6.2, pz - rz * 5.8], [px - dx * 0.25, y + 3.0, pz - dz * 0.25]];
    const yawFace = Math.atan2(-dx, -dz);
    for (const [hx, hy, hz] of heads) {
      m.makeRotationY(yawFace); m.setPosition(hx, hy, hz); M.geo(new THREE.BoxGeometry(0.42, 1.12, 0.32), m, [0.12, 0.12, 0.13]);
      const sig = { k, l, axis, pos: [], yaw: yawFace };
      for (let j = 0; j < 3; j++) sig.pos.push([hx - dx * 0.17, hy + 0.34 - j * 0.34, hz - dz * 0.17]);
      this.signals.push(sig);
    }
  }
  sign(text, x, y, z, yaw, w, h, opts) {
    const t = TX.label(text, { w: 1024, h: Math.round(1024 * h / w), size: Math.round(1024 * h / w * 0.62), ...opts });
    const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.5 });
    const g = new THREE.Group(); const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); face.position.z = 0.08;
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.15), new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.6, metalness: 0.5 }));
    g.add(back, face); g.position.set(x, y, z); g.rotation.y = yaw; g.traverse((o) => { o.castShadow = true; }); this.root.add(g);
    this.signs.push(mat); return g;
  }
  billboard(x, y, z, yaw, w) {
    const i = Math.floor(Math.random() * TX.AD_COUNT); const t = TX.billboard(i); const h = w * 0.375;
    const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.6 });
    const g = new THREE.Group(); const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); face.position.set(0, 3 + h / 2, 0.12);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, h + 0.4, 0.2), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7, metalness: 0.4 })); back.position.set(0, 3 + h / 2, 0);
    g.add(face, back);
    for (const dx of [-w * 0.35, w * 0.35]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), back.material); leg.position.set(dx, 1.5, -0.2); g.add(leg); }
    const cat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.8), back.material); cat.position.set(0, 3, 0.4); g.add(cat);
    g.position.set(x, y, z); g.rotation.y = yaw; g.traverse((o) => { o.castShadow = true; }); this.root.add(g);
    // a second face on the back
    const f2 = face.clone(); f2.rotation.y = Math.PI; f2.position.z = -0.12; g.add(f2);
    this.signs.push(mat);
  }
  beacon(x, y, z) { this.beacons.push([x, y, z]); }
  water(x, y, z, r) {
    if (!this.waterMat) { const n = TX.waterNormal(); n.repeat.set(2, 2); this.waterMat = new THREE.MeshStandardMaterial({ color: 0x3f7f95, roughness: 0.05, metalness: 0.2, normalMap: n, normalScale: new THREE.Vector2(0.4, 0.4) }); }
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2), this.waterMat); m.position.set(x, y, z); m.receiveShadow = true; this.root.add(m);
  }

  // -------- build instanced meshes --------
  finish() {
    const m4 = new THREE.Matrix4(), s1 = new THREE.Vector3(1, 1, 1);
    this.meshes = {};
    for (const kind in KINDS) {
      const n = this.byKind[kind] || 0; if (!n) continue;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
      const im = new THREE.InstancedMesh(KINDS[kind].geo(), mat, n); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      this.meshes[kind] = im; this.root.add(im);
    }
    for (const r of this.recs) { m4.compose(r.pos, r.quat, s1); this.meshes[r.kind].setMatrixAt(r.i, m4); }
    // poles
    const streetBody = merge([colorize(T(new THREE.CylinderGeometry(0.09, 0.14, 8, 8), 0, 4, 0), 0x50555c), colorize(T(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 8), 0, 0.25, 0), 0x3a3e44), colorize(T(new THREE.BoxGeometry(0.1, 0.1, 2.4), 0, 7.85, 1.15), 0x50555c), colorize(T(new THREE.BoxGeometry(0.42, 0.18, 0.9), 0, 7.85, 2.45), 0x3a3e44)]);
    const streetHead = T(new THREE.BoxGeometry(0.34, 0.05, 0.78), 0, 7.74, 2.45);
    const parkBody = merge([colorize(T(new THREE.CylinderGeometry(0.06, 0.1, 4, 8), 0, 2, 0), 0x1f2a24), colorize(T(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 8), 0, 0.2, 0), 0x1f2a24), colorize(T(new THREE.CylinderGeometry(0.22, 0.12, 0.18, 8), 0, 4.0, 0), 0x1f2a24)]);
    const parkHead = T(new THREE.SphereGeometry(0.26, 12, 8), 0, 4.32, 0);
    this.poleMesh = {};
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const [type, body, head] of [['street', streetBody, streetHead], ['park', parkBody, parkHead]]) {
      const list = this.poles.filter((p) => p.type === type); if (!list.length) continue;
      const bm = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), list.length);
      const hm = new THREE.InstancedMesh(head, this.headMat, list.length);
      bm.castShadow = true; bm.frustumCulled = hm.frustumCulled = false;
      const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.lightPool(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4 }), list.length);
      pool.frustumCulled = false; pool.renderOrder = 2;
      this.poleMesh[type] = { body: bm, head: hm, pool, list };
      const c = new THREE.Color(1, 1, 1);
      list.forEach((p, i) => { p.i = i; hm.setColorAt(i, c); this.poleMatrix(p); });
      this.root.add(bm, hm, pool);
    }
    // traffic signals: 3 lamps per head
    const lampGeo = new THREE.CircleGeometry(0.15, 14);
    this.signalMesh = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }), this.signals.length * 3);
    this.signalMesh.frustumCulled = false;
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();
    let idx = 0; for (const s of this.signals) { q.setFromAxisAngle(up, s.yaw); s.idx = []; for (const p of s.pos) { m4.compose(v.set(...p), q, s1); this.signalMesh.setMatrixAt(idx, m4); this.signalMesh.setColorAt(idx, new THREE.Color(0.05, 0.05, 0.05)); s.idx.push(idx++); } s.state = ''; }
    this.root.add(this.signalMesh);
    // trees
    this.buildTrees();
    // beacons
    if (this.beacons.length) {
      this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.1) });
      const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), this.beaconMat, this.beacons.length);
      this.beacons.forEach((b, i) => { m4.makeTranslation(...b); bm.setMatrixAt(i, m4); }); bm.frustumCulled = false; this.root.add(bm);
    }
    for (const key in this.static) { const gb = this.static[key]; if (gb.empty) continue; const mesh = new THREE.Mesh(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 })); mesh.castShadow = true; mesh.receiveShadow = true; this.root.add(mesh); }
  }

  buildTrees() {
    const leaf = this.trees.filter((t) => t.type === 'leaf'), palm = this.trees.filter((t) => t.type === 'palm');
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const R = rng(9);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
    if (leaf.length) {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.26, 3.4, 7).translate(0, 1.7, 0), trunkMat, leaf.length);
      const crownGeo = new THREE.IcosahedronGeometry(1, 1); const cp = crownGeo.attributes.position; const nz = (x, y, z) => Math.sin(x * 3.1 + y * 1.7) * Math.cos(z * 2.3 - x) * 0.18 + Math.sin(y * 5 + z * 4) * 0.06;
      for (let i = 0; i < cp.count; i++) { p.fromBufferAttribute(cp, i); const k = 1 + nz(p.x, p.y, p.z); cp.setXYZ(i, p.x * k * 2.1, p.y * k * 1.75, p.z * k * 2.1); }
      crownGeo.computeVertexNormals();
      const crown2 = crownGeo.clone().scale(0.7, 0.7, 0.7).translate(0.9, 0.9, -0.4);
      const crown = new THREE.InstancedMesh(mergeGeometries([crownGeo.translate(0, 4.4, 0), crown2.translate(0, 4.4, 0)]), leafMat, leaf.length);
      leaf.forEach((t, i) => {
        q.setFromAxisAngle(up, t.yaw); s.setScalar(t.s); p.set(t.x, t.y, t.z); m4.compose(p, q, s); trunk.setMatrixAt(i, m4); crown.setMatrixAt(i, m4);
        const c = new THREE.Color().setHSL(0.22 + R.range(-0.04, 0.05), R.range(0.35, 0.6), R.range(0.22, 0.36)); crown.setColorAt(i, c);
      });
      for (const im of [trunk, crown]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; this.root.add(im); }
    }
    if (palm.length) {
      const trunkG = new THREE.CylinderGeometry(0.16, 0.26, 8, 8, 6); const tp = trunkG.attributes.position;
      for (let i = 0; i < tp.count; i++) { const y = tp.getY(i) + 4; tp.setX(i, tp.getX(i) + (y / 8) ** 2 * 0.9); tp.setY(i, y); }
      trunkG.computeVertexNormals();
      const fronds = [];
      for (let k = 0; k < 9; k++) {
        const f = new THREE.PlaneGeometry(0.9, 3.4, 1, 4); const fp = f.attributes.position;
        for (let i = 0; i < fp.count; i++) { const yy = fp.getY(i) + 1.7; fp.setXYZ(i, fp.getX(i) * (1 - yy / 4), -0.22 * yy * yy * 0.5, yy); }
        f.computeVertexNormals(); f.rotateY((k / 9) * Math.PI * 2); f.rotateX(0); f.translate(0.9, 8, 0); fronds.push(f);
      }
      const frondG = mergeGeometries(fronds);
      const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x8a7050, roughness: 0.9 }), palm.length);
      const crown = new THREE.InstancedMesh(frondG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), palm.length);
      palm.forEach((t, i) => { q.setFromAxisAngle(up, t.yaw); s.setScalar(t.s); p.set(t.x, t.y, t.z); m4.compose(p, q, s); trunk.setMatrixAt(i, m4); crown.setMatrixAt(i, m4); crown.setColorAt(i, new THREE.Color().setHSL(0.25 + R.range(-0.03, 0.03), 0.55, R.range(0.25, 0.33))); });
      for (const im of [trunk, crown]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; this.root.add(im); }
    }
  }

  poleMatrix(p) {
    const M = this.poleMesh[p.type]; const m4 = this._m4 || (this._m4 = new THREE.Matrix4()); const q = this._q || (this._q = new THREE.Quaternion()); const q2 = this._q2 || (this._q2 = new THREE.Quaternion());
    q.setFromAxisAngle(p.axis, p.theta); q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw); q.multiply(q2);
    m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1)); M.body.setMatrixAt(p.i, m4); M.head.setMatrixAt(p.i, m4);
    // light pool under the head
    const reach = p.type === 'street' ? 2.45 : 0; const hx = p.x + Math.sin(p.yaw) * reach, hz = p.z + Math.cos(p.yaw) * reach;
    const sc = p.state === 'static' ? (p.type === 'street' ? 13 : 7) : 0.0001;
    m4.compose(new THREE.Vector3(hx, 0.03 + (this.world.ground(hx, hz)), hz), new THREE.Quaternion(), new THREE.Vector3(sc, 1, sc)); M.pool.setMatrixAt(p.i, m4);
    M.body.instanceMatrix.needsUpdate = M.head.instanceMatrix.needsUpdate = M.pool.instanceMatrix.needsUpdate = true;
  }

  // -------- collisions --------
  // called by vehicle physics when a car hits a knockable collider. returns true if it broke (car passes through)
  hit(rec, vx, vz, speed, mass) {
    if (rec.pole) {
      if (rec.state !== 'static') return true;
      if (speed < 6) return false;
      rec.state = 'falling'; rec.col.dead = true; rec.timer = 0;
      const h = Math.hypot(vx, vz) || 1; rec.axis.set(vz / h, 0, -vx / h); // fall toward travel direction
      rec.omega = Math.min(3.5, speed * 0.12); rec.theta = 0.02;
      const M = this.poleMesh[rec.type]; M.head.setColorAt(rec.i, new THREE.Color(0.05, 0.05, 0.05)); M.head.instanceColor.needsUpdate = true;
      this.onBreak && this.onBreak(rec, speed);
      return true;
    }
    if (rec.state !== 'static') return true;
    const K = rec.K; if (speed < (K.mass > 200 ? 9 : 2.5)) return false;
    rec.state = 'dyn'; rec.col.dead = true; rec.timer = 0;
    const share = clamp(mass / (mass + K.mass), 0.2, 1.0);
    rec.vel.set(vx * (1.15 * share) + (Math.random() - 0.5) * 2, 2 + speed * 0.22 * share * (K.mass > 200 ? 0.3 : 1), vz * (1.15 * share) + (Math.random() - 0.5) * 2);
    rec.ang.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12).multiplyScalar(K.mass > 200 ? 0.2 : 1);
    rec.pos.y += 0.05;
    this.dyn.push(rec); this.onBreak && this.onBreak(rec, speed);
    return true;
  }
  impulseLoss(rec, carMass) { if (rec.pole) return 0.06; return clamp(rec.K.mass / carMass, 0.002, 0.25); }

  // -------- per-frame --------
  setNight(n) {
    this.night = n; this.headMat.color.setScalar(0.25 + n * 5.0);
    for (const t in this.poleMesh) this.poleMesh[t].pool.material.opacity = n * 0.75;
    for (const m of this.signs) m.emissiveIntensity = 0.05 + n * 1.1;
  }
  update(dt, world, focus) {
    this.t += dt;
    if (this.beaconMat) this.beaconMat.color.setRGB(Math.sin(this.t * 3) > 0.6 ? 6 : 0.3, 0.1, 0.05);
    // traffic signal colours
    const ON = { r: [5, 0.25, 0.1], y: [5, 3, 0.2], g: [0.2, 5, 1.2] }; const OFF = [0.04, 0.04, 0.04]; const c = this._c || (this._c = new THREE.Color());
    let dirty = false;
    for (const s of this.signals) {
      const st = world.lightState(s.k, s.l, s.axis); if (st === s.state) continue; s.state = st; dirty = true;
      const set = (j, col) => this.signalMesh.setColorAt(s.idx[j], c.setRGB(...col));
      set(0, st === 'r' ? ON.r : OFF); set(1, st === 'y' ? ON.y : OFF); set(2, st === 'g' ? ON.g : OFF);
    }
    if (dirty) this.signalMesh.instanceColor.needsUpdate = true;
    // falling poles
    for (const p of this.poles) {
      if (p.state === 'static') continue;
      if (p.state === 'falling') {
        const L = p.type === 'street' ? 8 : 4; const g = (3 * 9.81) / (2 * L);
        p.omega += g * Math.sin(p.theta) * dt; p.theta += p.omega * dt;
        const lie = Math.PI / 2 - 0.03;
        if (p.theta >= lie) { p.theta = lie; if (Math.abs(p.omega) > 0.6) p.omega = -p.omega * 0.25; else { p.omega = 0; p.state = 'down'; } }
        this.poleMatrix(p);
      } else if (p.state === 'down') {
        p.timer += dt;
        if (p.timer > 50 && focus && Math.hypot(focus.x - p.x, focus.z - p.z) > 90) { p.state = 'static'; p.theta = 0; p.col.dead = false; const M = this.poleMesh[p.type]; M.head.setColorAt(p.i, new THREE.Color(1, 1, 1)); M.head.instanceColor.needsUpdate = true; this.poleMatrix(p); }
      }
    }
    // debris
    const m4 = this._dm || (this._dm = new THREE.Matrix4()); const s1 = new THREE.Vector3(1, 1, 1); const dq = this._dq || (this._dq = new THREE.Quaternion()); const tmp = this._tmp || (this._tmp = []);
    for (let k = this.dyn.length - 1; k >= 0; k--) {
      const r = this.dyn[k]; const K = r.K; r.timer += dt;
      if (r.state === 'dyn') {
        r.vel.y -= 9.81 * dt; r.pos.addScaledVector(r.vel, dt);
        const w = r.ang; const ang = w.length();
        if (ang > 1e-4) { dq.setFromAxisAngle(w.clone().multiplyScalar(1 / ang), ang * dt); r.quat.premultiply(dq).normalize(); }
        const gy = world.ground(r.pos.x, r.pos.z);
        // approximate lowest point: object up-axis tilt determines half-extent touching the ground
        const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(r.quat).y; const lowOff = upY > 0 ? 0 : -upY * K.h; const sideOff = Math.sqrt(Math.max(0, 1 - upY * upY)) * K.r * 0.8;
        const bottom = r.pos.y - lowOff - sideOff;
        if (bottom < gy) {
          r.pos.y += gy - bottom;
          if (r.vel.y < 0) r.vel.y = -r.vel.y * 0.28;
          r.vel.x *= 1 - Math.min(1, 6 * dt); r.vel.z *= 1 - Math.min(1, 6 * dt); w.multiplyScalar(1 - Math.min(1, 5 * dt));
          if (r.vel.lengthSq() < 0.3 && ang < 0.8) r.state = 'settle';
        }
        // bounce off buildings
        world.query(r.pos.x - 0.5, r.pos.z - 0.5, r.pos.x + 0.5, r.pos.z + 0.5, tmp);
        for (const c of tmp) {
          if (c.k !== 0 || r.pos.y > c.y1) continue;
          if (r.pos.x > c.x0 && r.pos.x < c.x1 && r.pos.z > c.z0 && r.pos.z < c.z1) {
            const dx0 = r.pos.x - c.x0, dx1 = c.x1 - r.pos.x, dz0 = r.pos.z - c.z0, dz1 = c.z1 - r.pos.z; const mn = Math.min(dx0, dx1, dz0, dz1);
            if (mn === dx0) { r.pos.x = c.x0; r.vel.x = -Math.abs(r.vel.x) * 0.3; } else if (mn === dx1) { r.pos.x = c.x1; r.vel.x = Math.abs(r.vel.x) * 0.3; } else if (mn === dz0) { r.pos.z = c.z0; r.vel.z = -Math.abs(r.vel.z) * 0.3; } else { r.pos.z = c.z1; r.vel.z = Math.abs(r.vel.z) * 0.3; }
          }
        }
      } else if (r.state === 'settle') {
        // tip over onto its side and rest on the ground
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(r.quat);
        if (K.mass < 200 && up.y > 0.2) { const axis = new THREE.Vector3(up.z, 0, -up.x); if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0); axis.normalize(); dq.setFromAxisAngle(axis, Math.min(dt * 3, Math.acos(clamp(up.y, -1, 1)) - 0.05 + 0.0)); r.quat.premultiply(dq); }
        const gy = world.ground(r.pos.x, r.pos.z); const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(r.quat).y;
        const target = gy + (K.mass < 200 ? Math.sqrt(Math.max(0, 1 - upY * upY)) * K.r * 0.75 : 0);
        r.pos.y += (target - r.pos.y) * Math.min(1, dt * 6);
        if (r.timer > 3) { r.state = 'down'; this.dyn.splice(k, 1); }
      }
      m4.compose(r.pos, r.quat, s1); this.meshes[r.kind].setMatrixAt(r.i, m4); this.meshes[r.kind].instanceMatrix.needsUpdate = true;
    }
    // respawn knocked props far from the action
    if (focus && (this._rs = (this._rs || 0) + dt) > 2) {
      this._rs = 0;
      for (const r of this.recs) {
        if (r.state !== 'down') continue; r.timer += 2;
        if (r.timer > 45 && Math.hypot(focus.x - r.x, focus.z - r.z) > 90) {
          r.state = 'static'; r.col.dead = false; r.pos.set(r.x, r.y, r.z); r.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw); r.vel.set(0, 0, 0); r.ang.set(0, 0, 0);
          m4.compose(r.pos, r.quat, s1); this.meshes[r.kind].setMatrixAt(r.i, m4); this.meshes[r.kind].instanceMatrix.needsUpdate = true;
        }
      }
    }
  }
}
