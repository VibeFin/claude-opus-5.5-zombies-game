// Static axis-aligned box collision world with a uniform-grid broadphase.
// Used for player/zombie movement, bullet rays, grenade bounces and line-of-sight checks.

export type Surface = 'concrete' | 'metal' | 'wood' | 'dirt' | 'glass';

export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  surface: Surface;
  /** Top surface is intended as walkable floor (stairs, docks, building slabs). */
  floor: boolean;
  /** Blocks bullets and sight. Chain-link fences, for example, do not. */
  solid: boolean;
  stamp: number;
}

export interface RayHit {
  dist: number;
  nx: number; ny: number; nz: number;
  box: Box | null; // null = ground plane
}

export interface MoveResult {
  grounded: boolean;
  hitCeiling: boolean;
  blockedX: boolean;
  blockedZ: boolean;
}

const EPS = 1e-4;

export class CollisionWorld {
  boxes: Box[] = [];
  private cell = 4;
  private cols = 0;
  private rows = 0;
  private ox = 0;
  private oz = 0;
  private grid: number[][] = [];
  private stampCounter = 1;
  private scratch: Box[] = [];

  constructor(public minX: number, public minZ: number, public maxX: number, public maxZ: number) {
    this.ox = minX - 8;
    this.oz = minZ - 8;
    this.cols = Math.ceil((maxX - minX + 16) / this.cell);
    this.rows = Math.ceil((maxZ - minZ + 16) / this.cell);
    for (let i = 0; i < this.cols * this.rows; i++) this.grid.push([]);
  }

  add(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
    opts: { surface?: Surface; floor?: boolean; solid?: boolean } = {}): Box {
    const b: Box = {
      minX: Math.min(minX, maxX), minY: Math.min(minY, maxY), minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX), maxY: Math.max(minY, maxY), maxZ: Math.max(minZ, maxZ),
      surface: opts.surface ?? 'concrete', floor: opts.floor ?? false, solid: opts.solid ?? true, stamp: 0,
    };
    const idx = this.boxes.length;
    this.boxes.push(b);
    const c0 = this.cx(b.minX), c1 = this.cx(b.maxX), r0 = this.cz(b.minZ), r1 = this.cz(b.maxZ);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.grid[r * this.cols + c].push(idx);
    return b;
  }

  private cx(x: number) { return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.ox) / this.cell))); }
  private cz(z: number) { return Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.oz) / this.cell))); }

  /** Collects boxes whose XZ footprint may overlap the given rectangle. Result array is reused. */
  query(minX: number, minZ: number, maxX: number, maxZ: number): Box[] {
    const out = this.scratch;
    out.length = 0;
    const stamp = ++this.stampCounter;
    const c0 = this.cx(minX), c1 = this.cx(maxX), r0 = this.cz(minZ), r1 = this.cz(maxZ);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const list = this.grid[r * this.cols + c];
        for (let i = 0; i < list.length; i++) {
          const b = this.boxes[list[i]];
          if (b.stamp === stamp) continue;
          b.stamp = stamp;
          if (b.maxX > minX && b.minX < maxX && b.maxZ > minZ && b.minZ < maxZ) out.push(b);
        }
      }
    }
    return out;
  }

  /** True if a vertical box (feet position, half-width, height) overlaps any collider. */
  overlaps(x: number, y: number, z: number, r: number, h: number): boolean {
    const list = this.query(x - r, z - r, x + r, z + r);
    for (const b of list) {
      if (y + h > b.minY + EPS && y < b.maxY - EPS &&
        x + r > b.minX + EPS && x - r < b.maxX - EPS && z + r > b.minZ + EPS && z - r < b.maxZ - EPS) return true;
    }
    return false;
  }

  /**
   * Moves a vertical box by (dx, dy, dz) resolving one axis at a time, which slides along walls.
   * Supports stepping up small ledges (curbs, stairs) while grounded.
   */
  move(pos: { x: number; y: number; z: number }, r: number, h: number, dx: number, dy: number, dz: number,
    stepHeight: number, wasGrounded: boolean): MoveResult {
    const res: MoveResult = { grounded: false, hitCeiling: false, blockedX: false, blockedZ: false };
    // Horizontal axes in sub-steps so fast movers cannot tunnel through thin walls.
    const horiz = Math.max(Math.abs(dx), Math.abs(dz));
    const steps = Math.max(1, Math.ceil(horiz / (r * 0.9)));
    for (let s = 0; s < steps; s++) {
      if (this.moveHoriz(pos, r, h, dx / steps, 0, stepHeight, wasGrounded)) res.blockedX = true;
      if (this.moveHoriz(pos, r, h, 0, dz / steps, stepHeight, wasGrounded)) res.blockedZ = true;
    }
    // Vertical
    pos.y += dy;
    const list = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
    for (const b of list) {
      if (!(pos.x + r > b.minX + EPS && pos.x - r < b.maxX - EPS && pos.z + r > b.minZ + EPS && pos.z - r < b.maxZ - EPS)) continue;
      if (pos.y + h > b.minY + EPS && pos.y < b.maxY - EPS) {
        if (dy <= 0) {
          pos.y = b.maxY;
          res.grounded = true;
        } else {
          pos.y = b.minY - h;
          res.hitCeiling = true;
        }
      }
    }
    if (pos.y <= 0) {
      pos.y = 0;
      res.grounded = true;
    }
    // Ground snap: remain grounded when walking down steps / off tiny ledges.
    if (!res.grounded && wasGrounded && dy <= 0) {
      const g = this.groundHeight(pos.x, pos.z, r, pos.y + EPS);
      if (pos.y - g <= stepHeight + 0.05) {
        pos.y = g;
        res.grounded = true;
      }
    }
    return res;
  }

  private moveHoriz(pos: { x: number; y: number; z: number }, r: number, h: number, dx: number, dz: number,
    stepHeight: number, grounded: boolean): boolean {
    if (dx === 0 && dz === 0) return false;
    pos.x += dx;
    pos.z += dz;
    const list = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
    let blocked = false;
    let stepTo = -Infinity;
    for (const b of list) {
      if (!(pos.y + h > b.minY + EPS && pos.y < b.maxY - EPS)) continue;
      if (!(pos.x + r > b.minX + EPS && pos.x - r < b.maxX - EPS && pos.z + r > b.minZ + EPS && pos.z - r < b.maxZ - EPS)) continue;
      if (grounded && b.maxY - pos.y <= stepHeight) {
        stepTo = Math.max(stepTo, b.maxY);
        continue;
      }
      blocked = true;
      if (dx > 0) pos.x = Math.min(pos.x, b.minX - r - EPS);
      else if (dx < 0) pos.x = Math.max(pos.x, b.maxX + r + EPS);
      if (dz > 0) pos.z = Math.min(pos.z, b.minZ - r - EPS);
      else if (dz < 0) pos.z = Math.max(pos.z, b.maxZ + r + EPS);
    }
    if (stepTo > -Infinity) {
      if (!this.overlaps(pos.x, stepTo + EPS, pos.z, r, h)) {
        pos.y = stepTo;
      } else {
        // Can't step up there: treat as a wall.
        pos.x -= dx;
        pos.z -= dz;
        blocked = true;
      }
    }
    return blocked;
  }

  /** Highest floor top at or below `maxY` under the footprint. Ground plane is y = 0. */
  groundHeight(x: number, z: number, r: number, maxY: number): number {
    let g = 0;
    const list = this.query(x - r, z - r, x + r, z + r);
    for (const b of list) {
      if (b.maxY <= maxY + EPS && b.maxY > g &&
        x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) g = b.maxY;
    }
    return g;
  }

  /**
   * Casts a ray against solid boxes and the ground plane. Direction must be normalised.
   * Uses a 2D DDA over the broadphase grid so long rays stay cheap.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number,
    solidOnly = true): RayHit | null {
    let best = maxDist;
    let hit: RayHit | null = null;
    // Ground plane
    if (dy < -1e-6) {
      const t = -oy / dy;
      if (t >= 0 && t < best) {
        best = t;
        hit = { dist: t, nx: 0, ny: 1, nz: 0, box: null };
      }
    }
    const stamp = ++this.stampCounter;
    const cs = this.cell;
    let c = Math.floor((ox - this.ox) / cs);
    let r = Math.floor((oz - this.oz) / cs);
    const stepC = dx > 0 ? 1 : -1;
    const stepR = dz > 0 ? 1 : -1;
    const tDeltaC = Math.abs(dx) > 1e-9 ? cs / Math.abs(dx) : Infinity;
    const tDeltaR = Math.abs(dz) > 1e-9 ? cs / Math.abs(dz) : Infinity;
    const nextCx = this.ox + (c + (dx > 0 ? 1 : 0)) * cs;
    const nextRz = this.oz + (r + (dz > 0 ? 1 : 0)) * cs;
    let tMaxC = Math.abs(dx) > 1e-9 ? (nextCx - ox) / dx : Infinity;
    let tMaxR = Math.abs(dz) > 1e-9 ? (nextRz - oz) / dz : Infinity;
    let tCell = 0;
    for (let iter = 0; iter < 256; iter++) {
      if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
        const list = this.grid[r * this.cols + c];
        for (let i = 0; i < list.length; i++) {
          const b = this.boxes[list[i]];
          if (b.stamp === stamp) continue;
          b.stamp = stamp;
          if (solidOnly && !b.solid) continue;
          const h = rayBox(ox, oy, oz, dx, dy, dz, b, best);
          if (h) { best = h.dist; hit = h; hit.box = b; }
        }
      }
      if (tCell > best) break;
      if (tMaxC < tMaxR) { tCell = tMaxC; tMaxC += tDeltaC; c += stepC; }
      else { tCell = tMaxR; tMaxR += tDeltaR; r += stepR; }
      if (tCell > best || tCell > maxDist) break;
    }
    return hit;
  }

  /** True if the straight segment between two points is blocked by solid geometry. */
  segmentBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    const h = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len);
    return !!h && h.dist < len - 0.05;
  }
}

function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box, maxT: number): RayHit | null {
  let tmin = 0, tmax = maxT;
  let nAxis = -1, nSign = 0;
  // X slab
  if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return null; }
  else {
    const inv = 1 / dx;
    let t1 = (b.minX - ox) * inv, t2 = (b.maxX - ox) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = 0; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return null; }
  else {
    const inv = 1 / dy;
    let t1 = (b.minY - oy) * inv, t2 = (b.maxY - oy) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = 1; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return null; }
  else {
    const inv = 1 / dz;
    let t1 = (b.minZ - oz) * inv, t2 = (b.maxZ - oz) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = 2; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis < 0) return null; // origin inside box: ignore (prevents self-hits when hugging walls)
  return {
    dist: tmin,
    nx: nAxis === 0 ? nSign : 0,
    ny: nAxis === 1 ? nSign : 0,
    nz: nAxis === 2 ? nSign : 0,
    box: b,
  };
}
