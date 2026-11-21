// Big Steal Car — AI drivers: lane-following traffic with traffic lights + queueing, and pursuit police.
import * as THREE from 'three';
import { CITY } from './config.js';
import { clamp, R, wrapAngle } from './util.js';

const { NB, P, HALF } = CITY;

// ---------- polyline follower ----------
class Path {
  constructor() { this.pts = []; this.seg = 0; this.flags = []; }
  set(pts, flags) { this.pts = pts; this.flags = flags || pts.map(() => 0); this.seg = 0; }
  push(pts, flag = 0) { for (const p of pts) { this.pts.push(p); this.flags.push(flag); } }
  // advance the active segment and return [lookahead point, distance-to-end-of-flagged-run]
  track(x, z, ld) {
    const P2 = this.pts; if (P2.length < 2) return P2[0] || [x, z];
    while (this.seg < P2.length - 2) {
      const [ax, az] = P2[this.seg], [bx, bz] = P2[this.seg + 1]; const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1;
      const t = ((x - ax) * vx + (z - az) * vz) / L2; if (t > 1) this.seg++; else break;
    }
    // project on current segment then walk ld forward
    let [ax, az] = P2[this.seg], [bx, bz] = P2[this.seg + 1]; let vx = bx - ax, vz = bz - az; let L = Math.hypot(vx, vz) || 1;
    let t = clamp(((x - ax) * vx + (z - az) * vz) / (L * L), 0, 1); let px = ax + vx * t, pz = az + vz * t;
    this.lat = Math.abs((x - ax) * vz - (z - az) * vx) / L;
    let rem = ld; let i = this.seg; let left = L * (1 - t);
    while (rem > left && i < P2.length - 2) { rem -= left; i++; [ax, az] = P2[i]; [bx, bz] = P2[i + 1]; vx = bx - ax; vz = bz - az; L = Math.hypot(vx, vz) || 1; px = ax; pz = az; left = L; }
    const k = Math.min(rem, left) / L; return [px + vx * k, pz + vz * k];
  }
  remainingTo(idx, x, z) { // distance along the path from the car to point idx
    let d = 0; const P2 = this.pts; if (idx <= this.seg) return Math.hypot(P2[idx][0] - x, P2[idx][1] - z) * (idx === this.seg ? -1 : 1);
    d += Math.hypot(P2[this.seg + 1][0] - x, P2[this.seg + 1][1] - z);
    for (let i = this.seg + 1; i < idx; i++) d += Math.hypot(P2[i + 1][0] - P2[i][0], P2[i + 1][1] - P2[i][1]);
    return d;
  }
  trim() { if (this.seg > 6) { this.pts.splice(0, this.seg); this.flags.splice(0, this.seg); this.stopIdx -= this.seg; this.seg = 0; } }
}

// steering helper: pure pursuit toward (tx,tz)
function pursue(car, tx, tz) {
  const dx = tx - car.pos.x, dz = tz - car.pos.z;
  const lx = dx * car.left.x + dz * car.left.z, lz = dx * car.fwd.x + dz * car.fwd.z; const ld2 = Math.max(4, lx * lx + lz * lz);
  const kappa = (2 * lx) / ld2; let delta = Math.atan(kappa * car.type.wb);
  if (lz < 0) delta = Math.sign(lx || 1) * 1.0; // target behind: full lock
  return clamp(-delta / Math.max(0.12, car.maxSteer()), -1, 1);
}
function speedCtl(car, target) {
  const v = car.vFwd; const err = target - v; const c = car.ctrl; c.noReverse = true;
  c.throttle = clamp(err * 0.4, 0, 1); c.brake = clamp(-err * 0.35, 0, 1);
  if (target < 0.3) { c.throttle = 0; c.brake = 1; }
}

// ---------------- traffic ----------------
export class TrafficDriver {
  constructor(game, car, a, b, li) {
    this.game = game; this.car = car; this.path = new Path(); this.cruise = R.range(10.5, 15.5) * (car.type.cls === 'Sports' ? 1.15 : 1);
    this.stuckT = 0; this.reverseT = 0; this.blockedT = 0; this.honkT = 0; this.lostT = 0; this.angry = 0;
    this.begin(a, b, li);
  }
  begin(a, b, li) {
    this.a = a; this.b = b; this.li = li;
    const [s, e] = this.game.world.lanePath(a[0], a[1], b[0], b[1], li);
    this.path.set([s, e], [0, 0]); this.path.stopIdx = 1; this.axis = a[1] === b[1] ? 'x' : 'z';
  }
  extend() { // choose the next road at node b
    const W = this.game.world; const opts = W.neighbors(...this.b).filter(([k, l]) => !(k === this.a[0] && l === this.a[1]));
    const c = opts.length ? opts[Math.floor(Math.random() * opts.length)] : this.a;
    const turn = W.turnPath(this.a[0], this.a[1], this.b[0], this.b[1], c[0], c[1], this.li);
    const straight = (c[0] - this.b[0]) === (this.b[0] - this.a[0]) && (c[1] - this.b[1]) === (this.b[1] - this.a[1]);
    this.path.push(turn, straight ? 0 : 1);
    const [, e] = W.lanePath(this.b[0], this.b[1], c[0], c[1], this.li); this.path.push([e], 0);
    this.a = this.b; this.b = c; this.path.stopIdx = this.path.pts.length - 1; this.axis = this.a[1] === this.b[1] ? 'x' : 'z';
    this.path.trim();
  }
  reroute() {
    const W = this.game.world; const car = this.car; const n = W.nearestNode(car.pos.x, car.pos.z);
    let best = null, bd = -2; for (const nb of W.neighbors(...n)) { const [x0, z0] = W.nodePos(...n), [x1, z1] = W.nodePos(...nb); const d = ((x1 - x0) * car.fwd.x + (z1 - z0) * car.fwd.z) / P; if (d > bd) { bd = d; best = nb; } }
    this.begin(n, best, this.li); this.path.pts.unshift([car.pos.x, car.pos.z]); this.path.flags.unshift(0); this.path.stopIdx = 2;
  }
  update(dt) {
    const car = this.car, g = this.game, W = g.world; const c = car.ctrl; c.handbrake = false;
    if (car.dead) { c.throttle = 0; c.brake = 1; return; }
    const v = car.vFwd; const x = car.pos.x, z = car.pos.z;
    // keep a couple of roads queued
    if (this.path.pts.length - this.path.seg < 4) this.extend();
    const [tx, tz] = this.path.track(x, z, 5 + Math.abs(v) * 0.55);
    if (this.path.lat > 14) { this.lostT += dt; if (this.lostT > 1.5) { this.reroute(); this.lostT = 0; } } else this.lostT = 0;
    let target = this.cruise * (car.type.cls === 'Van' ? 0.85 : 1);
    if (this.path.flags[this.path.seg + 1] || this.path.flags[this.path.seg + 2]) target = Math.min(target, 7.5);
    // traffic light at the stop line of the current road
    const dStop = this.path.remainingTo(this.path.stopIdx, x, z);
    if (dStop > -1 && dStop < 45) {
      const st = W.lightState(this.b[0], this.b[1], this.axis);
      if (st === 'r' || (st === 'y' && dStop > 10)) target = Math.min(target, Math.sqrt(Math.max(0, dStop - 1.5) * 2 * 4.2));
    }
    // anything in our way?
    let ahead = 1e9, blocker = null;
    for (const o of g.cars) {
      if (o === car) continue; const dx = o.pos.x - x, dz = o.pos.z - z; const d2 = dx * dx + dz * dz; if (d2 > 900) continue;
      const f = dx * car.fwd.x + dz * car.fwd.z, l = dx * car.left.x + dz * car.left.z;
      const lat = this.blockedT > 6 ? 1.1 : 2.1 + Math.max(0, f) * 0.03;
      if (f > 0 && Math.abs(l) < lat) { const gap = f - car.ez - o.ez; if (gap < ahead) { ahead = gap; blocker = o; } }
    }
    for (const h of g.walkers()) {
      const dx = h.pos.x - x, dz = h.pos.z - z; const f = dx * car.fwd.x + dz * car.fwd.z, l = dx * car.left.x + dz * car.left.z;
      if (f > 0 && f < 16 && Math.abs(l) < 1.7) { const gap = f - car.ez - 1; if (gap < ahead) { ahead = gap; blocker = h; } }
    }
    if (ahead < 40) {
      target = Math.min(target, Math.max(0, (ahead - 2.5) * 0.85));
      if (target < 1 && Math.abs(v) < 1) this.blockedT += dt; else this.blockedT = Math.max(0, this.blockedT - dt);
      if (blocker && (blocker === g.player.char || blocker === g.playerCar) && ahead < 6 && this.honkT <= 0) { this.honkT = 2.5 + Math.random() * 2; g.audio.honk(car.pos, 0.7); }
    } else this.blockedT = 0;
    this.honkT -= dt;
    // stuck (pushed into a wall etc.) -> back up
    if (Math.abs(v) < 0.5) this.stuckLong = (this.stuckLong || 0) + dt; else this.stuckLong = 0;
    if (this.reverseT > 0) { this.reverseT -= dt; c.throttle = 0; c.brake = 1; c.noReverse = false; c.steer = -this.revSteer; return; }
    if (target > 3 && Math.abs(v) < 0.6) { this.stuckT += dt; if (this.stuckT > 2.5) { this.stuckT = 0; this.reverseT = 1.4; this.revSteer = pursue(car, tx, tz); } } else this.stuckT = 0;
    c.steer = pursue(car, tx, tz);
    speedCtl(car, target);
  }
}

// ---------------- police ----------------
export class PoliceDriver {
  constructor(game, car) { this.game = game; this.car = car; this.path = new Path(); this.repath = 0; this.stuckT = 0; this.reverseT = 0; this.offset = (Math.random() - 0.5) * 6; this.traffic = null; this.leaveT = 0; this.boost = 1; }
  buildPath(tgt) {
    const W = this.game.world, car = this.car;
    // start from the intersection ahead of us (never one behind, or we'd U-turn back and forth)
    const k0 = Math.floor((car.pos.x + HALF) / P), l0 = Math.floor((car.pos.z + HALF) / P); let from = null, bs = 1e9;
    for (let k = k0; k <= k0 + 1; k++) for (let l = l0; l <= l0 + 1; l++) {
      if (k < 0 || l < 0 || k > NB || l > NB) continue; const [x, z] = W.nodePos(k, l); const dxn = x - car.pos.x, dzn = z - car.pos.z;
      const sc = Math.hypot(dxn, dzn) + (dxn * car.fwd.x + dzn * car.fwd.z < 0 ? 300 : 0); if (sc < bs) { bs = sc; from = [k, l]; }
    }
    const to = W.nearestNode(tgt.x, tgt.z);
    const nodes = W.route(from, to); const pts = [[car.pos.x, car.pos.z]];
    let prev = null;
    for (const nd of nodes) {
      const [x, z] = W.nodePos(...nd);
      if (prev) { const dx = Math.sign(x - prev[0]), dz = Math.sign(z - prev[1]); pts.push([prev[0] + dx * 12 - dz * 2.2, prev[1] + dz * 12 + dx * 2.2]); pts.push([x - dx * 12 - dz * 2.2, z - dz * 12 + dx * 2.2]); }
      else pts.push([x, z]);
      prev = [x, z];
    }
    pts.push([tgt.x, tgt.z]); this.path.set(pts);
  }
  update(dt) {
    const car = this.car, g = this.game, W = g.world; const c = car.ctrl; c.handbrake = false;
    if (car.dead) { c.throttle = 0; c.brake = 1; car.siren = false; return; }
    if (g.wanted.stars === 0) { // stand down: drive off like normal traffic
      car.siren = false;
      if (!this.traffic) { const n = W.nearestNode(car.pos.x, car.pos.z); const nb = W.neighbors(...n)[0]; this.traffic = new TrafficDriver(g, car, n, nb, 0); this.traffic.reroute(); }
      this.leaveT += dt; this.traffic.update(dt); return;
    }
    this.traffic = null; car.siren = true;
    const tgt = g.playerTarget(); const v = car.vFwd;
    const dx = tgt.x - car.pos.x, dz = tgt.z - car.pos.z; const dist = Math.hypot(dx, dz);
    const onFoot = !g.playerCar;
    this.repath -= dt;
    const los = dist < 70 && W.raycast(car.pos.x, 1.2, car.pos.z, tgt.x, 1.2, tgt.z, 1.2) >= 1;
    let aimX, aimZ, target;
    if (los || dist < 18) {
      const lead = clamp(dist / 30, 0, 1.0);
      aimX = tgt.x + tgt.vx * lead; aimZ = tgt.z + tgt.vz * lead;
      if (dist > 12 && !onFoot) { aimX += tgt.lx * this.offset; aimZ += tgt.lz * this.offset; } // spread out to box the player in
      const pv = Math.hypot(tgt.vx, tgt.vz);
      if (onFoot) target = clamp((dist - 9) * 1.4, 0, 30);
      else if (pv < 4) { target = Math.sqrt(Math.max(0, 2 * 6 * (dist - 5.5))); aimX = tgt.x + tgt.lx * Math.sign(this.offset || 1) * 3.2; aimZ = tgt.z + tgt.lz * Math.sign(this.offset || 1) * 3.2; } // pull up alongside and box them in
      else target = Math.min(car.type.vmax, Math.sqrt((pv + 8) * (pv + 8) + 2 * 7 * Math.max(0, dist - 10))); // catch up, then ram
      this.path.set([]); this.repath = 0;
    } else {
      if (this.repath <= 0 || this.path.pts.length < 2) { this.repath = 1.4; this.buildPath(tgt); }
      [aimX, aimZ] = this.path.track(car.pos.x, car.pos.z, 7 + Math.abs(v) * 0.45);
      target = car.type.vmax;
      // braking curve into the next corner: v^2 = vc^2 + 2ad
      const P2 = this.path.pts; let dAcc = Math.hypot(P2[this.path.seg + 1][0] - car.pos.x, P2[this.path.seg + 1][1] - car.pos.z);
      for (let i = this.path.seg + 1; i + 1 < P2.length && dAcc < 120; i++) {
        const [ax, az] = P2[i - 1], [bx, bz] = P2[i], [cx, cz] = P2[i + 1];
        const turn = Math.abs(wrapAngle(Math.atan2(cx - bx, cz - bz) - Math.atan2(bx - ax, bz - az)));
        if (turn > 0.5) { const vc = turn > 1.2 ? 11.5 : 17; target = Math.min(target, Math.sqrt(vc * vc + 2 * 8 * Math.max(0, dAcc - 4))); break; }
        dAcc += Math.hypot(cx - bx, cz - bz);
      }
    }
    // rubber band: far-away cruisers get a bit of extra urgency
    this.boost = dist > 70 && !g.inView(car.pos.x, car.pos.z, 4) ? 1.35 : 1;
    // feelers: steer away from anything solid right in front
    let avoid = 0;
    for (const [ang, d] of [[0.5, 6], [-0.5, 6], [0.22, 12], [-0.22, 12]]) {
      const cs = Math.cos(ang), sn = Math.sin(ang); const fx = car.fwd.x * cs + car.left.x * sn, fz = car.fwd.z * cs + car.left.z * sn;
      if (W.blocked(car.pos.x + fx * d, car.pos.z + fz * d, 0.9)) avoid += ang > 0 ? 0.8 : -0.8;
    }
    if (W.blocked(car.pos.x + car.fwd.x * 7, car.pos.z + car.fwd.z * 7, 0.6) && v > 14) target = Math.min(target, 10);
    if (this.reverseT > 0) { this.reverseT -= dt; c.throttle = 0; c.brake = 1; c.noReverse = false; c.steer = -this.revSteer; return; }
    if (target > 3 && Math.abs(v) < 0.9) { this.stuckT += dt; if (this.stuckT > 1.4) { this.stuckT = 0; this.reverseT = 1.2; this.revSteer = clamp(pursue(car, aimX, aimZ) + avoid, -1, 1); this.repath = 0; } } else this.stuckT = 0;
    c.steer = clamp(pursue(car, aimX, aimZ) + avoid, -1, 1);
    speedCtl(car, target);
    if (this.boost > 1 && c.throttle > 0) car.boost = this.boost; else car.boost = 1;
    if (onFoot && dist < 11) { c.throttle = 0; c.brake = 1; }
  }
}

// ---------------- traffic + parked car population ----------------
export class Population {
  constructor(game) { this.game = game; this.timer = 0; this.parkTimer = 0; }
  spawnPoint(minD, maxD, needHidden = true) {
    const g = this.game, W = g.world; const f = g.focus;
    for (let tries = 0; tries < 30; tries++) {
      const [k0, l0] = W.nearestNode(f.x, f.z); const k = clamp(k0 + Math.floor(Math.random() * 7) - 3, 0, NB), l = clamp(l0 + Math.floor(Math.random() * 7) - 3, 0, NB);
      const nbs = W.neighbors(k, l); const nb = nbs[Math.floor(Math.random() * nbs.length)]; const li = Math.random() < 0.5 ? 0 : 1;
      const [s, e] = W.lanePath(k, l, nb[0], nb[1], li); const t = 0.15 + Math.random() * 0.6;
      const x = s[0] + (e[0] - s[0]) * t, z = s[1] + (e[1] - s[1]) * t; const d = Math.hypot(x - f.x, z - f.z);
      if (d < minD || d > maxD) continue;
      if (needHidden && g.inView(x, z, 6) && d < 170) continue;
      if (g.cars.some((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < 12)) continue;
      return { x, z, yaw: Math.atan2(e[0] - s[0], e[1] - s[1]), a: [k, l], b: nb, li };
    }
    return null;
  }
  update(dt) {
    const g = this.game; const f = g.focus; this.timer -= dt; this.parkTimer -= dt;
    // despawn far cars
    for (const car of [...g.cars]) {
      if (car === g.playerCar || car === g.lastCar) continue;
      const d = Math.hypot(car.pos.x - f.x, car.pos.z - f.z);
      const far = car.role === 'parked' ? 210 : car.role === 'police' ? 300 : 270;
      if (d > far || (car.role === 'traffic' && car.ai && car.ai.stuckLong > 20 && !g.inView(car.pos.x, car.pos.z, 4)) || (car.dead && d > 120) || (car.role === 'police' && car.ai.leaveT > 25 && !g.inView(car.pos.x, car.pos.z, 4))) g.removeCar(car);
      else if (car.upsideT > 6 && d > 40 && !g.inView(car.pos.x, car.pos.z, 4)) g.removeCar(car);
    }
    const traffic = g.cars.filter((c) => c.role === 'traffic').length;
    if (this.timer <= 0 && traffic < g.trafficTarget) {
      this.timer = 0.35; const sp = this.spawnPoint(70, 230, true);
      if (sp) g.spawnTraffic(sp);
    }
    if (this.parkTimer <= 0) {
      this.parkTimer = 1.0;
      const parked = g.cars.filter((c) => c.role === 'parked').length;
      if (parked < g.parkedTarget) {
        const slots = g.world.parkingSlots; for (let k = 0; k < 40; k++) {
          const s = slots[Math.floor(Math.random() * slots.length)]; const d = Math.hypot(s.x - f.x, s.z - f.z);
          if (d < 45 || d > 170 || s.used) continue; if (g.inView(s.x, s.z, 4) && d < 120) continue;
          if (g.cars.some((c) => Math.hypot(c.pos.x - s.x, c.pos.z - s.z) < 5)) continue;
          g.spawnParked(s); break;
        }
      }
    }
  }
}
export { Path, pursue, speedCtl };
void THREE; void HALF;
