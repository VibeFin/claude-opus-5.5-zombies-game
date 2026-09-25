// First-person weapon + gloved hands, rendered in an overlay scene so it never clips into walls.
// All animation is procedural: bob, sway, ADS alignment, recoil springs, reloads, switching, plates.
import * as THREE from 'three';
import type { WeaponId } from '../config';
import type { TextureLib } from '../render/textures';
import type { ReloadPhase } from './WeaponState';

interface WeaponModel {
  id: WeaponId;
  root: THREE.Group;
  mag: THREE.Object3D;
  magHome: THREE.Vector3;
  mover: THREE.Object3D; // slide / pump / charging handle
  moverHome: THREE.Vector3;
  muzzle: THREE.Object3D;
  sight: THREE.Vector3;
  adsDist: number;
  hip: THREE.Vector3;
  leftHand: THREE.Group;
  leftHome: THREE.Vector3;
  leftHomeRot: THREE.Euler;
  flash: THREE.Sprite;
  accents: THREE.MeshStandardMaterial;
  body: THREE.MeshStandardMaterial;
  shell?: THREE.Object3D;
}

export interface ViewState {
  id: WeaponId;
  tier: number;
  adsT: number;
  speed: number;
  sprinting: boolean;
  grounded: boolean;
  crouched: boolean;
  bobPhase: number;
  lookDX: number;
  lookDY: number;
  reloadPhase: ReloadPhase;
  reloadP: number; // magazine reload progress 0..1
  shellT: number; // shell reload local timer
  shellPer: number;
  switchT: number; // 0 = fully up, 1 = fully lowered
  plateT: number; // 0..1 plate application progress (0 = none)
  sinceShot: number;
  reducedMotion: boolean;
  jumpOffset: number;
}

const TIER_COLORS = [
  { accent: 0x2a2c2e, emissive: 0x000000, ei: 0, body: 0x4a4e52 },
  { accent: 0x1c5a8a, emissive: 0x2aa8ff, ei: 1.6, body: 0x3a4a5c },
  { accent: 0x8a3a1c, emissive: 0xff5a1a, ei: 2.2, body: 0x4a3432 },
];

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group();
  private models = new Map<WeaponId, WeaponModel>();
  private current: WeaponModel | null = null;
  private plate: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private flashT = 0;
  // Springs
  private kick = 0;
  private kickV = 0;
  private kickRot = 0;
  private kickRotV = 0;
  private swayX = 0;
  private swayY = 0;
  private tiltZ = 0;
  private gloveMat: THREE.MeshStandardMaterial;
  private sleeveMat: THREE.MeshStandardMaterial;
  private skinMat: THREE.MeshStandardMaterial;
  private metal: THREE.MeshStandardMaterial;
  private polymer: THREE.MeshStandardMaterial;
  private wood: THREE.MeshStandardMaterial;
  private tex: TextureLib;
  private tmp = new THREE.Vector3();

  constructor(tex: TextureLib) {
    this.tex = tex;
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    // Lighting that roughly matches the blue-hour world.
    this.scene.add(new THREE.HemisphereLight(0x9fb3d4, 0x3a3632, 2.0));
    const key = new THREE.DirectionalLight(0xc8d6f0, 2.2);
    key.position.set(-1, 2, 1);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffb070, 0.6);
    rim.position.set(2, 0.5, -1);
    this.scene.add(rim);
    this.flashLight = new THREE.PointLight(0xffb45a, 0, 2, 1.5);
    this.camera.add(this.flashLight);
    this.flashLight.position.set(0.1, -0.05, -0.7);

    this.gloveMat = new THREE.MeshStandardMaterial({ color: 0x4a4a42, roughness: 0.85, map: tex.grime });
    this.sleeveMat = new THREE.MeshStandardMaterial({ color: 0x6f7850, roughness: 0.95, map: tex.grime });
    this.skinMat = new THREE.MeshStandardMaterial({ color: 0x9b7a62, roughness: 0.7 });
    this.metal = new THREE.MeshStandardMaterial({ color: 0x6a6e72, roughness: 0.38, metalness: 0.7, map: tex.grime });
    this.polymer = new THREE.MeshStandardMaterial({ color: 0x34373a, roughness: 0.7, metalness: 0.1, map: tex.grime });
    this.wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.6, map: tex.wood.map });

    this.models.set('rifle', this.buildRifle());
    this.models.set('pistol', this.buildPistol());
    this.models.set('shotgun', this.buildShotgun());
    for (const m of this.models.values()) { m.root.visible = false; this.rig.add(m.root); }

    this.plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.025), new THREE.MeshStandardMaterial({ color: 0x3d4238, roughness: 0.6, metalness: 0.4, map: tex.grime }));
    this.plate.visible = false;
    this.camera.add(this.plate);
    this.setTier('rifle', 0); this.setTier('pistol', 0); this.setTier('shotgun', 0);
    this.traverseNoCull();
  }

  private traverseNoCull(): void {
    this.scene.traverse((o) => { o.frustumCulled = false; });
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // --------------------------------------------------------------------------------------------
  // Model construction helpers
  // --------------------------------------------------------------------------------------------
  private box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  private cyl(parent: THREE.Object3D, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, seg = 12, r2 = r): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, len, seg), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** Gloved hand gripping around the given point, with forearm extending toward `elbow`. */
  private hand(parent: THREE.Object3D, at: THREE.Vector3, elbow: THREE.Vector3, side: 1 | -1, grip: 'vertical' | 'under' | 'pistol'): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    parent.add(g);
    // Palm
    this.box(g, this.gloveMat, 0.05, 0.075, 0.085, side * 0.028, -0.005, 0.0);
    // Fingers wrapping around the grip (four segments)
    for (let i = 0; i < 4; i++) {
      const y = grip === 'under' ? -0.02 : 0.025 - i * 0.021;
      const z = grip === 'under' ? -0.03 + i * 0.021 : -0.03;
      const f = this.box(g, this.gloveMat, 0.056, 0.018, 0.02, -side * 0.006, y, z);
      if (grip === 'under') { f.position.y = -0.03; f.position.x = -side * 0.018; f.rotation.z = side * 0.4; }
    }
    // Knuckle pads
    this.box(g, this.polymer, 0.02, 0.07, 0.03, side * 0.05, 0.0, -0.02);
    // Thumb
    const th = this.box(g, this.gloveMat, 0.018, 0.018, 0.06, -side * 0.02, 0.035, -0.02, 0.2, side * 0.3, 0);
    if (grip === 'pistol') th.position.set(-side * 0.03, 0.03, -0.02);
    // Cuff + forearm
    const wrist = new THREE.Vector3(side * 0.035, -0.02, 0.05);
    const dir = elbow.clone().sub(at).sub(wrist);
    const len = dir.length();
    const arm = new THREE.Group();
    arm.position.copy(wrist);
    g.add(arm);
    // Align the forearm's +Z with the direction toward the elbow.
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.05, 10), this.gloveMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.02;
    arm.add(cuff);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.05, len, 10), this.sleeveMat);
    fore.rotation.x = Math.PI / 2;
    fore.position.z = len / 2 + 0.03;
    arm.add(fore);
    // Rolled sleeve band + watch on the left wrist for character
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 10), this.sleeveMat);
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.09;
    arm.add(band);
    if (side < 0) {
      const watch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.03), this.polymer);
      watch.position.set(0, 0.04, 0.05);
      arm.add(watch);
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.002, 0.016), new THREE.MeshBasicMaterial({ color: 0x1a6a3a }));
      face.position.set(0, 0.047, 0.05);
      arm.add(face);
    }
    void this.skinMat;
    return g;
  }

  private flashSprite(parent: THREE.Object3D): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.flash, color: 0xffd8a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.set(0.2, 0.2, 1);
    s.visible = false;
    parent.add(s);
    return s;
  }

  private tierMats(): { accents: THREE.MeshStandardMaterial; body: THREE.MeshStandardMaterial } {
    return {
      accents: new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.4, metalness: 0.6 }),
      body: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.5, map: this.tex.grime }),
    };
  }

  private buildRifle(): WeaponModel {
    const root = new THREE.Group();
    const { accents, body } = this.tierMats();
    // Receiver & upper
    this.box(root, body, 0.058, 0.07, 0.3, 0, 0.02, -0.07);
    this.box(root, body, 0.052, 0.035, 0.34, 0, 0.068, -0.09);
    this.box(root, this.metal, 0.03, 0.012, 0.36, 0, 0.09, -0.1); // top rail
    for (let i = 0; i < 12; i++) this.box(root, this.metal, 0.034, 0.006, 0.012, 0, 0.098, -0.26 + i * 0.03);
    this.box(root, this.metal, 0.004, 0.022, 0.05, 0.03, 0.045, -0.04); // ejection port
    this.box(root, this.metal, 0.02, 0.012, 0.03, 0.03, 0.07, 0.05); // charging handle
    // Handguard with vents
    this.box(root, this.polymer, 0.064, 0.066, 0.3, 0, 0.035, -0.4);
    for (let i = 0; i < 5; i++) {
      this.box(root, accents, 0.066, 0.012, 0.035, 0, 0.035, -0.3 - i * 0.05);
    }
    this.box(root, this.metal, 0.028, 0.01, 0.28, 0, 0.073, -0.4);
    // Barrel + muzzle device
    this.cyl(root, this.metal, 0.012, 0.2, 0, 0.035, -0.62);
    this.cyl(root, this.metal, 0.02, 0.075, 0, 0.035, -0.745, 8);
    for (let i = 0; i < 3; i++) this.box(root, this.polymer, 0.042, 0.004, 0.008, 0, 0.035, -0.73 - i * 0.015);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.035, -0.8); root.add(muzzle);
    // Magazine (curved: two segments)
    const mag = new THREE.Group(); mag.position.set(0, -0.02, -0.12); root.add(mag);
    this.box(mag, this.polymer, 0.032, 0.1, 0.07, 0, -0.05, 0, 0.12);
    this.box(mag, this.polymer, 0.032, 0.08, 0.066, 0, -0.13, 0.018, 0.32);
    this.box(mag, accents, 0.034, 0.012, 0.072, 0, -0.17, 0.03, 0.32);
    this.box(root, body, 0.05, 0.03, 0.09, 0, -0.01, -0.12); // mag well
    // Pistol grip + trigger guard
    this.box(root, this.polymer, 0.034, 0.11, 0.045, 0, -0.05, 0.035, -0.32);
    this.box(root, this.metal, 0.008, 0.004, 0.06, 0, -0.03, -0.02);
    // Stock
    this.box(root, this.polymer, 0.04, 0.05, 0.16, 0, 0.03, 0.16);
    this.box(root, this.polymer, 0.046, 0.075, 0.1, 0, 0.018, 0.27);
    this.box(root, this.gloveMat, 0.05, 0.115, 0.025, 0, 0.01, 0.33);
    // Red dot optic
    this.box(root, this.metal, 0.03, 0.018, 0.05, 0, 0.105, -0.07);
    // Open-ended housing so the shooter can see through it when aiming.
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.06, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
    housing.rotation.x = Math.PI / 2;
    housing.position.set(0, 0.13, -0.07);
    root.add(housing);
    for (const z of [-0.1, -0.04]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 6, 20), this.metal);
      ring.position.set(0, 0.13, z);
      root.add(ring);
    }
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 20), new THREE.MeshStandardMaterial({ color: 0x5a8a7a, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.12, depthWrite: false }));
    lens.position.set(0, 0.13, -0.1);
    root.add(lens);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }));
    dot.position.set(0, 0.13, -0.104);
    root.add(dot);
    // Vertical foregrip
    this.box(root, this.polymer, 0.03, 0.075, 0.035, 0, -0.03, -0.42);
    // Charging-handle "mover" used for reload rack
    const mover = this.box(root, this.metal, 0.024, 0.012, 0.02, -0.03, 0.07, 0.04);
    // Hands
    this.hand(root, new THREE.Vector3(0.0, -0.045, 0.045), new THREE.Vector3(0.14, -0.2, 0.38), 1, 'pistol');
    const left = this.hand(root, new THREE.Vector3(0.0, -0.035, -0.42), new THREE.Vector3(-0.17, -0.22, -0.08), -1, 'vertical');
    return {
      id: 'rifle', root, mag, magHome: mag.position.clone(), mover, moverHome: mover.position.clone(), muzzle,
      sight: new THREE.Vector3(0, 0.13, -0.03), adsDist: 0.3, hip: new THREE.Vector3(0.15, -0.2, -0.36),
      leftHand: left, leftHome: left.position.clone(), leftHomeRot: left.rotation.clone(), flash: this.flashSprite(muzzle), accents, body,
    };
  }

  private buildPistol(): WeaponModel {
    const root = new THREE.Group();
    const { accents, body } = this.tierMats();
    const slide = new THREE.Group(); root.add(slide);
    this.box(slide, body, 0.03, 0.034, 0.19, 0, 0.035, -0.06);
    for (let i = 0; i < 6; i++) this.box(slide, this.metal, 0.032, 0.026, 0.004, 0, 0.035, 0.0 + i * 0.008);
    this.box(slide, this.metal, 0.006, 0.01, 0.006, 0, 0.056, -0.145); // front sight
    this.box(slide, this.metal, 0.024, 0.01, 0.006, 0, 0.056, 0.02); // rear sight
    this.box(slide, new THREE.MeshBasicMaterial({ color: 0x9aff9a }), 0.003, 0.003, 0.002, 0, 0.058, -0.149);
    this.box(slide, accents, 0.031, 0.006, 0.12, 0, 0.051, -0.07);
    this.box(root, this.polymer, 0.028, 0.024, 0.16, 0, 0.008, -0.05); // frame
    this.box(root, this.metal, 0.024, 0.004, 0.05, 0, -0.012, -0.03); // trigger guard
    this.box(root, this.polymer, 0.03, 0.115, 0.048, 0, -0.05, 0.02, -0.25); // grip
    this.cyl(root, this.metal, 0.009, 0.02, 0, 0.035, -0.158);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.035, -0.17); root.add(muzzle);
    const mag = new THREE.Group(); mag.position.set(0, -0.06, 0.03); mag.rotation.x = -0.25; root.add(mag);
    this.box(mag, this.metal, 0.024, 0.1, 0.036, 0, -0.02, 0);
    this.box(mag, accents, 0.028, 0.012, 0.042, 0, -0.07, 0);
    this.hand(root, new THREE.Vector3(0.0, -0.05, 0.03), new THREE.Vector3(0.12, -0.22, 0.34), 1, 'pistol');
    const left = this.hand(root, new THREE.Vector3(-0.022, -0.065, 0.02), new THREE.Vector3(-0.15, -0.24, 0.3), -1, 'under');
    return {
      id: 'pistol', root, mag, magHome: mag.position.clone(), mover: slide, moverHome: slide.position.clone(), muzzle,
      sight: new THREE.Vector3(0, 0.058, 0.03), adsDist: 0.44, hip: new THREE.Vector3(0.12, -0.15, -0.34),
      leftHand: left, leftHome: left.position.clone(), leftHomeRot: left.rotation.clone(), flash: this.flashSprite(muzzle), accents, body,
    };
  }

  private buildShotgun(): WeaponModel {
    const root = new THREE.Group();
    const { accents, body } = this.tierMats();
    this.box(root, body, 0.056, 0.08, 0.26, 0, 0.02, -0.06);
    this.box(root, this.metal, 0.004, 0.03, 0.08, 0.029, 0.03, -0.06); // ejection port
    this.cyl(root, this.metal, 0.015, 0.56, 0, 0.045, -0.47);
    this.cyl(root, this.metal, 0.015, 0.46, 0, 0.012, -0.42);
    this.cyl(root, this.metal, 0.018, 0.03, 0, 0.012, -0.66);
    this.box(root, this.metal, 0.012, 0.012, 0.44, 0, 0.068, -0.4); // vent rib
    this.box(root, new THREE.MeshBasicMaterial({ color: 0xffe0a0 }), 0.005, 0.005, 0.005, 0, 0.078, -0.74); // bead
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.045, -0.76); root.add(muzzle);
    // Pump
    const pump = new THREE.Group(); pump.position.set(0, 0.012, -0.36); root.add(pump);
    this.cyl(pump, this.wood, 0.032, 0.17, 0, 0, 0, 12, 0.03);
    for (let i = 0; i < 5; i++) this.cyl(pump, accents, 0.0335, 0.008, 0, 0, -0.06 + i * 0.03, 12);
    // Stock + grip
    this.box(root, this.wood, 0.036, 0.1, 0.05, 0, -0.04, 0.09, -0.4);
    this.box(root, this.wood, 0.044, 0.07, 0.2, 0, 0.0, 0.2, 0.1);
    this.box(root, this.wood, 0.048, 0.12, 0.08, 0, -0.02, 0.33, 0.1);
    this.box(root, this.gloveMat, 0.05, 0.13, 0.025, 0, -0.03, 0.38, 0.1);
    this.box(root, this.metal, 0.008, 0.004, 0.07, 0, -0.025, 0.0);
    // Side shell carrier
    for (let i = 0; i < 4; i++) {
      const sh = this.cyl(root, new THREE.MeshStandardMaterial({ color: 0x8a1a14, roughness: 0.5 }), 0.008, 0.045, -0.034, 0.0 + i * 0.018, -0.07, 8);
      sh.rotation.set(0, 0, Math.PI / 2);
    }
    const mag = new THREE.Object3D(); root.add(mag); // shotgun has no detachable magazine
    const shell = new THREE.Group();
    this.cyl(shell, new THREE.MeshStandardMaterial({ color: 0x9a1a14, roughness: 0.5 }), 0.01, 0.055, 0, 0, 0, 8);
    this.cyl(shell, new THREE.MeshStandardMaterial({ color: 0xc8a040, metalness: 0.8, roughness: 0.3 }), 0.0105, 0.012, 0, 0, 0.03, 8);
    this.hand(root, new THREE.Vector3(0.0, -0.04, 0.085), new THREE.Vector3(0.14, -0.21, 0.4), 1, 'pistol');
    const left = this.hand(pump, new THREE.Vector3(0, -0.025, 0), new THREE.Vector3(-0.17, -0.22, 0.28), -1, 'under');
    left.add(shell);
    shell.position.set(0.0, 0.04, -0.03);
    shell.visible = false;
    return {
      id: 'shotgun', root, mag, magHome: mag.position.clone(), mover: pump, moverHome: pump.position.clone(), muzzle,
      sight: new THREE.Vector3(0, 0.078, 0.0), adsDist: 0.26, hip: new THREE.Vector3(0.15, -0.2, -0.34),
      leftHand: left, leftHome: left.position.clone(), leftHomeRot: left.rotation.clone(), flash: this.flashSprite(muzzle), accents, body, shell,
    };
  }

  // --------------------------------------------------------------------------------------------
  setWeapon(id: WeaponId | null): void {
    for (const m of this.models.values()) m.root.visible = false;
    this.current = id ? this.models.get(id)! : null;
    if (this.current) this.current.root.visible = true;
  }

  setTier(id: WeaponId, tier: number): void {
    const m = this.models.get(id)!;
    const c = TIER_COLORS[Math.min(2, tier)];
    m.accents.color.setHex(c.accent);
    m.accents.emissive.setHex(c.emissive);
    m.accents.emissiveIntensity = c.ei;
    m.body.color.setHex(c.body);
  }

  fire(strength: number): void {
    if (!this.current) return;
    this.kickV += 0.9 * strength;
    this.kickRotV += 1.6 * strength;
    const f = this.current.flash;
    f.visible = true;
    f.material.rotation = Math.random() * Math.PI * 2;
    const s = (this.current.id === 'shotgun' ? 0.32 : this.current.id === 'pistol' ? 0.16 : 0.22) * (0.8 + Math.random() * 0.4);
    f.scale.set(s, s, 1);
    this.flashT = 0.045;
    this.flashLight.intensity = 3;
  }

  /** Muzzle position in camera space (used to place world-space tracers). */
  muzzleCameraSpace(out: THREE.Vector3): THREE.Vector3 {
    if (!this.current) return out.set(0.1, -0.1, -0.6);
    this.rig.updateMatrixWorld(true);
    this.current.muzzle.getWorldPosition(out);
    // Camera sits at the origin of its own scene with identity rotation when copying pose; convert explicitly.
    this.camera.worldToLocal(out);
    return out;
  }

  update(dt: number, s: ViewState): void {
    const m = this.current;
    if (!m) return;
    // Springs (critically-damped-ish)
    const k = 170, d = 20;
    this.kickV += (-k * this.kick - d * this.kickV) * dt;
    this.kick += this.kickV * dt;
    this.kickRotV += (-k * this.kickRot - d * this.kickRotV) * dt;
    this.kickRot += this.kickRotV * dt;
    const motion = s.reducedMotion ? 0.35 : 1;
    // Sway from look input (lagging)
    const tx = THREE.MathUtils.clamp(-s.lookDX * 0.0009, -0.06, 0.06) * motion;
    const ty = THREE.MathUtils.clamp(-s.lookDY * 0.0009, -0.06, 0.06) * motion;
    this.swayX += (tx - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (ty - this.swayY) * Math.min(1, dt * 8);

    const ads = s.adsT;
    const hip = m.hip;
    const adsPos = this.tmp.set(-m.sight.x, -m.sight.y, -m.sight.z - m.adsDist);
    const pos = new THREE.Vector3().lerpVectors(hip, adsPos, easeInOut(ads));
    const rot = new THREE.Euler(0, 0, 0);
    // Bob
    const bobAmt = Math.min(1, s.speed / 5) * (1 - ads * 0.85) * motion * (s.grounded ? 1 : 0.2);
    const ph = s.bobPhase;
    pos.x += Math.sin(ph) * 0.011 * bobAmt;
    pos.y += -Math.abs(Math.cos(ph)) * 0.011 * bobAmt + s.jumpOffset * 0.02 * motion;
    rot.z += Math.sin(ph) * 0.02 * bobAmt;
    // Idle breathing
    const t = performance.now() / 1000;
    pos.y += Math.sin(t * 1.6) * 0.0022 * (1 - ads * 0.8);
    pos.x += Math.cos(t * 0.8) * 0.0012 * (1 - ads * 0.8);
    // Sprint pose
    const sprintW = s.sprinting ? 1 : 0;
    this.tiltZ += (sprintW - this.tiltZ) * Math.min(1, dt * 9);
    pos.x += -0.04 * this.tiltZ;
    pos.y += -0.05 * this.tiltZ;
    rot.y += 0.75 * this.tiltZ;
    rot.x += -0.25 * this.tiltZ;
    rot.z += 0.2 * this.tiltZ;
    if (s.crouched) { pos.y -= 0.006; rot.z -= 0.04 * (1 - ads); }
    // Sway
    rot.y += this.swayX * (1 - ads * 0.6);
    rot.x += this.swayY * (1 - ads * 0.6);
    pos.x += this.swayX * 0.12 * (1 - ads * 0.7);
    // Recoil
    pos.z += this.kick * 0.045 * (1 - ads * 0.4);
    rot.x += this.kickRot * 0.06 * (1 - ads * 0.5);
    pos.y += this.kickRot * 0.004;

    // Reset animated parts
    m.mag.position.copy(m.magHome);
    m.mag.visible = true;
    m.mover.position.copy(m.moverHome);
    m.leftHand.position.copy(m.leftHome);
    m.leftHand.rotation.copy(m.leftHomeRot);
    if (m.shell) m.shell.visible = false;

    // Magazine reload timeline
    if (s.reloadPhase === 'mag') {
      const p = s.reloadP;
      const inW = smooth(p, 0, 0.15) * (1 - smooth(p, 0.85, 1));
      rot.z += 0.55 * inW;
      rot.x += 0.18 * inW;
      pos.y -= 0.02 * inW;
      pos.x -= 0.02 * inW;
      // Mag out
      const out = smooth(p, 0.15, 0.32);
      const back = smooth(p, 0.45, 0.66);
      const magDrop = out * (1 - back);
      m.mag.position.y = m.magHome.y - 0.28 * magDrop;
      m.mag.position.z = m.magHome.z + 0.05 * magDrop;
      m.mag.visible = !(out > 0.95 && back < 0.05);
      // Left hand travels down to fetch a fresh mag and back
      const lh = smooth(p, 0.12, 0.3) * (1 - smooth(p, 0.62, 0.75));
      m.leftHand.position.lerp(new THREE.Vector3(m.magHome.x - 0.02, m.magHome.y - 0.12, m.magHome.z + 0.02), lh);
      m.leftHand.rotation.x += lh * 0.5;
      if (p > 0.66 && p < 0.72) this.kickRotV -= 0.4 * dt * 60; // mag seat bump
      // Rack / slide release
      const rack = smooth(p, 0.72, 0.8) * (1 - smooth(p, 0.8, 0.86));
      m.mover.position.z = m.moverHome.z + (m.id === 'pistol' ? 0.03 : 0.07) * rack;
    }
    // Shell-by-shell reload
    if (s.reloadPhase === 'shellStart' || s.reloadPhase === 'shellLoop' || s.reloadPhase === 'shellEnd') {
      const w = s.reloadPhase === 'shellStart' ? smooth(s.shellT, 0, s.shellPer * 0.7) : s.reloadPhase === 'shellEnd' ? 1 - smooth(s.shellT, 0, s.shellPer * 0.8) : 1;
      rot.z -= 0.5 * w;
      rot.x += 0.22 * w;
      pos.x -= 0.03 * w;
      pos.y -= 0.01 * w;
      if (s.reloadPhase === 'shellLoop') {
        const lp = (s.shellT / s.shellPer) % 1;
        const push = Math.sin(lp * Math.PI);
        m.leftHand.position.y += -0.06 + 0.04 * push;
        m.leftHand.position.z += 0.24 - 0.03 * push;
        m.leftHand.position.x += 0.02;
        if (m.shell) m.shell.visible = lp < 0.75;
        rot.z -= push * 0.03;
      }
    }
    // Shotgun pump after firing
    if (m.id === 'shotgun' && s.sinceShot < 0.7) {
      const pump = smooth(s.sinceShot, 0.28, 0.42) * (1 - smooth(s.sinceShot, 0.46, 0.6));
      m.mover.position.z = m.moverHome.z + 0.09 * pump;
      rot.x -= pump * 0.05;
    }
    // Pistol slide blowback
    if (m.id === 'pistol' && s.sinceShot < 0.1) {
      m.mover.position.z = m.moverHome.z + 0.03 * (1 - s.sinceShot / 0.1);
    }
    // Weapon switch (lower / raise)
    if (s.switchT > 0) {
      const w = easeInOut(s.switchT);
      pos.y -= 0.28 * w;
      rot.x -= 0.9 * w;
      rot.z += 0.2 * w;
    }
    // Armor plate: lower weapon, bring plate up to chest
    if (s.plateT > 0) {
      const w = smooth(s.plateT, 0, 0.2) * (1 - smooth(s.plateT, 0.85, 1));
      pos.y -= 0.22 * w;
      rot.x -= 0.6 * w;
      this.plate.visible = true;
      const pp = s.plateT;
      const rise = smooth(pp, 0.05, 0.35);
      const slam = smooth(pp, 0.55, 0.7);
      this.plate.position.set(-0.05 + 0.03 * slam, -0.45 + 0.2 * rise - 0.12 * slam, -0.42 + 0.1 * slam);
      this.plate.rotation.set(-0.9 + 0.5 * rise - 0.9 * slam, 0.2, 0.1);
    } else this.plate.visible = false;

    this.rig.position.copy(pos);
    this.rig.rotation.copy(rot);
    // Muzzle flash decay
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { m.flash.visible = false; this.flashLight.intensity = 0; }
    }
  }
}

function smooth(x: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
