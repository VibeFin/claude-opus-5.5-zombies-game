// Thrown frag grenades: visible arc, world bounces via ray sweeps, fuse and occluded blast damage.
import * as THREE from 'three';
import { GRENADE } from '../config';
import type { CollisionWorld } from '../world/Collision';

interface Grenade { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; fuse: number; spin: THREE.Vector3; lastBounce: number }

export interface Blast { x: number; y: number; z: number }

export class Grenades {
  readonly group = new THREE.Group();
  private list: Grenade[] = [];
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshStandardMaterial;
  private blink: THREE.MeshBasicMaterial;

  constructor() {
    const body = new THREE.SphereGeometry(0.06, 10, 8);
    body.scale(1, 1.25, 1);
    this.geo = body;
    this.mat = new THREE.MeshStandardMaterial({ color: 0x3f4632, roughness: 0.6, metalness: 0.3 });
    this.blink = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3020).multiplyScalar(3) });
  }

  reset(): void {
    for (const g of this.list) this.group.remove(g.mesh);
    this.list.length = 0;
  }

  throw(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, inheritVX: number, inheritVZ: number): void {
    const mesh = new THREE.Mesh(this.geo, this.mat);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), this.blink);
    light.position.y = 0.08;
    mesh.add(light);
    mesh.castShadow = true;
    const up = 0.28;
    const v = new THREE.Vector3(dx, dy + up, dz).normalize().multiplyScalar(GRENADE.throwSpeed);
    v.x += inheritVX * 0.6;
    v.z += inheritVZ * 0.6;
    const g: Grenade = { mesh, pos: new THREE.Vector3(ox, oy, oz), vel: v, fuse: GRENADE.fuse, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0), lastBounce: 0 };
    mesh.position.copy(g.pos);
    this.group.add(mesh);
    this.list.push(g);
  }

  /** Steps grenades. Returns blasts that detonated this step and bounce positions for audio. */
  update(dt: number, world: CollisionWorld, onBounce: (x: number, z: number) => void): Blast[] {
    const blasts: Blast[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.fuse -= dt;
      g.lastBounce += dt;
      g.vel.y -= 18 * dt;
      // Sweep the movement with a ray so fast grenades never tunnel through thin walls.
      let remaining = g.vel.length() * dt;
      let iter = 0;
      while (remaining > 1e-4 && iter++ < 3) {
        const len = g.vel.length();
        if (len < 1e-4) break;
        const dx = g.vel.x / len, dy = g.vel.y / len, dz = g.vel.z / len;
        const hit = world.raycast(g.pos.x, g.pos.y, g.pos.z, dx, dy, dz, remaining + 0.06, false);
        if (hit && hit.dist <= remaining + 0.06) {
          const travel = Math.max(0, hit.dist - 0.06);
          g.pos.x += dx * travel; g.pos.y += dy * travel; g.pos.z += dz * travel;
          remaining -= travel;
          // Reflect velocity about the surface normal, with energy loss
          const vn = g.vel.x * hit.nx + g.vel.y * hit.ny + g.vel.z * hit.nz;
          g.vel.x -= 2 * vn * hit.nx; g.vel.y -= 2 * vn * hit.ny; g.vel.z -= 2 * vn * hit.nz;
          g.vel.multiplyScalar(GRENADE.bounce);
          if (hit.ny > 0.7) { g.vel.x *= 0.7; g.vel.z *= 0.7; }
          if (Math.abs(vn) > 2 && g.lastBounce > 0.08) { onBounce(g.pos.x, g.pos.z); g.lastBounce = 0; }
          g.spin.multiplyScalar(0.6);
          if (g.vel.length() < 0.5) { g.vel.set(0, 0, 0); remaining = 0; }
        } else {
          g.pos.x += dx * remaining; g.pos.y += dy * remaining; g.pos.z += dz * remaining;
          remaining = 0;
        }
      }
      if (g.pos.y < 0.06) { g.pos.y = 0.06; if (g.vel.y < 0) g.vel.y = 0; g.vel.x *= 0.9; g.vel.z *= 0.9; }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.spin.x * dt;
      g.mesh.rotation.z += g.spin.y * dt;
      (g.mesh.children[0] as THREE.Mesh).visible = Math.sin(g.fuse * (g.fuse < 1 ? 40 : 18)) > 0;
      if (g.fuse <= 0) {
        blasts.push({ x: g.pos.x, y: g.pos.y, z: g.pos.z });
        this.group.remove(g.mesh);
        this.list.splice(i, 1);
      }
    }
    return blasts;
  }
}
