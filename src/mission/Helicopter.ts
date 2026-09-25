// Extraction helicopter: model, approach/landing path, rotor animation, landing lights and downwash.
import * as THREE from 'three';
import type { Materials } from '../render/materials';

export class Helicopter {
  readonly group = new THREE.Group();
  private rotor = new THREE.Group();
  private tailRotor = new THREE.Group();
  private blur: THREE.Mesh;
  private spot: THREE.SpotLight;
  private cone: THREE.Mesh;
  private navR: THREE.Sprite;
  private navG: THREE.Sprite;
  private strobe: THREE.Sprite;
  rotorRate = 0;
  private start = new THREE.Vector3(150, 60, 160);
  private ctrl = new THREE.Vector3(80, 45, 90);
  private hover: THREE.Vector3;
  private land: THREE.Vector3;
  departT = 0;

  constructor(M: Materials, landX: number, landZ: number) {
    this.land = new THREE.Vector3(landX, 0, landZ);
    this.hover = new THREE.Vector3(landX, 14, landZ);
    const body = new THREE.MeshStandardMaterial({ color: 0x7a8660, roughness: 0.6, metalness: 0.15, map: M.tex.grime, envMapIntensity: 1.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3e36, roughness: 0.6, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1a2630, roughness: 0.05, metalness: 0.6, envMapIntensity: 2 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = this.group) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // Fuselage: nose toward +Z, cabin door open on the -X side.
    add(new THREE.CapsuleGeometry(1.15, 3.6, 6, 14), body, 0, 1.9, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(2.2, 1.6, 3.2), body, 0, 1.75, -0.4);
    add(new THREE.SphereGeometry(1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 2.0, 2.3, Math.PI / 2 + 0.5);
    add(new THREE.BoxGeometry(0.06, 1.3, 1.9), dark, -1.12, 1.8, -0.2); // open door frame (dark interior)
    add(new THREE.BoxGeometry(1.9, 0.1, 2.6), dark, 0, 1.0, -0.3); // cabin floor
    add(new THREE.BoxGeometry(1.4, 0.6, 1.6), body, 0, 2.95, -0.3); // engine housing
    add(new THREE.CylinderGeometry(0.28, 0.55, 5.6, 10), body, 0, 2.3, -4.6, Math.PI / 2 + 0.06);
    add(new THREE.BoxGeometry(0.12, 1.6, 1.0), body, 0, 3.1, -7.2, 0.2);
    add(new THREE.BoxGeometry(1.8, 0.08, 0.6), body, 0, 2.5, -6.6);
    // Skids
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 8), dark, s * 1.15, 0.08, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), dark, s * 1.05, 0.5, 1.1, 0, 0, s * 0.3);
      add(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), dark, s * 1.05, 0.5, -1.1, 0, 0, s * 0.3);
    }
    // Rotor
    this.rotor.position.set(0, 3.45, -0.3);
    this.group.add(this.rotor);
    add(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 8), dark, 0, -0.2, 0, 0, 0, 0, this.rotor);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i * Math.PI) / 2;
      this.rotor.add(arm);
      add(new THREE.BoxGeometry(0.32, 0.05, 6.2), dark, 0, 0, 3.1, 0, 0, 0, arm);
    }
    this.blur = new THREE.Mesh(new THREE.CircleGeometry(6.3, 40), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.blur.rotation.x = -Math.PI / 2;
    this.rotor.add(this.blur);
    this.tailRotor.position.set(0.12, 3.1, -7.3);
    this.group.add(this.tailRotor);
    for (let i = 0; i < 2; i++) add(new THREE.BoxGeometry(0.04, 1.6, 0.14), dark, 0, 0, 0, i * Math.PI / 2, 0, 0, this.tailRotor);
    // Lights
    this.spot = new THREE.SpotLight(0xe8f0ff, 0, 60, 0.45, 0.5, 1.2);
    this.spot.position.set(0, 1.0, 1.8);
    this.spot.target.position.set(0, -10, 6);
    this.group.add(this.spot, this.spot.target);
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(4, 16, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.cone.position.set(0, -7, 4.5);
    this.cone.rotation.x = -0.35;
    this.group.add(this.cone);
    this.navR = new THREE.Sprite(M.glowRed.clone()); this.navR.position.set(-1.2, 1.6, 0.8); this.navR.scale.setScalar(0.5);
    this.navG = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.tex.glow, color: 0x30ff60, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.navG.position.set(1.2, 1.6, 0.8); this.navG.scale.setScalar(0.5);
    this.strobe = new THREE.Sprite(M.glowCold.clone()); this.strobe.position.set(0, 3.2, -7.6); this.strobe.scale.setScalar(1.4);
    this.group.add(this.navR, this.navG, this.strobe);
    // Kept 'visible' but parked underground when inactive so light counts never change (no shader recompiles).
    this.group.position.set(landX, -200, landZ);
    // Face nose toward -X so the open door looks north toward the boarding marker.
    this.group.rotation.y = -Math.PI / 2;
  }

  reset(): void {
    this.group.position.set(this.land.x, -200, this.land.z);
    this.rotorRate = 0;
    this.departT = 0;
    this.spot.intensity = 0;
  }

  /** Approach progress 0..1: fly the curve, then descend vertically onto the pad. */
  updateApproach(a: number, visible: boolean, time: number, dt: number): void {
    if (!visible) {
      this.group.position.set(this.land.x, -200, this.land.z);
      this.spot.intensity = 0;
      this.rotorRate = 0;
      return;
    }
    const pos = new THREE.Vector3();
    if (a < 0.72) {
      const t = easeInOut(a / 0.72);
      // Quadratic bezier start -> ctrl -> hover
      pos.copy(this.start).multiplyScalar((1 - t) * (1 - t)).addScaledVector(this.ctrl, 2 * (1 - t) * t).addScaledVector(this.hover, t * t);
      const tangent = new THREE.Vector3().copy(this.ctrl).sub(this.start).multiplyScalar(2 * (1 - t)).addScaledVector(new THREE.Vector3().copy(this.hover).sub(this.ctrl), 2 * t);
      const yaw = Math.atan2(tangent.x, tangent.z);
      const settle = smooth(a, 0.55, 0.72);
      this.group.rotation.set(0.12 * (1 - settle), lerpAngle(yaw, -Math.PI / 2, settle), 0);
    } else {
      const t = easeInOut((a - 0.72) / 0.28);
      pos.lerpVectors(this.hover, this.land, t);
      this.group.rotation.set(0, -Math.PI / 2, Math.sin(time * 1.3) * 0.02 * (1 - t));
    }
    if (a >= 1) pos.copy(this.land);
    pos.y += a >= 1 ? 0 : Math.sin(time * 1.7) * 0.15;
    this.group.position.copy(pos);
    this.rotorRate = 1;
    this.spin(dt, time);
    this.spot.intensity = a > 0.4 ? 180 : 0;
    this.cone.visible = a > 0.4 && a < 1;
  }

  /** Takeoff for the extraction cinematic. */
  updateDepart(dt: number, time: number): void {
    this.departT += dt;
    const t = this.departT;
    const lift = Math.min(1, t / 2.5);
    this.group.position.set(this.land.x - Math.max(0, t - 2) * Math.max(0, t - 2) * 2.2, easeInOut(lift) * 14 + Math.max(0, t - 2) * 4, this.land.z - Math.max(0, t - 2) * 3);
    this.group.rotation.set(t > 2 ? -0.18 : 0, -Math.PI / 2 - Math.min(0.3, Math.max(0, t - 2) * 0.1), 0);
    this.spin(dt, time);
    this.cone.visible = false;
  }

  private spin(dt: number, time: number): void {
    this.rotor.rotation.y += dt * 28 * this.rotorRate;
    this.tailRotor.rotation.x += dt * 50 * this.rotorRate;
    (this.blur.material as THREE.MeshBasicMaterial).opacity = 0.18 * this.rotorRate;
    const blink = Math.sin(time * 6) > 0.6;
    this.navR.visible = this.navG.visible = true;
    this.strobe.visible = blink;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }
}

function easeInOut(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function smooth(x: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
