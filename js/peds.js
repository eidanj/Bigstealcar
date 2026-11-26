// Big Steal Car — pedestrians walking sidewalk loops (they scatter from fast cars) and foot patrol officers.
import * as THREE from 'three';
import { CITY } from './config.js';
import { Character, SKIN, HAIR, SHIRT, PANTS } from './humans.js';
import { R, clamp } from './util.js';

// Pedestrians walk round sidewalk loops ("rings": one per block, two per block split by an avenue) and
// cross the street where the world says two ring corners face each other across a crossing.
const V3 = THREE.Vector3; const _w = new V3(), _v = new V3();

export function randomLook() {
  return { skin: R.pick(SKIN), hair: R.pick(HAIR), shirt: R.pick(SHIRT), pants: R.pick(PANTS), shoes: R.pick([0x222222, 0xf1f1f1, 0x6b4f3a, 0x3a3a3a]) };
}

export class Peds {
  constructor(game) { this.game = game; this.list = []; this.cops = []; this.timer = 0; }
  get walkers() { return this.list; }
  corner(r, i) { return r.pts[i]; }

  spawn(minD = 55, maxD = 150) {
    const g = this.game, W = g.world; const f = g.focus;
    for (let t = 0; t < 20; t++) {
      const b = W.rings[Math.floor(Math.random() * W.rings.length)]; const n = b.pts.length;
      const ci = Math.floor(Math.random() * n), cj = (ci + 1) % n; const [ax, az] = this.corner(b, ci), [bx, bz] = this.corner(b, cj); const u = Math.random();
      const x = ax + (bx - ax) * u, z = az + (bz - az) * u; const d = Math.hypot(x - f.x, z - f.z);
      if (d < minD || d > maxD) continue; if (g.inView(x, z, 2) && d < 110) continue;
      const naughty = Math.random() < 1 / 60; // the odd troublemaker: fights back, takes potshots at cruisers
      const look = naughty ? { ...randomLook(), shirt: R.pick([0x1d1f24, 0x2b0f12, 0x24301f]), sleeve: 0x16181c, pants: 0x14161a, hair: 0x111111 } : randomLook();
      const ch = new Character(g, look, x, z, 0); if (ch.slot == null) { ch.dispose(); return null; }
      ch.brain = { ring: b, target: cj, dir: 1, mode: 'walk', speed: R.range(1.15, 1.6), wait: 0 }; ch.health = naughty ? 80 : 60; ch.naughty = naughty;
      if (Math.random() < 0.5) { ch.brain.dir = -1; ch.brain.target = ci; }
      this.list.push(ch); return ch;
    }
    return null;
  }
  adopt(ch, panic = 4) { // a car-jacked driver becomes a pedestrian
    const b = this.nearestRing(ch.pos.x, ch.pos.z); ch.state = 'walk'; ch.visible = true; ch.scale = 1; ch.pos.y = this.game.world.ground(ch.pos.x, ch.pos.z);
    ch.brain = { ring: b, target: 0, dir: 1, mode: 'return', speed: R.range(1.2, 1.6), wait: 0 }; ch.panic = panic; ch.health = 60; ch.cop = false; this.list.push(ch); return ch;
  }
  nearestRing(x, z) { let best = null, bd = 1e9; for (const r of this.game.world.rings) for (const [px, pz] of r.pts) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < bd) { bd = d; best = r; } } return best; }
  remove(ch) { const i = this.list.indexOf(ch); if (i >= 0) this.list.splice(i, 1); ch.gun = null; ch.dispose(); }

  update(dt) {
    const g = this.game; const f = g.focus;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.4;
      for (const ch of [...this.list]) {
        const d = Math.hypot(ch.pos.x - f.x, ch.pos.z - f.z);
        if (ch.keep) continue;
        if (ch.surrender) { ch.surT = (ch.surT || 0) + 0.4; if ((ch.surT > 9 && !g.inView(ch.pos.x, ch.pos.z, 2)) || ch.surT > 45) { this.remove(ch); continue; } } // taken into custody
        if (d > 175 || (d > 120 && !g.inView(ch.pos.x, ch.pos.z, 2) && this.list.length > g.pedTarget)) this.remove(ch);
      }
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
    ch.phone = B.mode === 'call'; ch.surrender = B.mode === 'surrender';
    if (ch.state !== 'walk') { ch.aimPose = false; ch.physicsRagdoll(dt); if (ch.state === 'walk' && B.mode !== 'surrender') { if (ch.suspect) { B.mode = Math.random() < 0.6 ? 'surrender' : 'flee'; B.t = 0; ch.armed = false; ch.gun = null; } else { B.mode = 'return'; ch.panic = 2.5; } } ch.animate(dt); this.carHits(ch); return; }
    if (ch.punchT > 0) ch.punchT -= dt;
    if (B.mode === 'call' || B.mode === 'surrender') { // on the phone to the cops / hands up, waiting to be taken in
      const pp = g.player.char.pos; if (B.mode === 'call') ch.faceToward(pp.x - ch.pos.x, pp.z - ch.pos.z, dt, 5);
      ch.panic = 0; ch.move(dt, _w.set(0, 0, 0)); ch.animate(dt); this.carHits(ch); return;
    }
    if (ch.naughty && this.troublemaker(ch, dt)) return;
    // threats
    const th = this.threat(ch);
    if (th) { ch.panic = 2.2; B.flee = [-(th.vz) * Math.sign(th.lat || 1), (th.vx) * Math.sign(th.lat || 1)]; }
    let wish = _w.set(0, 0, 0); let sp = B.speed;
    if (ch.panic > 0) {
      ch.panic -= dt; sp = 5.2;
      if (B.flee) wish.set(B.flee[0], 0, B.flee[1]);
      else { const [tx, tz] = this.corner(B.ring, (B.target | 0) % B.ring.pts.length); wish.set(tx - ch.pos.x, 0, tz - ch.pos.z); }
      if (ch.panic <= 0) { B.mode = 'return'; B.flee = null; }
    } else if (B.mode === 'walk' || B.mode === 'return') {
      const n = B.ring.pts.length;
      if (B.mode === 'return') { // head to the closest corner of our loop
        let bd = 1e9; for (let i = 0; i < n; i++) { const [x, z] = this.corner(B.ring, i); const d = Math.hypot(x - ch.pos.x, z - ch.pos.z); if (d < bd) { bd = d; B.target = i; } } B.mode = 'walk';
      }
      const [tx, tz] = this.corner(B.ring, B.target); const dx = tx - ch.pos.x, dz = tz - ch.pos.z; const d = Math.hypot(dx, dz);
      if (d < 0.7) {
        // at a corner: maybe cross the street
        const opts = B.ring.links[B.target] || [];
        if (opts.length && Math.random() < 0.22) { B.mode = 'cross'; B.next = opts[Math.floor(Math.random() * opts.length)]; B.wait = 0; }
        else B.target = (B.target + B.dir + n) % n;
      } else wish.set(dx / d, 0, dz / d);
    } else if (B.mode === 'cross') {
      const [tx, tz] = this.corner(B.next.ring, B.next.idx); const dx = tx - ch.pos.x, dz = tz - ch.pos.z; const d = Math.hypot(dx, dz);
      // wait for a gap in traffic before stepping off the curb
      const onCurb = W.ground(ch.pos.x, ch.pos.z) > 0.05;
      let carNear = false; if (onCurb) for (const car of g.cars) if (car.speed > 2 && Math.hypot(car.pos.x - (ch.pos.x + tx) / 2, car.pos.z - (ch.pos.z + tz) / 2) < 22) { carNear = true; break; }
      if (carNear) { B.wait += dt; if (B.wait > 7) { B.mode = 'walk'; B.target = (B.target + B.dir + B.ring.pts.length) % B.ring.pts.length; } }
      else if (d < 0.7) { B.ring = B.next.ring; B.target = (B.next.idx + B.dir + B.ring.pts.length) % B.ring.pts.length; B.mode = 'walk'; }
      else { wish.set(dx / d, 0, dz / d); sp *= 1.25; }
    }
    if (wish.lengthSq() > 0) { wish.normalize().multiplyScalar(sp); ch.faceToward(wish.x, wish.z, dt, ch.panic > 0 ? 14 : 8); }
    ch.move(dt, wish);
    ch.animate(dt);
    this.carHits(ch);
  }

  // ---------------- troublemakers ----------------
  // returns true when it handled movement itself (fighting, shooting, running from the cops)
  troublemaker(ch, dt) {
    const g = this.game, W = g.world, B = ch.brain, pc = g.player.char; const wish = _w.set(0, 0, 0);
    ch.aimPose = false;
    if (B.mode === 'walk' || B.mode === 'return') {
      B.scanT = (B.scanT || 0) - dt; ch.ambushCD = Math.max(0, (ch.ambushCD || 0) - dt);
      if (B.scanT <= 0 && ch.ambushCD <= 0 && g.state === 'play') {
        B.scanT = 0.5;
        for (const car of g.cars) {
          if (car.role !== 'police' || car.dead || !car.driver || car === g.playerCar || (car.ai && car.ai.suspect)) continue;
          const d = Math.hypot(car.pos.x - ch.pos.x, car.pos.z - ch.pos.z);
          if (d > 6 && d < 26 && Math.random() < 0.2 && W.raycast(ch.pos.x, 1.4, ch.pos.z, car.pos.x, 1.1, car.pos.z) >= 1) { B.mode = 'ambush'; B.prey = car; B.shots = 3 + Math.floor(Math.random() * 3); B.shootT = 0.7; ch.armed = true; break; }
        }
      }
      return false;
    }
    const dpx = pc.pos.x - ch.pos.x, dpz = pc.pos.z - ch.pos.z, dp = Math.hypot(dpx, dpz);
    const gun = () => { if (!ch.gun) { ch.gun = g.weapons.takeGun(); if (!ch.handM) ch.handM = new THREE.Matrix4(); } };
    if (B.mode === 'fight') { // squaring up after being punched
      if (g.playerCar || pc.state !== 'walk' || dp > 30 || g.state !== 'play') { if (ch.suspect) { B.mode = 'flee'; B.t = 0; return true; } B.mode = 'return'; return false; }
      ch.faceToward(dpx, dpz, dt, 14);
      if (dp > 1.15) wish.set(dpx / dp * 4.6, 0, dpz / dp * 4.6);
      B.punchCD = (B.punchCD ?? 0.3) - dt;
      if (dp < 1.5 && B.punchCD <= 0) { ch.punchDur = 0.34; ch.punchT = 0.34; ch.punchArm = 1 - (ch.punchArm || 0); B.punchCD = 0.75 + Math.random() * 0.45; B.hitPending = true; g.audio.swing(false); }
      if (B.hitPending && ch.punchT < 0.34 * 0.55) { B.hitPending = false; if (dp < 1.7) { g.player.hurt(7, 'punch'); pc.vel.x += dpx / dp * 2.2; pc.vel.z += dpz / dp * 2.2; g.audio.punchHit(true, false); g.rig.shake(0.08); } }
      this.copsNotice(ch, dt);
    } else if (B.mode === 'shootback') { // you shot at them: they shoot back from cover distance
      B.t = (B.t || 0) + dt; const target = g.playerCar ? g.playerCar.pos : pc.pos;
      const dx = target.x - ch.pos.x, dz = target.z - ch.pos.z, d = Math.hypot(dx, dz);
      if (d > 45 || B.t > 25 || pc.state !== 'walk' && !g.playerCar || g.state !== 'play') { B.mode = 'flee'; B.t = 0; return true; }
      gun(); ch.faceToward(dx, dz, dt, 14); ch.aimPose = true; ch.aimPitch = 0; ch.twoHand = false;
      if (d < 7) wish.set(-dx / d * 3, 0, -dz / d * 3); else if (d > 16) wish.set(dx / d * 3.5, 0, dz / d * 3.5);
      B.shootT = (B.shootT ?? 0.8) - dt;
      if (B.shootT <= 0 && W.raycast(ch.pos.x, 1.45, ch.pos.z, target.x, 1.2, target.z) >= 1) { B.shootT = 0.9 + Math.random() * 0.6; g.weapons.npcShoot(g.weapons.muzzlePos(ch, ch.gun), clamp(0.4 - d * 0.015, 0.1, 0.4), 6); }
      this.copsNotice(ch, dt);
    } else if (B.mode === 'ambush') { // taking potshots at a cruiser, then legging it
      const car = B.prey;
      if (!car || !g.cars.includes(car) || car.dead) { B.mode = 'flee'; B.t = 0; return true; }
      gun(); const dx = car.pos.x - ch.pos.x, dz = car.pos.z - ch.pos.z; ch.faceToward(dx, dz, dt, 14); ch.aimPose = true; ch.aimPitch = -0.08; ch.twoHand = false;
      B.shootT -= dt;
      if (B.shootT <= 0) {
        B.shootT = 0.45 + Math.random() * 0.35; B.shots--;
        g.weapons.npcShootAt(g.weapons.muzzlePos(ch, ch.gun), car, 0.6, 7);
        if (!B.reported) { B.reported = true; this.becomeSuspect(ch, car, '~r~Someone opened fire on a police cruiser!~w~ The ~b~cops~w~ are going after them.'); }
        if (B.shots <= 0) { B.mode = 'flee'; B.t = 0; ch.ambushCD = 40; }
      }
    } else if (B.mode === 'harass') { // the crime a 911 call is about: roughing someone up, waving a gun, smashing things
      const v = B.victim && this.list.includes(B.victim) && B.victim.state === 'walk' ? B.victim : null; B.punchCD = (B.punchCD ?? 0.8) - dt;
      if (v) {
        const dx = v.pos.x - ch.pos.x, dz = v.pos.z - ch.pos.z, d = Math.hypot(dx, dz) || 1; ch.faceToward(dx, dz, dt, 8); if (d > 1.35) wish.set(dx / d * 1.4, 0, dz / d * 1.4);
        if (ch.armed) { gun(); ch.aimPose = true; ch.aimPitch = 0; ch.twoHand = false; }
        else if (d < 1.7 && B.punchCD <= 0) { ch.punchDur = 0.34; ch.punchT = 0.34; ch.punchArm = 1 - (ch.punchArm || 0); B.punchCD = 1.0 + Math.random() * 0.8; if (Math.hypot(g.focus.x - ch.pos.x, g.focus.z - ch.pos.z) < 40) g.audio.swing(false); if (Math.random() < 0.2) v.knock(new V3(dx / d * 2, 1.2, dz / d * 2), 0.4); }
      } else if (B.punchCD <= 0) { B.punchCD = 1.3 + Math.random(); ch.punchDur = 0.34; ch.punchT = 0.34; ch.punchArm = 1 - (ch.punchArm || 0); ch.yaw += (Math.random() - 0.5) * 1.5; }
      if (ch.suspect && ch.suspect.type === 'shots') { B.shotT = (B.shotT ?? 1) - dt; if (B.shotT <= 0) { B.shotT = 1.4 + Math.random() * 2.2; gun(); const m = g.weapons.muzzlePos(ch, ch.gun); g.weapons.flash(m, 0.8); g.audio.gun('pistol', m, 0.9); for (const p of this.list) if (p !== ch && p.state === 'walk' && !p.naughty && p.brain.mode !== 'call' && Math.hypot(p.pos.x - ch.pos.x, p.pos.z - ch.pos.z) < 30) { p.panic = 4; p.brain.flee = [p.pos.x - ch.pos.x, p.pos.z - ch.pos.z]; } } ch.aimPose = true; ch.aimPitch = -0.6; }
    } else if (B.mode === 'flee') { // run from the nearest cop
      B.t = (B.t || 0) + dt; let fx = 0, fz = 0, nd = 1e9;
      for (const c of g.cars) if (c.role === 'police' && !c.dead) { const d = Math.hypot(c.pos.x - ch.pos.x, c.pos.z - ch.pos.z); if (d < nd) { nd = d; fx = ch.pos.x - c.pos.x; fz = ch.pos.z - c.pos.z; } }
      for (const c of this.cops) { const d = Math.hypot(c.pos.x - ch.pos.x, c.pos.z - ch.pos.z); if (d < nd) { nd = d; fx = ch.pos.x - c.pos.x; fz = ch.pos.z - c.pos.z; } }
      if (g.police && g.police.onDuty) { const pp = g.playerTarget(); const d = Math.hypot(pp.x - ch.pos.x, pp.z - ch.pos.z); if (d < nd) { nd = d; fx = ch.pos.x - pp.x; fz = ch.pos.z - pp.z; } }
      if (nd > 70 && B.t > 6) { B.mode = 'return'; ch.panic = 0; return false; }
      const fl = Math.hypot(fx, fz) || 1; wish.set(fx / fl * 5.3, 0, fz / fl * 5.3);
      // don't run straight into a wall: slide along it
      if (W.blocked(ch.pos.x + wish.x * 0.5, ch.pos.z + wish.z * 0.5, 0.3)) wish.set(-wish.z, 0, wish.x);
      ch.faceToward(wish.x, wish.z, dt, 12);
    } else return false;
    ch.move(dt, wish, false, 14); ch.animate(dt); this.carHits(ch); return true;
  }
  // a cop who can see the troublemaker brawling goes after them
  copsNotice(ch, dt) {
    ch.noticeT = (ch.noticeT || 0) - dt; if (ch.noticeT > 0 || ch.wantedBy) return; ch.noticeT = 1;
    for (const car of this.game.cars) if (car.role === 'police' && !car.dead && car.driver && car.ai && !car.ai.suspect && Math.hypot(car.pos.x - ch.pos.x, car.pos.z - ch.pos.z) < 60) { this.becomeSuspect(ch, car, 'A ~b~patrol car~w~ spotted the brawl.'); return; }
  }
  becomeSuspect(ch, car, msg) {
    const g = this.game; let n = 0;
    if (car && car.ai && car.ai.setSuspect && car.ai.setSuspect({ ch })) n++;
    for (const c of g.cars) { if (n >= 2) break; if (c === car || c.role !== 'police' || c.dead || !c.ai || !c.ai.setSuspect || c.ai.suspect) continue; if (Math.hypot(c.pos.x - ch.pos.x, c.pos.z - ch.pos.z) < 110 && c.ai.setSuspect({ ch })) n++; }
    if (n) { ch.wantedBy = true; if (Math.hypot(g.focus.x - ch.pos.x, g.focus.z - ch.pos.z) < 110) g.hud.help(msg, 3); }
  }
  // the player hit a troublemaker: they don't run, they fight
  provoked(ch, melee) { if (!ch.naughty || ch.state !== 'walk' || ch.brain.mode === 'surrender') return; ch.panic = 0; ch.brain.flee = null; ch.brain.mode = melee && !ch.armed ? 'fight' : 'shootback'; ch.brain.t = 0; if (!melee) ch.armed = true; }

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
  spawnCop(car, target = null) {
    const g = this.game; const look = { skin: R.pick(SKIN), hair: 0x101830, shirt: 0x1b2a4a, pants: 0x121a2e, shoes: 0x111111, sleeve: 0x1b2a4a };
    const side = target ? Math.sign((target.pos.x - car.pos.x) * car.left.x + (target.pos.z - car.pos.z) * car.left.z) || 1 : 1; // get out on the suspect's side
    const x = car.pos.x + car.left.x * side * (car.ex + 0.6), z = car.pos.z + car.left.z * side * (car.ex + 0.6);
    const ch = new Character(g, look, x, z, car.yaw); if (ch.slot == null) { ch.dispose(); return null; }
    ch.cop = true; ch.car = car; ch.health = 90; ch.brain = { mode: 'chase', speed: 4.9 }; ch.target = target; this.cops.push(ch); car.officer = ch; return ch;
  }
  updateCops(dt) {
    const g = this.game, W = g.world;
    for (const ch of [...this.cops]) {
      if (ch.state !== 'walk') { ch.aimPose = false; ch.physicsRagdoll(dt); ch.animate(dt); this.carHits(ch); continue; }
      const car = ch.car && g.cars.includes(ch.car) && !ch.car.dead ? ch.car : null; const pc = g.player.char; const pp = pc.pos;
      // (a 911 suspect with their hands up, or flat on the ground, still has to be walked over to and cuffed)
      const T = ch.target; const sus = T && this.list.includes(T) && !T.cuffed && !T.detained && (T.state === 'walk' ? T.brain.mode !== 'surrender' || T.suspect : !!T.suspect) ? T : null;
      if (ch.target && !sus) ch.target = null;
      const chase = !sus && !g.playerCar && g.wanted.stars > 0 && pc.state === 'walk' && g.state === 'play';
      let tx, tz, sp = ch.brain.speed; const wish = _w.set(0, 0, 0); ch.aimPose = false;
      if (sus || chase) ch.backT = 0;
      if (sus) { // running down an NPC suspect: shoot if they're armed and shooting, otherwise tackle and cuff
        const dx = sus.pos.x - ch.pos.x, dz = sus.pos.z - ch.pos.z; const d = Math.hypot(dx, dz);
        const armed = sus.state === 'walk' && sus.armed && (sus.brain.mode === 'ambush' || sus.brain.mode === 'shootback');
        if (armed && d < 18 && W.raycast(ch.pos.x, 1.45, ch.pos.z, sus.pos.x, 1.3, sus.pos.z) >= 1) {
          if (!ch.gun) { ch.gun = g.weapons.takeGun(); if (!ch.handM) ch.handM = new THREE.Matrix4(); }
          ch.faceToward(dx, dz, dt, 14); ch.aimPose = true; ch.aimPitch = 0; ch.twoHand = false; ch.shootT = (ch.shootT ?? 0.7) - dt;
          if (ch.shootT <= 0) { ch.shootT = 0.8 + Math.random() * 0.6; g.weapons.npcShootAt(g.weapons.muzzlePos(ch, ch.gun), sus, 0.45, 26); }
        } else {
          const run = sus.suspect ? 6.1 : 5.2; // a touch quicker than a fleeing suspect, or foot chases never end
          if (sus.suspect && d > 32 && sus.state === 'walk') { ch.target = null; continue; } // they've pulled away: back to the cruiser to give chase in that
          if (d > 0.9) { const [wx, wz] = this.aroundCars(ch, dx / d, dz / d); wish.set(wx * run, 0, wz * run); ch.faceToward(wish.x, wish.z, dt, 12); }
          if (d < 1.4) { // busted
            sus.brain.mode = 'surrender'; sus.surrender = true; sus.armed = false; sus.gun = null; sus.aimPose = false; sus.panic = 0; sus.detained = true; ch.target = null; ch.wave = 0.4;
            if (!sus.suspect && Math.hypot(g.focus.x - sus.pos.x, g.focus.z - sus.pos.z) < 90) g.hud.help('~b~Police~w~ arrested the suspect.', 2.5);
          }
        }
      } else if (chase) {
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
        const dc = Math.hypot(car.pos.x - ch.pos.x, car.pos.z - ch.pos.z); ch.backT = (ch.backT || 0) + dt;
        if (d < 1.2 || dc < Math.max(car.ex, car.ez) + 0.9 || (ch.backT > 6 && dc < 9)) { this.removeCop(ch); continue; } // back at the car (either side; or near enough and snagged on something)
        const [wx, wz] = this.aroundCars(ch, dx / d, dz / d); wish.set(wx * sp, 0, wz * sp); ch.faceToward(wish.x, wish.z, dt, 12);
      } else { ch.lostT = (ch.lostT || 0) + dt; if (ch.lostT > 25 || !g.inView(ch.pos.x, ch.pos.z, 2)) { this.removeCop(ch); continue; } }
      ch.move(dt, wish, false, 14); ch.animate(dt); this.carHits(ch);
      if (Math.hypot(ch.pos.x - g.focus.x, ch.pos.z - g.focus.z) > 200) this.removeCop(ch);
    }
  }
  // walking toward something with a car in the way: sidestep round it instead of pushing into the bodywork
  aroundCars(ch, ux, uz) {
    for (const car of this.game.cars) {
      const px = ch.pos.x + ux * 0.9 - car.pos.x, pz = ch.pos.z + uz * 0.9 - car.pos.z; if (px * px + pz * pz > 36) continue;
      if (Math.abs(px * car.left.x + pz * car.left.z) > car.ex + 0.4 || Math.abs(px * car.fwd.x + pz * car.fwd.z) > car.ez + 0.4) continue;
      let sx = -uz, sz = ux; if (sx * (car.pos.x - ch.pos.x) + sz * (car.pos.z - ch.pos.z) > 0) { sx = -sx; sz = -sz; }
      const l = Math.hypot(sx + ux * 0.25, sz + uz * 0.25) || 1; return [(sx + ux * 0.25) / l, (sz + uz * 0.25) / l];
    }
    return [ux, uz];
  }
  removeCop(ch) { const i = this.cops.indexOf(ch); if (i >= 0) this.cops.splice(i, 1); ch.gun = null; if (ch.car && ch.car.officer === ch) ch.car.officer = null; ch.dispose(); }
  clear() { for (const ch of [...this.list]) this.remove(ch); for (const c of [...this.cops]) this.removeCop(c); }
}
