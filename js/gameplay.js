// Big Steal Car — wanted level + police dispatch, missions, pickups, Pay & Spray, stunt/drift bonuses, stats, saving.
import * as THREE from 'three';
import { CITY, WANTED, PAINT } from './config.js';
import { clamp, R, fmtMoney, rng } from './util.js';
import * as TX from './textures.js';

const { P, HALF, SLAB, LOT, CURB } = CITY;
const V3 = THREE.Vector3;

// ======================= wanted level =======================
// How likely a bystander is to bother calling it in, per crime type, and how long the call takes (s).
const CARE = { copcar: 1, vandal: 0.35, theft: 0.5, carjack: 0.9, reckless: 0.3, hitped: 0.8, assault: 0.7, shots: 0.95, shootcar: 0.55, misc: 0.4 };
const CALL = { copcar: [4, 7], vandal: [10, 17], theft: [8, 14], carjack: [6, 10], reckless: [9, 15], hitped: [5, 9], assault: [6, 10], shots: [4, 7], shootcar: [6, 10], misc: [8, 14] };
export class Wanted {
  constructor(game) {
    this.game = game; this.heat = 0; this.stars = 0; this.unseenT = 0; this.seen = false; this.maxStars = 0; this.spawnT = 0; this.officerT = 0; this.locked = false;
    this.reports = []; this.lastKnown = { x: 0, z: 0, vx: 0, vz: 0, lx: 1, lz: 0, stale: true }; this.dispatchT = 0; this.sinceSeen = 99; this.quietT = 0;
  }
  level(h) { let s = 0; for (let i = 1; i <= 5; i++) if (h >= WANTED.thresholds[i]) s = i; return s; }
  // A crime: police who see it react at once; otherwise a civilian has to notice, care, and finish a phone call.
  crime(amount, why, o = {}) {
    if (amount <= 0) return; const g = this.game; if (g.state !== 'play') return;
    if (g.police && g.police.excuse(amount, why, o)) return;
    const f = g.playerTarget(); const x = o.x ?? f.x, z = o.z ?? f.z;
    if (o.direct || (this.stars > 0 && this.seen) || this.policeSee(x, z)) { this.addHeat(amount, why, true); return; }
    // a call already in progress nearby just gets a longer story
    const rep = this.reports.find((r) => Math.hypot(r.x - x, r.z - z) < 80);
    if (rep) { rep.heat += amount; return; }
    const type = o.type || 'misc'; const w = this.findWitness(x, z, o.victim, CARE[type] ?? 0.4);
    if (!w) return;
    const [a, b] = CALL[type] || CALL.misc; const t = a + Math.random() * (b - a) - (amount >= 30 ? 2 : 0);
    const r = { who: w, t, t0: t, heat: amount, why, x, z, type }; this.reports.push(r);
    if (w.brain) { w.brain.mode = 'call'; w.brain.callT = t; w.panic = 0; w.brain.flee = null; }
    if (!this.toldCall || g.t - this.toldCall > 20) { this.toldCall = g.t; g.hud.help(w.brain ? '~y~A witness is calling the cops!~w~ Stop them or get out of sight.' : '~y~That driver is phoning the cops.~w~ Get out of here.', 3); }
  }
  addHeat(amount, why, direct) {
    const g = this.game; const was = this.stars;
    this.heat = Math.min(WANTED.thresholds[5] + 50, this.heat + amount); const s = this.level(this.heat);
    const f = g.playerTarget(); this.markSeen(f);
    if (s > this.stars) {
      this.stars = s; this.maxStars = Math.max(this.maxStars, s); g.hud.starsUp(); g.audio.starUp(); if (why) g.hud.help(why, 2.8);
      if (was === 0) {
        this.unseenT = -4;
        // a patrol right here is already on it; otherwise units have to be sent from across town
        this.dispatchT = direct && this.nearestCop(f.x, f.z) < 90 ? 0 : s >= 3 ? 3 + Math.random() * 2 : 7 + Math.random() * 6;
        if (!direct) this.sinceSeen = 99;
      }
    }
  }
  markSeen(f) { const k = this.lastKnown; k.x = f.x; k.z = f.z; k.vx = f.vx; k.vz = f.vz; k.lx = f.lx; k.lz = f.lz; k.stale = false; }
  set(stars) { this.stars = stars; this.heat = WANTED.thresholds[stars] + 1; this.maxStars = Math.max(this.maxStars, stars); this.unseenT = -7; this.dispatchT = 0; this.markSeen(this.game.playerTarget()); this.game.hud.starsUp(); }
  clear(silent) { const had = this.stars; this.stars = 0; this.heat = 0; this.unseenT = 0; this.maxStars = 0; this.dispatchT = 0; this.reports.length = 0; if (!silent && had) this.game.hud.help('Wanted level cleared.', 2.5); }
  nearestCop(x, z) { let d = 1e9; for (const c of this.game.cars) if (c.role === 'police' && !c.dead) d = Math.min(d, Math.hypot(c.pos.x - x, c.pos.z - z)); return d; }
  policeSee(x, z) {
    const g = this.game, W = g.world;
    for (const car of g.cars) {
      if (car.role !== 'police' || car.dead || !car.driver) continue; const d = Math.hypot(car.pos.x - x, car.pos.z - z);
      if (d < 22 || (d < 70 && W.raycast(car.pos.x, 1.3, car.pos.z, x, 1.3, z) >= 1)) return true;
    }
    for (const c of g.peds.cops) if (c.state === 'walk' && Math.hypot(c.pos.x - x, c.pos.z - z) < 40 && W.raycast(c.pos.x, 1.5, c.pos.z, x, 1.3, z) >= 1) return true;
    return false;
  }
  // the victim first (they nearly always call), then whoever is closest and can actually see it
  findWitness(x, z, victim, care) {
    const g = this.game, W = g.world;
    if (victim && victim.brain && victim.state === 'walk' && Math.random() < Math.max(care, 0.85)) return victim;
    if (victim && victim.wheels && victim.driver === 'ai' && victim.role === 'traffic' && !victim.dead && Math.random() < Math.min(1, care * 1.6)) return victim;
    const near = [];
    for (const h of g.peds.list) { if (h === victim || h.state !== 'walk' || h.naughty || h.brain.mode === 'call') continue; const d = Math.hypot(h.pos.x - x, h.pos.z - z); if (d < 45) near.push([d, h]); }
    near.sort((a, b) => a[0] - b[0]);
    for (const [, h] of near.slice(0, 6)) { if (W.raycast(h.pos.x, 1.6, h.pos.z, x, 1.2, z) < 1) continue; if (Math.random() < care) return h; }
    for (const c of g.cars) { if (c.role !== 'traffic' || !c.driver || c.driver === 'player' || c === victim) continue; if (Math.hypot(c.pos.x - x, c.pos.z - z) < 28 && Math.random() < care * 0.55) return c; }
    return null;
  }
  // where the cops think you are: live position while they can see you, otherwise the last sighting
  copTarget() { if (this.seen || this.sinceSeen < 1.5) return this.game.playerTarget(); return this.lastKnown; }
  update(dt) {
    const g = this.game; const f = g.playerTarget();
    // calls in progress: knock the caller out and the call never goes through
    for (let i = this.reports.length - 1; i >= 0; i--) {
      const r = this.reports[i]; const ch = r.who.brain ? r.who : null;
      if (ch && (ch.state !== 'walk' && ch.state !== 'seat') && g.peds.list.includes(ch)) { this.reports.splice(i, 1); if (ch.brain) ch.brain.mode = 'return'; g.hud.help('~g~The witness never finished that call.', 2.5); continue; }
      if (!ch && (r.who.dead || !g.cars.includes(r.who))) { this.reports.splice(i, 1); continue; }
      r.t -= dt;
      if (r.t <= 0) {
        this.reports.splice(i, 1); if (ch && ch.brain) { ch.brain.mode = 'return'; ch.panic = 0; }
        const before = this.stars; this.addHeat(r.heat, null, false);
        // the caller describes where it happened, or where you are if you're still hanging around
        if (Math.hypot(f.x - r.x, f.z - r.z) > 60) { const k = this.lastKnown; k.x = r.x; k.z = r.z; k.vx = k.vz = 0; }
        if (this.stars > before) g.hud.help(before === 0 ? '~r~A witness reported you.~w~ Police are on the way.' : '~r~Another report came in.~w~ More units responding.', 3);
      }
    }
    if (this.stars === 0) { this.heat = Math.max(0, this.heat - dt * 2); this.seen = false; this.manageCops(dt); return; }
    // are the cops watching?
    let seen = false;
    for (const car of g.cars) {
      if (car.role !== 'police' || car.dead || !car.driver || (car.ai && car.ai.suspect)) continue; const d = Math.hypot(car.pos.x - f.x, car.pos.z - f.z);
      if (d < 28 || (d < 75 && g.world.raycast(car.pos.x, 1.3, car.pos.z, f.x, 1.3, f.z) >= 1)) { seen = true; break; }
    }
    if (!seen) for (const c of g.peds.cops) if (c.state === 'walk' && Math.hypot(c.pos.x - f.x, c.pos.z - f.z) < 35) { seen = true; break; }
    this.seen = seen;
    if (seen) { this.unseenT = Math.min(this.unseenT, 0); this.sinceSeen = 0; this.markSeen(f); }
    else {
      this.sinceSeen += dt;
      if (this.sinceSeen < 1.5) this.markSeen(f); // they still have a rough idea for a moment
      if (this.dispatchT > 0) this.dispatchT -= dt; // units still on their way: the clock doesn't run yet
      else {
        let near = false; for (const car of g.cars) if (car.role === 'police' && !car.dead && Math.hypot(car.pos.x - f.x, car.pos.z - f.z) < 120) { near = true; break; }
        this.unseenT += dt * (near ? 0.45 : 1);
      }
      if (this.unseenT > WANTED.loseTime[this.stars]) {
        this.stars--; this.heat = WANTED.thresholds[this.stars] + 0.5; this.unseenT = 0;
        if (this.stars === 0) { const bonus = 150 * this.maxStars; g.addCash(bonus, 'Lost the cops'); g.stats.escapes++; g.hud.help(`You lost the cops! +${fmtMoney(bonus)}`, 3); g.audio.chime(); this.maxStars = 0; g.missions.onLostCops(); }
      }
    }
    this.manageCops(dt);
  }
  get responding() { return this.stars > 0 && this.dispatchT > 0; }
  manageCops(dt) {
    const g = this.game; const want = WANTED.copsPerStar[this.stars];
    const cops = g.cars.filter((c) => c.role === 'police' && !c.dead && c.ai && !c.ai.traffic && !c.ai.suspect);
    this.spawnT -= dt;
    if (this.stars > 0 && this.dispatchT <= 0 && cops.length < want && this.spawnT <= 0) {
      this.spawnT = this.stars >= 4 ? 1.8 : 3.6;
      // units are dispatched toward the last sighting from a few blocks out
      const k = this.lastKnown; const c = { x: k.x, z: k.z };
      const sp = g.population.spawnPoint(this.stars >= 4 ? 110 : 150, 240, true, c) || g.population.spawnPoint(95, 260, false, c);
      if (sp && Math.hypot(sp.x - g.focus.x, sp.z - g.focus.z) > 70) g.spawnPolice(sp);
    }
    // officers jump out when you're on foot nearby
    if (!g.playerCar && this.stars > 0) {
      for (const car of cops) {
        if (car.officer || g.peds.cops.length >= 2 + this.stars) continue;
        const d = Math.hypot(car.pos.x - g.focus.x, car.pos.z - g.focus.z); if (d < 16 && car.speed < 2.5) g.peds.spawnCop(car);
      }
    }
  }
}

// ======================= markers =======================
function beamMaterial(color, opacity = 0.35) { return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); }
function iconTexture(letter, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = color; x.beginPath(); x.arc(64, 64, 58, 0, 7); x.fill(); x.lineWidth = 8; x.strokeStyle = '#111'; x.stroke();
  x.fillStyle = '#111'; x.font = 'bold 74px Arial Black, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeMarker(scene, x, z, color, letter, y = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.18, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) })); ring.position.y = 0.15;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.6, 40).rotateX(-Math.PI / 2), beamMaterial(color, 0.22)); disc.position.y = 0.08;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 9, 32, 1, true), beamMaterial(color, 0.16)); beam.position.y = 4.5;
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(letter, color), depthTest: true })); icon.scale.set(2.2, 2.2, 1); icon.position.y = 6;
  g.add(ring, disc, beam, icon); scene.add(g); g.userData = { ring, beam, icon }; return g;
}

// ======================= missions =======================
const MISSIONS = [
  { id: 'dash', type: 'race', name: 'Downtown Dash', desc: 'Blast through every checkpoint around the Central Spire before the clock runs out.', nodes: [[3, 3], [4, 3], [5, 3], [6, 3], [6, 4], [6, 5], [6, 6], [5, 6], [4, 6], [3, 6], [3, 5], [3, 4], [3, 3]], time: 74, reward: 800 },
  { id: 'harbor', type: 'race', name: 'Harbor Sprint', desc: 'Race the waterfront of Port Bellmont. Watch out for delivery vans.', nodes: [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8], [8, 7], [8, 6], [7, 6]], time: 66, reward: 700 },
  { id: 'zigzag', type: 'race', name: 'Midtown Zigzag', desc: 'Every corner counts. Use the handbrake (Space) to whip around the turns.', nodes: [[1, 1], [2, 1], [2, 2], [3, 2], [3, 1], [4, 1], [4, 2], [5, 2], [5, 1], [6, 1], [6, 2], [7, 2]], time: 82, reward: 900 },
  { id: 'yard', type: 'stunt', name: 'Yard Launch', desc: 'Floor it through the Stunt Yard and hit the big ramp. Fly at least 28 m!', block: [7, 1], ramp: 'big', target: 28, time: 25, reward: 750 },
  { id: 'leap', type: 'stunt', name: 'Park Leap', desc: 'Charge across Greenway Park and launch off the mega ramp over the road. Land 28 m+ away!', block: [2, 2], ramp: 'mega', target: 28, time: 30, reward: 900 },
  { id: 'pursuit', type: 'getaway', name: 'Hot Pursuit', desc: 'The cops are onto you. Lose a 3-star wanted level before time runs out.', at: [[2, 5], [2, 6]], stars: 3, time: 150, reward: 1200 },
  { id: 'fivealarm', type: 'getaway', name: 'Five-Alarm Getaway', desc: 'Every cruiser in San Altekz wants you. Shake off 4 stars!', at: [[7, 3], [7, 4]], stars: 4, time: 210, reward: 2500 },
];
const TYPE_STYLE = { race: ['#ffd60a', 'R'], stunt: ['#38d39f', 'S'], getaway: ['#ff4d6d', 'G'] };

export class Missions {
  constructor(game) {
    this.game = game; this.active = null; this.list = MISSIONS.map((m) => ({ ...m })); this.cps = []; this.cooldown = 0; this.t = 0;
    const W = game.world;
    for (const m of this.list) {
      if (m.type === 'race') {
        const [a, b] = [m.nodes[0], m.nodes[1]]; const [s, e] = W.lanePath(a[0], a[1], b[0], b[1], 1);
        m.start = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2]; m.startYaw = Math.atan2(e[0] - s[0], e[1] - s[1]);
        m.points = []; for (let i = 1; i < m.nodes.length; i++) { const [x0, z0] = W.nodePos(...m.nodes[i - 1]), [x1, z1] = W.nodePos(...m.nodes[i]); if (i > 1) m.points.push([(x0 + x1) / 2, (z0 + z1) / 2]); m.points.push([x1, z1]); }
      } else if (m.type === 'stunt') {
        const ramp = W.ramps.find((r) => r.tag === m.ramp); m.rampRef = ramp;
        const back = m.ramp === 'mega' ? 64 : 33; m.start = [ramp.x - Math.sin(ramp.yaw) * back, ramp.z - Math.cos(ramp.yaw) * back]; m.startYaw = ramp.yaw;
      } else {
        const [a, b] = m.at; const [s, e] = W.lanePath(a[0], a[1], b[0], b[1], 1); m.start = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2]; m.startYaw = Math.atan2(e[0] - s[0], e[1] - s[1]);
      }
      const [col, letter] = TYPE_STYLE[m.type]; m.marker = makeMarker(game.scene, m.start[0], m.start[1], col, letter, W.ground(m.start[0], m.start[1]));
    }
    this.cpMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd60a').multiplyScalar(2.4) });
    this.cpMatFar = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd60a').multiplyScalar(0.9), transparent: true, opacity: 0.5 });
    this.cpBeam = beamMaterial('#ffd60a', 0.12);
  }
  get blips() { return this.list.filter((m) => !this.active).map((m) => ({ x: m.start[0], z: m.start[1], type: m.type, name: m.name })); }
  start(m) {
    const g = this.game; this.active = m; m.t = m.time; m.stage = 'intro'; m.introT = m.type === 'race' ? 3.6 : 2.6; m.cp = 0; m.best = 0; m.outT = 0;
    for (const mm of this.list) mm.marker.visible = false;
    g.hud.missionCard(m.name, m.desc, TYPE_STYLE[m.type][0]); g.audio.missionStart();
    const car = g.playerCar; if (car && m.type !== 'getaway') { car.place(m.start[0], m.start[1], m.startYaw); }
    if (m.type === 'race') this.buildCheckpoints(m);
  }
  buildCheckpoints(m) {
    this.clearCps();
    m.points.forEach(([x, z], i) => {
      const n = m.points[i + 1] || m.points[i - 1]; const yaw = Math.atan2((n[0] - x) * (m.points[i + 1] ? 1 : -1), (n[1] - z) * (m.points[i + 1] ? 1 : -1));
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.28, 8, 40), this.cpMatFar); ring.position.y = 5.6;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 60, 8, 1, true), this.cpBeam); beam.position.y = 30;
      const last = i === m.points.length - 1; if (last) { ring.scale.setScalar(1.25); }
      g.add(ring, beam); g.visible = false; this.game.scene.add(g); this.cps.push({ g, ring, x, z, last });
    });
    this.showCps(m);
  }
  showCps(m) { this.cps.forEach((c, i) => { c.g.visible = i >= m.cp && i < m.cp + 2; c.ring.material = i === m.cp ? this.cpMat : this.cpMatFar; }); }
  clearCps() { for (const c of this.cps) this.game.scene.remove(c.g); this.cps = []; }
  finish(pass, reason) {
    const g = this.game, m = this.active; if (!m) return;
    this.active = null; this.clearCps(); this.cooldown = 4;
    for (const mm of this.list) mm.marker.visible = true;
    if (pass) {
      let reward = m.reward; if (m.type === 'race') reward += Math.round(m.t) * 12;
      g.addCash(reward); g.stats.missions++; g.save.done[m.id] = true; g.saveGame();
      g.hud.big('MISSION PASSED', `+${fmtMoney(reward)}`, 'passed'); g.audio.passed();
    } else { g.hud.big('MISSION FAILED', reason || '', 'failed'); g.audio.failed(); }
    g.hud.objective(''); g.hud.timer(null);
  }
  onLostCops() { if (this.active && this.active.type === 'getaway' && this.active.stage === 'go') this.finish(true); }
  onJump(dist, air) {
    const m = this.active; if (!m || m.type !== 'stunt' || m.stage !== 'go') return;
    m.best = Math.max(m.best, dist);
    if (dist >= m.target) this.finish(true); else this.game.hud.help(`${dist.toFixed(1)} m — not far enough! Go back and try again.`, 2.5);
    void air;
  }
  update(dt) {
    const g = this.game; this.t += dt; this.cooldown -= dt;
    for (const m of this.list) { const u = m.marker.userData; u.ring.rotation.y += dt; u.icon.position.y = 6 + Math.sin(this.t * 2 + m.start[0]) * 0.3; }
    const car = g.playerCar; const pt = g.playerTarget();
    if (!this.active) {
      if (this.cooldown > 0 || g.state !== 'play') return;
      for (const m of this.list) {
        const d = Math.hypot(pt.x - m.start[0], pt.z - m.start[1]);
        if (d < 4.2) {
          if (!car) { g.hud.help(`~y~${m.name}~w~: you need a vehicle to start this mission.`, 0.2); continue; }
          if (g.police && g.police.onDuty) { g.hud.help('Go off duty at the police station to start missions.', 0.2); continue; }
          if (m.type === 'getaway' && g.wanted.stars > 0) { g.hud.help('Lose your current wanted level first.', 0.2); continue; }
          if (car.speed < 12) { this.start(m); return; }
        }
      }
      return;
    }
    const m = this.active;
    if (m.stage === 'intro') {
      m.introT -= dt;
      if (m.type === 'race') { g.hud.countdown(Math.ceil(m.introT - 0.6)); if (car) { car.ctrl.throttle = 0; car.ctrl.brake = 1; car.vel.multiplyScalar(0.9); } g.lockControls = 0.1; }
      if (m.introT <= 0.6) {
        m.stage = 'go'; g.lockControls = 0; if (m.type === 'race') { g.hud.countdown('GO'); g.audio.go(); }
        if (m.type === 'getaway') g.wanted.set(m.stars);
      }
      return;
    }
    m.t -= dt; g.hud.timer(m.t);
    if (m.t <= 0) { this.finish(false, m.type === 'stunt' ? `Best jump: ${m.best.toFixed(1)} m` : 'Out of time.'); return; }
    if (!car && m.type !== 'getaway') { m.outT += dt; g.hud.objective(`Get back in a vehicle! ${Math.ceil(8 - m.outT)}`); if (m.outT > 8) this.finish(false, 'You abandoned the vehicle.'); return; }
    m.outT = 0;
    if (m.type === 'race') {
      const cp = this.cps[m.cp]; g.hud.objective(`Checkpoint ~y~${m.cp + 1}/${this.cps.length}`);
      if (Math.hypot(pt.x - cp.x, pt.z - cp.z) < 8.5) {
        m.cp++; g.audio.checkpoint();
        if (m.cp >= this.cps.length) { this.finish(true); return; }
        this.showCps(m);
      }
      for (const c of this.cps) c.ring.rotation.z += dt * 0.6;
    } else if (m.type === 'stunt') g.hud.objective(`Jump at least ~g~${m.target} m~w~. Best: ${m.best.toFixed(1)} m`);
    else g.hud.objective(`Lose the cops! ~r~${g.wanted.stars}~w~ star${g.wanted.stars === 1 ? '' : 's'} left`);
  }
  get nextCheckpoint() { const m = this.active; if (!m || m.type !== 'race') return null; return this.cps.slice(m.cp, m.cp + 3); }
  abort() { if (this.active) { this.active = null; this.clearCps(); for (const mm of this.list) mm.marker.visible = true; this.game.hud.objective(''); this.game.hud.timer(null); } }
}

// ======================= pickups + Pay & Spray =======================
export class Pickups {
  constructor(game) {
    this.game = game; this.items = []; this.t = 0; const W = game.world; const r = rng(4242);
    const note = TX.cashNote(); const cashMat = new THREE.MeshStandardMaterial({ map: note, roughness: 0.6, emissive: 0x1b5e20, emissiveIntensity: 0.4 });
    const stack = new THREE.Group(); for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.3), cashMat); b.position.y = k * 0.11; b.rotation.y = k * 0.3; stack.add(b); }
    const starShape = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? 0.25 : 0.6; const px = Math.cos(a) * rr, py = Math.sin(a) * rr; i ? starShape.lineTo(px, py) : starShape.moveTo(px, py); }
    const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 }); starGeo.center();
    const starMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb000, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.25 });
    const heartShape = new THREE.Shape(); heartShape.moveTo(0, -0.5); heartShape.bezierCurveTo(-0.9, 0.1, -0.4, 0.75, 0, 0.3); heartShape.bezierCurveTo(0.4, 0.75, 0.9, 0.1, 0, -0.5);
    const heartGeo = new THREE.ExtrudeGeometry(heartShape, { depth: 0.18, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 }); heartGeo.center();
    const heartMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x15803d, emissiveIntensity: 0.7, roughness: 0.3 });
    const glowT = TX.softDot();
    const add = (kind, x, z, extra = {}) => {
      const y = W.ground(x, z); let mesh;
      if (kind === 'cash') mesh = stack.clone(); else if (kind === 'star') mesh = new THREE.Mesh(starGeo, starMat); else mesh = new THREE.Mesh(heartGeo, heartMat);
      const g = new THREE.Group(); g.add(mesh); mesh.castShadow = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: kind === 'cash' ? 0x6dff8a : kind === 'star' ? 0xffd23f : 0x6dffb0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(kind === 'star' ? 3.2 : 2); g.add(glow);
      if (kind === 'star') { const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 30, 10, 1, true), beamMaterial('#ffd23f', 0.15)); beam.position.y = 15; g.add(beam); }
      g.position.set(x, y + 1.1, z); game.scene.add(g); this.items.push({ kind, x, z, y, g, mesh, active: true, t: 0, ...extra });
    };
    // cash around sidewalks, alleys, parks and the promenade
    for (let k = 0; k < 44; k++) {
      const ring = W.rings[Math.floor(r() * W.rings.length)]; const n = ring.pts.length; const i = r.int(0, n - 1); const a = ring.pts[i], b = ring.pts[(i + 1) % n]; const u = r.range(0.1, 0.9);
      const x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u;
      if (W.insideBuilding(x, z, 0.5) || !W.onSlab(x, z)) continue; add('cash', x, z, { value: r.int(4, 15) * 10 });
    }
    for (const a of W.alleys.slice(0, 12)) { if (r() < 0.6) add('cash', a.cx + (a.axis === 'x' ? r.range(-20, 20) : 0), a.cz + (a.axis === 'z' ? r.range(-20, 20) : 0), { value: r.int(10, 25) * 10 }); }
    // wanted-level reset stars hidden in alleys
    const alleys = [...W.alleys].sort(() => r() - 0.5).slice(0, 6); for (const a of alleys) add('star', a.cx, a.cz);
    // health in parks/plazas
    for (const b of W.blocks) if (b.kind === 'park' || b.kind === 'plaza') add('health', b.cx + 6, b.cz + 6);
    // Pay & Spray garages
    this.sprays = W.specials.spray || []; this.spray = null;
  }
  get blips() { return this.items.filter((i) => i.active && i.kind !== 'cash'); }
  update(dt) {
    const g = this.game; this.t += dt; const pt = g.playerTarget(); const inCar = !!g.playerCar;
    for (const it of this.items) {
      if (!it.active) { it.t -= dt; if (it.t <= 0) { it.active = true; it.g.visible = true; } continue; }
      it.mesh.rotation.y += dt * 2.2; it.g.position.y = it.y + 1.1 + Math.sin(this.t * 2.5 + it.x) * 0.15;
      const d = Math.hypot(pt.x - it.x, pt.z - it.z); if (d > (inCar ? 3.4 : 1.8)) continue;
      if (it.kind === 'health' && g.player.health >= 100) continue;
      if (it.kind === 'star' && g.wanted.stars === 0) continue;
      it.active = false; it.g.visible = false;
      if (it.kind === 'cash') { g.addCash(it.value); g.audio.chime(); it.t = 150; }
      else if (it.kind === 'star') { g.wanted.clear(); g.audio.chime(true); g.hud.help('~y~Star Reset!~w~ Your wanted level is gone.', 3); it.t = 120; }
      else { g.player.health = 100; g.audio.chime(); g.hud.help('Health restored.', 2); it.t = 90; }
    }
    this.updateSpray(dt);
  }
  updateSpray(dt) {
    const g = this.game; const car = g.playerCar;
    if (this.spray) {
      const s = this.spray; s.t += dt; const door = s.g.door;
      if (s.t < 1) door.position.y = THREE.MathUtils.lerp(s.g.doorOpenY, s.g.doorClosedY, s.t);
      else if (s.t < 2.8) { door.position.y = s.g.doorClosedY; if (!s.done) { s.done = true; const c = R.pick(PAINT); car.model.repaint(c); car.color = c; car.repair(); g.wanted.clear(true); g.addCash(-s.cost); g.audio.spray(); } }
      else if (s.t < 3.8) door.position.y = THREE.MathUtils.lerp(s.g.doorClosedY, s.g.doorOpenY, s.t - 2.8);
      else { door.position.y = s.g.doorOpenY; this.spray = null; g.lockControls = 0; g.hud.help(s.cost ? `Respray complete. ~g~-${fmtMoney(s.cost)}~w~ — new paint, no heat.` : 'Respray complete. On the house!', 3); }
      if (car) { car.ctrl.throttle = 0; car.ctrl.brake = 1; } g.lockControls = 0.2; g.cinematic = this.spray ? 'spray' : null; return;
    }
    if (!car) return;
    for (const s of this.sprays) {
      if (car.pos.x > s.x0 && car.pos.x < s.x1 && car.pos.z > s.z0 && car.pos.z < s.z1) {
        if (car.speed > 4) { g.hud.help('Slow down to get a respray.', 0.2); return; }
        const needs = g.wanted.stars > 0 || car.health < 990; if (!needs) { g.hud.help('Your ride is already spotless.', 0.2); return; }
        const cost = g.wanted.stars > 0 ? 100 + 100 * g.wanted.stars : 100;
        if (g.cash < cost) { g.hud.help(`A respray costs ~g~${fmtMoney(cost)}~w~. Come back with more cash.`, 0.2); return; }
        this.spray = { g: s, t: 0, cost, done: false }; g.audio.garage(); return;
      }
    }
  }
}

// ======================= stunts + drift =======================
export class Stunts {
  constructor(game) { this.game = game; this.air = 0; this.takeoff = new V3(); this.maxH = 0; this.rot = { pitch: 0, roll: 0, yaw: 0 }; this.drift = 0; this.driftT = 0; this.driftCalm = 0; this.lastCar = null; }
  update(dt) {
    const g = this.game; const car = g.playerCar; if (!car) { this.air = 0; this.endDrift(false); return; }
    if (car !== this.lastCar) { this.lastCar = car; this.air = 0; }
    // no wheels touching isn't always flight: a car lying on its roof or side, or beached on something, sits still
    let airborne = car.grounded === 0;
    if (airborne && car.speed < 2 && Math.abs(car.vel.y) < 0.8) { this.restT = (this.restT || 0) + dt; if (this.restT > 0.4) this.dud = true; } else this.restT = 0;
    if (this.air > 8) this.dud = true;
    if (this.dud) { if (airborne) { this.air = 0; return; } this.dud = false; airborne = false; this.air = 0; } // (flipping back with R lands nothing)
    if (airborne) {
      if (this.air === 0) { this.takeoff.copy(car.pos); this.maxH = 0; this.rot.pitch = this.rot.roll = this.rot.yaw = 0; this.fromRamp = g.world.ramps.find((r) => Math.hypot(r.top[0] - car.pos.x, r.top[1] - car.pos.z) < 8); }
      this.air += dt; this.maxH = Math.max(this.maxH, car.pos.y - g.world.ground(car.pos.x, car.pos.z));
      this.rot.pitch += car.angVel.dot(car.left) * dt; this.rot.roll += car.angVel.dot(car.fwd) * dt; this.rot.yaw += car.angVel.dot(car.up) * dt;
      this.endDrift(false);
    } else if (this.air > 0) {
      const air = this.air; this.air = 0;
      const dist = Math.hypot(car.pos.x - this.takeoff.x, car.pos.z - this.takeoff.z);
      if (air > 0.35) g.missions.onJump(dist, air);
      g.stats.longestJump = Math.max(g.stats.longestJump, dist); g.stats.maxAir = Math.max(g.stats.maxAir, air);
      if (air > 0.85 && dist > 12) {
        const flips = Math.floor(Math.abs(this.rot.pitch) / (Math.PI * 1.7)), rolls = Math.floor(Math.abs(this.rot.roll) / (Math.PI * 1.7)), spins = Math.floor(Math.abs(this.rot.yaw) / (Math.PI * 1.8));
        const clean = car.up.y > 0.85 && car.grounded >= 3;
        let cash = Math.round((air * air * 30 + dist * 1.6 + this.maxH * 8 + (flips + rolls) * 120 + spins * 60) * (clean ? 1.5 : 1) / 5) * 5;
        const tricks = []; if (flips) tricks.push(`${flips}x FLIP`); if (rolls) tricks.push(`${rolls}x BARREL ROLL`); if (spins) tricks.push(`${spins * 180}° SPIN`); if (clean) tricks.push('PERFECT LANDING');
        const title = cash > 400 ? 'INSANE STUNT BONUS' : cash > 180 ? 'DOUBLE STUNT BONUS' : 'STUNT BONUS';
        g.addCash(cash); g.hud.stunt(title, `${dist.toFixed(1)} m · ${air.toFixed(2)} s air${tricks.length ? ' · ' + tricks.join(' · ') : ''}`, cash); g.audio.chime(true);
      }
    }
    // drifting
    if (!airborne && car.speed > 9) {
      const vx = car.vel.x, vz = car.vel.z; const vl = Math.hypot(vx, vz); const fx = car.fwd.x, fz = car.fwd.z; const fl = Math.hypot(fx, fz) || 1;
      const ang = Math.acos(clamp((vx * fx + vz * fz) / (vl * fl), -1, 1)) * 57.3;
      if (ang > 14 && ang < 110 && car.vFwd > 0) { this.drift += vl * ang * dt * 0.06; this.driftT += dt; this.driftCalm = 0; g.hud.drift(this.drift); }
      else if (this.drift > 0) { this.driftCalm += dt; if (this.driftCalm > 0.7) this.endDrift(true); }
    } else if (this.drift > 0 && car.speed < 5) this.endDrift(true);
  }
  endDrift(pay) {
    const g = this.game; if (this.drift <= 0) return;
    const score = this.drift; this.drift = 0; this.driftT = 0; this.driftCalm = 0; g.hud.drift(0);
    if (pay && score > 30) { const cash = Math.round(score / 4 / 5) * 5; g.addCash(cash); g.stats.bestDrift = Math.max(g.stats.bestDrift, Math.round(score)); g.hud.stunt('DRIFT BONUS', `${Math.round(score)} pts`, cash, true); }
  }
  crashed() { if (this.drift > 0) { this.drift = 0; this.driftT = 0; this.game.hud.drift(0, true); } }
}
void HALF; void P; void CURB;
