// Big Steal Car — menus: Altekz intro, GTA-style main menu, loading screen, settings, pause menu with map.
import { $, el, fmtMoney, clamp } from './util.js';
import { VERSION, WEAPONS, ARMOR_PRICE } from './config.js';
import { wsvg } from './hud.js';

const TIPS = [
  'Hit ramps at full speed for big stunt bonuses. Flips and perfect landings pay extra.',
  'Hold Space while turning to pull a handbrake drift. Long drifts earn cash.',
  'Pay & Spray garages give your car a new paint job and wipe your wanted level.',
  'Gold stars hidden in alleys clear your wanted level for free.',
  'Police lose track of you when you break line of sight. Your stars flash while they search.',
  'Press M to open the map, then click anywhere to set a GPS waypoint.',
  'Press Q in a car to flip through the radio stations.',
  'Knocking over streetlights is great fun. The police disagree, if anyone tells them.',
  'Witnesses have to phone the cops. A yellow phone on the minimap means someone is calling. Stop them or get away.',
  'Some people on the street are trouble. Punch the wrong guy and he punches back.',
  'Use , and . for turn signals and / for hazard lights.',
  'Jump out of a moving car with F. It hurts a little.',
  'If your car lands on its roof, press R to flip it back over.',
  'Blast Barn gun stores sell weapons, ammo and body armor. Walk in and press F at the counter.',
  'At three stars the police stop asking nicely. Body armor helps.',
  'The Zentra R supercar is rare. Keep an eye out for it in parking spots.',
  'Press V to switch between near, far and hood cameras.',
];
const CONTROLS = [
  ['On foot', [['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['F / E', 'Enter or steal a car'], ['Mouse', 'Look around']]],
  ['Driving', [['W / S', 'Accelerate / brake & reverse'], ['A / D', 'Steer'], ['Space', 'Handbrake drift'], ['F / E', 'Exit (bail out at speed)'], ['H', 'Horn'], [', / .', 'Left / right turn signal'], ['/', 'Hazard lights'], ['Q', 'Radio station'], ['V', 'Camera view'], ['C', 'Look behind'], ['R', 'Flip car upright'], ['W S A D in the air', 'Flip and roll']]],
  ['Weapons', [['Left mouse', 'Punch / shoot'], ['Right mouse', 'Aim (over the shoulder)'], ['1-6 / wheel', 'Switch weapon'], ['R', 'Reload'], ['F at a counter', 'Shop at Blast Barn']]],
  ['General', [['M', 'Map + waypoint'], ['Esc / P', 'Pause menu'], ['Click', 'Capture the mouse']]],
];
const TOUCH_CONTROLS = [
  ['On foot', [['Left stick', 'Move (push to the edge to sprint)'], ['Drag right side', 'Look around'], ['FIRE', 'Punch / shoot (drag it to aim while firing)'], ['AIM', 'Aim over the shoulder (tap to toggle)'], ['JUMP', 'Jump'], ['F', 'Steal a car / shop (or tap the prompt)'], ['SWAP · RELOAD', 'Switch weapon · reload']]],
  ['Driving', [['GAS / BRAKE', 'Right thumb, slide between them (hold BRAKE to reverse)'], ['◀ ▶', 'Left thumb steering, slide between them'], ['DRIFT', 'Handbrake slide'], ['EXIT', 'Get out (bail out at speed)'], ['Signal arrows · ⚠', 'Turn signals · hazard lights'], ['HORN · RADIO · CAM', 'Horn, radio station, camera view'], ['FLIP', 'Appears when your car is on its roof'], ['Drag the screen', 'Look around the car']]],
  ['General', [['❚❚', 'Pause menu + map (tap the map to set a waypoint)'], ['⛶', 'Full screen on / off (if your browser supports it)']]],
];
const OPTS = {
  quality: [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']],
  time: [['dynamic', 'DAY/NIGHT CYCLE'], ['day', 'MIDDAY'], ['sunset', 'GOLDEN HOUR'], ['night', 'NIGHT'], ['dawn', 'DAWN']],
  dayMinutes: [[12, '12 MIN'], [24, '24 MIN'], [48, '48 MIN']],
  units: [['mph', 'MPH'], ['kmh', 'KM/H']],
  invertY: [[false, 'OFF'], [true, 'ON']], showFps: [[false, 'OFF'], [true, 'ON']],
  touch: [['auto', 'AUTO'], ['on', 'ON'], ['off', 'OFF']],
};

export class UI {
  constructor(game) {
    this.g = game; this.tipI = Math.floor(Math.random() * TIPS.length);
    $('#ver').textContent = VERSION;
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { this.g.audio.ui(); this.go(b.dataset.go); }));
    document.querySelectorAll('.mainNav button').forEach((b) => b.addEventListener('mouseenter', () => this.g.audio.ui()));
    $('#playBtn').addEventListener('click', () => { this.g.audio.ui(); this.g.firstPlayFullscreen(); this.g.startPlay(); });
    // pause tabs
    document.querySelectorAll('#pause .tabs button').forEach((b) => b.addEventListener('click', () => { this.g.audio.ui(); this.tab(b.dataset.tab); }));
    $('#resumeBtn').addEventListener('click', () => this.g.resume());
    $('#pResume').addEventListener('click', () => this.g.resume());
    $('#quitBtn').addEventListener('click', () => this.g.quitToMenu());
    $('#clearWp').addEventListener('click', () => { this.g.hud.waypoint = null; this.drawMap(); });
    const mc = $('#fullMap');
    mc.addEventListener('click', (e) => { const r = mc.getBoundingClientRect(); const toW = this.mapInv; if (!toW) return; const [wx, wz] = toW((e.clientX - r.left) * (mc.width / r.width), (e.clientY - r.top) * (mc.height / r.height)); this.g.hud.waypoint = [wx, wz]; this.g.hud.routeCache = null; this.g.audio.checkpoint(); this.drawMap(); });
    this.buildControls($('#controlsList')); this.buildControls($('#pauseControls'));
    this.buildSettings($('#settingsList')); this.buildSettings($('#pauseSettings'));
    setInterval(() => this.nextTip(), 6500); this.nextTip();
    $('#shopList').addEventListener('click', (e) => { const row = e.target.closest('.sRow'); if (!row) return; const r = this.g.weapons.buy(row.dataset.item); if (r !== 'ok') this.g.audio.uiBack(); this.renderShop(r === 'ok' ? 'Thanks for shopping at Blast Barn!' : r); });
    $('#shopClose').addEventListener('click', () => this.g.closeShop());
  }
  nextTip() { this.tipI = (this.tipI + 1) % TIPS.length; for (const t of document.querySelectorAll('.tipText')) { t.classList.remove('in'); void t.offsetWidth; t.textContent = TIPS[this.tipI]; t.classList.add('in'); } }
  go(screen) {
    for (const s of ['menuMain', 'menuSettings', 'menuControls', 'menuCredits', 'menuMissions']) $('#' + s).classList.toggle('hidden', s !== screen);
    if (screen === 'menuMissions') this.renderMissions($('#missionList'));
  }
  showMenu() { $('#menu').classList.remove('hidden'); this.go('menuMain'); $('#menuCash').textContent = fmtMoney(this.g.cash); }
  hideMenu() { $('#menu').classList.add('hidden'); }
  loading(show) { $('#loading').classList.toggle('hidden', !show); }

  buildControls(root) {
    root.innerHTML = '';
    for (const [title, rows] of (this.g.touch ? TOUCH_CONTROLS.concat([['Keyboard', []]], CONTROLS) : CONTROLS)) {
      const sec = el('div', 'ctlSec'); sec.appendChild(el('h4', '', title));
      for (const [k, v] of rows) sec.appendChild(el('div', 'ctlRow', `<span>${v}</span><b>${k.split(' / ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</b>`));
      root.appendChild(sec);
    }
  }
  buildSettings(root) {
    const g = this.g; root.innerHTML = '';
    const pick = (key, label) => {
      const row = el('div', 'setRow'); const opts = OPTS[key];
      const val = () => { const i = opts.findIndex(([v]) => v === g.settings[key]); return i < 0 ? 0 : i; };
      row.innerHTML = `<span>${label}</span><div class="picker"><button class="arr">◀</button><b></b><button class="arr">▶</button></div>`;
      const b = row.querySelector('b'); const upd = () => { b.textContent = opts[val()][1]; };
      const [l, r] = row.querySelectorAll('button');
      const step = (d) => { const i = (val() + d + opts.length) % opts.length; g.settings[key] = opts[i][0]; upd(); g.audio.ui(); g.applySettings(key); this.syncSettings(); };
      l.onclick = () => step(-1); r.onclick = () => step(1); row.addEventListener('wheel', (e) => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1); }, { passive: false });
      row._upd = upd; upd(); root.appendChild(row);
    };
    const slider = (key, label, min, max, stepv, fmt) => {
      const row = el('div', 'setRow'); row.innerHTML = `<span>${label}</span><div class="slide"><input type="range" min="${min}" max="${max}" step="${stepv}"><b></b></div>`;
      const inp = row.querySelector('input'), b = row.querySelector('b'); const upd = () => { inp.value = g.settings[key]; b.textContent = fmt(g.settings[key]); };
      inp.oninput = () => { g.settings[key] = parseFloat(inp.value); b.textContent = fmt(g.settings[key]); g.applySettings(key); this.syncSettings(row); };
      row._upd = upd; upd(); root.appendChild(row);
    };
    pick('quality', 'Graphics quality'); pick('time', 'Time of day'); pick('dayMinutes', 'Length of a day');
    slider('volume', 'Master volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}`); slider('music', 'Radio & music', 0, 1, 0.05, (v) => `${Math.round(v * 100)}`);
    slider('sens', 'Look sensitivity', 0.3, 3, 0.1, (v) => v.toFixed(1)); pick('invertY', 'Invert look');
    slider('fov', 'Field of view', 50, 80, 1, (v) => `${v}°`); pick('units', 'Speed units'); pick('showFps', 'Show FPS'); pick('touch', 'Touch controls');
  }
  syncSettings(except) { for (const r of document.querySelectorAll('.setRow')) if (r !== except && r._upd) r._upd(); }

  // ---------- gun store ----------
  openShop() { $('#shop').classList.remove('hidden'); this.renderShop('What can I get you?'); }
  closeShop() { $('#shop').classList.add('hidden'); }
  renderShop(msg) {
    const g = this.g, W = g.weapons; const rows = [];
    const stat = (label, v) => `<span>${label}<i><em style="width:${Math.round(clamp(v, 0.04, 1) * 100)}%"></em></i></span>`;
    for (const k of ['bat', 'pistol', 'smg', 'shotgun', 'rifle']) {
      const w = WEAPONS[k]; const owned = W.owned[k]; let btn;
      if (!owned) btn = `<div class="sBuy ${g.cash < w.price ? 'poor' : ''}">BUY<small>${fmtMoney(w.price)}</small></div>`;
      else if (w.melee) btn = '<div class="sBuy owned">OWNED</div>';
      else btn = `<div class="sBuy ammo ${g.cash < w.ammo[1] ? 'poor' : ''}">+${w.ammo[0]} AMMO<small>${fmtMoney(w.ammo[1])} · have ${W.ammo[k].mag + W.ammo[k].res}</small></div>`;
      const dmg = (w.dmg * (w.pellets || 1)) / 115, rate = w.melee ? 0.25 : 0.026 / w.rate, range = w.melee ? 0.04 : w.range / 170;
      rows.push(`<div class="sRow" data-item="${k}">${wsvg(k)}<div><b>${w.name}</b><p>${w.desc}</p><div class="sStats">${stat('DMG', dmg)}${stat('RATE', rate)}${stat('RANGE', range)}</div></div>${btn}</div>`);
    }
    rows.push(`<div class="sRow" data-item="armor"><svg viewBox="0 0 80 40" fill="#4ea8ff" stroke="#111" stroke-width="2.5"><path d="M40 3l18 5v11c0 9-8 15-18 18C30 34 22 28 22 19V8z"/></svg><div><b>Body Armor</b><p>Soaks up most of the damage from police gunfire.</p><div class="sStats"><span>ARMOR ${Math.round(W.armor)}/100</span></div></div><div class="sBuy ${W.armor >= 100 ? 'owned' : g.cash < ARMOR_PRICE ? 'poor' : ''}">${W.armor >= 100 ? 'FULL' : 'BUY'}<small>${fmtMoney(ARMOR_PRICE)}</small></div></div>`);
    $('#shopList').innerHTML = rows.join(''); $('#shopCash').textContent = fmtMoney(g.cash); $('#shopMsg').textContent = msg || '';
  }

  // ---------- pause menu ----------
  openPause(tab = 'map') { const p = $('#pause'); p.classList.remove('hidden'); this.tab(tab); this.header(); }
  closePause() { $('#pause').classList.add('hidden'); }
  header() { $('#pCash').textContent = fmtMoney(this.g.cash); $('#pTime').textContent = this.g.env.clock(); $('#pArea').textContent = this.g.world.district(this.g.focus.x, this.g.focus.z); }
  tab(name) {
    document.querySelectorAll('#pause .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('#pause .pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== name));
    if (name === 'map') this.drawMap(); if (name === 'stats') this.renderStats(); if (name === 'missions') this.renderMissions($('#pauseMissions'));
    this.curTab = name;
  }
  drawMap() { const c = $('#fullMap'); const r = c.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); c.width = Math.max(300, r.width * dpr); c.height = Math.max(300, r.height * dpr); this.mapInv = this.g.hud.drawFullMap(c); }
  renderStats() {
    const s = this.g.stats; const mph = this.g.settings.units === 'mph';
    const rows = [['Cash', fmtMoney(this.g.cash)], ['Total earned', fmtMoney(s.earned)], ['Missions passed', s.missions], ['Cars stolen', s.stolen], ['Top speed', `${Math.round(s.topSpeed * (mph ? 2.237 : 3.6))} ${mph ? 'mph' : 'km/h'}`], ['Distance driven', `${(s.dist / (mph ? 1609 : 1000)).toFixed(1)} ${mph ? 'mi' : 'km'}`], ['Longest jump', `${s.longestJump.toFixed(1)} m`], ['Most air time', `${s.maxAir.toFixed(2)} s`], ['Best drift', `${s.bestDrift} pts`], ['People bumped', s.knocked], ['Streetlights flattened', s.lights], ['Cops escaped', s.escapes], ['Times busted', s.busted], ['Times knocked out', s.ko]];
    $('#statsList').innerHTML = rows.map(([a, b]) => `<div class="statRow"><span>${a}</span><b>${b}</b></div>`).join('');
  }
  renderMissions(root) {
    const g = this.g; const col = { race: '#ffd60a', stunt: '#38d39f', getaway: '#ff4d6d' };
    root.innerHTML = g.missions.list.map((m) => `<div class="mRow"><i style="background:${col[m.type]}">${m.type[0].toUpperCase()}</i><div><b>${m.name}${g.save.done[m.id] ? ' <span class="done">✓ PASSED</span>' : ''}</b><p>${m.desc}</p></div><em>${fmtMoney(m.reward)}+</em></div>`).join('');
  }
}
