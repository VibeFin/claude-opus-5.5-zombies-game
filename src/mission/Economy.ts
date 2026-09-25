// Pure purchase validation. Every purchase goes through here so currency can never go negative
// and a denied purchase has no side effects.
import { ECONOMY, PLAYER, UPGRADE_TIERS, type WeaponId } from '../config';
import { addReserve, applyUpgrade, createWeapon, effectiveStats, type WeaponState } from '../weapons/WeaponState';
import type { Vitals } from '../player/Vitals';

export interface Loadout {
  cash: number;
  slots: [WeaponState | null, WeaponState | null];
  active: 0 | 1;
  grenades: number;
}

export type PurchaseId = 'ammo' | 'plate' | 'grenade' | 'shotgun' | 'upgrade0' | 'upgrade1';

export interface PurchaseResult {
  ok: boolean;
  reason?: string;
  cost: number;
}

export function upgradeCost(w: WeaponState | null): number | null {
  if (!w || w.tier >= UPGRADE_TIERS.length - 1) return null;
  return UPGRADE_TIERS[w.tier + 1].cost;
}

export function hasWeapon(l: Loadout, id: WeaponId): boolean {
  return l.slots.some((s) => s?.id === id);
}

export function purchaseCost(l: Loadout, id: PurchaseId): number | null {
  switch (id) {
    case 'ammo': return ECONOMY.ammoCost;
    case 'plate': return ECONOMY.plateCost;
    case 'grenade': return ECONOMY.grenadeCost;
    case 'shotgun': return ECONOMY.shotgunCost;
    case 'upgrade0': return upgradeCost(l.slots[0]);
    case 'upgrade1': return upgradeCost(l.slots[1]);
  }
}

/** Checks whether a purchase is currently valid without applying it. */
export function validatePurchase(l: Loadout, v: Vitals, id: PurchaseId): PurchaseResult {
  const cost = purchaseCost(l, id);
  if (cost === null) return { ok: false, reason: 'MAX TIER', cost: 0 };
  if (!v.alive) return { ok: false, reason: 'UNAVAILABLE', cost };
  switch (id) {
    case 'ammo': {
      const full = l.slots.every((s) => !s || s.reserve >= effectiveStats(s.id, s.tier).reserveMax);
      if (full) return { ok: false, reason: 'AMMO FULL', cost };
      break;
    }
    case 'plate':
      if (v.plates >= PLAYER.maxPlateInventory) return { ok: false, reason: 'PLATES FULL', cost };
      break;
    case 'grenade':
      if (l.grenades >= PLAYER.maxGrenades) return { ok: false, reason: 'GRENADES FULL', cost };
      break;
    case 'shotgun':
      if (hasWeapon(l, 'shotgun')) return { ok: false, reason: 'OWNED', cost };
      break;
    case 'upgrade0':
    case 'upgrade1':
      break;
  }
  if (l.cash < cost) return { ok: false, reason: 'INSUFFICIENT SALVAGE', cost };
  return { ok: true, cost };
}

/** Applies a purchase atomically. Returns the validation result. */
export function applyPurchase(l: Loadout, v: Vitals, id: PurchaseId): PurchaseResult {
  const r = validatePurchase(l, v, id);
  if (!r.ok) return r;
  l.cash -= r.cost;
  switch (id) {
    case 'ammo':
      for (const s of l.slots) if (s) addReserve(s, Infinity);
      break;
    case 'plate':
      v.plates += 1;
      break;
    case 'grenade':
      l.grenades += 1;
      break;
    case 'shotgun': {
      const gun = createWeapon('shotgun');
      // Replaces the currently held weapon if both slots are filled.
      if (!l.slots[1]) {
        l.slots[1] = gun;
        l.active = 1;
      } else {
        l.slots[l.active] = gun;
      }
      break;
    }
    case 'upgrade0':
      applyUpgrade(l.slots[0]!);
      break;
    case 'upgrade1':
      applyUpgrade(l.slots[1]!);
      break;
  }
  return r;
}

export function addCash(l: Loadout, amount: number): void {
  l.cash = Math.max(0, l.cash + Math.round(amount));
}
