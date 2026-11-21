// Big Steal Car — HUD: cash, wanted stars, minimap + full map, speedometer, help prompts, popups, big messages.
import { CITY } from './config.js';
import { $, clamp, fmtMoney } from './util.js';
import { inset as insetPoly } from './world.js';

const { HALF, RW, LIMIT, P, NB, SLAB } = CITY;
const EXT = LIMIT + 30; // map extent (m)

export function fmt(s) { // GTA-style colour codes: ~y~ yellow, ~g~ green, ~r~ red, ~b~ blue, ~w~ white; [F] key caps
  let out = '', open = false;
  const parts = String(s).replace(/\[([^\[\]~<>]{1,6})\]/g, '<kbd>$1</kbd>').split(/~([ygrbw])~/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) out += parts[i];
    else { if (open) out += '</span>'; open = parts[i] !== 'w'; if (open) out += `<span class="c-${parts[i]}">`; }
  }
  if (open) out += '</span>'; return out;
}

// weapon silhouettes (white with dark outline) for the HUD and the store
export const WICON = {
  fists: '<path d="M24 8h24a6 6 0 0 1 6 6v4h4a6 6 0 0 1 0 12h-6l-4 6H26a8 8 0 0 1-8-8V14a6 6 0 0 1 6-6z"/>',
  bat: '<path d="M6 21l60-9c6-1 9 2 9 5s-3 6-9 5L6 25c-3 0-3-4 0-4z"/>',
  pistol: '<path d="M14 8h52v9H40l-2 3h-8l-4 14H14l4-14h-4z"/>',
  smg: '<path d="M8 10h56v4h8v5H64v4H44l-4 12h-8l2-12h-6l-3 10h-8l3-10H8z"/>',
  shotgun: '<path d="M4 15l18-2h52v6H40v3H30l-6 3H8l-4-2z"/>',
  rifle: '<path d="M4 15l12-3h12l2-4h12l2 4h28v5h-6v3H50l-4 13h-8l2-13H30l-6 5H8l-4-2z"/>',
};
export const wsvg = (k) => `<svg viewBox="0 0 80 40" fill="#fff" stroke="#111" stroke-width="2.5" stroke-linejoin="round">${WICON[k] || ''}</svg>`;

export class HUD {
  constructor(game) {
    this.g = game; this.el = $('#hud');
    this.cashEl = $('#cash'); this.deltaEl = $('#cashDelta'); this.starEls = [...document.querySelectorAll('#stars i')];
    this.helpEl = $('#helpBox'); this.objEl = $('#objective'); this.timerEl = $('#timer'); this.cdEl = $('#countdown');
    this.areaEl = $('#areaName'); this.vehEl = $('#vehName'); this.promptEl = $('#prompt'); this.bigEl = $('#bigMsg'); this.cardEl = $('#missionCard');
    this.stuntEl = $('#stuntPop'); this.driftEl = $('#driftPop'); this.fpsEl = $('#fps'); this.radioEl = $('#radioName'); this.hpBar = $('#hpBar i'); this.carBar = $('#carBar i'); this.clockEl = $('#clock');
    this.mapC = $('#mapCanvas'); this.mctx = this.mapC.getContext('2d'); this.spC = $('#speedCanvas'); this.sctx = this.spC.getContext('2d');
    this.shownCash = 0; this.helpT = 0; this.area = ''; this.areaT = 0; this.vehT = 0; this.bigT = 0; this.cardT = 0; this.stuntT = 0; this.radioT = 0; this.cdT = 0; this.flash = 0;
    this.waypoint = null; this.routeCache = null; this.routeT = 0;
    this.wIcon = $('#wIcon'); this.wAmmo = $('#wAmmo'); this.wBox = $('#weaponBox'); this.cross = $('#crosshair'); this.hitEl = $('#hitmark'); this.armorBar = $('#armorBar i'); this._wk = '';
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [this.mapC, this.spC]) { const r = c.getBoundingClientRect(); c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr); }
    this.dpr = dpr;
  }
  show(v) { this.el.classList.toggle('hidden', !v); if (v) setTimeout(() => this.resize(), 0); }

  // ---------- pre-rendered city map ----------
  buildMap() {
    const W = this.g.world; const S = 1400; const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    const k = S / (EXT * 2); const X = (v) => (v + EXT) * k; this.mapK = k; this.mapCanvas = c;
    x.fillStyle = '#2b5872'; x.fillRect(0, 0, S, S);
    // subtle water texture
    x.strokeStyle = 'rgba(255,255,255,0.04)'; for (let i = 0; i < S; i += 9) { x.beginPath(); x.moveTo(0, i); x.lineTo(S, i + 30); x.stroke(); }
    x.fillStyle = '#c8b98f'; x.fillRect(X(-LIMIT - 58), X(-LIMIT - 40), (58 - 2) * k, (LIMIT * 2 + 80) * k); // beach
    x.fillStyle = '#7d7a72'; x.fillRect(X(-LIMIT), X(-LIMIT), LIMIT * 2 * k, LIMIT * 2 * k);
    x.fillStyle = '#9da2a8'; const e = HALF + RW / 2; x.fillRect(X(-e), X(-e), e * 2 * k, e * 2 * k);
    const path = (pts) => { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(X(a), X(b)) : x.moveTo(X(a), X(b)))); x.closePath(); };
    for (const b of W.blocks) {
      const col = b.kind === 'park' ? '#4f7d4a' : b.kind === 'stunt' ? '#6b5d4a' : b.kind === 'parking' ? '#7c8085' : b.kind === 'plaza' ? '#8d8676' : '#5a5e64';
      for (const pc of b.pieces) { x.fillStyle = '#6f736f'; path(pc); x.fill(); x.fillStyle = col; path(insetPoly(pc, CITY.SW)); x.fill(); }
    }
    x.fillStyle = '#9da2a8'; for (const a of W.alleys) x.fillRect(X(a.x0), X(a.z0), (a.x1 - a.x0) * k, (a.z1 - a.z0) * k);
    for (const bd of W.buildings) {
      const t = clamp(bd.h / 200, 0, 1); x.fillStyle = `rgb(${62 - t * 20},${66 - t * 20},${74 - t * 18})`;
      if (bd.poly) { x.save(); x.translate(1.2, 1.2); x.fillStyle = 'rgba(0,0,0,0.25)'; path(bd.poly); x.fill(); x.restore(); x.fillStyle = `rgb(${62 - t * 20},${66 - t * 20},${74 - t * 18})`; path(bd.poly); x.fill(); continue; }
      x.fillRect(X(bd.x0), X(bd.z0), (bd.x1 - bd.x0) * k, (bd.z1 - bd.z0) * k);
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(X(bd.x0) + 1.5, X(bd.z1), (bd.x1 - bd.x0) * k, 1.5);
    }
    x.fillStyle = '#f2c14e'; for (const r of W.ramps) { x.save(); x.translate(X(r.x + Math.sin(r.yaw) * r.l / 2), X(r.z + Math.cos(r.yaw) * r.l / 2)); x.rotate(-r.yaw); x.fillRect(-r.w * k / 2, -r.l * k / 2, r.w * k, r.l * k); x.restore(); }
    // road centre lines
    x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 1;
    for (let i = 0; i <= NB; i++) { const v = i * P - HALF; x.beginPath(); x.moveTo(X(-HALF), X(v)); x.lineTo(X(HALF), X(v)); x.stroke(); x.beginPath(); x.moveTo(X(v), X(-HALF)); x.lineTo(X(v), X(HALF)); x.stroke(); }
    for (const D of W.diags) { const [ax, az] = W.nodePos(...D.nodes[0]), [bx, bz] = W.nodePos(...D.nodes[D.nodes.length - 1]); x.beginPath(); x.moveTo(X(ax), X(az)); x.lineTo(X(bx), X(bz)); x.stroke(); }
  }

  // ---------- per-frame ----------
  update(dt) {
    const g = this.g;
    // cash counter rolls toward the real value
    const diff = g.cash - this.shownCash; this.shownCash += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 6) + Math.sign(diff);
    this.cashEl.textContent = fmtMoney(this.shownCash);
    // stars
    const st = g.wanted.stars; this.flash += dt;
    // stars blink while the cops can't see you; fast blink while units are still being dispatched
    const blink = st > 0 && !g.wanted.seen && Math.floor(this.flash * (g.wanted.responding ? 6 : 3)) % 2 === 0;
    this.starEls.forEach((s, i) => { s.classList.toggle('on', i < st && !blink); s.classList.toggle('dim', i < st && blink); });
    // timers
    if (this.helpT > 0) { this.helpT -= dt; if (this.helpT <= 0) this.helpEl.classList.add('hidden'); }
    if (this.areaT > 0) { this.areaT -= dt; this.areaEl.style.opacity = clamp(this.areaT, 0, 1); }
    if (this.vehT > 0) { this.vehT -= dt; this.vehEl.style.opacity = clamp(this.vehT, 0, 1); }
    if (this.radioT > 0) { this.radioT -= dt; this.radioEl.style.opacity = clamp(this.radioT, 0, 1); }
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) this.bigEl.className = 'hidden'; }
    if (this.cardT > 0) { this.cardT -= dt; if (this.cardT <= 0) this.cardEl.classList.add('hidden'); }
    if (this.stuntT > 0) { this.stuntT -= dt; if (this.stuntT <= 0) this.stuntEl.classList.remove('show'); }
    if (this.cdT > 0) { this.cdT -= dt; if (this.cdT <= 0) this.cdEl.textContent = ''; }
    if (this.deltaT > 0) { this.deltaT -= dt; if (this.deltaT <= 0) this.deltaEl.classList.remove('show'); }
    // health bars
    this.hpBar.style.width = `${clamp(g.player.health, 0, 100)}%`; this.hpBar.parentElement.classList.toggle('low', g.player.health < 30);
    const car = g.playerCar; this.carBar.parentElement.style.opacity = car ? 1 : 0.25; this.carBar.style.width = car ? `${car.health / 10}%` : '0%';
    const W = g.weapons; this.armorBar.style.width = `${clamp(W.armor, 0, 100)}%`; this.armorBar.parentElement.style.opacity = W.armor > 0 ? 1 : 0.25;
    // crosshair + weapon readout
    const foot = !car && g.player.char.state === 'walk'; const gun = !W.w.melee;
    this.cross.classList.toggle('hidden', !foot || g.cinematic); this.cross.classList.toggle('melee', !gun);
    if (gun) this.cross.style.setProperty('--g', `${6 + (W.bloom * 22 + (g.player.char.speed > 1 ? 5 : 0)) * (W.aiming ? 0.6 : 1)}px`);
    this.weapon();
    this.clockEl.textContent = g.env.clock();
    // area name on district change
    const area = g.world.district(g.focus.x, g.focus.z); if (area !== this.area) { this.area = area; this.areaEl.textContent = area; this.areaT = 4; }
    const mode = car ? 'car' : 'foot'; if (mode !== this.mode) { this.mode = mode; this.modeT = 7; const h = document.getElementById('modeHint');
      h.innerHTML = car ? fmt('<b>DRIVING</b> [W][S] gas / brake · [A][D] steer · [Space] drift · [F] exit · [H] horn · [,][.] signals · [/] hazards · [Q] radio · [V] camera · [M] map')
        : fmt('<b>ON FOOT</b> [W][A][S][D] move · [Shift] sprint · [Space] jump · [F] steal a car · [LMB] punch / shoot · [RMB] aim · [1]-[6] weapons · [M] map'); h.classList.remove('faded'); }
    if (this.modeT > 0) { this.modeT -= dt; if (this.modeT <= 0) document.getElementById('modeHint').classList.add('faded'); }
    this.drawMinimap(); if (car) this.drawSpeedo(car); this.spC.parentElement.classList.toggle('hidden', !car);
    const flip = !!car && (car.upsideT > 0.6 || (car.up.y < 0.75 && car.speed < 3)); if (flip !== this._flip) { this._flip = flip; document.body.classList.toggle('canflip', flip); }
  }
  weapon(flash) {
    const W = this.g.weapons; const k = W.cur; const a = W.ammo[k]; const key = k + (a ? `${a.mag}/${a.res}` : '') + (W.reloadT > 0 ? 'r' : '');
    const melee = !!W.w.melee; if (melee !== this._melee) { this._melee = melee; document.body.classList.toggle('melee', melee); }
    if (key === this._wk && !flash) return; this._wk = key;
    if (this.wIcon.dataset.k !== k) { this.wIcon.innerHTML = wsvg(k); this.wIcon.dataset.k = k; }
    this.wAmmo.innerHTML = a ? (W.reloadT > 0 ? '<small>RELOADING</small>' : `${a.mag}<small> / ${a.res}</small>`) : '';
    if (flash) { this.wBox.classList.remove('flash'); void this.wBox.offsetWidth; this.wBox.classList.add('flash'); }
  }
  hitMarker(head) { this.hitEl.classList.toggle('head', !!head); this.hitEl.classList.remove('show'); void this.hitEl.offsetWidth; this.hitEl.classList.add('show'); }
  help(text, t = 3) { if (this.helpText !== text || this.helpEl.classList.contains('hidden')) { this.helpEl.innerHTML = fmt(text); this.helpText = text; } this.helpEl.classList.remove('hidden'); this.helpT = Math.max(this.helpT, t); }
  prompt(text) {
    if (text) { const h = fmt(text); if (this.promptEl.innerHTML !== h) this.promptEl.innerHTML = h; this.promptEl.classList.add('show'); } else this.promptEl.classList.remove('show');
    const on = !!text; if (on !== this._prompting) { this._prompting = on; document.body.classList.toggle('prompting', on); }
  }
  objective(t) { this.objEl.innerHTML = fmt(t || ''); }
  timer(t) { if (t == null) { this.timerEl.textContent = ''; this.timerEl.classList.remove('urgent'); return; } const m = Math.floor(t / 60), s = Math.floor(t % 60); this.timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`; this.timerEl.classList.toggle('urgent', t < 10); }
  countdown(v) { if (this._cd === v) return; this._cd = v; this.cdEl.textContent = v > 0 || v === 'GO' ? v : ''; this.cdEl.classList.remove('pop'); void this.cdEl.offsetWidth; this.cdEl.classList.add('pop'); this.cdT = v === 'GO' ? 1 : 2; if (v !== 'GO' && v > 0) this.g.audio.beep(); }
  vehicle(name) { this.vehEl.textContent = name; this.vehT = 4; }
  radio(name) { this.radioEl.textContent = name; this.radioT = 3; }
  cashDelta(n) { this.deltaEl.textContent = (n >= 0 ? '+' : '-') + fmtMoney(Math.abs(n)); this.deltaEl.classList.toggle('neg', n < 0); this.deltaEl.classList.add('show'); this.deltaT = 2.2; }
  starsUp() { this.el.classList.remove('starflash'); void this.el.offsetWidth; this.el.classList.add('starflash'); }
  big(title, sub, kind, t = 4.5) { this.bigEl.className = `show ${kind}`; this.bigEl.querySelector('.t').textContent = title; this.bigEl.querySelector('.s').innerHTML = fmt(sub || ''); this.bigT = t; }
  missionCard(name, desc, color) { this.cardEl.classList.remove('hidden'); this.cardEl.querySelector('.t').textContent = name; this.cardEl.querySelector('.t').style.color = color; this.cardEl.querySelector('.d').textContent = desc; this.cardT = 6; }
  stunt(title, detail, cash, drift) { this.stuntEl.innerHTML = `<div class="t">${title}</div><div class="d">${detail}</div><div class="c">+${fmtMoney(cash)}</div>`; this.stuntEl.classList.remove('show'); void this.stuntEl.offsetWidth; this.stuntEl.classList.add('show'); this.stuntEl.classList.toggle('drift', !!drift); this.stuntT = 3.2; }
  drift(score, broken) { if (score > 15) { this.driftEl.classList.add('show'); this.driftEl.innerHTML = `DRIFT <b>${Math.round(score)}</b>`; } else this.driftEl.classList.remove('show'); if (broken) { this.driftEl.innerHTML = 'DRIFT <b>CRASHED</b>'; this.driftEl.classList.add('show', 'broken'); setTimeout(() => this.driftEl.classList.remove('show', 'broken'), 900); } }

  // ---------- minimap ----------
  drawMinimap() {
    const g = this.g; const c = this.mapC, x = this.mctx; if (!this.mapCanvas) return;
    const w = c.width, h = c.height; const dpr = this.dpr; const f = g.focus;
    const car = g.playerCar; const zoom = (car ? clamp(1.9 - car.speed / 45, 1.05, 1.9) : 2.3) * dpr;
    const rot = g.rig.yaw - Math.PI; const cs = Math.cos(rot), sn = Math.sin(rot);
    x.save(); x.clearRect(0, 0, w, h);
    x.beginPath(); x.rect(0, 0, w, h); x.clip();
    x.fillStyle = '#2b5872'; x.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.62;
    x.translate(cx, cy); x.rotate(rot); x.scale(zoom, zoom);
    const k = this.mapK; x.imageSmoothingEnabled = true;
    x.drawImage(this.mapCanvas, -(f.x + EXT) * k, -(f.z + EXT) * k);
    // GPS route
    const route = this.routePoints(dt0);
    const toMap = (wx, wz) => [(wx - f.x) * k, (wz - f.z) * k];
    if (route && route.length > 1) { x.strokeStyle = '#c77dff'; x.lineWidth = 4 / zoom * dpr; x.lineJoin = 'round'; x.beginPath(); route.forEach(([wx, wz], i) => { const [mx, mz] = toMap(wx, wz); i ? x.lineTo(mx, mz) : x.moveTo(mx, mz); }); x.stroke(); }
    const cps = g.missions.nextCheckpoint; if (cps && cps.length) { x.strokeStyle = '#ffd60a'; x.lineWidth = 4 / zoom * dpr; x.beginPath(); x.moveTo(0, 0); for (const cp of cps) { const [mx, mz] = toMap(cp.x, cp.z); x.lineTo(mx, mz); } x.stroke(); }
    x.restore();
    // blips (drawn upright)
    const blip = (wx, wz, draw, clampEdge = true) => {
      let dx = (wx - f.x) * k * zoom, dz = (wz - f.z) * k * zoom; let u = dx * cs - dz * sn, v = dx * sn + dz * cs;
      const mx = w / 2 - 10 * dpr, myT = cy - 10 * dpr, myB = h - cy - 10 * dpr; let edge = false;
      if (u < -mx || u > mx || v < -myT || v > myB) { if (!clampEdge) return; const s = Math.min(mx / Math.abs(u || 1e-6), (v < 0 ? myT : myB) / Math.abs(v || 1e-6)); u *= s; v *= s; edge = true; }
      x.save(); x.translate(cx + u, cy + v); x.scale(dpr, dpr); draw(x, edge); x.restore();
    };
    const dot = (col, r = 4, ring = '#111') => (cx2, edge) => { cx2.fillStyle = col; cx2.strokeStyle = ring; cx2.lineWidth = 1.5; cx2.beginPath(); cx2.arc(0, 0, edge ? r * 0.8 : r, 0, 7); cx2.fill(); cx2.stroke(); };
    const icon = (col, letter, r = 7) => (cx2) => { cx2.fillStyle = col; cx2.strokeStyle = '#111'; cx2.lineWidth = 1.5; cx2.beginPath(); cx2.arc(0, 0, r, 0, 7); cx2.fill(); cx2.stroke(); cx2.fillStyle = '#111'; cx2.font = `bold ${r * 1.3}px Arial`; cx2.textAlign = 'center'; cx2.textBaseline = 'middle'; cx2.fillText(letter, 0, 1); };
    for (const s of g.world.specials.spray || []) blip(s.x, s.z, icon('#7bdff2', 'S', 6), false);
    if (g.world.specials.police) blip(g.world.specials.police.x, g.world.specials.police.z, icon('#4361ee', 'P', 6), false);
    for (const st of g.world.specials.stores || []) blip(st.x, st.z, icon('#ff8c42', 'A', 6), false);
    if (g.world.specials.hospital) blip(g.world.specials.hospital.x, g.world.specials.hospital.z, icon('#f8f9fa', '+', 6), false);
    for (const it of g.pickups.blips) blip(it.x, it.z, it.kind === 'star' ? icon('#ffd23f', '★', 6) : icon('#2ecc71', '♥', 5), false);
    for (const m of g.missions.blips) blip(m.x, m.z, icon(m.type === 'race' ? '#ffd60a' : m.type === 'stunt' ? '#38d39f' : '#ff4d6d', m.type[0].toUpperCase()));
    if (cps && cps[0]) blip(cps[0].x, cps[0].z, dot('#ffd60a', 6));
    if (this.waypoint) blip(this.waypoint[0], this.waypoint[1], (cx2) => { cx2.fillStyle = '#c77dff'; cx2.strokeStyle = '#111'; cx2.lineWidth = 1.5; cx2.beginPath(); cx2.moveTo(0, -9); cx2.lineTo(6, 0); cx2.lineTo(0, 9); cx2.lineTo(-6, 0); cx2.closePath(); cx2.fill(); cx2.stroke(); });
    const ph = Math.floor(performance.now() / 180) % 2;
    for (const car2 of g.cars) if (car2.role === 'police' && car2.siren) blip(car2.pos.x, car2.pos.z, dot(ph ? '#ff2d55' : '#2d7dff', 4.5));
    for (const cop of g.peds.cops) blip(cop.pos.x, cop.pos.z, dot(ph ? '#2d7dff' : '#ff2d55', 3), false);
    // witnesses on the phone to the cops, troublemakers who've turned hostile
    for (const r of g.wanted.reports) if (r.who.brain) blip(r.who.pos.x, r.who.pos.z, (cx2) => { cx2.fillStyle = ph ? '#ffd60a' : '#fff'; cx2.strokeStyle = '#111'; cx2.lineWidth = 1.5; cx2.beginPath(); cx2.roundRect ? cx2.roundRect(-4, -6.5, 8, 13, 2) : cx2.rect(-4, -6.5, 8, 13); cx2.fill(); cx2.stroke(); cx2.fillStyle = '#111'; cx2.fillRect(-2.5, -4.5, 5, 7); });
    for (const h of g.peds.list) if (h.naughty && ['fight', 'shootback', 'ambush'].includes(h.brain.mode)) blip(h.pos.x, h.pos.z, dot('#ff3b3b', 3.5), false);
    // player arrow
    const heading = car ? Math.atan2(car.fwd.x, car.fwd.z) : g.player.char.yaw; const a = -(heading - g.rig.yaw);
    x.save(); x.translate(cx, cy); x.scale(dpr, dpr); x.rotate(a);
    x.fillStyle = '#fff'; x.strokeStyle = '#111'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -9); x.lineTo(6.5, 7); x.lineTo(0, 3.5); x.lineTo(-6.5, 7); x.closePath(); x.fill(); x.stroke(); x.restore();
    // north marker
    const nr = Math.min(w / 2, cy) - 12 * dpr; const nu = -0 * cs - (-1) * sn, nv = -0 * sn + (-1) * cs;
    x.save(); x.translate(cx + nu * nr * 0.95, cy + nv * Math.min(nr, cy - 12 * dpr) * 0.95); x.scale(dpr, dpr); x.fillStyle = 'rgba(0,0,0,0.6)'; x.beginPath(); x.arc(0, 0, 7, 0, 7); x.fill(); x.fillStyle = '#fff'; x.font = 'bold 10px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('N', 0, 1); x.restore();
  }
  routePoints() {
    if (!this.waypoint) return null; const g = this.g; const f = g.focus;
    if (Math.hypot(f.x - this.waypoint[0], f.z - this.waypoint[1]) < 14) { this.waypoint = null; this.g.audio.checkpoint(); return null; }
    this.routeT -= 1 / 60;
    if (!this.routeCache || this.routeT <= 0) {
      this.routeT = 0.5; const W = g.world; const nodes = W.route(W.nearestNode(f.x, f.z), W.nearestNode(this.waypoint[0], this.waypoint[1]));
      this.routeCache = [[f.x, f.z], ...nodes.map((n) => W.nodePos(...n)), this.waypoint];
    } else this.routeCache[0] = [f.x, f.z];
    return this.routeCache;
  }

  // ---------- speedometer ----------
  drawSpeedo(car) {
    const c = this.spC, x = this.sctx; const rr = c.getBoundingClientRect(); if (rr.width > 0 && Math.abs(c.width - rr.width * this.dpr) > 2) { c.width = rr.width * this.dpr; c.height = rr.height * this.dpr; } const w = c.width, h = c.height; const s = Math.min(w, h); const cx = w / 2, cy = h / 2; const R = s * 0.44;
    const mph = this.g.settings.units === 'mph'; const v = Math.abs(car.vFwd) * (mph ? 2.237 : 3.6); const maxV = mph ? 200 : 320;
    x.clearRect(0, 0, w, h);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; const ang = (t) => a0 + (a1 - a0) * t;
    x.fillStyle = 'rgba(8,10,14,0.55)'; x.beginPath(); x.arc(cx, cy, R * 1.08, 0, 7); x.fill();
    // rpm arc
    const rpm = car.rpm / 7500; x.lineWidth = s * 0.035; x.lineCap = 'round';
    x.strokeStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.arc(cx, cy, R * 0.78, a0, a1); x.stroke();
    x.strokeStyle = rpm > 0.86 ? '#ff4d4d' : '#4cc9f0'; x.beginPath(); x.arc(cx, cy, R * 0.78, a0, ang(clamp(rpm, 0, 1))); x.stroke();
    // ticks
    x.lineCap = 'butt';
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, a = ang(t), big = i % 2 === 0; const r0 = R * (big ? 0.88 : 0.92);
      x.strokeStyle = i >= 17 ? '#ff6b6b' : 'rgba(255,255,255,0.85)'; x.lineWidth = s * (big ? 0.014 : 0.007);
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.stroke();
      if (big && i % 4 === 0) { x.fillStyle = 'rgba(255,255,255,0.75)'; x.font = `${Math.round(s * 0.075)}px Oswald, Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(Math.round(maxV * t)), cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66); }
    }
    // needle
    const na = ang(clamp(v / maxV, 0, 1)); x.strokeStyle = '#ff3b3b'; x.lineWidth = s * 0.018; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx - Math.cos(na) * R * 0.12, cy - Math.sin(na) * R * 0.12); x.lineTo(cx + Math.cos(na) * R * 0.9, cy + Math.sin(na) * R * 0.9); x.stroke();
    x.fillStyle = '#222'; x.beginPath(); x.arc(cx, cy, s * 0.04, 0, 7); x.fill();
    // digital readout
    x.fillStyle = '#fff'; x.font = `600 ${Math.round(s * 0.2)}px Oswald, Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(Math.round(v)), cx, cy + R * 0.45);
    x.fillStyle = 'rgba(255,255,255,0.6)'; x.font = `${Math.round(s * 0.065)}px Oswald, Arial`; x.fillText(mph ? 'MPH' : 'KM/H', cx, cy + R * 0.7);
    x.fillStyle = car.vFwd < -0.5 ? '#ffd166' : '#4cc9f0'; x.font = `600 ${Math.round(s * 0.1)}px Oswald, Arial`; x.fillText(car.vFwd < -0.5 ? 'R' : String(car.gear + 1), cx, cy - R * 0.28);
    // indicator tell-tales: green arrows that blink with the lamps, red triangle for hazards
    const U = car.model.lamps; const onL = U[2].x > 0.1, onR = U[3].x > 0.1; const ay = cy - R * 0.55, aw = s * 0.07;
    const arrow = (dir, on) => { const ax = cx + dir * R * 0.36; x.fillStyle = on ? '#3ee27a' : 'rgba(255,255,255,0.13)'; x.beginPath(); x.moveTo(ax + dir * aw, ay); x.lineTo(ax, ay - aw * 0.75); x.lineTo(ax, ay - aw * 0.32); x.lineTo(ax - dir * aw * 0.8, ay - aw * 0.32); x.lineTo(ax - dir * aw * 0.8, ay + aw * 0.32); x.lineTo(ax, ay + aw * 0.32); x.lineTo(ax, ay + aw * 0.75); x.closePath(); x.fill(); };
    if (car.signal || car.hazard || onL || onR) { arrow(-1, onL); arrow(1, onR); }
    if (car.hazard) { x.strokeStyle = onL ? '#ff4d4d' : 'rgba(255,77,77,0.35)'; x.lineWidth = s * 0.014; x.beginPath(); x.moveTo(cx, ay - aw * 0.7); x.lineTo(cx + aw * 0.7, ay + aw * 0.5); x.lineTo(cx - aw * 0.7, ay + aw * 0.5); x.closePath(); x.stroke(); }
  }

  // ---------- full map (pause menu) ----------
  drawFullMap(canvas) {
    const g = this.g; const x = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; const s = Math.min(w, h);
    x.clearRect(0, 0, w, h); x.fillStyle = '#2b5872'; x.fillRect(0, 0, w, h);
    const ox = (w - s) / 2, oy = (h - s) / 2; x.drawImage(this.mapCanvas, ox, oy, s, s);
    const M = (wx, wz) => [ox + (wx + EXT) / (EXT * 2) * s, oy + (wz + EXT) / (EXT * 2) * s];
    const ic = (wx, wz, col, letter, r = 8) => { const [px, py] = M(wx, wz); x.fillStyle = col; x.strokeStyle = '#111'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); x.stroke(); x.fillStyle = '#111'; x.font = `bold ${r * 1.25}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(letter, px, py + 1); };
    for (const s2 of g.world.specials.spray || []) ic(s2.x, s2.z, '#7bdff2', 'S');
    if (g.world.specials.police) ic(g.world.specials.police.x, g.world.specials.police.z, '#4361ee', 'P');
    for (const st of g.world.specials.stores || []) ic(st.x, st.z, '#ff8c42', 'A');
    if (g.world.specials.hospital) ic(g.world.specials.hospital.x, g.world.specials.hospital.z, '#f8f9fa', '+');
    for (const it of g.pickups.blips) ic(it.x, it.z, it.kind === 'star' ? '#ffd23f' : '#2ecc71', it.kind === 'star' ? '★' : '♥', 6);
    for (const m of g.missions.list) { ic(m.start[0], m.start[1], m.type === 'race' ? '#ffd60a' : m.type === 'stunt' ? '#38d39f' : '#ff4d6d', m.type[0].toUpperCase(), 10); const [px, py] = M(m.start[0], m.start[1]); x.fillStyle = '#fff'; x.font = '600 12px Oswald, Arial'; x.fillText(m.name + (g.save.done[m.id] ? ' ✓' : ''), px, py + 20); }
    x.font = `bold ${Math.round(s * 0.024)}px Oswald, Arial`; x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,0.6)'; x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 3;
    for (const [t, lx, lz] of [['CENTRAL SPIRE', 0, 0], ['MIDTOWN', 0, -260], ['SUNSET HEIGHTS', -300, -60], ['RUSTWATER', 300, -120], ['PORT BELLMONT', 0, 300], ['STUNT YARD', 264, -264]]) { const [px, py] = M(lx, lz); x.strokeText(t, px, py); x.fillText(t, px, py); }
    if (this.waypoint) { const [px, py] = M(...this.waypoint); x.fillStyle = '#c77dff'; x.beginPath(); x.moveTo(px, py - 12); x.lineTo(px + 8, py); x.lineTo(px, py + 12); x.lineTo(px - 8, py); x.fill(); }
    const f = g.focus; const [px, py] = M(f.x, f.z); const hd = g.playerCar ? Math.atan2(g.playerCar.fwd.x, g.playerCar.fwd.z) : g.player.char.yaw;
    x.save(); x.translate(px, py); x.rotate(-hd + Math.PI); x.fillStyle = '#fff'; x.strokeStyle = '#111'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -12); x.lineTo(8, 9); x.lineTo(0, 4); x.lineTo(-8, 9); x.closePath(); x.fill(); x.stroke(); x.restore();
    return (cx, cy) => { const wx = (cx - ox) / s * EXT * 2 - EXT, wz = (cy - oy) / s * EXT * 2 - EXT; return [wx, wz]; };
  }
}
const dt0 = 1 / 60;
