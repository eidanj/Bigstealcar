// Big Steal Car — menus: Altekz intro, GTA-style main menu, loading screen, settings, pause menu with map.
import { $, el, fmtMoney } from './util.js';
import { VERSION } from './config.js';

const TIPS = [
  'Hit ramps at full speed for big stunt bonuses. Flips and perfect landings pay extra.',
  'Hold Space while turning to pull a handbrake drift. Long drifts earn cash.',
  'Pay & Spray garages give your car a new paint job and wipe your wanted level.',
  'Gold stars hidden in alleys clear your wanted level for free.',
  'Police lose track of you when you break line of sight. Your stars flash while they search.',
  'Press M to open the map, then click anywhere to set a GPS waypoint.',
  'Press Q in a car to flip through the radio stations.',
  'Knocking over streetlights is great fun. The police disagree.',
  'Jump out of a moving car with F. It hurts a little.',
  'If your car lands on its roof, press R to flip it back over.',
  'The Zentra R supercar is rare. Keep an eye out for it in parking spots.',
  'Press V to switch between near, far and hood cameras.',
];
const CONTROLS = [
  ['On foot', [['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['F / E', 'Enter or steal a car'], ['Mouse', 'Look around']]],
  ['Driving', [['W / S', 'Accelerate / brake & reverse'], ['A / D', 'Steer'], ['Space', 'Handbrake drift'], ['F / E', 'Exit (bail out at speed)'], ['H', 'Horn'], ['Q', 'Radio station'], ['V', 'Camera view'], ['C', 'Look behind'], ['R', 'Flip car upright'], ['W S A D in the air', 'Flip and roll']]],
  ['General', [['M', 'Map + waypoint'], ['Esc / P', 'Pause menu'], ['Click', 'Capture the mouse']]],
];
const OPTS = {
  quality: [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']],
  time: [['dynamic', 'DAY/NIGHT CYCLE'], ['day', 'MIDDAY'], ['sunset', 'GOLDEN HOUR'], ['night', 'NIGHT'], ['dawn', 'DAWN']],
  dayMinutes: [[12, '12 MIN'], [24, '24 MIN'], [48, '48 MIN']],
  units: [['mph', 'MPH'], ['kmh', 'KM/H']],
  invertY: [[false, 'OFF'], [true, 'ON']], showFps: [[false, 'OFF'], [true, 'ON']],
};

export class UI {
  constructor(game) {
    this.g = game; this.tipI = Math.floor(Math.random() * TIPS.length);
    $('#ver').textContent = VERSION;
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { this.g.audio.ui(); this.go(b.dataset.go); }));
    document.querySelectorAll('.mainNav button').forEach((b) => b.addEventListener('mouseenter', () => this.g.audio.ui()));
    $('#playBtn').addEventListener('click', () => { this.g.audio.ui(); this.g.startPlay(); });
    // pause tabs
    document.querySelectorAll('#pause .tabs button').forEach((b) => b.addEventListener('click', () => { this.g.audio.ui(); this.tab(b.dataset.tab); }));
    $('#resumeBtn').addEventListener('click', () => this.g.resume());
    $('#quitBtn').addEventListener('click', () => this.g.quitToMenu());
    $('#clearWp').addEventListener('click', () => { this.g.hud.waypoint = null; this.drawMap(); });
    const mc = $('#fullMap');
    mc.addEventListener('click', (e) => { const r = mc.getBoundingClientRect(); const toW = this.mapInv; if (!toW) return; const [wx, wz] = toW((e.clientX - r.left) * (mc.width / r.width), (e.clientY - r.top) * (mc.height / r.height)); this.g.hud.waypoint = [wx, wz]; this.g.hud.routeCache = null; this.g.audio.checkpoint(); this.drawMap(); });
    this.buildControls($('#controlsList')); this.buildControls($('#pauseControls'));
    this.buildSettings($('#settingsList')); this.buildSettings($('#pauseSettings'));
    setInterval(() => this.nextTip(), 6500); this.nextTip();
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
    for (const [title, rows] of CONTROLS) {
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
    slider('sens', 'Mouse sensitivity', 0.3, 3, 0.1, (v) => v.toFixed(1)); pick('invertY', 'Invert look');
    slider('fov', 'Field of view', 50, 80, 1, (v) => `${v}°`); pick('units', 'Speed units'); pick('showFps', 'Show FPS');
  }
  syncSettings(except) { for (const r of document.querySelectorAll('.setRow')) if (r !== except && r._upd) r._upd(); }

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
