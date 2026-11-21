// Big Steal Car — keyboard, mouse (pointer lock) and touch input.
import { clamp } from './util.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas; this.keys = new Set(); this.hits = new Set(); this.mdx = 0; this.mdy = 0; this.locked = false; this.enabled = true;
    this.stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 }; this.lookTouch = { id: null, x: 0, y: 0 };
    addEventListener('keydown', (e) => {
      if (e.repeat) { if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code); this.hits.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Slash', 'Quote'].includes(e.code) && !(e.target && e.target.tagName === 'INPUT')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => { if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; } else if (e.buttons & 2 || e.buttons & 1 && this.dragLook) { this.mdx += e.movementX; this.mdy += e.movementY; } });
    this.wheel = 0;
    const mkey = (b) => (b === 0 ? 'Mouse0' : b === 2 ? 'Mouse2' : null);
    // mouse buttons only count while the pointer is captured (the click that captures it is not a shot)
    addEventListener('mousedown', (e) => { const k = mkey(e.button); if (k && this.locked) { this.keys.add(k); this.hits.add(k); } });
    addEventListener('mouseup', (e) => { const k = mkey(e.button); if (k) this.keys.delete(k); });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked) { this.keys.delete('Mouse0'); this.keys.delete('Mouse2'); } });
    this.setupTouch();
  }
  lock() { if (!this.touch && this.canvas.requestPointerLock && !this.locked) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(...c) { return this.enabled && c.some((k) => this.keys.has(k)); }
  hit(...c) { return this.enabled && c.some((k) => this.hits.has(k)); }
  get moveX() { return clamp((this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0) + this.stick.x, -1, 1); }
  get moveY() { return clamp((this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0) + this.stick.y, -1, 1); }
  look() { const r = [this.mdx, this.mdy]; this.mdx = 0; this.mdy = 0; return r; }
  endFrame() { this.hits.clear(); }

  // ---------------- touch ----------------
  // Every finger is tracked on its own: a pad finger (steering / pedals) can slide between its zones, a button finger
  // holds its key (FIRE can also be dragged to look), a stick finger on the left drives on foot, and any other finger
  // drags the camera. Keys held by fingers are merged into this.keys without disturbing a real keyboard.
  setupTouch() {
    const root = document.getElementById('touch'); if (!root) return; this.touchRoot = root;
    const stickEl = root.querySelector('.stick'), knob = root.querySelector('.knob');
    this.ptr = new Map(); this.toggled = new Set(); this.touchHeld = new Set(); this.promptEl = document.getElementById('prompt');
    const sync = () => {
      const want = new Set(this.toggled);
      for (const p of this.ptr.values()) { if (p.key) want.add(p.key); if (p.sprint) want.add('ShiftLeft'); }
      for (const k of this.touchHeld) if (!want.has(k)) this.keys.delete(k);
      for (const k of want) if (!this.touchHeld.has(k)) { this.keys.add(k); this.hits.add(k); }
      this.touchHeld = want;
      root.querySelectorAll('.pad .zone').forEach((z) => { let on = false; for (const p of this.ptr.values()) if (p.kind === 'pad' && p.key === z.dataset.key) on = true; z.classList.toggle('on', on); });
    };
    this.syncTouch = sync;
    const padKey = (pad, x) => {
      const zones = [...pad.querySelectorAll('.zone')];
      if (pad.dataset.pad === 'steer') { const r = pad.getBoundingClientRect(); const t = (x - r.left) / r.width; return t < 0.47 ? zones[0].dataset.key : t > 0.53 ? zones[1].dataset.key : null; }
      let best = null, bd = 1e9; for (const z of zones) { const r = z.getBoundingClientRect(); const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0; if (d < bd) { bd = d; best = z; } }
      return best ? best.dataset.key : null;
    };
    const lookScale = () => 1.5 * Math.sqrt(900 / Math.max(innerWidth, innerHeight, 400));
    const stickR = () => stickEl.offsetWidth * 0.36 || 40;
    const placeStick = (x, y) => { stickEl.style.left = `${x}px`; stickEl.style.top = `${y}px`; };
    const resetStick = () => { this.stick.id = null; this.stick.x = this.stick.y = 0; stickEl.classList.remove('on', 'sprint'); stickEl.style.left = ''; stickEl.style.top = ''; knob.style.transform = ''; };
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault(); const x = e.clientX, y = e.clientY, id = e.pointerId;
      if (e.target.closest('[data-fs]')) { if (this.onFullscreenBtn) this.onFullscreenBtn(); return; }
      const pad = e.target.closest('.pad'); const btn = pad ? null : e.target.closest('[data-key]');
      try { ((pad && e.target.closest('.zone')) || btn || root).setPointerCapture(id); } catch (err) { /* older Safari */ }
      if (pad) { this.ptr.set(id, { kind: 'pad', el: pad, key: padKey(pad, x) }); sync(); return; }
      if (btn) {
        const k = btn.dataset.key;
        if (btn.dataset.toggle) { if (this.toggled.has(k)) this.toggled.delete(k); else this.toggled.add(k); btn.classList.toggle('on', this.toggled.has(k)); sync(); return; }
        this.ptr.set(id, { kind: 'btn', el: btn, key: k, look: !!btn.dataset.look, x, y }); btn.classList.add('on'); sync(); return;
      }
      // tapping the on-screen prompt ("F  Steal Vortex GT") does what it says
      const pr = this.promptEl; if (pr && pr.classList.contains('show')) { const r = pr.getBoundingClientRect(); if (x > r.left - 12 && x < r.right + 12 && y > r.top - 12 && y < r.bottom + 12) { this.hits.add('KeyF'); return; } }
      const onFoot = !document.body.classList.contains('driving');
      if (onFoot && this.stick.id === null && x < innerWidth * 0.45 && y > innerHeight * 0.28) {
        const R = stickEl.offsetWidth / 2; const cx = Math.max(R + 6, x), cy = Math.min(innerHeight - R - 6, Math.max(R + 6, y));
        this.stick.id = id; this.stick.ox = cx; this.stick.oy = cy; placeStick(cx, cy); stickEl.classList.add('on'); this.ptr.set(id, { kind: 'stick' });
        this.moveStick(x, y, knob, stickEl, stickR(), sync, placeStick); return;
      }
      this.ptr.set(id, { kind: 'look', x, y });
    }, { passive: false });
    root.addEventListener('pointermove', (e) => {
      const p = this.ptr.get(e.pointerId); if (!p) return; e.preventDefault(); const x = e.clientX, y = e.clientY;
      if (p.kind === 'pad') { const k = padKey(p.el, x); if (k !== p.key) { p.key = k; sync(); } }
      else if (p.kind === 'stick') this.moveStick(x, y, knob, stickEl, stickR(), sync, placeStick);
      else if (p.kind === 'look' || p.look) { const s = lookScale(); this.mdx += (x - p.x) * s; this.mdy += (y - p.y) * s; p.x = x; p.y = y; }
    }, { passive: false });
    const up = (e) => {
      const p = this.ptr.get(e.pointerId); if (!p) return; this.ptr.delete(e.pointerId);
      if (p.kind === 'btn') p.el.classList.remove('on');
      if (p.kind === 'stick') resetStick();
      sync();
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(ev, up);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false }); // no double-tap zoom / text magnifier
    // anything that can strand a finger (screen rotating, leaving full screen, switching apps) lets go of everything
    this.releaseTouches = () => {
      this.ptr.clear(); this.toggled.clear(); resetStick(); root.querySelectorAll('.on').forEach((b) => b.classList.remove('on')); sync(); this.mdx = this.mdy = 0;
    };
    for (const ev of ['orientationchange', 'blur']) addEventListener(ev, () => this.releaseTouches());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseTouches(); });
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => this.releaseTouches());
  }
  moveStick(x, y, knob, stickEl, R, sync, placeStick) {
    let dx = x - this.stick.ox, dy = y - this.stick.oy; let d = Math.hypot(dx, dy);
    // drag past the rim and the stick follows your thumb instead of leaving it behind
    if (d > R * 1.6) { const k = (d - R * 1.6) / d; this.stick.ox += dx * k; this.stick.oy += dy * k; placeStick(this.stick.ox, this.stick.oy); dx = x - this.stick.ox; dy = y - this.stick.oy; d = Math.hypot(dx, dy); }
    const c = d > R ? R / d : 1; const kx = dx * c, ky = dy * c;
    this.stick.x = kx / R; this.stick.y = -ky / R; knob.style.transform = `translate(${kx}px,${ky}px)`;
    const p = this.ptr.get(this.stick.id); const sprint = d > R * 1.02; // push to the rim to sprint
    if (p && p.sprint !== sprint) { p.sprint = sprint; stickEl.classList.toggle('sprint', sprint); sync(); }
  }
}
