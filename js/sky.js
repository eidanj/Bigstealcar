// Big Steal Car — sky, sun/moon, time of day, environment lighting, clouds, stars and the sea.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, smooth, lerp } from './util.js';
import * as TX from './textures.js';

const PRESETS = { day: 11.5, sunset: 17.4, night: 23.2, dawn: 6.6 };

// Procedural cloud deck: domain-warped value-noise coverage drifting with the wind, a few samples toward the sun for
// self-shadowing (sunlit tops, grey bellies), a silver lining when you look toward the sun, and a fade into the haze.
function makeClouds(q) {
  const oct = q === 'low' ? 3 : q === 'medium' ? 4 : 5, steps = q === 'low' ? 1 : q === 'medium' ? 2 : 3;
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    defines: { OCT: oct, STEPS: steps },
    uniforms: { uTime: { value: 0 }, uCover: { value: 0.5 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.6, 0.7, 0.85) }, uShade: { value: new THREE.Color(0.4, 0.45, 0.5) }, uFog: { value: new THREE.Color(0.7, 0.8, 0.9) }, uCam: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      varying vec3 vW; uniform float uTime, uCover; uniform vec3 uSunDir, uSunCol, uAmb, uShade, uFog, uCam;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
      const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
      // lod fades the finest octaves out with distance (no shimmer far away) without visible rings
      float fbm(vec2 p, float lod) { float s = 0.0, a = 0.5, t = 0.0; for (int i = 0; i < OCT; i++) { float k = a * clamp(lod - float(i), 0.0, 1.0); s += k * vn(p); t += k; p = ROT * p; a *= 0.5; } return s / max(t, 1e-3); }
      vec2 wind() { return vec2(uTime * 4.5, uTime * 1.6); } // metres drifted
      // 0..1 cloud density at a point on the layer: ~0.8 km cumulus with crisp edges, grouped into
      // cloudy and clear stretches by a slow "weather" noise so the sky is never one uniform sheet
      float dens(vec2 p, float lod) {
        vec2 w = p + wind();
        float wx = vn(w * 0.00015 + 11.3) * 0.65 + vn(w * 0.0004 - 4.1) * 0.35;
        vec2 q = w * 0.00125; q += (vec2(vn(q * 0.33 + 3.1), vn(q * 0.33 - 7.7)) - 0.5) * 1.3;
        float cov = uCover + (0.5 - wx) * 0.26;
        return clamp((fbm(q, lod) - cov) / 0.15, 0.0, 1.0);
      }
      void main() {
        float dist = length(vW.xz - uCam.xz); float fade = 1.0 - smoothstep(2600.0, 8000.0, dist);
        float lod = float(OCT) - smoothstep(1200.0, 6000.0, dist) * 2.2;
        float d = dens(vW.xz, lod); if (d * fade < 0.004) discard;
        vec2 sd = normalize(uSunDir.xz + vec2(1e-4)); float occ = 0.0;
        for (int i = 1; i <= STEPS; i++) occ += dens(vW.xz + sd * float(i) * 70.0, 2.5);
        float lit = exp(-occ * 0.8);
        float thick = smoothstep(0.12, 1.0, d);
        // seen from below: thin edges glow with sunlight, thick middles are grey bellies, the sun side of each cloud brighter
        vec3 edge = uSunCol * 0.85 + uAmb * 0.55; vec3 belly = uShade + uAmb * 0.3;
        vec3 col = mix(edge, belly, thick * 0.9) * (0.62 + 0.38 * lit);
        vec3 v = normalize(vW - uCam); float mu = max(dot(v, uSunDir), 0.0);
        col += uSunCol * (pow(mu, 14.0) * 1.2 + pow(mu, 4.0) * 0.12) * (1.0 - thick * 0.8); // silver lining
        col = mix(uFog, col, 0.25 + 0.75 * fade);
        gl_FragColor = vec4(col, smoothstep(0.0, 0.32, d) * fade * 0.96);
      }`,
  });
}

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
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })); this.stars.renderOrder = -2; scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(60, 20, 14), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false })); scene.add(this.moon);
    // clouds: a procedural layer lit by the sun (see makeClouds)
    this.cloudMat = makeClouds(settings.quality); this.cloudT = Math.random() * 1000;
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(17000, 17000).rotateX(Math.PI / 2), this.cloudMat); this.clouds.position.y = 950; this.clouds.renderOrder = -1; this.clouds.frustumCulled = false; scene.add(this.clouds);
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
    if (this.cloudMat) { const c = makeClouds(q); this.cloudMat.dispose(); this.cloudMat = c; this.clouds.material = c; }
    this.setupProbe({ low: 0, medium: 64, high: 128, ultra: 256 }[q] ?? 128);
  }
  // ---- reflection probe: the actual city (buildings, streets, trees, sky, clouds) rendered into a cube map around
  // the player, one face per frame, and used as the environment so cars and glass reflect what is really there.
  setupProbe(size) {
    if (this.probeRT) { this.probeRT.dispose(); this.probeRT = null; }
    this.useProbe = !!size; this.probeReady = false; this.probeFace = 0; this.envTimer = 99;
    if (!size) { this.onProbe && this.onProbe(null); return; }
    this.probeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.probe = new THREE.CubeCamera(0.5, 12000, this.probeRT);
    for (const c of this.probe.children) c.layers.set(2); // static world only (layer 2), no cars or people: cheap
    this.probe.coordinateSystem = this.renderer.coordinateSystem; this.probe.updateCoordinateSystem();
  }
  probeStep(focus) {
    if (!this.useProbe || !this.probeRT) return;
    const r = this.renderer, p = this.probe;
    if (this.probeFace === 0) { p.position.set(focus.x, Math.max(0, focus.y) + 2.4, focus.z); p.updateMatrixWorld(true); }
    const prev = r.getRenderTarget(), au = r.shadowMap.autoUpdate, nu = r.shadowMap.needsUpdate;
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; // reuse this frame's sun shadows
    r.setRenderTarget(this.probeRT, this.probeFace); r.render(this.scene, p.children[this.probeFace]);
    r.setRenderTarget(prev); r.shadowMap.autoUpdate = au; r.shadowMap.needsUpdate = nu;
    if (++this.probeFace === 6) {
      this.probeFace = 0; this.probeRT.texture.needsPMREMUpdate = true;
      if (!this.probeReady) { this.probeReady = true; this.scene.environment = this.probeRT.texture; this.onProbe && this.onProbe(this.probeRT.texture); }
    }
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
    this.scene.environmentIntensity = this.probeReady ? lerp(0.55, 0.8, this.night) : lerp(0.36, 0.42, this.night);
    this.stars.material.opacity = smooth(0.4, 1, this.night) * 0.9;
    this.moon.position.set(f.x + moonDir.x * 3500, moonDir.y * 3500, f.z + moonDir.z * 3500); this.moon.visible = this.night > 0.3;
    this.stars.position.set(f.x, 0, f.z); this.sky.position.set(f.x, 0, f.z);
    // clouds: sunlit side, shaded side and ambient follow the time of day
    { const U = this.cloudMat.uniforms; this.cloudT += dt; U.uTime.value = this.cloudT; U.uCam.value.copy(this.camPos || f);
      const day = 1 - this.night; const lightDir = this.night > 0.5 ? moonDir : this.sunDir; U.uSunDir.value.copy(lightDir);
      U.uSunCol.value.setRGB(1, lerp(0.96, 0.58, dusk), lerp(0.9, 0.34, dusk)).multiplyScalar(lerp(0.12, 1.75, day));
      U.uAmb.value.setRGB(lerp(0.5, 0.035, this.night), lerp(0.58, 0.045, this.night), lerp(0.72, 0.075, this.night)).lerp(new THREE.Color(0.75, 0.45, 0.4), dusk * day * 0.4);
      U.uShade.value.setRGB(lerp(0.3, 0.012, this.night), lerp(0.32, 0.016, this.night), lerp(0.38, 0.028, this.night)).lerp(new THREE.Color(0.32, 0.2, 0.22), dusk * day * 0.45);
      U.uFog.value.copy(fc); U.uCover.value = 0.55 + Math.sin(this.cloudT * 0.004) * 0.05;
      this.clouds.position.set(f.x, 950, f.z); }
    this.waterNormal.offset.x += dt * 0.01; this.waterNormal.offset.y += dt * 0.006;
    // env map refresh
    this.envTimer += dt;
    if (!this.probeReady && this.envTimer > 2.5 && (this.envTimer > 30 || this.lastEnvDir.distanceTo(this.sunDir) > 0.02)) {
      this.envTimer = 0; this.lastEnvDir.copy(this.sunDir);
      this.envGround.material.color.copy(fc).multiplyScalar(0.5);
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 2000); if (this.envRT) this.envRT.dispose(); this.envRT = rt; this.scene.environment = rt.texture;
    }
    void elev; void clamp;
  }
  clock() { const h = Math.floor(this.hours), m = Math.floor((this.hours % 1) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}
