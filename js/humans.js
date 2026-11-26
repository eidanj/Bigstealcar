// Big Steal Car — blocky people: instanced renderer, walking animation, ragdoll-style knockbacks (no gore, just tumbles).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, damp, dampAngle } from './util.js';
import * as TX from './textures.js';

const V3 = THREE.Vector3;
const AX = new V3(1, 0, 0), AY = new V3(0, 1, 0), AZ = new V3(0, 0, 1);
const _m = new THREE.Matrix4(), _root = new THREE.Matrix4(), _tor = new THREE.Matrix4(), _p = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new V3(), _s = new V3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226, 0xd9a066];
export const HAIR = [0x2b1b12, 0x0f0f0f, 0x5a3825, 0xc9a35b, 0x8a3b12, 0x3b3b3b, 0xb0b0b0];
export const SHIRT = [0xe63946, 0x457b9d, 0xf1faee, 0x2a9d8f, 0xe9c46a, 0xf4a261, 0x8338ec, 0x3a86ff, 0xff006e, 0x6a994e, 0x222222, 0xadb5bd, 0xffbe0b];
export const PANTS = [0x1d3557, 0x2b2d42, 0x495057, 0x6c584c, 0x14213d, 0x3d405b, 0x8d99ae, 0x283618];

const PARTS = ['head', 'hair', 'torso', 'arm', 'hand', 'leg', 'shoe'];
const PER = { head: 1, hair: 1, torso: 1, arm: 2, hand: 2, leg: 2, shoe: 2 };

export class HumanRenderer {
  constructor(scene, max = 90) {
    this.max = max; this.slots = []; for (let i = max - 1; i >= 0; i--) this.slots.push(i);
    const box = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 2, r);
    const hang = (w, h, d) => box(w, h, d, 0.035).translate(0, -h / 2, 0);
    const geo = {
      head: box(0.27, 0.29, 0.26, 0.05), hair: new THREE.BoxGeometry(0.29, 0.09, 0.28).translate(0, 0.13, -0.01),
      torso: box(0.46, 0.6, 0.26, 0.06), arm: hang(0.13, 0.58, 0.14), hand: box(0.11, 0.12, 0.12, 0.03), leg: hang(0.17, 0.82, 0.2), shoe: box(0.17, 0.1, 0.29, 0.03),
    };
    // hair gets a back plate too
    const back = new THREE.BoxGeometry(0.29, 0.2, 0.06).translate(0, 0.04, -0.12);
    const hg = new THREE.BufferGeometry(); { const a = geo.hair.toNonIndexed(), b = back.toNonIndexed(); const pos = new Float32Array([...a.attributes.position.array, ...b.attributes.position.array]); const nor = new Float32Array([...a.attributes.normal.array, ...b.attributes.normal.array]); hg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); hg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); } geo.hair = hg;
    const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...o });
    const faceMat = std({ map: TX.face() }); const skin = std();
    const mats = { head: [skin, skin, skin, skin, faceMat, skin], hair: std({ roughness: 0.9 }), torso: std({ roughness: 0.85 }), arm: std({ roughness: 0.85 }), hand: std(), leg: std({ roughness: 0.9 }), shoe: std({ roughness: 0.6 }) };
    this.mesh = {};
    for (const k of PARTS) {
      const im = new THREE.InstancedMesh(geo[k], mats[k], max * PER[k]); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      for (let i = 0; i < max * PER[k]; i++) { im.setMatrixAt(i, ZERO); im.setColorAt(i, new THREE.Color(1, 1, 1)); }
      this.mesh[k] = im; scene.add(im);
    }
    // dizzy stars
    const sg = new THREE.OctahedronGeometry(0.07, 0); this.stars = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 0.4) }), max * 3); this.stars.frustumCulled = false;
    for (let i = 0; i < max * 3; i++) this.stars.setMatrixAt(i, ZERO); scene.add(this.stars);
    this.t = 0; this.setCount(0);
  }
  setCount(n) { this.count = n; for (const k of PARTS) this.mesh[k].count = n * PER[k]; this.stars.count = n * 3; }
  add(ch) {
    const s = this.slots.pop(); if (s === undefined) return false; ch.slot = s; if (s + 1 > this.count) this.setCount(s + 1);
    const set = (k, j, hex) => this.mesh[k].setColorAt(s * PER[k] + j, new THREE.Color(hex));
    set('head', 0, ch.look.skin); set('hair', 0, ch.look.hair); set('torso', 0, ch.look.shirt); set('arm', 0, ch.look.sleeve ?? ch.look.shirt); set('arm', 1, ch.look.sleeve ?? ch.look.shirt);
    set('hand', 0, ch.look.skin); set('hand', 1, ch.look.skin); set('leg', 0, ch.look.pants); set('leg', 1, ch.look.pants); set('shoe', 0, ch.look.shoes); set('shoe', 1, ch.look.shoes);
    for (const k of PARTS) this.mesh[k].instanceColor.needsUpdate = true;
    return true;
  }
  remove(ch) { if (ch.slot == null) return; this.hide(ch.slot); this.slots.push(ch.slot); this.slots.sort((a, b) => b - a); ch.slot = null; let top = this.count; while (top > 0 && this.slots.includes(top - 1)) top--; if (top !== this.count) this.setCount(top); }
  hide(s) { for (const k of PARTS) for (let j = 0; j < PER[k]; j++) this.mesh[k].setMatrixAt(s * PER[k] + j, ZERO); for (let j = 0; j < 3; j++) this.stars.setMatrixAt(s * 3 + j, ZERO); }
  // pose -> matrices
  draw(ch) {
    const s = ch.slot; if (s == null) return; const P = ch.pose;
    if (!ch.visible) { this.hide(s); return; }
    const M = this.mesh; const sc = ch.scale || 1;
    _root.compose(ch.drawPos, ch.drawQuat, _s.set(sc, sc, sc));
    // torso
    _q.setFromAxisAngle(AX, P.torso); _p.makeRotationFromQuaternion(_q); _p.setPosition(0, 0.88 - P.crouch, 0); _tor.multiplyMatrices(_root, _p);
    _m.copy(_tor).multiply(_p.makeTranslation(0, 0.31, 0)).multiply(_p.makeScale(1, 1, 1)); M.torso.setMatrixAt(s, _m);
    // head
    _q.setFromAxisAngle(AY, P.head); _p.makeRotationFromQuaternion(_q); _p.setPosition(0, 0.78, 0.0); _m.multiplyMatrices(_tor, _p); M.head.setMatrixAt(s, _m); M.hair.setMatrixAt(s, _m);
    // arms + hands
    for (let j = 0; j < 2; j++) {
      const side = j ? -1 : 1; const pitch = j ? P.armR : P.armL; const roll = (j ? P.armRs : P.armLs) * side;
      _q.setFromAxisAngle(AX, -pitch); _q2.setFromAxisAngle(AZ, roll); _q.multiply(_q2);
      _p.makeRotationFromQuaternion(_q); _p.setPosition(side * 0.3, 0.57, 0); _m.multiplyMatrices(_tor, _p); M.arm.setMatrixAt(s * 2 + j, _m);
      _m.multiply(_p.makeTranslation(0, -0.62, 0)); M.hand.setMatrixAt(s * 2 + j, _m);
      if (j === 1 && ch.handM) ch.handM.copy(_m);
    }
    // legs + shoes
    for (let j = 0; j < 2; j++) {
      const side = j ? -1 : 1; const pitch = j ? P.legR : P.legL; const knee = j ? P.kneeR : P.kneeL;
      _q.setFromAxisAngle(AX, -pitch); _q2.setFromAxisAngle(AZ, side * P.legSpread); _q.multiply(_q2);
      _p.makeRotationFromQuaternion(_q); _p.setPosition(side * 0.11, 0.88 - P.crouch, 0); _m.multiplyMatrices(_root, _p); M.leg.setMatrixAt(s * 2 + j, _m);
      _q.setFromAxisAngle(AX, knee); _p.makeRotationFromQuaternion(_q); _p.setPosition(0, -0.84, 0.05); _m.multiply(_p); M.shoe.setMatrixAt(s * 2 + j, _m);
    }
    // dizzy stars
    if (ch.dizzy > 0) {
      for (let j = 0; j < 3; j++) {
        const a = this.t * 4 + (j / 3) * Math.PI * 2; _v.set(ch.drawPos.x + Math.cos(a) * 0.3, ch.drawPos.y + 2.05 * sc, ch.drawPos.z + Math.sin(a) * 0.3);
        _m.compose(_v, _q.setFromAxisAngle(AY, a * 2), _s.set(1, 1, 1)); this.stars.setMatrixAt(s * 3 + j, _m);
      }
    } else for (let j = 0; j < 3; j++) this.stars.setMatrixAt(s * 3 + j, ZERO);
  }
  commit(dt) { this.t += dt; for (const k of PARTS) this.mesh[k].instanceMatrix.needsUpdate = true; this.stars.instanceMatrix.needsUpdate = true; }
}

const _tmp = []; const GI = { h: 0, nx: 0, ny: 1, nz: 0 };
// ---------------- character body (shared by peds, cops and the player) ----------------
export class Character {
  constructor(game, look, x, z, yaw) {
    this.game = game; this.look = look; this.slot = null;
    this.pos = new V3(x, game.world.ground(x, z), z); this.vel = new V3(); this.yaw = yaw; this.onGround = true;
    this.state = 'walk'; this.visible = true; this.phase = Math.random() * 6; this.speed = 0; this.moveDir = new V3();
    this.pose = { torso: 0, head: 0, armL: 0, armR: 0, armLs: 0.06, armRs: 0.06, legL: 0, legR: 0, kneeL: 0, kneeR: 0, crouch: 0, legSpread: 0 };
    this.drawPos = new V3().copy(this.pos); this.drawQuat = new THREE.Quaternion().setFromAxisAngle(AY, yaw);
    this.rq = new THREE.Quaternion(); this.rAng = new V3(); this.downT = 0; this.dizzy = 0; this.panic = 0; this.radius = 0.3; this.health = 100; this.scale = 1;
    this.anim = 'walk'; this.wave = 0; this.carT = null; this.punchT = 0; this.punchDur = 0.34; this.aimPose = false; this.koT = 0;
    game.humans.add(this);
  }
  get standing() { return this.state === 'walk'; }
  // velocity-driven locomotion with collisions. wish = desired horizontal velocity
  move(dt, wish, jump = false, accel = 12) {
    const world = this.game.world;
    if (this.state !== 'walk') return;
    const a = this.onGround ? accel : accel * 0.25;
    this.vel.x = damp(this.vel.x, wish.x, a, dt); this.vel.z = damp(this.vel.z, wish.z, a, dt);
    if (jump && this.onGround) { this.vel.y = 5.4; this.onGround = false; this.game.audio && this.game.audio.jump && this.game.audio.jump(this.pos); }
    this.vel.y -= 18 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.collide(world);
    const gy = this.groundAt(world);
    if (this.pos.y <= gy + 0.001) { if (!this.onGround && this.vel.y < -14) this.onHardLanding && this.onHardLanding(-this.vel.y); this.pos.y = gy; this.vel.y = Math.max(0, this.vel.y); this.onGround = true; }
    else if (this.pos.y > gy + 0.25) this.onGround = false;
    else if (this.vel.y <= 0) { this.pos.y = damp(this.pos.y, gy, 25, dt); this.onGround = true; } // step down curbs smoothly
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }
  groundAt(world) {
    let gy = world.ground(this.pos.x, this.pos.z, GI);
    // stand on cars
    for (const car of this.game.cars) {
      const dx = this.pos.x - car.pos.x, dz = this.pos.z - car.pos.z; if (dx * dx + dz * dz > 9) continue;
      const lx = dx * car.left.x + dz * car.left.z, lz = dx * car.fwd.x + dz * car.fwd.z;
      if (Math.abs(lx) < car.ex - 0.1 && Math.abs(lz) < car.ez - 0.2) { const top = car.pos.y - car.comH + (Math.abs(lz) < car.ez * 0.4 ? car.type.H : car.type.prof.beltH + 0.05); if (this.pos.y > top - 0.5) gy = Math.max(gy, top); }
    }
    return gy;
  }
  collide(world) {
    const r = this.radius; const p = this.pos;
    world.query(p.x - r - 0.2, p.z - r - 0.2, p.x + r + 0.2, p.z + r + 0.2, _tmp);
    for (const c of _tmp) {
      if (c.y1 < p.y + 0.3 || c.y0 > p.y + 1.7) continue;
      if (c.k === 0) {
        const qx = clamp(p.x, c.x0, c.x1), qz = clamp(p.z, c.z0, c.z1); let dx = p.x - qx, dz = p.z - qz; const d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-5) { p.x += dx / d * (r - d); p.z += dz / d * (r - d); const vn = this.vel.x * dx / d + this.vel.z * dz / d; if (vn < 0) { this.vel.x -= vn * dx / d; this.vel.z -= vn * dz / d; } }
          else { const o = [p.x - c.x0, c.x1 - p.x, p.z - c.z0, c.z1 - p.z]; const m = Math.min(...o); const i = o.indexOf(m); if (i === 0) p.x = c.x0 - r; else if (i === 1) p.x = c.x1 + r; else if (i === 2) p.z = c.z0 - r; else p.z = c.z1 + r; }
        }
      } else if (c.k === 2) { // convex building footprint
        const pd = world.polyDepth(c, p.x, p.z);
        if (pd.depth > 0) { p.x += pd.nx * (pd.depth + r); p.z += pd.nz * (pd.depth + r); const vn = this.vel.x * pd.nx + this.vel.z * pd.nz; if (vn < 0) { this.vel.x -= vn * pd.nx; this.vel.z -= vn * pd.nz; } }
        else if (pd.depth > -r) {
          const [qx, qz] = world.polyClosest(c, p.x, p.z); let dx = p.x - qx, dz = p.z - qz; const d = Math.hypot(dx, dz);
          if (d < r && d > 1e-5) { dx /= d; dz /= d; p.x += dx * (r - d); p.z += dz * (r - d); const vn = this.vel.x * dx + this.vel.z * dz; if (vn < 0) { this.vel.x -= vn * dx; this.vel.z -= vn * dz; } }
        }
      } else {
        const dx = p.x - c.x, dz = p.z - c.z; const d = Math.hypot(dx, dz); const R = r + c.r;
        if (d < R && d > 1e-5) { p.x += dx / d * (R - d); p.z += dz / d * (R - d); }
      }
    }
  }
  // tumbling knockback
  knock(v, spin = 1) {
    if (this.state === 'ragdoll') { this.vel.add(v.multiplyScalar(0.3)); return; }
    this.state = 'ragdoll'; this.vel.copy(v); this.onGround = false; this.downT = 0; this.dizzy = 0;
    this.rq.setFromAxisAngle(AY, this.yaw);
    const h = Math.hypot(v.x, v.z) || 1; this.rAng.set(v.z / h, 0, -v.x / h).multiplyScalar((4 + h * 0.6) * spin); this.rAng.y = (Math.random() - 0.5) * 6;
    this.pos.y += 0.95; // pos tracks the body centre while tumbling
  }
  physicsRagdoll(dt) {
    const world = this.game.world;
    if (this.state === 'ragdoll') {
      this.vel.y -= 16 * dt; this.pos.addScaledVector(this.vel, dt);
      const w = this.rAng.length(); if (w > 1e-4) { _q.setFromAxisAngle(_v.copy(this.rAng).multiplyScalar(1 / w), w * dt); this.rq.premultiply(_q).normalize(); }
      this.collide(world); _v.copy(AY).applyQuaternion(this.rq); const gy = world.ground(this.pos.x, this.pos.z) + 0.14 + 0.72 * Math.abs(_v.y);
      if (this.pos.y < gy) {
        this.pos.y = gy; if (this.vel.y < -1.5) { this.vel.y = -this.vel.y * 0.32; this.rAng.multiplyScalar(0.6); this.game.audio && this.game.audio.thud(this.pos, 0.25); } else this.vel.y = 0;
        const f = Math.min(1, 5 * dt); this.vel.x *= 1 - f; this.vel.z *= 1 - f; this.rAng.multiplyScalar(1 - Math.min(1, 3 * dt));
        if (this.vel.lengthSq() < 0.5) { this.state = 'down'; this.downT = 0; }
      }
    } else if (this.state === 'down') {
      this.downT += dt;
      // settle flat on the back, feet toward where we came from
      const yawNow = Math.atan2(2 * (this.rq.w * this.rq.y + this.rq.x * this.rq.z), 1 - 2 * (this.rq.y * this.rq.y + this.rq.x * this.rq.x));
      _q.setFromAxisAngle(AY, yawNow); _q2.setFromAxisAngle(AX, -Math.PI / 2); _q.multiply(_q2);
      this.rq.slerp(_q, Math.min(1, dt * 6)); this.pos.y = damp(this.pos.y, world.ground(this.pos.x, this.pos.z) + 0.14, 10, dt);
      if (this.downT > (this.koT || 2.6)) { this.state = 'getup'; this.downT = 0; this.yaw = yawNow; }
    } else if (this.state === 'getup') {
      this.downT += dt; _q.setFromAxisAngle(AY, this.yaw); this.rq.slerp(_q, Math.min(1, dt * 5));
      this.pos.y = damp(this.pos.y, world.ground(this.pos.x, this.pos.z) + 0.9, 8, dt);
      if (this.downT > 0.7) { this.state = 'walk'; this.dizzy = this.koT ? 4 : 2.4; this.koT = 0; this.health = this.cop ? 90 : 60; this.vel.set(0, 0, 0); this.onGround = true; this.pos.y = world.ground(this.pos.x, this.pos.z); }
    }
  }
  // ---- animation ----
  animate(dt) {
    const P = this.pose; const sp = this.speed;
    if (this.dizzy > 0) this.dizzy -= dt;
    if (this.state === 'walk') {
      const run = clamp((sp - 2.2) / 3.5, 0, 1); const air = !this.onGround;
      this.phase += dt * (sp < 0.2 ? 0 : 3.2 + sp * 1.25);
      const sw = Math.sin(this.phase) * clamp(sp / 1.5, 0, 1) * lerp(0.55, 1.0, run);
      const tgt = {
        legL: air ? 0.6 : sw, legR: air ? -0.25 : -sw, kneeL: air ? 0.3 : Math.max(0, -sw) * 0.4, kneeR: air ? 0.1 : Math.max(0, sw) * 0.4,
        armL: this.panic > 0 ? 2.6 + Math.sin(this.phase * 2) * 0.4 : -sw * lerp(0.8, 1.2, run), armR: this.panic > 0 ? 2.6 + Math.cos(this.phase * 2) * 0.4 : sw * lerp(0.8, 1.2, run),
        armLs: this.panic > 0 ? 0.35 : 0.07 + run * 0.08, armRs: this.panic > 0 ? 0.35 : 0.07 + run * 0.08,
        torso: run * 0.22 + (this.dizzy > 0 ? Math.sin(this.phase * 0.7 + this.dizzy * 3) * 0.12 : 0), head: this.dizzy > 0 ? Math.sin(this.dizzy * 5) * 0.4 : 0, crouch: 0, legSpread: 0,
      };
      if (this.wave > 0) { this.wave -= dt; tgt.armR = 2.9; tgt.armRs = 0.3 + Math.sin(this.wave * 14) * 0.25; }
      if (this.phone) { tgt.armR = 2.75; tgt.armRs = 0.62; tgt.head = 0.2; tgt.armL = 0.15; } // phone to the ear
      if (this.surrender) { tgt.armR = tgt.armL = 3.0; tgt.armRs = tgt.armLs = 0.42; tgt.head = -0.1; } // hands up
      let rate = 14;
      if (this.aimPose) { // gun raised toward the crosshair
        tgt.armR = Math.PI / 2 + (this.aimPitch || 0); tgt.armRs = -0.06; tgt.torso = 0.04;
        if (this.twoHand) { tgt.armL = Math.PI / 2 - 0.12 + (this.aimPitch || 0); tgt.armLs = -0.62; } else { tgt.armL = 0.25; tgt.armLs = 0.1; }
        rate = 22;
      }
      if (this.punchT > 0) { // quick jab (alternating arms) or a two-handed bat swing
        const k = 1 - this.punchT / this.punchDur; const sw = Math.sin(Math.min(1, k * 1.6) * Math.PI);
        if (this.punchDur > 0.45) { tgt.armR = 1.0 + sw * 0.9; tgt.armL = 1.0 + sw * 0.9; tgt.armRs = -0.5 + sw * 0.9; tgt.armLs = -0.7 + sw * 0.6; }
        else if (this.punchArm) { tgt.armR = 0.3 + sw * 1.35; tgt.armRs = 0.05; tgt.armL = 0.9; tgt.armLs = -0.2; }
        else { tgt.armL = 0.3 + sw * 1.35; tgt.armLs = 0.05; tgt.armR = 0.9; tgt.armRs = -0.2; }
        tgt.torso = 0.08 + sw * 0.12; rate = 34;
      }
      for (const k in tgt) P[k] = damp(P[k], tgt[k], rate, dt);
      // gentle body bob
      this.drawPos.copy(this.pos); this.drawPos.y += Math.abs(Math.cos(this.phase)) * 0.04 * clamp(sp / 2, 0, 1);
      this.drawQuat.setFromAxisAngle(AY, this.yaw);
    } else if (this.state === 'seat') {
      const tgt = { legL: 1.5, legR: 1.5, kneeL: -1.3, kneeR: -1.3, armL: 1.2, armR: 1.2, armLs: 0.12, armRs: 0.12, torso: -0.28, head: 0.0, crouch: 0.42, legSpread: 0.08 };
      for (const k in tgt) P[k] = damp(P[k], tgt[k], 20, dt);
    } else {
      const fl = this.state === 'ragdoll'; const t = (this.phase += dt * 9);
      const tgt = fl ? { legL: Math.sin(t) * 0.9, legR: Math.cos(t * 1.1) * 0.9, kneeL: 0.4, kneeR: 0.3, armL: 2.2 + Math.sin(t * 1.3) * 0.9, armR: 2.0 + Math.cos(t) * 0.9, armLs: 0.9, armRs: 0.9, torso: 0.2, head: 0, crouch: 0, legSpread: 0.3 }
        : { legL: 0.05, legR: -0.05, kneeL: 0, kneeR: 0, armL: this.state === 'down' ? 0.3 : 0.6, armR: this.state === 'down' ? 0.3 : 0.6, armLs: this.state === 'down' ? 1.1 : 0.5, armRs: this.state === 'down' ? 1.1 : 0.5, torso: 0, head: this.state === 'down' ? 0.5 : 0, crouch: 0, legSpread: this.state === 'down' ? 0.25 : 0.1 };
      for (const k in tgt) P[k] = damp(P[k], tgt[k], fl ? 10 : 6, dt);
      this.drawQuat.copy(this.rq); this.drawPos.copy(_v.set(0, 0.9, 0).applyQuaternion(this.rq)).negate().add(this.pos);
    }
  }
  faceToward(dx, dz, dt, rate = 10) { if (Math.abs(dx) + Math.abs(dz) > 1e-3) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), rate, dt); }
  // seated inside a car (visible through the glass)
  seatIn(car, side = 1) {
    this.state = 'seat'; this.visible = true; this.carT = car; this.seatSide = side;
  }
  updateSeat(car) {
    const t = car.type; const rootY = t.prof.seatY ?? t.clear; const sc = clamp(((t.prof.cabH ?? t.H) - 0.1 - rootY) / 1.28, 0.7, 0.92);
    const local = _v.set(0.36 * this.seatSide * (t.W / 1.86), -car.comH + rootY, (t.prof.ws + t.prof.rr) / 2 - 0.05);
    this.drawPos.copy(local).applyQuaternion(car.quat).add(car.pos); this.drawQuat.copy(car.quat); this.pos.copy(this.drawPos);
    this.scale = sc;
  }
  dispose() { this.game.humans.remove(this); }
}
