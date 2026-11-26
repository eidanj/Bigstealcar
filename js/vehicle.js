// Big Steal Car — rigid-body raycast vehicle: suspension, tyre slip model, gearbox, collisions and damage.
import * as THREE from 'three';
import { CAR_TYPES } from './config.js';
import { clamp, lerp, smooth, wrapAngle } from './util.js';

const V3 = THREE.Vector3; const G = 9.81;
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _f = new V3(), _r = new V3(), _n = new V3(), _t = new V3(), _vp = new V3();
const _qi = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _s = new V3();
const AX = new V3(1, 0, 0), AY = new V3(0, 1, 0), AZ = new V3(0, 0, 1);
const GI = { h: 0, nx: 0, ny: 1, nz: 0 };
const RATIOS = [3.3, 2.15, 1.55, 1.18, 0.94, 0.78], FINAL = 3.5;

export class Vehicle {
  constructor(game, typeKey, color, x, z, yaw, wear) {
    this.game = game; this.typeKey = typeKey; const t = this.type = CAR_TYPES[typeKey];
    this.model = game.carFactory.build(typeKey, color, wear); this.color = this.model.color;
    this.group = this.model.group; game.scene.add(this.group);
    this.mass = t.mass; this.invMass = 1 / t.mass;
    const w = t.W, h = t.H * 0.8, l = t.L, m = t.mass;
    this.invI = new V3(12 / (m * (h * h + l * l)), 12 / (m * (w * w + l * l) * 1.05), 12 / (m * (w * w + h * h) * 1.7));
    this.comH = t.com ?? clamp(t.clear + (t.H - t.clear) * 0.25, 0.4, 0.8);
    this.model.model.position.y = -this.comH;
    this.ex = w / 2; this.ez = l / 2; this.ey = (t.H - t.clear) / 2; this.cy = (t.clear + t.H) / 2 - this.comH;
    this.radius = Math.hypot(this.ex, this.ez);
    // suspension
    const sag = 0.075 / (t.sus || 1); this.restLen = 0.3; this.travel = 0.24;
    this.k = (m * G / 4) / sag; this.c = 2 * 0.34 * Math.sqrt(this.k * m / 4);
    const mountY = t.wheelR - this.comH + (this.restLen - sag);
    const tw = t.track / 2, fa = t.wb / 2;
    this.wheels = [[tw, fa, true], [-tw, fa, true], [tw, -fa, false], [-tw, -fa, false]].map(([x, z, front]) => ({
      local: new V3(x, mountY, z), front, right: x < 0, drive: t.drive === 'awd' || (t.drive === 'rwd' ? !front : front),
      comp: 0, prevComp: 0, contact: false, spin: 0, spinVel: 0, slip: 0, slipLat: 0, load: 0, cp: new V3(), n: new V3(0, 1, 0), inst: game.wheels.alloc(t.cls === 'Police' ? 0x303236 : (t.cls === 'Super' || t.cls === 'Sports' || t.cls === 'Electric') ? 0x2a2a2a : t.cls === 'Truck' ? 0x9aa0a8 : 0xffffff),
      skid: -1,
    }));
    this.nDrive = this.wheels.filter((w2) => w2.drive).length;
    this.kd = t.power / Math.pow(t.vmax, 3); this.kdf = t.mass * (t.cls === 'Super' || t.cls === 'Sports' ? 0.0012 : 0.0005);
    // state
    this.pos = new V3(x, 0, z); this.quat = new THREE.Quaternion().setFromAxisAngle(AY, yaw); this.vel = new V3(); this.angVel = new V3();
    this.pos.y = game.world.ground(x, z) + this.comH + 0.02;
    this.ctrl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.steerAngle = 0; this.rpm = 900; this.gear = 0; this.shift = 0; this.health = 1000; this.dead = false;
    this.driver = null; this.ai = null; this.sleeping = false; this.sleepT = 0; this.grounded = 4; this.airT = 0; this.upsideT = 0;
    this.F = new V3(); this.T = new V3(); this.speed = 0; this.vFwd = 0; this.lastHit = 0; this.siren = false; this.sirenT = 0; this.horn = false;
    this.up = new V3(0, 1, 0); this.fwd = new V3(0, 0, 1); this.left = new V3(1, 0, 0);
    this.wheelspin = 0; this.damageT = 0; this.age = 0;
    this.syncVisual(0);
  }

  // ---------- rigid body helpers ----------
  applyInvI(v, out) { _qi.copy(this.quat).invert(); return out.copy(v).applyQuaternion(_qi).multiply(this.invI).applyQuaternion(this.quat); }
  pointVel(r, out) { return out.crossVectors(this.angVel, r).add(this.vel); }
  kAlong(r, d) { _a.crossVectors(r, d); this.applyInvI(_a, _b); _c.crossVectors(_b, r); return this.invMass + _c.dot(d); }
  impulse(J, r) { this.vel.addScaledVector(J, this.invMass); _a.crossVectors(r, J); this.applyInvI(_a, _b); this.angVel.add(_b); }
  wake() { this.sleeping = false; this.sleepT = 0; }
  axes() { this.up.copy(AY).applyQuaternion(this.quat); this.fwd.copy(AZ).applyQuaternion(this.quat); this.left.copy(AX).applyQuaternion(this.quat); }
  maxSteer() { return this.type.steer * lerp(1, 0.24, smooth(3, 42, Math.abs(this.vFwd))); }

  // ---------- forces + velocity integration ----------
  forces(h, world) {
    if (this.sleeping) return;
    this.axes(); const up = this.up, fwd = this.fwd, left = this.left; const t = this.type;
    const F = this.F.set(0, -G * this.mass, 0), T = this.T.set(0, 0, 0);
    const vF = this.vFwd = this.vel.dot(fwd); this.speed = this.vel.length();
    const c = this.ctrl; const dead = this.dead || !this.driver;
    // steering (rate limited, speed-scaled)
    const target = (dead ? 0 : c.steer) * this.maxSteer();
    const rate = (Math.abs(target) < Math.abs(this.steerAngle) ? 5 : 3.2) * this.type.steer;
    this.steerAngle += clamp(target - this.steerAngle, -rate * h, rate * h);
    // engine / brake mapping
    let thr = dead ? 0 : c.throttle, brk = dead ? 0 : c.brake, drive = 0, brakeIn = 0;
    if (brk > 0 && vF < 0.8 && thr === 0 && !c.noReverse) drive = -brk * t.fmax * 0.6 * clamp((13 + vF) / 4, 0, 1);
    else { drive = thr * Math.min(t.fmax, t.power * (this.boost || 1) / Math.max(Math.abs(vF), 1)); brakeIn = brk; }
    if (thr > 0 && vF < -0.8) { brakeIn = Math.max(brakeIn, thr); drive = 0; }
    if (this.shift > 0) { this.shift -= h; drive *= 0.35; }
    const hb = c.handbrake && !dead;
    if (!this.driver) brakeIn = Math.max(brakeIn, 0.25); // parked: hold still
    // ---- pass 1: suspension raycasts
    let n = 0;
    for (const w of this.wheels) {
      const mount = _d.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      w.prevComp = w.comp; w.contact = false;
      if (up.y < 0.2) { w.comp = 0; continue; }
      world.ground(mount.x, mount.z, GI); w.n.set(GI.nx, GI.ny, GI.nz);
      const dist = (mount.y - GI.h) * GI.ny / Math.max(0.2, up.dot(w.n));
      const maxLen = this.restLen + t.wheelR;
      if (dist > maxLen || dist < -0.6) { w.comp = 0; continue; }
      w.comp = maxLen - dist; w.contact = true; n++;
      w.cp.copy(mount).addScaledVector(up, -dist);
    }
    this.grounded = n;
    // anti-roll bars
    const ar = this.k * 0.55; const dF = (this.wheels[0].comp - this.wheels[1].comp) * ar, dR = (this.wheels[2].comp - this.wheels[3].comp) * ar;
    const arF = [dF, -dF, dR, -dR];
    const mu0 = t.grip;
    // ---- pass 2: suspension + tyre forces
    this.wheelspin = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]; w.slip = 0; w.slipLat = 0;
      if (!w.contact) { w.load = 0; w.spinVel = lerp(w.spinVel, w.drive ? thr * 60 : w.spinVel * 0.98, 0.02); continue; }
      const r = _r.subVectors(w.cp, this.pos); const vP = this.pointVel(r, _vp); const nrm = w.n;
      const comp = w.comp; const compVel = clamp((comp - w.prevComp) / h, -3, 3);
      let Fz = this.k * comp + this.c * compVel + (comp > this.travel ? this.k * 10 * (comp - this.travel) : 0) + arF[i];
      Fz = Math.max(0, Math.min(Fz, this.mass * G * 3)); w.load = Fz;
      // wheel frame on the ground plane
      const a = w.front ? -this.steerAngle : 0;
      const wf = _e.copy(fwd).multiplyScalar(Math.cos(a)).addScaledVector(left, Math.sin(a)); wf.addScaledVector(nrm, -wf.dot(nrm)).normalize();
      const ws = _f.crossVectors(nrm, wf).normalize();
      const vLong = vP.dot(wf), vLat = vP.dot(ws);
      // lateral
      const mu = mu0 * (hb && !w.front ? 0.58 : 1);
      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 2.5));
      let Fy = -11 * alpha * Fz; const FyMax = mu * Fz;
      if (Math.abs(alpha) > 0.16) Fy *= lerp(1, 0.82, smooth(0.16, 0.5, Math.abs(alpha))); // past the peak, grip falls off
      Fy = clamp(Fy, -FyMax, FyMax);
      const mLat = 1 / this.kAlong(r, ws); const FyNeed = -vLat * mLat / h / Math.max(1, n * 0.5);
      if (Math.abs(Fy) > Math.abs(FyNeed)) Fy = FyNeed;
      // longitudinal
      let Fx = w.drive ? drive / this.nDrive : 0;
      let Fb = brakeIn * this.mass * G * 1.15 * (w.front ? 0.31 : 0.19) + 0.014 * Fz;
      if (hb && !w.front) Fb += this.mass * G * 0.55;
      const mLong = 1 / this.kAlong(r, wf); const stopF = Math.abs(vLong) * mLong / h / Math.max(1, n * 0.5);
      Fx += -Math.sign(vLong) * Math.min(Fb, stopF);
      // friction circle with cornering priority: steering grip first, then whatever is left for drive/brake
      const lim = mu * Fz * 1.05; Fy = clamp(Fy, -lim, lim);
      const longMax = Math.sqrt(Math.max(0, lim * lim - (Fy * 0.88) * (Fy * 0.88)));
      if (Math.abs(Fx) > longMax) { if (w.drive && Math.abs(drive) > longMax) this.wheelspin = Math.max(this.wheelspin, clamp(1 - longMax / Math.abs(Fx), 0, 1)); Fx = Math.sign(Fx) * longMax; }
      w.slipLat = Math.abs(vLat); w.slip = Math.abs(vLat) * (Math.abs(alpha) > 0.12 ? 1 : 0.3) + (hb && !w.front && Math.abs(vLong) > 2 ? Math.abs(vLong) * 0.5 : 0) + (this.wheelspin > 0.15 && w.drive ? 6 * this.wheelspin : 0);
      // apply
      _t.copy(nrm).multiplyScalar(Fz).addScaledVector(wf, Fx).addScaledVector(ws, Fy);
      F.add(_t); _a.crossVectors(r, _t); T.add(_a);
      // wheel spin (visual)
      const roll = vLong / t.wheelR; const locked = (hb && !w.front) || (brakeIn > 0.6 && Math.abs(vLong) > 2 && !w.drive && Math.abs(Fx) >= lim * 0.95);
      w.spinVel = locked ? 0 : roll + (w.drive && this.wheelspin > 0 ? Math.sign(drive) * this.wheelspin * 40 : 0);
    }
    // aero
    const sp = this.speed; F.addScaledVector(this.vel, -this.kd * sp);
    if (n > 0) F.addScaledVector(up, -this.kdf * vF * vF);
    // air control + arcade assists
    if (n === 0 && this.grounded0 > 0) this.airLatch = c.throttle > 0.1; // throttle held at take-off doesn't pitch the nose down
    if (this.airLatch && c.throttle < 0.1) this.airLatch = false;
    this.grounded0 = n;
    if (n === 0) {
      const ip = this.driver ? (this.airLatch ? 0 : c.throttle) - c.brake : 0, ir = this.driver ? c.steer : 0;
      _a.copy(left).multiplyScalar(ip * 2.4 / this.invI.x); T.add(_a);
      _a.copy(fwd).multiplyScalar(ir * 2.2 / this.invI.z); T.add(_a);
      // arcade stabiliser: without stick input the car steadies itself and drifts back toward level
      const wp = this.angVel.dot(left), wr = this.angVel.dot(fwd);
      if (Math.abs(ip) < 0.1) { _a.copy(left).multiplyScalar(-wp * 1.6 / this.invI.x); T.add(_a); }
      if (Math.abs(ir) < 0.1) { _a.copy(fwd).multiplyScalar(-wr * 1.6 / this.invI.z); T.add(_a); }
      if (Math.abs(ip) < 0.1 && Math.abs(ir) < 0.1 && up.y > 0.2) { _b.crossVectors(up, AY); _a.copy(_b).multiplyScalar(2.2); _b.copy(_a).applyQuaternion(_qi.copy(this.quat).invert()); _b.x /= this.invI.x; _b.y /= this.invI.y; _b.z /= this.invI.z; _b.applyQuaternion(this.quat); T.add(_b); }
    }
    if (n >= 2 && this.driver && !dead) {
      // handbrake turn helper + mild yaw stability so the car feels planted
      const yawRate = this.angVel.dot(up);
      if (hb && Math.abs(vF) > 4) { _a.copy(up).multiplyScalar(-c.steer * 0.9 / this.invI.y * clamp(Math.abs(vF) / 12, 0, 1) * Math.sign(vF)); T.add(_a); }
      else if (Math.abs(c.steer) < 0.1) { _a.copy(up).multiplyScalar(-yawRate * 1.2 / this.invI.y * smooth(3, 20, Math.abs(vF))); T.add(_a); } // no steering: settle the yaw
    }
    // integrate velocity
    this.vel.addScaledVector(F, this.invMass * h);
    this.applyInvI(T, _a); this.angVel.addScaledVector(_a, h);
    this.angVel.multiplyScalar(1 / (1 + h * (n > 0 ? 0.6 : 0.05)));
    // gearbox / rpm
    const wheelRpm = Math.abs(vF) / t.wheelR * 9.549;
    let rpm = wheelRpm * RATIOS[this.gear] * FINAL;
    if (this.wheelspin > 0.1 || n === 0) rpm = lerp(this.rpm, 900 + thr * 6400, 0.04);
    if (rpm > 6600 && this.gear < 5 && vF > 0) { this.gear++; this.shift = 0.18; }
    else if (this.gear > 0 && rpm < 2600) this.gear--;
    if (vF < -0.5) this.gear = 0;
    this.rpm = clamp(lerp(this.rpm, Math.max(850 + thr * 600, rpm), 0.25), 800, 7400);
    for (const w of this.wheels) w.spin += w.spinVel * h;
  }

  integrate(h) {
    if (this.sleeping) return;
    this.pos.addScaledVector(this.vel, h);
    const w = this.angVel; _q1.set(w.x * h * 0.5, w.y * h * 0.5, w.z * h * 0.5, 0).multiply(this.quat);
    this.quat.x += _q1.x; this.quat.y += _q1.y; this.quat.z += _q1.z; this.quat.w += _q1.w; this.quat.normalize();
  }

  // ---------- body vs ground (rollovers, hard landings, scraping) ----------
  groundContacts(h, world) {
    if (this.sleeping) return;
    let maxPen = 0; const ex = this.ex, ez = this.ez, ey = this.ey, cy = this.cy;
    for (let k = 0; k < 8; k++) {
      const top = k & 4; const sx = k & 1 ? 1 : -1, sz = k & 2 ? 1 : -1;
      _d.set(sx * ex * (top ? 0.78 : 0.97), cy + (top ? ey : -ey * 0.75), sz * ez * (top ? 0.6 : 0.95)).applyQuaternion(this.quat).add(this.pos);
      world.ground(_d.x, _d.z, GI); const pen = GI.h - _d.y; if (pen <= 0) continue;
      _n.set(GI.nx, GI.ny, GI.nz); const r = _r.subVectors(_d, this.pos); const vP = this.pointVel(r, _vp); const vn = vP.dot(_n);
      maxPen = Math.max(maxPen, pen * GI.ny);
      if (vn < 0) {
        const jn = -(1.15) * vn / this.kAlong(r, _n); _t.copy(_n).multiplyScalar(jn); this.impulse(_t, r);
        _t.copy(vP).addScaledVector(_n, -vn); const vt = _t.length();
        if (vt > 0.01) { _t.multiplyScalar(1 / vt); const jt = Math.min(vt / this.kAlong(r, _t), 0.45 * jn); _t.multiplyScalar(-jt); this.impulse(_t, r); }
        if (vt > 4 || -vn > 3) this.game.onImpact(this, null, jn, _d, _n, 'ground', -vn, vt);
      }
    }
    if (maxPen > 0) this.pos.y += Math.min(maxPen, 0.5) * 0.9;
  }

  // ---------- body vs static colliders ----------
  staticContacts(h, world, list) {
    if (this.sleeping) return;
    const c = _d.set(0, this.cy, 0).applyQuaternion(this.quat).add(this.pos);
    const fx = this.fwd.x, fz = this.fwd.z, fl = Math.hypot(fx, fz) || 1; const Fx = fx / fl, Fz = fz / fl, Lx = Fz, Lz = -Fx;
    const ex = this.ex, ez = this.ez; const rad = this.radius + 0.6;
    const yLo = this.pos.y - this.comH + this.type.clear * 0.6, yHi = this.pos.y - this.comH + this.type.H;
    world.query(c.x - rad, c.z - rad, c.x + rad, c.z + rad, list);
    for (const col of list) {
      if (col.y1 < yLo || col.y0 > yHi) continue;
      let nx = 0, nz = 0, depth = 0, px = 0, pz = 0;
      if (col.k === 0) {
        const bx = (col.x0 + col.x1) / 2, bz = (col.z0 + col.z1) / 2, hx = (col.x1 - col.x0) / 2, hz = (col.z1 - col.z0) / 2;
        const dx = c.x - bx, dz = c.z - bz; let best = 1e9, bnx = 0, bnz = 0, carAxis = false;
        const axes = [[1, 0, false], [0, 1, false], [Fx, Fz, true], [Lx, Lz, true]];
        let sep = false;
        for (const [ax, az, ca] of axes) {
          const rc = ex * Math.abs(Lx * ax + Lz * az) + ez * Math.abs(Fx * ax + Fz * az);
          const rb = hx * Math.abs(ax) + hz * Math.abs(az);
          const d = dx * ax + dz * az; const o = rc + rb - Math.abs(d);
          if (o <= 0) { sep = true; break; }
          if (o < best) { best = o; const s = d < 0 ? -1 : 1; bnx = ax * s; bnz = az * s; carAxis = ca; }
        }
        if (sep) continue;
        nx = bnx; nz = bnz; depth = best;
        if (!carAxis) { // deepest car corner
          let mn = 1e9; for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const qx = c.x + Lx * ex * sx + Fx * ez * sz, qz = c.z + Lz * ex * sx + Fz * ez * sz; const dd = qx * nx + qz * nz; if (dd < mn) { mn = dd; px = qx; pz = qz; } }
        } else { // deepest box corner
          let mx = -1e9; for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const qx = bx + hx * sx, qz = bz + hz * sz; const dd = qx * nx + qz * nz; if (dd > mx) { mx = dd; px = qx; pz = qz; } }
        }
      } else if (col.k === 2) { // convex polygon footprint: SAT over the car's two axes + every polygon edge normal
        let best = 1e9, bnx = 0, bnz = 0, carAxis = false, sep = false; const P2 = col.pts;
        const test = (ax, az, ca) => {
          const rc = ex * Math.abs(Lx * ax + Lz * az) + ez * Math.abs(Fx * ax + Fz * az); const cc = c.x * ax + c.z * az;
          let mn = 1e9, mx = -1e9; for (const q of P2) { const d = q[0] * ax + q[1] * az; if (d < mn) mn = d; if (d > mx) mx = d; }
          const o = Math.min(cc + rc - mn, mx - (cc - rc)); if (o <= 0) { sep = true; return; }
          if (o < best) { best = o; const s = cc - (mn + mx) / 2 < 0 ? -1 : 1; bnx = ax * s; bnz = az * s; carAxis = ca; }
        };
        test(Fx, Fz, true); if (!sep) test(Lx, Lz, true);
        for (let i = 0; i < col.nrm.length && !sep; i++) test(col.nrm[i][0], col.nrm[i][1], false);
        if (sep) continue;
        nx = bnx; nz = bnz; depth = best;
        if (!carAxis) { let mn = 1e9; for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const qx = c.x + Lx * ex * sx + Fx * ez * sz, qz = c.z + Lz * ex * sx + Fz * ez * sz; const dd = qx * nx + qz * nz; if (dd < mn) { mn = dd; px = qx; pz = qz; } } }
        else { let mx = -1e9; for (const q of P2) { const dd = q[0] * nx + q[1] * nz; if (dd > mx) { mx = dd; px = q[0]; pz = q[1]; } } }
      } else {
        const ox = col.x - c.x, oz = col.z - c.z; const lx = ox * Lx + oz * Lz, lz = ox * Fx + oz * Fz;
        const qx = clamp(lx, -ex, ex), qz = clamp(lz, -ez, ez); let ddx = lx - qx, ddz = lz - qz; let d = Math.hypot(ddx, ddz);
        if (d >= col.r) continue;
        let lnx, lnz; // local normal from circle toward car
        if (d > 1e-4) { lnx = -ddx / d; lnz = -ddz / d; depth = col.r - d; }
        else { const ox2 = ex - Math.abs(lx), oz2 = ez - Math.abs(lz); if (ox2 < oz2) { lnx = -Math.sign(lx); lnz = 0; depth = ox2 + col.r; } else { lnx = 0; lnz = -Math.sign(lz); depth = oz2 + col.r; } }
        nx = lnx * Lx + lnz * Fx; nz = lnx * Lz + lnz * Fz; px = c.x + qx * Lx + qz * Fx; pz = c.z + qx * Lz + qz * Fz;
        if (col.prop) { // knockable
          const sp = Math.hypot(this.vel.x, this.vel.z); const impactV = Math.max(0, -(this.vel.x * nx + this.vel.z * nz));
          if (this.game.props.hit(col.prop, this.vel.x, this.vel.z, Math.max(impactV, sp * 0.7), this.mass)) {
            const loss = this.game.props.impulseLoss(col.prop, this.mass); this.vel.x *= 1 - loss; this.vel.z *= 1 - loss;
            this.game.onImpact(this, col.prop, impactV * 200, _e.set(px, this.pos.y, pz), _n.set(nx, 0, nz), 'prop', impactV); continue;
          }
        }
      }
      // resolve
      this.pos.x += nx * (depth + 0.002); this.pos.z += nz * (depth + 0.002);
      _n.set(nx, 0, nz); const cp = _e.set(px, this.pos.y - 0.15, pz); const r = _r.subVectors(cp, this.pos);
      const vP = this.pointVel(r, _vp); const vn = vP.dot(_n);
      if (vn < 0) {
        const jn = -(1 + 0.22) * vn / this.kAlong(r, _n); _t.copy(_n).multiplyScalar(jn); this.impulse(_t, r);
        _t.copy(vP).addScaledVector(_n, -vn); _t.y = 0; const vt = _t.length();
        if (vt > 0.01) { _t.multiplyScalar(1 / vt); const jt = Math.min(vt / this.kAlong(r, _t), 0.3 * jn); _t.multiplyScalar(-jt); this.impulse(_t, r); }
        this.wake(); this.game.onImpact(this, null, jn, cp, _n, 'wall', -vn, vt);
      }
    }
  }

  // ---------- visuals ----------
  syncVisual(dt) {
    this.group.position.copy(this.pos); this.group.quaternion.copy(this.quat);
    _m1.compose(this.pos, this.quat, _s.set(1, 1, 1));
    const t = this.type;
    for (const w of this.wheels) {
      const yaw = (w.front ? -this.steerAngle : 0) + (w.right ? Math.PI : 0);
      _q1.setFromAxisAngle(AY, yaw); _q2.setFromAxisAngle(AX, w.right ? -w.spin : w.spin); _q1.multiply(_q2);
      const off = this.restLen - (w.contact ? Math.min(w.comp, this.restLen + 0.05) : 0);
      _a.set(w.local.x, w.local.y - off, w.local.z);
      _m2.compose(_a, _q1, _s.set(t.wheelW, t.wheelR, t.wheelR)); _m3.multiplyMatrices(_m1, _m2);
      this.game.wheels.set(w.inst, _m3);
    }
    this.updateLamps(dt);
    if (this.model.barR) {
      if (this.siren) { this.sirenT += dt; const ph = Math.floor(this.sirenT * 7) % 4; this.model.barR.color.setRGB(ph < 2 ? 5 : 0.2, 0, 0); this.model.barB.color.setRGB(0, 0.1, ph >= 2 ? 6 : 0.25); }
      else { this.model.barR.color.setRGB(0.25, 0, 0); this.model.barB.color.setRGB(0, 0, 0.3); }
    }
  }
  // indicators: 'L' | 'R' | null, hazards separate. Player signals cancel themselves once a turn is complete.
  setSignal(dir) { this.signal = this.signal === dir ? null : dir; this.sigYaw = this.yaw; this.sigTurned = false; }
  updateLamps(dt) {
    const g = this.game, U = this.model.lamps, c = this.ctrl, n = g.night;
    const live = !!this.driver && !this.dead; const blink = (g.t * 1.55) % 1 < 0.55;
    if (this.signal && this.driver === 'player') { // self-cancel after the corner, like a real stalk
      const turned = wrapAngle(this.yaw - this.sigYaw) * (this.signal === 'L' ? 1 : -1);
      if (turned > 0.9) this.sigTurned = true;
      if (this.sigTurned && Math.abs(c.steer) < 0.15) this.signal = null;
      if (turned < -0.6) this.sigYaw = this.yaw; // drifting the other way: keep blinking
    }
    const haz = !!this.hazard && !this.dead;
    const L = blink && (haz || (live && this.signal === 'L')), Rr = blink && (haz || (live && this.signal === 'R'));
    const braking = live && (c.brake > 0.1 && this.vFwd > 0.5 || c.handbrake);
    const rev = live && this.vFwd < -0.3;
    const head = live ? 0.05 + smooth(0.15, 0.6, n) * 2.2 : 0;
    U[0].set(1, 0.95, 0.86).multiplyScalar(head);
    U[1].set(0.9, 0.95, 1).multiplyScalar(live ? 1.25 + n * 0.45 : 0);
    const amb = 3.4; U[2].set(1, 0.42, 0.03).multiplyScalar(L ? amb : 0); U[3].set(1, 0.42, 0.03).multiplyScalar(Rr ? amb : 0);
    U[5].copy(U[2]); U[6].copy(U[3]);
    U[4].set(1, 0.035, 0.025).multiplyScalar(braking ? 3.4 : live ? 0.22 + smooth(0.15, 0.6, n) * 0.75 : 0);
    U[7].set(1, 1, 1).multiplyScalar(rev ? 2.6 : 0);
    if (this.driver === 'player') { const on = !!(L || Rr); if (on !== this._blinkOn) { this._blinkOn = on; g.audio.tick && g.audio.tick(on); } }
    void dt;
  }
  damage(amount, lx, ly, lz, dx, dy, dz) {
    if (amount <= 0) return;
    this.health -= amount; if (this.health <= 0 && !this.dead) { this.health = 0; this.dead = true; this.game.onWrecked && this.game.onWrecked(this); }
    this.model.deform(lx, ly, lz, dx, dy, dz, Math.min(0.11, amount * 0.0016));
  }
  // world point/normal -> model space dent
  dent(point, normal, amount) {
    _qi.copy(this.quat).invert();
    const l = _a.subVectors(point, this.pos).applyQuaternion(_qi); const d = _b.copy(normal).applyQuaternion(_qi);
    this.damage(amount, l.x, l.y + this.comH, l.z, d.x, d.y, d.z);
  }
  repair() { this.health = 1000; this.dead = false; this.model.repair(); }
  dispose() {
    this.game.scene.remove(this.group);
    for (const w of this.wheels) this.game.wheels.release(w.inst);
    this.group.traverse((o) => { if (o.isMesh && (o === this.model.body || o === this.model.cabin)) o.geometry.dispose(); });
  }
  get yaw() { return Math.atan2(this.fwd.x, this.fwd.z); }
  // put the car on the ground, upright
  place(x, z, yaw) { this.pos.set(x, this.game.world.ground(x, z) + this.comH + 0.05, z); this.quat.setFromAxisAngle(AY, yaw); this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.axes(); this.wake(); }
  flip() { const yaw = this.yaw; this.place(this.pos.x, this.pos.z, yaw); this.pos.y += 0.6; }
}

// car vs car impulse (2D SAT in XZ with vertical overlap test)
export function collideCars(A, B, game) {
  const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z; const rr = A.radius + B.radius;
  if (dx * dx + dz * dz > rr * rr) return;
  const ayLo = A.pos.y - A.comH + A.type.clear * 0.5, ayHi = A.pos.y - A.comH + A.type.H, byLo = B.pos.y - B.comH + B.type.clear * 0.5, byHi = B.pos.y - B.comH + B.type.H;
  if (ayHi < byLo || byHi < ayLo) return;
  const ax = (c) => { const fl = Math.hypot(c.fwd.x, c.fwd.z) || 1; return [c.fwd.x / fl, c.fwd.z / fl]; };
  const [aF0, aF1] = ax(A), [bF0, bF1] = ax(B);
  const AF = [aF0, aF1], AL = [aF1, -aF0], BF = [bF0, bF1], BL = [bF1, -bF0];
  let best = 1e9, nx = 0, nz = 0; const ddx = A.pos.x - B.pos.x, ddz = A.pos.z - B.pos.z;
  for (const [x, z] of [AF, AL, BF, BL]) {
    const ra = A.ex * Math.abs(AL[0] * x + AL[1] * z) + A.ez * Math.abs(AF[0] * x + AF[1] * z);
    const rb = B.ex * Math.abs(BL[0] * x + BL[1] * z) + B.ez * Math.abs(BF[0] * x + BF[1] * z);
    const d = ddx * x + ddz * z; const o = ra + rb - Math.abs(d); if (o <= 0) return;
    if (o < best) { best = o; const s = d < 0 ? -1 : 1; nx = x * s; nz = z * s; }
  }
  // contact point: deepest corner of either box
  const corners = (c, F, L) => [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => [c.pos.x + L[0] * c.ex * sx + F[0] * c.ez * sz, c.pos.z + L[1] * c.ex * sx + F[1] * c.ez * sz]);
  let px = (A.pos.x + B.pos.x) / 2, pz = (A.pos.z + B.pos.z) / 2, mn = 1e9;
  for (const [x, z] of corners(A, AF, AL)) { const d = x * nx + z * nz; if (d < mn) { mn = d; px = x; pz = z; } }
  let mx = -1e9, qx = px, qz = pz; for (const [x, z] of corners(B, BF, BL)) { const d = x * nx + z * nz; if (d > mx) { mx = d; qx = x; qz = z; } }
  px = (px + qx) / 2; pz = (pz + qz) / 2;
  // separate by inverse mass
  const wa = A.invMass / (A.invMass + B.invMass), wb = 1 - wa;
  A.pos.x += nx * best * wa; A.pos.z += nz * best * wa; B.pos.x -= nx * best * wb; B.pos.z -= nz * best * wb;
  const cp = _e.set(px, (A.pos.y + B.pos.y) / 2 - 0.1, pz); const n = _n.set(nx, 0, nz);
  const rA = new V3().subVectors(cp, A.pos), rB = new V3().subVectors(cp, B.pos);
  const vA = A.pointVel(rA, new V3()), vB = B.pointVel(rB, new V3()); const vRel = vA.sub(vB); const vn = vRel.dot(n);
  A.wake(); B.wake();
  if (vn >= 0) return;
  const k = A.kAlong(rA, n) + B.kAlong(rB, n); const j = -(1 + 0.25) * vn / k;
  const J = new V3().copy(n).multiplyScalar(j); A.impulse(J, rA); J.negate(); B.impulse(J, rB);
  const tv = vRel.addScaledVector(n, -vn); tv.y = 0; const vt = tv.length();
  if (vt > 0.01) { tv.multiplyScalar(1 / vt); const kt = A.kAlong(rA, tv) + B.kAlong(rB, tv); const jt = Math.min(vt / kt, 0.35 * j); const Jt = tv.multiplyScalar(-jt); A.impulse(Jt, rA); Jt.negate(); B.impulse(Jt, rB); }
  game.onImpact(A, B, j, cp, n, 'car', -vn, vt);
}
