// Big Steal Car — places with jobs: the Big Deal Autos dealership (display cars, buying, your garage) and the
// San Altekz Police Department (sign up at the front desk, go on duty, answer 911 calls or patrol, arrest suspects).
import * as THREE from 'three';
import { CAR_TYPES, DEALER_LIST, PAINT, POLICE_RANKS } from './config.js';
import { Character, SKIN } from './humans.js';
import { randomLook } from './peds.js';
import { R, clamp, fmtMoney } from './util.js';

const V3 = THREE.Vector3;

// ======================= display cars =======================
// Real car models parked as static props (no physics) on the dealership lot, in the showroom on turntables and in
// the police station forecourt. They only exist while you're nearby.
export class Showcase {
  constructor(game) { this.g = game; this.sets = []; for (const k of ['dealer', 'police']) { const s = game.world.specials[k]; if (s && s.displays) this.sets.push({ s, cars: null }); } this.t = 0; }
  update(dt) {
    const g = this.g, f = g.focus; this.t += dt;
    for (const set of this.sets) {
      const d = Math.hypot(f.x - set.s.x, f.z - set.s.z);
      if (!set.cars && d < 185) set.cars = set.s.displays.map((dp) => this.make(dp));
      else if (set.cars && d > 235) { for (const c of set.cars) c.dispose(); set.cars = null; }
      if (set.cars) for (const c of set.cars) if (c.spin) { c.yawNow += c.spin * dt * 0.25; c.quat.setFromAxisAngle(new V3(0, 1, 0), c.yawNow); c.syncVisual(0); }
    }
  }
  make(dp) {
    const g = this.g; const V = g.Vehicle; const c = new V(g, dp.type, dp.color ?? R.pick(PAINT), dp.x, dp.z, dp.yaw ?? 0, 0);
    for (const w of c.wheels) { w.contact = true; w.comp = c.restLen * 0.3; }
    c.yawNow = dp.yaw ?? 0; c.spin = dp.spin || 0; c.display = true; c.syncVisual(0);
    return c;
  }
  clear() { for (const set of this.sets) if (set.cars) { for (const c of set.cars) c.dispose(); set.cars = null; } }
}

// ======================= dealership =======================
export class Dealer {
  constructor(game) {
    this.g = game; this.spot = game.world.specials.dealer; this.color = PAINT[5]; this.thumbs = {}; this.personal = null;
    game.save.garage = game.save.garage || [];
  }
  get list() { return DEALER_LIST.map((k) => CAR_TYPES[k]); }
  buy(key) {
    const g = this.g, t = CAR_TYPES[key]; if (!t || !t.price) return 'Not for sale.';
    if (g.cash < t.price) return `You need ${fmtMoney(t.price - g.cash)} more for the ${t.name}.`;
    const col = t.fixedColor ?? this.color;
    g.addCash(-t.price); g.save.garage.push({ type: key, color: col }); if (g.save.garage.length > 16) g.save.garage.shift();
    g.stats.carsBought = (g.stats.carsBought || 0) + 1; g.saveGame(); g.audio.register();
    this.deliver(g.save.garage.length - 1);
    return 'ok';
  }
  // your car rolls out to the delivery bay; only one of your cars is out at a time
  deliver(i) {
    const g = this.g, e = g.save.garage[i]; if (!e) return; const bay = this.spot.bay;
    if (this.personal && this.personal !== g.playerCar && g.cars.includes(this.personal)) g.removeCar(this.personal);
    for (const c of [...g.cars]) if (c !== g.playerCar && Math.hypot(c.pos.x - bay.x, c.pos.z - bay.z) < 4) g.removeCar(c);
    const car = new g.Vehicle(g, e.type, e.color, bay.x, bay.z, bay.yaw, 0);
    car.role = 'parked'; car.owned = true; car.personal = true; car.keep = true; car.sleeping = false; g.cars.push(car); this.personal = car;
    g.hud.waypoint = [bay.x, bay.z]; g.hud.routeCache = null;
  }
  // a little studio render of each model for the catalogue (drawn into the main canvas for a frame, then copied)
  thumb(key) {
    if (this.thumbs[key]) return this.thumbs[key];
    const g = this.g, r = g.renderer;
    if (!this.studio) {
      const sc = new THREE.Scene(); sc.background = new THREE.Color(0x15171c);
      sc.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3632, 2.4)); const d = new THREE.DirectionalLight(0xffffff, 3.4); d.position.set(4, 6, 5); sc.add(d);
      const fl = new THREE.Mesh(new THREE.CircleGeometry(6, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.35, metalness: 0.2 })); sc.add(fl);
      const cam = new THREE.PerspectiveCamera(26, 2, 0.1, 100); this.studio = { sc, cam };
      const wg = new THREE.CylinderGeometry(1, 1, 1, 24).rotateZ(Math.PI / 2); this.studio.wheel = [new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })), new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.02, 18).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25 }))];
    }
    const { sc, cam } = this.studio; const t = CAR_TYPES[key];
    const m = g.carFactory.build(key, t.fixedColor ?? 0xb8bcc2, 0); m.model.position.y = 0; sc.add(m.group);
    const wheels = [];
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) for (const proto of this.studio.wheel) { const w = proto.clone(); w.scale.set(t.wheelW, t.wheelR, t.wheelR); w.position.set(x * t.track / 2, t.wheelR, z * t.wb / 2); sc.add(w); wheels.push(w); }
    const L = t.L; cam.position.set(L * 1.15, t.H * 0.9 + 0.9, L * 1.55); cam.lookAt(0, t.H * 0.42, 0); cam.updateProjectionMatrix();
    sc.environment = g.scene.environment;
    const W = 256, H = 128, dpr = r.getPixelRatio(); const vp = new THREE.Vector4(); r.getViewport(vp);
    r.setViewport(0, 0, W, H); r.setScissor(0, 0, W, H); r.setScissorTest(true); r.setRenderTarget(null); r.render(sc, cam);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    try { x.drawImage(r.domElement, 0, r.domElement.height - H * dpr, W * dpr, H * dpr, 0, 0, W, H); } catch (e) { /* fall back to the silhouette */ }
    r.setScissorTest(false); r.setViewport(vp);
    sc.remove(m.group); for (const w of wheels) sc.remove(w); m.body.geometry.dispose(); m.cabin.geometry.dispose();
    this.thumbs[key] = c.toDataURL('image/png'); return this.thumbs[key];
  }
  stats(t) { return { speed: clamp(t.vmax / 92, 0.05, 1), accel: clamp((t.power / t.mass) / 330, 0.05, 1), handling: clamp((t.grip - 0.85) / 0.6 * 0.7 + (t.steer - 0.45) / 0.25 * 0.3, 0.05, 1) }; }
}

// ======================= police career =======================
const CALLS = {
  assault: { title: 'Assault in progress', code: '10-31', pay: 220, foot: true, act: 'fight', w: 3 },
  robbery: { title: 'Armed robbery', code: '10-65', pay: 380, foot: true, act: 'armed', w: 2 },
  shots: { title: 'Shots fired', code: '10-71', pay: 400, foot: true, act: 'armed', w: 1 },
  vandal: { title: 'Vandalism', code: '10-62', pay: 160, foot: true, act: 'flee', w: 2 },
  stolen: { title: 'Stolen vehicle', code: '10-16', pay: 340, foot: false, act: 'flee', w: 2 },
  reckless: { title: 'Reckless driver', code: '10-55', pay: 200, foot: false, act: 'stop', w: 3 },
};
const UNIFORM = { shirt: 0x1b2a4a, sleeve: 0x1b2a4a, pants: 0x121a2e, shoes: 0x111111, hair: 0x101830 };

export class PoliceJob {
  constructor(game) {
    this.g = game; this.s = game.save.cop = { joined: false, arrests: 0, calls: 0, tickets: 0, earned: 0, ...(game.save.cop || {}) };
    this.onDuty = false; this.mode = 'calls'; this.call = null; this.unit = null; this.strikes = 0; this.nextT = 6; this.payT = 45; this.patrolDist = 0; this.lastPos = new V3(); this.t = 0;
  }
  get rankIndex() { let r = 0; POLICE_RANKS.forEach((k, i) => { if (this.s.arrests >= k.at) r = i; }); return r; }
  get rank() { return POLICE_RANKS[this.rankIndex]; }
  get nextRank() { return POLICE_RANKS[this.rankIndex + 1] || null; }

  // ---------- front desk ----------
  join() {
    const g = this.g; if (this.s.joined) return 'You are already on the force.';
    if (g.wanted.stars > 0) return 'Come back when every cop in town isn\'t looking for you.';
    this.s.joined = true; g.saveGame(); g.audio.chime(true); return 'ok';
  }
  resign() { if (this.onDuty) this.offDuty(true); this.s.joined = false; this.g.saveGame(); }
  goOnDuty(mode) {
    const g = this.g; if (!this.s.joined) return 'Join the force first.'; if (g.wanted.stars > 0) return 'Not while you\'re wanted.';
    this.mode = mode; if (this.onDuty) { this.endCall(null); this.nextT = 4; return 'ok'; }
    this.onDuty = true; this.strikes = 0; this.nextT = mode === 'calls' ? 6 : 20; this.payT = 45; this.patrolDist = 0; this.lastPos.copy(g.focus);
    // uniform + service pistol
    const ch = g.player.char; this.civvies = ch.look; this.relook({ ...ch.look, ...UNIFORM });
    const W = g.weapons; if (!W.owned.pistol) { W.owned.pistol = true; W.ammo.pistol.mag = 12; W.ammo.pistol.res = 36; this.lentPistol = true; } else W.ammo.pistol.res = Math.max(W.ammo.pistol.res, 36);
    this.spawnUnit(); g.saveGame();
    return 'ok';
  }
  spawnUnit() {
    const g = this.g, bay = g.world.specials.police.unitBay; if (this.unit && g.cars.includes(this.unit) && !this.unit.dead) return;
    for (const c of [...g.cars]) if (c !== g.playerCar && Math.hypot(c.pos.x - bay.x, c.pos.z - bay.z) < 4) g.removeCar(c);
    const car = new g.Vehicle(g, this.rank.car, 0, bay.x, bay.z, bay.yaw, 0); car.role = 'parked'; car.owned = true; car.keep = true; car.unit = true; car.sleeping = false; g.cars.push(car); this.unit = car;
  }
  offDuty(silent) {
    const g = this.g; if (!this.onDuty) return; this.onDuty = false; this.endCall(null);
    if (this.civvies) this.relook(this.civvies); this.civvies = null;
    if (this.lentPistol) { const W = g.weapons; W.owned.pistol = false; if (W.cur === 'pistol') W.select('fists'); this.lentPistol = false; }
    if (this.unit && this.unit !== g.playerCar && g.cars.includes(this.unit)) g.removeCar(this.unit); else if (this.unit) { this.unit.keep = false; this.unit.unit = false; }
    this.unit = null; g.hud.objective(''); if (!silent) g.hud.help('Shift over. Nice work out there, officer.', 3); g.saveGame();
  }
  fire(why) {
    const g = this.g; this.offDuty(true); this.s.joined = false; g.saveGame();
    g.hud.big('FIRED', why || 'Misconduct. Hand in your badge.', 'failed', 4); g.audio.failed();
  }
  relook(look) { const ch = this.g.player.char; ch.look = look; this.g.humans.remove(ch); this.g.humans.add(ch); }

  // ---------- crimes committed by the officer ----------
  // returns true when a "crime" is just police work (or an officer's minor slip) and shouldn't bring heat
  excuse(amount, why, o = {}) {
    if (!this.onDuty) return false; const g = this.g; const v = o.victim;
    const legit = v && (v.suspect || (v.naughty && v.brain && ['fight', 'shootback', 'ambush', 'flee', 'harass', 'surrender'].includes(v.brain.mode)) || (v.wheels && v.suspect));
    if (legit) return true;
    // the rough edges of police work: dented cruisers, commandeered cars, warning shots, flattened lamp posts
    if (['vandal', 'reckless', 'theft', 'carjack', 'shootcar', 'shots', 'copcar', 'rampolice'].includes(o.type) || (!o.type && !o.direct)) return true;
    if (o.type === 'assault' && v && v.naughty) return true;
    this.strikes++; this.strikeT = 0;
    if (this.strikes >= 3) { this.fire('Three strikes. Hurting civilians is not police work.'); return false; }
    g.hud.help(`~r~Misconduct!~w~ Strike ${this.strikes}/3. Hurt civilians again and you're off the force.`, 4); g.audio.uiBack(); return true;
  }

  // ---------- calls ----------
  pickType() { const types = Object.entries(CALLS).filter(([k]) => this.mode === 'calls' || k !== 'shots'); const tot = types.reduce((s, [, c]) => s + c.w, 0); let r = Math.random() * tot; for (const [k, c] of types) { r -= c.w; if (r <= 0) return k; } return types[0][0]; }
  startCall(type) {
    const g = this.g; const C = CALLS[type]; const near = this.mode === 'patrol';
    const [minD, maxD] = near ? [70, 160] : [200, 480];
    const call = { type, ...C, t: 0, state: 'enroute', suspect: null, car: null, victim: null, near };
    if (C.foot) {
      const p = this.footSpot(minD, maxD); if (!p) return false;
      const sus = this.makePed(p.x, p.z, true); if (!sus) return false; call.suspect = sus; sus.suspect = call;
      sus.brain.mode = 'harass'; sus.brain.target = null; sus.armed = C.act === 'armed';
      if (type !== 'vandal') { const v = this.makePed(p.x + Math.cos(p.a) * 1.6, p.z + Math.sin(p.a) * 1.6, false); if (v) { v.brain.mode = 'call'; v.keep = true; call.victim = v; sus.brain.victim = v; } }
      call.x = p.x; call.z = p.z;
    } else {
      const sp = g.population.spawnPoint(minD, maxD, true) || g.population.spawnPoint(minD * 0.7, maxD * 1.2, false); if (!sp) return false;
      const car = g.spawnTraffic(sp, type === 'stolen' ? R.pick(['sports', 'muscle', 'coupe', 'suv', 'pickup']) : null); car.suspect = call; car.keep = true; car.ai.cruise *= type === 'reckless' ? 1.5 : 1.2; call.car = car; call.x = car.pos.x; call.z = car.pos.z;
    }
    this.call = call; this.s.calls++;
    const where = g.world.district(call.x, call.z);
    if (near) { g.hud.help(`~b~On patrol:~w~ ${C.title.toLowerCase()} spotted up ahead in ~y~${where}~w~.`, 4); g.audio.beep(); }
    else { g.hud.missionCard(`${C.code} · ${C.title.toUpperCase()}`, `Dispatch: all units, ${C.title.toLowerCase()} reported in ${where}. Respond and arrest the suspect.`, '#4ea8ff'); g.audio.missionStart(); }
    g.hud.waypoint = [call.x, call.z]; g.hud.routeCache = null;
    return true;
  }
  footSpot(minD, maxD) {
    const g = this.g, W = g.world, f = g.focus;
    for (let t = 0; t < 60; t++) {
      const ring = W.rings[Math.floor(Math.random() * W.rings.length)]; const n = ring.pts.length; const i = Math.floor(Math.random() * n); const a = ring.pts[i], b = ring.pts[(i + 1) % n]; const u = 0.2 + Math.random() * 0.6;
      const x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u; const d = Math.hypot(x - f.x, z - f.z);
      if (d < minD || d > maxD || W.insideBuilding(x, z, 0.8) || !W.onSlab(x, z)) continue;
      return { x, z, ring, a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    return null;
  }
  makePed(x, z, bad) {
    const g = this.g; const look = bad ? { ...randomLook(), shirt: R.pick([0x1d1f24, 0x2b0f12, 0x24301f]), sleeve: 0x16181c, pants: 0x14161a, hair: 0x111111 } : randomLook();
    const ch = new Character(g, look, x, z, Math.random() * 6.28); if (ch.slot == null) { ch.dispose(); return null; }
    ch.brain = { ring: g.peds.nearestRing(x, z), target: 0, dir: 1, mode: 'walk', speed: 1.3, wait: 0 }; ch.health = bad ? 80 : 60; ch.naughty = bad; ch.keep = true;
    g.peds.list.push(ch); return ch;
  }
  endCall(result) {
    const g = this.g, c = this.call; if (!c) return; this.call = null;
    for (const ch of [c.suspect, c.victim]) if (ch) { ch.keep = false; if (ch.brain && ch.brain.mode === 'harass') ch.brain.mode = 'return'; if (ch.brain && ch.brain.mode === 'call') ch.brain.mode = 'return'; }
    if (c.suspect) c.suspect.suspect = null;
    if (c.car) { c.car.keep = false; c.car.suspect = null; if (c.car.ai && c.car.ai.busted && !result) c.car.ai.busted = false; }
    if (g.hud.waypoint && Math.hypot(g.hud.waypoint[0] - c.x, g.hud.waypoint[1] - c.z) < 30) g.hud.waypoint = null;
    g.hud.objective('');
    this.nextT = this.mode === 'calls' ? 14 + Math.random() * 14 : 28 + Math.random() * 30;
    if (result === 'fail') { g.hud.big('SUSPECT GOT AWAY', c.title, 'failed', 3); g.audio.failed(); }
  }
  reward(base, title, sub) {
    const g = this.g; const was = this.rankIndex; const pay = Math.round(base * this.rank.pay / 5) * 5;
    g.addCash(pay); this.s.earned += pay; g.hud.stunt(title, sub, pay); g.audio.passed();
    if (this.rankIndex > was) setTimeout(() => { g.hud.big('PROMOTED', `You are now a ~b~${this.rank.name}~w~. Pay x${this.rank.pay}${this.rank.car === 'policeSUV' && POLICE_RANKS[was].car !== 'policeSUV' ? ' · new unit: Interceptor Utility' : ''}`, 'passed', 4); g.audio.chime(true); }, 1600);
    g.saveGame();
  }
  arrest(ch) {
    const g = this.g; if (ch.cuffed) return; ch.cuffed = true; ch.brain.mode = 'surrender'; ch.surrender = true; ch.armed = false; ch.gun = null; ch.aimPose = false; ch.surT = 0; ch.keep = false;
    this.s.arrests++; g.stats.arrests = (g.stats.arrests || 0) + 1;
    const c = ch.suspect || this.call; const fast = c && c.t < (c.near ? 60 : 110);
    const base = (c && c.pay) || 150; this.reward(base + (fast ? 60 : 0), 'SUSPECT ARRESTED', `${c ? c.title : 'Troublemaker'}${fast ? ' · fast response' : ''}`);
    if (c && this.call === c) this.endCall('done');
    ch.suspect = null;
  }
  ticket(car) {
    const g = this.g; const c = this.call; this.s.tickets++;
    this.reward(c ? c.pay * 0.6 : 90, 'TICKET ISSUED', 'Reckless driving · driver released');
    if (car.ai) { car.ai.busted = false; car.ai.fleeing = false; car.ai.panicT = 0; car.ai.cruise = 11 + Math.random() * 3; car.ai.pullT = 0; } car.hazard = false;
    if (c && this.call === c) this.endCall('done');
  }

  // ---------- per frame ----------
  update(dt) {
    const g = this.g; this.t += dt; if (!this.onDuty) return;
    if (g.state !== 'play') return;
    const car = g.playerCar, pt = g.playerTarget();
    if (this.strikes > 0) { this.strikeT = (this.strikeT || 0) + dt; if (this.strikeT > 90) { this.strikeT = 0; this.strikes--; } } // a clean stretch earns a strike back
    // patrol pay for miles covered
    this.patrolDist += Math.min(40, Math.hypot(g.focus.x - this.lastPos.x, g.focus.z - this.lastPos.z)); this.lastPos.copy(g.focus);
    this.payT -= dt; if (this.payT <= 0) { this.payT = 45; if (this.mode === 'patrol' && this.patrolDist > 120) { const p = Math.round(Math.min(70, this.patrolDist * 0.07) * this.rank.pay / 5) * 5; g.addCash(p); this.s.earned += p; g.hud.help(`Patrol pay ~g~+${fmtMoney(p)}`, 2); } this.patrolDist = 0; }
    // unit car: respawn at the station if it's lost
    if (this.unit && (!g.cars.includes(this.unit) || this.unit.dead) && this.unit !== g.playerCar) this.unit = null;
    // new calls / incidents
    if (!this.call) { this.nextT -= dt; if (this.nextT <= 0) { if (!this.startCall(this.pickType())) this.nextT = 3; } }
    // hostile troublemakers anywhere near an on-duty officer are fair game
    for (const h of g.peds.list) if (h.naughty && !h.suspect && !h.cuffed && h.state !== 'seat' && ['fight', 'shootback', 'ambush'].includes(h.brain.mode) && Math.hypot(h.pos.x - pt.x, h.pos.z - pt.z) < 60) h.suspect = { title: 'Disorderly troublemaker', pay: 140, t: 0, near: true };
    const c = this.call;
    if (c) {
      c.t += dt;
      const sus = c.suspect, sc = c.car;
      const tgt = sus && g.peds.list.includes(sus) ? sus.pos : sc && g.cars.includes(sc) ? sc.pos : null;
      if (!tgt) { this.endCall(c.state === 'enroute' ? null : 'fail'); return; }
      c.x = tgt.x; c.z = tgt.z; const d = Math.hypot(tgt.x - pt.x, tgt.z - pt.z);
      if (c.state === 'enroute') { if (g.hud.waypoint) { g.hud.waypoint[0] = c.x; g.hud.waypoint[1] = c.z; } g.hud.objective(`~b~${c.code}~w~ ${c.title}: ~y~${Math.round(d)} m`); }
      // engage when the officer shows up
      if (c.state === 'enroute' && (d < (c.foot ? 28 : 45) && (c.foot || (car && (car.siren || d < 20))))) {
        c.state = 'engaged'; g.hud.waypoint = null;
        if (sus) { const onFoot = !car && d < 14; sus.brain.mode = c.act === 'armed' ? 'shootback' : c.act === 'fight' && onFoot ? 'fight' : 'flee'; sus.brain.t = 0; sus.panic = 0; if (c.act === 'armed') sus.armed = true; if (c.victim) { c.victim.brain.mode = 'return'; c.victim.panic = 3; c.victim.keep = false; } }
        if (sc && sc.ai) { if (c.act === 'stop' && Math.random() < 0.7) { sc.ai.pullOver = true; c.stopping = true; } else { sc.ai.flee(); c.fleeing = true; } }
        g.hud.help(c.foot ? (c.act === 'armed' ? '~r~The suspect is armed!~w~ Take them down, then press [F] to arrest.' : 'Catch the suspect: tackle them, knock them down or hold them at gunpoint, then press [F] to arrest.') : c.stopping ? 'The driver is pulling over. Walk up to the window and press [F] to write a ticket.' : '~r~They\'re running!~w~ Box the car in until it stops.', 4);
      }
      if (c.state === 'engaged') {
        if (sus) g.hud.objective(`Arrest the suspect · ~y~${Math.round(d)} m`);
        else if (c.stopping) g.hud.objective(sc.ai && sc.ai.busted ? 'Walk up to the driver\'s window and press [F]' : 'The driver is pulling over…');
        else g.hud.objective(`Stop the vehicle · ~y~${Math.round(d)} m`);
        if (d > 240) { c.lostT = (c.lostT || 0) + dt; if (c.lostT > 8) { this.endCall('fail'); return; } } else c.lostT = 0;
      }
      if (c.t > (c.near ? 200 : 320)) { this.endCall(c.state === 'enroute' ? null : 'fail'); if (c.state === 'enroute') g.hud.help('Dispatch cancelled that call. Another unit handled it.', 3); return; }
      // a fleeing car that's boxed in: the driver gives up and gets out
      if (sc && c.fleeing && g.cars.includes(sc)) {
        const near = car && Math.hypot(car.pos.x - sc.pos.x, car.pos.z - sc.pos.z) < 9;
        if ((sc.speed < 1.5 && near) || sc.dead || sc.upsideT > 2) { c.bustT = (c.bustT || 0) + dt; if (c.bustT > 1.8) this.driverOut(c, sc); } else c.bustT = Math.max(0, (c.bustT || 0) - dt);
      }
    }
  }
  driverOut(c, sc) {
    const g = this.g; c.fleeing = false; c.car = null; sc.keep = false; sc.suspect = null; if (sc.ai) { sc.ai.busted = true; } sc.hazard = true;
    const ch = sc.driverChar; if (!ch) { this.endCall('fail'); return; }
    sc.driverChar = null; ch.state = 'walk'; ch.scale = 1; ch.pos.copy(sc.pos).addScaledVector(sc.left, sc.ex + 1.0); ch.pos.y = g.world.ground(ch.pos.x, ch.pos.z);
    g.peds.adopt(ch, 0); ch.naughty = true; ch.keep = true; ch.health = 70; ch.suspect = c; c.suspect = ch; c.foot = true;
    if (Math.random() < 0.65) { ch.brain.mode = 'surrender'; g.hud.help('The driver gave up. Walk over and press [F] to arrest them.', 3); }
    else { ch.brain.mode = 'flee'; ch.brain.t = 0; g.hud.help('~r~The driver bailed and is running!~w~ Catch them on foot.', 3); }
  }
  footWork(dt) {
    const g = this.g, pc = g.player.char, W = g.weapons; let best = null, bd = 2.3, bestCar = null;
    for (const h of g.peds.list) {
      if (!h.suspect || h.cuffed) continue; const d = Math.hypot(h.pos.x - pc.pos.x, h.pos.z - pc.pos.z);
      // tackle a runner by sprinting into them
      if (h.state === 'walk' && h.brain.mode === 'flee' && d < 1.05 && pc.speed > 5) { h.knock(new V3(pc.vel.x * 0.5, 1.5, pc.vel.z * 0.5), 0.6); h.koT = 3.5; g.audio.punchHit(true, false); g.rig.shake(0.12); g.hud.help('~b~Tackled!~w~ Press [F] to cuff them.', 2); }
      // held at gunpoint
      if (h.state === 'walk' && W.aiming && !W.w.melee && d < 22 && h.brain.mode !== 'surrender') {
        const [fx, fz] = g.rig.forward; const dx = h.pos.x - pc.pos.x, dz = h.pos.z - pc.pos.z; const cos = (dx * fx + dz * fz) / (d || 1);
        if (cos > 0.96 && g.world.raycast(pc.pos.x, 1.5, pc.pos.z, h.pos.x, 1.4, h.pos.z) >= 1) {
          h.gunT = (h.gunT || 0) + dt; const odds = h.brain.mode === 'shootback' ? 0.18 : h.brain.mode === 'fight' ? 0.5 : 0.65;
          if (h.gunT > 0.8) { h.gunT = 0; if (Math.random() < odds) { h.brain.mode = 'surrender'; h.armed = false; h.gun = null; h.aimPose = false; h.panic = 0; g.hud.help('The suspect put their hands up. Press [F] to arrest.', 2.5); } }
        }
      }
      const canCuff = h.brain.mode === 'surrender' || h.state === 'down' || h.state === 'ragdoll' || h.state === 'getup' || (h.health != null && h.health < 25);
      if (canCuff && d < bd) { bd = d; best = h; }
    }
    // traffic stop: the stopped driver's window
    const c = this.call;
    if (c && c.stopping && c.car && c.car.ai && c.car.ai.busted) { const sc = c.car; const dx = pc.pos.x - sc.pos.x, dz = pc.pos.z - sc.pos.z; const lx = dx * sc.left.x + dz * sc.left.z, lz = dx * sc.fwd.x + dz * sc.fwd.z; if (Math.abs(lx) < sc.ex + 1.6 && Math.abs(lz) < sc.ez) bestCar = sc; }
    if (best) { g.hud.prompt('[F] Arrest suspect'); if (g.input.hit('KeyF', 'KeyE')) this.arrest(best); return true; }
    if (bestCar) { g.hud.prompt('[F] Write a ticket'); if (g.input.hit('KeyF', 'KeyE')) this.ticket(bestCar); return true; }
    return false;
  }
  // a suspect hitting the officer's car etc. — used by the HUD
  get blips() {
    const out = []; const c = this.call; if (!this.onDuty) return out;
    if (c) { if (c.suspect && this.g.peds.list.includes(c.suspect)) out.push({ x: c.suspect.pos.x, z: c.suspect.pos.z, kind: 'suspect' }); else if (c.car) out.push({ x: c.car.pos.x, z: c.car.pos.z, kind: 'suspect' }); }
    for (const h of this.g.peds.list) if (h.suspect && h.suspect !== c && !h.cuffed) out.push({ x: h.pos.x, z: h.pos.z, kind: 'hostile' });
    return out;
  }
  dutyText() { return this.onDuty ? `SAPD · ${this.rank.name.toUpperCase()} · ${this.mode === 'calls' ? '911 CALLS' : 'PATROL'}` : ''; }
}
export { CALLS, UNIFORM, SKIN };
