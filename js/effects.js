// Big Steal Car — sparks, tyre smoke, debris and skid marks.
import * as THREE from 'three';
import * as TX from './textures.js';

const V3 = THREE.Vector3;

class PointSystem {
  constructor(scene, max, tex, blending, depthWrite = false) {
    this.max = max; this.n = 0; this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.col = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1)); g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: { value: 400 } }, transparent: true, depthWrite, blending,
      vertexShader: 'attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying float vA; varying vec3 vC; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.5, -mv.z); vA = aAlpha; vC = aColor; }',
      fragmentShader: 'uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a * vA < 0.01) discard; gl_FragColor = vec4(vC * t.rgb, t.a * vA); }',
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
    for (let i = 0; i < max; i++) this.p.push({ life: 0 });
    this.cursor = 0;
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, r, gc, b, alpha, drag = 1, grav = 0) {
    const p = this.p[this.cursor]; this.cursor = (this.cursor + 1) % this.max;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.size = size; p.grow = grow; p.r = r; p.g = gc; p.b = b; p.a = alpha; p.drag = drag; p.grav = grav;
  }
  update(dt, ground) {
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      p.life -= dt; const k = Math.max(0, p.life / p.max);
      p.vy -= p.grav * dt; const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= p.grav ? 1 : d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (ground && p.grav) { const gy = ground(p.x, p.z); if (p.y < gy + 0.02) { p.y = gy + 0.02; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; } }
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.size + p.grow * (1 - k); this.alpha[i] = p.a * (p.grav ? k : Math.min(1, (1 - k) * 6) * k);
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
    }
    for (const a of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[a].needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.smoke = new PointSystem(scene, 700, TX.smokePuff(), THREE.NormalBlending);
    this.glow = new PointSystem(scene, 300, TX.softDot(), THREE.AdditiveBlending);
    // spark streaks
    this.maxSparks = 400; this.sparks = []; for (let i = 0; i < this.maxSparks; i++) this.sparks.push({ life: 0 }); this.sc = 0;
    const sg = new THREE.BufferGeometry(); this.sPos = new Float32Array(this.maxSparks * 6); this.sCol = new Float32Array(this.maxSparks * 6);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3)); this.sGeo = sg;
    this.sparkLines = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); this.sparkLines.frustumCulled = false; scene.add(this.sparkLines);
    // debris chunks
    this.maxDeb = 120; this.deb = []; for (let i = 0; i < this.maxDeb; i++) this.deb.push({ life: 0, p: new V3(), v: new V3(), q: new THREE.Quaternion(), w: new V3(), s: 1 }); this.dc = 0;
    this.debMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.4 }), this.maxDeb);
    this.debMesh.castShadow = true; this.debMesh.frustumCulled = false; for (let i = 0; i < this.maxDeb; i++) { this.debMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); this.debMesh.setColorAt(i, new THREE.Color(1, 1, 1)); } scene.add(this.debMesh);
    // skid marks
    this.maxSkid = 2400; this.skN = 0; this.skCursor = 0;
    const kg = new THREE.BufferGeometry(); this.kPos = new Float32Array(this.maxSkid * 4 * 3); this.kCol = new Float32Array(this.maxSkid * 4 * 4); const idx = new Uint32Array(this.maxSkid * 6);
    for (let i = 0; i < this.maxSkid; i++) { const o = i * 4; idx.set([o, o + 1, o + 2, o + 1, o + 3, o + 2], i * 6); }
    kg.setAttribute('position', new THREE.BufferAttribute(this.kPos, 3)); kg.setAttribute('color', new THREE.BufferAttribute(this.kCol, 4)); kg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.kGeo = kg; this.kAge = new Float32Array(this.maxSkid);
    this.skidMesh = new THREE.Mesh(kg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.skidMesh.frustumCulled = false; this.skidMesh.renderOrder = 1; scene.add(this.skidMesh);
    this.tracks = new Map(); this.t = 0;
  }
  sparksAt(p, n, dir, speed = 6, hot = 1) {
    for (let i = 0; i < n; i++) {
      const s = this.sparks[this.sc]; this.sc = (this.sc + 1) % this.maxSparks;
      s.life = s.max = 0.25 + Math.random() * 0.45; s.x = p.x; s.y = p.y; s.z = p.z;
      const sp = speed * (0.4 + Math.random());
      s.vx = (dir ? dir.x * sp : 0) + (Math.random() - 0.5) * speed; s.vy = Math.random() * speed * 0.7 + 1; s.vz = (dir ? dir.z * sp : 0) + (Math.random() - 0.5) * speed; s.hot = hot;
    }
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, 0.12, 3.5 * hot, 0, 4, 2.4, 1.0, 0.8);
  }
  smokeAt(x, y, z, vx, vy, vz, size = 1.4, shade = 0.85, alpha = 0.45, life = 1.6) {
    this.smoke.emit(x, y, z, vx + (Math.random() - 0.5) * 0.6, vy + 0.4 + Math.random() * 0.5, vz + (Math.random() - 0.5) * 0.6, life * (0.7 + Math.random() * 0.6), size, size * 2.6, shade, shade, shade * 0.98, alpha, 1.2);
  }
  debris(p, n, color, dir, speed = 5) {
    for (let i = 0; i < n; i++) {
      const d = this.deb[this.dc]; const idx = this.dc; this.dc = (this.dc + 1) % this.maxDeb;
      d.life = 3 + Math.random() * 2; d.p.copy(p); d.v.set((Math.random() - 0.5) * speed + (dir ? dir.x * speed * 0.6 : 0), 2 + Math.random() * speed * 0.7, (Math.random() - 0.5) * speed + (dir ? dir.z * speed * 0.6 : 0));
      d.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18); d.s = 0.05 + Math.random() * 0.12; d.q.identity();
      this.debMesh.setColorAt(idx, new THREE.Color(Math.random() < 0.5 ? color : 0x111111)); this.debMesh.instanceColor.needsUpdate = true;
    }
  }
  // per-wheel skid trail
  skid(key, x, y, z, rx, rz, width, strength) {
    let tr = this.tracks.get(key);
    if (strength <= 0) { if (tr) tr.active = false; return; }
    if (!tr || !tr.active) { this.tracks.set(key, { x, y, z, active: true }); return; }
    const dx = x - tr.x, dz = z - tr.z; if (dx * dx + dz * dz < 0.12) return; if (dx * dx + dz * dz > 9) { tr.x = x; tr.y = y; tr.z = z; return; }
    const i = this.skCursor; this.skCursor = (this.skCursor + 1) % this.maxSkid; this.skN = Math.min(this.maxSkid, this.skN + 1);
    const w = width / 2; const P = this.kPos, o = i * 12;
    P[o] = tr.x + rx * w; P[o + 1] = tr.y; P[o + 2] = tr.z + rz * w; P[o + 3] = tr.x - rx * w; P[o + 4] = tr.y; P[o + 5] = tr.z - rz * w;
    P[o + 6] = x + rx * w; P[o + 7] = y; P[o + 8] = z + rz * w; P[o + 9] = x - rx * w; P[o + 10] = y; P[o + 11] = z - rz * w;
    const a = Math.min(0.7, 0.25 + strength * 0.08); const C = this.kCol, c = i * 16;
    for (let k = 0; k < 4; k++) { C[c + k * 4] = 0.03; C[c + k * 4 + 1] = 0.03; C[c + k * 4 + 2] = 0.035; C[c + k * 4 + 3] = a; }
    this.kAge[i] = 0; tr.x = x; tr.y = y; tr.z = z; this.kDirty = true;
  }
  update(dt) {
    this.t += dt; const ground = (x, z) => this.world.ground(x, z);
    this.smoke.update(dt); this.glow.update(dt);
    for (let i = 0; i < this.maxSparks; i++) {
      const s = this.sparks[i]; const o = i * 6;
      if (s.life <= 0) { this.sPos.fill(0, o, o + 6); this.sCol.fill(0, o, o + 6); continue; }
      s.life -= dt; s.vy -= 14 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const gy = ground(s.x, s.z); if (s.y < gy) { s.y = gy; s.vy *= -0.4; s.vx *= 0.7; s.vz *= 0.7; }
      const k = s.life / s.max; const L = 0.03;
      this.sPos[o] = s.x; this.sPos[o + 1] = s.y; this.sPos[o + 2] = s.z; this.sPos[o + 3] = s.x - s.vx * L; this.sPos[o + 4] = s.y - s.vy * L; this.sPos[o + 5] = s.z - s.vz * L;
      const r = 6 * k * s.hot, g = 3.2 * k * k * s.hot, b = 0.8 * k * k * k * s.hot; this.sCol[o] = r; this.sCol[o + 1] = g; this.sCol[o + 2] = b; this.sCol[o + 3] = r * 0.3; this.sCol[o + 4] = g * 0.2; this.sCol[o + 5] = 0;
    }
    this.sGeo.attributes.position.needsUpdate = true; this.sGeo.attributes.color.needsUpdate = true;
    // debris
    const m = new THREE.Matrix4(), dq = new THREE.Quaternion(), sv = new V3();
    for (let i = 0; i < this.maxDeb; i++) {
      const d = this.deb[i]; if (d.life <= 0) continue; d.life -= dt;
      d.v.y -= 14 * dt; d.p.addScaledVector(d.v, dt); const gy = ground(d.p.x, d.p.z) + d.s * 0.5;
      if (d.p.y < gy) { d.p.y = gy; d.v.y *= -0.3; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.5); }
      const wl = d.w.length(); if (wl > 0.01) { dq.setFromAxisAngle(sv.copy(d.w).multiplyScalar(1 / wl), wl * dt); d.q.premultiply(dq); }
      const s = d.life < 0 ? 0 : d.s * Math.min(1, d.life); m.compose(d.p, d.q, sv.set(s, s * 0.4, s * 1.3)); this.debMesh.setMatrixAt(i, m);
    }
    this.debMesh.instanceMatrix.needsUpdate = true;
    // fade skid marks slowly
    if ((this._fade = (this._fade || 0) + dt) > 0.5) {
      const f = this._fade; this._fade = 0; const C = this.kCol;
      for (let i = 0; i < this.skN; i++) { this.kAge[i] += f; if (this.kAge[i] > 40) { const c = i * 16; for (let k = 0; k < 4; k++) C[c + k * 4 + 3] *= 0.97; } }
      this.kDirty = true;
    }
    if (this.kDirty) { this.kGeo.attributes.position.needsUpdate = true; this.kGeo.attributes.color.needsUpdate = true; this.kDirty = false; }
  }
}
