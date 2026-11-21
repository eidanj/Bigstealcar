// Big Steal Car — weapons: fists, bat and guns for the player, police return fire, tracers, muzzle flashes, the gun store.
// Teen rating: anyone who takes too many hits is knocked out (dizzy stars), then gets up and runs off. No blood.
import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, ARMOR_PRICE } from './config.js';
import { clamp } from './util.js';
import * as TX from './textures.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _off = new THREE.Matrix4();

const MAT = {};
function mats() {
  if (MAT.metal) return MAT;
  MAT.metal = new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.85, roughness: 0.32 });
  MAT.grip = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.7 });
  MAT.wood = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.6 });
  MAT.bat = new THREE.MeshStandardMaterial({ color: 0xc8935a, roughness: 0.55 });
  return MAT;
}
function part(g, geo, mat, x, y, z, rx = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; }
const cylZ = (r, l) => new THREE.CylinderGeometry(r, r, l, 10).rotateX(Math.PI / 2);
// procedural weapon models, barrel along +Z, grip at the origin
export function weaponModel(key) {
  const M = mats(); const g = new THREE.Group(); let muzzle = 0.2;
  if (key === 'pistol') { part(g, new THREE.BoxGeometry(0.045, 0.05, 0.22), M.metal, 0, 0.045, 0.08); part(g, new THREE.BoxGeometry(0.04, 0.12, 0.05), M.grip, 0, -0.03, 0, -0.25); muzzle = 0.2; }
  else if (key === 'smg') { part(g, new THREE.BoxGeometry(0.06, 0.08, 0.3), M.metal, 0, 0.045, 0.1); part(g, cylZ(0.013, 0.12), M.metal, 0, 0.05, 0.31); part(g, new THREE.BoxGeometry(0.03, 0.17, 0.045), M.grip, 0, -0.07, 0.13); part(g, new THREE.BoxGeometry(0.04, 0.1, 0.04), M.grip, 0, -0.03, -0.01); part(g, new THREE.BoxGeometry(0.03, 0.04, 0.18), M.grip, 0, 0.03, -0.13); muzzle = 0.37; }
  else if (key === 'shotgun') { part(g, cylZ(0.021, 0.62), M.metal, 0, 0.06, 0.3); part(g, cylZ(0.017, 0.45), M.metal, 0, 0.022, 0.26); part(g, new THREE.BoxGeometry(0.055, 0.055, 0.16), M.wood, 0, 0.022, 0.3); part(g, new THREE.BoxGeometry(0.055, 0.08, 0.18), M.metal, 0, 0.04, -0.02); part(g, new THREE.BoxGeometry(0.05, 0.1, 0.32), M.wood, 0, 0.0, -0.24, 0.12); muzzle = 0.61; }
  else if (key === 'rifle') { part(g, new THREE.BoxGeometry(0.055, 0.09, 0.38), M.metal, 0, 0.045, 0.08); part(g, cylZ(0.014, 0.34), M.metal, 0, 0.055, 0.42); part(g, new THREE.BoxGeometry(0.036, 0.18, 0.06), M.grip, 0, -0.08, 0.13, 0.22); part(g, new THREE.BoxGeometry(0.045, 0.085, 0.26), M.grip, 0, 0.03, -0.21); part(g, new THREE.BoxGeometry(0.026, 0.045, 0.09), M.grip, 0, 0.115, 0.06); part(g, new THREE.BoxGeometry(0.04, 0.1, 0.04), M.grip, 0, -0.03, -0.02); muzzle = 0.59; }
  else if (key === 'bat') { const b = part(g, new THREE.CylinderGeometry(0.042, 0.018, 0.86, 12), M.bat, 0, 0, 0.36); b.rotation.x = Math.PI / 2; muzzle = 0.8; }
  g.userData.muzzle = muzzle; g.matrixAutoUpdate = false; g.visible = false;
  return g;
}
function raySphere(o, d, c, r) { _a.subVectors(c, o); const t = _a.dot(d); if (t < 0) return -1; const d2 = _a.lengthSq() - t * t; if (d2 > r * r) return -1; return t - Math.sqrt(r * r - d2); }

export class Weapons {
  constructor(game, saved = {}) {
    this.g = game; const s = saved || {};
    this.owned = Object.assign({ fists: true }, s.owned || {});
    this.ammo = {}; for (const k in WEAPONS) if (!WEAPONS[k].melee) this.ammo[k] = { mag: (s.ammo && s.ammo[k] && s.ammo[k].mag) || 0, res: (s.ammo && s.ammo[k] && s.ammo[k].res) || 0 };
    this.armor = s.armor || 0; this.cur = this.owned[s.cur] ? s.cur : 'fists';
    this.cool = 0; this.reloadT = 0; this.bloom = 0; this.lastShot = -9; this.aiming = false; this.punchHit = true; this.hitT = 0;
    const sc = game.scene;
    this.models = {}; for (const k of ['bat', 'pistol', 'smg', 'shotgun', 'rifle']) { this.models[k] = weaponModel(k); sc.add(this.models[k]); }
    this.copGuns = []; for (let i = 0; i < 14; i++) { const m = weaponModel('pistol'); sc.add(m); this.copGuns.push(m); }
    // tracers
    this.maxTr = 64; this.tr = Array.from({ length: this.maxTr }, () => ({ life: 0 })); this.trI = 0;
    const tg = new THREE.BufferGeometry(); this.trPos = new Float32Array(this.maxTr * 6); this.trCol = new Float32Array(this.maxTr * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(this.trCol, 3)); this.trGeo = tg;
    const lines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); lines.frustumCulled = false; sc.add(lines);
    // muzzle flashes
    const dot = TX.softDot(); this.flashes = Array.from({ length: 6 }, () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: new THREE.Color(5, 3.2, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sp.visible = false; sc.add(sp); return { sp, life: 0 }; });
    this.flashI = 0; this.flashLight = new THREE.PointLight(0xffb060, 0, 9, 2); sc.add(this.flashLight); this.flashLightT = 0;
    _off.compose(new V3(0, -0.04, 0.03), new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2), new V3(1.6, 1.6, 1.6));
  }
  get w() { return WEAPONS[this.cur]; }
  save() { return { owned: this.owned, ammo: this.ammo, armor: Math.round(this.armor), cur: this.cur }; }
  select(k) {
    if (!this.owned[k] || k === this.cur) return; this.cur = k; this.reloadT = 0; this.cool = 0.25; this.g.audio.equip(); this.g.hud.weapon(true);
  }
  cycle(dir) { const list = WEAPON_ORDER.filter((k) => this.owned[k]); const i = list.indexOf(this.cur); this.select(list[(i + dir + list.length) % list.length]); }
  reload() {
    const w = this.w; if (w.melee) return; const a = this.ammo[this.cur]; if (a.mag >= w.mag || a.res <= 0 || this.reloadT > 0) return;
    this.reloadT = this.cur === 'shotgun' ? 1.7 : this.cur === 'rifle' ? 1.9 : this.cur === 'smg' ? 1.5 : 1.2; this.g.audio.reload();
  }
  finishReload() { const w = this.w; if (w.melee) return; const a = this.ammo[this.cur]; const take = Math.min(w.mag - a.mag, a.res); a.mag += take; a.res -= take; }

  // ---------- shop ----------
  buy(item) {
    const g = this.g;
    if (item === 'armor') { if (this.armor >= 100) return 'Armor already full.'; if (g.cash < ARMOR_PRICE) return 'Not enough cash.'; g.addCash(-ARMOR_PRICE); this.armor = 100; g.audio.register(); g.saveGame(); return 'ok'; }
    const w = WEAPONS[item]; if (!w) return 'Unknown item.';
    if (!this.owned[item]) {
      if (g.cash < w.price) return 'Not enough cash.';
      g.addCash(-w.price); this.owned[item] = true; if (!w.melee) { this.ammo[item].mag = w.mag; this.ammo[item].res = w.start - w.mag; }
      this.cur = item; g.audio.register(); g.hud.weapon(true); g.saveGame(); return 'ok';
    }
    if (w.melee) return 'You already own this.';
    const [n, price] = w.ammo; if (g.cash < price) return 'Not enough cash.';
    if (this.ammo[item].res >= 999) return 'You cannot carry any more.';
    g.addCash(-price); this.ammo[item].res = Math.min(999, this.ammo[item].res + n); g.audio.register(); g.saveGame(); return 'ok';
  }

  // ---------- per frame ----------
  update(dt, input) {
    const g = this.g; const ch = g.player.char; const play = g.state === 'play';
    const onFoot = play && !g.playerCar && ch.state === 'walk' && ch.visible;
    this.cool -= dt; this.bloom = Math.max(0, this.bloom - dt * 2.2); this.hitT -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { this.finishReload(); g.hud.weapon(); } }
    if (ch.punchT > 0) { ch.punchT -= dt; if (!this.punchHit && ch.punchT < ch.punchDur * 0.55) { this.punchHit = true; this.meleeHit(); } }
    if (onFoot && g.lockControls <= 0 && input) {
      for (const k of WEAPON_ORDER) if (input.hit('Digit' + WEAPONS[k].slot)) this.select(k);
      if (input.wheel) { this.cycle(Math.sign(input.wheel)); input.wheel = 0; }
      if (input.hit('KeyX')) this.cycle(1);
      if (input.hit('KeyR')) this.reload();
      const w = this.w; this.aiming = !w.melee && input.down('Mouse2');
      const trigger = w.auto ? input.down('Mouse0') : input.hit('Mouse0');
      if (trigger && this.cool <= 0) {
        if (w.melee) this.punch();
        else if (this.reloadT <= 0) {
          const a = this.ammo[this.cur];
          if (a.mag > 0) { this.shoot(); a.mag--; this.cool = w.rate; if (a.mag === 0 && a.res > 0) this.reload(); g.hud.weapon(); }
          else if (a.res > 0) this.reload(); else { g.audio.empty(); this.cool = 0.3; g.hud.help('Out of ammo. Buy more at a ~y~Blast Barn~w~ gun store.', 2); }
        }
      }
    } else { this.aiming = false; if (input) input.wheel = 0; }
    // pose
    const gun = !this.w.melee;
    ch.aimPose = onFoot && gun && (this.aiming || g.t - this.lastShot < 1.3);
    ch.twoHand = this.cur === 'smg' || this.cur === 'shotgun' || this.cur === 'rifle';
    ch.aimPitch = clamp(-g.rig.pitch * 1.1, -0.9, 0.9);
    if (ch.aimPose) ch.yaw = g.rig.yaw;
    if (!ch.handM) ch.handM = new THREE.Matrix4();
    this.fx(dt);
  }
  // after the humans have been posed: put guns in hands
  postDraw() {
    const g = this.g; const ch = g.player.char; const show = !g.playerCar && ch.visible && ch.state === 'walk' && this.cur !== 'fists';
    for (const k in this.models) { const m = this.models[k]; m.visible = show && k === this.cur; if (m.visible) { m.matrix.multiplyMatrices(ch.handM, _off); m.matrixWorldNeedsUpdate = true; } }
    for (const m of this.copGuns) m.visible = false;
    for (const list of [g.peds.cops, g.peds.list]) for (const c of list) if (c.gun && c.handM && c.state === 'walk' && c.visible) { c.gun.visible = true; c.gun.matrix.multiplyMatrices(c.handM, _off); c.gun.matrixWorldNeedsUpdate = true; }
  }
  takeGun() { const P2 = this.g.peds; return this.copGuns.find((m) => !P2.cops.some((c) => c.gun === m) && !P2.list.some((c) => c.gun === m)) || null; }
  takeCopGun() { return this.takeGun(); }
  muzzlePos(ch = this.g.player.char, model = this.models[this.cur]) {
    if (!model || !ch.handM) return ch.pos.clone().add(new V3(0, 1.4, 0));
    return new V3(0, 0, model.userData.muzzle).applyMatrix4(_m.multiplyMatrices(ch.handM, _off));
  }

  // ---------- player shooting ----------
  shoot() {
    const g = this.g; const w = this.w; const cam = g.camera; const ch = g.player.char;
    this.lastShot = g.t;
    const o = cam.position.clone(); const dir = new V3(); cam.getWorldDirection(dir);
    if (g.touch) { const a = this.assist(o, dir, w.range); if (a) dir.lerp(a, 0.85).normalize(); } // thumbs aren't mice: nudge toward a target near the crosshair
    const chest = ch.pos.clone().add(new V3(0, 1.3, 0)); const tMin = Math.max(0, chest.sub(o).dot(dir)) + 0.3;
    const muzzle = this.muzzlePos(); const moving = ch.speed > 1 ? 0.012 : 0;
    for (let i = 0; i < (w.pellets || 1); i++) {
      const sp = w.spread + this.bloom * 0.035 + moving;
      const d = dir.clone().add(new V3((Math.random() - 0.5) * 2 * sp, (Math.random() - 0.5) * 2 * sp, (Math.random() - 0.5) * 2 * sp)).normalize();
      const hit = this.raycast(o, d, tMin, w.range, ch);
      const end = hit ? hit.point : o.clone().addScaledVector(d, w.range);
      this.tracer(muzzle, end, i === 0 || Math.random() < 0.4);
      if (hit) this.applyHit(hit, d, w.dmg, true);
    }
    this.bloom = Math.min(1, this.bloom + (w.auto ? 0.16 : 0.35));
    g.rig.pitch -= this.cur === 'shotgun' ? 0.03 : this.cur === 'rifle' ? 0.006 : 0.01; g.rig.shake(this.cur === 'shotgun' ? 0.12 : 0.03);
    this.flash(muzzle, this.cur === 'shotgun' ? 1.6 : 1); g.audio.gun(this.cur, muzzle);
    // witnesses + panic
    g.wanted.crime(5, g.wanted.stars === 0 ? '~r~Shots fired!~w~ The cops heard that.' : null, { type: 'shots' });
    for (const p of g.peds.list) { const dd = Math.hypot(p.pos.x - ch.pos.x, p.pos.z - ch.pos.z); if (dd < 45 && p.state === 'walk' && !p.naughty && p.brain.mode !== 'call') { p.panic = 4 + Math.random() * 3; p.brain.flee = [p.pos.x - ch.pos.x, p.pos.z - ch.pos.z]; } }
    for (const c of g.cars) if (c.ai && c.ai.cruise && Math.hypot(c.pos.x - ch.pos.x, c.pos.z - ch.pos.z) < 35) c.ai.panicT = 9;
  }
  assist(o, dir, range) {
    const g = this.g; let best = null, bc = Math.cos(0.13); const v = new V3();
    for (const t of this.targets()) {
      if (t.state !== 'walk' || !t.visible) continue; v.set(t.pos.x - o.x, t.pos.y + 1.2 - o.y, t.pos.z - o.z); const d = v.length(); if (d < 1.5 || d > range) continue;
      const c = v.dot(dir) / d; if (c > bc && g.world.raycast(o.x, o.y, o.z, t.pos.x, t.pos.y + 1.2, t.pos.z) >= 1) { bc = c; best = v.clone().divideScalar(d); }
    }
    return best;
  }
  targets() { const g = this.g; const t = this._t || (this._t = []); t.length = 0; for (const p of g.peds.list) t.push(p); for (const c of g.peds.cops) t.push(c); return t; }
  raycast(o, d, tMin, tMax, ignore) {
    const g = this.g; let best = { t: tMax, kind: null };
    for (const ch of this.targets()) {
      if (ch === ignore || !ch.visible || ch.slot == null) continue;
      _b.subVectors(ch.pos, o); const along = _b.dot(d); if (along < tMin - 1 || along > best.t + 1) continue;
      const sc = ch.scale || 1; let spheres;
      if (ch.state === 'walk') spheres = [[1.64 * sc, 0.17, true], [1.15 * sc, 0.31, false], [0.55 * sc, 0.24, false]];
      else spheres = [[0, 0.55, false]];
      for (const [hy, r, head] of spheres) { _c.copy(ch.pos); _c.y += hy; const t = raySphere(o, d, _c, r); if (t > tMin && t < best.t) best = { t, kind: 'char', ch, head }; }
    }
    for (const car of g.cars) {
      _b.subVectors(car.pos, o); const along = _b.dot(d); if (along < tMin - 4 || along > best.t + 4) continue;
      const perp = _b.addScaledVector(d, -along).length(); if (perp > car.radius + 1) continue;
      _q.copy(car.quat).invert(); const lo = _a.subVectors(o, car.pos).applyQuaternion(_q); const ld = _c.copy(d).applyQuaternion(_q);
      const mn = [-car.ex, car.cy - car.ey, -car.ez], mx = [car.ex, car.cy + car.ey, car.ez], oo = [lo.x, lo.y, lo.z], dd = [ld.x, ld.y, ld.z];
      let t0 = 0, t1 = 1e9, ok = true;
      for (let k = 0; k < 3 && ok; k++) { if (Math.abs(dd[k]) < 1e-9) { if (oo[k] < mn[k] || oo[k] > mx[k]) ok = false; } else { let ta = (mn[k] - oo[k]) / dd[k], tb = (mx[k] - oo[k]) / dd[k]; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) ok = false; } }
      if (ok && t0 > tMin && t0 < best.t) best = { t: t0, kind: 'car', car };
    }
    // knockable props (vertical cylinders)
    const end = o.clone().addScaledVector(d, best.t); const list = this._pl || (this._pl = []);
    g.world.query(Math.min(o.x, end.x) - 1, Math.min(o.z, end.z) - 1, Math.max(o.x, end.x) + 1, Math.max(o.z, end.z) + 1, list);
    for (const c of list) {
      if (c.k !== 1 || !c.prop || c.dead) continue;
      const fx = d.x, fz = d.z, ox = o.x - c.x, oz = o.z - c.z; const A = fx * fx + fz * fz; if (A < 1e-6) continue; const B = 2 * (ox * fx + oz * fz), C = ox * ox + oz * oz - c.r * c.r; const disc = B * B - 4 * A * C; if (disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / (2 * A); if (t <= tMin || t >= best.t) continue; const y = o.y + d.y * t; if (y < c.y0 || y > c.y1) continue;
      best = { t, kind: 'prop', prop: c.prop };
    }
    // buildings
    const e2 = o.clone().addScaledVector(d, best.t); const f = g.world.raycast(o.x, o.y, o.z, e2.x, e2.y, e2.z);
    if (f < 1 && f * best.t > tMin) best = { t: f * best.t, kind: 'wall' };
    // ground
    if (d.y < -1e-3) { let t = (o.y - 0.1) / -d.y; const p = o.clone().addScaledVector(d, t); const gy = g.world.ground(p.x, p.z); t = (o.y - gy) / -d.y; if (t > tMin && t < best.t) best = { t, kind: 'ground' }; }
    if (!best.kind) return null; best.point = o.clone().addScaledVector(d, best.t); return best;
  }
  applyHit(hit, d, dmg, byPlayer) {
    const g = this.g; const fx = g.effects; const p = hit.point;
    if (hit.kind === 'char') {
      this.damageChar(hit.ch, dmg * (hit.head ? 1.8 : 1), d, byPlayer, false);
      fx.glow.emit(p.x, p.y, p.z, 0, 0.4, 0, 0.18, 1.6, 1.5, 3, 2.6, 1.4, 0.9); fx.smokeAt(p.x, p.y, p.z, d.x, 0.5, d.z, 0.35, 0.95, 0.35, 0.5);
      if (byPlayer) { this.hitT = 0.15; g.hud.hitMarker(hit.head); g.audio.hitBody(p); }
    } else if (hit.kind === 'car') {
      hit.car.dent(p, d, dmg * 1.5); fx.sparksAt(p, 5, d.clone().negate(), 4, 0.9); if (Math.random() < 0.35) g.audio.ricochet(p); else g.audio.clank(p);
      if (hit.car.ai && hit.car.ai.cruise) hit.car.ai.panicT = 10; hit.car.wake();
      if (byPlayer && hit.car.driver === 'ai') g.wanted.crime(hit.car.role === 'police' ? 8 : 2, null, { direct: hit.car.role === 'police', type: 'shootcar', victim: hit.car, x: p.x, z: p.z });
    } else if (hit.kind === 'prop') {
      g.props.hit(hit.prop, d.x * 16, d.z * 16, 16, 500); fx.sparksAt(p, 3, null, 3, 0.7);
    } else {
      fx.sparksAt(p, hit.kind === 'wall' ? 4 : 2, null, 3, 0.7); fx.smokeAt(p.x, p.y, p.z, 0, 0.3, 0, 0.3, 0.8, 0.4, 0.8); if (Math.random() < 0.25) g.audio.ricochet(p);
    }
  }
  damageChar(ch, dmg, dir, byPlayer, melee) {
    const g = this.g; if (ch.state === 'down' || ch.state === 'getup') { if (ch.state === 'down') ch.downT = Math.min(ch.downT, 0.6); return; }
    if (ch.health == null) ch.health = ch.cop ? 90 : 60;
    ch.health -= dmg; const cop = ch.cop;
    if (byPlayer && cop) ch.aggro = true;
    if (byPlayer && ch.naughty) g.peds.provoked(ch, melee);
    if (ch.health <= 0) {
      ch.koT = 7.5; ch.knock(new V3(dir.x * (melee ? 4 : 3), 2.2, dir.z * (melee ? 4 : 3)), 0.8);
      if (byPlayer) { g.stats.knocked++; g.wanted.crime(cop ? 40 : melee ? 10 : 20, cop ? 'You knocked out a ~b~cop~w~! Expect company.' : null, { direct: cop, type: 'assault', x: ch.pos.x, z: ch.pos.z }); }
    } else {
      if (ch.state === 'walk') { ch.vel.x += dir.x * (melee ? 3 : 1.5); ch.vel.z += dir.z * (melee ? 3 : 1.5); if (!cop && !ch.naughty && ch.brain && ch.brain.mode !== 'surrender') { ch.panic = 4; ch.brain.flee = [dir.x, dir.z]; if (ch.brain.mode === 'call') ch.brain.mode = 'return'; } }
      if (byPlayer && !ch.naughty) g.wanted.crime(cop ? 25 : melee ? 6 : 12, null, { direct: cop, type: 'assault', victim: ch, x: ch.pos.x, z: ch.pos.z });
    }
  }

  // ---------- melee ----------
  punch() {
    const ch = this.g.player.char; const bat = this.cur === 'bat';
    // snap toward the nearest target in front so punches connect
    let best = null, bd = 3.2; const fx = Math.sin(this.g.rig.yaw), fz = Math.cos(this.g.rig.yaw);
    for (const t of this.targets()) { if (t.state !== 'walk') continue; const dx = t.pos.x - ch.pos.x, dz = t.pos.z - ch.pos.z; const d = Math.hypot(dx, dz); if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.3) { bd = d; best = t; } }
    if (best) ch.yaw = Math.atan2(best.pos.x - ch.pos.x, best.pos.z - ch.pos.z); else if (this.g.input.locked || this.g.touch) ch.yaw = this.g.rig.yaw;
    ch.punchDur = bat ? 0.5 : 0.34; ch.punchT = ch.punchDur; ch.punchArm = 1 - (ch.punchArm || 0); this.punchHit = false; this.cool = this.w.rate; this.g.audio.swing(bat);
  }
  meleeHit() {
    const g = this.g; const ch = g.player.char; const w = this.w; const fx = Math.sin(ch.yaw), fz = Math.cos(ch.yaw); const dir = new V3(fx, 0, fz); let any = false;
    for (const t of this.targets()) {
      if (t.state !== 'walk') continue; const dx = t.pos.x - ch.pos.x, dz = t.pos.z - ch.pos.z; const d = Math.hypot(dx, dz);
      if (d > w.range + 0.35 || (dx * fx + dz * fz) / (d || 1) < 0.5 || Math.abs(t.pos.y - ch.pos.y) > 1.2) continue;
      any = true; this.damageChar(t, w.dmg, dir, true, true); const p = t.pos.clone().add(new V3(0, 1.3, 0)); g.effects.glow.emit(p.x, p.y, p.z, 0, 0.6, 0, 0.2, 1.8, 2, 4, 3.4, 1.6, 1);
    }
    for (const car of g.cars) {
      const px = ch.pos.x + fx * w.range * 0.8, pz = ch.pos.z + fz * w.range * 0.8; const dx = px - car.pos.x, dz = pz - car.pos.z;
      if (Math.abs(dx * car.left.x + dz * car.left.z) < car.ex + 0.1 && Math.abs(dx * car.fwd.x + dz * car.fwd.z) < car.ez + 0.1) { any = true; car.dent(new V3(px, ch.pos.y + 0.9, pz), dir, this.cur === 'bat' ? 45 : 6); car.wake(); if (this.cur === 'bat') g.effects.sparksAt(new V3(px, ch.pos.y + 0.9, pz), 4, dir.clone().negate(), 3, 0.7); if (car.driver === 'ai' && car.ai && car.ai.cruise) car.ai.panicT = 8; }
    }
    if (this.cur === 'bat') {
      const list = this._ml || (this._ml = []); g.world.query(ch.pos.x - 3, ch.pos.z - 3, ch.pos.x + 3, ch.pos.z + 3, list);
      for (const c of list) { if (c.k !== 1 || !c.prop || c.dead) continue; const dx = c.x - ch.pos.x, dz = c.z - ch.pos.z; const d = Math.hypot(dx, dz); if (d < w.range + c.r && (dx * fx + dz * fz) / (d || 1) > 0.4) { g.props.hit(c.prop, fx * 11, fz * 11, 11, 600); any = true; } }
    }
    g.audio.punchHit(any, this.cur === 'bat');
    if (any) g.rig.shake(0.06);
  }

  // ---------- police return fire ----------
  npcShoot(from, accuracy, dmg) {
    const g = this.g; const car = g.playerCar; const tgt = car ? car.pos.clone().add(new V3(0, 0.3, 0)) : g.player.char.pos.clone().add(new V3(0, 1.2, 0));
    const hit = Math.random() < accuracy; let end;
    if (hit) { end = tgt; this.hurtPlayer(dmg, from); }
    else {
      const d = tgt.clone().sub(from).normalize(); d.x += (Math.random() - 0.5) * 0.12; d.y += (Math.random() - 0.5) * 0.06; d.z += (Math.random() - 0.5) * 0.12; d.normalize();
      const h = this.raycast(from, d, 0.5, 80, null); end = h ? h.point : from.clone().addScaledVector(d, 80);
      if (h && h.kind !== 'char') this.applyHit(h, d, 0, false);
      if (Math.hypot(end.x - tgt.x, end.z - tgt.z) < 6) g.audio.whiz();
    }
    this.tracer(from, end, true); this.flash(from, 0.8); g.audio.gun('pistol', from, 0.75);
  }
  // NPC-on-NPC fire: a troublemaker shooting a cruiser, an officer returning fire
  npcShootAt(from, target, accuracy, dmg) {
    const g = this.g; const isCar = !!target.wheels; const tgt = isCar ? target.pos.clone().add(new V3(0, 0.25, 0)) : target.pos.clone().add(new V3(0, 1.2, 0));
    const d = tgt.clone().sub(from).normalize(); let end;
    if (Math.random() < accuracy) {
      end = tgt;
      if (isCar) { target.dent(target.pos.clone().addScaledVector(d, -target.ex).add(new V3(0, 0.3, 0)), d, dmg * 2.2); g.effects.sparksAt(end.clone().addScaledVector(d, -target.ex * 0.8), 4, d.clone().negate(), 3, 0.8); g.audio.clank(end); target.wake && target.wake(); }
      else { this.damageChar(target, dmg, d, false, false); g.audio.hitBody(end); }
    } else {
      d.x += (Math.random() - 0.5) * 0.14; d.y += (Math.random() - 0.5) * 0.06; d.z += (Math.random() - 0.5) * 0.14; d.normalize();
      const h = this.raycast(from, d, 0.5, 70, null); end = h ? h.point : from.clone().addScaledVector(d, 70);
      if (h && h.kind !== 'char') this.applyHit(h, d, 0, false);
      const pp = g.playerTarget(); if (Math.hypot(end.x - pp.x, end.z - pp.z) < 5) g.audio.whiz();
    }
    this.tracer(from, end, true); this.flash(from, 0.8); g.audio.gun('pistol', from, 0.7);
    for (const p of g.peds.list) if (p.state === 'walk' && !p.naughty && p.brain.mode !== 'call' && p.brain.mode !== 'surrender' && Math.hypot(p.pos.x - from.x, p.pos.z - from.z) < 35) { p.panic = 4; p.brain.flee = [p.pos.x - from.x, p.pos.z - from.z]; }
  }
  hurtPlayer(dmg, from) {
    const g = this.g; const car = g.playerCar;
    if (car) { const d = car.pos.clone().sub(from).setY(0).normalize(); car.dent(car.pos.clone().addScaledVector(d, -car.ex).add(new V3(0, 0.3, 0)), d, dmg * 2.4); g.effects.sparksAt(car.pos.clone().addScaledVector(d, -car.ex).add(new V3(0, 0.4, 0)), 4, d.clone().negate(), 3, 0.8); g.audio.clank(car.pos); g.player.hurt(dmg * 0.15, 'shot'); return; }
    g.player.hurt(dmg, 'shot'); g.audio.hitBody(g.player.char.pos);
  }

  // ---------- fx ----------
  tracer(a, b, bright) {
    const t = this.tr[this.trI]; this.trI = (this.trI + 1) % this.maxTr; t.life = t.max = bright ? 0.07 : 0.045; t.a = a.clone(); t.b = b.clone();
  }
  flash(p, s = 1) {
    const f = this.flashes[this.flashI]; this.flashI = (this.flashI + 1) % this.flashes.length; f.sp.position.copy(p); f.sp.scale.setScalar(0.55 * s); f.sp.visible = true; f.life = 0.05;
    this.flashLight.position.copy(p); this.flashLight.intensity = 30 * s; this.flashLightT = 0.05;
  }
  fx(dt) {
    for (let i = 0; i < this.maxTr; i++) {
      const t = this.tr[i]; const o = i * 6;
      if (t.life <= 0) { this.trPos.fill(0, o, o + 6); this.trCol.fill(0, o, o + 6); continue; }
      t.life -= dt; const k = Math.max(0, t.life / t.max);
      // a short streak that travels toward the target
      const s = 1 - k; const len = 0.35; const p0 = _a.lerpVectors(t.a, t.b, Math.max(0, s - len)), p1 = _b.lerpVectors(t.a, t.b, Math.min(1, s + 0.15));
      this.trPos[o] = p0.x; this.trPos[o + 1] = p0.y; this.trPos[o + 2] = p0.z; this.trPos[o + 3] = p1.x; this.trPos[o + 4] = p1.y; this.trPos[o + 5] = p1.z;
      this.trCol[o] = 1.2 * k; this.trCol[o + 1] = 0.9 * k; this.trCol[o + 2] = 0.4 * k; this.trCol[o + 3] = 4 * k; this.trCol[o + 4] = 3.2 * k; this.trCol[o + 5] = 1.6 * k;
    }
    this.trGeo.attributes.position.needsUpdate = true; this.trGeo.attributes.color.needsUpdate = true;
    for (const f of this.flashes) { if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.sp.visible = false; } }
    if (this.flashLightT > 0) { this.flashLightT -= dt; if (this.flashLightT <= 0) this.flashLight.intensity = 0; }
  }
}
