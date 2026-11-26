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
    this.path.set([s, e], [0, 0]); this.path.stopIdx = 1; this.axis = this.game.world.axisOf(a, b);
  }
  extend() { // choose the next road at node b
    const W = this.game.world; let opts = W.neighbors(...this.b).filter(([k, l]) => !(k === this.a[0] && l === this.a[1]));
    const [ax, az] = W.nodePos(...this.a), [bx, bz] = W.nodePos(...this.b); const d1 = [bx - ax, bz - az]; const l1 = Math.hypot(...d1);
    const gentle = opts.filter((n) => { const [cx, cz] = W.nodePos(...n); const d2 = [cx - bx, cz - bz]; return (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * Math.hypot(...d2)) > -0.5; });
    if (gentle.length) opts = gentle;
    const c = opts.length ? opts[Math.floor(Math.random() * opts.length)] : this.a;
    const turn = W.turnPath(this.a[0], this.a[1], this.b[0], this.b[1], c[0], c[1], this.li);
    const straight = (c[0] - this.b[0]) === (this.b[0] - this.a[0]) && (c[1] - this.b[1]) === (this.b[1] - this.a[1]);
    this.path.push(turn, straight ? 0 : 1);
    const [, e] = W.lanePath(this.b[0], this.b[1], c[0], c[1], this.li); this.path.push([e], 0);
    this.a = this.b; this.b = c; this.path.stopIdx = this.path.pts.length - 1; this.axis = W.axisOf(this.a, this.b);
    this.path.trim();
  }
  reroute() {
    const W = this.game.world; const car = this.car; const n = W.nearestNode(car.pos.x, car.pos.z);
    let best = null, bd = -2; for (const nb of W.neighbors(...n)) { const [x0, z0] = W.nodePos(...n), [x1, z1] = W.nodePos(...nb); const d = ((x1 - x0) * car.fwd.x + (z1 - z0) * car.fwd.z) / Math.hypot(x1 - x0, z1 - z0); if (d > bd) { bd = d; best = nb; } }
    this.begin(n, best, this.li); this.path.pts.unshift([car.pos.x, car.pos.z]); this.path.flags.unshift(0); this.path.stopIdx = 2;
  }
  flee() { this.fleeing = true; this.panicT = 1e9; this.cruise = Math.max(this.cruise, 15) * 1.15; }
  update(dt) {
    const car = this.car, g = this.game, W = g.world; const c = car.ctrl; c.handbrake = false;
    if (car.dead) { c.throttle = 0; c.brake = 1; return; }
    if (this.busted) { c.throttle = 0; c.brake = 1; c.steer = 0; car.hazard = true; car.signal = null; this.stuckLong = (this.stuckLong || 0) + dt; return; }
    if (this.pullOver) { // lit up by an officer: indicate, ease over to the curb and stop
      this.pullT = (this.pullT || 0) + dt; const [px, pz] = this.path.track(car.pos.x, car.pos.z, 7); c.steer = clamp(pursue(car, px - car.left.x * 2.4, pz - car.left.z * 2.4), -0.6, 0.6);
      speedCtl(car, Math.max(0, 9 - this.pullT * 4)); car.signal = 'R'; car.hazard = false;
      if ((car.speed < 0.4 && this.pullT > 1) || this.pullT > 8) { this.pullOver = false; this.busted = true; }
      return;
    }
    const v = car.vFwd; const x = car.pos.x, z = car.pos.z;
    // keep a couple of roads queued
    if (this.path.pts.length - this.path.seg < 4) this.extend();
    const [tx, tz] = this.path.track(x, z, 5 + Math.abs(v) * 0.55);
    if (this.path.lat > 14) { this.lostT += dt; if (this.lostT > 1.5) { this.reroute(); this.lostT = 0; } } else this.lostT = 0;
    let target = this.cruise * (car.type.cls === 'Van' ? 0.85 : car.type.cls === 'Truck' ? 0.72 : 1);
    if (this.path.flags[this.path.seg + 1] || this.path.flags[this.path.seg + 2]) target = Math.min(target, 7.5);
    // spooked by gunfire: floor it and ignore the lights for a while
    if (this.panicT > 0) { this.panicT -= dt; target = this.cruise * (this.fleeing ? 2.1 : 1.75); if (Math.random() < dt * 0.6) g.audio.honk(car.pos, 0.6); }
    // a siren coming up behind: slow down and move over
    if (!this.fleeing) { this.yieldT = Math.max(0, (this.yieldT || 0) - dt); for (const o of g.cars) { if (!o.siren || o === car || !(o.role === 'police' || o === g.playerCar) || o.speed < 4) continue; const dx = o.pos.x - x, dz = o.pos.z - z; const f = dx * car.fwd.x + dz * car.fwd.z; if (f < -2 && f > -38 && Math.abs(dx * car.left.x + dz * car.left.z) < 5 && o.vel.dot(car.fwd) > 2) this.yieldT = 2.2; }
      if (this.yieldT > 0) target = Math.min(target, 3.5); }
    // traffic light at the stop line of the current road
    const dStop = this.path.remainingTo(this.path.stopIdx, x, z);
    if (dStop > -1 && dStop < 45 && !(this.panicT > 0)) {
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
    c.steer = pursue(car, this.yieldT > 0 ? tx - car.left.x * 1.6 : tx, this.yieldT > 0 ? tz - car.left.z * 1.6 : tz);
    speedCtl(car, target);
    car.signal = this.upcomingTurn(x, z);
    car.hazard = this.stuckLong > 8 || car.health < 250; if (this.fleeing) car.signal = null;
  }
  // indicate ~40 m before a flagged turn run and keep it on through the corner
  upcomingTurn(x, z) {
    const P2 = this.path.pts, F = this.path.flags;
    for (let i = Math.max(1, this.path.seg); i < P2.length - 1 && i < this.path.seg + 14; i++) {
      if (!F[i]) continue;
      if (i > this.path.seg + 1 && this.path.remainingTo(i, x, z) > 42) return null;
      let j = i; while (j + 1 < P2.length - 1 && F[j + 1]) j++;
      let s0 = i; while (s0 > 0 && F[s0 - 1]) s0--;
      const ax = P2[s0][0] - P2[Math.max(0, s0 - 1)][0], az = P2[s0][1] - P2[Math.max(0, s0 - 1)][1], bx = P2[j + 1][0] - P2[j][0], bz = P2[j + 1][1] - P2[j][1];
      const cr = (ax * bz - az * bx) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
      return cr < -0.3 ? 'L' : cr > 0.3 ? 'R' : null;
    }
    return null;
  }
}

// ---------------- police ----------------
// Chases whoever it is after: the player (but only where the cops *think* the player is — live while seen, the
// last sighting otherwise, then a search pattern around it), or an NPC suspect (a driver who hit a cruiser, a
// troublemaker who shot at one). With nothing to do it just patrols like traffic.
export class PoliceDriver {
  constructor(game, car) { this.game = game; this.car = car; this.path = new Path(); this.repath = 0; this.stuckT = 0; this.reverseT = 0; this.offset = (Math.random() - 0.5) * 6; this.traffic = null; this.leaveT = 0; this.boost = 1; this.suspect = null; this.searchPt = null; }
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
    let prev = null, prevN = null;
    for (const nd of nodes) {
      const [x, z] = W.nodePos(...nd);
      if (prev) { let dx = x - prev[0], dz = z - prev[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; const s0 = W.stopDist(prevN[0], prevN[1]), s1 = W.stopDist(nd[0], nd[1]); pts.push([prev[0] + dx * (s0 - 2) - dz * 2.2, prev[1] + dz * (s0 - 2) + dx * 2.2]); pts.push([x - dx * (s1 - 2) - dz * 2.2, z - dz * (s1 - 2) + dx * 2.2]); }
      else pts.push([x, z]);
      prev = [x, z]; prevN = nd;
    }
    pts.push([tgt.x, tgt.z]); this.path.set(pts);
  }
  setSuspect(s) { if (this.suspect && !this.suspect.done) return false; this.suspect = { ...s, t: 0, bustT: 0, doneT: 0, done: false }; this.traffic = null; this.car.siren = true; this.repath = 0; return true; }
  endSuspect() { this.suspect = null; }
  suspectState() {
    const s = this.suspect, g = this.game; if (!s) return null;
    if (s.car) { const c = s.car; if (!g.cars.includes(c) || c === g.playerCar || c.dead) return null; return { x: c.pos.x, z: c.pos.z, vx: c.vel.x, vz: c.vel.z, lx: c.left.x, lz: c.left.z, onFoot: false, speed: c.speed }; }
    const ch = s.ch; if (!g.peds.list.includes(ch)) return null; return { x: ch.pos.x, z: ch.pos.z, vx: ch.vel.x, vz: ch.vel.z, lx: 1, lz: 0, onFoot: true, speed: ch.speed, ch };
  }
  update(dt) {
    const car = this.car, g = this.game, W = g.world; const c = car.ctrl; c.handbrake = false; car.signal = null; car.hazard = false;
    if (car.dead) { c.throttle = 0; c.brake = 1; car.siren = false; return; }
    const WT = g.wanted; let tgt = null, chasingPlayer = false, sus = null;
    if (this.suspect) {
      sus = this.suspectState(); const s = this.suspect;
      if (!sus || (WT.stars >= 2 && Math.hypot(g.focus.x - car.pos.x, g.focus.z - car.pos.z) < 60)) { this.endSuspect(); sus = null; }
      else {
        s.t += dt; const d = Math.hypot(sus.x - car.pos.x, sus.z - car.pos.z);
        if (s.done) { s.doneT += dt; if (s.doneT > 6) { this.endSuspect(); sus = null; } }
        else if (d > 170 || s.t > 150) { this.endSuspect(); sus = null; } // got away
        else if (!sus.onFoot && sus.speed < 1.5 && d < 9) { s.bustT += dt; if (s.bustT > 2.4) { s.done = true; if (s.car.ai) s.car.ai.busted = true; if (Math.hypot(g.focus.x - car.pos.x, g.focus.z - car.pos.z) < 90) g.hud.help('~b~Police~w~ pulled over a reckless driver.', 2.5); } }
        else if (sus.onFoot && (sus.ch.surrender || sus.ch.state === 'down')) s.done = true;
        if (sus) tgt = sus;
      }
    }
    if (!tgt && WT.stars > 0) { tgt = WT.copTarget(); chasingPlayer = true; }
    if (!tgt) { // patrol: drive around like normal traffic
      car.siren = false;
      if (!this.traffic) { const n = W.nearestNode(car.pos.x, car.pos.z); const nb = W.neighbors(...n)[0]; this.traffic = new TrafficDriver(g, car, n, nb, 0); this.traffic.reroute(); this.traffic.cruise = 11 + Math.random() * 2; }
      this.leaveT += dt; this.traffic.update(dt); car.siren = false; return;
    }
    this.traffic = null; car.siren = !(this.suspect && this.suspect.done);
    const v = car.vFwd;
    // lost sight of the player: drive to the last sighting, then search the blocks around it
    const searching = chasingPlayer && !WT.seen && WT.sinceSeen > 1.5;
    if (searching) {
      const k = WT.lastKnown; const dk = Math.hypot(k.x - car.pos.x, k.z - car.pos.z);
      if (this.searchPt && Math.hypot(this.searchPt.x - car.pos.x, this.searchPt.z - car.pos.z) < 16) this.searchPt = null;
      if (!this.searchPt && dk < 28) { const n = W.nearestNode(k.x + (Math.random() - 0.5) * 120, k.z + (Math.random() - 0.5) * 120); const [x, z] = W.nodePos(...n); this.searchPt = { x, z, vx: 0, vz: 0, lx: 1, lz: 0 }; this.repath = 0; }
      if (this.searchPt) tgt = this.searchPt;
    } else this.searchPt = null;
    const dx = tgt.x - car.pos.x, dz = tgt.z - car.pos.z; const dist = Math.hypot(dx, dz);
    const onFoot = chasingPlayer ? !g.playerCar : !!tgt.onFoot;
    this.repath -= dt;
    const los = !searching && dist < 70 && (chasingPlayer ? WT.seen || dist < 18 : W.raycast(car.pos.x, 1.2, car.pos.z, tgt.x, 1.2, tgt.z, 1.2) >= 1);
    let aimX, aimZ, target;
    if (los) {
      const lead = clamp(dist / 30, 0, 1.0);
      aimX = tgt.x + tgt.vx * lead; aimZ = tgt.z + tgt.vz * lead;
      if (dist > 12 && !onFoot) { aimX += tgt.lx * this.offset; aimZ += tgt.lz * this.offset; } // spread out to box the suspect in
      const pv = Math.hypot(tgt.vx, tgt.vz);
      if (onFoot) target = clamp((dist - 9) * 1.4, 0, 30);
      else if (pv < 4) { target = Math.sqrt(Math.max(0, 2 * 6 * (dist - 5.5))); aimX = tgt.x + tgt.lx * Math.sign(this.offset || 1) * 3.2; aimZ = tgt.z + tgt.lz * Math.sign(this.offset || 1) * 3.2; } // pull up alongside and box them in
      else target = Math.min(car.type.vmax, Math.sqrt((pv + 8) * (pv + 8) + 2 * 7 * Math.max(0, dist - 10))); // catch up, then ram
      this.path.set([]); this.repath = 0;
      // 4+ stars: the passenger leans out and shoots
      if (chasingPlayer && WT.stars >= 4 && dist < 32 && g.state === 'play') { this.shootT = (this.shootT ?? 1.2) - dt; if (this.shootT <= 0) { this.shootT = 1.0 + Math.random() * 0.9; const from = car.pos.clone().addScaledVector(car.left, -(car.ex + 0.15)).addScaledVector(car.up, 0.75); g.weapons.npcShoot(from, onFoot ? 0.32 : 0.28, 6); } }
    } else {
      if (this.repath <= 0 || this.path.pts.length < 2) { this.repath = 1.4; this.buildPath(tgt); }
      [aimX, aimZ] = this.path.track(car.pos.x, car.pos.z, 7 + Math.abs(v) * 0.45);
      target = searching && this.searchPt ? 14 : car.type.vmax;
      // braking curve into the next corner: v^2 = vc^2 + 2ad
      const P2 = this.path.pts; let dAcc = Math.hypot(P2[this.path.seg + 1][0] - car.pos.x, P2[this.path.seg + 1][1] - car.pos.z);
      for (let i = this.path.seg + 1; i + 1 < P2.length && dAcc < 120; i++) {
        const [ax, az] = P2[i - 1], [bx, bz] = P2[i], [cx, cz] = P2[i + 1];
        const turn = Math.abs(wrapAngle(Math.atan2(cx - bx, cz - bz) - Math.atan2(bx - ax, bz - az)));
        if (turn > 0.5) { const vc = turn > 1.2 ? 11.5 : 17; target = Math.min(target, Math.sqrt(vc * vc + 2 * 8 * Math.max(0, dAcc - 4))); break; }
        dAcc += Math.hypot(cx - bx, cz - bz);
      }
      if (dist < 12) target = Math.min(target, 6);
    }
    // a suspect on foot: pull up and send the officer after them
    if (sus && sus.onFoot && !this.suspect.done && dist < 15 && car.speed < 3 && !car.officer) g.peds.spawnCop(car, sus.ch);
    // rubber band: far-away cruisers get a bit of extra urgency (only once they know where to go)
    this.boost = chasingPlayer && !searching && dist > 70 && !g.inView(car.pos.x, car.pos.z, 4) ? 1.3 : 1;
    // feelers: steer away from anything solid right in front
    let avoid = 0;
    for (const [ang, d] of [[0.5, 6], [-0.5, 6], [0.22, 12], [-0.22, 12]]) {
      const cs = Math.cos(ang), sn = Math.sin(ang); const fx = car.fwd.x * cs + car.left.x * sn, fz = car.fwd.z * cs + car.left.z * sn;
      if (W.blocked(car.pos.x + fx * d, car.pos.z + fz * d, 0.9)) avoid += ang > 0 ? 0.8 : -0.8;
    }
    if (W.blocked(car.pos.x + car.fwd.x * 7, car.pos.z + car.fwd.z * 7, 0.6) && v > 14) target = Math.min(target, 10);
    if (this.suspect && this.suspect.done) target = 0;
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
  spawnPoint(minD, maxD, needHidden = true, center = null) {
    const g = this.game, W = g.world; const f = center || g.focus;
    for (let tries = 0; tries < 30; tries++) {
      const [k0, l0] = W.nearestNode(f.x, f.z); const k = clamp(k0 + Math.floor(Math.random() * 7) - 3, 0, NB), l = clamp(l0 + Math.floor(Math.random() * 7) - 3, 0, NB);
      const nbs = W.neighbors(k, l); const nb = nbs[Math.floor(Math.random() * nbs.length)]; const li = Math.random() < 0.5 ? 0 : 1;
      const [s, e] = W.lanePath(k, l, nb[0], nb[1], li); const t = 0.15 + Math.random() * 0.6;
      const x = s[0] + (e[0] - s[0]) * t, z = s[1] + (e[1] - s[1]) * t; const d = Math.hypot(x - f.x, z - f.z);
      if (d < minD || d > maxD) continue;
      if (needHidden && g.inView(x, z, 6) && Math.hypot(x - g.focus.x, z - g.focus.z) < 170) continue;
      if (g.cars.some((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < 12)) continue;
      return { x, z, yaw: Math.atan2(e[0] - s[0], e[1] - s[1]), a: [k, l], b: nb, li };
    }
    return null;
  }
  update(dt) {
    const g = this.game; const f = g.focus; this.timer -= dt; this.parkTimer -= dt;
    // despawn far cars
    for (const car of [...g.cars]) {
      if (car === g.playerCar || car === g.lastCar || car.keep) continue;
      const d = Math.hypot(car.pos.x - f.x, car.pos.z - f.z);
      const far = car.role === 'parked' ? 210 : car.role === 'police' ? 300 : 270;
      if (d > far || (car.role === 'traffic' && car.ai && car.ai.stuckLong > 20 && !g.inView(car.pos.x, car.pos.z, 4)) || (car.dead && d > 120) || (car.role === 'police' && !car.patrol && car.ai && car.ai.leaveT > 25 && !g.inView(car.pos.x, car.pos.z, 4))) g.removeCar(car);
      else if (car.upsideT > 6 && d > 40 && !g.inView(car.pos.x, car.pos.z, 4)) g.removeCar(car);
    }
    const traffic = g.cars.filter((c) => c.role === 'traffic').length;
    if (this.timer <= 0 && traffic < g.trafficTarget) {
      this.timer = 0.35; const sp = this.spawnPoint(70, 230, true);
      // now and then a patrol car instead of a civilian
      const patrols = g.cars.filter((c) => c.patrol).length;
      if (sp) { if (patrols < 2 && Math.random() < 0.12) { const pc = g.spawnPolice(sp); pc.patrol = true; pc.siren = false; pc.vel.multiplyScalar(0.6); } else g.spawnTraffic(sp); }
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
