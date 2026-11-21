// Big Steal Car — everything you hear is synthesised with the Web Audio API (no audio files).
import { clamp } from './util.js';

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.vol = 0.8; this.musicVol = 0.45; this.listener = { x: 0, z: 0 }; this.station = 0; this.musicOn = false; }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0; this.music.connect(this.master);
    // shared noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = nb;
    this.buildEngine(); this.buildLoops(); this.ready = true;
    this.musicTimer = setInterval(() => this.schedule(), 60); this.beat = 0; this.nextT = ctx.currentTime + 0.1;
  }
  setVolume(v, m) { this.vol = v; this.musicVol = m; if (this.master) this.master.gain.value = v; }
  noise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.loopStart = Math.random(); return s; }
  att(pos, ref = 14) { if (!pos) return 1; const d = Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z); return clamp(ref / (ref + d), 0, 1); }

  buildEngine() {
    const c = this.ctx;
    this.eng = { o1: c.createOscillator(), o2: c.createOscillator(), o3: c.createOscillator(), f: c.createBiquadFilter(), g: c.createGain(), ng: c.createGain(), nf: c.createBiquadFilter() };
    const e = this.eng; e.o1.type = 'sawtooth'; e.o2.type = 'square'; e.o3.type = 'triangle';
    e.f.type = 'lowpass'; e.f.frequency.value = 600; e.f.Q.value = 3; e.g.gain.value = 0;
    const g1 = c.createGain(); g1.gain.value = 0.45; const g2 = c.createGain(); g2.gain.value = 0.22; const g3 = c.createGain(); g3.gain.value = 0.5;
    e.o1.connect(g1).connect(e.f); e.o2.connect(g2).connect(e.f); e.o3.connect(g3).connect(e.f); e.f.connect(e.g).connect(this.sfx);
    const n = this.noise(); e.nf.type = 'bandpass'; e.nf.frequency.value = 300; e.nf.Q.value = 0.8; n.connect(e.nf).connect(e.ng).connect(e.g); e.ng.gain.value = 0.35;
    e.o1.start(); e.o2.start(); e.o3.start(); n.start();
  }
  buildLoops() {
    const c = this.ctx; const mk = (type, freq, q) => { const n = this.noise(); const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0; n.connect(f).connect(g).connect(this.sfx); n.start(); return { f, g }; };
    this.screech = mk('bandpass', 2100, 6); this.wind = mk('lowpass', 500, 0.5); this.scrape = mk('bandpass', 3200, 2); this.city = mk('lowpass', 260, 0.3);
    // screech gets a tonal layer
    const so = c.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 1150; const sf = c.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1800; sf.Q.value = 9; so.connect(sf).connect(this.screech.g); so.start(); this.screechOsc = so;
    // siren
    this.siren = { o: c.createOscillator(), g: c.createGain(), f: c.createBiquadFilter() }; this.siren.o.type = 'square'; this.siren.f.type = 'lowpass'; this.siren.f.frequency.value = 2200; this.siren.g.gain.value = 0;
    this.siren.o.connect(this.siren.f).connect(this.siren.g).connect(this.sfx); this.siren.o.start(); this.sirenPhase = 0;
    // horn
    this.horn = { g: c.createGain() }; this.horn.g.gain.value = 0; const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1800;
    for (const fq of [392, 494]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = fq; o.connect(hf); o.start(); }
    hf.connect(this.horn.g).connect(this.sfx);
  }

  // per-frame update with the player vehicle state
  update(dt, s) {
    if (!this.ready) return; const t = this.ctx.currentTime; const e = this.eng;
    this.listener.x = s.lx; this.listener.z = s.lz;
    const car = s.car;
    if (car) {
      const r = car.rpm / 7000; const base = 28 + r * 150; const thr = car.ctrl.throttle;
      e.o1.frequency.setTargetAtTime(base, t, 0.03); e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.03); e.o3.frequency.setTargetAtTime(base * 2.01, t, 0.03);
      e.f.frequency.setTargetAtTime(260 + r * 1500 + thr * 900, t, 0.05); e.nf.frequency.setTargetAtTime(160 + r * 700, t, 0.05);
      e.g.gain.setTargetAtTime(car.dead ? 0 : 0.16 + thr * 0.16 + r * 0.06, t, 0.05);
      let slip = 0; for (const w of car.wheels) if (w.contact) slip = Math.max(slip, w.slip); const sq = clamp((slip - 3.5) / 7, 0, 1);
      this.screech.g.gain.setTargetAtTime(sq * 0.22, t, 0.04); this.screechOsc.frequency.setTargetAtTime(1000 + sq * 400 + Math.random() * 80, t, 0.02);
      this.wind.g.gain.setTargetAtTime(clamp(car.speed / 60, 0, 1) * 0.28, t, 0.1); this.wind.f.frequency.setTargetAtTime(300 + car.speed * 18, t, 0.1);
    } else { e.g.gain.setTargetAtTime(0, t, 0.1); this.screech.g.gain.setTargetAtTime(0, t, 0.05); this.wind.g.gain.setTargetAtTime(0.02, t, 0.2); }
    this.scrape.g.gain.setTargetAtTime(s.scrape ? 0.18 : 0, t, 0.03); s.scrape = 0;
    this.city.g.gain.setTargetAtTime(s.menu ? 0.03 : 0.06, t, 0.3);
    // siren: nearest police with lights on
    const sd = s.sirenDist; const sv = sd < 1e8 ? clamp(30 / (30 + sd), 0, 1) * 0.12 : 0;
    this.sirenPhase += dt * (s.stars >= 3 ? 3.2 : 0.55);
    const fq = s.stars >= 3 ? (Math.sin(this.sirenPhase * Math.PI * 2) > 0 ? 1350 : 950) : 700 + (Math.sin(this.sirenPhase * Math.PI * 2) * 0.5 + 0.5) * 750;
    this.siren.o.frequency.setTargetAtTime(fq, t, 0.02); this.siren.g.gain.setTargetAtTime(sv, t, 0.08);
    this.horn.g.gain.setTargetAtTime(s.horn ? 0.16 : 0, t, 0.015);
    // music bus
    const want = s.menu ? this.musicVol * 0.9 : (s.car && s.radio && this.station > 0 ? this.musicVol * 0.55 : 0);
    this.music.gain.setTargetAtTime(want, t, 0.4); this.musicOn = want > 0.001;
  }

  // ---------- one-shots ----------
  env(node, t, a, peak, dec) { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  tone(freq, type, dur, vol = 0.2, when = 0, dest = this.sfx, glide = 0) {
    if (!this.ready) return; const c = this.ctx, t = c.currentTime + when; const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    o.connect(g).connect(dest); this.env(g, t, 0.005, vol, dur); o.start(t); o.stop(t + dur + 0.05);
  }
  burst(freq, q, dur, vol, type = 'lowpass', when = 0) {
    if (!this.ready) return; const c = this.ctx, t = c.currentTime + when; const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    n.connect(f).connect(g).connect(this.sfx); this.env(g, t, 0.004, vol, dur); n.start(t); n.stop(t + dur + 0.1);
  }
  thud(pos, k = 1) { const a = this.att(pos) * clamp(k, 0, 1.5); if (a < 0.02) return; this.burst(220, 0.7, 0.25, 0.5 * a); this.tone(70, 'sine', 0.25, 0.45 * a, 0, this.sfx, 40); }
  crash(pos, k = 1) {
    const a = this.att(pos) * clamp(k, 0.2, 1.6); if (a < 0.02) return;
    this.burst(900, 0.6, 0.35, 0.55 * a); this.burst(180, 0.9, 0.4, 0.6 * a);
    for (const f of [233, 347, 521, 787, 1130]) this.tone(f * (0.9 + Math.random() * 0.2), 'square', 0.18 + Math.random() * 0.25, 0.05 * a);
    this.tone(55, 'sine', 0.3, 0.5 * a, 0, this.sfx, 35);
  }
  glass(pos) { const a = this.att(pos); for (let i = 0; i < 6; i++) this.tone(2500 + Math.random() * 3000, 'triangle', 0.08 + Math.random() * 0.1, 0.05 * a, Math.random() * 0.12); }
  scrapeOn() { this.scrapeFlag = 1; }
  honk(pos, dur = 0.5) { const a = this.att(pos) * 0.5; if (a < 0.03) return; for (const f of [349, 440]) this.tone(f, 'square', dur, 0.06 * a); }
  chime(big) { const notes = big ? [523, 659, 784, 1047, 1319] : [784, 1047, 1319]; notes.forEach((f, i) => this.tone(f, 'triangle', 0.25, 0.12, i * 0.06)); }
  checkpoint() { this.tone(880, 'square', 0.1, 0.1); this.tone(1320, 'square', 0.16, 0.1, 0.09); }
  starUp() { this.tone(330, 'sawtooth', 0.12, 0.08); this.tone(247, 'sawtooth', 0.22, 0.08, 0.1); }
  go() { this.tone(1046, 'square', 0.4, 0.14); }
  beep() { this.tone(523, 'square', 0.15, 0.1); }
  missionStart() { [392, 523, 659].forEach((f, i) => this.tone(f, 'triangle', 0.3, 0.12, i * 0.1)); }
  passed() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'square', 0.35, 0.1, i * 0.13)); this.tone(1047, 'triangle', 1.0, 0.12, 0.55); [262, 330, 392].forEach((f) => this.tone(f, 'sawtooth', 1.2, 0.04, 0.55)); }
  failed() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 'sawtooth', 0.4, 0.08, i * 0.18)); }
  busted() { this.tone(196, 'sawtooth', 1.4, 0.12, 0, this.sfx, 98); this.tone(147, 'square', 1.4, 0.06, 0.05, this.sfx, 73); this.burst(400, 0.5, 1.2, 0.2); }
  knockout() { this.tone(440, 'sine', 1.2, 0.14, 0, this.sfx, 110); this.burst(300, 0.5, 0.8, 0.3); }
  ui() { this.tone(1400, 'square', 0.04, 0.05); }
  uiBack() { this.tone(700, 'square', 0.05, 0.05); }
  door() { this.burst(600, 1.2, 0.08, 0.25); this.tone(160, 'sine', 0.1, 0.2); }
  jump() { }
  spray() { this.burst(5000, 0.4, 1.4, 0.18, 'highpass'); }
  garage() { this.burst(300, 2, 1.0, 0.25); this.tone(90, 'sawtooth', 0.9, 0.05); }
  stealAlarm(pos) { const a = this.att(pos); for (let i = 0; i < 6; i++) this.tone(i % 2 ? 1100 : 900, 'square', 0.12, 0.05 * a, i * 0.15); }

  // ---------- weapons ----------
  gun(kind, pos, vol = 1) {
    const a = this.att(pos, 34) * vol; if (a < 0.02) return;
    if (kind === 'shotgun') { this.burst(1100, 0.5, 0.32, 0.85 * a); this.burst(220, 0.8, 0.45, 0.8 * a); this.tone(68, 'sine', 0.32, 0.75 * a, 0, this.sfx, 34); }
    else if (kind === 'rifle') { this.burst(3200, 0.6, 0.08, 0.55 * a, 'highpass'); this.burst(800, 0.7, 0.16, 0.55 * a); this.tone(105, 'sine', 0.12, 0.5 * a, 0, this.sfx, 50); }
    else if (kind === 'smg') { this.burst(2600, 0.6, 0.06, 0.42 * a); this.burst(520, 0.6, 0.1, 0.38 * a); this.tone(150, 'sine', 0.07, 0.3 * a, 0, this.sfx, 70); }
    else { this.burst(2000, 0.7, 0.11, 0.6 * a); this.burst(420, 0.6, 0.17, 0.5 * a); this.tone(125, 'sine', 0.12, 0.5 * a, 0, this.sfx, 55); }
  }
  hitBody(pos) { const a = this.att(pos, 20); this.burst(260, 1.2, 0.08, 0.45 * a); this.tone(95, 'sine', 0.08, 0.35 * a, 0, this.sfx, 60); }
  ricochet(pos) { const a = this.att(pos, 18); this.tone(2200 + Math.random() * 1800, 'sine', 0.28, 0.06 * a, 0, this.sfx, 700 + Math.random() * 400); }
  clank(pos) { const a = this.att(pos, 18); for (const f of [610, 930, 1460]) this.tone(f * (0.95 + Math.random() * 0.1), 'square', 0.09, 0.04 * a); }
  whiz() { this.burst(3800, 3, 0.18, 0.12, 'bandpass'); }
  swing(bat) { this.burst(bat ? 700 : 1300, 1.6, bat ? 0.22 : 0.12, bat ? 0.22 : 0.14, 'bandpass'); }
  punchHit(hit, bat) { if (!hit) return; if (bat) { this.tone(160, 'triangle', 0.1, 0.4); this.burst(1800, 2, 0.06, 0.25, 'bandpass'); } else { this.burst(320, 1, 0.09, 0.5); this.tone(85, 'sine', 0.1, 0.45, 0, this.sfx, 55); } }
  reload() { this.tone(900, 'square', 0.03, 0.07); this.tone(620, 'square', 0.04, 0.07, 0.28); this.burst(2500, 3, 0.05, 0.12, 'bandpass', 0.55); this.tone(1150, 'square', 0.03, 0.08, 0.75); }
  empty() { this.tone(1600, 'square', 0.02, 0.06); }
  equip() { this.burst(2200, 3, 0.05, 0.1, 'bandpass'); this.tone(500, 'square', 0.03, 0.05, 0.05); }
  register() { this.tone(1568, 'triangle', 0.14, 0.14); this.tone(2093, 'triangle', 0.45, 0.14, 0.09); this.burst(5000, 1, 0.12, 0.1, 'highpass'); }

  // ---------- radio / menu music: generative synthwave ----------
  nextStation() { this.station = (this.station + 1) % 3; return ['RADIO OFF', 'NEON FM 88.1', 'BACKSTREET BEATS 99.4'][this.station]; }
  schedule() {
    if (!this.ready) return; const c = this.ctx; if (!this.musicOn) { this.nextT = c.currentTime + 0.1; return; }
    const st = this.menuMode ? 1 : this.station || 1; const bpm = st === 2 ? 88 : 104; const step = 60 / bpm / 4;
    while (this.nextT < c.currentTime + 0.25) { this.playStep(this.beat, this.nextT, st, step); this.nextT += step; this.beat = (this.beat + 1) % 128; }
  }
  playStep(b, t, st, step) {
    const c = this.ctx; const out = this.music; const bar = Math.floor(b / 16) % 4; const s16 = b % 16;
    const prog = st === 2 ? [[45, 52, 57], [41, 48, 53], [43, 50, 55], [40, 47, 52]] : [[45, 52, 57], [41, 48, 53], [48, 55, 60], [43, 50, 55]];
    const ch = prog[bar]; const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const v = (node, a, p, d) => { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(p, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
    // kick
    if (s16 % 4 === 0 || (st === 2 && s16 === 10)) { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); o.connect(g).connect(out); v(g, 0.002, 0.9, 0.25); o.start(t); o.stop(t + 0.3); }
    // snare
    if (s16 === 4 || s16 === 12) { const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'highpass'; f.frequency.value = 1200; n.connect(f).connect(g).connect(out); v(g, 0.002, 0.35, 0.16); n.start(t); n.stop(t + 0.25); const o = c.createOscillator(), g2 = c.createGain(); o.frequency.value = 190; o.connect(g2).connect(out); v(g2, 0.002, 0.25, 0.08); o.start(t); o.stop(t + 0.12); }
    // hats
    if (s16 % 2 === 0 || st === 1) { const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'highpass'; f.frequency.value = 7000; n.connect(f).connect(g).connect(out); v(g, 0.001, s16 % 4 === 2 ? 0.12 : 0.05, 0.04); n.start(t); n.stop(t + 0.08); }
    // bass
    if (st === 1 ? s16 % 2 === 0 : [0, 3, 6, 10, 11].includes(s16)) { const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = mtof(ch[0] - 12 + (st === 1 && s16 % 4 === 2 ? 12 : 0)); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 6; o.connect(f).connect(g).connect(out); v(g, 0.005, 0.32, step * 1.6); o.start(t); o.stop(t + step * 2); }
    // arp / pads
    if (st === 1) { const n = ch[[0, 1, 2, 1][s16 % 4]] + 12 + (s16 >= 8 ? 12 : 0); const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(); o.type = 'square'; o.frequency.value = mtof(n); f.type = 'lowpass'; f.frequency.value = 2200; o.connect(f).connect(g).connect(out); v(g, 0.003, 0.06, step * 0.9); o.start(t); o.stop(t + step); }
    if (s16 === 0) for (const n of ch) { const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.detune.value = (Math.random() - 0.5) * 14; o.frequency.value = mtof(n + 12); f.type = 'lowpass'; f.frequency.value = st === 2 ? 900 : 1400; o.connect(f).connect(g).connect(out); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + step * 16); o.start(t); o.stop(t + step * 16 + 0.1); }
  }
}
