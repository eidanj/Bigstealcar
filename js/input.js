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

  setupTouch() {
    const root = document.getElementById('touch'); if (!root) return; this.touchRoot = root;
    const base = root.querySelector('.stick'), knob = root.querySelector('.knob');
    const R = 56;
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      const btn = e.target.closest('[data-key]');
      if (btn) { const k = btn.dataset.key; this.keys.add(k); this.hits.add(k); btn.classList.add('on'); btn.setPointerCapture(e.pointerId); btn._pid = e.pointerId; e.preventDefault(); return; }
      if (e.clientX < innerWidth * 0.42 && this.stick.id === null) {
        this.stick.id = e.pointerId; this.stick.ox = e.clientX; this.stick.oy = e.clientY; base.style.left = `${e.clientX - 70}px`; base.style.top = `${e.clientY - 70}px`; base.classList.add('on'); knob.style.transform = 'translate(0px,0px)';
      } else if (this.lookTouch.id === null) { this.lookTouch.id = e.pointerId; this.lookTouch.x = e.clientX; this.lookTouch.y = e.clientY; }
      e.preventDefault();
    }, { passive: false });
    root.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stick.id) {
        let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy; const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
        this.stick.x = dx / R; this.stick.y = -dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (e.pointerId === this.lookTouch.id) { this.mdx += (e.clientX - this.lookTouch.x) * 1.6; this.mdy += (e.clientY - this.lookTouch.y) * 1.6; this.lookTouch.x = e.clientX; this.lookTouch.y = e.clientY; }
      e.preventDefault();
    }, { passive: false });
    const up = (e) => {
      if (e.pointerId === this.stick.id) { this.stick.id = null; this.stick.x = this.stick.y = 0; base.classList.remove('on'); knob.style.transform = 'translate(0px,0px)'; }
      if (e.pointerId === this.lookTouch.id) this.lookTouch.id = null;
      root.querySelectorAll('[data-key]').forEach((b) => { if (b._pid === e.pointerId) { this.keys.delete(b.dataset.key); b.classList.remove('on'); b._pid = null; } });
    };
    root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
  }
}
