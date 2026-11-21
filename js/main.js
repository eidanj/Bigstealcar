// Big Steal Car — entry point: Altekz intro + loading, renderer/post, game state, simulation loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { DEFAULT_SETTINGS, PAINT, TRAFFIC_MIX, PARKED_MIX, CITY } from './config.js';
import { $, clamp, damp, R, isTouch, fmtMoney } from './util.js';
import { setAnisotropy } from './textures.js';
import { World } from './world.js';
import { Props } from './props.js';
import { Environment } from './sky.js';
import { CarFactory, Wheels } from './cars.js';
import { Vehicle, collideCars } from './vehicle.js';
import { HumanRenderer, Character } from './humans.js';
import { Peds, randomLook } from './peds.js';
import { Player } from './player.js';
import { TrafficDriver, PoliceDriver, Population } from './ai.js';
import { Wanted, Missions, Pickups, Stunts } from './gameplay.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { UI } from './ui.js';
import { Weapons } from './weapons.js';

const V3 = THREE.Vector3;
const pickWeighted = (list) => { const tot = list.reduce((s, [, w]) => s + w, 0); let r = Math.random() * tot; for (const [k, w] of list) { r -= w; if (r <= 0) return k; } return list[0][0]; };

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.9 }, uSat: { value: 1.12 }, uDesat: { value: 0 }, uFlash: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uContrast: { value: 1.06 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uSat, uDesat, uFlash, uContrast; uniform vec3 uTint; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb; float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, uSat); col = (col - 0.5) * uContrast + 0.5; col = mix(col, vec3(l) * uTint, uDesat);
      vec2 d = vUv - 0.5; col *= 1.0 - dot(d, d) * uVig; col += uFlash; gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a); }`,
};

class Game {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem('bsc_settings') || '{}')) };
    const sv = JSON.parse(localStorage.getItem('bsc_save_v1') || '{}');
    this.cash = sv.cash ?? 250; this.save = { done: sv.done || {}, tutDone: !!sv.tutDone, weapons: sv.weapons || {} }; this.npcs = []; this.touch = isTouch();
    this.stats = { earned: 0, missions: 0, stolen: 0, topSpeed: 0, dist: 0, longestJump: 0, maxAir: 0, bestDrift: 0, knocked: 0, lights: 0, escapes: 0, busted: 0, ko: 0, ...(sv.stats || {}) };
    this.state = 'boot'; this.cars = []; this.playerCar = null; this.lastCar = null; this.lockControls = 0; this.cinematic = null; this.timeScale = 1;
    this.focus = new V3(0, 0, 0); this.night = 0; this.bustT = 0; this.carBustT = 0; this.t = 0; this.saveT = 0; this.tutorial = 0; this.tutT = 0; this.frameN = 0;
    this.trafficTarget = 11; this.parkedTarget = 14; this.pedTarget = 20; this.colList = []; this.frustum = new THREE.Frustum(); this.projM = new THREE.Matrix4();
    window.__game = this;
  }

  // ======================= boot =======================
  async boot() {
    const intro = $('#intro'); requestAnimationFrame(() => requestAnimationFrame(() => intro.classList.add('show')));
    const t0 = performance.now(); const bar = $('#loadBar'), txt = $('#loadText');
    const progress = (p, label) => { bar.style.width = `${Math.round(p * 100)}%`; if (label) txt.textContent = label; };
    if (isTouch()) { document.body.classList.add('touch'); if (!localStorage.getItem('bsc_settings')) this.settings.quality = 'medium'; }
    this.buildRenderer(); progress(0.02, 'Starting engines');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 8000);
    this.env = new Environment(this.renderer, this.scene, this.settings);
    this.props = new Props(this.scene, null); this.world = new World(this.scene, this.props); this.props.setWorld(this.world);
    await this.world.build(progress);
    progress(0.84, 'Polishing the paint');
    this.carFactory = new CarFactory(); this.wheels = new Wheels(this.scene); this.humans = new HumanRenderer(this.scene, 96); this.effects = new Effects(this.scene, this.world);
    this.audio = new AudioEngine(); this.input = new Input(this.renderer.domElement);
    this.hud = new HUD(this); this.hud.buildMap();
    this.peds = new Peds(this); this.population = new Population(this);
    this.wanted = new Wanted(this); this.missions = new Missions(this); this.pickups = new Pickups(this); this.stunts = new Stunts(this);
    this.rig = new CameraRig(this.camera, this); this.rig.setMode('menu'); this.rig.blend = 1;
    this.props.onBreak = (rec, speed) => this.onPropBreak(rec, speed);
    this.weapons = new Weapons(this, this.save.weapons);
    // gun store clerks + one interior light that follows the player to the nearest store
    for (const st of this.world.specials.stores || []) { const c = new Character(this, { skin: 0xc68642, hair: 0x2b1b12, shirt: 0x2f6f3a, sleeve: 0xe9e4da, pants: 0x2b2d42, shoes: 0x222222 }, st.clerk[0], st.clerk[1], Math.PI); c.store = st; this.npcs.push(c); }
    this.storeLight = new THREE.PointLight(0xfff0d8, 0, 20, 1.4); this.scene.add(this.storeLight);
    // player + a starter car
    const start = this.startSpot();
    this.player = new Player(this, start.x, start.z, start.yaw); this.player.char.visible = false;
    this.headlight = new THREE.SpotLight(0xfff1d6, 0, 70, 0.62, 0.6, 1.4); this.scene.add(this.headlight, this.headlight.target);
    this.copLights = [new THREE.PointLight(0xff2020, 0, 26, 2), new THREE.PointLight(0x2050ff, 0, 26, 2)]; for (const l of this.copLights) this.scene.add(l);
    progress(0.9, 'Waking up the city');
    this.applySettings('all');
    this.ui = new UI(this);
    this.menuEnv(true);
    // seed the menu backdrop with traffic around downtown
    for (let i = 0; i < 9; i++) { const sp = this.population.spawnPoint(20, 220, false); if (sp) this.spawnTraffic(sp); }
    for (let i = 0; i < 12; i++) this.peds.spawn(20, 160);
    progress(0.96, 'Compiling shaders');
    await new Promise((r) => setTimeout(r, 0));
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* not fatal */ }
    this.state = 'intro'; this.last = performance.now(); requestAnimationFrame((t) => this.frame(t));
    const wait = Math.max(0, 2600 - (performance.now() - t0)); await new Promise((r) => setTimeout(r, wait));
    progress(1, 'Ready'); intro.classList.add('ready');
    const go = () => {
      intro.removeEventListener('click', go); removeEventListener('keydown', go); this.audio.init(); this.audio.setVolume(this.settings.volume, this.settings.music); this.audio.menuMode = true;
      intro.classList.add('fadeText'); setTimeout(() => { intro.classList.add('out'); this.state = 'menu'; this.ui.showMenu(); }, 700); setTimeout(() => intro.remove(), 1800);
    };
    intro.addEventListener('click', go); addEventListener('keydown', go);
    addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.state === 'play' && !isTouch() && !this.ignoreUnlock) this.pause('map'); this.ignoreUnlock = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play') this.pause('map'); });
    this.renderer.domElement.addEventListener('click', () => { if (this.state === 'play') this.input.lock(); });
    addEventListener('keydown', (e) => { if (this.state === 'shop' && (e.code === 'Escape' || e.code === 'KeyF' || e.code === 'KeyE') && !e.repeat) { e.preventDefault(); this.closeShop(); return; } if (this.state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) { e.preventDefault(); this.resume(); } else if (this.state === 'paused' && e.code === 'KeyM' && this.ui.curTab !== 'map') this.ui.tab('map'); });
  }

  buildRenderer() {
    const canvas = $('#game');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.7; r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; r.setSize(innerWidth, innerHeight);
    setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
  }
  buildComposer() {
    const q = this.settings.quality; const samples = { low: 0, medium: 2, high: 4, ultra: 4 }[q];
    if (this.composer) this.composer.dispose();
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.35, 0.55, 0.92); this.bloom.enabled = q !== 'low';
    this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(innerWidth, innerHeight);
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); this.composer && this.composer.setSize(innerWidth, innerHeight); this.hud && this.hud.resize(); }
  applySettings(key) {
    const s = this.settings; localStorage.setItem('bsc_settings', JSON.stringify(s));
    if (key === 'all' || key === 'quality') {
      const pr = { low: 0.7, medium: 1, high: Math.min(devicePixelRatio, 1.5), ultra: Math.min(devicePixelRatio, 2) }[s.quality];
      this.renderer.setPixelRatio(pr); this.renderer.shadowMap.enabled = s.quality !== 'low'; this.env.applyQuality(s.quality); this.buildComposer();
      this.trafficTarget = s.quality === 'low' ? 8 : 11; this.parkedTarget = s.quality === 'low' ? 10 : 14; this.pedTarget = s.quality === 'low' ? 13 : 20;
      this.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.needsUpdate = true; }); } });
    }
    if ((key === 'all' || key === 'time') && this.state !== 'menu' && this.state !== 'intro' && this.state !== 'boot') this.env.setTimeMode(s.time);
    if (key === 'all' || key === 'volume' || key === 'music') this.audio.setVolume(s.volume, s.music);
    if (key === 'showFps') this.hud.fpsEl.textContent = '';
  }
  menuEnv(on) { if (on) { this.env.mode = 'fixed'; this.env.hours = 17.25; this.env.envTimer = 99; } else { this.env.setTimeMode(this.settings.time); if (this.settings.time === 'dynamic') this.env.hours = 10.2; } }

  startSpot() {
    // the sidewalk next to a parking bay in Midtown, with a sports car waiting
    const W = this.world; let best = W.parkingSlots[0], bd = 1e9;
    for (const s of W.parkingSlots) { if (s.lot || Math.abs(Math.sin(s.yaw)) < 0.5) continue; const d = Math.hypot(s.x + 70, s.z + 299); if (d < bd) { bd = d; best = s; } }
    const lx = Math.cos(best.yaw), lz = -Math.sin(best.yaw); // car's left
    let x = best.x + lx * 2.7, z = best.z + lz * 2.7; if (W.ground(x, z) < 0.1) { x = best.x - lx * 2.7; z = best.z - lz * 2.7; }
    return { x, z, yaw: best.yaw + Math.PI / 2, slot: best };
  }

  // ======================= flow =======================
  startPlay() {
    if (this.state !== 'menu') return;
    this.input.lock(); this.ignoreUnlock = false;
    this.state = 'loading'; this.ui.hideMenu(); this.ui.loading(true); this.audio.menuMode = false;
    setTimeout(() => {
      this.clearCity();
      const st = this.startSpot(); this.player.char.state = 'walk'; this.player.char.visible = true; this.player.char.pos.set(st.x, this.world.ground(st.x, st.z), st.z); this.player.char.yaw = st.yaw; this.player.health = 100;
      this.focus.copy(this.player.char.pos);
      this.starter = this.spawnParked(st.slot, 'sports', 0xd00000); this.starter.isStarter = true;
      for (const sl of this.world.parkingSlots) if (sl !== st.slot && Math.hypot(sl.x - st.slot.x, sl.z - st.slot.z) < 16) sl.used = true; // room to pull out
      this.menuEnv(false); this.env.update(0.016, this.focus, this.settings);
      for (let i = 0; i < this.trafficTarget; i++) { const sp = this.population.spawnPoint(30, 200, false); if (sp) this.spawnTraffic(sp); }
      for (let i = 0; i < 10; i++) this.population.parkTimer = 0, this.population.update(0.01);
      for (let i = 0; i < this.pedTarget; i++) this.peds.spawn(12, 140);
      this.rig.setMode('foot'); this.rig.blend = 1; this.rig.yaw = st.slot.yaw + 0.35; this.rig.pitch = 0.12;
      try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* ignore */ }
      setTimeout(() => {
        this.ui.loading(false); this.hud.show(true); this.hud.shownCash = this.cash; this.state = 'play'; this.tutorial = this.save.tutDone ? 99 : 0; this.tutT = 0.5;
        document.body.classList.toggle('touchOn', isTouch()); $('#touch').classList.toggle('hidden', !isTouch());
        if (this.save.tutDone) this.hud.help(`Welcome back to ~y~San Altekz~w~. You have ~g~${fmtMoney(this.cash)}~w~.`, 4);
      }, 900);
    }, 500);
  }
  clearCity() { for (const c of [...this.cars]) this.removeCar(c, true); this.peds.clear(); this.playerCar = null; this.lastCar = null; this.wanted.clear(true); this.missions.abort(); }
  pause(tab) { if (this.state !== 'play') return; this.state = 'paused'; this.input.unlock(); this.ui.openPause(tab); this.audio.ui(); }
  resume() { if (this.state !== 'paused') return; this.ui.closePause(); this.state = 'play'; this.input.hits.clear(); this.input.keys.clear(); this.last = performance.now(); this.input.lock(); }
  quitToMenu() {
    this.ui.closePause(); this.hud.show(false); $('#touch').classList.add('hidden'); this.missions.abort(); this.wanted.clear(true); this.saveGame();
    if (this.playerCar) this.exitCar(true); this.player.char.visible = false; this.state = 'menu'; this.audio.menuMode = true; this.rig.setMode('menu'); this.rig.blend = 1; this.menuEnv(true);
    this.focus.set(0, 0, 0); this.ui.showMenu(); this.cinematic = null; this.timeScale = 1; this.grade.uniforms.uDesat.value = 0;
  }
  saveGame() { localStorage.setItem('bsc_save_v1', JSON.stringify({ cash: this.cash, stats: this.stats, done: this.save.done, tutDone: this.save.tutDone, weapons: this.weapons ? this.weapons.save() : this.save.weapons })); }
  openShop(st) { if (this.state !== 'play') return; this.state = 'shop'; this.shopStore = st; this.hud.prompt(''); this.input.unlock(); this.ui.openShop(); this.audio.register(); }
  closeShop() { if (this.state !== 'shop') return; this.ui.closeShop(); this.state = 'play'; this.input.hits.clear(); this.input.keys.clear(); this.last = performance.now(); this.input.lock(); this.saveGame(); }
  addCash(n, why) { if (!n) return; this.cash = Math.max(0, this.cash + n); if (n > 0) this.stats.earned += n; this.hud.cashDelta(n); void why; }

  // ======================= spawning =======================
  spawnTraffic(sp) {
    const type = pickWeighted(TRAFFIC_MIX); const car = new Vehicle(this, type, R.pick(PAINT), sp.x, sp.z, sp.yaw);
    car.role = 'traffic'; car.driver = 'ai'; car.ai = new TrafficDriver(this, car, sp.a, sp.b, sp.li); car.vel.copy(car.fwd).multiplyScalar(7);
    const ch = new Character(this, randomLook(), sp.x, sp.z, sp.yaw); if (ch.slot != null) { ch.seatIn(car); car.driverChar = ch; } else ch.dispose();
    this.cars.push(car); return car;
  }
  spawnParked(slot, type, color) {
    const t = type || pickWeighted(PARKED_MIX); const car = new Vehicle(this, t, color ?? R.pick(PAINT), slot.x, slot.z, slot.yaw + (Math.random() < 0.06 ? Math.PI : 0));
    car.role = 'parked'; car.slot = slot; slot.used = true; car.sleeping = false; this.cars.push(car); return car;
  }
  spawnPolice(sp) {
    const f = this.focus; const toward = Math.atan2(f.x - sp.x, f.z - sp.z);
    const car = new Vehicle(this, 'police', 0, sp.x, sp.z, Math.abs(Math.atan2(Math.sin(toward - sp.yaw), Math.cos(toward - sp.yaw))) < 1.6 ? sp.yaw : sp.yaw + Math.PI);
    car.role = 'police'; car.driver = 'ai'; car.ai = new PoliceDriver(this, car); car.siren = true; car.vel.copy(car.fwd).multiplyScalar(14);
    const ch = new Character(this, { skin: R.pick([0xf1c27d, 0xc68642, 0x8d5524, 0xffdbac]), hair: 0x101830, shirt: 0x1b2a4a, pants: 0x121a2e, shoes: 0x111111 }, sp.x, sp.z, 0);
    if (ch.slot != null) { ch.seatIn(car); car.driverChar = ch; } else ch.dispose();
    this.cars.push(car); return car;
  }
  removeCar(car) {
    const i = this.cars.indexOf(car); if (i >= 0) this.cars.splice(i, 1);
    if (car.driverChar) { car.driverChar.dispose(); car.driverChar = null; }
    if (car.officer) this.peds.removeCop(car.officer);
    if (car.slot) car.slot.used = false;
    if (this.lastCar === car) this.lastCar = null;
    car.dispose();
  }

  // ======================= vehicles: enter / exit =======================
  enterCar(car) {
    const p = this.player; const wasPolice = car.role === 'police';
    if (car.driverChar) { // car-jack: the driver gets pulled out and runs off
      const ch = car.driverChar; car.driverChar = null;
      ch.state = 'walk'; ch.scale = 1; ch.pos.copy(car.pos).addScaledVector(car.left, car.ex + 1.1); ch.pos.y = this.world.ground(ch.pos.x, ch.pos.z); ch.yaw = Math.atan2(car.left.x, car.left.z);
      if (wasPolice) { ch.cop = true; ch.car = null; ch.brain = { mode: 'chase', speed: 4.9 }; this.peds.cops.push(ch); } else this.peds.adopt(ch, 5);
      this.wanted.crime(wasPolice ? 70 : 32, wasPolice ? 'You stole a ~b~police car~w~!' : 'Car jacked! The ~r~cops~w~ are on the way.');
    } else {
      const witness = this.peds.list.some((h) => Math.hypot(h.pos.x - car.pos.x, h.pos.z - car.pos.z) < 30) || this.cars.some((c) => c.role === 'police' && Math.hypot(c.pos.x - car.pos.x, c.pos.z - car.pos.z) < 60);
      if (wasPolice) this.wanted.crime(50, 'You stole a ~b~police car~w~!');
      else if (witness && car !== this.lastCar && !car.owned) { this.wanted.crime(14, 'Someone saw you steal that car.'); if (Math.random() < 0.35) this.audio.stealAlarm(car.pos); }
    }
    if (!car.owned) { this.stats.stolen++; car.owned = true; }
    if (car.ai) car.ai = null; car.siren = false;
    car.role = 'player'; car.driver = 'player'; car.wake(); if (car.slot) { car.slot.used = false; car.slot = null; }
    this.playerCar = car; this.lastCar = car; p.char.seatIn(car, 1); p.char.visible = true;
    this.rig.setMode('car'); this.rig.yaw = Math.atan2(car.fwd.x, car.fwd.z); this.hud.vehicle(car.type.name); this.hud.prompt(''); this.audio.door();
    document.body.classList.add('driving');
    if (this.tutorial === 1) { this.tutorial = 2; this.tutT = 1.5; }
  }
  exitCar(silent) {
    const car = this.playerCar; if (!car) return; const ch = this.player.char; const sp = car.speed;
    const W = this.world; let side = 1; let door = car.pos.clone().addScaledVector(car.left, car.ex + 0.6).addScaledVector(car.fwd, car.type.prof.ws - 0.7);
    if (W.insideBuilding(door.x, door.z, 0.4) || this.cars.some((c) => c !== car && Math.hypot(c.pos.x - door.x, c.pos.z - door.z) < c.ex + 0.3)) { side = -1; door = car.pos.clone().addScaledVector(car.left, -(car.ex + 0.6)); }
    if (W.insideBuilding(door.x, door.z, 0.4)) door = car.pos.clone().add(new V3(0, car.type.H, 0));
    ch.state = 'walk'; ch.scale = 1; ch.carT = null; ch.pos.set(door.x, Math.max(W.ground(door.x, door.z), door.y - car.comH), door.z); ch.vel.set(0, 0, 0); ch.yaw = Math.atan2(car.left.x * side, car.left.z * side);
    car.driver = null; car.role = 'parked'; car.ctrl.throttle = 0; car.ctrl.brake = 0; car.ctrl.steer = 0; car.ctrl.handbrake = false;
    this.playerCar = null; this.rig.setMode('foot'); this.rig.yaw = Math.atan2(car.fwd.x, car.fwd.z); document.body.classList.remove('driving');
    if (!silent && sp > 5) { // bail out!
      ch.knock(car.vel.clone().multiplyScalar(0.75).addScaledVector(car.left, 3 * side).add(new V3(0, 2.5, 0)), 0.8);
      if (sp > 14) this.player.hurt((sp - 14) * 2.5, 'bail');
    } else if (!silent) this.audio.door();
    this.stunts.endDrift(true);
  }

  // ======================= events =======================
  onImpact(car, other, impulse, point, normal, kind, vn = 0, vt = 0) {
    const p = point.clone(), n = normal.clone(); const now = this.t;
    const isPlayer = car === this.playerCar || other === this.playerCar;
    if (kind === 'prop') return;
    if (kind === 'ground') {
      if (vt > 4.5 && Math.random() < 0.3) { this.effects.sparksAt(p, 2, null, vt * 0.3, 0.8); if (isPlayer) this.scraping = 1; }
      if (vn > 7 && now - car.lastHit > 0.3) { car.lastHit = now; this.audio.crash(p, vn / 12); car.dent(p, n, (vn - 7) * 9); if (isPlayer) this.rig.shake(vn * 0.03); }
      return;
    }
    if (vn < 2.2) { if (vt > 5 && isPlayer && Math.random() < 0.4) { this.effects.sparksAt(p, 2, null, 3, 0.7); this.scraping = 1; } return; }
    if (now - car.lastHit < 0.12) return; car.lastHit = now;
    const hard = clamp(vn / 14, 0, 1.5);
    this.effects.sparksAt(p, Math.round(4 + vn * 1.6), n, 3 + vn * 0.4);
    if (vn > 7) this.effects.debris(p, Math.round(vn * 0.5), car.color, n, 2 + vn * 0.2);
    if (vn > 9) this.audio.glass(p);
    this.audio.crash(p, hard);
    const dmg = (vn - 3) * 13 * (car.role === 'police' ? 0.7 : 1);
    car.dent(p, n, dmg * (other ? other.mass / (car.mass + other.mass) * 2 : 1));
    if (other && other.dent) other.dent(p, n.clone().negate(), dmg * (car.mass / (car.mass + other.mass)) * 2);
    if (isPlayer) {
      this.rig.shake(hard * 0.5); if (vn > 6) this.stunts.crashed();
      const victim = car === this.playerCar ? other : car;
      if (victim && victim.driver && now - (victim.hitByPlayer || -9) > 1.2) {
        victim.hitByPlayer = now;
        if (victim.role === 'police') this.wanted.crime(vn > 4 ? 40 : 15, 'Ramming the ~b~police~w~? Bold move.');
        else this.wanted.crime(vn > 5 ? 9 : 4, this.wanted.stars === 0 ? 'Reckless driving! Careful, the cops notice crashes.' : null);
        if (victim.ai && victim.ai.honkT !== undefined) { victim.ai.honkT = 1; this.audio.honk(victim.pos, 0.8); }
      }
    }
  }
  onPropBreak(rec, speed) {
    const p = new V3(rec.x, rec.y + 0.5, rec.z);
    if (rec.pole) { this.effects.sparksAt(new V3(rec.x, rec.y + 0.4, rec.z), 10, null, 4); this.audio.crash(p, 0.6); this.audio.glass(p); }
    else { this.audio.thud(p, 0.8); if (rec.kind === 'hydrant') for (let i = 0; i < 14; i++) this.effects.smokeAt(rec.x, rec.y + 0.6, rec.z, (Math.random() - 0.5) * 2, 4 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.6, 0.95, 0.5, 1.3); }
    const near = this.playerCar && Math.hypot(this.playerCar.pos.x - rec.x, this.playerCar.pos.z - rec.z) < 8;
    if (near) {
      this.rig.shake(0.15);
      if (rec.pole) { this.stats.lights++; this.wanted.crime(10, this.wanted.stars === 0 ? 'Flattening ~y~streetlights~w~ is vandalism. One star!' : null); }
      else this.wanted.crime(rec.kind === 'hydrant' ? 4 : 1);
    }
    void speed;
  }
  onPersonHit(ch, car, rel) {
    this.audio.thud(ch.pos, clamp(rel / 10, 0.3, 1.2));
    if (ch === this.player.char) { this.player.hurt((rel - 2.5) * 6.5, 'hit'); return; }
    if (car === this.playerCar) {
      this.stats.knocked++; this.rig.shake(0.12);
      this.wanted.crime(ch.cop ? 45 : 20, ch.cop ? 'You flattened a ~b~cop~w~. That is a lot of paperwork.' : 'Watch the sidewalk! The ~r~cops~w~ saw that.');
      for (const h of this.peds.list) if (h !== ch && Math.hypot(h.pos.x - ch.pos.x, h.pos.z - ch.pos.z) < 18) { h.panic = 3; h.brain.flee = [h.pos.x - ch.pos.x, h.pos.z - ch.pos.z]; }
    }
  }
  onWrecked(car) { if (car === this.playerCar) { this.hud.big('WRECKED', 'Engine destroyed. Find another ride.', 'wrecked', 2.6); this.audio.crash(car.pos, 1.2); } }
  bustProgress(dt) { this.bustT += dt * 2; if (this.bustT > 2.4) this.busted(); }

  busted() {
    if (this.state !== 'play') return; this.state = 'busted'; this.cinematic = 'busted'; this.timeScale = 0.35; this.stats.busted++;
    const fee = Math.min(this.cash, Math.max(100, Math.round(this.cash * 0.1)));
    this.hud.big('BUSTED', fee ? `Bail paid: ~r~-${fmtMoney(fee)}` : '', 'busted', 4.4); this.audio.busted(); this.missions.abort();
    for (const k in this.weapons.ammo) this.weapons.ammo[k].res = Math.floor(this.weapons.ammo[k].res / 2); this.weapons.armor = 0; // the cops keep half your ammo
    setTimeout(() => this.respawn('police', fee), 4300);
  }
  knockedOut(why) {
    if (this.state !== 'play') return; this.state = 'ko'; this.cinematic = 'ko'; this.timeScale = 0.35; this.stats.ko++;
    this.weapons.armor = 0; const fee = Math.min(this.cash, 100); this.hud.big('KNOCKED OUT', `Hospital bill: ~r~-${fmtMoney(fee)}`, 'ko', 4.4); this.audio.knockout(); this.missions.abort();
    if (this.player.char.state === 'walk' && !this.playerCar) this.player.char.knock(new V3(0, 2, 0), 0.4);
    void why; setTimeout(() => this.respawn('hospital', fee), 4300);
  }
  respawn(where, fee) {
    if (this.playerCar) { const c = this.playerCar; this.exitCar(true); this.removeCar(c); }
    this.addCash(-fee); this.wanted.clear(true); this.peds.clear(); for (const c of [...this.cars]) if (c.role === 'police') this.removeCar(c);
    const s = this.world.specials[where]; const ch = this.player.char; ch.state = 'walk'; ch.visible = true; ch.scale = 1; ch.pos.set(s.x, this.world.ground(s.x, s.z), s.z); ch.yaw = s.yaw; ch.vel.set(0, 0, 0); ch.dizzy = 0;
    this.player.health = 100; this.bustT = 0; this.carBustT = 0; this.cinematic = null; this.timeScale = 1; this.state = 'play'; this.rig.setMode('foot'); this.rig.blend = 1; this.rig.yaw = s.yaw;
    this.hud.help(where === 'police' ? 'Released from ~b~San Altekz PD~w~. Try to keep a lower profile.' : 'Patched up at ~r~St. Altekz Hospital~w~. Walk it off.', 4); this.saveGame();
  }

  // ======================= helpers =======================
  walkers() { const a = this._walk || (this._walk = []); a.length = 0; for (const h of this.peds.list) if (h.state === 'walk') a.push(h); for (const c of this.peds.cops) a.push(c); if (!this.playerCar && this.player && this.player.char.visible) a.push(this.player.char); return a; }
  playerTarget() {
    const o = this._pt || (this._pt = { x: 0, z: 0, vx: 0, vz: 0, lx: 0, lz: 0 }); const car = this.playerCar;
    if (car) { o.x = car.pos.x; o.z = car.pos.z; o.vx = car.vel.x; o.vz = car.vel.z; o.lx = car.left.x; o.lz = car.left.z; }
    else { const c = this.player.char; o.x = c.pos.x; o.z = c.pos.z; o.vx = c.vel.x; o.vz = c.vel.z; o.lx = 1; o.lz = 0; }
    return o;
  }
  inView(x, z, r = 3) { return this.frustum.intersectsSphere(new THREE.Sphere(new V3(x, 1.5, z), r)); }

  // ======================= simulation =======================
  physics(dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120) - 0.01)); const h = dt / n; const cars = this.cars; const W = this.world; const list = this.colList;
    for (let s = 0; s < n; s++) {
      for (const c of cars) c.forces(h, W);
      for (const c of cars) c.staticContacts(h, W, list);
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) { const a = cars[i], b = cars[j]; if (a.sleeping && b.sleeping) continue; collideCars(a, b, this); }
      for (const c of cars) c.groundContacts(h, W);
      for (const c of cars) c.integrate(h);
    }
    for (const c of cars) {
      c.age += dt;
      if (!c.driver && !c.sleeping && c.grounded === 4 && c.speed < 0.15 && c.angVel.lengthSq() < 0.03) { c.sleepT += dt; if (c.sleepT > 1.2) { c.sleeping = true; c.vel.set(0, 0, 0); c.angVel.set(0, 0, 0); } } else if (!c.sleeping) c.sleepT = 0;
      if (c.up.y < 0.3) c.upsideT += dt; else c.upsideT = 0;
      if (c.ai && c.upsideT > 3.5 && c.speed < 2 && (!this.inView(c.pos.x, c.pos.z, 3) || c.upsideT > 6)) c.flip(); // AI cars quietly right themselves
      if (c.pos.y < -6) { if (c === this.playerCar) { this.exitCar(true); this.knockedOut('water'); } else this.removeCar(c); }
    }
  }
  sim(dt) {
    const g = this; const inp = this.input; const play = this.state === 'play';
    this.t += dt; this.lockControls = Math.max(0, this.lockControls - dt);
    if (play) this.controls(dt);
    this.weapons.update(dt, play ? inp : null);
    if (play) { /* fallthrough */ }
    else if (this.playerCar) { const c = this.playerCar.ctrl; c.throttle = 0; c.brake = 0.5; c.handbrake = false; }
    // AI
    for (const car of this.cars) if (car.ai) car.ai.update(dt);
    this.physics(dt);
    // focus point
    if (this.state === 'menu' || this.state === 'intro') this.focus.set(0, 0, 0);
    else if (this.playerCar) this.focus.copy(this.playerCar.pos); else this.focus.copy(this.player.char.state === 'walk' ? this.player.char.pos : this.player.char.drawPos);
    if (this.state !== 'intro') { this.peds.update(dt); this.population.update(dt); }
    if (play || this.state === 'busted' || this.state === 'ko') { this.wanted.update(dt); this.missions.update(dt); this.pickups.update(dt); this.stunts.update(dt); }
    // bust checks
    this.bustT = Math.max(0, this.bustT - dt);
    if (play && this.playerCar && this.wanted.stars > 0) {
      const car = this.playerCar; const pinned = car.speed < 1.4 && this.cars.some((c) => c.role === 'police' && !c.dead && Math.hypot(c.pos.x - car.pos.x, c.pos.z - car.pos.z) < 7.5);
      if (pinned) { this.carBustT += dt; if (this.carBustT > 1) this.hud.help(`~r~You're boxed in!~w~ Get moving! ${Math.max(0, 3.5 - this.carBustT).toFixed(1)}`, 0.2); if (this.carBustT > 3.5) this.busted(); } else this.carBustT = Math.max(0, this.carBustT - dt * 2);
    } else this.carBustT = 0;
    // world + lighting
    this.world.update(dt); this.props.update(dt, this.world, this.focus);
    this.env.update(dt, this.focus, this.settings);
    const night = this.env.night; if (Math.abs(night - this.night) > 0.004 || this.frameN < 3) { this.night = night; this.world.setNight(night); this.carFactory.setNight(night); }
    this.bloom.strength = 0.18 + night * 0.62; this.bloom.threshold = 3.2 - night * 2.25; this.bloom.radius = 0.5 + night * 0.25;
    // per-car fx + visuals
    const cam = this.camera.position; let sirenD = 1e9, nearestCop = null; let scrape = this.scraping; this.scraping = 0;
    for (const car of this.cars) {
      car.syncVisual(dt);
      if (car.driverChar) car.driverChar.updateSeat(car);
      const d = Math.hypot(car.pos.x - cam.x, car.pos.z - cam.z);
      if (car.siren && car.role === 'police') { if (d < sirenD) { sirenD = d; nearestCop = car; } }
      if (d < 130 && !car.sleeping) this.carFx(car, dt, d);
    }
    if (this.playerCar) { this.player.char.updateSeat(this.playerCar); }
    // lights: player headlight + police flashers
    const hl = this.headlight; const pc = this.playerCar;
    if (pc && night > 0.25) { hl.intensity = 420 * night; hl.position.copy(pc.pos).addScaledVector(pc.fwd, pc.ez - 0.2).addScaledVector(pc.up, 0.25); hl.target.position.copy(pc.pos).addScaledVector(pc.fwd, 30).addScaledVector(pc.up, -2.5); hl.target.updateMatrixWorld(); } else hl.intensity = 0;
    if (nearestCop && sirenD < 70) { const ph = Math.floor(this.t * 7) % 4; const p = nearestCop.pos.clone().addScaledVector(nearestCop.up, nearestCop.type.H - nearestCop.comH + 0.4); this.copLights[0].position.copy(p).addScaledVector(nearestCop.left, 0.5); this.copLights[1].position.copy(p).addScaledVector(nearestCop.left, -0.5); this.copLights[0].intensity = ph < 2 ? 50 + night * 150 : 0; this.copLights[1].intensity = ph >= 2 ? 50 + night * 150 : 0; } else for (const l of this.copLights) l.intensity = 0;
    // humans
    for (const ch of this.peds.list) this.humans.draw(ch); for (const ch of this.peds.cops) this.humans.draw(ch);
    for (const car of this.cars) if (car.driverChar) { car.driverChar.animate(dt); this.humans.draw(car.driverChar); }
    if (this.player) { if (this.playerCar) this.player.char.animate(dt); this.humans.draw(this.player.char); }
    let nearStore = null, nsd = 50;
    for (const c of this.npcs) {
      const pc = this.player.char; const d = Math.hypot(pc.pos.x - c.pos.x, pc.pos.z - c.pos.z); c.speed = 0;
      if (d < 7 && !this.playerCar) c.faceToward(pc.pos.x - c.pos.x, pc.pos.z - c.pos.z, dt, 5); else c.faceToward(0, -1, dt, 2);
      if (d < 5 && !c.greeted) { c.greeted = true; c.wave = 1.2; } if (d > 12) c.greeted = false;
      c.animate(dt); this.humans.draw(c); const sd = Math.hypot(this.focus.x - c.store.x, this.focus.z - c.store.z); if (sd < nsd) { nsd = sd; nearStore = c.store; }
    }
    if (nearStore) { this.storeLight.position.set(...nearStore.light); this.storeLight.intensity = 28; } else this.storeLight.intensity = 0;
    this.weapons.postDraw(); this.humans.commit(dt); this.wheels.commit();
    this.effects.update(dt);
    // stats
    if (this.playerCar) { this.stats.topSpeed = Math.max(this.stats.topSpeed, this.playerCar.speed); this.stats.dist += this.playerCar.speed * dt; }
    // audio
    this.audio.update(dt, { lx: cam.x, lz: cam.z, car: this.state === 'play' || this.state === 'paused' ? this.playerCar : null, sirenDist: sirenD, stars: this.wanted.stars, horn: play && this.playerCar && inp.down('KeyH'), radio: this.settings.radio, menu: this.state === 'menu' || this.state === 'intro', scrape });
    void g;
  }
  carFx(car, dt, dist) {
    const fx = this.effects; const t = car.type;
    car.fxAcc = (car.fxAcc || 0) + dt; const puff = car.fxAcc > 0.045; if (puff) car.fxAcc = 0;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i]; const key = (car.uid || (car.uid = Math.random() * 1e9 | 0)) * 4 + i;
      if (w.contact && w.slip > 3.2) {
        const rx = car.left.x, rz = car.left.z; fx.skid(key, w.cp.x, w.cp.y + 0.025, w.cp.z, rx, rz, t.wheelW, w.slip - 3);
        if (puff && w.slip > 5.5 && dist < 90) fx.smokeAt(w.cp.x, w.cp.y + 0.2, w.cp.z, car.vel.x * 0.15, 0.2, car.vel.z * 0.15, 1.1, 0.88, Math.min(0.5, (w.slip - 5) * 0.06), 1.8);
      } else fx.skid(key, 0, 0, 0, 0, 0, 0, 0);
    }
    if (car.health < 420 && puff && Math.random() < 0.6) {
      const p = new V3(0, t.prof.hoodH - car.comH + 0.1, t.L * 0.32).applyQuaternion(car.quat).add(car.pos); const sh = car.health < 160 ? 0.18 : 0.6;
      fx.smokeAt(p.x, p.y, p.z, car.vel.x * 0.3, 1.2, car.vel.z * 0.3, 0.8, sh, 0.5, 2.4);
    }
  }
  controls(dt) {
    const inp = this.input; const p = this.player;
    if (inp.hit('Escape', 'KeyP')) { this.pause('map'); return; }
    if (inp.hit('KeyM')) { this.pause('map'); return; }
    if (inp.hit('KeyV')) this.rig.view++;
    if (this.settings.showFps) this.hud.fpsEl.textContent = `${Math.round(this.fps || 0)} fps · ${this.cars.length} cars · ${this.peds.list.length} peds`;
    if (this.playerCar) {
      const car = this.playerCar;
      p.driveInput(dt, inp, car);
      if (inp.hit('KeyF', 'KeyE') && this.lockControls <= 0) { this.exitCar(); return; }
      if (inp.hit('KeyQ')) this.hud.radio(this.audio.nextStation());
      if (inp.hit('KeyR') && (car.up.y < 0.6 || car.speed < 3)) car.flip();
      if (car.upsideT > 1.5) this.hud.help('Press [R] to flip your car back over.', 0.3);
      if (inp.down('KeyH')) for (const h of this.peds.list) if (h.state === 'walk' && Math.hypot(h.pos.x - car.pos.x, h.pos.z - car.pos.z) < 14 && Math.random() < 0.02) { if (Math.random() < 0.5) h.wave = 1.2; else h.panic = 1.2; }
    } else p.updateFoot(dt, inp);
    // tutorial hints
    this.tutT -= dt;
    if (this.tutorial < 99 && this.tutT <= 0) {
      if (this.tutorial === 0) { this.hud.help(`Welcome to ~y~San Altekz~w~. That red ~y~${this.starter ? this.starter.type.name : 'car'}~w~ looks lonely. Walk up to it and press [F] to steal it.`, 7); this.tutorial = 1; this.tutT = 14; }
      else if (this.tutorial === 1) { if (!this.playerCar) { this.hud.help('Press [F] next to any car to steal it.', 4); this.tutT = 14; } }
      else if (this.tutorial <= 5) {
        const tips = ['[W] [S] drive and reverse, [A] [D] steer, hold [Space] to drift. [H] horn, [V] camera, [Q] radio.',
          'Hit ~y~ramps~w~ and pull long ~b~drifts~w~ for cash. Smash into traffic or streetlights and the ~r~cops~w~ come running.',
          'Drive into a glowing marker to start a mission: ~y~R~w~ races, ~g~S~w~ stunt jumps, ~r~G~w~ getaways. Press [M] for the map.',
          'Need firepower? Walk into a ~y~Blast Barn~w~ gun store (orange ~y~A~w~ on the map). Left click punches or shoots, right click aims.'];
        this.hud.help(tips[this.tutorial - 2], 7); this.tutorial++; this.tutT = 9;
      } else { this.tutorial = 99; this.save.tutDone = true; this.saveGame(); }
    }
  }
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; if (!(dt > 0)) dt = 1 / 60;
    this.fps = damp(this.fps || 60, 1 / dt, 3, dt); this.frameN++;
    try {
      if (this.state !== 'paused' && this.state !== 'loading' && this.state !== 'shop') {
        const sdt = dt * this.timeScale; this.sim(sdt);
        this.rig.update(dt, this.state === 'play' ? this.input : null, this.settings);
        if (this.state === 'play' || this.state === 'busted' || this.state === 'ko') this.hud.update(dt);
      } else if (this.state === 'paused' && this.frameN % 30 === 0) this.ui.header();
      this.camera.updateMatrixWorld(); this.projM.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projM);
      // grading: desaturate when busted / knocked out
      const busted = this.cinematic === 'busted' || this.cinematic === 'ko';
      this.grade.uniforms.uDesat.value = damp(this.grade.uniforms.uDesat.value, busted ? 0.85 : 0, 3, dt);
      this.grade.uniforms.uTint.value.set(this.cinematic === 'ko' ? 1.15 : 0.85, this.cinematic === 'ko' ? 0.8 : 0.95, this.cinematic === 'ko' ? 0.8 : 1.15);
      this.grade.uniforms.uVig.value = this.state === 'menu' ? 1.3 : 0.9;
      if (this.state !== 'loading') this.composer.render();
      this.saveT += dt; if (this.saveT > 15 && this.state === 'play') { this.saveT = 0; this.saveGame(); }
    } catch (e) { console.error(e); if (!this.errShown) { this.errShown = true; console.warn('frame error', e); } }
    this.input.endFrame();
  }
}

const game = new Game();
game.boot().catch((e) => { console.error(e); const f = $('#fatal'); f.classList.remove('hidden'); f.textContent = 'Big Steal Car could not start: ' + (e && e.message ? e.message : e) + '. Try a browser with WebGL2 enabled.'; });
void CITY;
