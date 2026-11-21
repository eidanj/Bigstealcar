// Big Steal Car — third-person camera: on-foot orbit, chase cam with lag, hood cam, smooth hand-offs, shake, cinematic menu orbit.
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, smooth, wrapAngle } from './util.js';

const V3 = THREE.Vector3;
export class CameraRig {
  constructor(camera, game) {
    this.cam = camera; this.game = game; this.yaw = 0; this.pitch = 0.18; this.mode = 'foot'; this.view = 0; this.orbitT = 0; this.shakeA = 0;
    this.pos = new V3(0, 50, 0); this.look = new V3(); this.blend = 1; this.fromPos = new V3(); this.fromLook = new V3(); this.dist = 4.5; this.fov = 62; this.t = 0;
  }
  shake(a) { this.shakeA = Math.min(1.2, this.shakeA + a); }
  setMode(m) { if (m === this.mode) return; this.fromPos.copy(this.cam.position); this.fromLook.copy(this.look); this.blend = 0; this.mode = m; if (m === 'car') this.orbitT = 0; }
  update(dt, input, settings) {
    const g = this.game; const W = g.world; this.t += dt;
    let [mx, my] = input ? input.look() : [0, 0]; const sens = 0.0022 * settings.sens; if (settings.invertY) my = -my;
    const desired = new V3(), look = new V3(); let fov = settings.fov;
    if (this.mode === 'menu') {
      // slow crane shot on the sunlit (west) side of the skyline at golden hour
      const a = Math.PI + Math.sin(this.t * 0.045) * 0.6; const r = 300 + Math.sin(this.t * 0.03) * 40;
      desired.set(Math.cos(a) * r, 70 + Math.sin(this.t * 0.06) * 25, Math.sin(a) * r * 0.9); look.set(Math.sin(this.t * 0.02) * 40, 75, Math.cos(this.t * 0.025) * 30);
      fov = 50;
    } else if (this.mode === 'car' && g.playerCar) {
      const car = g.playerCar; const sp = car.speed;
      if (mx || my) { this.orbitT = 1.6; this.yaw -= mx * sens; this.pitch = clamp(this.pitch + my * sens, -0.25, 1.1); }
      const heading = Math.atan2(car.fwd.x, car.fwd.z); const velH = Math.atan2(car.vel.x, car.vel.z);
      let target = sp > 5 && car.vFwd > 1 ? heading + wrapAngle(velH - heading) * 0.35 : heading;
      if (car.vFwd < -2) target = heading; if (input && input.down('KeyC')) target += Math.PI;
      if (this.orbitT > 0) this.orbitT -= dt; else { this.yaw = dampAngle(this.yaw, target, 2.6 + sp * 0.06, dt); this.pitch = damp(this.pitch, 0.16, 2, dt); }
      const view = this.view % 3;
      if (view === 2) { // hood cam
        const p = new V3(0, Math.max(car.type.prof.beltH + 0.42, car.type.H - 0.02) - car.comH, car.type.prof.ws + 0.3).applyQuaternion(car.quat).add(car.pos);
        desired.copy(p); look.copy(p).addScaledVector(car.fwd, 20); look.y -= 1.2;
        this.cam.position.copy(desired); this.look.copy(look); this.blend = 1; fov += smooth(10, 70, sp) * 14; this.applyFov(fov, dt); this.cam.lookAt(look); return;
      }
      const dist = (car.type.L * 1.05 + 2.6) * (view === 1 ? 1.45 : 1) + sp * 0.035;
      const h = car.type.H * 0.6 + 1.05 + this.pitch * dist * 0.55;
      look.copy(car.pos).add(new V3(0, car.type.H * 0.55, 0)).addScaledVector(car.fwd, 0.6);
      desired.set(look.x - Math.sin(this.yaw) * Math.cos(this.pitch) * dist, car.pos.y + h, look.z - Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
      fov += smooth(10, 75, sp) * 13;
    } else {
      const ch = g.player.char; this.mode = 'foot';
      this.yaw -= mx * sens; this.pitch = clamp(this.pitch + my * sens, -0.55, 1.2);
      const base = ch.state === 'walk' ? ch.pos : ch.drawPos;
      const Wp = g.weapons; const aim = !!Wp && !Wp.w.melee && ch.state === 'walk' && (Wp.aiming || g.t - Wp.lastShot < 0.7);
      const inside = W.interiorAt(base.x, base.z);
      this.footDist = damp(this.footDist ?? 4.4, aim ? 2.3 : inside ? 3.0 : 4.4, 9, dt); this.shoulder = damp(this.shoulder ?? 0.45, aim ? 0.78 : 0.45, 9, dt);
      const dist = this.footDist;
      look.set(base.x, base.y + (aim ? 1.6 : 1.55), base.z);
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw); look.x += rx * this.shoulder; look.z += rz * this.shoulder;
      desired.set(look.x - Math.sin(this.yaw) * Math.cos(this.pitch) * dist, look.y + Math.sin(this.pitch) * dist, look.z - Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
      if (inside) desired.y = Math.min(desired.y, inside.roofY - 0.45);
      if (aim) fov -= Wp.aiming ? 14 : 6;
    }
    if (g.cinematic === 'busted' || g.cinematic === 'ko') { // slow orbit around the scene
      const c = g.focus; const a = this.t * 0.35; desired.set(c.x + Math.cos(a) * 9, c.y + 5, c.z + Math.sin(a) * 9); look.set(c.x, c.y + 0.8, c.z);
    }
    if (g.cinematic === 'spray') { const s = g.pickups.spray.g; desired.set(s.x + 9, 7, s.entrance[1] - 2); look.set(s.x, 3, s.z - 6); }
    // keep the camera out of buildings
    if (this.mode !== 'menu') {
      const f = W.raycast(look.x, look.y, look.z, desired.x, desired.y, desired.z, 0.35);
      if (f < 1) desired.lerpVectors(look, desired, Math.max(0.08, f - 0.04));
      const gy = W.ground(desired.x, desired.z) + 0.35; if (desired.y < gy) desired.y = gy;
    }
    // smooth follow (cars get a little spring lag)
    if (this.mode === 'car') { this.pos.x = damp(this.pos.x, desired.x, 14, dt); this.pos.y = damp(this.pos.y, desired.y, 9, dt); this.pos.z = damp(this.pos.z, desired.z, 14, dt); }
    else this.pos.copy(desired);
    if (this.blend < 1) { this.blend = Math.min(1, this.blend + dt / 0.75); const k = this.blend * this.blend * (3 - 2 * this.blend); this.cam.position.lerpVectors(this.fromPos, this.pos, k); this.look.lerpVectors(this.fromLook, look, k); }
    else { this.cam.position.copy(this.pos); this.look.copy(look); }
    if (this.mode === 'menu') { this.cam.position.copy(desired); this.look.copy(look); }
    // shake
    if (this.shakeA > 0.001) { const s = this.shakeA; this.cam.position.x += (Math.random() - 0.5) * s * 0.6; this.cam.position.y += (Math.random() - 0.5) * s * 0.4; this.shakeA *= Math.exp(-dt * 7); }
    this.applyFov(fov, dt);
    this.cam.lookAt(this.look);
  }
  applyFov(f, dt) { this.fov = damp(this.fov, f, 4, dt); if (Math.abs(this.cam.fov - this.fov) > 0.01) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); } }
  // world direction of camera forward on the ground plane
  get forward() { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }
}
void lerp;
