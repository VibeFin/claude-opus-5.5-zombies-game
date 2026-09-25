// Decides when/where/what to spawn. Threat region, mission pressure, contracts and the final horde
// all change composition and rate. Spawns happen at reachable points out of the player's sight.
import { ENEMIES, REGIONS, regionAt, type RegionId, type ZombieType } from '../config';
import type { Level, P2 } from '../world/Level';
import type { EnemyManager } from './EnemyManager';

export interface SpawnContext {
  px: number; pz: number; eyeY: number;
  fx: number; fz: number; // player forward (xz)
  pressure: number;
  defenseActive: boolean;
  finalHorde: boolean;
}

export class Spawner {
  private timer = 3;
  private defenseTimer = 0;
  private hordeTimer = 0;

  constructor(private level: Level, private enemies: EnemyManager) {}

  reset(): void {
    this.timer = 4;
    this.defenseTimer = 0;
    this.hordeTimer = 0;
  }

  /** Initial idle population scattered through each region, away from the insertion point. */
  populate(): void {
    const nav = this.level.nav;
    const spawn = this.level.poi.playerSpawn;
    const c = { x: 0, z: 0 };
    for (const r of Object.keys(REGIONS) as RegionId[]) {
      const def = REGIONS[r];
      let placed = 0, tries = 0;
      while (placed < def.initialPopulation && tries++ < 800) {
        const i = Math.floor(Math.random() * nav.walk.length);
        if (!nav.walk[i]) continue;
        nav.cellCenter(i, c);
        if (regionAt(c.z) !== r) continue;
        if (Math.hypot(c.x - spawn.x, c.z - spawn.z) < 38) continue;
        if (nav.height[i] > 0.2) continue;
        this.enemies.spawn(pickType(def.weights), r, c.x, c.z, 'idle');
        placed++;
      }
    }
    // The hunt target patrols the research compound.
    const e = this.level.poi.eliteSpawn;
    this.enemies.spawn('elite', 'high', e.x, e.z, 'idle');
    // Escort
    for (let k = 0; k < 3; k++) this.enemies.spawn(k === 0 ? 'armored' : 'runner', 'high', e.x + (k - 1) * 2.5, e.z + 3, 'idle');
  }

  update(dt: number, ctx: SpawnContext): void {
    const region = regionAt(ctx.pz);
    const def = REGIONS[region];
    const alive = this.enemies.aliveCount;
    const cap = Math.min(ENEMIES.globalCap, Math.round(def.maxAlive * ctx.pressure) + (ctx.defenseActive ? 8 : 0));

    // Ambient pressure for the player's current region
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = def.spawnInterval / ctx.pressure * (0.7 + Math.random() * 0.6);
      if (alive < cap) {
        const group = region === 'low' ? 1 : Math.random() < 0.35 ? 2 : 1;
        for (let g = 0; g < group && this.enemies.aliveCount < cap; g++) this.spawnNear(ctx, region, pickType(def.weights));
      }
    }
    // Defense contract waves converge on the transmitter
    if (ctx.defenseActive) {
      this.defenseTimer -= dt;
      if (this.defenseTimer <= 0) {
        this.defenseTimer = 2.4 / ctx.pressure;
        if (this.enemies.aliveCount < ENEMIES.globalCap) this.spawnNear(ctx, 'medium', pickType(REGIONS.medium.weights), 18, 42);
      }
    }
    // Extraction final horde: fast, high-threat composition, capped.
    if (ctx.finalHorde) {
      this.hordeTimer -= dt;
      if (this.hordeTimer <= 0) {
        this.hordeTimer = 1.25;
        if (this.enemies.aliveCount < ENEMIES.hordeCap) this.spawnNear(ctx, 'medium', pickType(REGIONS.medium.weights), 20, 45, true);
      }
    }
  }

  private spawnNear(ctx: SpawnContext, region: RegionId, type: ZombieType, minD = ENEMIES.spawnMinDist, maxD = ENEMIES.spawnMaxDist, anyRegion = false): boolean {
    const nav = this.level.nav;
    const world = this.level.world;
    const cands: P2[] = [];
    const regions: RegionId[] = anyRegion ? ['low', 'medium', 'high'] : neighbours(region);
    for (const r of regions) cands.push(...this.level.poi.spawns[r]);
    const good: P2[] = [];
    const ok: P2[] = [];
    for (const p of cands) {
      const straight = Math.hypot(p.x - ctx.px, p.z - ctx.pz);
      if (straight < minD) continue;
      const path = nav.pathDist(p.x, p.z);
      if (!isFinite(path) || path > maxD * 1.6) continue;
      if (straight > maxD) continue;
      // Prefer spawns the player cannot see: behind them or occluded.
      const dx = (p.x - ctx.px) / straight, dz = (p.z - ctx.pz) / straight;
      const facing = dx * ctx.fx + dz * ctx.fz;
      const occluded = world.segmentBlocked(ctx.px, ctx.eyeY, ctx.pz, p.x, 1.4, p.z);
      if (occluded || facing < -0.2) good.push(p);
      else if (straight > 38) ok.push(p);
    }
    const list = good.length ? good : ok;
    if (!list.length) return false;
    const p = list[Math.floor(Math.random() * list.length)];
    // Jitter within a couple of metres to avoid stacking
    for (let k = 0; k < 6; k++) {
      const x = p.x + (Math.random() - 0.5) * 3, z = p.z + (Math.random() - 0.5) * 3;
      if (nav.isWalkable(x, z) && isFinite(nav.pathDist(x, z))) {
        this.enemies.spawn(type, region, x, z, 'chase');
        return true;
      }
    }
    this.enemies.spawn(type, region, p.x, p.z, 'chase');
    return true;
  }
}

function neighbours(r: RegionId): RegionId[] {
  return r === 'low' ? ['low'] : r === 'medium' ? ['medium', 'low'] : ['high', 'medium'];
}

function pickType(w: Record<'shambler' | 'runner' | 'armored', number>): ZombieType {
  const t = w.shambler + w.runner + w.armored;
  let r = Math.random() * t;
  if ((r -= w.shambler) < 0) return 'shambler';
  if ((r -= w.runner) < 0) return 'runner';
  return 'armored';
}
