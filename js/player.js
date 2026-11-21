// Big Steal Car — the player: on-foot controls, entering/stealing cars, bailing out, health.
import * as THREE from 'three';
import { Character } from './humans.js';
import { clamp } from './util.js';

const V3 = THREE.Vector3; const _w = new V3();

export class Player {
  constructor(game, x, z, yaw) {
    this.game = game; this.health = 100; this.hurtT = 0; this.enterT = 0; this.target = null; this.carT = 0;
    this.char = new Character(game, { skin: 0xd9a066, hair: 0x1a1210, shirt: 0x2d6a4f, sleeve: 0x2d6a4f, pants: 0x1f2a44, shoes: 0xf1f1f1 }, x, z, yaw);
    this.char.onHardLanding = (v) => this.hurt((v - 14) * 7, 'fall');
  }
  hurt(n, why) {
    if (n <= 0 || this.game.state !== 'play') return;
    const W = this.game.weapons; if (W && W.armor > 0 && why !== 'fall') { const a = Math.min(W.armor, n * (why === 'shot' ? 0.75 : 0.5)); W.armor -= a; n -= a; } // body armor soaks most of it
    this.health -= n; this.hurtT = 0; this.game.hud.el.classList.remove('hurt'); void this.game.hud.el.offsetWidth; this.game.hud.el.classList.add('hurt');
    if (this.health <= 0) { this.health = 0; this.game.knockedOut(why); }
  }
  nearestCar() {
    const g = this.game; const p = this.char.pos; let best = null, bd = 1e9;
    for (const car of g.cars) {
      if (car.dead && car.health <= 0 && car.type.cls === 'x') continue;
      const dx = p.x - car.pos.x, dz = p.z - car.pos.z; const lx = dx * car.left.x + dz * car.left.z, lz = dx * car.fwd.x + dz * car.fwd.z;
      const ox = Math.max(0, Math.abs(lx) - car.ex), oz = Math.max(0, Math.abs(lz) - car.ez); const d = Math.hypot(ox, oz);
      if (d < 2.2 && d < bd && car.up.y > 0.4 && Math.abs(p.y - (car.pos.y - car.comH)) < 1.6) { bd = d; best = car; }
    }
    return best;
  }
  updateFoot(dt, input) {
    const g = this.game, ch = this.char;
    if (ch.state !== 'walk') { ch.physicsRagdoll(dt); ch.animate(dt); return; }
    if (this.enterT > 0) { // walking to the door
      const car = this.target; this.enterT -= dt;
      const door = car.pos.clone().addScaledVector(car.left, car.ex + 0.45).addScaledVector(car.fwd, car.type.prof.ws - 0.7);
      ch.pos.lerp(door, Math.min(1, dt * 10)); ch.faceToward(-car.left.x, -car.left.z, dt, 14); ch.speed = 1.5; ch.animate(dt);
      if (this.enterT <= 0 || !g.cars.includes(car)) { if (g.cars.includes(car)) g.enterCar(car); this.target = null; }
      return;
    }
    const [fx, fz] = g.rig.forward; const rx = -fz, rz = fx; const mx = input.moveX, my = input.moveY;
    const sprint = input.down('ShiftLeft', 'ShiftRight'); const aim = ch.aimPose || ch.punchT > 0;
    const sp = aim ? (g.weapons.aiming ? 2.4 : 3.4) : sprint ? 7.2 : 4.3; _w.set(fx * my + rx * mx, 0, fz * my + rz * mx); const l = _w.length();
    if (g.lockControls > 0) _w.set(0, 0, 0);
    else if (l > 0.05) { _w.multiplyScalar(sp * Math.min(1, l) / l); if (!aim) ch.faceToward(_w.x, _w.z, dt, 12); }
    ch.move(dt, _w, input.hit('Space') && g.lockControls <= 0);
    ch.animate(dt);
    // people knocking into us
    g.peds.carHits(ch);
    // gun store counter
    const st = g.world.interiorAt(ch.pos.x, ch.pos.z);
    if (st && Math.hypot(ch.pos.x - st.counter[0], ch.pos.z - st.counter[1]) < 2.6) {
      g.hud.prompt('[F] Shop at ~y~Blast Barn~w~'); if (input.hit('KeyF', 'KeyE') && g.lockControls <= 0) g.openShop(st);
      this.hurtT += dt; return;
    }
    // car prompt + enter
    const car = st ? null : this.nearestCar();
    if (car && g.lockControls <= 0) {
      const steal = car.driver && car.driver !== 'player'; const cop = car.role === 'police';
      g.hud.prompt(`[F] ${steal ? 'Jack' : cop ? 'Steal police' : 'Steal'} ${car.type.name}`);
      if (input.hit('KeyF', 'KeyE')) { this.target = car; this.enterT = 0.35; g.audio.door(); }
    } else g.hud.prompt('');
    // regen
    this.hurtT += dt; if (this.hurtT > 5 && this.health < 100) this.health = Math.min(100, this.health + dt * 3);
  }
  driveInput(dt, input, car) {
    const c = car.ctrl; const g = this.game;
    if (g.lockControls > 0) { c.throttle = 0; c.brake = g.missions.active && g.missions.active.stage === 'intro' ? 1 : c.brake; c.steer = 0; c.handbrake = false; return; }
    c.noReverse = false;
    const y = input.moveY; c.throttle = Math.max(0, y); c.brake = Math.max(0, -y);
    const sx = input.moveX; c.steer = sx; c.handbrake = input.down('Space');
    this.hurtT += dt; if (this.hurtT > 5 && this.health < 100) this.health = Math.min(100, this.health + dt * 3);
    void clamp;
  }
}
