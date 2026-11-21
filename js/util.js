// Big Steal Car — small math + misc helpers shared by every module.
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// frame-rate independent exponential approach
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const dampAngle = (a, b, rate, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
export const sign = (v) => (v < 0 ? -1 : 1);

// deterministic RNG (mulberry32) so the city is identical every load
export function rng(seed) {
  let s = seed >>> 0;
  const f = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}
export const R = rng(1337); // shared runtime RNG (non-deterministic use is fine)

export const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');

// rotate (x,z) by yaw: forward is +Z, yaw rotates about +Y
export function rotXZ(x, z, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); return [x * c + z * s, -x * s + z * c]; }

export const V3 = THREE.Vector3;
export const tmpV = Array.from({ length: 16 }, () => new THREE.Vector3());
export const tmpQ = Array.from({ length: 4 }, () => new THREE.Quaternion());
export const tmpM = Array.from({ length: 4 }, () => new THREE.Matrix4());
export const UP = new THREE.Vector3(0, 1, 0);

export function $(s) { return document.querySelector(s); }
export function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

export const isTouch = () => (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
