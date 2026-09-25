// Pure ammunition / reload / cadence logic for a single weapon instance. No rendering or DOM here.
import { UPGRADE_TIERS, WEAPONS, type WeaponDef, type WeaponId } from '../config';

export type ReloadPhase = 'none' | 'mag' | 'shellStart' | 'shellLoop' | 'shellEnd';

export interface WeaponState {
  id: WeaponId;
  tier: number;
  mag: number;
  reserve: number;
  cooldown: number;
  reloadPhase: ReloadPhase;
  reloadT: number;
  /** Total shells inserted in the current shell reload (for animation). */
  shellsInserted: number;
}

export interface EffectiveStats {
  damage: number;
  magSize: number;
  reserveMax: number;
  reloadTime: number;
  fireInterval: number;
  spreadMult: number;
  shell?: { start: number; perShell: number; end: number };
}

export function effectiveStats(id: WeaponId, tier: number): EffectiveStats {
  const d: WeaponDef = WEAPONS[id];
  const t = UPGRADE_TIERS[Math.max(0, Math.min(UPGRADE_TIERS.length - 1, tier))];
  return {
    damage: d.damage * t.damageMult,
    magSize: Math.round(d.magSize * t.magMult),
    reserveMax: Math.round(d.reserveMax * t.magMult),
    reloadTime: d.reloadTime * t.reloadMult,
    fireInterval: 60 / (d.rpm * t.rpmMult),
    spreadMult: t.spreadMult,
    shell: d.shellReload
      ? { start: d.shellReload.start * t.reloadMult, perShell: d.shellReload.perShell * t.reloadMult, end: d.shellReload.end * t.reloadMult }
      : undefined,
  };
}

export function createWeapon(id: WeaponId, tier = 0): WeaponState {
  const s = effectiveStats(id, tier);
  return {
    id,
    tier,
    mag: s.magSize,
    reserve: Math.min(WEAPONS[id].startReserve, s.reserveMax),
    cooldown: 0,
    reloadPhase: 'none',
    reloadT: 0,
    shellsInserted: 0,
  };
}

export function isReloading(w: WeaponState): boolean {
  return w.reloadPhase !== 'none';
}

/** Whether the trigger can fire a round right now (ignores switching / other player-level blocks). */
export function canFire(w: WeaponState): boolean {
  if (w.cooldown > 0 || w.mag <= 0) return false;
  if (w.reloadPhase === 'mag') return false;
  return true; // shell reloads are interruptible by firing
}

/** Consumes one round. Returns false if the shot is not allowed. Interrupts shell reloads. */
export function fire(w: WeaponState): boolean {
  if (!canFire(w)) return false;
  if (w.reloadPhase !== 'none') {
    // Only shell reloads reach here: firing cancels the remaining insertion.
    w.reloadPhase = 'none';
    w.reloadT = 0;
  }
  w.mag -= 1;
  w.cooldown = effectiveStats(w.id, w.tier).fireInterval;
  return true;
}

export function needsReload(w: WeaponState): boolean {
  return w.mag < effectiveStats(w.id, w.tier).magSize && w.reserve > 0;
}

export function startReload(w: WeaponState): boolean {
  if (w.reloadPhase !== 'none' || !needsReload(w)) return false;
  const s = effectiveStats(w.id, w.tier);
  w.reloadT = 0;
  w.shellsInserted = 0;
  w.reloadPhase = s.shell ? 'shellStart' : 'mag';
  return true;
}

/** Cancels a reload. A magazine reload that has not completed transfers nothing; inserted shells are kept. */
export function cancelReload(w: WeaponState): void {
  w.reloadPhase = 'none';
  w.reloadT = 0;
}

export type ReloadEvent = 'none' | 'magComplete' | 'shellInserted' | 'shellDone';

/** Advances timers. Returns the most significant reload event that happened this step. */
export function updateWeapon(w: WeaponState, dt: number): ReloadEvent {
  if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt);
  if (w.reloadPhase === 'none') return 'none';
  const s = effectiveStats(w.id, w.tier);
  w.reloadT += dt;
  let ev: ReloadEvent = 'none';
  if (w.reloadPhase === 'mag') {
    if (w.reloadT >= s.reloadTime) {
      const need = s.magSize - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloadPhase = 'none';
      w.reloadT = 0;
      ev = 'magComplete';
    }
    return ev;
  }
  const sh = s.shell!;
  // Loop so large dt values cannot skip state transitions.
  for (let guard = 0; guard < 32; guard++) {
    if (w.reloadPhase === 'shellStart') {
      if (w.reloadT < sh.start) break;
      w.reloadT -= sh.start;
      w.reloadPhase = 'shellLoop';
    } else if (w.reloadPhase === 'shellLoop') {
      if (w.mag >= s.magSize || w.reserve <= 0) {
        w.reloadPhase = 'shellEnd';
        continue;
      }
      if (w.reloadT < sh.perShell) break;
      w.reloadT -= sh.perShell;
      w.mag += 1;
      w.reserve -= 1;
      w.shellsInserted += 1;
      ev = 'shellInserted';
    } else if (w.reloadPhase === 'shellEnd') {
      if (w.reloadT < sh.end) break;
      w.reloadPhase = 'none';
      w.reloadT = 0;
      ev = 'shellDone';
      break;
    } else break;
  }
  return ev;
}

/** Normalised progress 0..1 of the current magazine reload (for animation). */
export function reloadProgress(w: WeaponState): number {
  if (w.reloadPhase !== 'mag') return 0;
  return Math.min(1, w.reloadT / effectiveStats(w.id, w.tier).reloadTime);
}

/** Adds reserve ammo up to the cap. Returns the amount actually added. */
export function addReserve(w: WeaponState, amount: number): number {
  const cap = effectiveStats(w.id, w.tier).reserveMax;
  const add = Math.max(0, Math.min(amount, cap - w.reserve));
  w.reserve += add;
  return add;
}

export function refillAmmo(w: WeaponState): void {
  const s = effectiveStats(w.id, w.tier);
  w.reserve = s.reserveMax;
}

export function applyUpgrade(w: WeaponState): boolean {
  if (w.tier >= UPGRADE_TIERS.length - 1) return false;
  cancelReload(w);
  w.tier += 1;
  const s = effectiveStats(w.id, w.tier);
  w.mag = s.magSize;
  w.reserve = s.reserveMax;
  return true;
}

/** Linear damage falloff between near and far range. */
export function damageAtRange(id: WeaponId, base: number, dist: number): number {
  const d = WEAPONS[id];
  if (dist <= d.rangeNear) return base;
  if (dist >= d.rangeFar) return base * d.minDamageMult;
  const t = (dist - d.rangeNear) / (d.rangeFar - d.rangeNear);
  return base * (1 - t * (1 - d.minDamageMult));
}
