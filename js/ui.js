// Big Steal Car — menus: Altekz intro, GTA-style main menu, loading screen, settings, pause menu with map.
import { $, el, fmtMoney, clamp } from './util.js';
import { VERSION, WEAPONS, ARMOR_PRICE, CAR_TYPES, PAINT, POLICE_RANKS } from './config.js';
import { wsvg } from './hud.js';

const TIPS = [
  'Hit ramps at full speed for big stunt bonuses. Flips and perfect landings pay extra.',
  'Hold Space while turning to pull a handbrake drift. Long drifts earn cash.',
  'Pay & Spray garages give your car a new paint job and wipe your wanted level.',
  'Totaled a car you bought? Walk up to it and press F, or press R inside it, to fix it for $200.',
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
  'Big Deal Autos sells every car in town. Buy one and it waits for you at the delivery bay, and you can have it brought round any time.',
  'Want to be on the other side? Walk up to the police station front desk and join the force.',
  'On duty, tap H in your cruiser for lights and siren. Traffic pulls over for you.',
  'Hold a suspect at gunpoint and they often give up. Sprint into a runner to tackle them.',
  'Every car has its own headlights and taillights. Watch for the round tails of the old Cruisemaster at night.',
];
const CONTROLS = [
  ['On foot', [['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['F / E', 'Enter or steal a car'], ['Mouse', 'Look around']]],
  ['Driving', [['W / S', 'Accelerate / brake & reverse'], ['A / D', 'Steer'], ['Space', 'Handbrake drift'], ['F / E', 'Exit (bail out at speed)'], ['H', 'Horn'], [', / .', 'Left / right turn signal'], ['/', 'Hazard lights'], ['Q', 'Radio station'], ['V', 'Camera view'], ['C', 'Look behind'], ['R', 'Flip car upright'], ['W S A D in the air', 'Flip and roll']]],
  ['Weapons', [['Left mouse', 'Punch / shoot'], ['Right mouse', 'Aim (over the shoulder)'], ['1-6 / wheel', 'Switch weapon'], ['R', 'Reload'], ['F at a counter', 'Shop at Blast Barn']]],
  ['Police job', [['F at the station door', 'Join / start or end a shift'], ['H (tap)', 'Lights and siren in a cruiser'], ['H (hold)', 'Horn'], ['Right mouse at a suspect', 'Hold them at gunpoint'], ['Sprint into a runner', 'Tackle'], ['F next to a suspect', 'Arrest / write a ticket']]],
  ['Car dealership', [['F at the sales desk', 'Buy cars, deliver your own']]],
  ['General', [['M', 'Map + waypoint'], ['Esc / P', 'Pause menu'], ['Click', 'Capture the mouse']]],
];
const TOUCH_CONTROLS = [
  ['On foot', [['Left stick', 'Move (push to the edge to sprint)'], ['Drag right side', 'Look around'], ['FIRE', 'Punch / shoot (drag it to aim while firing)'], ['AIM', 'Aim over the shoulder (tap to toggle)'], ['JUMP', 'Jump'], ['F', 'Steal a car / shop (or tap the prompt)'], ['SWAP · RELOAD', 'Switch weapon · reload']]],
  ['Driving', [['GAS / BRAKE', 'Right thumb, slide between them (hold BRAKE to reverse)'], ['◀ ▶', 'Left thumb steering, slide between them'], ['DRIFT', 'Handbrake slide'], ['EXIT', 'Get out (bail out at speed)'], ['Signal arrows · ⚠', 'Turn signals · hazard lights'], ['HORN · RADIO · CAM', 'Horn, radio station, camera view'], ['FLIP', 'Appears when your car is on its roof'], ['Drag the screen', 'Look around the car']]],
  ['Police job', [['F at the station door', 'Join / start or end a shift'], ['HORN (tap)', 'Lights and siren in a cruiser'], ['AIM at a suspect', 'Hold them at gunpoint'], ['F next to a suspect', 'Arrest / write a ticket']]],
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
    $('#shopList').addEventListener('click', (e) => {
      const g = this.g; const sw = e.target.closest('[data-color]'); if (sw) { g.dealer.color = parseInt(sw.dataset.color, 10); g.audio.ui(); this.renderDealer(''); return; }
      const row = e.target.closest('.sRow'); if (!row || row.classList.contains('off')) return;
      if (this.kind === 'dealer') return this.dealerAct(row.dataset.act);
      if (this.kind === 'police') return this.policeAct(row.dataset.act);
      const r = g.weapons.buy(row.dataset.item); if (r !== 'ok') g.audio.uiBack(); this.renderShop(r === 'ok' ? 'Thanks for shopping at Blast Barn!' : r);
    });
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

  // ---------- shops: gun store, car dealership, police front desk ----------
  openShop(kind = 'guns') {
    this.kind = kind; const s = $('#shop'); s.classList.remove('hidden'); s.dataset.kind = kind;
    const head = { guns: ['BLAST BARN', 'GUNS · AMMO · ARMOR', 'LEAVE COUNTER'], dealer: ['BIG DEAL AUTOS', 'NEW · USED · BIGGER', 'LEAVE SHOWROOM'], police: ['SAN ALTEKZ PD', 'FRONT DESK · TO PROTECT AND SERVE', 'LEAVE DESK'] }[kind];
    s.querySelector('.shopLogo').textContent = head[0]; s.querySelector('.shopSub').textContent = head[1]; $('#shopClose').textContent = head[2];
    s.querySelector('.shopFoot span').innerHTML = kind === 'guns' ? '<kbd>Click</kbd> buy &nbsp; <kbd>Esc</kbd> leave' : '<kbd>Click</kbd> choose &nbsp; <kbd>Esc</kbd> leave';
    if (kind === 'dealer') this.renderDealer('Welcome to Big Deal Autos! Pick a colour, then pick your ride.');
    else if (kind === 'police') this.renderPolice('');
    else this.renderShop('What can I get you?');
  }
  dealerAct(act) {
    const g = this.g; const [k, v] = act.split(':');
    if (k === 'buy') { const r = g.dealer.buy(v); if (r === 'ok') { this.renderDealer(`Congratulations! Your new ${CAR_TYPES[v].name} is waiting at the delivery bay outside.`); g.audio.chime(true); } else { g.audio.uiBack(); this.renderDealer(r); } }
    else if (k === 'deliver') { const was = g.save.garage[+v] && g.save.garage[+v].wrecked; const r = g.dealer.deliver(+v); if (r === 'ok') { g.audio.ui(); this.renderDealer(was ? 'Fixed up good as new and brought round to the delivery bay. -$200' : 'Your car has been brought round to the delivery bay.'); } else { g.audio.uiBack(); this.renderDealer(r); } }
  }
  renderDealer(msg) {
    const g = this.g, D = g.dealer; const rows = [];
    const stat = (label, v) => `<span>${label}<i><em style="width:${Math.round(clamp(v, 0.04, 1) * 100)}%"></em></i></span>`;
    rows.push(`<div class="swatches">${PAINT.map((c) => `<button data-color="${c}" class="${c === D.color ? 'on' : ''}" style="background:#${c.toString(16).padStart(6, '0')}"></button>`).join('')}</div>`);
    if (g.save.garage.length) {
      rows.push('<h5>YOUR GARAGE</h5>');
      g.save.garage.forEach((e, i) => { const t = CAR_TYPES[e.type]; rows.push(`<div class="sRow car mine" data-act="deliver:${i}"><img src="${D.thumb(e.type)}" alt=""><div><b>${t.name}${e.wrecked ? ' <small class="wreck">TOTALED</small>' : ''}</b><p><i class="chip" style="background:#${(e.color >>> 0).toString(16).padStart(6, '0')}"></i>${t.cls}</p></div>${e.wrecked ? `<div class="sBuy ${g.cash < 200 ? 'poor' : ''}">REPAIR<small>$200 + delivery</small></div>` : '<div class="sBuy ammo">DELIVER<small>free</small></div>'}</div>`); });
      rows.push('<h5>FOR SALE</h5>');
    }
    for (const t of D.list) {
      const s = D.stats(t);
      rows.push(`<div class="sRow car" data-act="buy:${t.key}"><img src="${D.thumb(t.key)}" alt=""><div><b>${t.name} <small>${t.cls}</small></b><div class="sStats">${stat('SPEED', s.speed)}${stat('ACCEL', s.accel)}${stat('GRIP', s.handling)}</div></div><div class="sBuy ${g.cash < t.price ? 'poor' : ''}">BUY<small>${fmtMoney(t.price)}</small></div></div>`);
    }
    const list = $('#shopList'); const top = list.scrollTop; list.innerHTML = rows.join(''); list.scrollTop = top; $('#shopCash').textContent = fmtMoney(g.cash); $('#shopMsg').textContent = msg || '';
  }
  policeAct(act) {
    const g = this.g, P = g.police; let r = 'ok', msg = '';
    if (act === 'join') { r = P.join(); msg = r === 'ok' ? 'Welcome to the San Altekz Police Department, officer. Suit up and pick a shift.' : r; }
    else if (act === 'calls' || act === 'patrol') { r = P.goOnDuty(act); msg = r === 'ok' ? (act === 'calls' ? 'You\'re on 911 calls. Your cruiser is parked out front. Dispatch will send you jobs.' : 'You\'re on patrol. Your cruiser is parked out front. Cover ground and stop crime you see.') : r; if (r === 'ok') setTimeout(() => g.closeShop(), 900); }
    else if (act === 'off') { P.offDuty(); msg = 'Shift over. See you tomorrow.'; }
    else if (act === 'resign') { P.resign(); msg = 'You handed in your badge.'; }
    if (r !== 'ok') g.audio.uiBack(); else g.audio.ui();
    this.renderPolice(msg);
  }
  renderPolice(msg) {
    const g = this.g, P = g.police, s = P.s; const rows = []; const nx = P.nextRank;
    const row = (act, title, desc, btn, cls = '') => `<div class="sRow desk ${cls}" data-act="${act}"><svg viewBox="0 0 80 40"><path d="M40 4l20 6v10c0 9-9 15-20 17C29 35 20 29 20 20V10z" fill="#4ea8ff" stroke="#111" stroke-width="2.5"/><text x="40" y="26" font-size="12" text-anchor="middle" fill="#111" font-weight="bold">SAPD</text></svg><div><b>${title}</b><p>${desc}</p></div><div class="sBuy">${btn}</div></div>`;
    if (!s.joined) rows.push(row('join', 'Join the force', 'Sign up as an officer. Answer 911 calls or patrol the city, arrest suspects and get paid. Climb the ranks for better pay and a bigger cruiser.', 'APPLY'));
    else {
      rows.push(`<div class="badge"><b>${P.rank.name.toUpperCase()}</b><span>${s.arrests} arrests · ${s.tickets} tickets · ${fmtMoney(s.earned)} earned</span>${nx ? `<span>Next rank: ${nx.name} at ${nx.at} arrests · pay x${nx.pay}</span>` : '<span>Top rank. The city is yours to protect.</span>'}</div>`);
      rows.push(row('calls', P.onDuty && P.mode === 'calls' ? 'On 911 calls' : 'Shift: answer 911 calls', 'Dispatch sends you to crimes across the city: fights, robberies, stolen cars, reckless drivers. Arrest the suspect for pay.', P.onDuty && P.mode === 'calls' ? 'ACTIVE' : 'START', P.onDuty && P.mode === 'calls' ? 'off' : ''));
      rows.push(row('patrol', P.onDuty && P.mode === 'patrol' ? 'On patrol' : 'Shift: patrol the city', 'Drive your beat and get paid for the ground you cover. Stop the crimes you spot along the way.', P.onDuty && P.mode === 'patrol' ? 'ACTIVE' : 'START', P.onDuty && P.mode === 'patrol' ? 'off' : ''));
      if (P.onDuty) rows.push(row('off', 'End shift', 'Hand back the cruiser and change out of uniform.', 'CLOCK OUT'));
      rows.push(row('resign', 'Resign', 'Quit the force. You can apply again later.', 'RESIGN'));
    }
    $('#shopList').innerHTML = rows.join(''); $('#shopCash').textContent = fmtMoney(g.cash); $('#shopMsg').textContent = msg || '';
  }
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
