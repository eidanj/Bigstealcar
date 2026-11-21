// Big Steal Car — sky, sun/moon, time of day, environment lighting, clouds, stars and the sea.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, smooth, lerp } from './util.js';
import * as TX from './textures.js';

const PRESETS = { day: 11.5, sunset: 17.4, night: 23.2, dawn: 6.6 };

export class Environment {
  constructor(renderer, scene, settings) {
    this.renderer = renderer; this.scene = scene; this.settings = settings;
    this.hours = 10.5; this.night = 0;
    this.sky = new Sky(); this.sky.scale.setScalar(9000); scene.add(this.sky);
    const u = this.sky.material.uniforms; u.turbidity.value = 3; u.rayleigh.value = 2; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.82;
    this.sunDir = new THREE.Vector3();
    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.castShadow = true; scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5245, 0.6); scene.add(this.hemi);
    this.fog = new THREE.Fog(0xbfd2e0, 160, 1100); scene.fog = this.fog;
    // env map from a private copy of the sky
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene(); this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envScene.add(this.envSky);
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(900, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x404448 })); this.envGround.position.y = -20; this.envScene.add(this.envGround);
    this.envRT = null; this.lastEnvDir = new THREE.Vector3(9, 9, 9); this.envTimer = 0;
    // stars
    const n = 1600, sp = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, z = Math.random() * 0.95 + 0.05, r = Math.sqrt(1 - z * z); sp[i * 3] = Math.cos(a) * r * 4000; sp[i * 3 + 1] = z * 4000; sp[i * 3 + 2] = Math.sin(a) * r * 4000; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })); scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(60, 20, 14), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false })); scene.add(this.moon);
    // clouds
    const ct = TX.clouds(); ct.repeat.set(3, 3);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, opacity: 0.75, fog: true, side: THREE.DoubleSide });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000).rotateX(Math.PI / 2), this.cloudMat); this.clouds.position.y = 650; this.clouds.renderOrder = -1; scene.add(this.clouds);
    // sea
    const wn = TX.waterNormal(); wn.repeat.set(260, 260); this.waterNormal = wn;
    const seaMat = new THREE.MeshStandardMaterial({ color: 0x1c4a5e, roughness: 0.16, metalness: 0.1, normalMap: wn, normalScale: new THREE.Vector2(0.32, 0.32), envMapIntensity: 0.85 });
    // the sea gets rougher with distance (no sparkling aliasing far out) and its sun glints are capped, so the
    // sun lays a soft glitter path on the water instead of a field of blinding white dots
    seaMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix( roughnessFactor, 0.45, smoothstep( 30.0, 700.0, length( vViewPosition ) ) );')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directSpecular = min( reflectedLight.directSpecular, vec3( 1.1 ) );');
    };
    seaMat.customProgramCacheKey = () => 'bsc-sea';
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), seaMat);
    this.sea.position.y = -1.0; this.sea.receiveShadow = true; scene.add(this.sea);
    this.applyQuality(settings.quality);
    this.setTimeMode(settings.time, true);
  }

  applyQuality(q) {
    const size = { low: 1024, medium: 1536, high: 2048, ultra: 4096 }[q] || 2048;
    this.sun.castShadow = q !== 'low';
    const s = this.sun.shadow; s.mapSize.set(size, size); s.bias = -0.0003; s.normalBias = 0.04;
    const ext = q === 'ultra' ? 110 : 85; s.camera.left = -ext; s.camera.right = ext; s.camera.top = ext; s.camera.bottom = -ext; s.camera.near = 1; s.camera.far = 900; s.camera.updateProjectionMatrix();
    if (s.map) { s.map.dispose(); s.map = null; }
    this.shadowExt = ext;
  }
  setTimeMode(mode, first) { this.mode = mode; if (PRESETS[mode] !== undefined) this.hours = PRESETS[mode]; else if (first) this.hours = 9.5; this.envTimer = 99; }

  update(dt, focus, settings) {
    if (this.mode === 'dynamic') this.hours = (this.hours + dt * (24 / (settings.dayMinutes * 60))) % 24;
    const h = this.hours;
    // sun path: rises east (+x), sets west (-x), slight southern tilt
    const ang = ((h - 6) / 12) * Math.PI; const elev = Math.sin(ang) * 1.18; // radians-ish
    this.sunDir.set(Math.cos(ang), Math.sin(ang) * 0.95, 0.26).normalize();
    const sunUp = this.sunDir.y; this.night = 1 - smooth(-0.12, 0.08, sunUp);
    const dusk = 1 - smooth(0.0, 0.35, Math.abs(sunUp)); // golden hour weight
    const u = this.sky.material.uniforms; u.sunPosition.value.copy(this.sunDir); u.rayleigh.value = lerp(1.9, 2.8, dusk); u.turbidity.value = lerp(2.4, 6, dusk);
    this.envSky.material.uniforms.sunPosition.value.copy(this.sunDir); this.envSky.material.uniforms.rayleigh.value = u.rayleigh.value; this.envSky.material.uniforms.turbidity.value = u.turbidity.value;
    // key light: sun by day, moon by night
    const moonDir = this.sunDir.clone().negate(); moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.25; moonDir.normalize();
    const L = this.night > 0.5 ? moonDir : this.sunDir;
    const sunCol = new THREE.Color().setRGB(1, lerp(0.95, 0.62, dusk), lerp(0.9, 0.38, dusk));
    this.sun.color.copy(this.night > 0.5 ? new THREE.Color(0.62, 0.72, 1.0) : sunCol);
    this.sun.intensity = this.night > 0.5 ? 0.4 * smooth(0.5, 1, this.night) : 3.6 * smooth(-0.02, 0.12, sunUp);
    const f = focus; const ext = this.shadowExt;
    // texel snapping to stop shadow shimmer
    const snap = (ext * 2) / this.sun.shadow.mapSize.x; const fx = Math.round(f.x / snap) * snap, fz = Math.round(f.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz); this.sun.position.set(fx + L.x * 400, L.y * 400, fz + L.z * 400);
    this.hemi.intensity = lerp(0.22, 0.45, this.night); this.hemi.color.setRGB(lerp(0.75, 0.25, this.night), lerp(0.85, 0.32, this.night), lerp(1.0, 0.55, this.night));
    this.hemi.groundColor.setRGB(lerp(0.36, 0.08, this.night), lerp(0.33, 0.08, this.night), lerp(0.3, 0.1, this.night));
    // fog/horizon colour
    const day = new THREE.Color(0.66, 0.76, 0.88), gold = new THREE.Color(0.96, 0.68, 0.48), nightC = new THREE.Color(0.05, 0.07, 0.12);
    const fc = day.clone().lerp(gold, dusk * (1 - this.night)).lerp(nightC, this.night);
    this.fog.color.copy(fc); this.fog.near = lerp(320, 90, this.night); this.fog.far = lerp(1800, 750, this.night);
    this.renderer.toneMappingExposure = lerp(0.58, 1.15, this.night) + dusk * 0.1;
    this.scene.environmentIntensity = lerp(0.36, 0.42, this.night);
    this.stars.material.opacity = smooth(0.4, 1, this.night) * 0.9;
    this.moon.position.set(f.x + moonDir.x * 3500, moonDir.y * 3500, f.z + moonDir.z * 3500); this.moon.visible = this.night > 0.3;
    this.stars.position.set(f.x, 0, f.z); this.sky.position.set(f.x, 0, f.z);
    this.cloudMat.color.copy(new THREE.Color(1, 1, 1).lerp(new THREE.Color(1, 0.75, 0.6), dusk * (1 - this.night)).lerp(new THREE.Color(0.1, 0.12, 0.18), this.night));
    this.cloudMat.map.offset.x += dt * 0.0015; this.clouds.position.set(f.x * 0.6, 650, f.z * 0.6);
    this.waterNormal.offset.x += dt * 0.01; this.waterNormal.offset.y += dt * 0.006;
    // env map refresh
    this.envTimer += dt;
    if (this.envTimer > 2.5 && (this.envTimer > 30 || this.lastEnvDir.distanceTo(this.sunDir) > 0.02)) {
      this.envTimer = 0; this.lastEnvDir.copy(this.sunDir);
      this.envGround.material.color.copy(fc).multiplyScalar(0.5);
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 2000); if (this.envRT) this.envRT.dispose(); this.envRT = rt; this.scene.environment = rt.texture;
    }
    void elev; void clamp;
  }
  clock() { const h = Math.floor(this.hours), m = Math.floor((this.hours % 1) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}
