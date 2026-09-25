// Pooled visual effects: GPU point particles, bullet-hole / blood decals, tracers, explosion lights.
// Every pool has a fixed capacity so effect counts stay bounded during heavy fights.
import * as THREE from 'three';
import { PERF } from '../config';
import type { TextureLib } from '../render/textures';
import type { Surface } from '../world/Collision';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  attribute float aRot;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vRot;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    vAlpha = aAlpha;
    vColor = aColor;
    vRot = aRot;
    #include <fog_vertex>
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vRot;
  #include <fog_pars_fragment>
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
    vec4 t = texture2D(uMap, uv);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.003) discard;
    #include <fog_fragment>
  }
`;

interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; size0: number; size1: number; alpha: number;
  r: number; g: number; b: number; grav: number; drag: number; rot: number; spin: number;
}

class ParticlePool {
  readonly points: THREE.Points;
  private ps: Particle[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private rot: Float32Array;
  readonly mat: THREE.ShaderMaterial;

  constructor(private cap: number, tex: THREE.Texture, additive: boolean) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.color = new Float32Array(cap * 3);
    this.rot = new Float32Array(cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: tex }, uScale: { value: 400 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.mat.uniforms.uMap.value = tex;
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  spawn(p: Omit<Particle, 'max'>): void {
    if (this.ps.length >= this.cap) this.ps.shift();
    this.ps.push({ ...p, max: p.life });
  }

  clear(): void {
    this.ps.length = 0;
    this.geo.setDrawRange(0, 0);
  }

  update(dt: number): void {
    let n = 0;
    const ps = this.ps;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.grav * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.grav > 0) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.rot += p.spin * dt;
      ps[n++] = p;
    }
    ps.length = n;
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      const t = 1 - p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.size0 + (p.size1 - p.size0) * t;
      this.alpha[i] = p.alpha * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      this.color[i * 3] = p.r; this.color[i * 3 + 1] = p.g; this.color[i * 3 + 2] = p.b;
      this.rot[i] = p.rot;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor', 'aRot']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Tracer { ax: number; ay: number; az: number; bx: number; by: number; bz: number; life: number; r: number; g: number; b: number }

export class Effects {
  readonly group = new THREE.Group();
  private additive: ParticlePool;
  private smoke: ParticlePool;
  private blood: ParticlePool;
  private decals: THREE.InstancedMesh;
  private bloodDecals: THREE.InstancedMesh;
  private decalIdx = 0;
  private bloodIdx = 0;
  private tracers: Tracer[] = [];
  private tracerGeo: THREE.BufferGeometry;
  private tracerPos: Float32Array;
  private tracerCol: Float32Array;
  readonly muzzleLight: THREE.PointLight;
  private muzzleT = 0;
  private blastLight: THREE.PointLight;
  private blastT = 0;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private up = new THREE.Vector3(0, 0, 1);
  shake = 0;

  constructor(tex: TextureLib) {
    const per = Math.floor(PERF.maxParticles / 3);
    this.additive = new ParticlePool(per, tex.spark, true);
    this.smoke = new ParticlePool(per, tex.smoke, false);
    this.blood = new ParticlePool(per, tex.smoke, false);
    this.group.add(this.additive.points, this.smoke.points, this.blood.points);

    const decalMat = new THREE.MeshBasicMaterial({ map: tex.decal, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.9 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.16), decalMat, PERF.maxDecals);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    const bloodMat = new THREE.MeshBasicMaterial({ map: tex.blood, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, color: 0x9a9a9a });
    this.bloodDecals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, 1.4), bloodMat, 40);
    this.bloodDecals.count = 0;
    this.bloodDecals.frustumCulled = false;
    this.group.add(this.decals, this.bloodDecals);

    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(PERF.maxTracers * 6);
    this.tracerCol = new Float32Array(PERF.maxTracers * 6);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    const tl = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    tl.frustumCulled = false;
    this.group.add(tl);

    this.muzzleLight = new THREE.PointLight(0xffb45a, 0, 14, 2);
    this.blastLight = new THREE.PointLight(0xff8a3a, 0, 26, 1.6);
    this.group.add(this.muzzleLight, this.blastLight);
  }

  setScale(viewportHeight: number, fovDeg: number): void {
    const s = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const p of [this.additive, this.smoke, this.blood]) p.mat.uniforms.uScale.value = s;
  }

  reset(): void {
    this.additive.clear(); this.smoke.clear(); this.blood.clear();
    this.decals.count = 0; this.decalIdx = 0;
    this.bloodDecals.count = 0; this.bloodIdx = 0;
    this.tracers.length = 0;
    this.muzzleLight.intensity = 0; this.blastLight.intensity = 0;
    this.shake = 0;
  }

  muzzle(x: number, y: number, z: number, strength: number): void {
    this.muzzleLight.position.set(x, y, z);
    this.muzzleLight.intensity = 6 * strength;
    this.muzzleT = 0.05;
    this.smoke.spawn({ x, y, z, vx: rand(-0.2, 0.2), vy: 0.4, vz: rand(-0.2, 0.2), life: 0.6, size0: 0.1, size1: 0.5, alpha: 0.12 * strength, r: 0.8, g: 0.8, b: 0.8, grav: -0.2, drag: 2, rot: rand(0, 6), spin: 0.5 });
  }

  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: THREE.Color): void {
    if (this.tracers.length >= PERF.maxTracers) this.tracers.shift();
    this.tracers.push({ ax, ay, az, bx, by, bz, life: 0.07, r: color.r, g: color.g, b: color.b });
  }

  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: Surface): void {
    const sparks = surface === 'metal' ? 7 : 2;
    for (let i = 0; i < sparks; i++) {
      this.additive.spawn({ x, y, z, vx: nx * 3 + rand(-3, 3), vy: ny * 3 + rand(0, 3.5), vz: nz * 3 + rand(-3, 3), life: rand(0.15, 0.35), size0: 0.05, size1: 0.02, alpha: 1, r: 1, g: 0.75, b: 0.4, grav: 12, drag: 1, rot: 0, spin: 0 });
    }
    const dust = surface === 'metal' ? 1 : 3;
    const col = surface === 'wood' ? [0.55, 0.45, 0.35] : surface === 'dirt' ? [0.45, 0.4, 0.33] : [0.62, 0.62, 0.6];
    for (let i = 0; i < dust; i++) {
      this.smoke.spawn({ x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05, vx: nx * rand(0.5, 1.6) + rand(-0.3, 0.3), vy: ny * rand(0.5, 1.6) + rand(0, 0.5), vz: nz * rand(0.5, 1.6) + rand(-0.3, 0.3), life: rand(0.5, 0.9), size0: 0.12, size1: 0.6, alpha: 0.4, r: col[0], g: col[1], b: col[2], grav: 0.3, drag: 3, rot: rand(0, 6), spin: rand(-1, 1) });
    }
    this.decal(x, y, z, nx, ny, nz);
  }

  private decal(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    this.tmpV.set(nx, ny, nz);
    this.tmpQ.setFromUnitVectors(this.up, this.tmpV);
    const rotZ = new THREE.Quaternion().setFromAxisAngle(this.up, rand(0, Math.PI * 2));
    this.tmpQ.multiply(rotZ);
    const s = rand(0.8, 1.3);
    this.tmpM.compose(new THREE.Vector3(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01), this.tmpQ, new THREE.Vector3(s, s, s));
    this.decals.setMatrixAt(this.decalIdx, this.tmpM);
    this.decalIdx = (this.decalIdx + 1) % PERF.maxDecals;
    this.decals.count = Math.min(PERF.maxDecals, this.decals.count + 1);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  bloodHit(x: number, y: number, z: number, dx: number, dz: number, head: boolean): void {
    const n = head ? 7 : 4;
    for (let i = 0; i < n; i++) {
      this.blood.spawn({ x, y, z, vx: dx * rand(0.5, 2.5) + rand(-0.8, 0.8), vy: rand(-0.2, 1.4), vz: dz * rand(0.5, 2.5) + rand(-0.8, 0.8), life: rand(0.3, 0.6), size0: head ? 0.25 : 0.18, size1: head ? 0.9 : 0.55, alpha: 0.75, r: 0.35, g: 0.03, b: 0.02, grav: 3, drag: 3, rot: rand(0, 6), spin: 0 });
    }
    for (let i = 0; i < (head ? 5 : 2); i++) {
      this.blood.spawn({ x, y, z, vx: dx * 3 + rand(-1, 1), vy: rand(1, 3), vz: dz * 3 + rand(-1, 1), life: 0.7, size0: 0.05, size1: 0.04, alpha: 1, r: 0.3, g: 0.02, b: 0.02, grav: 14, drag: 0.5, rot: 0, spin: 0 });
    }
  }

  bloodPool(x: number, z: number, scale = 1): void {
    this.tmpQ.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rand(0, 6)));
    this.tmpM.compose(new THREE.Vector3(x, 0.04 + this.bloodIdx * 0.0004, z), this.tmpQ, new THREE.Vector3(scale, scale, scale));
    this.bloodDecals.setMatrixAt(this.bloodIdx, this.tmpM);
    this.bloodIdx = (this.bloodIdx + 1) % 40;
    this.bloodDecals.count = Math.min(40, this.bloodDecals.count + 1);
    this.bloodDecals.instanceMatrix.needsUpdate = true;
  }

  explosion(x: number, y: number, z: number, reducedMotion: boolean): void {
    this.blastLight.position.set(x, y + 1, z);
    this.blastLight.intensity = 60;
    this.blastT = 0.35;
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), e = rand(0.1, 1.2), sp = rand(2, 9);
      this.additive.spawn({ x, y: y + 0.3, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, life: rand(0.25, 0.55), size0: rand(1.2, 2.2), size1: 0.3, alpha: 0.9, r: 1, g: rand(0.45, 0.7), b: 0.15, grav: -1, drag: 4, rot: rand(0, 6), spin: rand(-2, 2) });
    }
    for (let i = 0; i < 30; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(6, 16);
      this.additive.spawn({ x, y: y + 0.2, z, vx: Math.cos(a) * sp, vy: rand(3, 10), vz: Math.sin(a) * sp, life: rand(0.4, 0.9), size0: 0.08, size1: 0.03, alpha: 1, r: 1, g: 0.8, b: 0.4, grav: 14, drag: 0.8, rot: 0, spin: 0 });
    }
    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(0.5, 3);
      this.smoke.spawn({ x: x + rand(-0.5, 0.5), y: y + rand(0.2, 1.2), z: z + rand(-0.5, 0.5), vx: Math.cos(a) * sp, vy: rand(0.8, 2.2), vz: Math.sin(a) * sp, life: rand(2, 3.5), size0: 1.2, size1: 4.5, alpha: 0.5, r: 0.2, g: 0.2, b: 0.2, grav: -0.2, drag: 1.2, rot: rand(0, 6), spin: rand(-0.4, 0.4) });
    }
    this.shake = Math.max(this.shake, reducedMotion ? 0.15 : 0.6);
  }

  /** Downwash dust around the landing helicopter. */
  downwash(x: number, z: number, strength: number): void {
    if (Math.random() > strength) return;
    const a = rand(0, Math.PI * 2), r = rand(2, 6);
    this.smoke.spawn({ x: x + Math.cos(a) * r, y: 0.2, z: z + Math.sin(a) * r, vx: Math.cos(a) * rand(4, 8), vy: rand(0.2, 1), vz: Math.sin(a) * rand(4, 8), life: rand(1, 1.8), size0: 0.8, size1: 3.5, alpha: 0.28, r: 0.55, g: 0.53, b: 0.5, grav: 0, drag: 1.5, rot: rand(0, 6), spin: rand(-1, 1) });
  }

  flare(x: number, y: number, z: number): void {
    this.additive.spawn({ x: x + rand(-0.05, 0.05), y, z: z + rand(-0.05, 0.05), vx: rand(-0.2, 0.2), vy: rand(0.5, 1.5), vz: rand(-0.2, 0.2), life: rand(0.3, 0.6), size0: 0.5, size1: 0.1, alpha: 1, r: 1, g: 0.2, b: 0.1, grav: -0.5, drag: 1, rot: 0, spin: 0 });
    if (Math.random() < 0.3) this.smoke.spawn({ x, y: y + 0.3, z, vx: rand(-0.3, 0.3), vy: rand(1, 2), vz: rand(-0.3, 0.3), life: 3, size0: 0.4, size1: 3, alpha: 0.35, r: 0.8, g: 0.25, b: 0.2, grav: -0.2, drag: 0.6, rot: rand(0, 6), spin: 0.2 });
  }

  sparkBurst(x: number, y: number, z: number, n: number, color: [number, number, number]): void {
    for (let i = 0; i < n; i++) {
      this.additive.spawn({ x, y, z, vx: rand(-3, 3), vy: rand(0, 4), vz: rand(-3, 3), life: rand(0.2, 0.5), size0: 0.1, size1: 0.02, alpha: 1, r: color[0], g: color[1], b: color[2], grav: 9, drag: 1, rot: 0, spin: 0 });
    }
  }

  deathPuff(x: number, y: number, z: number): void {
    for (let i = 0; i < 5; i++) {
      this.smoke.spawn({ x: x + rand(-0.3, 0.3), y: y + rand(0, 0.5), z: z + rand(-0.3, 0.3), vx: rand(-0.4, 0.4), vy: rand(0.2, 0.6), vz: rand(-0.4, 0.4), life: rand(0.8, 1.4), size0: 0.4, size1: 1.4, alpha: 0.3, r: 0.35, g: 0.38, b: 0.3, grav: 0, drag: 1, rot: rand(0, 6), spin: 0.3 });
    }
  }

  update(dt: number): void {
    this.additive.update(dt);
    this.smoke.update(dt);
    this.blood.update(dt);
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzleLight.intensity = 0; }
    if (this.blastT > 0) { this.blastT -= dt; this.blastLight.intensity = Math.max(0, (this.blastT / 0.35) * 60); }
    this.shake = Math.max(0, this.shake - dt * 1.8);
    let n = 0;
    for (const t of this.tracers) {
      t.life -= dt;
      if (t.life <= 0) continue;
      this.tracers[n++] = t;
    }
    this.tracers.length = n;
    for (let i = 0; i < PERF.maxTracers; i++) {
      const t = this.tracers[i];
      const o = i * 6;
      if (!t) { this.tracerPos.fill(0, o, o + 6); this.tracerCol.fill(0, o, o + 6); continue; }
      const k = t.life / 0.07;
      this.tracerPos[o] = t.ax; this.tracerPos[o + 1] = t.ay; this.tracerPos[o + 2] = t.az;
      this.tracerPos[o + 3] = t.bx; this.tracerPos[o + 4] = t.by; this.tracerPos[o + 5] = t.bz;
      this.tracerCol[o] = 0; this.tracerCol[o + 1] = 0; this.tracerCol[o + 2] = 0;
      this.tracerCol[o + 3] = t.r * k; this.tracerCol[o + 4] = t.g * k; this.tracerCol[o + 5] = t.b * k;
    }
    (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
