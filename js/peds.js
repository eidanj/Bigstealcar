// Big Steal Car — pedestrians walking sidewalk loops (they scatter from fast cars) and foot patrol officers.
import * as THREE from 'three';
import { CITY } from './config.js';
import { Character, SKIN, HAIR, SHIRT, PANTS } from './humans.js';
import { R, clamp } from './util.js';

const { NB, P, SLAB } = CITY;
const D = SLAB - 2.6; // sidewalk centre line offset from block centre
const SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const idxOf = (sx, sz) => SIGNS.findIndex(([a, b]) => a === sx && b === sz);
const V3 = THREE.Vector3; const _w = new V3(), _v = new V3();

export function randomLook() {
  return { skin: R.pick(SKIN), hair: R.pick(HAIR), shirt: R.pick(SHIRT), pants: R.pick(PANTS), shoes: R.pick([0x222222, 0xf1f1f1, 0x6b4f3a, 0x3a3a3a]) };
}

export class Peds {
  constructor(game) { this.game = game; this.list = []; this.cops = []; this.timer = 0; }
  get walkers() { return this.list; }
  corner(b, i) { const [sx, sz] = SIGNS[i]; return [b.cx + sx * D, b.cz + sz * D]; }

  spawn(minD = 55, maxD = 150) {
    const g = this.game, W = g.world; const f = g.focus;
    for (let t = 0; t < 20; t++) {
      const b = W.blocks[Math.floor(Math.random() * W.blocks.length)];
      const ci = Math.floor(Math.random() * 4), cj = (ci + 1) % 4; const [ax, az] = this.corner(b, ci), [bx, bz] = this.corner(b, cj); const u = Math.random();
      const x = ax + (bx - ax) * u, z = az + (bz - az) * u; const d = Math.hypot(x - f.x, z - f.z);
      if (d < minD || d > maxD) continue; if (g.inView(x, z, 2) && d < 110) continue;
      const ch = new Character(g, randomLook(), x, z, 0); if (ch.slot == null) { ch.dispose(); return null; }
      ch.brain = { block: b, target: cj, dir: 1, mode: 'walk', speed: R.range(1.15, 1.6), wait: 0 }; ch.health = 60;
      if (Math.random() < 0.5) { ch.brain.dir = -1; ch.brain.target = ci; }
      this.list.push(ch); return ch;
    }
    return null;
  }
  adopt(ch, panic = 4) { // a car-jacked driver becomes a pedestrian
    const b = this.nearestBlock(ch.pos.x, ch.pos.z); ch.state = 'walk'; ch.visible = true; ch.scale = 1; ch.pos.y = this.game.world.ground(ch.pos.x, ch.pos.z);
    ch.brain = { block: b, target: 0, dir: 1, mode: 'return', speed: R.range(1.2, 1.6), wait: 0 }; ch.panic = panic; ch.health = 60; ch.cop = false; this.list.push(ch); return ch;
  }
  nearestBlock(x, z) { const i = clamp(Math.floor((x + CITY.HALF) / P), 0, NB - 1), j = clamp(Math.floor((z + CITY.HALF) / P), 0, NB - 1); return this.game.world.blocks[j * NB + i]; }
  remove(ch) { const i = this.list.indexOf(ch); if (i >= 0) this.list.splice(i, 1); ch.dispose(); }

  update(dt) {
    const g = this.game; const f = g.focus;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.4;
      for (const ch of [...this.list]) { const d = Math.hypot(ch.pos.x - f.x, ch.pos.z - f.z); if (d > 175 || (d > 120 && !g.inView(ch.pos.x, ch.pos.z, 2) && this.list.length > g.pedTarget)) this.remove(ch); }
      if (this.list.length < g.pedTarget) this.spawn();
    }
    for (const ch of this.list) this.think(ch, dt);
    this.updateCops(dt);
  }

  // threat scan: fast cars heading at us, honks
  threat(ch) {
    const g = this.game; let best = null;
    for (const car of g.cars) {
      if (!car.driver || car.speed < 6) continue;
      const dx = ch.pos.x - car.pos.x, dz = ch.pos.z - car.pos.z; const d2 = dx * dx + dz * dz; if (d2 > 196) continue;
      const vx = car.vel.x / car.speed, vz = car.vel.z / car.speed; const along = dx * vx + dz * vz; if (along < -2) continue;
      const lat = dx * vz - dz * vx; if (Math.abs(lat) < 3.6 + car.speed * 0.08) best = { car, lat, vx, vz };
    }
    return best;
  }

  think(ch, dt) {
    const g = this.game, W = g.world, B = ch.brain;
    if (ch.state !== 'walk') { ch.physicsRagdoll(dt); if (ch.state === 'walk') { B.mode = 'return'; ch.panic = 2.5; } ch.animate(dt); this.carHits(ch); return; }
    // threats
    const th = this.threat(ch);
    if (th) { ch.panic = 2.2; B.flee = [-(th.vz) * Math.sign(th.lat || 1), (th.vx) * Math.sign(th.lat || 1)]; }
    let wish = _w.set(0, 0, 0); let sp = B.speed;
    if (ch.panic > 0) {
      ch.panic -= dt; sp = 5.2;
      if (B.flee) wish.set(B.flee[0], 0, B.flee[1]);
      else { const [tx, tz] = this.corner(B.block, B.target); wish.set(tx - ch.pos.x, 0, tz - ch.pos.z); }
      if (ch.panic <= 0) { B.mode = 'return'; B.flee = null; }
    } else if (B.mode === 'walk' || B.mode === 'return') {
      if (B.mode === 'return') { // head to the closest corner of our block
        let bd = 1e9; for (let i = 0; i < 4; i++) { const [x, z] = this.corner(B.block, i); const d = Math.hypot(x - ch.pos.x, z - ch.pos.z); if (d < bd) { bd = d; B.target = i; } } B.mode = 'walk';
      }
      const [tx, tz] = this.corner(B.block, B.target); const dx = tx - ch.pos.x, dz = tz - ch.pos.z; const d = Math.hypot(dx, dz);
      if (d < 0.7) {
        // at a corner: maybe cross the street
        const [sx, sz] = SIGNS[B.target];
        const opts = [];
        if (B.block.i + sx >= 0 && B.block.i + sx < NB) opts.push([sx, 0]);
        if (B.block.j + sz >= 0 && B.block.j + sz < NB) opts.push([0, sz]);
        if (opts.length && Math.random() < 0.22) {
          const [di, dj] = opts[Math.floor(Math.random() * opts.length)];
          const nb = W.blocks[(B.block.j + dj) * NB + (B.block.i + di)]; const ni = idxOf(di ? -sx : sx, dj ? -sz : sz);
          B.mode = 'cross'; B.next = { block: nb, idx: ni }; B.wait = 0;
        } else B.target = (B.target + B.dir + 4) % 4;
      } else wish.set(dx / d, 0, dz / d);
    } else if (B.mode === 'cross') {
      const [tx, tz] = this.corner(B.next.block, B.next.idx); const dx = tx - ch.pos.x, dz = tz - ch.pos.z; const d = Math.hypot(dx, dz);
      // wait for a gap in traffic before stepping off the curb
      const onCurb = W.blockAt(ch.pos.x, ch.pos.z) === B.block;
      let carNear = false; if (onCurb) for (const car of g.cars) if (car.speed > 2 && Math.hypot(car.pos.x - (ch.pos.x + tx) / 2, car.pos.z - (ch.pos.z + tz) / 2) < 22) { carNear = true; break; }
      if (carNear) { B.wait += dt; if (B.wait > 7) { B.mode = 'walk'; B.target = (B.target + B.dir + 4) % 4; } }
      else if (d < 0.7) { B.block = B.next.block; B.target = (B.next.idx + B.dir + 4) % 4; B.mode = 'walk'; }
      else { wish.set(dx / d, 0, dz / d); sp *= 1.25; }
    }
    if (wish.lengthSq() > 0) { wish.normalize().multiplyScalar(sp); ch.faceToward(wish.x, wish.z, dt, ch.panic > 0 ? 14 : 8); }
    ch.move(dt, wish);
    ch.animate(dt);
    this.carHits(ch);
  }

  // cars vs people: knock over or nudge aside
  carHits(ch) {
    const g = this.game; if (ch.state === 'down' || ch.state === 'getup') return;
    for (const car of g.cars) {
      const dx = ch.pos.x - car.pos.x, dz = ch.pos.z - car.pos.z; if (dx * dx + dz * dz > 16) continue;
      const lx = dx * car.left.x + dz * car.left.z, lz = dx * car.fwd.x + dz * car.fwd.z; const r = 0.32;
      if (Math.abs(lx) > car.ex + r || Math.abs(lz) > car.ez + r) continue;
      const footY = ch.state === 'ragdoll' ? ch.pos.y - 0.9 : ch.pos.y; if (footY > car.pos.y - car.comH + car.type.H - 0.2) continue; // standing on the roof
      // point velocity of the car at the person. Only a car that is itself moving INTO the person knocks them over —
      // walking or sprinting into a parked car just bumps you off it.
      _v.crossVectors(car.angVel, _w.set(dx, 0, dz)).add(car.vel); const rel = Math.hypot(_v.x, _v.z);
      const dl = Math.hypot(dx, dz) || 1; const approach = (_v.x * dx + _v.z * dz) / dl;
      if (!car.sleeping && rel > 3.2 && approach > 2.2 && ch.state === 'walk') {
        const side = Math.sign(lx || 1) * 1.5; const kick = new V3(_v.x * 1.05 + car.left.x * side, 1.6 + rel * 0.26, _v.z * 1.05 + car.left.z * side);
        ch.knock(kick, 1); car.vel.multiplyScalar(0.985);
        g.onPersonHit(ch, car, rel);
      } else if (ch.state === 'walk') {
        // push out sideways
        const ox = car.ex + r - Math.abs(lx), oz = car.ez + r - Math.abs(lz);
        if (ox < oz) { ch.pos.x += car.left.x * Math.sign(lx) * ox; ch.pos.z += car.left.z * Math.sign(lx) * ox; } else { ch.pos.x += car.fwd.x * Math.sign(lz) * oz; ch.pos.z += car.fwd.z * Math.sign(lz) * oz; }
      }
    }
  }

  // ---------------- officers on foot ----------------
  spawnCop(car) {
    const g = this.game; const look = { skin: R.pick(SKIN), hair: 0x101830, shirt: 0x1b2a4a, pants: 0x121a2e, shoes: 0x111111, sleeve: 0x1b2a4a };
    const x = car.pos.x + car.left.x * (car.ex + 0.6), z = car.pos.z + car.left.z * (car.ex + 0.6);
    const ch = new Character(g, look, x, z, car.yaw); if (ch.slot == null) { ch.dispose(); return null; }
    ch.cop = true; ch.car = car; ch.health = 90; ch.brain = { mode: 'chase', speed: 4.9 }; this.cops.push(ch); car.officer = ch; return ch;
  }
  updateCops(dt) {
    const g = this.game, W = g.world;
    for (const ch of [...this.cops]) {
      if (ch.state !== 'walk') { ch.aimPose = false; ch.physicsRagdoll(dt); ch.animate(dt); this.carHits(ch); continue; }
      const car = ch.car && g.cars.includes(ch.car) && !ch.car.dead ? ch.car : null; const pc = g.player.char; const pp = pc.pos;
      const chase = !g.playerCar && g.wanted.stars > 0 && pc.state === 'walk' && g.state === 'play';
      let tx, tz, sp = ch.brain.speed; const wish = _w.set(0, 0, 0); ch.aimPose = false;
      if (chase) {
        const dx = pp.x - ch.pos.x, dz = pp.z - ch.pos.z; const d = Math.hypot(dx, dz);
        const shooting = g.wanted.stars >= 3 || ch.aggro;
        if (shooting) {
          if (!ch.gun) { ch.gun = g.weapons.takeCopGun(); if (!ch.handM) ch.handM = new THREE.Matrix4(); }
          const los = d < 42 && W.raycast(ch.pos.x, 1.45, ch.pos.z, pp.x, 1.45, pp.z) >= 1;
          if (los && d < 17) { // hold position and open fire
            ch.faceToward(dx, dz, dt, 14); ch.aimPose = true; ch.aimPitch = 0; ch.twoHand = false;
            ch.shootT = (ch.shootT ?? 0.7) - dt;
            if (ch.shootT <= 0) { ch.shootT = 0.75 + Math.random() * 0.7; const acc = clamp(0.55 - d * 0.018 - pc.speed * 0.035, 0.08, 0.55); g.weapons.npcShoot(g.weapons.muzzlePos(ch, ch.gun), acc, 7); }
          } else { wish.set(dx / (d || 1) * sp, 0, dz / (d || 1) * sp); ch.faceToward(dx, dz, dt, 12); }
        } else {
          if (d > 0.9) { wish.set(dx / d * sp, 0, dz / d * sp); ch.faceToward(dx, dz, dt, 12); }
          if (d < 1.4) { g.bustProgress(dt); ch.wave = 0.3; }
        }
      } else if (car) { // head back to the cruiser
        tx = car.pos.x + car.left.x * (car.ex + 0.5); tz = car.pos.z + car.left.z * (car.ex + 0.5); const dx = tx - ch.pos.x, dz = tz - ch.pos.z; const d = Math.hypot(dx, dz);
        if (d < 1.2) { this.removeCop(ch); continue; }
        wish.set(dx / d * sp, 0, dz / d * sp); ch.faceToward(dx, dz, dt, 12);
      } else { ch.lostT = (ch.lostT || 0) + dt; if (ch.lostT > 25 || !g.inView(ch.pos.x, ch.pos.z, 2)) { this.removeCop(ch); continue; } }
      ch.move(dt, wish, false, 14); ch.animate(dt); this.carHits(ch);
      if (Math.hypot(ch.pos.x - g.focus.x, ch.pos.z - g.focus.z) > 200) this.removeCop(ch);
    }
  }
  removeCop(ch) { const i = this.cops.indexOf(ch); if (i >= 0) this.cops.splice(i, 1); ch.gun = null; if (ch.car && ch.car.officer === ch) ch.car.officer = null; ch.dispose(); }
  clear() { for (const ch of [...this.list]) this.remove(ch); for (const c of [...this.cops]) this.removeCop(c); }
}
