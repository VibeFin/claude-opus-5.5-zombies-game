// Pure health / armor / plate / stamina rules.
import { PLAYER } from '../config';

export interface Vitals {
  health: number;
  armor: number;
  plates: number; // inventory plates (not yet applied)
  stamina: number;
  exhausted: boolean;
  sinceDamage: number;
  sinceSprint: number;
  plateT: number; // >0 while applying a plate
  alive: boolean;
}

export function createVitals(): Vitals {
  return {
    health: PLAYER.maxHealth,
    armor: PLAYER.startPlatesInVest * PLAYER.plateArmor,
    plates: PLAYER.startPlateInventory,
    stamina: PLAYER.maxStamina,
    exhausted: false,
    sinceDamage: 99,
    sinceSprint: 99,
    plateT: 0,
    alive: true,
  };
}

export const maxArmor = () => PLAYER.maxArmorPlates * PLAYER.plateArmor;

export interface DamageResult {
  armorDamage: number;
  healthDamage: number;
  armorBroke: boolean;
  killed: boolean;
}

/** Armor absorbs damage before health. `bypassArmor` is used by the contamination hazard. */
export function applyDamage(v: Vitals, amount: number, bypassArmor = false): DamageResult {
  const res: DamageResult = { armorDamage: 0, healthDamage: 0, armorBroke: false, killed: false };
  if (!v.alive || amount <= 0) return res;
  let remaining = amount;
  if (!bypassArmor && v.armor > 0) {
    const before = v.armor;
    const absorbed = Math.min(v.armor, remaining);
    v.armor -= absorbed;
    remaining -= absorbed;
    res.armorDamage = absorbed;
    // Crossing a plate boundary counts as a plate breaking.
    res.armorBroke = Math.ceil(v.armor / PLAYER.plateArmor) < Math.ceil(before / PLAYER.plateArmor);
  }
  if (remaining > 0) {
    const h = Math.min(v.health, remaining);
    v.health -= h;
    res.healthDamage = h;
  }
  v.sinceDamage = 0;
  if (v.health <= 0) {
    v.health = 0;
    v.alive = false;
    res.killed = true;
  }
  return res;
}

export function canApplyPlate(v: Vitals): boolean {
  return v.alive && v.plateT <= 0 && v.plates > 0 && v.armor < maxArmor();
}

export function beginPlate(v: Vitals): boolean {
  if (!canApplyPlate(v)) return false;
  v.plateT = PLAYER.plateApplyTime;
  return true;
}

export function cancelPlate(v: Vitals): void {
  v.plateT = 0;
}

/** Advances regen, stamina and plate application. Returns true when a plate finished applying. */
export function updateVitals(v: Vitals, dt: number, sprinting: boolean): boolean {
  if (!v.alive) return false;
  v.sinceDamage += dt;
  if (v.sinceDamage >= PLAYER.healthRegenDelay && v.health < PLAYER.maxHealth) {
    v.health = Math.min(PLAYER.maxHealth, v.health + PLAYER.healthRegenRate * dt);
  }
  if (sprinting) {
    v.stamina = Math.max(0, v.stamina - PLAYER.staminaDrain * dt);
    v.sinceSprint = 0;
    if (v.stamina <= 0) v.exhausted = true;
  } else {
    v.sinceSprint += dt;
    if (v.sinceSprint >= PLAYER.staminaRegenDelay) {
      v.stamina = Math.min(PLAYER.maxStamina, v.stamina + PLAYER.staminaRegen * dt);
    }
    if (v.exhausted && v.stamina >= PLAYER.staminaMinToSprint) v.exhausted = false;
  }
  if (v.plateT > 0) {
    v.plateT -= dt;
    if (v.plateT <= 0) {
      v.plateT = 0;
      if (v.plates > 0 && v.armor < maxArmor()) {
        v.plates -= 1;
        // Fill the current partial plate slot up to the next full plate boundary.
        const slots = Math.floor(v.armor / PLAYER.plateArmor);
        v.armor = Math.min(maxArmor(), (slots + 1) * PLAYER.plateArmor);
        return true;
      }
    }
  }
  return false;
}

export function canSprint(v: Vitals): boolean {
  return v.alive && !v.exhausted && v.stamina > 0;
}
