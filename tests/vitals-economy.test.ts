import { describe, expect, it } from 'vitest';
import { ECONOMY, PLAYER, UPGRADE_TIERS } from '../src/config';
import { applyPurchase, validatePurchase, type Loadout } from '../src/mission/Economy';
import { applyDamage, beginPlate, createVitals, maxArmor, updateVitals } from '../src/player/Vitals';
import { createWeapon } from '../src/weapons/WeaponState';

const loadout = (cash: number): Loadout => ({ cash, slots: [createWeapon('rifle'), createWeapon('pistol')], active: 0, grenades: 1 });

describe('damage and armor', () => {
  it('armor absorbs damage before health', () => {
    const v = createVitals();
    v.armor = 50;
    const r = applyDamage(v, 30);
    expect(v.armor).toBe(20);
    expect(v.health).toBe(100);
    expect(r.healthDamage).toBe(0);
    applyDamage(v, 30);
    expect(v.armor).toBe(0);
    expect(v.health).toBe(90);
  });

  it('reports a broken plate when crossing a plate boundary', () => {
    const v = createVitals();
    v.armor = 60;
    expect(applyDamage(v, 15).armorBroke).toBe(true); // 60 -> 45 drops below one full plate
    expect(applyDamage(v, 10).armorBroke).toBe(false); // 45 -> 35 stays within the same plate
  });

  it('contamination damage bypasses armor', () => {
    const v = createVitals();
    v.armor = 150;
    applyDamage(v, 20, true);
    expect(v.armor).toBe(150);
    expect(v.health).toBe(80);
  });

  it('death occurs exactly once and further damage is ignored', () => {
    const v = createVitals();
    v.armor = 0;
    expect(applyDamage(v, 150).killed).toBe(true);
    expect(v.alive).toBe(false);
    expect(v.health).toBe(0);
    expect(applyDamage(v, 10).killed).toBe(false);
  });

  it('health regenerates only after the delay', () => {
    const v = createVitals();
    v.armor = 0;
    applyDamage(v, 50);
    updateVitals(v, PLAYER.healthRegenDelay - 0.1, false);
    expect(v.health).toBe(50);
    updateVitals(v, 1, false);
    expect(v.health).toBeGreaterThan(50);
  });

  it('armor plates take time, consume inventory and cap at max armor', () => {
    const v = createVitals();
    v.armor = 20;
    v.plates = 2;
    expect(beginPlate(v)).toBe(true);
    expect(beginPlate(v)).toBe(false); // already applying
    expect(updateVitals(v, PLAYER.plateApplyTime / 2, false)).toBe(false);
    expect(v.armor).toBe(20);
    expect(updateVitals(v, PLAYER.plateApplyTime, false)).toBe(true);
    expect(v.armor).toBe(50);
    expect(v.plates).toBe(1);
    v.armor = maxArmor();
    expect(beginPlate(v)).toBe(false);
  });

  it('sprint stamina drains, exhausts and recovers with a threshold', () => {
    const v = createVitals();
    for (let i = 0; i < 100; i++) updateVitals(v, 0.1, true);
    expect(v.stamina).toBe(0);
    expect(v.exhausted).toBe(true);
    updateVitals(v, PLAYER.staminaRegenDelay * 0.9, false); // no regen yet
    expect(v.exhausted).toBe(true);
    for (let i = 0; i < 20; i++) updateVitals(v, 0.1, false);
    expect(v.exhausted).toBe(false);
  });
});

describe('purchase validation', () => {
  it('denies unaffordable purchases without side effects', () => {
    const l = loadout(100);
    const v = createVitals();
    const plates = v.plates;
    const r = applyPurchase(l, v, 'plate');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('INSUFFICIENT SALVAGE');
    expect(l.cash).toBe(100);
    expect(v.plates).toBe(plates);
  });

  it('currency never goes negative across repeated purchases', () => {
    const l = loadout(ECONOMY.grenadeCost * 2 + 10);
    const v = createVitals();
    let ok = 0;
    for (let i = 0; i < 10; i++) if (applyPurchase(l, v, 'grenade').ok) ok++;
    expect(ok).toBe(2);
    expect(l.cash).toBe(10);
    expect(l.cash).toBeGreaterThanOrEqual(0);
  });

  it('enforces inventory caps', () => {
    const l = loadout(99999);
    const v = createVitals();
    v.plates = PLAYER.maxPlateInventory;
    expect(validatePurchase(l, v, 'plate').reason).toBe('PLATES FULL');
    l.grenades = PLAYER.maxGrenades;
    expect(validatePurchase(l, v, 'grenade').reason).toBe('GRENADES FULL');
  });

  it('ammo purchase refills reserves and is denied when already full', () => {
    const l = loadout(5000);
    const v = createVitals();
    l.slots[0]!.reserve = 0;
    expect(applyPurchase(l, v, 'ammo').ok).toBe(true);
    expect(l.slots[0]!.reserve).toBeGreaterThan(0);
    expect(validatePurchase(l, v, 'ammo').reason).toBe('AMMO FULL');
  });

  it('shotgun can only be bought once and replaces the held weapon', () => {
    const l = loadout(5000);
    const v = createVitals();
    l.active = 1;
    expect(applyPurchase(l, v, 'shotgun').ok).toBe(true);
    expect(l.slots[1]!.id).toBe('shotgun');
    expect(l.slots[0]!.id).toBe('rifle');
    expect(applyPurchase(l, v, 'shotgun').reason).toBe('OWNED');
    expect(l.cash).toBe(5000 - ECONOMY.shotgunCost);
  });

  it('upgrade purchase changes weapon tier and stops at max tier', () => {
    const l = loadout(100000);
    const v = createVitals();
    expect(applyPurchase(l, v, 'upgrade0').ok).toBe(true);
    expect(l.slots[0]!.tier).toBe(1);
    expect(applyPurchase(l, v, 'upgrade0').ok).toBe(true);
    const cash = l.cash;
    const r = applyPurchase(l, v, 'upgrade0');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('MAX TIER');
    expect(l.cash).toBe(cash);
    expect(100000 - cash).toBe(UPGRADE_TIERS[1].cost + UPGRADE_TIERS[2].cost);
  });
});
