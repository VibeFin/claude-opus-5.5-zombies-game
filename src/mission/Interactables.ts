// World interactables: supply caches, buy / upgrade stations, and dropped ammo.
// Visual state and one-time-use flags live here; rewards are applied by the game.
import * as THREE from 'three';
import type { RegionId } from '../config';
import type { Materials } from '../render/materials';
import { signTexture } from '../render/textures';
import type { CrateSpot, Station } from '../world/Level';

export interface Crate {
  spot: CrateSpot;
  group: THREE.Group;
  lid: THREE.Object3D;
  strip: THREE.Mesh;
  glow: THREE.Sprite;
  opened: boolean;
  openT: number;
}

export interface AmmoDrop { mesh: THREE.Group; x: number; z: number; life: number }

export interface Loot { cash: number; plates: number; grenades: number; ammoMags: number }

export function rollLoot(region: RegionId, rnd: () => number = Math.random): Loot {
  if (region === 'low') return { cash: 150 + Math.round(rnd() * 150), plates: rnd() < 0.45 ? 1 : 0, grenades: rnd() < 0.25 ? 1 : 0, ammoMags: 2 };
  if (region === 'medium') return { cash: 320 + Math.round(rnd() * 230), plates: rnd() < 0.7 ? 1 : 0, grenades: rnd() < 0.4 ? 1 : 0, ammoMags: 3 };
  return { cash: 650 + Math.round(rnd() * 300), plates: 2, grenades: rnd() < 0.6 ? 1 : 0, ammoMags: 4 };
}

export class Interactables {
  readonly group = new THREE.Group();
  crates: Crate[] = [];
  drops: AmmoDrop[] = [];
  private dropTpl: THREE.Group;
  private stripOn: THREE.MeshBasicMaterial;
  private stripOff: THREE.MeshBasicMaterial;

  constructor(private M: Materials, spots: CrateSpot[], stations: Station[]) {
    this.stripOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc040).multiplyScalar(2.2) });
    this.stripOff = new THREE.MeshBasicMaterial({ color: 0x222222 });
    for (const s of spots) this.crates.push(this.buildCrate(s));
    for (const st of stations) this.group.add(st.kind === 'buy' ? this.buildBuyStation(st) : this.buildUpgradeBench(st));
    this.dropTpl = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.26), M.olive);
    box.castShadow = true;
    this.dropTpl.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.05, 0.27), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x60c0ff).multiplyScalar(2) }));
    this.dropTpl.add(band);
  }

  reset(): void {
    for (const c of this.crates) {
      c.opened = false;
      c.openT = 0;
      c.lid.rotation.x = 0;
      c.strip.material = this.stripOn;
      c.glow.visible = true;
    }
    for (const d of this.drops) this.group.remove(d.mesh);
    this.drops.length = 0;
  }

  private buildCrate(s: CrateSpot): Crate {
    const M = this.M;
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    const tier = s.region === 'high' ? M.hazardYellow : s.region === 'medium' ? M.olive : M.oliveDark;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 0.7), tier);
    base.position.y = 0.225;
    base.castShadow = base.receiveShadow = true;
    g.add(base);
    for (const x of [-0.45, 0.45]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.72), M.metalDark);
      h.position.set(x, 0.3, 0);
      g.add(h);
    }
    const lid = new THREE.Group();
    lid.position.set(0, 0.45, -0.35);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.14, 0.72), tier);
    lidMesh.position.set(0, 0.07, 0.35);
    lidMesh.castShadow = true;
    lid.add(lidMesh);
    g.add(lid);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.02), this.stripOn);
    strip.position.set(0, 0.36, 0.355);
    g.add(strip);
    const strip2 = strip.clone();
    strip2.position.z = -0.355;
    g.add(strip2);
    const glow = new THREE.Sprite(M.glowWarm);
    glow.scale.set(1.6, 1.0, 1);
    glow.position.set(0, 0.6, 0);
    g.add(glow);
    this.group.add(g);
    return { spot: s, group: g, lid, strip, glow, opened: false, openT: 0 };
  }

  private buildBuyStation(s: Station): THREE.Group {
    const M = this.M;
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.yaw;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.55, 0.7), M.olive);
    body.position.y = 0.775;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.85), M.oliveDark);
    hood.position.set(0, 1.6, 0.06);
    g.add(hood);
    const tex = signTexture(['QUARTERMASTER', 'AMMO · ARMOR · ARMS'], { bg: '#06140c', fg: '#58ffa0', w: 512, h: 320 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) }));
    screen.position.set(0, 1.12, 0.356);
    g.add(screen);
    const keypad = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.2), M.metalDark);
    keypad.position.set(0, 0.72, 0.42);
    keypad.rotation.x = 0.4;
    g.add(keypad);
    const lamp = new THREE.Sprite(this.M.glowCold);
    lamp.position.set(0, 1.12, 0.6);
    lamp.scale.set(1.8, 1.2, 1);
    g.add(lamp);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 10), M.screenGreen);
    beacon.position.set(0.5, 1.75, 0);
    g.add(beacon);
    // Stacked ammo cans beside
    for (let i = 0; i < 3; i++) {
      const can = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.18), M.oliveDark);
      can.position.set(0.82, 0.1 + i * 0.2, 0.1);
      can.castShadow = true;
      g.add(can);
    }
    return g;
  }

  private buildUpgradeBench(s: Station): THREE.Group {
    const M = this.M;
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.yaw;
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.0), M.metal);
    top.position.y = 0.95;
    top.castShadow = top.receiveShadow = true;
    g.add(top);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 0.9), M.metalDark);
    base.position.y = 0.45;
    g.add(base);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 0.06), M.metalDark);
    board.position.set(0, 1.7, -0.47);
    g.add(board);
    const tex = signTexture(['ARMORY UPGRADE', 'CALIBRATION BENCH'], { bg: '#061220', fg: '#6ac8ff', w: 512, h: 256 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5) }));
    screen.position.set(0, 1.75, -0.43);
    g.add(screen);
    // Vice, tools and a rifle receiver on the bench
    const vice = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.2), M.steel);
    vice.position.set(-0.7, 1.1, 0);
    g.add(vice);
    const part = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.1), M.metalDark);
    part.position.set(0.1, 1.04, 0.1);
    g.add(part);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40a8ff).multiplyScalar(2.5) }));
    glow.position.set(0, 1.01, 0.5);
    g.add(glow);
    const lamp = new THREE.Sprite(M.glowCold);
    lamp.position.set(0, 1.4, 0.3);
    lamp.scale.set(2.6, 1.4, 1);
    g.add(lamp);
    return g;
  }

  spawnDrop(x: number, z: number): void {
    const m = this.dropTpl.clone();
    m.position.set(x, 0.12, z);
    this.group.add(m);
    this.drops.push({ mesh: m, x, z, life: 30 });
  }

  update(dt: number, time: number): void {
    for (const c of this.crates) {
      if (c.opened && c.openT < 1) {
        c.openT = Math.min(1, c.openT + dt * 3);
        c.lid.rotation.x = -1.9 * (1 - Math.pow(1 - c.openT, 3));
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      d.mesh.rotation.y += dt * 2;
      d.mesh.position.y = 0.2 + Math.sin(time * 3 + i) * 0.05;
      if (d.life <= 0) { this.group.remove(d.mesh); this.drops.splice(i, 1); }
    }
  }

  open(c: Crate): boolean {
    if (c.opened) return false;
    c.opened = true;
    c.strip.material = this.stripOff;
    for (const o of c.group.children) if ((o as THREE.Mesh).material === this.stripOn) (o as THREE.Mesh).material = this.stripOff;
    c.glow.visible = false;
    return true;
  }

  /** Removes and returns ammo drops within pickup range. */
  collectDrops(x: number, z: number): number {
    let n = 0;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (Math.hypot(d.x - x, d.z - z) < 1.4) {
        this.group.remove(d.mesh);
        this.drops.splice(i, 1);
        n++;
      }
    }
    return n;
  }
}
